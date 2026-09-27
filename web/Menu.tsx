import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

// A button with a popover panel. Closes on outside click or Escape and
// returns focus to its button. `children` may be a function of `close`.
export function Menu({
  label,
  ariaLabel,
  className = "button",
  align = "start",
  escapeClipping = false,
  children,
}: {
  label: React.ReactNode;
  ariaLabel?: string;
  className?: string;
  align?: "start" | "end";
  escapeClipping?: boolean;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !escapeClipping || !el) return;
    // The top layer escapes horizontally scrolling tab strips without changing
    // their dimensions or detaching keyboard/outside-click handling.
    el.showPopover();
    const position = () => {
      const b = button.current!.getBoundingClientRect();
      const left = align === "end" ? b.right - el.offsetWidth : b.left;
      el.style.left = `${Math.max(8, Math.min(left, innerWidth - el.offsetWidth - 8))}px`;
      el.style.top = `${Math.max(8, Math.min(b.bottom + 4, innerHeight - el.offsetHeight - 8))}px`;
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      if (el.matches(":popover-open")) el.hidePopover();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, escapeClipping, align]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", outside);
    root.current?.addEventListener("keydown", key);
    const node = root.current;
    return () => {
      document.removeEventListener("pointerdown", outside);
      node?.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="menu" ref={root}>
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={ariaLabel}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div
          ref={panel}
          popover={escapeClipping ? "manual" : undefined}
          style={
            escapeClipping
              ? { position: "fixed", margin: 0, right: "auto", bottom: "auto" }
              : undefined
          }
          className={`menu-panel ${align}`}
          role="group"
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}
