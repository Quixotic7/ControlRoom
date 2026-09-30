import { createContext, useContext } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import type { RecordFile } from "../src/types";
export type DragPreview = {
  after: boolean;
  slot: string;
  target?: RecordFile;
  // Empty priority buckets have no ticket to act as a target. Keep the
  // destination explicit so dropping there still changes only priority/rank.
  priority?: number;
};
export type DragSession = {
  height: number;
  preview: DragPreview | null;
  source: RecordFile;
  records: Map<string, RecordFile>;
};
type DragContext = {
  clearPreview: () => void;
  commit: () => void;
  end: () => void;
  session: DragSession | null;
  start: (r: RecordFile, height: number) => void;
  previewAt: (target: RecordFile, after: boolean, slot: string) => void;
  previewInPriority: (priority: number, slot: string) => void;
  canPlace: (r: RecordFile) => boolean;
  shift: (r: RecordFile, by: number) => void;
};
export const TicketDragContext = createContext<DragContext | null>(null);
export const useTicketDragContext = () => useContext(TicketDragContext);
export function useTicketDrag(record: RecordFile) {
  const ctx = useContext(TicketDragContext);
  const preview = ctx?.session?.preview;
  return {
    edge:
      preview?.target?.meta.id === record.meta.id
        ? preview.after
          ? ("after" as const)
          : ("before" as const)
        : null,
    key: (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        e.stopPropagation();
        ctx?.shift(record, e.key === "ArrowUp" ? -1 : 1);
      }
    },
    start: (e: DragEvent) => {
      e.dataTransfer.setData("text/workboard-ticket", record.meta.id);
      e.dataTransfer.effectAllowed = "move";
      ctx?.start(record, e.currentTarget.getBoundingClientRect().height);
    },
  };
}
