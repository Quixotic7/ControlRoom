import { useRef, useState } from "react";
import { actor, api } from "./api";

export function QuickTicket({
  parent,
  lane,
  status,
  onCreated,
}: {
  parent: string | null;
  lane: string;
  status: string;
  onCreated: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
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
            meta: { title: title.trim(), parent, status },
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
      <div className="quick-ticket-entry">
        <span aria-hidden="true">＋</span>
        <input
          aria-label={`New ticket in ${lane}`}
          placeholder="Add a ticket…"
          title="Type a short name and press Enter to create a ticket here"
          value={title}
          maxLength={300}
          readOnly={saving}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.nativeEvent.isComposing)
              event.preventDefault();
          }}
        />
        <span className="quick-ticket-hint" aria-hidden="true">
          {saving ? "Adding…" : "Enter ↵"}
        </span>
      </div>
      {error && (
        <p className="quick-ticket-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
