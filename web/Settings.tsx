import { NetworkSettings } from "./NetworkSettings";
import React, { useEffect, useMemo, useState } from "react";
import type { Column, Config, ProjectState } from "../src/types";
import { api, isRemoteBrowser } from "./api";

type WorkflowDraft = Pick<Config, "name" | "columns" | "shortcut">;

const cloneWorkflowDraft = (draft: WorkflowDraft): WorkflowDraft => ({
  name: draft.name,
  columns: draft.columns.map((column) => ({ ...column })),
  shortcut: { ...draft.shortcut },
});

const workflowDraft = (config: Config): WorkflowDraft =>
  cloneWorkflowDraft(config);

const sameWorkflowDraft = (a: WorkflowDraft, b: WorkflowDraft) =>
  JSON.stringify(a) === JSON.stringify(b);

const sameColumn = (a: Column, b: Column) =>
  a.id === b.id && a.name === b.name && a.role === b.role;

// Reapply only the fields the local draft changed. This lets a local rename
// coexist with a status added or renamed by another browser.
function reapplyWorkflowDraft(
  base: WorkflowDraft,
  local: WorkflowDraft,
  remote: WorkflowDraft,
): WorkflowDraft {
  const baseColumns = new Map(
    base.columns.map((column) => [column.id, column]),
  );
  const localColumns = new Map(
    local.columns.map((column) => [column.id, column]),
  );
  const merged = new Map<string, Column>();
  for (const remoteColumn of remote.columns) {
    const baseColumn = baseColumns.get(remoteColumn.id);
    const localColumn = localColumns.get(remoteColumn.id);
    // A local removal applies only if nobody changed that status remotely.
    // Keeping a remotely changed status avoids silently discarding their edit.
    if (!localColumn) {
      if (!baseColumn || !sameColumn(baseColumn, remoteColumn))
        merged.set(remoteColumn.id, remoteColumn);
      continue;
    }
    if (!baseColumn) {
      merged.set(remoteColumn.id, remoteColumn);
      continue;
    }
    merged.set(remoteColumn.id, {
      id: remoteColumn.id,
      name:
        localColumn.name === baseColumn.name
          ? remoteColumn.name
          : localColumn.name,
      role:
        localColumn.role === baseColumn.role
          ? remoteColumn.role
          : localColumn.role,
    });
  }
  // Locally added statuses are safe to append, provided no remote status has
  // since claimed the same stable ID.
  for (const column of local.columns)
    if (!baseColumns.has(column.id) && !merged.has(column.id))
      merged.set(column.id, column);

  const localOrderChanged =
    base.columns.map((column) => column.id).join(",") !==
    local.columns
      .filter((column) => baseColumns.has(column.id))
      .map((column) => column.id)
      .join(",");
  const orderedIds = localOrderChanged
    ? [
        ...local.columns.map((column) => column.id),
        ...remote.columns.map((column) => column.id),
      ]
    : [
        ...remote.columns.map((column) => column.id),
        ...local.columns.map((column) => column.id),
      ];
  const seen = new Set<string>();
  const columns = orderedIds.flatMap((id) => {
    const column = merged.get(id);
    if (!column || seen.has(id)) return [];
    seen.add(id);
    return [column];
  });
  return {
    name: local.name === base.name ? remote.name : local.name,
    columns,
    shortcut:
      JSON.stringify(local.shortcut) === JSON.stringify(base.shortcut)
        ? remote.shortcut
        : local.shortcut,
  };
}

export function Settings({
  state,
  reload,
  onError,
  openImage,
  onMoveTickets,
}: {
  state: ProjectState;
  reload: () => Promise<void>;
  onError: (s: string) => void;
  openImage: (id: string) => void;
  onMoveTickets: () => void;
}) {
  const [name, setName] = useState(state.config.name),
    [columns, setColumns] = useState<Column[]>(state.config.columns),
    [revision, setRevision] = useState(state.configRevision),
    [shortcut, setShortcut] = useState(state.config.shortcut),
    [baseline, setBaseline] = useState<WorkflowDraft>(() =>
      workflowDraft(state.config),
    ),
    [remoteWorkflow, setRemoteWorkflow] = useState<{
      revision: string;
      draft: WorkflowDraft;
    } | null>(null),
    [capture, setCapture] = useState<any>(null),
    [drafts, setDrafts] = useState<string[]>([]),
    [saved, setSaved] = useState(""),
    [workflowError, setWorkflowError] = useState(""),
    [pendingRemoval, setPendingRemoval] = useState<Column | null>(null);
  const currentDraft = (): WorkflowDraft => ({ name, columns, shortcut });
  const applyWorkflow = (
    draft: WorkflowDraft,
    nextRevision: string,
    persisted: WorkflowDraft = draft,
  ) => {
    setName(draft.name);
    setColumns(draft.columns);
    setShortcut(draft.shortcut);
    setBaseline(cloneWorkflowDraft(persisted));
    setRevision(nextRevision);
    setRemoteWorkflow(null);
    setPendingRemoval(null);
  };
  useEffect(() => {
    if (state.configRevision === revision) return;
    const remote = workflowDraft(state.config);
    if (!sameWorkflowDraft(currentDraft(), baseline)) {
      setRemoteWorkflow({ revision: state.configRevision, draft: remote });
      setWorkflowError(
        "Workflow configuration changed elsewhere. Your unsaved draft is still here; choose how to reconcile it before saving.",
      );
      return;
    }
    applyWorkflow(remote, state.configRevision);
  }, [state.configRevision]);
  const ticketCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of state.records)
      if (record.meta.kind === "ticket")
        counts.set(
          record.meta.status,
          (counts.get(record.meta.status) ?? 0) + 1,
        );
    return counts;
  }, [state.records]);
  const defaultFor = (role: Column["role"]) =>
    columns.find((column) => column.role === role);
  const validateWorkflow = () => {
    if (!name.trim()) return "Project name is required.";
    const blank = columns.find((column) => !column.name.trim());
    if (blank) return `Give ${blank.id} a display name.`;
    const missing = ["backlog", "selected", "progress", "review", "done"].find(
      (role) => !columns.some((column) => column.role === role),
    );
    if (missing) return `Keep a status with the ${missing} workflow role.`;
    return "";
  };
  const loadCapture = () => {
    api("/capture/status")
      .then(setCapture)
      .catch((e) => onError(String(e)));
    api("/capture/drafts")
      .then(setDrafts)
      .catch(() => {});
  };
  useEffect(() => {
    if (isRemoteBrowser()) return;
    loadCapture();
    const timer = setInterval(loadCapture, 3000);
    return () => clearInterval(timer);
  }, []);
  async function save() {
    if (remoteWorkflow) {
      setWorkflowError(
        "Reconcile the newer workflow configuration before saving. Your draft has not been changed.",
      );
      return;
    }
    const invalid = validateWorkflow();
    if (invalid) {
      setWorkflowError(invalid);
      return;
    }
    try {
      await api("/config", "PATCH", {
        revision,
        patch: { name, columns, shortcut },
      });
      const next = await api<ProjectState>("/state");
      setRevision(next.configRevision);
      setBaseline(cloneWorkflowDraft({ name, columns, shortcut }));
      await api("/active", "POST", {});
      await reload();
      setSaved("Project settings saved.");
      setWorkflowError("");
    } catch (e) {
      if (String(e).includes("Configuration changed")) {
        setWorkflowError(
          "Workflow configuration changed elsewhere. Your unsaved draft is still here; choose how to reconcile it before saving.",
        );
        await reload();
        return;
      }
      onError(String(e));
    }
  }
  async function restore(file: File) {
    try {
      const b = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < b.length; i += 8192)
        binary += String.fromCharCode(...b.subarray(i, i + 8192));
      await api("/restore", "POST", { data: btoa(binary) });
      await reload();
      setSaved("Backup restored.");
    } catch (e) {
      onError(String(e));
    }
  }
  if (isRemoteBrowser())
    return (
      <section className="settings-card">
        <h2>Host settings</h2>
        <p>
          Network access, native capture, configuration, imports and restore are
          managed on the host at 127.0.0.1. This remote browser can use the
          board, discussions, project knowledge and screenshots.
        </p>
        <a className="button" href="/api/export">
          Export project backup
        </a>
      </section>
    );
  return (
    <div className="settings-grid">
      <NetworkSettings />
      <section className="settings-card">
        <h2>Project & shared checkout</h2>
        <label className="field">
          Project name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <dl className="info-list">
          <dt>Canonical checkout</dt>
          <dd>
            <code>{state.canonical}</code>
          </dd>
          <dt>Current branch</dt>
          <dd>{state.branch}</dd>
          <dt>Shared storage</dt>
          <dd>
            Git-tracked Markdown and annotation data. Local images and runtime
            state stay out of Git.
          </dd>
        </dl>
        {state.branchChanged && (
          <div className="banner error">
            <div>
              <strong>Branch reconciliation required</strong>
              <p>
                Previously acknowledged: {state.acknowledgedBranch}. Review the
                current records before accepting this branch as the board’s
                source.
              </p>
              <button
                className="button"
                onClick={async () => {
                  try {
                    await api("/reconcile", "POST", { branch: state.branch });
                    await reload();
                  } catch (e) {
                    onError(String(e));
                  }
                }}
              >
                Use records on {state.branch}
              </button>
            </div>
          </div>
        )}
      </section>
      <section className="settings-card">
        <h2 id="workflow-columns">Customize statuses</h2>
        <p className="help">
          Display names are what people see on the board. Stable IDs keep
          tickets, history and saved views associated as names and order change.
          Workflow roles preserve agent behavior; more than one status can use
          the same role.
        </p>
        <p className="help workflow-defaults">
          <strong>Deterministic role defaults:</strong> new tickets use the
          first <em>backlog</em> status, and role-based agent moves use the
          first matching status in this order. Reorder statuses to change those
          defaults.
        </p>
        <ul
          className="workflow-default-list"
          aria-label="Workflow role defaults"
        >
          {(["backlog", "selected", "progress", "review", "done"] as const).map(
            (role) => {
              const column = defaultFor(role);
              return (
                <li key={role}>
                  <code>{role}</code>
                  <span>
                    {column ? `${column.name} (${column.id})` : "Required"}
                  </span>
                </li>
              );
            },
          )}
        </ul>
        {workflowError && (
          <p className="banner error workflow-message" role="alert">
            {workflowError}
          </p>
        )}
        {remoteWorkflow && (
          <div className="workflow-reconciliation" role="alert">
            <strong>New workflow settings are available.</strong>
            <p>
              Your edits remain in this form. Reload discards them and shows the
              newer configuration. Reapply merges your changed fields onto it,
              keeping statuses and fields changed elsewhere.
            </p>
            <div className="inline-actions">
              <button
                className="button primary small"
                onClick={() => {
                  const next = reapplyWorkflowDraft(
                    baseline,
                    currentDraft(),
                    remoteWorkflow.draft,
                  );
                  // The reapplied draft is still unsaved. Compare future remote
                  // updates against their persisted baseline, not this local edit.
                  applyWorkflow(
                    next,
                    remoteWorkflow.revision,
                    remoteWorkflow.draft,
                  );
                  setWorkflowError(
                    "Your draft was reapplied to the latest workflow configuration. Review it, then save.",
                  );
                }}
              >
                Reapply my draft
              </button>
              <button
                className="button small"
                onClick={() => {
                  applyWorkflow(remoteWorkflow.draft, remoteWorkflow.revision);
                  setWorkflowError("");
                  setSaved(
                    "Latest workflow configuration loaded. Local draft discarded.",
                  );
                }}
              >
                Reload remote configuration
              </button>
            </div>
          </div>
        )}
        {columns.map((c, i) => (
          <div className="column-setting" key={c.id}>
            <div className="column-display-name">
              <label htmlFor={`status-name-${c.id}`}>Display name</label>
              <input
                id={`status-name-${c.id}`}
                aria-label={`Name for ${c.id}`}
                value={c.name}
                onChange={(e) =>
                  setColumns(
                    columns.map((v, j) =>
                      j === i ? { ...v, name: e.target.value } : v,
                    ),
                  )
                }
              />
              <small>
                Stable ID: <code>{c.id}</code>
              </small>
            </div>
            <div className="column-role">
              <label htmlFor={`status-role-${c.id}`}>Workflow role</label>
              <select
                id={`status-role-${c.id}`}
                aria-label={`Role for ${c.id}`}
                value={c.role}
                onChange={(e) =>
                  setColumns(
                    columns.map((v, j) =>
                      j === i
                        ? { ...v, role: e.target.value as Column["role"] }
                        : v,
                    ),
                  )
                }
              >
                {["backlog", "selected", "progress", "review", "done"].map(
                  (r) => (
                    <option key={r}>{r}</option>
                  ),
                )}
              </select>
            </div>
            <button
              className="icon-button"
              aria-label={`Move ${c.name} earlier`}
              disabled={i === 0}
              onClick={() => {
                const copy = [...columns];
                [copy[i - 1], copy[i]] = [copy[i], copy[i - 1]];
                setColumns(copy);
              }}
            >
              ↑
            </button>
            <button
              className="icon-button"
              aria-label={`Move ${c.name} later`}
              disabled={i === columns.length - 1}
              onClick={() => {
                const copy = [...columns];
                [copy[i], copy[i + 1]] = [copy[i + 1], copy[i]];
                setColumns(copy);
              }}
            >
              ↓
            </button>
            <button
              className="icon-button"
              aria-label={`Remove ${c.name}`}
              disabled={
                columns.filter((column) => column.role === c.role).length === 1
              }
              title={
                columns.filter((column) => column.role === c.role).length === 1
                  ? `Add or change another ${c.role} status before removing this required role.`
                  : undefined
              }
              onClick={() => {
                const count = ticketCounts.get(c.id) ?? 0;
                if (count) {
                  setPendingRemoval(c);
                  return;
                }
                setColumns(columns.filter((_, j) => j !== i));
              }}
            >
              ×
            </button>
          </div>
        ))}
        {pendingRemoval && (
          <div className="workflow-removal" role="alert">
            <strong>
              {pendingRemoval.name} still has{" "}
              {ticketCounts.get(pendingRemoval.id)} ticket
              {ticketCounts.get(pendingRemoval.id) === 1 ? "" : "s"}.
            </strong>
            <p>
              Choose each ticket’s destination on the board first. This status
              remains until no tickets reference its stable ID.
            </p>
            <div className="inline-actions">
              <button
                className="button primary small"
                onClick={() => {
                  setPendingRemoval(null);
                  onMoveTickets();
                }}
              >
                Move tickets on board
              </button>
              <button
                className="button small"
                onClick={() => setPendingRemoval(null)}
              >
                Keep status
              </button>
            </div>
          </div>
        )}
        <button
          className="button"
          onClick={() =>
            setColumns([
              ...columns,
              {
                id: "stage-" + Date.now().toString(36),
                name: "New stage",
                role: "progress",
              },
            ])
          }
        >
          + Add column
        </button>
      </section>
      <section className="settings-card">
        <h2>Screenshot capture</h2>
        <p>
          Paste or drop images anywhere. The global shortcut is available while
          the macOS companion is running.
        </p>
        <div className="capture-status">
          <span className="tag">{capture?.state ?? "Checking…"}</span>
          {capture?.pid && (
            <>
              <span
                className={`tag ${capture.screenRecording ? "green" : "danger"}`}
              >
                Screen Recording{" "}
                {capture.screenRecording ? "available" : "not confirmed"}
              </span>
              <span
                className={`tag ${capture.inputMonitoring ? "green" : "danger"}`}
              >
                Input Monitoring{" "}
                {capture.inputMonitoring ? "available" : "not confirmed"}
              </span>
            </>
          )}
          <p>{capture?.message}</p>
          {capture?.bundlePath && (
            <p className="help">
              Running app: <code>{capture.bundlePath}</code>
            </p>
          )}
          {capture?.signingMode === "ad-hoc" && (
            <p className="help">
              This local build is ad-hoc signed. A rebuilt app can have a
              different identity even when macOS still shows its old permission
              entry as enabled.
            </p>
          )}
          <div className="inline-actions" style={{ marginTop: 10 }}>
            <button
              className="button small"
              onClick={() =>
                api("/capture/reveal", "POST", {}).catch((e) =>
                  onError(String(e)),
                )
              }
            >
              Show current capture app
            </button>
            {(
              [
                ["input-monitoring", "Input Monitoring"],
                ["screen-recording", "Screen Recording"],
              ] as const
            ).map(([pane, label]) => (
              <button
                key={pane}
                className={`button small${String(capture?.state ?? "").includes(pane) ? " primary" : ""}`}
                onClick={() =>
                  api("/capture/settings", "POST", { pane }).catch((e) =>
                    onError(String(e)),
                  )
                }
              >
                Open {label} settings
              </button>
            ))}
            <button
              className="button small"
              title="Restart the companion to recheck current permissions"
              onClick={() =>
                api("/capture/restart", "POST", {})
                  .then(() => setTimeout(loadCapture, 1500))
                  .catch((e) => onError(String(e)))
              }
            >
              Relaunch companion
            </button>
          </div>
          <p className="help">
            If permissions are enabled but remain unconfirmed, use “Show current
            capture app” to locate this build. Remove the old ControlRoom
            Capture entry with the minus button in the relevant macOS privacy
            pane, add this exact app, enable it, then relaunch. A region capture
            can still be attempted when the preliminary Screen Recording check
            is unconfirmed; macOS enforces access during capture.
          </p>
        </div>
        <label className="field">
          Global shortcut
          <select
            value={
              shortcut.mode === "hotkey" ? String(shortcut.key) : "double-alt"
            }
            onChange={(e) =>
              setShortcut(
                e.target.value === "double-alt"
                  ? {
                      mode: "double-alt",
                      key: 1,
                      modifiers: 6400,
                      label: "Double-tap Option / Alt",
                    }
                  : {
                      mode: "hotkey",
                      key: Number(e.target.value),
                      modifiers: 6400,
                      label: `Control + Option + Command + ${e.target.selectedOptions[0].text}`,
                    },
              )
            }
          >
            <option value="double-alt">Double-tap Option / Alt</option>
            {[
              [1, "S"],
              [8, "C"],
              [40, "K"],
              [9, "V"],
            ].map(([code, label]) => (
              <option value={code} key={code}>
                {label}
              </option>
            ))}
          </select>
          <small>
            Tap and release Option twice quickly, without another key or mouse
            click. macOS may require Input Monitoring permission for the capture
            companion. Letter shortcuts use Control + Option + Command.
          </small>
        </label>
        <button
          className="button"
          onClick={async () => {
            try {
              await api("/capture/request", "POST", {});
              loadCapture();
            } catch (e) {
              onError(String(e));
            }
          }}
        >
          Capture a region or window
        </button>
        <p className="help">
          If macOS requests screen recording access, grant it to ControlRoom
          Capture. Escape cancels capture. Captures go to the most recently
          active project.
        </p>
        {drafts.length > 0 && (
          <>
            <h3>Recovered capture drafts</h3>
            {drafts.map((d) => (
              <button
                key={d}
                className="child-ticket"
                onClick={async () => {
                  try {
                    const a = await api("/capture/recover", "POST", {
                      name: d,
                    });
                    await reload();
                    openImage(a.id);
                    loadCapture();
                  } catch (e) {
                    onError(String(e));
                  }
                }}
              >
                {d} <span>Recover →</span>
              </button>
            ))}
          </>
        )}
      </section>
      <section className="settings-card">
        <h2>Backup & restore</h2>
        <p>
          Include records, annotations, local images, and staged imports in a
          portable archive. Runtime tokens and claims are excluded.
        </p>
        <div className="inline-actions">
          <a className="button primary" href="/api/export" download>
            Export project backup
          </a>
          <label className="button file-button">
            Restore backup
            <input
              type="file"
              accept=".gz"
              onChange={(e) => {
                if (e.target.files?.[0]) restore(e.target.files[0]);
              }}
            />
          </label>
        </div>
        <p className="help">
          Restore requires an empty project and never overwrites existing
          tickets. Images do not travel with a normal Git clone.
        </p>
      </section>
      <div className="settings-actions">
        {saved && <span role="status">{saved}</span>}
        <button
          className="button primary"
          onClick={save}
          disabled={state.branchChanged}
        >
          Save project settings
        </button>
      </div>
    </div>
  );
}
