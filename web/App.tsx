import React, { useCallback, useEffect, useState } from "react";
import type { Kind, ProjectState, RecordFile } from "../src/types";
import { api, actor, ago, recordId, uploadImage } from "./api";
import { RecordDetail } from "./RecordDetail";
import { AnnotationEditor } from "./AnnotationEditor";
import { Settings } from "./Settings";
import { Imports } from "./Imports";
import { Screenshots } from "./Screenshots";
import { Shortcuts } from "./Shortcuts";
import { QuickTicket } from "./QuickTicket";

type View =
  | "board"
  | "list"
  | "attention"
  | "decisions"
  | "rulebook"
  | "imports"
  | "screenshots"
  | "settings";
const titles: Record<View, string> = {
  board: "Project board",
  list: "All tickets",
  attention: "Needs your attention",
  decisions: "Project decisions",
  rulebook: "UI rulebook",
  imports: "Bring your context together",
  settings: "Project settings",
  screenshots: "Screenshots",
};
function initialView(): View {
  const v = localStorage.getItem("wb-view");
  return v && Object.hasOwn(titles, v) ? (v as View) : "board";
}
export function App() {
  const [state, setState] = useState<ProjectState | null>(null),
    [view, setView] = useState<View>(initialView),
    [density, setDensity] = useState(
      localStorage.getItem("wb-density") ?? "comfortable",
    );
  const [search, setSearch] = useState(""),
    [label, setLabel] = useState(""),
    [owner, setOwner] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [creating, setCreating] = useState<Kind | null>(null),
    [image, setImage] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [shortcuts, setShortcuts] = useState(false);
  const [prefsReady, setPrefsReady] = useState(false),
    [knowledgeRead, setKnowledgeRead] = useState(0);
  useEffect(() => {
    let active = true;
    api("/preferences")
      .then((p) => {
        if (!active) return;
        if (Object.hasOwn(titles, p.view)) setView(p.view);
        if (["compact", "comfortable"].includes(p.density))
          setDensity(p.density);
        if (p.selected) setSelected(p.selected);
        setKnowledgeRead(p.knowledgeRead ?? 0);
        setPrefsReady(true);
      })
      .catch(() => {
        if (active) setPrefsReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (prefsReady)
      api("/preferences", "PATCH", {
        view,
        density,
        selected,
        knowledgeRead,
      }).catch(() => {});
  }, [view, density, selected, knowledgeRead, prefsReady]);
  const reload = useCallback(async () => {
    try {
      const next = await api<ProjectState>("/state");
      setState(next);
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => {
    reload();
    const events = new EventSource("/api/events");
    events.onmessage = () => reload();
    const interval = setInterval(reload, 5000);
    const active = () => {
      if (document.visibilityState === "visible")
        api("/active", "POST", {}).catch(() => {});
    };
    active();
    window.addEventListener("focus", active);
    document.addEventListener("visibilitychange", active);
    return () => {
      events.close();
      clearInterval(interval);
      window.removeEventListener("focus", active);
      document.removeEventListener("visibilitychange", active);
    };
  }, [reload]);
  useEffect(() => {
    localStorage.setItem("wb-view", view);
  }, [view]);
  useEffect(() => {
    localStorage.setItem("wb-density", density);
  }, [density]);
  useEffect(() => {
    const change = () => {
      const match = location.hash.match(/^#image=([\w-]+)$/);
      if (match) setImage(match[1]);
    };
    change();
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  async function upload(file: File) {
    // Opening another image would replace the editor and its unsaved marks.
    if (document.querySelector(".annotation-dialog[open]")) return;
    try {
      const a = await uploadImage(file);
      await reload();
      setImage(a.id);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) =>
        f.type.startsWith("image/"),
      );
      if (file) {
        e.preventDefault();
        upload(file);
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [reload]);
  async function move(r: RecordFile, status: string) {
    if (r.meta.status === status) return;
    try {
      await api(`/records/${r.meta.id}`, "PATCH", {
        revision: r.revision,
        patch: { status },
        actor,
      });
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }
  if (!state || !prefsReady)
    return (
      <main className="loading">
        <div className="brandmark">CR</div>
        <h1>Opening your workspace</h1>
        {error ? <p role="alert">{error}</p> : <p>Reading project records…</p>}
      </main>
    );
  const tickets = state.records.filter(
      (r) => r.meta.kind === "ticket" && !r.meta.archived,
    ),
    docs = state.records.filter((r) => r.meta.kind !== "ticket");
  const ruleChanged = (ticket: RecordFile) => {
    const labels = new Set(ticket.meta.labels ?? []);
    let parent = ticket.meta.parent;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const record = state.records.find((r) => r.meta.id === parent);
      record?.meta.labels?.forEach((label) => labels.add(label));
      parent = record?.meta.parent;
    }
    return (
      Object.entries(ticket.meta.reviewedRules ?? {}).some(
        ([id, revision]) =>
          state.records.find((r) => r.meta.id === id)?.revision !== revision,
      ) ||
      docs.some(
        (rule) =>
          rule.meta.kind === "rule" &&
          rule.meta.status === "active" &&
          !docs.some(
            (n) =>
              n.meta.kind === "rule" &&
              n.meta.status === "active" &&
              n.meta.supersedes === rule.meta.id,
          ) &&
          (!rule.meta.scope?.length ||
            rule.meta.scope.includes("*") ||
            rule.meta.scope.some((s) => labels.has(s)) ||
            ticket.meta.rules?.includes(rule.meta.id)) &&
          ticket.meta.reviewedRules?.[rule.meta.id] !== rule.revision,
      )
    );
  };
  const attention = tickets.filter(
    (r) =>
      r.meta.blocked ||
      state.config.columns.find((c) => c.id === r.meta.status)?.role ===
        "review" ||
      state.comments.some(
        (c) => c.ticket === r.meta.id && c.kind === "question" && !c.resolved,
      ) ||
      (ruleChanged(r) &&
        state.config.columns.find((c) => c.id === r.meta.status)?.role !==
          "done"),
  );
  const changedDocs = docs.filter(
    (r) => Date.parse(r.meta.updatedAt) > knowledgeRead,
  );
  const filtered = tickets
    .filter(
      (r) =>
        (!search ||
          `${r.meta.title} ${r.body} ${r.meta.id} #${r.meta.number} ${(r.meta.labels ?? []).join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase())) &&
        (!label || r.meta.labels?.includes(label)) &&
        (!owner || r.meta.owner === owner),
    )
    .sort(
      (a, b) =>
        (a.meta.priority ?? 2) - (b.meta.priority ?? 2) ||
        (a.meta.order ?? Date.parse(a.meta.createdAt)) -
          (b.meta.order ?? Date.parse(b.meta.createdAt)),
    );
  const groups = new Map<string, RecordFile[]>();
  for (const t of filtered) {
    let p = t.meta.parent;
    const seen = new Set<string>();
    while (p && !seen.has(p)) {
      seen.add(p);
      const next = tickets.find((r) => r.meta.id === p)?.meta.parent;
      if (!next) break;
      p = next;
    }
    const key =
      p ??
      (tickets.some((r) => r.meta.parent === t.meta.id)
        ? t.meta.id
        : "unparented");
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  if (!groups.has("unparented")) groups.set("unparented", []);
  const laneName = (id: string) =>
    id === "unparented"
      ? "Ungrouped work"
      : (tickets.find((t) => t.meta.id === id)?.meta.title ??
        "Parent unavailable");
  const orderedChildren = (items: RecordFile[], root: string) => {
    const result: RecordFile[] = [],
      seen = new Set<string>();
    const visit = (ticket: RecordFile) => {
      if (seen.has(ticket.meta.id)) return;
      seen.add(ticket.meta.id);
      result.push(ticket);
      items
        .filter((child) => child.meta.parent === ticket.meta.id)
        .forEach(visit);
    };
    items
      .filter((t) => !items.some((p) => p.meta.id === t.meta.parent))
      .forEach(visit);
    items.forEach(visit);
    return result.filter((t) => t.meta.id !== root);
  };
  const labels = [
      ...new Set(tickets.flatMap((t) => t.meta.labels ?? [])),
    ].sort(),
    owners = [
      ...new Set(tickets.map((t) => t.meta.owner).filter(Boolean)),
    ] as string[];
  const active = selected
    ? state.records.find((r) => r.meta.id === selected)
    : null;
  const previousPeer = (record: RecordFile) =>
    filtered
      .slice(0, filtered.indexOf(record))
      .reverse()
      .find(
        (r) =>
          r.meta.status === record.meta.status &&
          (r.meta.parent ?? null) === (record.meta.parent ?? null) &&
          (r.meta.priority ?? 2) === (record.meta.priority ?? 2),
      );
  async function placeBefore(record: RecordFile, target: RecordFile) {
    if (record.meta.id === target.meta.id) return;
    if ((record.meta.parent ?? null) !== (target.meta.parent ?? null)) {
      setNotice(
        "Change a ticket’s parent in its details to move it between goals.",
      );
      return;
    }
    if (
      target.meta.status !== record.meta.status &&
      state!.config.columns.find((c) => c.id === target.meta.status)?.role ===
        "review"
    ) {
      await move(record, target.meta.status);
      return;
    }
    const peers = filtered.filter(
      (r) =>
        r.meta.id !== record.meta.id &&
        r.meta.status === target.meta.status &&
        (r.meta.parent ?? null) === (target.meta.parent ?? null) &&
        (r.meta.priority ?? 2) === (target.meta.priority ?? 2),
    );
    const index = peers.findIndex((r) => r.meta.id === target.meta.id);
    const after = target.meta.order ?? Date.parse(target.meta.createdAt);
    const before =
      index > 0
        ? (peers[index - 1].meta.order ??
          Date.parse(peers[index - 1].meta.createdAt))
        : after - 1024;
    try {
      await api(`/records/${record.meta.id}`, "PATCH", {
        revision: record.revision,
        patch: {
          status: target.meta.status,
          priority: target.meta.priority ?? 2,
          order: (before + after) / 2,
        },
        actor,
      });
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }
  const card = (r: RecordFile) => (
    <button
      key={r.meta.id}
      className="ticket-card"
      data-stage={
        state.config.columns.find((c) => c.id === r.meta.status)?.role
      }
      draggable
      onDragStart={(e) =>
        e.dataTransfer.setData("text/workboard-ticket", r.meta.id)
      }
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("text/workboard-ticket");
        const source = tickets.find((t) => t.meta.id === id);
        if (source) {
          e.preventDefault();
          e.stopPropagation();
          void placeBefore(source, r);
        }
      }}
      onClick={() => setSelected(r.meta.id)}
    >
      <span className="card-top">
        <span className={`priority p${r.meta.priority ?? 2}`}>
          {["Urgent", "High", "Normal", "Low"][r.meta.priority ?? 2] ??
            "Normal"}
        </span>
        <span className="record-id">{recordId(r)}</span>
      </span>
      {r.meta.parent && (
        <span className="card-parent">
          ↳{" "}
          {(() => {
            const p = tickets.find((t) => t.meta.id === r.meta.parent);
            return p ? `${recordId(p)} ${p.meta.title}` : "Parent ticket";
          })()}
        </span>
      )}
      <span className="card-title">{r.meta.title}</span>
      <span className="card-tags">
        {r.meta.labels?.slice(0, 3).map((l) => (
          <span className="tag" key={l}>
            {l}
          </span>
        ))}
        {r.meta.scopeApproved && (
          <span className="tag green">Approved scope</span>
        )}
      </span>
      {r.meta.blocked && <span className="blocked">⊘ {r.meta.blocked}</span>}
      <span className="card-foot">
        <span className="avatar">
          {(r.meta.owner ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <span>{r.meta.owner || "Unassigned"}</span>
        <span className="time">{ago(r.meta.updatedAt)}</span>
      </span>
      {state.claims.some((c) => c.ticket === r.meta.id) && (
        <span className="claim-note">
          {state.claims.find((c) => c.ticket === r.meta.id)!.expiresAt >
          new Date().toISOString()
            ? "Claimed"
            : "Stale claim"}{" "}
          · last reported{" "}
          {ago(state.claims.find((c) => c.ticket === r.meta.id)!.reportedAt)}
        </span>
      )}
    </button>
  );
  return (
    <div
      className={`app-shell ${density}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          const file = Array.from(e.dataTransfer.files).find((f) =>
            f.type.startsWith("image/"),
          );
          if (file) upload(file);
        }
      }}
    >
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brandmark">CONTROL</span>
          <span className="brand-word">ROOM</span>
        </a>
        <div className="project-switch">
          <span className="project-avatar">
            {state.config.name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{state.config.name}</strong>
            <span>Local project workspace</span>
          </div>
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {(
            [
              ["board", "▦", "Board"],
              ["list", "☷", "All tickets"],
              ["attention", "◉", "Needs you"],
              ["decisions", "◇", "Decisions"],
              ["rulebook", "▤", "UI rulebook"],
              ["screenshots", "▧", "Screenshots"],
            ] as [View, string, string][]
          ).map(([v, icon, title]) => (
            <button
              key={v}
              className={view === v ? "nav-item active" : "nav-item"}
              onClick={() => {
                setView(v);
                setSelected(null);
              }}
            >
              <span className="nav-icon" aria-hidden>
                {icon}
              </span>
              {title}
              {v === "attention" &&
                attention.length + changedDocs.length > 0 && (
                  <span className="nav-count">
                    {attention.length + changedDocs.length}
                  </span>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="nav-item"
            aria-label="Import project knowledge"
            onClick={() => setView("imports")}
          >
            <span className="nav-icon" aria-hidden="true">
              ↗
            </span>
            <span className="nav-text">Import project knowledge</span>
          </button>
          <button
            className="nav-item"
            aria-label="Settings & backups"
            onClick={() => setView("settings")}
          >
            <span className="nav-icon" aria-hidden="true">
              ⚙
            </span>
            <span className="nav-text">Settings & backups</span>
          </button>
          <div className="local-indicator">
            <span /> Files in your project<span className="version">v0.1</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            {state.config.name}
            <span>/</span>
            {view === "rulebook"
              ? "Knowledge"
              : view === "decisions"
                ? "Knowledge"
                : "Workspace"}
          </span>
          <div className="top-actions">
            <button
              className="button subtle"
              onClick={() => setShortcuts(true)}
              aria-label="Keyboard shortcuts"
            >
              ? Shortcuts
            </button>
            <label className="density-control">
              Density
              <select
                aria-label="Interface density"
                value={density}
                onChange={(e) => setDensity(e.target.value)}
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
            <span className="user-chip">
              <span className="avatar human">Y</span>You
            </span>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "decisions" || view === "rulebook"
                  ? "PROJECT KNOWLEDGE"
                  : "HUMANS + AGENTS"}
              </div>
              <h1>{titles[view]}</h1>
              <p>
                {view === "screenshots"
                  ? "Capture, annotate, and keep visual notes—with or without a ticket."
                  : view === "board"
                    ? "Know what’s moving. Keep the whole project in view."
                    : view === "decisions"
                      ? "The choices that shape this project, and the reasons behind them."
                      : view === "rulebook"
                        ? "Shared principles. Consistent interfaces."
                        : view === "attention"
                          ? "Questions, blockers, and work ready for your judgment."
                          : view === "imports"
                            ? "Turn existing notes into connected, reviewable project knowledge."
                            : view === "settings"
                              ? "Your project, its shared records, and local tools."
                              : "Every task, in one place."}
              </p>
            </div>
            {view === "screenshots" && (
              <label className="button primary file-button">
                ＋ Add screenshot
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    if (e.target.files?.[0]) void upload(e.target.files[0]);
                  }}
                />
              </label>
            )}
            {!["settings", "imports", "screenshots"].includes(view) && (
              <button
                className="button primary"
                onClick={() =>
                  setCreating(
                    view === "decisions"
                      ? "decision"
                      : view === "rulebook"
                        ? "rule"
                        : "ticket",
                  )
                }
              >
                ＋{" "}
                {view === "decisions"
                  ? "New decision"
                  : view === "rulebook"
                    ? "New rule"
                    : "New ticket"}
              </button>
            )}
          </div>
          {error && (
            <div className="banner error" role="alert">
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="banner">
              <span>{notice}</span>
              <button onClick={() => setNotice("")} aria-label="Dismiss notice">
                ×
              </button>
            </div>
          )}
          {state.branchChanged && (
            <div className="banner error">
              The canonical checkout changed from {state.acknowledgedBranch} to{" "}
              {state.branch}. Writes are paused.
              <button className="button" onClick={() => setView("settings")}>
                Review in Settings
              </button>
            </div>
          )}
          {state.errors.length > 0 && (
            <div className="banner error" role="alert">
              <div>
                <strong>
                  {state.errors.length} record problems need attention
                </strong>
                {state.errors.map((e) => (
                  <p key={e.path}>
                    {e.path}: {e.message}
                  </p>
                ))}
              </div>
            </div>
          )}
          {["board", "list"].includes(view) && (
            <>
              <div className="board-summary">
                <span>
                  <i className="dot green" />
                  {
                    tickets.filter(
                      (t) =>
                        state.config.columns.find((c) => c.id === t.meta.status)
                          ?.role === "progress",
                    ).length
                  }{" "}
                  in progress
                </span>
                <button onClick={() => setView("attention")}>
                  <i className="dot amber" />
                  {attention.length} need your attention <span>→</span>
                </button>
                <span className="summary-end">Grouped by parent goal</span>
              </div>
              <div className="toolbar">
                <label className="search">
                  <span aria-hidden>⌕</span>
                  <input
                    aria-label="Search tickets"
                    placeholder="Search tickets, labels, or context…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <kbd>⌘ K</kbd>
                </label>
                <select
                  aria-label="Filter label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                >
                  <option value="">All labels</option>
                  {labels.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter owner"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                >
                  <option value="">All owners</option>
                  {owners.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
                <div className="segmented">
                  <button
                    className={view === "board" ? "selected" : ""}
                    onClick={() => setView("board")}
                    aria-label="Board view"
                  >
                    ▦
                  </button>
                  <button
                    className={view === "list" ? "selected" : ""}
                    onClick={() => setView("list")}
                    aria-label="List view"
                  >
                    ☷
                  </button>
                </div>
              </div>
            </>
          )}
          {view === "screenshots" && (
            <Screenshots state={state} open={setImage} />
          )}
          {view === "board" && (
            <div className="board-scroll">
              <div
                className="board"
                style={
                  {
                    "--columns": state.config.columns.length,
                  } as React.CSSProperties
                }
              >
                <div className="column-heads">
                  {state.config.columns.map((c) => (
                    <div key={c.id} data-stage={c.role}>
                      <i className={`status-dot ${c.role}`} />
                      <strong>{c.name}</strong>
                      <span>
                        {filtered.filter((r) => r.meta.status === c.id).length}
                      </span>
                    </div>
                  ))}
                </div>
                {[...groups.entries()].map(([id, items]) => (
                  <section className="swimlane" key={id}>
                    <div className="lane-heading">
                      <span>⌄</span>
                      <strong>{laneName(id)}</strong>
                      <span className="muted">{items.length} tickets</span>
                    </div>
                    {id !== "unparented" &&
                      tickets.find((t) => t.meta.id === id) && (
                        <div className="parent-ticket-row">
                          {card(tickets.find((t) => t.meta.id === id)!)}
                          <span className="help">
                            Child tickets below ·{" "}
                            {items.filter((t) => t.meta.id !== id).length} items
                          </span>
                        </div>
                      )}
                    <div
                      className={`lane-columns ${id !== "unparented" ? "child-columns" : ""}`}
                    >
                      {state.config.columns.map((c) => (
                        <div
                          className="lane-cell"
                          data-stage={c.role}
                          key={c.id}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            const id = e.dataTransfer.getData(
                              "text/workboard-ticket",
                            );
                            const t = tickets.find((t) => t.meta.id === id);
                            if (t) {
                              e.preventDefault();
                              move(t, c.id);
                            }
                          }}
                        >
                          {orderedChildren(items, id)
                            .filter((t) => t.meta.status === c.id)
                            .map((t) => (
                              <div
                                key={t.meta.id}
                                className={
                                  t.meta.parent && t.meta.parent !== id
                                    ? "nested-ticket"
                                    : undefined
                                }
                              >
                                {card(t)}
                              </div>
                            ))}
                          <QuickTicket
                            parent={id === "unparented" ? null : id}
                            lane={`${laneName(id)} / ${c.name}`}
                            status={c.id}
                            onCreated={reload}
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
                {!filtered.length && (
                  <div className="empty-state">
                    <span className="empty-icon">▦</span>
                    <h2>
                      {tickets.length
                        ? "No matching tickets"
                        : "Your next chapter starts here"}
                    </h2>
                    <p>
                      {tickets.length
                        ? "Try another search or clear your filters."
                        : "Type a short name in the box above and press Enter. Open the ticket anytime to add a description."}
                    </p>
                    <button
                      className="button primary"
                      onClick={() => setCreating("ticket")}
                    >
                      Create a ticket
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          {view === "list" && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Status</th>
                    <th>Owner</th>
                    <th>Updated</th>
                    <th>Order</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.meta.id}>
                      <td>
                        <button
                          className="text-button ticket-link"
                          onClick={() => setSelected(r.meta.id)}
                        >
                          <span className="record-id">{recordId(r)}</span>
                          {r.meta.title}
                        </button>
                      </td>
                      <td>
                        <select
                          aria-label={`Status of ${r.meta.title}`}
                          value={r.meta.status}
                          onChange={(e) => move(r, e.target.value)}
                        >
                          {state.config.columns.map((c) => (
                            <option value={c.id} key={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{r.meta.owner || "Unassigned"}</td>
                      <td>{ago(r.meta.updatedAt)}</td>
                      <td>
                        <button
                          className="button subtle"
                          aria-label={`Move ${r.meta.title} earlier`}
                          disabled={!previousPeer(r)}
                          onClick={() => {
                            const target = previousPeer(r);
                            if (target) void placeBefore(r, target);
                          }}
                        >
                          ↑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filtered.length && (
                <p className="empty-inline">No tickets to show.</p>
              )}
            </div>
          )}
          {view === "attention" && (
            <div className="attention-list">
              {attention.map((r) => (
                <button
                  className="attention-row"
                  key={r.meta.id}
                  onClick={() => setSelected(r.meta.id)}
                >
                  <span className="attention-icon">
                    {r.meta.blocked ? "⊘" : "◉"}
                  </span>
                  <span>
                    <strong>{r.meta.title}</strong>
                    <small>
                      {r.meta.blocked ||
                        (state.config.columns.find(
                          (c) => c.id === r.meta.status,
                        )?.role === "review"
                          ? "Ready for your review"
                          : "Open question or changed rule guidance")}
                    </small>
                  </span>
                  <span className="record-id">{recordId(r)} →</span>
                </button>
              ))}
              {changedDocs.length > 0 && (
                <>
                  <div className="section-heading">
                    <h2>Changed project knowledge</h2>
                    <button
                      className="button subtle"
                      onClick={() => {
                        setKnowledgeRead(Date.now());
                      }}
                    >
                      Mark seen
                    </button>
                  </div>
                  {changedDocs.map((r) => (
                    <button
                      className="attention-row"
                      key={r.meta.id}
                      onClick={() => setSelected(r.meta.id)}
                    >
                      <span className="attention-icon">◇</span>
                      <span>
                        <strong>{r.meta.title}</strong>
                        <small>
                          {r.meta.kind} · {r.meta.status} · updated{" "}
                          {ago(r.meta.updatedAt)}
                        </small>
                      </span>
                      <span>→</span>
                    </button>
                  ))}
                </>
              )}
              {!attention.length && !changedDocs.length && (
                <div className="empty-state">
                  <span className="empty-icon">✓</span>
                  <h2>You’re caught up</h2>
                  <p>
                    Questions, blockers, reviews, and changed guidance will
                    appear here.
                  </p>
                </div>
              )}
            </div>
          )}
          {(view === "decisions" || view === "rulebook") && (
            <>
              <div className="toolbar">
                <label className="search">
                  <span>⌕</span>
                  <input
                    aria-label="Search knowledge"
                    placeholder="Search titles, rationale, and guidance…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                {view === "rulebook" && (
                  <button className="button" onClick={() => setView("imports")}>
                    Set up from existing docs ↗
                  </button>
                )}
              </div>
              <div className="knowledge-grid">
                {docs
                  .filter(
                    (r) =>
                      r.meta.kind ===
                        (view === "decisions" ? "decision" : "rule") &&
                      `${r.meta.title} ${r.body}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  )
                  .map((r) => (
                    <button
                      className="knowledge-card"
                      key={r.meta.id}
                      onClick={() => setSelected(r.meta.id)}
                    >
                      <div className="card-top">
                        <span className="tag">
                          {r.meta.category ?? r.meta.kind}
                        </span>
                        <span
                          className={`tag ${["accepted", "active"].includes(r.meta.status) ? "green" : ""}`}
                        >
                          {r.meta.status}
                        </span>
                      </div>
                      <h2>{r.meta.title}</h2>
                      <p>
                        {r.body.replace(/[#*`]/g, "").slice(0, 180) ||
                          "Add context, rationale, and examples."}
                      </p>
                      <div className="card-foot">
                        <span>{r.meta.strength ?? r.meta.author.name}</span>
                        <span className="time">{ago(r.meta.updatedAt)}</span>
                      </div>
                    </button>
                  ))}
              </div>
              {!docs.some(
                (r) =>
                  r.meta.kind === (view === "decisions" ? "decision" : "rule"),
              ) && (
                <div className="empty-state">
                  <span className="empty-icon">
                    {view === "decisions" ? "◇" : "▤"}
                  </span>
                  <h2>
                    {view === "decisions"
                      ? "Keep the reasoning, not just the result"
                      : "Give every interface a common language"}
                  </h2>
                  <p>
                    {view === "decisions"
                      ? "Record the choices that should outlive any single task or agent session."
                      : "Add a rule with its rationale, scope, and a reference to the components you already use."}
                  </p>
                  <button
                    className="button primary"
                    onClick={() =>
                      setCreating(view === "decisions" ? "decision" : "rule")
                    }
                  >
                    {view === "decisions"
                      ? "Record a decision"
                      : "Create a design rule"}
                  </button>
                </div>
              )}
            </>
          )}
          {view === "imports" && <Imports reload={reload} onError={setError} />}
          {view === "settings" && (
            <Settings
              state={state}
              reload={reload}
              onError={setError}
              openImage={setImage}
            />
          )}
        </main>
        <footer className="workspace-footer">
          <span>
            <i className="dot green" /> Shared with all worktrees
          </span>
          <span>{state.branch} · Markdown is the source of truth</span>
          <label className="upload-link">
            ＋ Add screenshot
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                if (e.target.files?.[0]) upload(e.target.files[0]);
              }}
            />
          </label>
        </footer>
      </div>
      {(active || creating) && (
        <RecordDetail
          key={active?.meta.id ?? `new-${creating}`}
          record={active ?? undefined}
          kind={creating ?? active!.meta.kind}
          state={state}
          onClose={() => {
            setSelected(null);
            setCreating(null);
          }}
          onSaved={async (id) => {
            await reload();
            // The editor owns save/close behavior; refreshing never reopens it.
          }}
          onError={setError}
          openRecord={setSelected}
          openImage={setImage}
        />
      )}
      {image && (
        <AnnotationEditor
          // A new image gets a fresh editor: no marks or undo history carry over.
          key={image}
          id={image}
          state={state}
          onClose={() => {
            setImage(null);
            history.replaceState(null, "", location.pathname);
          }}
          reload={reload}
          onError={setError}
        />
      )}
      {shortcuts && (
        <Shortcuts
          capture={
            state.config.shortcut.mode === "hotkey"
              ? state.config.shortcut.label
              : "Double-tap Option / Alt"
          }
          onClose={() => setShortcuts(false)}
        />
      )}
      <Shortcut
        onNew={() => setCreating("ticket")}
        onHelp={() => setShortcuts(true)}
      />
    </div>
  );
}
function Shortcut({
  onNew,
  onHelp,
}: {
  onNew: () => void;
  onHelp: () => void;
}) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const typing = (e.target as HTMLElement)?.closest(
        "input, textarea, select, [contenteditable=true]",
      );
      if (e.key === "?" && !typing) {
        e.preventDefault();
        onHelp();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".search input")?.focus();
      }
      if (
        e.key === "n" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement)
      )
        onNew();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onNew, onHelp]);
  return null;
}
