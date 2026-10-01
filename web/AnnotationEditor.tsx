import { randomUUID } from "./browserUtils";
import { WindowMenu } from "./WindowMenu";
import { isRemoteBrowser } from "./api";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Annotation,
  Attachment,
  ProjectState,
  RecordFile,
} from "../src/types";
import { api, actor, ApiError, ConnectionError } from "./api";
import { imageMarkdown } from "./RecordMarkdown";
import { useImageViewport } from "./useImageViewport";
import { ParentInput } from "./ParentInput";

const TicketDestination = memo(ParentInput);

const color = "#e55b40";
const clamp = (v: number) => Math.max(0, Math.min(1, v));
// Key-order-independent JSON, so local and server annotations compare by value.
const canonical = (v: unknown) =>
  JSON.stringify(v, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : value,
  );
export function AnnotationEditor({
  id,
  state,
  onClose,
  reload,
  onError,
  onCreated,
}: {
  id: string;
  state: ProjectState;
  onClose: () => void;
  reload: () => Promise<void>;
  onError: (s: string) => void;
  onCreated: (record: RecordFile) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    svg = useRef<SVGSVGElement>(null),
    img = useRef<HTMLImageElement>(null);
  const [asset, setAsset] = useState<Attachment | null>(null),
    [notes, setNotes] = useState<Annotation[]>([]),
    [tool, setTool] = useState<Annotation["type"] | "select" | "hand">("draw"),
    [selected, setSelected] = useState<string | null>(null),
    [undo, setUndo] = useState<Annotation[][]>([]),
    [redo, setRedo] = useState<Annotation[][]>([]),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [destination, setDestination] = useState(""),
    [split, setSplit] = useState(false),
    [newTitle, setNewTitle] = useState("Screenshot feedback"),
    [projects, setProjects] = useState<any[]>([]),
    [confirmClose, setConfirmClose] = useState(false);
  // Deep comparison is needed only at a discard boundary, never per input.
  const isDirty = () =>
    !!asset && canonical(current.current) !== canonical(asset.annotations);
  const titleDialog = useRef<HTMLDialogElement>(null),
    titleInput = useRef<HTMLInputElement>(null);
  const saveToTicket = useRef<HTMLButtonElement>(null),
    attaching = useRef(false);
  const requestId = useRef(randomUUID());
  const [titlePrompt, setTitlePrompt] = useState(false),
    [uncertain, setUncertain] = useState(false);
  function cancelTitle() {
    if (attaching.current) return;
    setTitlePrompt(false);
    titleDialog.current?.close();
    saveToTicket.current?.focus();
  }
  useEffect(() => {
    if (titlePrompt) {
      titleDialog.current?.showModal();
      titleInput.current?.focus();
      titleInput.current?.select();
    } else titleDialog.current?.close();
  }, [titlePrompt]);
  const viewport = useImageViewport(asset?.width ?? 1000, asset?.height ?? 700);
  function requestClose() {
    if (saving) return;
    finishGesture();
    if (isDirty()) setConfirmClose(true);
    else onClose();
  }
  const current = useRef<Annotation[]>([]),
    gesture = useRef<{
      x: number;
      y: number;
      id: string;
      before: Annotation[];
      moving: boolean;
      pointerId: number;
    } | null>(null);
  const change = (next: Annotation[]) => {
    current.current = next;
    setNotes(next);
    setConfirmClose(false);
  };
  // All edits replace arrays/annotations, so history can share unchanged data.
  const stash = () => {
    const snapshot = current.current;
    setUndo((u) => [...u, snapshot]);
    setRedo([]);
  };
  useEffect(() => {
    dialog.current?.showModal();
    api<Attachment>(`/images/${id}`)
      .then((a) => {
        setAsset(a);
        change(a.annotations);
      })
      .catch((e) => setError(String(e)));
    if (!isRemoteBrowser())
      api("/capture/projects")
        .then(setProjects)
        .catch(() => {});
    return () => dialog.current?.close();
  }, [id]);
  const point = (e: React.PointerEvent) => {
    const b = svg.current!.getBoundingClientRect();
    return {
      x: clamp((e.clientX - b.left) / b.width),
      y: clamp((e.clientY - b.top) / b.height),
    };
  };
  function down(e: React.PointerEvent) {
    if (
      e.button !== 0 ||
      saving ||
      !!gesture.current ||
      !asset ||
      asset.trashedAt ||
      tool === "hand" ||
      viewport.space
    )
      return;
    e.preventDefault();
    svg.current?.focus();
    const p = point(e);
    svg.current!.setPointerCapture(e.pointerId);
    if (tool === "select") {
      const target = (e.target as Element)
        .closest("[data-note]")
        ?.getAttribute("data-note");
      if (target) {
        stash();
        setSelected(target);
        gesture.current = {
          ...p,
          id: target,
          before: current.current,
          pointerId: e.pointerId,
          moving: true,
        };
      } else setSelected(null);
      return;
    }
    stash();
    const note: Annotation = {
      id: "note-" + randomUUID(),
      type: tool,
      ...p,
      x2: p.x,
      y2: p.y,
      points: tool === "draw" ? [[p.x, p.y]] : undefined,
      text: tool === "text" ? "Add text" : "",
      resolved: false,
      actor,
      color,
    };
    change([...current.current, note]);
    setSelected(note.id);
    gesture.current = {
      ...p,
      id: note.id,
      before: [],
      moving: false,
      pointerId: e.pointerId,
    };
  }
  // Preserve all input samples, but reconcile React/SVG at most once per frame.
  const pendingPoints = useRef<{ x: number; y: number }[]>([]);
  const frame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  function flushGesture() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const samples = pendingPoints.current;
    pendingPoints.current = [];
    const g = gesture.current;
    if (!g || !samples.length) return;
    const p = samples[samples.length - 1];
    if (g.moving) {
      const original = g.before.find((a) => a.id === g.id)!;
      const dx = p.x - g.x,
        dy = p.y - g.y;
      change(
        current.current.map((a) =>
          a.id === g.id
            ? {
                ...original,
                x: clamp(original.x + dx),
                y: clamp(original.y + dy),
                x2:
                  original.x2 === undefined
                    ? undefined
                    : clamp(original.x2 + dx),
                y2:
                  original.y2 === undefined
                    ? undefined
                    : clamp(original.y2 + dy),
                points: original.points?.map(([x, y]) => [
                  clamp(x + dx),
                  clamp(y + dy),
                ]),
              }
            : a,
        ),
      );
    } else {
      change(
        current.current.map((a) =>
          a.id === g.id
            ? {
                ...a,
                x2: p.x,
                y2: p.y,
                points:
                  a.type === "draw"
                    ? [
                        ...(a.points ?? []),
                        ...samples.map(({ x, y }): [number, number] => [x, y]),
                      ]
                    : a.points,
              }
            : a,
        ),
      );
    }
  }
  function move(e: React.PointerEvent) {
    if (!gesture.current || gesture.current.pointerId !== e.pointerId) return;
    const samples = e.nativeEvent.getCoalescedEvents?.();
    const b = svg.current!.getBoundingClientRect();
    for (const sample of samples?.length ? samples : [e]) {
      pendingPoints.current.push({
        x: clamp((sample.clientX - b.left) / b.width),
        y: clamp((sample.clientY - b.top) / b.height),
      });
    }
    if (frame.current === null)
      frame.current = requestAnimationFrame(flushGesture);
  }
  function finishGesture() {
    flushGesture();
    gesture.current = null;
  }
  function up(e: React.PointerEvent) {
    if (gesture.current?.pointerId !== e.pointerId) return;
    finishGesture();
  }
  function update(id: string, patch: Partial<Annotation>) {
    change(current.current.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }
  function history(back: boolean) {
    finishGesture();
    const source = back ? undo : redo;
    if (!source.length) return;
    const next = source[source.length - 1];
    const snapshot = current.current;
    if (back) {
      setRedo((v) => [...v, snapshot]);
      setUndo(source.slice(0, -1));
    } else {
      setUndo((v) => [...v, snapshot]);
      setRedo(source.slice(0, -1));
    }
    change(next);
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (titlePrompt) return;
      const typing = (e.target as HTMLElement)?.closest(
        "input, textarea, select, [contenteditable=true]",
      );
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!saving)
          void save().then((ok) => {
            if (ok) onClose();
          });
        return;
      }
      if (typing || saving || asset?.trashedAt) return;
      if (["Delete", "Backspace"].includes(e.key) && selected) {
        e.preventDefault();
        finishGesture();
        stash();
        change(current.current.filter((n) => n.id !== selected));
        setSelected(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        history(!e.shiftKey);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  function rendered() {
    if (!asset || !img.current?.complete)
      throw new Error("Wait for the source image to load");
    const canvas = document.createElement("canvas");
    canvas.width = asset.width;
    canvas.height = asset.height;
    const c = canvas.getContext("2d")!;
    c.drawImage(img.current, 0, 0);
    const W = asset.width,
      H = asset.height,
      scale = Math.max(1, W / 900);
    c.lineWidth = 3 * scale;
    c.lineCap = "round";
    c.lineJoin = "round";
    current.current.forEach((a, i) => {
      const x = a.x * W,
        y = a.y * H,
        x2 = (a.x2 ?? a.x) * W,
        y2 = (a.y2 ?? a.y) * H;
      c.strokeStyle = a.color ?? color;
      c.fillStyle = a.color ?? color;
      c.globalAlpha = a.resolved ? 0.45 : 1;
      if (a.type === "draw") {
        c.beginPath();
        a.points?.forEach(([px, py], index) => {
          if (index) c.lineTo(px * W, py * H);
          else c.moveTo(px * W, py * H);
        });
        c.stroke();
      }
      if (a.type === "box")
        c.strokeRect(
          Math.min(x, x2),
          Math.min(y, y2),
          Math.abs(x2 - x),
          Math.abs(y2 - y),
        );
      if (a.type === "arrow") {
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x2, y2);
        c.stroke();
        const angle = Math.atan2(y2 - y, x2 - x),
          size = 14 * scale;
        c.beginPath();
        c.moveTo(x2, y2);
        c.lineTo(
          x2 - size * Math.cos(angle - 0.45),
          y2 - size * Math.sin(angle - 0.45),
        );
        c.lineTo(
          x2 - size * Math.cos(angle + 0.45),
          y2 - size * Math.sin(angle + 0.45),
        );
        c.closePath();
        c.fill();
      }
      if (a.type === "text") {
        c.font = `${18 * scale}px system-ui`;
        a.text
          .split("\n")
          .forEach((line, j) =>
            c.fillText(line, x + 20 * scale, y + (j + 1) * 22 * scale),
          );
      }
      c.beginPath();
      c.arc(x, y, 13 * scale, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#fff";
      c.font = `bold ${12 * scale}px system-ui`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(String(i + 1), x, y);
      c.textAlign = "start";
      c.textBaseline = "alphabetic";
    });
    return canvas.toDataURL("image/png");
  }
  async function save() {
    if (!asset || asset.trashedAt) return;
    finishGesture();
    setSaving(true);
    setError("");
    try {
      const a = await api<Attachment>(`/images/${id}/annotations`, "PUT", {
        revision: asset.revision,
        annotations: current.current,
        preview: rendered(),
        actor,
      });
      setAsset(a);
      await reload();
      return a;
    } catch (e) {
      setError(String(e));
      return undefined;
    } finally {
      setSaving(false);
    }
  }
  async function attach() {
    if (attaching.current) return;
    if (!split && !destination && !titlePrompt) {
      setError("");
      setTitlePrompt(true);
      return;
    }
    if (uncertain) return;
    if (!split && !destination && !newTitle.trim()) {
      setError("Enter a ticket title.");
      titleInput.current?.focus();
      return;
    }
    attaching.current = true;
    let creating = false;
    try {
      const saved = await save();
      if (!saved) return;
      setSaving(true);
      if (split) {
        const chosen = selected
          ? notes.filter((n) => n.id === selected)
          : notes.filter((n) => !n.resolved);
        if (!chosen.length)
          throw new Error("Add or select an unresolved annotation first");
        for (const n of chosen)
          await api("/records", "POST", {
            kind: "ticket",
            meta: {
              title:
                n.text.trim().split("\n")[0].slice(0, 200) ||
                `Visual feedback ${n.id.slice(-6)}`,
              attachments: [id],
              labels: ["visual-feedback"],
              annotationIds: [n.id],
              parent: destination || null,
            },
            body: `## Requested change\n\n${n.text || "Describe the intended change."}\n\n${imageMarkdown(id)}\n\nScreenshot: ${id}\nAnnotation: ${n.id}\n`,
            actor,
          });
      } else if (destination) {
        const ticket = await api(`/records/${destination}`);
        await api(`/records/${destination}`, "PATCH", {
          revision: ticket.revision,
          patch: {
            attachments: [...new Set([...(ticket.meta.attachments ?? []), id])],
          },
          actor,
        });
      } else {
        creating = true;
        const created = await api<RecordFile>("/records", "POST", {
          kind: "ticket",
          meta: {
            title: newTitle.trim(),
            creationRequestId: requestId.current,
            attachments: [id],
            labels: ["visual-feedback"],
          },
          body:
            "## Visual feedback\n\n" +
            imageMarkdown(id) +
            "\n\n" +
            notes
              .map(
                (n, i) =>
                  `- [${n.resolved ? "x" : " "}] A${i + 1} (${n.id}): ${n.text || "Describe the requested change."}`,
              )
              .join("\n"),
          actor,
        });
        titleDialog.current?.close();
        onCreated(created);
        return;
      }
      await reload();
      onClose();
    } catch (e) {
      if (
        creating &&
        (e instanceof ConnectionError ||
          (e instanceof ApiError && e.status >= 200 && e.status < 300))
      )
        setUncertain(true);
      setError(String(e));
    } finally {
      attaching.current = false;
      setSaving(false);
    }
  }
  async function findCreated() {
    if (attaching.current) return;
    attaching.current = true;
    setSaving(true);
    try {
      const fresh = await api<ProjectState>("/state");
      const record = fresh.records.find(
        (r) => r.meta.creationRequestId === requestId.current,
      );
      if (record) {
        titleDialog.current?.close();
        onCreated(record);
      } else
        setError(
          "No matching ticket found yet. Check again before creating another ticket; the earlier request has not been replayed.",
        );
    } catch (e) {
      setError(String(e));
    } finally {
      attaching.current = false;
      setSaving(false);
    }
  }
  async function deleteScreenshot() {
    if (
      !asset ||
      saving ||
      !window.confirm(
        `Move “${asset.name}” to Trash? You can restore it later.${isDirty() ? " Unsaved annotation changes will be discarded." : ""}`,
      )
    )
      return;
    setSaving(true);
    setError("");
    try {
      await api(`/images/${id}/trash`, "PUT", {
        revision: asset.revision,
        trashed: true,
        actor,
      });
      await reload();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }
  const chooseDestination = useCallback(
    (id: string | null) => setDestination(id ?? ""),
    [],
  );
  const a = notes.find((n) => n.id === selected);
  const W = asset?.width ?? 1000,
    H = asset?.height ?? 700;
  return (
    <dialog
      className="annotation-dialog"
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (titlePrompt) {
          e.stopPropagation();
          cancelTitle();
          return;
        }
        requestClose();
      }}
    >
      <header className="dialog-top">
        <div>
          <span className="eyebrow">VISUAL FEEDBACK / {state.config.name}</span>
          <h2>{asset?.name ?? "Opening screenshot…"}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close annotation editor"
          onClick={requestClose}
        >
          ×
        </button>
      </header>
      <WindowMenu
        file={[
          {
            label: "Save",
            run: () => void save(),
            disabled: saving || !asset || !!asset.trashedAt,
          },
          {
            label: "Save and close",
            run: () =>
              void save().then((ok) => {
                if (ok) onClose();
              }),
            disabled: saving || !asset || !!asset.trashedAt,
          },
          { label: "Close window", run: requestClose, disabled: saving },
        ]}
        view={[
          { label: "Select / move", run: () => setTool("select") },
          { label: "Draw", run: () => setTool("draw") },
          { label: "Pin", run: () => setTool("pin") },
        ]}
      />
      {confirmClose && (
        <div className="banner" role="alert">
          You have unsaved annotation changes.
          <span className="inline-actions">
            <button
              className="button primary"
              disabled={saving || asset?.missing || !!asset?.trashedAt}
              onClick={async () => {
                if (await save()) onClose();
              }}
            >
              Save and close
            </button>
            <button className="button" onClick={onClose}>
              Discard changes
            </button>
            <button className="button" onClick={() => setConfirmClose(false)}>
              Keep editing
            </button>
          </span>
        </div>
      )}
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {asset?.permanentlyDeletedAt ? (
        <div className="banner" role="status">
          This screenshot was permanently deleted. Its local image and preview
          were removed. Existing ticket links and written annotation context are
          preserved below.
        </div>
      ) : asset?.trashedAt ? (
        <div className="banner" role="status">
          This screenshot is in Trash. Existing ticket links are preserved.
          <button
            className="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                const restored = await api<Attachment>(
                  `/images/${id}/trash`,
                  "PUT",
                  { revision: asset.revision, trashed: false, actor },
                );
                setAsset(restored);
                await reload();
              } catch (e) {
                setError(String(e));
              } finally {
                setSaving(false);
              }
            }}
          >
            Restore screenshot
          </button>
        </div>
      ) : null}
      <div
        className="annotation-tools"
        role="toolbar"
        aria-label="Annotation tools"
      >
        {(
          [
            ["select", "↖", "Select / move"],
            ["hand", "✋", "Pan"],
            ["draw", "✎", "Draw"],
            ["text", "T", "Text"],
            ["pin", "●", "Pin"],
            ["box", "□", "Box"],
            ["arrow", "↗", "Arrow"],
          ] as const
        ).map(([t, icon, title]) => (
          <button
            key={t}
            aria-pressed={tool === t}
            className={tool === t ? "button selected" : "button"}
            onClick={() => setTool(t)}
          >
            {icon} {title}
          </button>
        ))}
        <span className="tool-spacer" />
        <button
          className="button"
          aria-label="Zoom out"
          onClick={() => viewport.zoomTo(viewport.view.zoom / 1.25)}
        >
          −
        </button>
        <output aria-label="Image zoom">
          {Math.round(viewport.view.zoom * 100)}%
        </output>
        <button
          className="button"
          aria-label="Zoom in"
          onClick={() => viewport.zoomTo(viewport.view.zoom * 1.25)}
        >
          +
        </button>
        <button className="button" onClick={viewport.fit}>
          Fit image
        </button>
        <button className="button" onClick={() => viewport.zoomTo(1)}>
          100%
        </button>
        <button
          className="button"
          disabled={!undo.length}
          onClick={() => history(true)}
        >
          Undo
        </button>
        <button
          className="button"
          disabled={!redo.length}
          onClick={() => history(false)}
        >
          Redo
        </button>
      </div>
      <div className="annotation-layout">
        <div
          className="image-stage"
          ref={viewport.stage}
          tabIndex={0}
          aria-label="Screenshot viewport"
          onPointerDownCapture={(e) => viewport.down(e, tool === "hand")}
          onPointerMoveCapture={viewport.move}
          onPointerUpCapture={viewport.up}
          onPointerCancel={viewport.up}
          onAuxClick={(e) => e.preventDefault()}
        >
          {asset?.permanentlyDeletedAt ? (
            <div className="empty-state">
              <h2>Screenshot permanently deleted</h2>
              <p>
                The local image and preview were removed. Written annotation
                instructions remain available for linked tickets and context.
              </p>
            </div>
          ) : asset?.missing ? (
            <div className="empty-state">
              <h2>Image is not available locally</h2>
              <p>
                The written annotations are preserved. Restore a backup
                containing this image to continue visual editing.
              </p>
            </div>
          ) : (
            asset && (
              <div
                className="image-canvas"
                style={{
                  width: W,
                  height: H,
                  transform: `translate(${viewport.view.x}px, ${viewport.view.y}px) scale(${viewport.view.zoom})`,
                }}
              >
                <img
                  ref={img}
                  src={`/api/images/${id}/base`}
                  alt="Screenshot being annotated"
                />
                <svg
                  tabIndex={0}
                  ref={svg}
                  viewBox={`0 0 ${W} ${H}`}
                  role="img"
                  aria-label="Editable screenshot annotations"
                  onPointerDown={down}
                  onPointerMove={move}
                  onPointerUp={up}
                  onPointerCancel={up}
                  onLostPointerCapture={up}
                  style={{
                    cursor:
                      tool === "hand" || viewport.space
                        ? "grab"
                        : tool === "select"
                          ? "move"
                          : "crosshair",
                  }}
                >
                  <defs>
                    <marker
                      id={`arrow-${id}`}
                      markerWidth="8"
                      markerHeight="8"
                      refX="7"
                      refY="4"
                      orient="auto"
                    >
                      <path d="M0,0 L8,4 L0,8 Z" fill={color} />
                    </marker>
                  </defs>
                  {notes.map((n, i) => (
                    <AnnotationShape
                      key={n.id}
                      n={n}
                      index={i}
                      selected={selected === n.id}
                      W={W}
                      H={H}
                      imageId={id}
                    />
                  ))}
                </svg>
              </div>
            )
          )}
        </div>
        <aside className="annotation-notes" inert={!!asset?.trashedAt}>
          <div className="section-heading">
            <h3>Annotations</h3>
            <span className="tag">{notes.length}</span>
          </div>
          {notes.map((n, i) => (
            <button
              key={n.id}
              className={`annotation-note ${selected === n.id ? "active" : ""}`}
              onClick={() => {
                setSelected(n.id);
                setTool("select");
              }}
            >
              <span className="number">{i + 1}</span>
              <span>
                {n.text || "Add a written instruction"}
                <small>
                  {n.type}
                  {n.resolved ? " · resolved" : ""}
                </small>
              </span>
            </button>
          ))}
          {!notes.length && (
            <p className="help">
              Your drawing and numbered notes will appear here.
            </p>
          )}
          {a && (
            <div className="note-editor">
              <label className="field">
                Instruction / text
                <textarea
                  value={a.text}
                  onFocus={stash}
                  onChange={(e) => update(a.id, { text: e.target.value })}
                  placeholder="What should change here, and what should the result look like?"
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={a.resolved}
                  onChange={(e) => {
                    stash();
                    update(a.id, { resolved: e.target.checked });
                  }}
                />
                Resolved
              </label>
              <button
                className="text-button danger"
                onClick={() => {
                  stash();
                  change(notes.filter((n) => n.id !== a.id));
                  setSelected(null);
                }}
              >
                Delete annotation
              </button>
              <p className="help">Stable reference: {a.id}</p>
            </div>
          )}
        </aside>
      </div>
      <details className="annotation-save">
        <summary>Attach to a ticket (optional)</summary>
        <div className="fields two">
          <TicketDestination
            above
            records={state.records}
            columns={state.config.columns}
            label={split ? "Parent ticket (optional)" : "Attach to ticket"}
            emptyLabel={split ? "No parent" : "Create a new ticket"}
            clearLabel={split ? "Clear parent" : "Create a new ticket instead"}
            value={destination || null}
            onChange={chooseDestination}
          />
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={split}
            onChange={(e) => setSplit(e.target.checked)}
          />
          Create a linked ticket for{" "}
          {selected ? "the selected annotation" : "each unresolved annotation"}
        </label>
        {projects.length > 1 && (
          <label className="field">
            Copy to another running project
            <select
              defaultValue=""
              onChange={async (e) => {
                if (!e.target.value) return;
                const saved = await save();
                if (!saved) return;
                try {
                  const result = await api(`/capture/move/${id}`, "POST", {
                    project: e.target.value,
                  });
                  window.open(result.url, "_blank", "noopener");
                } catch (err) {
                  setError(String(err));
                }
              }}
            >
              <option value="">Current project: {state.config.name}</option>
              {projects
                .filter((p) => p.id !== state.config.projectId)
                .map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
        )}
      </details>
      <footer className="dialog-footer">
        {asset && !asset.trashedAt && (
          <button
            className="text-button danger"
            disabled={saving}
            onClick={deleteScreenshot}
          >
            Delete screenshot
          </button>
        )}
        <span className="help">
          Scroll to zoom · Space + drag to pan · 0 fit · 1 actual size
        </span>
        <div className="inline-actions">
          <button
            className="button primary"
            disabled={saving || !asset || asset.missing || !!asset.trashedAt}
            onClick={async () => {
              if (await save()) onClose();
            }}
          >
            Save screenshot
          </button>
          <button
            className="button"
            disabled={saving || !asset || asset.missing || !!asset.trashedAt}
            onClick={save}
          >
            Save annotations
          </button>
          <button
            ref={saveToTicket}
            className="button"
            disabled={saving || !asset || asset.missing || !!asset.trashedAt}
            onClick={() => void attach()}
          >
            {saving
              ? "Saving…"
              : split
                ? "Create linked tickets"
                : "Save to ticket"}
          </button>
        </div>
      </footer>
      <dialog
        ref={titleDialog}
        className="ticket-title-dialog"
        aria-labelledby="screenshot-ticket-title"
        onCancel={(e) => {
          e.preventDefault();
          e.stopPropagation();
          cancelTitle();
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void attach();
          }}
        >
          <h2 id="screenshot-ticket-title">Create ticket from screenshot</h2>
          <label className="field">
            New ticket title
            <input
              ref={titleInput}
              value={newTitle}
              maxLength={200}
              disabled={saving || uncertain}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </label>
          {error && (
            <p className="banner error" role="alert">
              {error}
            </p>
          )}
          <p className="help">
            Your screenshot and annotations will be included. Add more details
            in the ticket afterward.
          </p>
          <div className="inline-actions">
            <button
              type="button"
              className="button"
              disabled={saving}
              onClick={cancelTitle}
            >
              Cancel
            </button>
            {uncertain ? (
              <button
                type="button"
                className="button primary"
                disabled={saving}
                onClick={() => void findCreated()}
              >
                Check created ticket
              </button>
            ) : (
              <button className="button primary" disabled={saving}>
                {saving ? "Creating…" : "Create ticket"}
              </button>
            )}
          </div>
        </form>
      </dialog>
    </dialog>
  );
}

const AnnotationShape = memo(function AnnotationShape({
  n,
  index,
  selected,
  W,
  H,
  imageId,
}: {
  n: Annotation;
  index: number;
  selected: boolean;
  W: number;
  H: number;
  imageId: string;
}) {
  const r = Math.max(12, W / 65),
    font = Math.max(12, W / 80);
  const path = useMemo(
    () =>
      n.points
        ?.map(([px, py], j) => `${j ? "L" : "M"}${px * W},${py * H}`)
        .join(" "),
    [n.points, W, H],
  );
  const x = n.x * W,
    y = n.y * H,
    x2 = (n.x2 ?? n.x) * W,
    y2 = (n.y2 ?? n.y) * H;
  return (
    <g
      key={n.id}
      data-note={n.id}
      opacity={n.resolved ? 0.45 : 1}
      stroke={n.color ?? color}
      strokeWidth={Math.max(2, W / 350)}
      fill="none"
      className={selected ? "selected-annotation" : ""}
    >
      {n.type === "draw" && (
        <path d={path} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {n.type === "box" && (
        <rect
          x={Math.min(x, x2)}
          y={Math.min(y, y2)}
          width={Math.abs(x2 - x)}
          height={Math.abs(y2 - y)}
          fill="transparent"
        />
      )}
      {n.type === "arrow" && (
        <line
          x1={x}
          y1={y}
          x2={x2}
          y2={y2}
          markerEnd={`url(#arrow-${imageId})`}
        />
      )}
      <circle
        cx={x}
        cy={y}
        r={r}
        fill={n.color ?? color}
        stroke={selected ? "#fff" : color}
      />
      <text
        x={x}
        y={y}
        fill="white"
        stroke="none"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={font}
        fontWeight="600"
      >
        {index + 1}
      </text>
      {n.type === "text" &&
        n.text.split("\n").map((line, j) => (
          <text
            key={j}
            x={x + r * 1.5}
            y={y + (j + 1) * font * 1.5}
            fill={n.color ?? color}
            stroke="none"
            fontSize={font * 1.4}
          >
            {line}
          </text>
        ))}
    </g>
  );
});
