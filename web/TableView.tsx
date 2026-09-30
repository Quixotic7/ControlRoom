import { useTicketDrag, useTicketDragContext } from "./TicketDrag";
import { Fragment, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { ProgressReport } from "./ProgressReport";
import { TicketProgress } from "./TicketProgress";
import { ticketNavigation } from "./ticketNavigation";
import type { Claim, GroupBy, RecordFile } from "../src/types";
import { ago, recordId } from "./api";
import { GroupHeader } from "./BoardView";
import { ArrowUpIcon, BlockedIcon, Label, StageIcon } from "./Icons";
import { priorities, priorityOf, type Context, type Group } from "./model";
import { QuickTicket } from "./QuickTicket";
import { Avatar, VerificationTag } from "./TicketCard";

const tableSlot = (group: string, id: string) => `table/${group}/${id}`;

function TicketDropRow({
  active,
  columns,
  slot,
}: {
  active: boolean;
  columns: number;
  slot: string;
}) {
  return (
    <tr
      aria-hidden="true"
      className={`ticket-drop-row${active ? " active" : ""}`}
      data-ticket-drop-slot={slot}
    >
      <td colSpan={columns}>
        <div className="ticket-drop-space" />
      </td>
    </tr>
  );
}

function DragRow({
  record,
  selected,
  source,
  role,
  children,
}: {
  record: RecordFile;
  selected: boolean;
  source: boolean;
  role?: string;
  children: ReactNode;
}) {
  const drag = useTicketDrag(record);
  return (
    <tr
      data-stage={role}
      data-id={record.meta.id}
      aria-selected={selected}
      className={`${source ? "drag-source " : ""}${selected ? "selected " : ""}${drag.edge ? "insert-" + drag.edge : ""}`}
      onKeyDown={drag.key}
      onDragStart={drag.start}
    >
      {children}
    </tr>
  );
}

export function TableView({
  groups,
  groupBy,
  ctx,
  claims,
  canReorder,
  previousPeer,
  collapsed,
  onToggleGroup,
  selected,
  onToggleSelected,
  onSelectVisible,
  onOpen,
  onMove,
  onPriority,
  onPlace,
  reload,
}: {
  groups: Group[];
  groupBy: GroupBy;
  ctx: Context;
  claims: Map<string, Claim>;
  canReorder: boolean;
  previousPeer: (r: RecordFile) => RecordFile | undefined;
  collapsed: Set<string>;
  onToggleGroup: (key: string) => void;
  selected: Set<string>;
  onToggleSelected: (id: string, on: boolean) => void;
  onSelectVisible: (on: boolean) => void;
  onOpen: (id: string) => void;
  onMove: (record: RecordFile, status: string) => void;
  onPriority: (record: RecordFile, priority: number) => void;
  onPlace: (draggedId: string, target: RecordFile) => void;
  reload: () => Promise<void>;
}) {
  const ticketDrag = useTicketDragContext();
  const backlog = ctx.columns.find((c) => c.role === "backlog")!.id;
  const allBox = useRef<HTMLInputElement>(null);
  const shown = [
    ...new Map(
      groups
        .filter((g) => !collapsed.has(g.key))
        .flatMap((g) => g.items)
        .map((r) => [r.meta.id, r]),
    ).values(),
  ];
  const chosen = shown.filter((r) => selected.has(r.meta.id));
  const allChosen = shown.length > 0 && chosen.length === shown.length;
  useEffect(() => {
    if (allBox.current)
      allBox.current.indeterminate = chosen.length > 0 && !allChosen;
  }, [chosen.length, allChosen]);
  // Table columns: checkbox, row number, seven fields, and the order control.
  const columns = 9 + (canReorder ? 1 : 0);
  let row = 0;
  return (
    <div className="table-wrap">
      <table className="project-table">
        <thead>
          <tr>
            <th className="row-check">
              <input
                ref={allBox}
                type="checkbox"
                aria-label="Select all visible tickets"
                checked={allChosen}
                onChange={(e) => onSelectVisible(e.target.checked)}
              />
            </th>
            <th className="row-number" aria-label="Row" />
            <th>Title</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Owner</th>
            <th>Labels</th>
            <th>Parent</th>
            <th>Updated</th>
            {canReorder && <th aria-label="Order" />}
          </tr>
        </thead>
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.key);
          return (
            <tbody
              key={g.key}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("text/workboard-ticket"))
                  return;
                e.preventDefault();
                const candidates = Array.from(
                  e.currentTarget.querySelectorAll<HTMLElement>("tr[data-id]"),
                ).filter((row) => {
                  const record = g.items.find(
                    (item) => item.meta.id === row.dataset.id,
                  );
                  return record && ticketDrag?.canPlace(record);
                });
                const next = candidates.find((row) => {
                  const box = row.getBoundingClientRect();
                  return e.clientY < box.top + box.height / 2;
                });
                const row = next ?? candidates.at(-1);
                const target = g.items.find(
                  (item) => item.meta.id === row?.dataset.id,
                );
                if (target && ticketDrag) {
                  const after = !next;
                  ticketDrag.previewAt(
                    target,
                    after,
                    tableSlot(g.key, after ? "$end" : target.meta.id),
                  );
                  e.dataTransfer.dropEffect = "move";
                } else {
                  ticketDrag?.clearPreview();
                  e.dataTransfer.dropEffect = "none";
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node))
                  ticketDrag?.clearPreview();
              }}
              onDrop={(e) => {
                if (
                  ticketDrag?.session?.preview?.slot.startsWith(
                    tableSlot(g.key, ""),
                  )
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  ticketDrag.commit();
                }
              }}
            >
              {groupBy !== "none" && (
                <tr className="group-row">
                  <td colSpan={columns}>
                    <GroupHeader
                      group={g}
                      groupBy={groupBy}
                      ctx={ctx}
                      collapsed={isCollapsed}
                      onToggle={() => onToggleGroup(g.key)}
                      onOpen={onOpen}
                    />
                  </td>
                </tr>
              )}
              {!isCollapsed &&
                g.items.map((r) => {
                  const parent = r.meta.parent
                    ? ctx.byId.get(r.meta.parent)
                    : undefined;
                  const claim = claims.get(r.meta.id);
                  const role = ctx.columns.find(
                    (c) => c.id === r.meta.status,
                  )?.role;
                  const slot = tableSlot(g.key, r.meta.id);
                  return (
                    <Fragment key={r.meta.id}>
                      <TicketDropRow
                        active={ticketDrag?.session?.preview?.slot === slot}
                        columns={columns}
                        slot={slot}
                      />
                      <DragRow
                        key={r.meta.id}
                        record={r}
                        role={role}
                        selected={selected.has(r.meta.id)}
                        source={
                          ticketDrag?.session?.source.meta.id === r.meta.id
                        }
                      >
                        <td className="row-check">
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.meta.title}`}
                            checked={selected.has(r.meta.id)}
                            onChange={(e) =>
                              onToggleSelected(r.meta.id, e.target.checked)
                            }
                          />
                        </td>
                        <td className="row-number">{++row}</td>
                        <td className="title-cell">
                          <button
                            className="ticket-link"
                            draggable={canReorder}
                            onDragStart={(e) =>
                              e.dataTransfer.setData(
                                "text/workboard-ticket",
                                r.meta.id,
                              )
                            }
                            {...ticketNavigation(r.meta.id, onOpen)}
                          >
                            <StageIcon role={role} />
                            <span className="ticket-title">{r.meta.title}</span>
                            <span className="record-id">{recordId(r)}</span>
                          </button>
                          {r.meta.blocked && (
                            <span className="tag danger">
                              <BlockedIcon />
                              Blocked
                            </span>
                          )}
                          <ProgressReport
                            record={r}
                            claim={claim}
                            role={role}
                          />
                          <TicketProgress record={r} ctx={ctx} compact />
                          <VerificationTag record={r} />
                        </td>
                        <td>
                          <span className="status-cell" data-stage={role}>
                            <StageIcon role={role} />
                            <select
                              className="cell-select status-select"
                              aria-label={`Status of ${r.meta.title}`}
                              value={r.meta.status}
                              onChange={(e) => onMove(r, e.target.value)}
                            >
                              {ctx.columns.map((c) => (
                                <option value={c.id} key={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </span>
                        </td>
                        <td>
                          <select
                            className="cell-select"
                            aria-label={`Priority of ${r.meta.title}`}
                            value={priorityOf(r)}
                            onChange={(e) =>
                              onPriority(r, Number(e.target.value))
                            }
                          >
                            {priorities.map((p, i) => (
                              <option value={i} key={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          {r.meta.owner ? (
                            <span className="owner-cell">
                              <Avatar name={r.meta.owner} />
                              {r.meta.owner}
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          <span className="card-tags">
                            {r.meta.labels?.map((l) => (
                              <Label name={l} key={l} />
                            ))}
                          </span>
                        </td>
                        <td className="parent-cell">
                          {parent ? (
                            <button
                              className="text-button"
                              title={parent.meta.title}
                              {...ticketNavigation(parent.meta.id, onOpen)}
                            >
                              {recordId(parent)} {parent.meta.title}
                            </button>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="muted nowrap">
                          {ago(r.meta.updatedAt)}
                        </td>
                        {canReorder && (
                          <td>
                            <button
                              className="icon-button"
                              aria-label={`Move ${r.meta.title} earlier`}
                              disabled={!previousPeer(r)}
                              onClick={() => {
                                const target = previousPeer(r);
                                if (target) onPlace(r.meta.id, target);
                              }}
                            >
                              <ArrowUpIcon />
                            </button>
                          </td>
                        )}
                      </DragRow>
                    </Fragment>
                  );
                })}
              {!isCollapsed && !!g.items.length && (
                <TicketDropRow
                  active={
                    ticketDrag?.session?.preview?.slot ===
                    tableSlot(g.key, "$end")
                  }
                  columns={columns}
                  slot={tableSlot(g.key, "$end")}
                />
              )}
              {!isCollapsed && (
                <tr className="add-row">
                  <td colSpan={2} />
                  <td colSpan={columns - 2}>
                    <QuickTicket
                      lane={groupBy === "none" ? "Table" : `${g.title} / Table`}
                      status={g.defaults.status ?? backlog}
                      defaults={g.defaults}
                      onCreated={reload}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
      </table>
      {!groups.some((g) => g.items.length) && (
        <p className="empty-inline">No tickets match this view.</p>
      )}
    </div>
  );
}
