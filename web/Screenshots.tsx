import { useEffect, useRef, useState } from "react";
import type { Attachment, ProjectState } from "../src/types";
import { api, actor, recordId } from "./api";
import { ImageThumbnail } from "./ImageThumbnail";

type DeleteCandidate = Pick<Attachment, "id" | "name" | "revision"> & {
  links: string[];
};
type DeletePreview = {
  scope: "selection" | "all";
  images: DeleteCandidate[];
};
type DeleteResult = {
  deleted: { id: string; name: string }[];
  failed: { id: string; name: string; error: string }[];
};

function PermanentDeleteDialog({
  preview,
  onClose,
  onCompleted,
}: {
  preview: DeletePreview;
  onClose: () => void;
  onCompleted: (result: DeleteResult) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    cancel = useRef<HTMLButtonElement>(null),
    submitting = useRef(false);
  const [running, setRunning] = useState(false),
    [result, setResult] = useState<DeleteResult | null>(null),
    [requestError, setRequestError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    cancel.current?.focus();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  async function confirm() {
    if (submitting.current || result || requestError) return;
    submitting.current = true;
    setRunning(true);
    try {
      const completed = await api<DeleteResult>(
        "/images/permanent-delete",
        "POST",
        {
          candidates: preview.images.map(({ id, revision }) => ({
            id,
            revision,
          })),
          actor,
        },
      );
      setResult(completed);
      try {
        await onCompleted(completed);
      } catch (error) {
        setRequestError(`Deletion was confirmed, but refresh failed: ${error}`);
      }
    } catch (error) {
      setRequestError(
        `${String(error)} No request was replayed. The local service may have completed some deletions; close this preview and inspect the current Trash before starting a new request.`,
      );
    } finally {
      submitting.current = false;
      setRunning(false);
    }
  }
  const finished = !!result || !!requestError;
  return (
    <dialog
      ref={dialog}
      className="archive-dialog permanent-delete-dialog"
      aria-labelledby="permanent-delete-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!running) onClose();
      }}
    >
      <h2 id="permanent-delete-title">
        {preview.scope === "all" ? "Empty Trash" : "Delete permanently"}
      </h2>
      <p>
        <strong>
          {preview.images.length} screenshot
          {preview.images.length === 1 ? "" : "s"}
        </strong>{" "}
        will be permanently deleted.
      </p>
      <p className="banner error">
        Local base images and annotated previews will be removed. This cannot be
        undone from Trash. Written annotation context and existing ticket or
        conversation prose will remain with a permanent-deletion placeholder.
      </p>
      <p className="help">
        {preview.scope === "all"
          ? "This frozen list covers the entire Trash, including screenshots hidden by the current search or attachment filter. Screenshots moved to Trash after this preview opened are excluded."
          : "Only the explicitly selected screenshots in this frozen list are included."}
      </p>
      <details open>
        <summary>
          Inspect affected screenshots ({preview.images.length})
        </summary>
        <ul className="archive-ticket-list permanent-delete-list">
          {preview.images.map((image) => (
            <li key={image.id}>
              <strong>{image.name}</strong> <code>{image.id}</code>
              <span className="muted">
                {image.links.length
                  ? ` · Linked to ${image.links.join(", ")}`
                  : " · No ticket links"}
              </span>
            </li>
          ))}
        </ul>
      </details>
      {result && (
        <section role="status">
          <p>
            <strong>
              {result.deleted.length} confirmed deleted; {result.failed.length}{" "}
              remain for review.
            </strong>
          </p>
          {!!result.failed.length && (
            <>
              <p>
                These screenshots were not retried. Close this preview, inspect
                their current state, and make a new selection if appropriate.
              </p>
              <ul>
                {result.failed.map((failure) => (
                  <li key={failure.id}>
                    <strong>{failure.name}</strong> <code>{failure.id}</code>:{" "}
                    {failure.error}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {requestError && (
        <p className="banner error" role="alert">
          {requestError}
        </p>
      )}
      <div className="inline-actions">
        <button
          ref={cancel}
          className="button"
          autoFocus
          disabled={running}
          onClick={onClose}
        >
          {finished ? "Close" : "Cancel"}
        </button>
        {!finished && (
          <button
            className="button danger"
            disabled={running}
            onClick={() => void confirm()}
          >
            {running
              ? "Deleting…"
              : `Delete ${preview.images.length} permanently`}
          </button>
        )}
      </div>
    </dialog>
  );
}

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
    [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const linked = (id: string) =>
    state.records.filter((r) => r.meta.attachments?.includes(id));
  const images = state.attachments
    .filter(
      (a) =>
        !a.permanentlyDeletedAt &&
        !!a.trashedAt === trash &&
        `${a.name} ${a.annotations.map((n) => n.text).join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (!unlinked || !linked(a.id).length),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const allTrashed = state.attachments.filter(
    (a) => a.trashedAt && !a.permanentlyDeletedAt,
  );
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
  const deletionCandidate = (a: Attachment): DeleteCandidate => ({
    id: a.id,
    name: a.name,
    revision: a.revision,
    links: linked(a.id).map(recordId),
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
        {trash && (
          <button
            className="button danger"
            disabled={busy || !allTrashed.length}
            onClick={() =>
              setDeletePreview({
                scope: "all",
                images: allTrashed.map(deletionCandidate),
              })
            }
          >
            Empty Trash ({allTrashed.length})
          </button>
        )}
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
            {trash ? "Restore selected" : "Move selected to Trash"}
          </button>
          {trash && (
            <button
              className="button danger"
              disabled={busy || !chosen.length}
              onClick={() =>
                setDeletePreview({
                  scope: "selection",
                  images: chosen.map(deletionCandidate),
                })
              }
            >
              Delete permanently ({chosen.length})
            </button>
          )}
        </div>
      )}
      {trash && (
        <p className="help">
          Screenshots stay here until restored or permanently deleted. Empty
          Trash always covers the whole Trash, even when filters hide items.
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
      {deletePreview && (
        <PermanentDeleteDialog
          preview={deletePreview}
          onClose={() => setDeletePreview(null)}
          onCompleted={async (result) => {
            const deleted = new Set(result.deleted.map((item) => item.id));
            setSelected((current) =>
              Object.fromEntries(
                Object.entries(current).filter(([id]) => !deleted.has(id)),
              ),
            );
            await reload();
          }}
        />
      )}
    </section>
  );
}
