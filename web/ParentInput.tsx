import { useId, useLayoutEffect, useRef, useState } from "react";
import type { Column, RecordFile } from "../src/types";
import { recordId } from "./api";

export function parentChoices(
  records: RecordFile[],
  ticketId: string | undefined,
  query: string,
) {
  const byId = new Map(records.map((r) => [r.meta.id, r]));
  const needle = query.trim().toLowerCase();
  const numeric = /^#?\d+$/.test(needle)
    ? Number(needle.replace(/^#/, ""))
    : null;
  return records
    .filter((r) => {
      if (r.meta.kind !== "ticket") return false;
      const seen = new Set<string>();
      let ancestor: RecordFile | undefined = r;
      while (ancestor) {
        if (ancestor.meta.id === ticketId || seen.has(ancestor.meta.id))
          return false;
        seen.add(ancestor.meta.id);
        ancestor = byId.get(ancestor.meta.parent ?? "");
      }
      return (
        !needle ||
        r.meta.number === numeric ||
        r.meta.title.toLowerCase().includes(needle)
      );
    })
    .sort(
      (a, b) =>
        Number(b.meta.number === numeric) - Number(a.meta.number === numeric) ||
        Number(!!a.meta.archived) - Number(!!b.meta.archived) ||
        a.meta.title.localeCompare(b.meta.title) ||
        (a.meta.number ?? 0) - (b.meta.number ?? 0) ||
        a.meta.id.localeCompare(b.meta.id),
    );
}

export function ParentInput({
  records,
  columns,
  ticketId,
  value,
  onChange,
  label: fieldLabel = "Parent ticket",
  emptyLabel = "No parent",
  clearLabel = "Clear parent",
  above = false,
}: {
  records: RecordFile[];
  columns: Column[];
  ticketId?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  emptyLabel?: string;
  clearLabel?: string;
  above?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const current = records.find((r) => r.meta.id === value);
  const label = current
    ? `${recordId(current)} ${current.meta.title}`
    : value
      ? `Unavailable ticket (${value})`
      : emptyLabel;
  const matches = parentChoices(records, ticketId, query);
  const options: (RecordFile | null)[] = query.trim()
    ? matches.slice(0, 8)
    : [null, ...matches.slice(0, 7)];
  const activeIndex = Math.min(active, options.length - 1);
  useLayoutEffect(() => {
    const el = popup.current;
    if (!open || !above || !el) return;
    el.showPopover();
    const position = () => {
      const b = input.current!.getBoundingClientRect();
      el.style.width = `${b.width}px`;
      el.style.left = `${b.left}px`;
      el.style.top = `${Math.max(8, b.top - el.offsetHeight - 4)}px`;
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      if (el.matches(":popover-open")) el.hidePopover();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, above, query]);
  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
  };
  const choose = (r: RecordFile | null) => {
    onChange(r?.meta.id ?? null);
    close();
  };
  return (
    <div className="field tag-combobox parent-combobox">
      <label htmlFor={id}>{fieldLabel}</label>
      <input
        ref={input}
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? `${id}-options` : undefined}
        aria-describedby={`${id}-selection`}
        aria-activedescendant={
          open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
        }
        placeholder="Search by title or #number"
        value={open ? query : label}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setActive(0);
        }}
        onBlur={close}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            if (options.length)
              setActive(
                !open
                  ? 0
                  : (activeIndex +
                      (e.key === "ArrowDown" ? 1 : options.length - 1)) %
                      options.length,
              );
          }
          if (e.key === "Enter" && open) {
            e.preventDefault();
            e.stopPropagation();
            if (!e.nativeEvent.isComposing && activeIndex >= 0)
              choose(options[activeIndex]);
          }
        }}
      />
      <div className="parent-selection" id={`${id}-selection`}>
        <span>
          Selected: {label}
          {current?.meta.archived ? " (archived)" : ""}
        </span>
        {value && (
          <button
            type="button"
            className="text-button"
            onClick={() => choose(null)}
          >
            {clearLabel}
          </button>
        )}
      </div>
      {open && (
        <div
          ref={popup}
          popover={above ? "manual" : undefined}
          style={
            above
              ? { position: "fixed", margin: 0, bottom: "auto", right: "auto" }
              : undefined
          }
          className="tag-options"
          id={`${id}-options`}
          role="listbox"
          aria-label={`${fieldLabel} suggestions`}
        >
          {options.map((r, index) => (
            <div
              role="option"
              id={`${id}-option-${index}`}
              key={r?.meta.id ?? "none"}
              aria-selected={activeIndex === index}
              className={activeIndex === index ? "active" : ""}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(r)}
            >
              {r ? (
                <>
                  <strong>
                    {recordId(r)} {r.meta.title}
                  </strong>
                  <small>
                    {columns.find((c) => c.id === r.meta.status)?.name ??
                      r.meta.status}
                    {r.meta.archived ? " · Archived" : ""}
                  </small>
                </>
              ) : (
                emptyLabel
              )}
            </div>
          ))}
          {!options.length && (
            <div role="presentation" className="help">
              {fieldLabel === "Parent ticket"
                ? "No matching parent tickets."
                : "No matching tickets."}
            </div>
          )}
          {matches.length > options.filter(Boolean).length && (
            <div role="presentation" className="help">
              Type more to narrow {matches.length} matches.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
