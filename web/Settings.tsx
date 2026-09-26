import React, { useEffect, useState } from "react";
import type { Column, ProjectState } from "../src/types";
import { api } from "./api";
export function Settings({
  state,
  reload,
  onError,
  openImage,
}: {
  state: ProjectState;
  reload: () => Promise<void>;
  onError: (s: string) => void;
  openImage: (id: string) => void;
}) {
  const [name, setName] = useState(state.config.name),
    [columns, setColumns] = useState<Column[]>(state.config.columns),
    [revision, setRevision] = useState(state.configRevision),
    [shortcut, setShortcut] = useState(state.config.shortcut),
    [capture, setCapture] = useState<any>(null),
    [drafts, setDrafts] = useState<string[]>([]),
    [saved, setSaved] = useState("");
  const loadCapture = () => {
    api("/capture/status")
      .then(setCapture)
      .catch((e) => onError(String(e)));
    api("/capture/drafts")
      .then(setDrafts)
      .catch(() => {});
  };
  useEffect(() => {
    loadCapture();
    const timer = setInterval(loadCapture, 3000);
    return () => clearInterval(timer);
  }, []);
  async function save() {
    try {
      await api("/config", "PATCH", {
        revision,
        patch: { name, columns, shortcut },
      });
      const next = await api<ProjectState>("/state");
      setRevision(next.configRevision);
      await api("/active", "POST", {});
      await reload();
      setSaved("Project settings saved.");
    } catch (e) {
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
  return (
    <div className="settings-grid">
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
        <h2>Workflow columns</h2>
        <p className="help">
          Names are editable. Roles preserve agent workflow behavior. Move
          tickets before removing their column.
        </p>
        {columns.map((c, i) => (
          <div className="column-setting" key={c.id}>
            <input
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
            <select
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
              aria-label={`Remove ${c.name}`}
              onClick={() => setColumns(columns.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
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
          <p>{capture?.message}</p>
          <div className="inline-actions" style={{ marginTop: 10 }}>
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
          </div>
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
          If macOS requests screen recording access, grant it to Workboard
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
