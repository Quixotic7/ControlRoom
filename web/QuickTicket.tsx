import { useRef, useState } from "react";
import { actor, api } from "./api";
import { PlusIcon } from "./Icons";
import type { Group } from "./model";

// GitHub-style "+ Add item": a quiet button that expands into a title input.
// Enter creates the ticket and keeps the input ready for the next one.
export function QuickTicket({
  lane,
  status,
  defaults,
  onCreated,
}: {
  lane: string;
  status: string;
  defaults: Group["defaults"];
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  if (!open)
    return (
      <button
        type="button"
        className="add-item"
        aria-label={`Add item to ${lane}`}
        onClick={() => setOpen(true)}
      >
        <PlusIcon />
        Add item
      </button>
    );
  return (
    <form
      className="quick-ticket"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!title.trim() || pending.current) return;
        pending.current = true;
        setSaving(true);
        setError("");
        try {
          await api("/records", "POST", {
            kind: "ticket",
            meta: { ...defaults, title: title.trim(), status },
            body: "",
            actor,
          });
          setTitle("");
          await onCreated();
        } catch (err) {
          setError(String(err));
        } finally {
          pending.current = false;
          setSaving(false);
        }
      }}
    >
      <input
        autoFocus
        aria-label={`New ticket in ${lane}`}
        placeholder="Type a title and press Enter"
        value={title}
        maxLength={300}
        readOnly={saving}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => {
          if (!title.trim() && !saving) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.nativeEvent.isComposing)
            event.preventDefault();
          if (event.key === "Escape") {
            event.stopPropagation();
            setTitle("");
            setOpen(false);
          }
        }}
      />
      {error && (
        <p className="quick-ticket-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
