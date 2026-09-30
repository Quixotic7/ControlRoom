import { TicketDragContext, type DragSession } from "./TicketDrag";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Claim,
  GroupBy,
  ProjectState,
  ProjectView,
  RecordFile,
  SortBy,
} from "../src/types";
import { actor, api } from "./api";
import { BoardView } from "./BoardView";
import {
  BoardIcon,
  ChevronDownIcon,
  CloseIcon,
  PlusIcon,
  ProjectIcon,
  SearchIcon,
  SlidersIcon,
  TableIcon,
} from "./Icons";
import { Menu } from "./Menu";
import {
  groupByOptions,
  groupTickets,
  matches,
  parseFilter,
  priorityOf,
  showsArchived,
  sortOptions,
  sortTickets,
  viewsOf,
  type Context,
} from "./model";
import { TableView } from "./TableView";
import {
  ArchiveTickets,
  ArchivedTickets,
  type ArchiveScope,
} from "./ArchiveTickets";
import { useColumnVisibility } from "./useColumnVisibility";
import { BulkEditBar } from "./BulkEditBar";
import { reconcileSelection } from "./bulkEdit";

const sameView = (a: ProjectView, b: ProjectView) =>
  JSON.stringify(a) === JSON.stringify(b);
const orderOf = (r: RecordFile) => r.meta.order ?? Date.parse(r.meta.createdAt);

export function ProjectPage({
  state,
  ctx,
  viewId,
  setViewId,
  onOpen,
  onNewTicket,
  reload,
  onError,
  onNotice,
}: {
  state: ProjectState;
  ctx: Context;
  viewId: string;
  setViewId: (id: string) => void;
  onOpen: (id: string) => void;
  onNewTicket: () => void;
  reload: () => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const saved = viewsOf(state);
  const savedView = saved.find((v) => v.id === viewId) ?? saved[0];
  const visibility = useColumnVisibility(state.config.projectId, savedView.id);
  const [archiveView, setArchiveView] = useState(false);
  const [archiveScope, setArchiveScope] = useState<ArchiveScope | null>(null);
  const hiddenCount = ctx.columns.filter((c) =>
    visibility.hidden.has(c.id),
  ).length;
  // Unsaved edits per view, like GitHub's "Save changes" on a modified view.
  const [drafts, setDrafts] = useState<Record<string, ProjectView>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const view = drafts[savedView.id] ?? savedView;
  const dirty = !sameView(view, savedView);
  const edit = (patch: Partial<ProjectView>) =>
    setDrafts((d) => ({ ...d, [savedView.id]: { ...view, ...patch } }));
  const discard = () => setDrafts(({ [savedView.id]: _, ...rest }) => rest);

  const viewDrag = useRef<{
    id: string;
    views: ProjectView[];
    revision: string;
  } | null>(null);
  const [dropView, setDropView] = useState<{
    id: string;
    after: boolean;
  } | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  async function saveViews(
    next: ProjectView[],
    activate?: string,
    revision = state.configRevision,
  ) {
    try {
      await api("/config", "PATCH", {
        revision,
        patch: { views: next },
      });
      await reload();
      if (activate) setViewId(activate);
      return true;
    } catch (e) {
      onError(String(e));
      return false;
    }
  }
  async function dropTab(target: string, after: boolean) {
    const drag = viewDrag.current;
    viewDrag.current = null;
    setDropView(null);
    if (!drag || drag.id === target) return;
    const item = drag.views.find((v) => v.id === drag.id)!;
    const next = drag.views.filter((v) => v.id !== drag.id);
    const index = next.findIndex((v) => v.id === target);
    if (index < 0) return;
    next.splice(index + Number(after), 0, item);
    if (next.every((v, i) => v.id === drag.views[i].id)) return;
    setSavingOrder(true);
    try {
      await saveViews(next, undefined, drag.revision);
    } finally {
      setSavingOrder(false);
    }
  }
  const replace = (v: ProjectView) => saved.map((s) => (s.id === v.id ? v : s));
  async function saveDraft() {
    if (await saveViews(replace(view))) discard();
  }
  const uniqueId = (base: string) => {
    const slug =
      base
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "view";
    let id = slug,
      n = 2;
    while (saved.some((v) => v.id === id)) id = `${slug}-${n++}`;
    return id;
  };
  async function addView() {
    const name = `View ${saved.length + 1}`;
    const next: ProjectView = {
      id: uniqueId(name),
      name,
      layout: "table",
      filter: "",
      groupBy: "none",
      sort: "number",
    };
    if (await saveViews([...saved, next], next.id)) setRenaming(next.id);
  }
  async function duplicate(v: ProjectView) {
    const name = `${v.name} copy`;
    const copy = { ...(drafts[v.id] ?? v), id: uniqueId(name), name };
    await saveViews([...saved, copy], copy.id);
  }
  async function remove(v: ProjectView) {
    const next = saved.filter((s) => s.id !== v.id);
    if (await saveViews(next, next[0].id)) discard();
  }
  async function shift(v: ProjectView, by: number) {
    const i = saved.findIndex((s) => s.id === v.id),
      j = i + by;
    if (j < 0 || j >= saved.length) return;
    const next = [...saved];
    [next[i], next[j]] = [next[j], next[i]];
    await saveViews(next);
  }
  async function rename(v: ProjectView, name: string) {
    setRenaming(null);
    if (name.trim() && name.trim() !== v.name)
      await saveViews(replace({ ...v, name: name.trim() }));
  }

  const filter = useMemo(() => parseFilter(view.filter), [view.filter]);
  const withArchived = showsArchived(filter);
  const tickets = useMemo(
    () =>
      state.records.filter(
        (r) => r.meta.kind === "ticket" && (withArchived || !r.meta.archived),
      ),
    [state, withArchived],
  );
  const visible = useMemo(
    () =>
      sortTickets(
        tickets.filter((r) => matches(r, filter, ctx)),
        view.sort,
      ),
    [tickets, filter, ctx, view.sort],
  );
  const filtering = filter.text.length + filter.terms.length > 0;
  const groups = useMemo(
    () =>
      groupTickets(visible, view.groupBy, ctx).filter(
        // Empty groups stay as drop targets, but are noise while filtering.
        (g) =>
          g.items.length ||
          !filtering ||
          (g.record && visible.some((r) => r.meta.id === g.record!.meta.id)),
      ),
    [visible, view.groupBy, ctx, filtering],
  );
  const collapseScope = `${savedView.id}/${view.layout}/${view.groupBy}`;
  const [collapseState, setCollapseState] = useState<{
    scope: string;
    keys: Set<string>;
  }>({ scope: collapseScope, keys: new Set() });
  const collapsed =
    collapseState.scope === collapseScope
      ? collapseState.keys
      : new Set<string>();
  const toggleGroup = (key: string) =>
    setCollapseState((current) => {
      const next = new Set(current.scope === collapseScope ? current.keys : []);
      next.has(key) ? next.delete(key) : next.add(key);
      return { scope: collapseScope, keys: next };
    });
  const selectable = [
    ...new Map(
      groups
        .filter((group) => !collapsed.has(group.key))
        .flatMap((group) => group.items)
        .filter(
          (record) =>
            view.layout !== "board" ||
            !visibility.hidden.has(record.meta.status),
        )
        .map((record) => [record.meta.id, record]),
    ).values(),
  ];
  const selectableIds = new Set(selectable.map((record) => record.meta.id));
  const selectableKey = selectable.map((record) => record.meta.id).join("|");
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setBulkSelected((current) => {
      const next = reconcileSelection(current, selectableIds);
      return next.size === current.size ? current : next;
    });
  }, [selectableKey]);
  const selectedRecords = selectable.filter((record) =>
    bulkSelected.has(record.meta.id),
  );
  const toggleSelected = (id: string, on: boolean) =>
    setBulkSelected((current) => {
      const next = new Set(current);
      on ? next.add(id) : next.delete(id);
      return next;
    });
  const claims = useMemo(
    () => new Map<string, Claim>(state.claims.map((c) => [c.ticket, c])),
    [state.claims],
  );
  const [ticketDrag, setTicketDrag] = useState<DragSession | null>(null);
  useEffect(() => {
    const end = () => setTicketDrag(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
    };
    document.addEventListener("dragend", end);
    document.addEventListener("drop", end);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("dragend", end);
      document.removeEventListener("drop", end);
      document.removeEventListener("keydown", key);
    };
  }, []);
  const canReorder = view.sort === "manual" || view.sort === "priority";

  async function patch(r: RecordFile, fields: Record<string, unknown>) {
    try {
      await api(`/records/${r.meta.id}`, "PATCH", {
        revision: r.revision,
        patch: fields,
        actor,
      });
      await reload();
    } catch (e) {
      onError(String(e));
    }
  }
  const move = (r: RecordFile, status: string) =>
    r.meta.status !== status && void patch(r, { status });
  const setPriority = (r: RecordFile, priority: number) =>
    priorityOf(r) !== priority && void patch(r, { priority });
  // Tickets that share an ordering slot with `target` in this view.
  const peersOf = (target: RecordFile, exclude?: string) =>
    visible.filter(
      (r) =>
        r.meta.id !== exclude &&
        r.meta.status === target.meta.status &&
        (view.sort !== "priority" || priorityOf(r) === priorityOf(target)) &&
        (view.groupBy !== "parent" ||
          (r.meta.parent ?? null) === (target.meta.parent ?? null)),
    );
  const previousPeer = (r: RecordFile) => {
    const peers = peersOf(r);
    return peers[peers.findIndex((p) => p.meta.id === r.meta.id) - 1];
  };
  function place(draggedId: string, target: RecordFile, insertAfter = false) {
    const r = ticketDrag?.records.get(draggedId) ?? ctx.byId.get(draggedId);
    if (!r || r.meta.id === target.meta.id) return;
    const role = ctx.columns.find((c) => c.id === target.meta.status)?.role;
    if (
      !canReorder ||
      (role === "review" && r.meta.status !== target.meta.status)
    ) {
      if (r.meta.status !== target.meta.status) move(r, target.meta.status);
      else if (!canReorder)
        onNotice(
          "Sort this view by Manual order or Priority to reorder by dragging.",
        );
      return;
    }
    if (
      view.groupBy === "parent" &&
      (r.meta.parent ?? null) !== (target.meta.parent ?? null)
    ) {
      onNotice(
        "Change a ticket’s parent in its details to move it between goals.",
      );
      return;
    }
    const peers = peersOf(target, r.meta.id);
    const index = peers.findIndex((p) => p.meta.id === target.meta.id);
    const slot = index + Number(insertAfter);
    const before = slot > 0 ? orderOf(peers[slot - 1]) : orderOf(target) - 1024;
    const after = slot < peers.length ? orderOf(peers[slot]) : before + 1024;
    const expected = peers.map((p) => ({
      id: p.meta.id,
      revision: ticketDrag?.records.get(p.meta.id)?.revision ?? p.revision,
    }));
    if (
      ticketDrag &&
      peers.some(
        (p) => ticketDrag.records.get(p.meta.id)?.revision !== p.revision,
      )
    ) {
      onError(
        "Ticket order changed during this drag. The move was cancelled; review the current board and try again.",
      );
      void reload();
      return;
    }
    void api(`/records/${r.meta.id}/placement`, "POST", {
      revision: r.revision,
      expected,
      actor,
      patch: {
        status: target.meta.status,
        order: (before + after) / 2,
        ...(view.sort === "priority" ? { priority: priorityOf(target) } : {}),
      },
    })
      .then(reload)
      .catch((e) => {
        onError(String(e));
        void reload();
      });
  }

  const groupChoices = (Object.keys(groupByOptions) as GroupBy[]).filter(
    (g) => view.layout === "table" || g !== "status",
  );
  if (archiveView)
    return (
      <ArchivedTickets
        records={state.records}
        columns={ctx.columns}
        onOpen={onOpen}
        reload={reload}
        onBack={() => setArchiveView(false)}
      />
    );
  return (
    <TicketDragContext.Provider
      value={{
        end: () => setTicketDrag(null),
        session: ticketDrag,
        start: (r) =>
          setTicketDrag({
            source: r,
            records: new Map(state.records.map((r) => [r.meta.id, r])),
          }),
        shift: (r, by) => {
          if (!canReorder) return;
          const peers = peersOf(r),
            index = peers.findIndex((p) => p.meta.id === r.meta.id),
            target = peers[index + by];
          if (target) place(r.meta.id, target, by > 0);
        },
        place,
        canPlace: (target) =>
          !!ticketDrag &&
          canReorder &&
          target.meta.id !== ticketDrag.source.meta.id &&
          (view.groupBy !== "parent" ||
            (target.meta.parent ?? null) ===
              (ticketDrag.source.meta.parent ?? null)) &&
          !(
            ctx.columns.find((c) => c.id === target.meta.status)?.role ===
              "review" && ticketDrag.source.meta.status !== target.meta.status
          ),
      }}
    >
      <div className="project-page">
        <h1 className="sr-only">{state.config.name} views</h1>
        <nav className="view-tabs" aria-label="Project views">
          {saved.map((v) => {
            const active = v.id === savedView.id;
            return (
              <div
                key={v.id}
                data-view-id={v.id}
                className={`view-tab ${active ? "active" : ""}${dropView?.id === v.id ? (dropView.after ? " drop-after" : " drop-before") : ""}`}
                onDragOver={(e) => {
                  if (
                    !viewDrag.current ||
                    !e.dataTransfer.types.includes("text/controlroom-view")
                  )
                    return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const bounds = e.currentTarget.getBoundingClientRect();
                  setDropView({
                    id: v.id,
                    after: e.clientX > bounds.x + bounds.width / 2,
                  });
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                    setDropView(null);
                }}
                onDrop={(e) => {
                  if (
                    !viewDrag.current ||
                    !e.dataTransfer.types.includes("text/controlroom-view")
                  )
                    return;
                  e.preventDefault();
                  e.stopPropagation();
                  const bounds = e.currentTarget.getBoundingClientRect();
                  void dropTab(v.id, e.clientX > bounds.x + bounds.width / 2);
                }}
              >
                {renaming === v.id ? (
                  <input
                    autoFocus
                    aria-label="View name"
                    defaultValue={v.name}
                    maxLength={60}
                    onBlur={(e) => void rename(v, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <button
                    draggable={!savingOrder}
                    title="Drag to reorder; use the options menu to move with the keyboard"
                    onDragStart={(e) => {
                      viewDrag.current = {
                        id: v.id,
                        views: saved,
                        revision: state.configRevision,
                      };
                      e.dataTransfer.setData("text/controlroom-view", v.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      viewDrag.current = null;
                      setDropView(null);
                    }}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setViewId(v.id)}
                    onDoubleClick={() => setRenaming(v.id)}
                  >
                    <span className="layout-icon" aria-hidden>
                      {(drafts[v.id] ?? v).layout === "board" ? (
                        <BoardIcon />
                      ) : (
                        <TableIcon />
                      )}
                    </span>
                    {v.name}
                    <span
                      className={
                        drafts[v.id] && !sameView(drafts[v.id], v)
                          ? "unsaved-dot"
                          : "unsaved-dot-placeholder"
                      }
                      style={{
                        visibility:
                          drafts[v.id] && !sameView(drafts[v.id], v)
                            ? "visible"
                            : "hidden",
                      }}
                      title={
                        drafts[v.id] && !sameView(drafts[v.id], v)
                          ? "Unsaved changes"
                          : undefined
                      }
                      aria-hidden="true"
                    />
                  </button>
                )}
                {active && renaming !== v.id ? (
                  <Menu
                    label={<span aria-hidden="true">⋯</span>}
                    escapeClipping
                    ariaLabel={`Options for ${v.name} view`}
                    className="tab-menu-button"
                  >
                    {(close) => (
                      <div className="menu-list">
                        <button
                          onClick={() => {
                            close();
                            setRenaming(v.id);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => {
                            close();
                            void duplicate(v);
                          }}
                        >
                          Duplicate
                        </button>
                        <button
                          disabled={saved[0].id === v.id}
                          onClick={() => {
                            close();
                            void shift(v, -1);
                          }}
                        >
                          Move left
                        </button>
                        <button
                          disabled={saved[saved.length - 1].id === v.id}
                          onClick={() => {
                            close();
                            void shift(v, 1);
                          }}
                        >
                          Move right
                        </button>
                        <button
                          className="danger"
                          disabled={saved.length < 2}
                          onClick={() => {
                            close();
                            void remove(v);
                          }}
                        >
                          Delete view
                        </button>
                      </div>
                    )}
                  </Menu>
                ) : (
                  <span className="tab-menu-placeholder" aria-hidden="true" />
                )}
              </div>
            );
          })}
          <button className="new-view" onClick={() => void addView()}>
            <PlusIcon />
            New view
          </button>
        </nav>
        <div className="filter-bar">
          <label className="filter-input">
            <span aria-hidden>
              <SearchIcon />
            </span>
            <input
              aria-label="Filter tickets"
              placeholder="Filter by keyword or by field, e.g. label:ui is:blocked -status:done"
              value={view.filter}
              onChange={(e) => edit({ filter: e.target.value })}
            />
            {view.filter && (
              <button
                className="icon-button"
                aria-label="Clear filter"
                onClick={() => edit({ filter: "" })}
              >
                <CloseIcon />
              </button>
            )}
          </label>
          {dirty && (
            <div className="inline-actions">
              <button className="button subtle" onClick={discard}>
                Discard
              </button>
              <button
                className="button primary"
                onClick={() => void saveDraft()}
              >
                Save view
              </button>
            </div>
          )}
          <Menu
            label={
              <>
                <SlidersIcon />
                View
              </>
            }
            ariaLabel="View options"
            align="end"
          >
            <div className="view-options">
              <span className="menu-label">Layout</span>
              <div className="segmented">
                {(["board", "table"] as const).map((layout) => (
                  <button
                    key={layout}
                    aria-pressed={view.layout === layout}
                    className={view.layout === layout ? "selected" : ""}
                    onClick={() =>
                      edit({
                        layout,
                        groupBy:
                          layout === "board" && view.groupBy === "status"
                            ? "none"
                            : view.groupBy,
                      })
                    }
                  >
                    {layout === "board" ? <BoardIcon /> : <TableIcon />}
                    {layout === "board" ? "Board" : "Table"}
                  </button>
                ))}
              </div>
              <label className="field">
                Group by
                <select
                  value={view.groupBy}
                  onChange={(e) => edit({ groupBy: e.target.value as GroupBy })}
                >
                  {groupChoices.map((g) => (
                    <option key={g} value={g}>
                      {groupByOptions[g]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Sort by
                <select
                  value={view.sort}
                  onChange={(e) => edit({ sort: e.target.value as SortBy })}
                >
                  {(Object.keys(sortOptions) as SortBy[]).map((s) => (
                    <option key={s} value={s}>
                      {sortOptions[s]}
                    </option>
                  ))}
                </select>
              </label>
              <p className="help">
                Filter keys: status, label, owner, priority, parent, is:blocked,
                is:claimed, is:open, is:archived, no:owner. Prefix with - to
                exclude.
              </p>
            </div>
          </Menu>
          <button
            className="button subtle"
            onClick={() => setArchiveView(true)}
          >
            Archived tickets
          </button>
        </div>
        {view.layout === "board" && hiddenCount > 0 && (
          <div className="column-visibility-bar" role="status">
            <span>
              {hiddenCount}{" "}
              {hiddenCount === 1 ? "column hidden" : "columns hidden"}. Header
              counts include hidden tickets.
            </span>
            <button className="text-button" onClick={visibility.showAll}>
              Show all columns
            </button>
          </div>
        )}
        {visibility.error && (
          <p className="banner error" role="alert">
            {visibility.error}
          </p>
        )}
        {!!tickets.length && (
          <BulkEditBar
            selected={selectedRecords}
            visibleCount={selectable.length}
            records={state.records}
            columns={ctx.columns}
            disabled={state.branchChanged}
            onSelectAll={() => setBulkSelected(new Set(selectableIds))}
            onClear={() => setBulkSelected(new Set())}
            onKeepSelected={setBulkSelected}
            reload={reload}
          />
        )}
        {!tickets.length ? (
          <div className="empty-state">
            <span className="empty-icon">
              <ProjectIcon />
            </span>
            <h2>Your next chapter starts here</h2>
            <p>
              Use “Add item” under any column, or create a ticket with details.
            </p>
            <button className="button primary" onClick={onNewTicket}>
              Create a ticket
            </button>
          </div>
        ) : null}
        {view.layout === "board" ? (
          <BoardView
            groups={groups}
            groupBy={view.groupBy}
            ctx={ctx}
            claims={claims}
            visible={visible}
            onOpen={onOpen}
            onMove={move}
            onPlace={place}
            reload={reload}
            hidden={visibility.hidden}
            onToggleColumn={visibility.toggle}
            writesDisabled={state.branchChanged}
            collapsed={collapsed}
            onToggleGroup={toggleGroup}
            selected={bulkSelected}
            onToggleSelected={toggleSelected}
            onArchive={(column, records) =>
              setArchiveScope({
                column: column.name,
                filter: view.filter,
                view: view.name,
                records,
              })
            }
          />
        ) : (
          <TableView
            groups={groups}
            groupBy={view.groupBy}
            ctx={ctx}
            claims={claims}
            canReorder={canReorder}
            previousPeer={previousPeer}
            collapsed={collapsed}
            onToggleGroup={toggleGroup}
            selected={bulkSelected}
            onToggleSelected={toggleSelected}
            onSelectVisible={(on) =>
              setBulkSelected(on ? new Set(selectableIds) : new Set())
            }
            onOpen={onOpen}
            onMove={move}
            onPriority={setPriority}
            onPlace={place}
            reload={reload}
          />
        )}
        {!!tickets.length && !visible.length && (
          <p className="empty-inline">
            No tickets match “{view.filter}”.{" "}
            <button
              className="text-button"
              onClick={() => edit({ filter: "" })}
            >
              Clear filter
            </button>
          </p>
        )}
        {archiveScope && (
          <ArchiveTickets
            scope={archiveScope}
            onClose={() => setArchiveScope(null)}
            reload={reload}
          />
        )}
      </div>
    </TicketDragContext.Provider>
  );
}
