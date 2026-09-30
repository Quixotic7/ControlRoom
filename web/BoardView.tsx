import { ticketNavigation } from "./ticketNavigation";
import React, { useState } from "react";
import type { Claim, Column, GroupBy, RecordFile } from "../src/types";
import { recordId } from "./api";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  KebabIcon,
  StageIcon,
} from "./Icons";
import { Menu } from "./Menu";
import type { Context, Group } from "./model";
import { QuickTicket } from "./QuickTicket";
import { dragType, TicketCard } from "./TicketCard";
import { TicketProgress } from "./TicketProgress";
import { useTicketDragContext } from "./TicketDrag";

const boardSlot = (group: string, column: string, id: string) =>
  `board/${group}/${column}/${id}`;

function TicketDropGap({
  active,
  edge,
  slot,
  suppressed,
}: {
  active: boolean;
  edge?: "start" | "end";
  slot: string;
  suppressed?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={`ticket-drop-gap${active ? " active" : ""}${edge ? ` edge-${edge}` : ""}${suppressed ? " suppressed" : ""}`}
      data-ticket-drop-slot={slot}
    />
  );
}

export function GroupHeader({
  group,
  groupBy,
  ctx,
  collapsed,
  onToggle,
  onOpen,
}: {
  group: Group;
  groupBy: GroupBy;
  ctx: Context;
  collapsed: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
}) {
  const goal = group.record;
  const column = goal && ctx.columns.find((c) => c.id === goal.meta.status);
  return (
    <div className="group-header">
      <button
        className="group-toggle"
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.title}`}
        onClick={onToggle}
      >
        {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
      </button>
      {goal ? (
        <button
          className="group-goal"
          {...ticketNavigation(goal.meta.id, onOpen)}
        >
          <strong>{group.title}</strong>
          <span className="record-id">{recordId(goal)}</span>
        </button>
      ) : (
        <strong className={groupBy === "label" ? "tag" : undefined}>
          {group.title}
        </strong>
      )}
      <span className="count">{group.items.length}</span>
      {goal && column && (
        <span className="stage-pill" data-stage={column.role}>
          <StageIcon role={column.role} />
          {column.name}
        </span>
      )}
      {goal?.meta.scopeApproved && (
        <span className="tag green">Approved scope</span>
      )}
      {goal?.meta.archived && <span className="tag">Archived parent</span>}
      {goal && <TicketProgress record={goal} ctx={ctx} compact continuous />}
    </div>
  );
}

const cardSelector = "button.ticket-card";
const cellOf = (card: Element) => card.closest<HTMLElement>(".board-cell");
const columnOf = (card: Element) => cellOf(card)?.dataset.column ?? "";
const groupOf = (card: Element) => cellOf(card)?.dataset.group ?? "";
const middle = (el: Element) => {
  const box = el.getBoundingClientRect();
  return box.top + box.height / 2;
};
// The card an arrow key should move focus to, or null to stay put. Left and
// right look for the nearest card in the next non-empty column, preferring
// the same swimlane; up and down walk the column across swimlanes.
export function nextCard(
  board: HTMLElement,
  from: HTMLElement,
  key: string,
  columns: string[],
): HTMLElement | null {
  const cards = Array.from(board.querySelectorAll<HTMLElement>(cardSelector));
  if (key === "ArrowUp" || key === "ArrowDown") {
    const column = cards.filter((c) => columnOf(c) === columnOf(from));
    const i = column.indexOf(from);
    return column[key === "ArrowUp" ? i - 1 : i + 1] ?? null;
  }
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const step = key === "ArrowLeft" ? -1 : 1;
  let index = columns.indexOf(columnOf(from)) + step;
  while (index >= 0 && index < columns.length) {
    const column = cards.filter((c) => columnOf(c) === columns[index]);
    if (column.length) {
      const lane = column.filter((c) => groupOf(c) === groupOf(from));
      const candidates = lane.length ? lane : column;
      const y = middle(from);
      return candidates.reduce((best, c) =>
        Math.abs(middle(c) - y) < Math.abs(middle(best) - y) ? c : best,
      );
    }
    index += step;
  }
  return null;
}

export function BoardView({
  groups,
  groupBy,
  ctx,
  claims,
  visible,
  onOpen,
  onMove,
  reload,
  hidden,
  onToggleColumn,
  onArchive,
  writesDisabled,
  collapsed,
  onToggleGroup,
  selected,
  onSelectRange,
  onToggleSelected,
}: {
  groups: Group[];
  groupBy: GroupBy;
  ctx: Context;
  claims: Map<string, Claim>;
  // Every ticket shown, for column counts (label groups can repeat a ticket).
  visible: RecordFile[];
  onOpen: (id: string) => void;
  onMove: (record: RecordFile, status: string) => void;
  reload: () => Promise<void>;
  hidden: Set<string>;
  onToggleColumn: (id: string) => void;
  onArchive: (column: Column, records: RecordFile[]) => void;
  writesDisabled: boolean;
  collapsed: Set<string>;
  onToggleGroup: (key: string) => void;
  selected: Set<string>;
  onSelectRange: (ids: string[]) => void;
  onToggleSelected: (id: string, on: boolean) => void;
}) {
  const ticketDrag = useTicketDragContext();
  // The cell a dragged card is currently over, for the drop highlight.
  const [over, setOver] = useState<string | null>(null);
  // The one card in the Tab order (as "group/ticket", since label groups can
  // repeat a ticket); arrows move focus between the others.
  const [focused, setFocused] = useState<string | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const columnIds = ctx.columns
    .filter((c) => !hidden.has(c.id))
    .map((c) => c.id);
  const shown = groups
    .filter((g) => !collapsed.has(g.key))
    .flatMap((g) =>
      g.items
        .filter((r) => !hidden.has(r.meta.status))
        .map((r) => `${g.key}/${r.meta.id}`),
    );
  const archiveCandidates = (column: Column) => {
    if (hidden.has(column.id)) return [];
    const matching = new Set(visible.map((r) => r.meta.id));
    return [
      ...new Map(
        groups
          .filter((g) => !collapsed.has(g.key))
          .flatMap((g) => [
            ...g.items,
            ...(g.record && matching.has(g.record.meta.id) ? [g.record] : []),
          ])
          .filter((r) => r.meta.status === column.id && !r.meta.archived)
          .map((r) => [r.meta.id, r]),
      ).values(),
    ];
  };
  const tabStop = focused && shown.includes(focused) ? focused : shown[0];
  const shiftSelect = (id: string, originId?: string) => {
    const ids = [...new Set(shown.map((key) => key.split("/").at(-1)!))];
    const anchor =
      selectionAnchor && ids.includes(selectionAnchor)
        ? selectionAnchor
        : originId && ids.includes(originId)
          ? originId
          : id;
    const start = ids.indexOf(anchor);
    const end = ids.indexOf(id);
    if (start < 0 || end < 0) return;
    onSelectRange(ids.slice(Math.min(start, end), Math.max(start, end) + 1));
    setSelectionAnchor(anchor);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(cardSelector);
    if (e.key === "Escape") {
      setSelectionAnchor(null);
      return;
    }
    if (!card || e.metaKey || e.ctrlKey || e.altKey) return;
    const next = nextCard(e.currentTarget, card, e.key, columnIds);
    if (!next) {
      if (e.key.startsWith("Arrow")) e.preventDefault();
      return;
    }
    e.preventDefault();
    next.focus();
    next.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (e.shiftKey) shiftSelect(next.dataset.id!, card.dataset.id);
  };
  const lanes = groupBy === "none";
  return (
    <div className="board-scroll">
      <div
        className={`board${lanes ? " lanes" : ""}`}
        style={
          {
            "--column-tracks": ctx.columns.map(() => "var(--column)").join(" "),
          } as React.CSSProperties
        }
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          const card = (e.target as HTMLElement).closest<HTMLElement>(
            cardSelector,
          );
          if (!card) return;
          const key = `${groupOf(card)}/${card.dataset.id}`;
          if (key !== focused) setFocused(key);
        }}
      >
        <div className="board-head">
          {ctx.columns.map((c) => (
            <div
              key={c.id}
              className={`column-head${hidden.has(c.id) ? " hidden-column" : ""}`}
              data-column={c.id}
              data-stage={c.role}
            >
              <StageIcon role={c.role} size={16} />
              <strong title={c.name}>{c.name}</strong>
              <span
                className="count"
                title="Tickets matching this view, including collapsed groups"
              >
                {visible.filter((r) => r.meta.status === c.id).length}
              </span>
              <button
                className="icon-button"
                aria-label={`${hidden.has(c.id) ? "Show" : "Hide"} ${c.name} column`}
                aria-pressed={!hidden.has(c.id)}
                title={hidden.has(c.id) ? "Show tickets" : "Hide tickets"}
                onClick={() => onToggleColumn(c.id)}
              >
                <EyeIcon hidden={hidden.has(c.id)} />
              </button>
              {hidden.has(c.id) && (
                <span className="column-hidden-label">Hidden</span>
              )}
              {c.role === "done" && !hidden.has(c.id) && (
                <Menu
                  label={<KebabIcon />}
                  className="icon-button"
                  ariaLabel={`Options for ${c.name} column`}
                  escapeClipping
                  align="end"
                >
                  {(close) => (
                    <div className="menu-list">
                      <button
                        disabled={writesDisabled}
                        onClick={() => {
                          close();
                          onArchive(c, archiveCandidates(c));
                        }}
                      >
                        Archive completed tickets…
                      </button>
                    </div>
                  )}
                </Menu>
              )}
            </div>
          ))}
        </div>
        {groups.map((g) => (
          <section className="board-group" key={g.key}>
            {groupBy !== "none" && (
              <GroupHeader
                group={g}
                groupBy={groupBy}
                ctx={ctx}
                collapsed={collapsed.has(g.key)}
                onToggle={() => onToggleGroup(g.key)}
                onOpen={onOpen}
              />
            )}
            {!collapsed.has(g.key) && (
              <div className="board-row">
                {ctx.columns.map((c) => {
                  const cell = `${g.key}/${c.id}`;
                  const items = g.items.filter((r) => r.meta.status === c.id);
                  const slotPrefix = boardSlot(g.key, c.id, "");
                  const preview = ticketDrag?.session?.preview;
                  const sourceId = ticketDrag?.session?.source.meta.id;
                  // Collapse only after native drag startup reaches a drop target.
                  // Hiding the source during dragstart can cancel the browser drag.
                  const firstVisible = items.find(
                    (item) => item.meta.id !== sourceId,
                  )?.meta.id;
                  if (hidden.has(c.id))
                    return (
                      <div
                        key={c.id}
                        className="hidden-column-space"
                        aria-hidden="true"
                      />
                    );
                  return (
                    <div
                      className={`board-cell${over === cell ? " drop-target" : ""}`}
                      data-stage={c.role}
                      data-column={c.id}
                      data-group={g.key}
                      key={c.id}
                      onDragOver={(e) => {
                        if (!e.dataTransfer.types.includes(dragType)) return;
                        e.preventDefault();
                        const candidates = Array.from(
                          e.currentTarget.querySelectorAll<HTMLElement>(
                            ".board-ticket[data-id]",
                          ),
                        ).filter((card) => {
                          const record = items.find(
                            (item) => item.meta.id === card.dataset.id,
                          );
                          return record && ticketDrag?.canPlace(record);
                        });
                        const next = candidates.find((card) => {
                          const box = card.getBoundingClientRect();
                          return e.clientY < box.top + box.height / 2;
                        });
                        const card = next ?? candidates.at(-1);
                        const target = items.find(
                          (item) => item.meta.id === card?.dataset.id,
                        );
                        if (target && ticketDrag) {
                          const after = !next;
                          ticketDrag.previewAt(
                            target,
                            after,
                            boardSlot(
                              g.key,
                              c.id,
                              after ? "$end" : target.meta.id,
                            ),
                          );
                          e.dataTransfer.dropEffect = "move";
                        } else {
                          ticketDrag?.clearPreview();
                          e.dataTransfer.dropEffect =
                            ticketDrag?.session?.source.meta.status !== c.id
                              ? "move"
                              : "none";
                        }
                        if (over !== cell) setOver(cell);
                      }}
                      onDragLeave={(e) => {
                        if (
                          !e.currentTarget.contains(e.relatedTarget as Node)
                        ) {
                          setOver(null);
                          ticketDrag?.clearPreview();
                        }
                      }}
                      onDrop={(e) => {
                        setOver(null);
                        if (
                          ticketDrag?.session?.preview?.slot.startsWith(
                            slotPrefix,
                          )
                        ) {
                          e.preventDefault();
                          e.stopPropagation();
                          ticketDrag.commit();
                          return;
                        }
                        const droppedOnTicket =
                          e.target instanceof Element &&
                          e.target.closest(".board-ticket[data-id]");
                        if (ticketDrag?.session && droppedOnTicket) {
                          e.preventDefault();
                          e.stopPropagation();
                          ticketDrag.end();
                          return;
                        }
                        const id = e.dataTransfer.getData(dragType);
                        const r = ctx.byId.get(id);
                        if (r) {
                          e.preventDefault();
                          onMove(r, c.id);
                        }
                      }}
                    >
                      <div className="board-ticket-list">
                        {items.map((r) => {
                          const slot = boardSlot(g.key, c.id, r.meta.id);
                          return (
                            <React.Fragment key={r.meta.id}>
                              <TicketDropGap
                                active={preview?.slot === slot}
                                edge={
                                  r.meta.id === firstVisible
                                    ? "start"
                                    : undefined
                                }
                                slot={slot}
                                suppressed={r.meta.id === sourceId}
                              />
                              <div
                                data-id={r.meta.id}
                                className={`board-ticket${r.meta.id === sourceId && preview ? " drag-source" : ""}${selected.has(r.meta.id) ? " selected" : ""}${
                                  g.record && r.meta.parent !== g.record.meta.id
                                    ? " nested-ticket"
                                    : ""
                                }`}
                              >
                                <TicketCard
                                  record={r}
                                  ctx={ctx}
                                  claim={claims.get(r.meta.id)}
                                  showParent={
                                    !g.record ||
                                    r.meta.parent !== g.record.meta.id
                                  }
                                  tabIndex={
                                    `${g.key}/${r.meta.id}` === tabStop ? 0 : -1
                                  }
                                  onOpen={onOpen}
                                  onShiftSelect={() => {
                                    onToggleSelected(
                                      r.meta.id,
                                      !selected.has(r.meta.id),
                                    );
                                    setSelectionAnchor(r.meta.id);
                                  }}
                                />
                              </div>
                            </React.Fragment>
                          );
                        })}
                        {!!items.length && (
                          <TicketDropGap
                            active={
                              preview?.slot === boardSlot(g.key, c.id, "$end")
                            }
                            edge="end"
                            slot={boardSlot(g.key, c.id, "$end")}
                          />
                        )}
                      </div>
                      <QuickTicket
                        lane={
                          groupBy === "none" ? c.name : `${g.title} / ${c.name}`
                        }
                        status={c.id}
                        defaults={g.defaults}
                        onCreated={reload}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
