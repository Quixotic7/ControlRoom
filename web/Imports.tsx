import { isRemoteBrowser } from "./api";
import React, { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { api, actor } from "./api";
export function Imports({
  reload,
  onError,
}: {
  reload: () => Promise<void>;
  onError: (s: string) => void;
}) {
  const [files, setFiles] = useState<string[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [brief, setBrief] = useState<any>(null),
    [batches, setBatches] = useState<any[]>([]),
    [checked, setChecked] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [message, setMessage] = useState("");
  const load = () => {
    if (isRemoteBrowser()) return;
    api("/documents")
      .then(setFiles)
      .catch((e) => onError(String(e)));
    api("/import")
      .then(setBatches)
      .catch((e) => onError(String(e)));
  };
  useEffect(load, []);
  async function stage(file: File) {
    try {
      await api("/import", "POST", {
        proposals: JSON.parse(await file.text()),
        actor,
      });
      load();
      setMessage("Proposals staged. Review them below before importing.");
    } catch (e) {
      onError(String(e));
    }
  }
  if (isRemoteBrowser())
    return (
      <p className="banner">
        Import project documents on the host at 127.0.0.1.
      </p>
    );
  return (
    <div className="import-layout">
      <section className="settings-card">
        <div className="step-label">01 / SELECT SOURCE MATERIAL</div>
        <h2>Start with what you already know</h2>
        <p>
          Choose documents, UI components, tokens, or screenshots for an agent
          briefing. The agent proposes records; you review them before import.
        </p>
        <label className="field">
          Find source files
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by file name or folder"
          />
        </label>
        <div className="file-list">
          {files
            .filter((f) => f.toLowerCase().includes(search.toLowerCase()))
            .map((f) => (
              <label className="check-row" key={f}>
                <input
                  type="checkbox"
                  checked={selected.includes(f)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, f]
                        : selected.filter((x) => x !== f),
                    )
                  }
                />
                <code>{f}</code>
              </label>
            ))}
          {!files.length && (
            <p className="help">
              No supported documents, components, or images found outside tool
              and dependency directories.
            </p>
          )}
        </div>
        <button
          className="button primary"
          disabled={!selected.length}
          onClick={async () => {
            try {
              setBrief(await api("/import/brief", "POST", { files: selected }));
            } catch (e) {
              onError(String(e));
            }
          }}
        >
          Prepare agent briefing
        </button>
        {brief && (
          <div className="brief-result">
            <div className="section-heading">
              <h3>Briefing ready</h3>
              <button
                className="button"
                onClick={() =>
                  navigator.clipboard
                    .writeText(JSON.stringify(brief, null, 2))
                    .then(() => setMessage("Agent briefing copied."))
                    .catch((e) => onError(String(e)))
                }
              >
                Copy for your agent
              </button>
            </div>
            <p className="help">{brief.instructions}</p>
            <details>
              <summary>View selected sources and image references</summary>
              <pre>{JSON.stringify(brief.sources, null, 2)}</pre>
            </details>
          </div>
        )}
      </section>
      <section className="settings-card">
        <div className="step-label">02 / REVIEW PROPOSED RECORDS</div>
        <div className="section-heading">
          <h2>Keep the useful knowledge</h2>
          <label className="button file-button">
            Load proposal JSON
            <input
              type="file"
              accept=".json"
              onChange={(e) => {
                if (e.target.files?.[0]) stage(e.target.files[0]);
              }}
            />
          </label>
        </div>
        <p>
          The agent can stage proposals through the CLI, or you can load its
          JSON output here. Original documents remain untouched.
        </p>
        {message && (
          <p className="success-text" role="status">
            {message}
          </p>
        )}
        {batches.map((batch) => (
          <div key={batch.id} className="import-batch">
            <p className="muted">
              Proposed by {batch.actor.name} ·{" "}
              {new Date(batch.at).toLocaleString()}
            </p>
            {batch.proposals.map((p: any) => (
              <details className="proposal" key={p.id}>
                <summary>
                  <input
                    aria-label={`Select proposal ${p.title}`}
                    type="checkbox"
                    disabled={!!p.imported}
                    checked={checked.includes(p.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      setChecked(
                        e.target.checked
                          ? [...checked, p.id]
                          : checked.filter((v) => v !== p.id),
                      )
                    }
                  />
                  <span className="tag">{p.kind}</span>
                  <strong>{p.title}</strong>
                  {p.imported && <span className="tag green">Imported</span>}
                </summary>
                <div className="markdown">
                  <Markdown skipHtml>{p.body}</Markdown>
                </div>
                <p className="help">
                  Sources: {p.references.join(", ") || "No source references"}
                </p>
              </details>
            ))}
            <button
              className="button primary"
              disabled={
                !batch.proposals.some(
                  (p: any) => !p.imported && checked.includes(p.id),
                )
              }
              onClick={async () => {
                try {
                  await api(`/import/${batch.id}/apply`, "POST", {
                    ids: checked,
                    revision: batch.revision,
                    actor,
                  });
                  setChecked([]);
                  await reload();
                  load();
                  setMessage("Selected proposals imported.");
                } catch (e) {
                  onError(String(e));
                }
              }}
            >
              Import selected proposals
            </button>
          </div>
        ))}
        {!batches.length && (
          <div className="empty-inline">
            No staged proposals yet. Prepare a briefing, then ask your agent to
            return a proposal file.
          </div>
        )}
      </section>
    </div>
  );
}
