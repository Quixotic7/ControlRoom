import { useId, useState } from "react";
import { split } from "./api";

export function TagInput({
  label,
  value,
  choices,
  multiple = false,
  onChange,
}: {
  label: string;
  value: string | string[];
  choices: string[];
  multiple?: boolean;
  onChange: (value: any) => void;
}) {
  const id = useId();
  const [text, setText] = useState(
    Array.isArray(value) ? value.join(", ") : value,
  );
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const query = (multiple ? text.split(",").at(-1)! : text)
    .trim()
    .toLowerCase();
  const used = multiple ? split(text).slice(0, -1) : [];
  const matches = [...new Set(choices)]
    .filter((v) => !used.includes(v) && v.toLowerCase().includes(query))
    .slice(0, 8);
  function update(next: string) {
    setText(next);
    onChange(multiple ? split(next) : next);
  }
  function choose(choice: string) {
    update(
      multiple
        ? [
            ...text
              .split(",")
              .slice(0, -1)
              .map((s) => s.trim())
              .filter(Boolean),
            choice,
          ].join(", ") + ", "
        : choice,
    );
    setOpen(false);
    setActive(0);
  }
  return (
    <label className="field tag-combobox">
      {label}
      <input
        aria-label={label}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && matches.length > 0}
        aria-controls={id}
        aria-activedescendant={
          open && matches[active] ? `${id}-${active}` : undefined
        }
        value={text}
        placeholder={
          multiple ? "Type or choose labels" : "Type or choose an owner"
        }
        onChange={(e) => {
          update(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
          if (["ArrowDown", "ArrowUp"].includes(e.key) && matches.length) {
            e.preventDefault();
            setOpen(true);
            setActive(
              (i) =>
                (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) %
                matches.length,
            );
          }
          if (e.key === "Enter" && open && matches[active]) {
            e.preventDefault();
            e.stopPropagation();
            choose(matches[active]);
          }
        }}
      />
      {open && matches.length > 0 && (
        <div
          className="tag-options"
          id={id}
          role="listbox"
          aria-label={`${label} suggestions`}
        >
          {matches.map((choice, index) => (
            <div
              role="option"
              id={`${id}-${index}`}
              aria-selected={active === index}
              key={choice}
              className={active === index ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(choice);
              }}
            >
              {choice}
            </div>
          ))}
        </div>
      )}
    </label>
  );
}
