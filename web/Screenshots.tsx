import { useEffect, useState } from "react";
import type { ProjectState } from "../src/types";
import { api, actor, recordId } from "./api";
import { ImageThumbnail } from "./ImageThumbnail";

export function Screenshots({
  state,
  open,
  reload,
}: {
  state: ProjectState;
  open: (id: string) => void;
  reload: () => Promise<void>;
}) {
  const [query, setQuery] = useState(""),
    [unlinked, setUnlinked] = useState(false),
    [trash, setTrash] = useState(false),
    [selecting, setSelecting] = useState(false),
    [selected, setSelected] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const linked = (id: string) =>
    state.records.filter((r) => r.meta.attachments?.includes(id));
  const images = state.attachments
    .filter(
      (a) =>
        !!a.trashedAt === trash &&
        `${a.name} ${a.annotations.map((n) => n.text).join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (!unlinked || !linked(a.id).length),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const visibleKey = images
    .map((a) => a.id)
    .sort()
    .join(",");
  // Filters/live deletion must never leave invisible screenshots selected.
  useEffect(() => {
    const visible = new Set(visibleKey.split(","));
    setSelected((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) => visible.has(id)),
      ),
    );
  }, [visibleKey]);
  const chosen = images.filter((a) => selected[a.id]);
  const toggle = (id: string, revision: string) =>
    setSelected((current) => {
      const next = { ...current };
      if (next[id]) delete next[id];
      else next[id] = revision;
      return next;
    });
  async function bulk() {
    if (!chosen.length || busy) return;
    if (
      !trash &&
      !window.confirm(
        `Move ${chosen.length} selected screenshots to Trash? Images, annotations, and existing ticket links will be retained.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    const failed: string[] = [];
    for (const a of chosen) {
      try {
        await api(`/images/${a.id}/trash`, "PUT", {
          revision: selected[a.id],
          trashed: !trash,
          actor,
        });
        setSelected((current) => {
          const next = { ...current };
          delete next[a.id];
          return next;
        });
      } catch (e) {
        failed.push(`${a.name}: ${String(e)}`);
      }
    }
    if (failed.length)
      setError(
        `${chosen.length - failed.length} succeeded; ${failed.length} failed. Review and reselect failed screenshots before retrying. ${failed.join(" ")}`,
      );
    try {
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      <div className="toolbar">
        <button
          className="button"
          disabled={busy}
          aria-pressed={trash}
          onClick={() => {
            setTrash(!trash);
            setSelected({});
          }}
        >
          {trash ? "Back to screenshots" : "Trash"}
        </button>
        <label className="search">
          <input
            aria-label="Search screenshots"
            disabled={busy}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search screenshots and annotation text…"
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            disabled={busy}
            checked={unlinked}
            onChange={(e) => setUnlinked(e.target.checked)}
          />
          Not attached to a ticket
        </label>
        <button
          className="button"
          disabled={busy}
          aria-pressed={selecting}
          onClick={() => {
            setSelecting(!selecting);
            setSelected({});
          }}
        >
          {selecting ? "Cancel selection" : "Select screenshots"}
        </button>
      </div>
      {selecting && (
        <div className="toolbar" aria-label="Screenshot selection actions">
          <span role="status">{chosen.length} selected</span>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              setSelected(
                Object.fromEntries(images.map((a) => [a.id, a.revision])),
              )
            }
          >
            Select visible
          </button>
          <button
            className="button"
            disabled={busy || !chosen.length}
            onClick={() => setSelected({})}
          >
            Clear selection
          </button>
          <button
            className="button"
            disabled={busy || !chosen.length}
            onClick={bulk}
          >
            {trash ? "Restore selected" : "Delete selected"}
          </button>
        </div>
      )}
      {trash && (
        <p className="help">
          Deleted screenshots stay here until restored. Open a screenshot to
          restore it, or select several. Images, annotations, and existing
          ticket links are retained.
        </p>
      )}
      <div className="screenshot-grid">
        {images.map((a) => (
          <article
            key={a.id}
            className={`screenshot-item${selected[a.id] ? " is-selected" : ""}`}
          >
            {selecting && (
              <label className="screenshot-selection">
                <input
                  type="checkbox"
                  aria-label={`Select ${a.name}`}
                  disabled={busy}
                  checked={!!selected[a.id]}
                  onChange={() => toggle(a.id, a.revision)}
                />
                Select
              </label>
            )}
            <button
              className="screenshot-card"
              disabled={busy}
              onClick={() =>
                selecting ? toggle(a.id, a.revision) : open(a.id)
              }
            >
              <ImageThumbnail key={`${a.id}-${a.revision}`} image={a} />
              <strong>{a.name}</strong>
              <span>
                {a.annotations.length} annotations ·{" "}
                {new Date(a.createdAt).toLocaleDateString()}
              </span>
              <small>
                {linked(a.id).map(recordId).join(", ") ||
                  "Standalone screenshot"}
              </small>
            </button>
          </article>
        ))}
      </div>
      {!images.length && (
        <div className="empty-state">
          <h2>
            {query || unlinked
              ? "No matching screenshots"
              : trash
                ? "Trash is empty"
                : "Your screenshot library"}
          </h2>
          <p>
            {trash
              ? "Deleted screenshots will appear here."
              : "Paste, drop, or capture an image. Save annotations here and return to them anytime. Attaching a ticket is optional."}
          </p>
        </div>
      )}
    </section>
  );
}
