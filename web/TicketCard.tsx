import { useTicketDrag } from "./TicketDrag";
import { ProgressReport } from "./ProgressReport";
import { microtasks } from "../src/microtasks";
import { ticketNavigation } from "./ticketNavigation";
import { useState } from "react";
import { ImageThumbnail } from "./ImageThumbnail";
import type { Claim, RecordFile } from "../src/types";
import { ago, recordId } from "./api";
import { BlockedIcon, Label, StageIcon } from "./Icons";
import { priorityName, priorityOf, type Context } from "./model";

export const dragType = "text/workboard-ticket";

// Outcome of the last `review --run`, as a small pill on cards and rows.
export function VerificationTag({ record }: { record: RecordFile }) {
  const v = record.meta.verification;
  if (!v) return null;
  const ok = v.exitCode === 0;
  return (
    <span
      className={`tag ${ok ? "green" : "danger"}`}
      title={`${v.command} exited with ${v.exitCode}`}
    >
      {ok ? "Verified ✓" : "Failed ✗"}
    </span>
  );
}

export function Avatar({ name }: { name?: string }) {
  if (!name?.trim()) return null;
  return (
    <span className="avatar" title={name} aria-label={`Owner ${name}`}>
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

export function TicketCard({
  record,
  ctx,
  claim,
  showParent,
  tabIndex,
  onOpen,
}: {
  record: RecordFile;
  ctx: Context;
  claim?: Claim;
  showParent: boolean;
  // Roving tabindex: the board keeps exactly one card in the Tab order.
  tabIndex?: number;
  onOpen: (id: string) => void;
}) {
  const drag = useTicketDrag(record);
  const m = record.meta;
  const tasks = microtasks(record.body).items;
  const role = ctx.columns.find((c) => c.id === m.status)?.role;
  const parent = m.parent ? ctx.byId.get(m.parent) : undefined;
  const priority = priorityOf(record);
  const live = claim && claim.expiresAt > new Date().toISOString();
  const [dragging, setDragging] = useState(false);
  const details =
    !!m.labels?.length ||
    priority !== 2 ||
    m.scopeApproved ||
    m.blocked ||
    m.verification ||
    m.assignment ||
    claim;
  return (
    <button
      className={`ticket-card${dragging ? " dragging" : ""}${drag.edge ? " insert-" + drag.edge : ""}`}
      data-stage={role}
      data-id={m.id}
      tabIndex={tabIndex}
      draggable
      onDragStart={(e) => {
        drag.start(e);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onKeyDown={drag.key}
      {...ticketNavigation(m.id, onOpen)}
    >
      <span className="card-meta">
        <StageIcon role={role} />
        <span className="record-id">{recordId(record)}</span>
        {showParent && parent && (
          <span className="card-parent" title={parent.meta.title}>
            {parent.meta.title}
          </span>
        )}
        <Avatar name={m.owner} />
      </span>
      <span className="card-title">{m.title}</span>
      <ProgressReport record={record} claim={claim} role={role} />
      {!!tasks.length && (
        <span className="tag">
          Checklist {tasks.filter((t) => t.done).length}/{tasks.length}
        </span>
      )}
      {!!m.attachments?.length && (
        <span className="card-images" aria-label="Attached screenshots">
          {m.attachments.slice(0, 3).map((id) => {
            const image = ctx.attachments.get(id);
            return (
              <span key={id} className="card-image" title={image?.name}>
                {image ? (
                  <ImageThumbnail
                    key={`${id}-${image.revision}`}
                    image={image}
                  />
                ) : (
                  <span>Image unavailable</span>
                )}
                {image?.trashedAt && <small>In Trash</small>}
              </span>
            );
          })}
          {m.attachments.length > 3 && (
            <small>+{m.attachments.length - 3}</small>
          )}
        </span>
      )}
      {details && (
        <span className="card-foot">
          <span className="card-tags">
            {m.blocked && (
              <span className="tag danger" title={m.blocked}>
                <BlockedIcon />
                Blocked
              </span>
            )}
            {priority !== 2 && (
              <span className={`priority p${priority}`}>
                {priorityName(record)}
              </span>
            )}
            {m.labels?.slice(0, 4).map((l) => (
              <Label name={l} key={l} />
            ))}
            {m.scopeApproved && (
              <span className="tag green">Approved scope</span>
            )}
            <VerificationTag record={record} />
            {m.assignment && role !== "done" && (
              <span className="tag">
                {m.assignment.worker} · {m.assignment.state}
              </span>
            )}
            {m.agentReview &&
              role === "done" &&
              (m.acceptedBy as { kind?: string } | undefined)?.kind ===
                "agent" && (
                <span
                  className="tag green"
                  title="Accepted by the orchestrator. Integration was not performed."
                >
                  Agent accepted · merge pending
                </span>
              )}
          </span>
        </span>
      )}
    </button>
  );
}
