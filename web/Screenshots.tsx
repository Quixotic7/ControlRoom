import { useState } from "react";
import type { ProjectState } from "../src/types";
import { recordId } from "./api";

export function Screenshots({
  state,
  open,
}: {
  state: ProjectState;
  open: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [unlinked, setUnlinked] = useState(false);
  const linked = (id: string) =>
    state.records.filter((r) => r.meta.attachments?.includes(id));
  const images = state.attachments
    .filter(
      (a) =>
        `${a.name} ${a.annotations.map((n) => n.text).join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (!unlinked || !linked(a.id).length),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section>
      <div className="toolbar">
        <label className="search">
          <input
            aria-label="Search screenshots"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search screenshots and annotation text…"
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={unlinked}
            onChange={(e) => setUnlinked(e.target.checked)}
          />
          Not attached to a ticket
        </label>
      </div>
      <div className="screenshot-grid">
        {images.map((a) => (
          <button
            className="screenshot-card"
            key={a.id}
            onClick={() => open(a.id)}
          >
            {a.missing ? (
              <div className="screenshot-missing">
                Image unavailable locally · annotations preserved
              </div>
            ) : (
              <img
                src={`/api/images/${a.id}/preview?v=${a.revision}`}
                alt={a.name}
                onError={(e) => {
                  if (e.currentTarget.dataset.fallback) return;
                  e.currentTarget.dataset.fallback = "base";
                  e.currentTarget.src = `/api/images/${a.id}/base`;
                }}
              />
            )}
            <strong>{a.name}</strong>
            <span>
              {a.annotations.length} annotations ·{" "}
              {new Date(a.createdAt).toLocaleDateString()}
            </span>
            <small>
              {linked(a.id).map(recordId).join(", ") || "Standalone screenshot"}
            </small>
          </button>
        ))}
      </div>
      {!images.length && (
        <div className="empty-state">
          <h2>
            {query || unlinked
              ? "No matching screenshots"
              : "Your screenshot library"}
          </h2>
          <p>
            Paste, drop, or capture an image. Save annotations here and return
            to them anytime. Attaching a ticket is optional.
          </p>
        </div>
      )}
    </section>
  );
}
