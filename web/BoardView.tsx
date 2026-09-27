import { ticketNavigation } from "./ticketNavigation";
import React, { useState } from "react";
import type { Claim, GroupBy, RecordFile } from "../src/types";
import { recordId } from "./api";
import { ChevronDownIcon, ChevronRightIcon, StageIcon } from "./Icons";
import type { Context, Group } from "./model";
import { QuickTicket } from "./QuickTicket";
import { dragType, TicketCard } from "./TicketCard";

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
  onPlace,
  reload,
}: {
  groups: Group[];
  groupBy: GroupBy;
  ctx: Context;
  claims: Map<string, Claim>;
  // Every ticket shown, for column counts (label groups can repeat a ticket).
  visible: RecordFile[];
  onOpen: (id: string) => void;
  onMove: (record: RecordFile, status: string) => void;
  onPlace: (draggedId: string, target: RecordFile) => void;
  reload: () => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // The cell a dragged card is currently over, for the drop highlight.
  const [over, setOver] = useState<string | null>(null);
  // The one card in the Tab order (as "group/ticket", since label groups can
  // repeat a ticket); arrows move focus between the others.
  const [focused, setFocused] = useState<string | null>(null);
  const columnIds = ctx.columns.map((c) => c.id);
  const shown = groups
    .filter((g) => !collapsed.has(g.key))
    .flatMap((g) => g.items.map((r) => `${g.key}/${r.meta.id}`));
  const tabStop = focused && shown.includes(focused) ? focused : shown[0];
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(cardSelector);
    if (!card || e.metaKey || e.ctrlKey || e.altKey) return;
    const next = nextCard(e.currentTarget, card, e.key, columnIds);
    if (!next) {
      if (e.key.startsWith("Arrow")) e.preventDefault();
      return;
    }
    e.preventDefault();
    next.focus();
    next.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const lanes = groupBy === "none";
  return (
    <div className="board-scroll">
      <div
        className={`board${lanes ? " lanes" : ""}`}
        style={{ "--columns": ctx.columns.length } as React.CSSProperties}
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
            <div key={c.id} className="column-head" data-stage={c.role}>
              <StageIcon role={c.role} size={16} />
              <strong>{c.name}</strong>
              <span className="count">
                {visible.filter((r) => r.meta.status === c.id).length}
              </span>
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
                onToggle={() => toggle(g.key)}
                onOpen={onOpen}
              />
            )}
            {!collapsed.has(g.key) && (
              <div className="board-row">
                {ctx.columns.map((c) => {
                  const cell = `${g.key}/${c.id}`;
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
                        if (over !== cell) setOver(cell);
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node))
                          setOver(null);
                      }}
                      onDrop={(e) => {
                        setOver(null);
                        const id = e.dataTransfer.getData(dragType);
                        const r = ctx.byId.get(id);
                        if (r) {
                          e.preventDefault();
                          onMove(r, c.id);
                        }
                      }}
                    >
                      {g.items
                        .filter((r) => r.meta.status === c.id)
                        .map((r) => (
                          <div
                            key={r.meta.id}
                            className={
                              g.record && r.meta.parent !== g.record.meta.id
                                ? "nested-ticket"
                                : undefined
                            }
                          >
                            <TicketCard
                              record={r}
                              ctx={ctx}
                              claim={claims.get(r.meta.id)}
                              showParent={
                                !g.record || r.meta.parent !== g.record.meta.id
                              }
                              tabIndex={
                                `${g.key}/${r.meta.id}` === tabStop ? 0 : -1
                              }
                              onOpen={onOpen}
                              onDropCard={onPlace}
                            />
                          </div>
                        ))}
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
