import { useState } from "react";
import { microtasks, editMicrotask } from "../src/microtasks";
export function Microtasks({
  body,
  onChange,
  disabled = false,
}: {
  body: string;
  onChange: (body: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const { items } = microtasks(body);
  return (
    <section className="microtasks" aria-label="Microtasks">
      <h3>
        Microtasks{" "}
        <span className="tag">
          {items.filter((i) => i.done).length}/{items.length}
        </span>
      </h3>
      <ul>
        {items.map((item, i) => (
          <li key={i}>
            <input
              type="checkbox"
              aria-label={`Complete microtask ${i + 1}`}
              checked={item.done}
              disabled={disabled}
              onChange={() => onChange(editMicrotask(body, "toggle", i))}
            />
            <input
              aria-label={`Microtask ${i + 1}`}
              value={item.text}
              disabled={disabled}
              onChange={(e) =>
                onChange(editMicrotask(body, "rename", i, e.target.value))
              }
            />
            <button
              type="button"
              className="button subtle"
              aria-label={`Move microtask ${i + 1} up`}
              disabled={disabled || i === 0}
              onClick={() => onChange(editMicrotask(body, "up", i))}
            >
              ↑
            </button>
            <button
              type="button"
              className="button subtle"
              aria-label={`Move microtask ${i + 1} down`}
              disabled={disabled || i === items.length - 1}
              onClick={() => onChange(editMicrotask(body, "down", i))}
            >
              ↓
            </button>
            <button
              type="button"
              className="button subtle"
              aria-label={`Remove microtask ${i + 1}`}
              disabled={disabled}
              onClick={() => onChange(editMicrotask(body, "remove", i))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <input
        aria-label="Add microtask"
        placeholder="Add a microtask and press Enter…"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.stopPropagation();
            if (draft.trim()) {
              onChange(editMicrotask(body, "add", 0, draft));
              setDraft("");
            }
          }
        }}
      />
    </section>
  );
}
