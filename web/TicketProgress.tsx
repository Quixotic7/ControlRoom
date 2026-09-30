import { microtasks } from "../src/microtasks";
import type { RecordFile } from "../src/types";
import type { Context } from "./model";

export type Completion = { complete: number; total: number };

// Children come from the full project context, rather than the current board
// view. Archived direct children remain part of the work history and count
// here; only a child in the configured Done role is complete.
export function ticketCompletion(record: RecordFile, ctx: Context) {
  const tasks = microtasks(record.body).items;
  const children = ctx.children.get(record.meta.id) ?? [];
  const completeChildren = children.filter(
    (child) =>
      ctx.columns.find((column) => column.id === child.meta.status)?.role ===
      "done",
  ).length;
  return {
    microtasks: tasks.length
      ? {
          complete: tasks.filter((task) => task.done).length,
          total: tasks.length,
        }
      : undefined,
    children: children.length
      ? { complete: completeChildren, total: children.length }
      : undefined,
  };
}

function CompletionBar({
  label,
  completion,
  title,
}: {
  label: string;
  completion: Completion;
  title?: string;
}) {
  const accessible = `${label} progress: ${completion.complete} of ${completion.total} complete`;
  return (
    <span
      className="ticket-progress-item"
      role="progressbar"
      aria-label={accessible}
      aria-valuemin={0}
      aria-valuemax={completion.total}
      aria-valuenow={completion.complete}
      title={title ?? accessible}
    >
      {Array.from({ length: completion.total }, (_, index) => (
        <span
          aria-hidden="true"
          className={`ticket-progress-cell${index < completion.complete ? " complete" : ""}`}
          key={index}
        />
      ))}
    </span>
  );
}

export function TicketProgress({
  record,
  ctx,
  compact = false,
}: {
  record: RecordFile;
  ctx: Context;
  compact?: boolean;
}) {
  const completion = ticketCompletion(record, ctx);
  if (!completion.microtasks && !completion.children) return null;
  return (
    <span className={`ticket-progress${compact ? " compact" : ""}`}>
      {completion.microtasks && (
        <CompletionBar label="Microtasks" completion={completion.microtasks} />
      )}
      {completion.children && (
        <CompletionBar
          label="Child tickets"
          completion={completion.children}
          title="Child tickets progress includes all direct child tickets, including archived tickets."
        />
      )}
    </span>
  );
}
