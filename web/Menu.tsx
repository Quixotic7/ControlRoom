import React, { useEffect, useRef, useState } from "react";

// A button with a popover panel. Closes on outside click or Escape and
// returns focus to its button. `children` may be a function of `close`.
export function Menu({
  label,
  ariaLabel,
  className = "button",
  align = "start",
  children,
}: {
  label: React.ReactNode;
  ariaLabel?: string;
  className?: string;
  align?: "start" | "end";
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
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
        <div className={`menu-panel ${align}`} role="group">
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}
