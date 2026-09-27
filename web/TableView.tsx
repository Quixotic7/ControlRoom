import { ticketNavigation } from "./ticketNavigation";
import { useEffect, useRef, useState } from "react";
import type { Claim, GroupBy, RecordFile } from "../src/types";
import { ago, recordId } from "./api";
import { GroupHeader } from "./BoardView";
import { ArrowUpIcon, BlockedIcon, Label, StageIcon } from "./Icons";
import { priorities, priorityOf, type Context, type Group } from "./model";
import { QuickTicket } from "./QuickTicket";
import { Avatar, VerificationTag } from "./TicketCard";

export function TableView({
  groups,
  groupBy,
  ctx,
  claims,
  canReorder,
  previousPeer,
  filter,
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
  // The view's filter text; a change to it drops the row selection.
  filter: string;
  onOpen: (id: string) => void;
  onMove: (record: RecordFile, status: string) => void;
  onPriority: (record: RecordFile, priority: number) => void;
  onPlace: (draggedId: string, target: RecordFile) => void;
  reload: () => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const backlog = ctx.columns.find((c) => c.role === "backlog")!.id;
  // Rows ticked for a bulk status change.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState(backlog);
  const allBox = useRef<HTMLInputElement>(null);
  useEffect(() => setSelected(new Set()), [filter]);
  const shown = groups
    .filter((g) => !collapsed.has(g.key))
    .flatMap((g) => g.items);
  const chosen = shown.filter((r) => selected.has(r.meta.id));
  const allChosen = shown.length > 0 && chosen.length === shown.length;
  useEffect(() => {
    if (allBox.current)
      allBox.current.indeterminate = chosen.length > 0 && !allChosen;
  }, [chosen.length, allChosen]);
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      on ? next.add(id) : next.delete(id);
      return next;
    });
  // Table columns: checkbox, row number, seven fields, and the order control.
  const columns = 9 + (canReorder ? 1 : 0);
  let row = 0;
  return (
    <div className="table-wrap">
      {chosen.length > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label="Selected rows">
          <span className="count">{chosen.length} selected</span>
          <span className="bulk-sep" aria-hidden>
            ·
          </span>
          <select
            className="cell-select"
            aria-label="Status for selected rows"
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value)}
          >
            {ctx.columns.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            className="button primary small"
            onClick={() => {
              for (const r of chosen) onMove(r, bulkStatus);
              setSelected(new Set());
            }}
          >
            Apply
          </button>
          <button
            className="button subtle small"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      )}
      <table className="project-table">
        <thead>
          <tr>
            <th className="row-check">
              <input
                ref={allBox}
                type="checkbox"
                aria-label="Select all rows"
                checked={allChosen}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? new Set(shown.map((r) => r.meta.id))
                      : new Set(),
                  )
                }
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
            <tbody key={g.key}>
              {groupBy !== "none" && (
                <tr className="group-row">
                  <td colSpan={columns}>
                    <GroupHeader
                      group={g}
                      groupBy={groupBy}
                      ctx={ctx}
                      collapsed={isCollapsed}
                      onToggle={() =>
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          next.has(g.key)
                            ? next.delete(g.key)
                            : next.add(g.key);
                          return next;
                        })
                      }
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
                  return (
                    <tr
                      key={r.meta.id}
                      data-stage={role}
                      aria-selected={selected.has(r.meta.id)}
                      className={selected.has(r.meta.id) ? "selected" : ""}
                      onDragOver={(e) => canReorder && e.preventDefault()}
                      onDrop={(e) => {
                        const id = e.dataTransfer.getData(
                          "text/workboard-ticket",
                        );
                        if (id && canReorder) {
                          e.preventDefault();
                          onPlace(id, r);
                        }
                      }}
                    >
                      <td className="row-check">
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.meta.title}`}
                          checked={selected.has(r.meta.id)}
                          onChange={(e) => toggle(r.meta.id, e.target.checked)}
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
                        {claim && <span className="tag claim">Claimed</span>}
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
                      <td className="muted nowrap">{ago(r.meta.updatedAt)}</td>
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
                    </tr>
                  );
                })}
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
