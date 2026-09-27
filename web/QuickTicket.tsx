import { useLayoutEffect, useRef, useState } from "react";
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
  createTicket,
  alwaysOpen = false,
}: {
  lane: string;
  status: string;
  defaults: Group["defaults"];
  onCreated: () => Promise<void>;
  createTicket?: (title: string) => Promise<void>;
  alwaysOpen?: boolean;
}) {
  const [open, setOpen] = useState(alwaysOpen);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const refocus = useRef(false);
  useLayoutEffect(() => {
    if (!saving && refocus.current) {
      input.current?.focus();
      refocus.current = false;
    }
  }, [saving]);
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
          if (createTicket) await createTicket(title.trim());
          else
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
          refocus.current = true;
          pending.current = false;
          setSaving(false);
        }
      }}
    >
      <input
        ref={input}
        autoFocus={!alwaysOpen}
        aria-label={`New ticket in ${lane}`}
        placeholder="Type a title and press Enter"
        value={title}
        maxLength={300}
        readOnly={saving}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => {
          if (!alwaysOpen && !title.trim() && !saving) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.nativeEvent.isComposing)
            event.preventDefault();
          if (event.key === "Escape") {
            event.stopPropagation();
            setTitle("");
            if (!alwaysOpen) setOpen(false);
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
