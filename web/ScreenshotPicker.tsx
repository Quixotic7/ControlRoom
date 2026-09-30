import { useState } from "react";
import type { Attachment } from "../src/types";
import { ImageThumbnail } from "./ImageThumbnail";

export function ScreenshotPicker({
  images,
  attached,
  onAttach,
  onClose,
  helpText = "Most recent first. Choose a screenshot to attach it; save the ticket to keep the link.",
}: {
  images: Attachment[];
  attached: string[];
  onAttach: (id: string) => void;
  onClose: () => void;
  helpText?: string;
}) {
  const [query, setQuery] = useState("");
  const matches = images
    .filter(
      (a) =>
        !a.trashedAt &&
        !a.permanentlyDeletedAt &&
        !attached.includes(a.id) &&
        `${a.name} ${a.annotations.map((n) => n.text).join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    );
  return (
    <div
      className="screenshot-picker"
      role="region"
      aria-label="Recent screenshots"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="section-heading">
        <label className="field">
          Find a screenshot
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search screenshots and notes…"
          />
        </label>
        <button className="button" onClick={onClose}>
          Close screenshot picker
        </button>
      </div>
      <p className="help">{helpText}</p>
      <div className="recent-screenshots">
        {matches.slice(0, 30).map((a) => (
          <button
            key={a.id}
            className="screenshot-card"
            onClick={() => onAttach(a.id)}
          >
            <ImageThumbnail key={`${a.id}-${a.revision}`} image={a} />
            <strong>{a.name}</strong>
            <small>
              {new Date(a.createdAt).toLocaleString()} · {a.annotations.length}{" "}
              notes
            </small>
          </button>
        ))}
      </div>
      {!matches.length && (
        <p className="help">
          No unattached screenshots match. Capture or upload one, or try another
          search.
        </p>
      )}
      {matches.length > 30 && (
        <p className="help">
          Showing the latest 30 matches. Type more to narrow the list.
        </p>
      )}
    </div>
  );
}
