import { useEffect, useRef } from "react";
import { WindowMenu } from "./WindowMenu";
export function Shortcuts({
  capture,
  onClose,
}: {
  capture: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="shortcuts-dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header className="dialog-top">
        <h2>Keyboard shortcuts</h2>
        <button
          className="icon-button"
          aria-label="Close shortcuts"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <WindowMenu file={[{ label: "Close window", run: onClose }]} />
      <dl className="shortcut-list">
        {[
          [capture, "Capture a screenshot (global, macOS companion)"],
          ["N", "New ticket"],
          ["⌘ / Ctrl + K", "Filter the current view"],
          ["?", "Show shortcuts"],
          ["Enter", "Create a ticket in an open “Add item” box"],
          [
            "← → ↑ ↓",
            "Move between board cards once one has focus; Enter opens it",
          ],
          [
            "Shift + click / Shift + arrows",
            "Select a range of visible board tickets; Esc clears selection",
          ],
          [
            "Table: click + Shift + arrows, ⌘ / Ctrl + C / V",
            "Select editable Status/Priority cells, then copy or fill compatible values",
          ],
          [
            "Alt / Option + ↑ / ↓",
            "Move focused ticket earlier / later (Manual or Priority sort)",
          ],
          ["Esc during drag", "Cancel ticket insertion preview"],
          ["Enter in Add microtask", "Append checklist item and keep typing"],
          ["⌘ / Ctrl + Enter", "Post a comment"],
          ["⌘ / Ctrl + S", "Save and close ticket or screenshot"],
          [
            "Review queue: Alt / Option + ← →",
            "Previous / next review when focus is outside a text field (feedback drafts stay with each ticket)",
          ],
          ["Esc", "Save and close ticket"],
          [
            "Delete / Backspace",
            "Delete selected annotation (when not typing)",
          ],
          ["⌘ / Ctrl + Z", "Undo annotation change"],
          ["⌘ / Ctrl + Shift + Z", "Redo annotation change"],
          ["Space + drag / middle-button drag", "Pan the screenshot"],
          [
            "Scroll / + / −",
            "Zoom the screenshot (scroll zooms around the pointer)",
          ],
          ["0 / 1", "Fit screenshot / show actual pixels (100%)"],
        ].map(([key, description]) => (
          <div key={key}>
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{description}</dd>
          </div>
        ))}
      </dl>
    </dialog>
  );
}
