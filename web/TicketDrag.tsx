import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import type { RecordFile } from "../src/types";
export type DragSession = {
  source: RecordFile;
  records: Map<string, RecordFile>;
};
type DragContext = {
  end: () => void;
  session: DragSession | null;
  start: (r: RecordFile) => void;
  canPlace: (r: RecordFile) => boolean;
  shift: (r: RecordFile, by: number) => void;
  place: (id: string, target: RecordFile, after?: boolean) => void;
};
export const TicketDragContext = createContext<DragContext | null>(null);
export function useTicketDrag(record: RecordFile) {
  const ctx = useContext(TicketDragContext);
  const [edge, setEdgeState] = useState<"before" | "after" | null>(null);
  const edgeRef = useRef<typeof edge>(null);
  const setEdge = (value: typeof edge) => {
    edgeRef.current = value;
    setEdgeState(value);
  };
  useEffect(() => {
    if (!ctx?.session) setEdge(null);
  }, [ctx?.session]);
  return {
    edge: ctx?.session ? edge : null,
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
      ctx?.start(record);
    },
    over: (e: DragEvent) => {
      if (!ctx?.session) return;
      e.stopPropagation();
      if (!ctx.canPlace(record)) {
        setEdge(null);
        e.dataTransfer.dropEffect = "none";
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const box = e.currentTarget.getBoundingClientRect();
      setEdge(e.clientY < box.top + box.height / 2 ? "before" : "after");
    },
    leave: (e: DragEvent) => {
      if (
        !(e.relatedTarget instanceof Node) ||
        !e.currentTarget.contains(e.relatedTarget)
      )
        setEdge(null);
    },
    drop: (e: DragEvent) => {
      if (!ctx?.session) return false;
      e.preventDefault();
      e.stopPropagation();
      if (ctx.canPlace(record) && edgeRef.current)
        ctx.place(
          ctx.session.source.meta.id,
          record,
          edgeRef.current === "after",
        );
      setEdge(null);
      ctx.end();
      return true;
    },
  };
}
