import React, { useEffect, useRef, useState } from "react";
import type { Annotation, Attachment, ProjectState } from "../src/types";
import { api, actor } from "./api";

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
}: {
  id: string;
  state: ProjectState;
  onClose: () => void;
  reload: () => Promise<void>;
  onError: (s: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    svg = useRef<SVGSVGElement>(null),
    img = useRef<HTMLImageElement>(null);
  const [asset, setAsset] = useState<Attachment | null>(null),
    [notes, setNotes] = useState<Annotation[]>([]),
    [tool, setTool] = useState<Annotation["type"] | "select">("draw"),
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
  const dirty = !!asset && canonical(notes) !== canonical(asset.annotations);
  function requestClose() {
    if (saving) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  }
  const current = useRef<Annotation[]>([]),
    gesture = useRef<{
      x: number;
      y: number;
      id: string;
      before: Annotation[];
      moving: boolean;
    } | null>(null);
  const change = (next: Annotation[]) => {
    current.current = next;
    setNotes(next);
  };
  const stash = () => {
    const snapshot = structuredClone(current.current);
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
    if (e.button !== 0 || !asset) return;
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
          before: structuredClone(current.current),
          moving: true,
        };
      } else setSelected(null);
      return;
    }
    stash();
    const note: Annotation = {
      id: "note-" + crypto.randomUUID(),
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
    gesture.current = { ...p, id: note.id, before: [], moving: false };
  }
  function move(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const p = point(e);
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
    } else
      change(
        current.current.map((a) =>
          a.id === g.id
            ? {
                ...a,
                x2: p.x,
                y2: p.y,
                points:
                  a.type === "draw"
                    ? [...(a.points ?? []), [p.x, p.y]]
                    : a.points,
              }
            : a,
        ),
      );
  }
  function up() {
    gesture.current = null;
  }
  function update(id: string, patch: Partial<Annotation>) {
    change(current.current.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }
  function history(back: boolean) {
    const source = back ? undo : redo;
    if (!source.length) return;
    const next = source[source.length - 1];
    const snapshot = structuredClone(current.current);
    if (back) {
      setRedo((v) => [...v, snapshot]);
      setUndo(source.slice(0, -1));
    } else {
      setUndo((v) => [...v, snapshot]);
      setRedo(source.slice(0, -1));
    }
    change(structuredClone(next));
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
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
      if (typing || saving) return;
      if (["Delete", "Backspace"].includes(e.key) && selected) {
        e.preventDefault();
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
    if (!asset) return;
    setSaving(true);
    setError("");
    try {
      const a = await api<Attachment>(`/images/${id}/annotations`, "PUT", {
        revision: asset.revision,
        annotations: notes,
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
    const saved = await save();
    if (!saved) return;
    setSaving(true);
    try {
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
            body: `## Requested change\n\n${n.text || "Describe the intended change."}\n\nScreenshot: ${id}\nAnnotation: ${n.id}\n`,
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
      } else
        await api("/records", "POST", {
          kind: "ticket",
          meta: {
            title: newTitle || "Screenshot feedback",
            attachments: [id],
            labels: ["visual-feedback"],
          },
          body:
            "## Visual feedback\n\n" +
            notes
              .map(
                (n, i) =>
                  `- [${n.resolved ? "x" : " "}] A${i + 1} (${n.id}): ${n.text || "Describe the requested change."}`,
              )
              .join("\n"),
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
  const a = notes.find((n) => n.id === selected);
  const W = asset?.width ?? 1000,
    H = asset?.height ?? 700,
    r = Math.max(12, W / 65),
    font = Math.max(12, W / 80);
  return (
    <dialog
      className="annotation-dialog"
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
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
      {confirmClose && dirty && (
        <div className="banner" role="alert">
          You have unsaved annotation changes.
          <span className="inline-actions">
            <button
              className="button primary"
              disabled={saving || asset?.missing}
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
      <div
        className="annotation-tools"
        role="toolbar"
        aria-label="Annotation tools"
      >
        {(
          [
            ["select", "↖", "Select / move"],
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
        <div className="image-stage">
          {asset?.missing ? (
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
                style={{ aspectRatio: `${W}/${H}` }}
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
                  style={{ cursor: tool === "select" ? "move" : "crosshair" }}
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
                  {notes.map((n, i) => {
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
                        className={
                          selected === n.id ? "selected-annotation" : ""
                        }
                      >
                        {n.type === "draw" && (
                          <path
                            d={n.points
                              ?.map(
                                ([px, py], j) =>
                                  `${j ? "L" : "M"}${px * W},${py * H}`,
                              )
                              .join(" ")}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
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
                            markerEnd={`url(#arrow-${id})`}
                          />
                        )}
                        <circle
                          cx={x}
                          cy={y}
                          r={r}
                          fill={n.color ?? color}
                          stroke={selected === n.id ? "#fff" : color}
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
                          {i + 1}
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
                  })}
                </svg>
              </div>
            )
          )}
          <p className="help">
            Draw directly on the image. Select / move repositions a mark;
            written instructions explain the intended result.
          </p>
        </div>
        <aside className="annotation-notes">
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
          <label className="field">
            {split ? "Parent ticket (optional)" : "Attach to ticket"}
            <select
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            >
              <option value="">
                {split ? "No parent" : "Create a new ticket"}
              </option>
              {state.records
                .filter((r) => r.meta.kind === "ticket")
                .map((r) => (
                  <option key={r.meta.id} value={r.meta.id}>
                    {r.meta.title}
                  </option>
                ))}
            </select>
          </label>
          {!destination && !split && (
            <label className="field">
              New ticket title
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </label>
          )}
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
        <span className="help">
          Base image + editable marks + numbered preview + written instructions
        </span>
        <div className="inline-actions">
          <button
            className="button primary"
            disabled={saving || !asset || asset.missing}
            onClick={async () => {
              if (await save()) onClose();
            }}
          >
            Save screenshot
          </button>
          <button
            className="button"
            disabled={saving || !asset || asset.missing}
            onClick={save}
          >
            Save annotations
          </button>
          <button
            className="button"
            disabled={saving || !asset || asset.missing}
            onClick={attach}
          >
            {saving
              ? "Saving…"
              : split
                ? "Create linked tickets"
                : "Save to ticket"}
          </button>
        </div>
      </footer>
    </dialog>
  );
}
