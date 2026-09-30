import { useTicketDrag, useTicketDragContext } from "./TicketDrag";
import { Fragment, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ProgressReport } from "./ProgressReport";
import { TicketProgress } from "./TicketProgress";
import { ticketNavigation } from "./ticketNavigation";
import type { Claim, GroupBy, RecordFile } from "../src/types";
import { actor, ago, api, recordId } from "./api";
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

type EditableColumn = "status" | "priority";
type TableCell = { id: string; column: EditableColumn };
type CellSelection = {
  active: TableCell;
  anchor: TableCell;
  // Keep the IDs which were in the range when it was made. A refresh or a
  // sort must not turn the next paste into a write to newly-adjacent rows.
  rows: string[];
  columns: EditableColumn[];
};
const editableColumns: EditableColumn[] = ["status", "priority"];

function matrixFromClipboard(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => line.split("\t"));
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
  // Label grouping can place one ticket in more than one group. The table is
  // a spreadsheet-like list, so show each ticket once (in its first group).
  const renderedIds = new Set<string>();
  const tableGroups = groups.map((group) => ({
    ...group,
    // A collapsed group renders no rows, so it must not prevent the same
    // labelled ticket from appearing in a later open group.
    items: collapsed.has(group.key)
      ? group.items
      : group.items.filter((record) => {
          if (renderedIds.has(record.meta.id)) return false;
          renderedIds.add(record.meta.id);
          return true;
        }),
  }));
  const shown = [
    ...new Map(
      tableGroups
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
  const tableRef = useRef<HTMLDivElement>(null);
  const [cellSelection, setCellSelection] = useState<CellSelection | null>(
    null,
  );
  // Moving focus after a Shift click/arrow must not let td.onFocus turn the
  // range back into a one-cell selection.
  const preserveRangeOnFocus = useRef(false);
  const [pasteFeedback, setPasteFeedback] = useState<string | null>(null);
  const rowIds = shown.map((record) => record.meta.id);
  const active =
    cellSelection && rowIds.includes(cellSelection.active.id)
      ? cellSelection.active
      : null;
  const selectedCells = () => {
    if (!cellSelection) return [] as TableCell[];
    // Hidden/filtered rows leave the range rather than being written by a
    // keyboard paste. The remaining entries retain their original IDs/order.
    return cellSelection.rows
      .filter((id) => rowIds.includes(id))
      .flatMap((id) => cellSelection.columns.map((column) => ({ id, column })));
  };
  const isCellSelected = (id: string, column: EditableColumn) =>
    selectedCells().some((cell) => cell.id === id && cell.column === column);
  const activateCell = (cell: TableCell, extend = false) => {
    setCellSelection((current) => {
      const anchor =
        extend && current && rowIds.includes(current.anchor.id)
          ? current.anchor
          : cell;
      const firstRow = Math.min(
        rowIds.indexOf(anchor.id),
        rowIds.indexOf(cell.id),
      );
      const lastRow = Math.max(
        rowIds.indexOf(anchor.id),
        rowIds.indexOf(cell.id),
      );
      const firstColumn = Math.min(
        editableColumns.indexOf(anchor.column),
        editableColumns.indexOf(cell.column),
      );
      const lastColumn = Math.max(
        editableColumns.indexOf(anchor.column),
        editableColumns.indexOf(cell.column),
      );
      return {
        active: cell,
        anchor,
        rows: rowIds.slice(firstRow, lastRow + 1),
        columns: editableColumns.slice(firstColumn, lastColumn + 1),
      };
    });
  };
  const focusCell = (cell: TableCell, preserveRange = false) => {
    requestAnimationFrame(() => {
      if (preserveRange) preserveRangeOnFocus.current = true;
      tableRef.current
        ?.querySelector<HTMLElement>(
          `td[data-cell-id="${cell.id}"][data-cell-column="${cell.column}"]`,
        )
        ?.focus();
      preserveRangeOnFocus.current = false;
    });
  };
  const copiedText = () => {
    const cells = selectedCells();
    if (!cells.length) return "";
    const byId = new Map(shown.map((record) => [record.meta.id, record]));
    const rows = [...new Set(cells.map((cell) => cell.id))];
    const cols = [...new Set(cells.map((cell) => cell.column))];
    return rows
      .map((id) =>
        cols
          .map((column) => {
            const record = byId.get(id)!;
            return column === "status"
              ? (ctx.columns.find((item) => item.id === record.meta.status)
                  ?.name ?? record.meta.status)
              : priorities[priorityOf(record)];
          })
          .join("\t"),
      )
      .join("\n");
  };
  const writeCellChanges = async (
    changes: Map<string, Record<string, unknown>>,
  ) => {
    const records = new Map(shown.map((record) => [record.meta.id, record]));
    const writes = [...changes].filter(([id, patch]) => {
      const record = records.get(id)!;
      return Object.entries(patch).some(([field, value]) =>
        field === "status"
          ? record.meta.status !== value
          : priorityOf(record) !== value,
      );
    });
    if (!writes.length) {
      setPasteFeedback("No cells changed.");
      return;
    }
    const outcomes = await Promise.all(
      writes.map(async ([id, patch]) => {
        const record = records.get(id)!;
        try {
          await api(`/records/${id}`, "PATCH", {
            revision: record.revision,
            patch,
            actor,
          });
          return { ok: true, id };
        } catch (error) {
          return {
            ok: false,
            id,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    const failed = outcomes.filter((outcome) => !outcome.ok);
    setPasteFeedback(
      failed.length
        ? `${outcomes.length - failed.length} updated; ${failed.length} conflict${failed.length === 1 ? "" : "s"}: ${failed[0].error}`
        : `${outcomes.length} ticket${outcomes.length === 1 ? "" : "s"} updated.`,
    );
    await reload();
  };
  const changeSelected = async (
    record: RecordFile,
    column: EditableColumn,
    value: string | number,
  ) => {
    // Freeze only selected, visible cells in this column. A rectangle across
    // Status and Priority must never interpret a priority as a status value.
    const cells = isCellSelected(record.meta.id, column)
      ? selectedCells().filter((cell) => cell.column === column)
      : [{ id: record.meta.id, column }];
    await writeCellChanges(
      new Map(cells.map((cell) => [cell.id, { [column]: value }])),
    );
  };
  const pasteCells = async (text: string) => {
    const cells = selectedCells();
    if (!cells.length || !text) return;
    const source = matrixFromClipboard(text);
    const rows = [...new Set(cells.map((cell) => cell.id))];
    const cols = [...new Set(cells.map((cell) => cell.column))];
    const fill = source.length === 1 && source[0].length === 1;
    if (
      !fill &&
      (source.length !== rows.length ||
        source.some((line) => line.length !== cols.length))
    ) {
      setPasteFeedback(
        `Paste needs ${rows.length} row${rows.length === 1 ? "" : "s"} × ${cols.length} column${cols.length === 1 ? "" : "s"}, or one value to fill the selected cells.`,
      );
      return;
    }
    const changes = new Map<string, Record<string, unknown>>();
    for (let row = 0; row < rows.length; row++) {
      for (let column = 0; column < cols.length; column++) {
        const value = (fill ? source[0][0] : source[row][column]).trim();
        let parsed: string | number | undefined;
        if (cols[column] === "status")
          parsed = ctx.columns.find(
            (item) =>
              item.id.toLowerCase() === value.toLowerCase() ||
              item.name.toLowerCase() === value.toLowerCase(),
          )?.id;
        else {
          const normalized = value.toLowerCase().replace(/ priority$/, "");
          const index = priorities.findIndex(
            (priority) => priority.toLowerCase() === normalized,
          );
          parsed = index < 0 ? undefined : index;
        }
        if (parsed === undefined) {
          setPasteFeedback(
            `“${value}” is not a valid ${cols[column]} value. Nothing was changed.`,
          );
          return;
        }
        const patch = changes.get(rows[row]) ?? {};
        patch[cols[column]] = parsed;
        changes.set(rows[row], patch);
      }
    }
    await writeCellChanges(changes);
  };
  const onTableKeyDown = (e: React.KeyboardEvent<HTMLTableElement>) => {
    if (
      !(e.target instanceof HTMLElement) ||
      e.target instanceof HTMLSelectElement
    )
      return;
    const cell = e.target.closest<HTMLTableCellElement>(
      "td[data-cell-id][data-cell-column]",
    );
    if (!cell || !active) return;
    if (e.key === "Enter") {
      e.preventDefault();
      cell.querySelector<HTMLSelectElement>("select")?.focus();
      return;
    }
    const movement: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const step = movement[e.key];
    if (!step) return;
    e.preventDefault();
    const row = rowIds.indexOf(active.id) + step[0];
    const column = editableColumns.indexOf(active.column) + step[1];
    if (
      row < 0 ||
      row >= rowIds.length ||
      column < 0 ||
      column >= editableColumns.length
    )
      return;
    const next = { id: rowIds[row], column: editableColumns[column] };
    activateCell(next, e.shiftKey);
    focusCell(next, e.shiftKey);
  };
  let row = 0;
  return (
    <div className="table-wrap" ref={tableRef}>
      <table
        className="project-table"
        onKeyDown={onTableKeyDown}
        onCopy={(e) => {
          if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement ||
            (e.target instanceof HTMLElement && e.target.isContentEditable)
          )
            return;
          const text = copiedText();
          if (!text) return;
          e.preventDefault();
          e.clipboardData.setData("text/plain", text);
        }}
        onPaste={(e) => {
          if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement ||
            (e.target instanceof HTMLElement && e.target.isContentEditable)
          )
            return;
          if (!active) return;
          e.preventDefault();
          void pasteCells(e.clipboardData.getData("text/plain"));
        }}
      >
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
        {tableGroups.map((g) => {
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
                          !!ticketDrag?.session?.preview &&
                          ticketDrag.session.source.meta.id === r.meta.id
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
                        <td
                          data-cell-id={r.meta.id}
                          data-cell-column="status"
                          tabIndex={0}
                          className={
                            isCellSelected(r.meta.id, "status")
                              ? "cell-selected"
                              : ""
                          }
                          onFocus={(e) => {
                            if (preserveRangeOnFocus.current) {
                              preserveRangeOnFocus.current = false;
                              return;
                            }
                            if (
                              e.target instanceof HTMLSelectElement &&
                              isCellSelected(r.meta.id, "status")
                            )
                              return;
                            activateCell({ id: r.meta.id, column: "status" });
                          }}
                          onMouseDown={(e) => {
                            if (!e.shiftKey) return;
                            e.preventDefault();
                            preserveRangeOnFocus.current = true;
                            activateCell(
                              { id: r.meta.id, column: "status" },
                              true,
                            );
                            e.currentTarget.focus();
                            preserveRangeOnFocus.current = false;
                          }}
                        >
                          <span className="status-cell" data-stage={role}>
                            <StageIcon role={role} />
                            <select
                              className="cell-select status-select"
                              aria-label={`Status of ${r.meta.title}`}
                              value={r.meta.status}
                              onChange={(e) =>
                                void changeSelected(r, "status", e.target.value)
                              }
                            >
                              {ctx.columns.map((c) => (
                                <option value={c.id} key={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </span>
                        </td>
                        <td
                          data-cell-id={r.meta.id}
                          data-cell-column="priority"
                          tabIndex={0}
                          className={
                            isCellSelected(r.meta.id, "priority")
                              ? "cell-selected"
                              : ""
                          }
                          onFocus={(e) => {
                            if (preserveRangeOnFocus.current) {
                              preserveRangeOnFocus.current = false;
                              return;
                            }
                            if (
                              e.target instanceof HTMLSelectElement &&
                              isCellSelected(r.meta.id, "priority")
                            )
                              return;
                            activateCell({ id: r.meta.id, column: "priority" });
                          }}
                          onMouseDown={(e) => {
                            if (!e.shiftKey) return;
                            e.preventDefault();
                            preserveRangeOnFocus.current = true;
                            activateCell(
                              { id: r.meta.id, column: "priority" },
                              true,
                            );
                            e.currentTarget.focus();
                            preserveRangeOnFocus.current = false;
                          }}
                        >
                          <select
                            className="cell-select"
                            aria-label={`Priority of ${r.meta.title}`}
                            value={priorityOf(r)}
                            onChange={(e) =>
                              void changeSelected(
                                r,
                                "priority",
                                Number(e.target.value),
                              )
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
      {pasteFeedback && (
        <p className="table-paste-feedback" role="status">
          {pasteFeedback}
        </p>
      )}
      {!groups.some((g) => g.items.length) && (
        <p className="empty-inline">No tickets match this view.</p>
      )}
    </div>
  );
}
