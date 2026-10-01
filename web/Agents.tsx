import { AgentConfigProposals } from "./AgentConfigProposals";
import type { AgentConfigProposal } from "../src/agent-config-proposals";
import { useEffect, useRef, useState } from "react";
import type {
  AgentProfile,
  ManagedRun,
  OrchestrationConfig,
} from "../src/orchestration-types";
import type { ProjectState } from "../src/types";
import { actor, api, isRemoteBrowser, recordId } from "./api";
import { WorkerPermissionsEditor } from "./WorkerPermissions";
import "./agents.css";
import { CompanionRepositories } from "./CompanionRepositories";
type Snapshot = {
  proposals?: {
    proposals: AgentConfigProposal[];
    errors: { path: string; message: string }[];
  };
  config: OrchestrationConfig;
  revision: string;
  workerBrief: { path: string; content: string; revision: string };
  runs: (ManagedRun & { verifiedRunning: boolean })[];
};
export function Agents({
  state,
  onOpen,
  reload,
}: {
  state: ProjectState;
  onOpen: (id: string) => void;
  reload: () => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(),
    [draft, setDraft] = useState<OrchestrationConfig>(),
    [workerBrief, setWorkerBrief] = useState(""),
    [revision, setRevision] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState(""),
    [kind, setKind] = useState("work"),
    [worker, setWorker] = useState("");
  const [log, setLog] = useState<{ id: string; text: string }>(),
    [filter, setFilter] = useState("all");
  const initialized = useRef(false),
    remote = isRemoteBrowser();
  async function load() {
    const next = await api<Snapshot>("/orchestration");
    setSnapshot(next);
    if (!initialized.current) {
      initialized.current = true;
      setDraft(next.config);
      setRevision(next.revision);
      setWorkerBrief(next.workerBrief.content);
    }
  }
  useEffect(() => {
    if (remote) return;
    void load().catch((e) => setError(String(e)));
    const timer = setInterval(() => {
      void load().catch((e) => setError(String(e)));
    }, 3000);
    return () => clearInterval(timer);
  }, []);
  async function action(fn: () => Promise<unknown>, message = "") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
      await reload();
      setNotice(message);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  if (remote)
    return (
      <section className="agents-page">
        <h1>Agents</h1>
        <p>
          Open Control Room on this Mac at 127.0.0.1 to configure or supervise
          coding agents. Assignments and review comments remain visible on the
          board.
        </p>
      </section>
    );
  if (!draft || !snapshot)
    return (
      <section className="agents-page">
        <h1>Agents</h1>
        <p role={error ? "alert" : undefined}>{error || "Loading agents…"}</p>
      </section>
    );
  const patch = (v: Partial<OrchestrationConfig>) =>
    setDraft({ ...draft, ...v });
  const role = (status: string) =>
    state.config.columns.find((c) => c.id === status)?.role;
  function approved(id: string, seen = new Set<string>()): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    const t = state.records.find((r) => r.meta.id === id);
    return (
      !!t &&
      (!!t.meta.scopeApproved ||
        (!!t.meta.parent && approved(t.meta.parent, seen)))
    );
  }
  const tickets = state.records.filter(
    (r) =>
      r.meta.kind === "ticket" &&
      !r.meta.archived &&
      role(r.meta.status) !== "done" &&
      approved(r.meta.id),
  );
  const runs = snapshot.runs
    .filter(
      (r) =>
        filter === "all" ||
        (filter === "needs-human"
          ? ["waiting_input", "recovery", "failed", "interrupted"].includes(
              r.state,
            )
          : r.kind === filter),
    )
    .slice()
    .reverse();
  return (
    <section className="agents-page">
      <header className="agents-heading">
        <div>
          <h1>Agents</h1>
          <p>
            Delegate approved work. Review the evidence. Keep human judgment in
            the loop.
          </p>
        </div>
        <span className={`tag ${snapshot.config.enabled ? "green" : ""}`}>
          {snapshot.config.enabled
            ? "Orchestration enabled"
            : "Human review only"}
        </span>
      </header>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="agent-roster" aria-label="Agent roster">
        {[snapshot.config.reviewer, ...snapshot.config.workers].map((a, i) => (
          <article key={a.name}>
            <strong>{a.name}</strong>
            <span>{i === 0 ? "Orchestrator / reviewer" : "Worker"}</span>
            <small>
              {i === 0 && snapshot.config.reviewerMode === "chat"
                ? "External chat · no reviewer process"
                : `${a.provider} · ${a.model || "CLI default model"}`}
            </small>
            <small>
              {
                snapshot.runs.filter(
                  (r) => r.agent.name === a.name && r.verifiedRunning,
                ).length
              }{" "}
              verified running
            </small>
          </article>
        ))}
      </div>
      <AgentConfigProposals
        proposals={snapshot.proposals?.proposals ?? []}
        errors={snapshot.proposals?.errors ?? []}
        config={snapshot.config}
        workerBrief={snapshot.workerBrief.content}
        revision={snapshot.revision}
        busy={busy}
        onApply={(proposal) =>
          void action(async () => {
            const next = await api<Snapshot>(
              `/orchestration/proposals/${proposal.id}/apply`,
              "POST",
              { actor, revision: proposal.revision },
            );
            setDraft(next.config);
            setRevision(next.revision);
            setWorkerBrief(next.workerBrief.content);
          }, "Proposal applied. Agent configuration updated.")
        }
        onDiscard={(proposal) =>
          void action(
            () =>
              api(`/orchestration/proposals/${proposal.id}/discard`, "POST", {
                actor,
                revision: proposal.revision,
              }),
            "Proposal discarded. Configuration unchanged.",
          )
        }
      />
      <details className="agent-settings">
        <summary>Agent configuration</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              const next = await api<Snapshot>("/orchestration/config", "PUT", {
                config: draft,
                revision,
                workerBrief,
                actor,
              });
              setDraft(next.config);
              setRevision(next.revision);
            }, "Configuration saved. Existing runs need an explicit resume after configuration changes.");
          }}
        >
          <label className="agent-check">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            Enable managed agents and orchestrator acceptance
          </label>
          <p>
            Uses locally installed, authenticated Codex CLI or Claude Code.
            Enabling does not start work until you delegate a ticket.
          </p>
          <div className="agent-fields">
            <label>
              Code repository
              <input
                value={draft.repository}
                placeholder="/absolute/path/to/project"
                onChange={(e) => patch({ repository: e.target.value })}
              />
            </label>
            <label>
              Base branch / ref
              <input
                value={draft.baseRef}
                onChange={(e) => patch({ baseRef: e.target.value })}
              />
            </label>
            <label>
              Independent verification command
              <input
                value={draft.verificationCommand}
                placeholder="npm test"
                onChange={(e) => patch({ verificationCommand: e.target.value })}
              />
            </label>
            <label>
              Mandatory human review
              <select
                value={draft.humanPolicy}
                onChange={(e) =>
                  patch({
                    humanPolicy: e.target
                      .value as OrchestrationConfig["humanPolicy"],
                  })
                }
              >
                <option value="flagged">
                  Flagged tickets and reviewer uncertainty
                </option>
                <option value="parents">
                  Every parent goal, plus flagged tickets
                </option>
                <option value="all">Every ticket</option>
              </select>
            </label>
            {(
              [
                ["concurrency", "Concurrent processes", 1, 8],
                [
                  "timeoutMinutes",
                  "Time limit per model step (minutes)",
                  1,
                  720,
                ],
                ["maxAttempts", "Maximum attempts", 1, 10],
                ["maxTurns", "Claude turn limit", 1, 1000],
              ] as const
            ).map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  value={draft[key]}
                  onChange={(e) => patch({ [key]: Number(e.target.value) })}
                />
              </label>
            ))}
            <label>
              Verification time limit (minutes)
              <input
                aria-label="Verification time limit (minutes)"
                type="number"
                min={1}
                max={720}
                placeholder={`Use model limit (${draft.timeoutMinutes})`}
                value={draft.verificationTimeoutMinutes ?? ""}
                onChange={(e) =>
                  patch({
                    verificationTimeoutMinutes: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  })
                }
              />
              <small>Blank uses the model step limit.</small>
            </label>
          </div>
          <CompanionRepositories
            value={draft.companionRepositories ?? []}
            onChange={(companionRepositories) =>
              patch({ companionRepositories })
            }
          />
          <label>
            Orchestration location
            <select
              aria-label="Orchestration location"
              value={draft.reviewerMode ?? "managed"}
              onChange={(e) =>
                patch({ reviewerMode: e.target.value as "managed" | "chat" })
              }
            >
              <option value="managed">Managed CLI planner and reviewer</option>
              <option value="chat">Existing chat orchestrator</option>
            </select>
          </label>
          {draft.reviewerMode === "chat" ? (
            <label>
              Chat orchestrator identity
              <input
                value={draft.reviewer.name}
                onChange={(e) =>
                  patch({
                    reviewer: { ...draft.reviewer, name: e.target.value },
                  })
                }
              />
              <small>
                Workers wait for this chat to inspect their submissions. This
                does not automatically wake or monitor the chat.
              </small>
            </label>
          ) : (
            <AgentFields
              title="Orchestrator"
              value={draft.reviewer}
              onChange={(reviewer) => patch({ reviewer })}
            />
          )}
          {draft.workers.map((w, i) => (
            <div key={i}>
              <AgentFields
                title={`Worker ${i + 1}`}
                value={w}
                onChange={(value) =>
                  patch({
                    workers: draft.workers.map((a, j) => (j === i ? value : a)),
                  })
                }
              />
              {draft.workers.length > 1 && (
                <button
                  className="button"
                  type="button"
                  onClick={() =>
                    patch({ workers: draft.workers.filter((_, j) => j !== i) })
                  }
                >
                  Remove worker {i + 1}
                </button>
              )}
            </div>
          ))}
          <WorkerPermissionsEditor
            value={
              draft.workerPermissions ?? {
                claudeAllowedTools: [],
                additionalDirectories: [],
                environment: [],
              }
            }
            workerBrief={workerBrief}
            onChange={(workerPermissions) => patch({ workerPermissions })}
            onBriefChange={setWorkerBrief}
          />
          <div className="agent-actions">
            <button
              className="button"
              type="button"
              disabled={draft.workers.length >= 8}
              onClick={() =>
                patch({
                  workers: [
                    ...draft.workers,
                    {
                      name: `Worker ${draft.workers.length + 1}`,
                      provider: "codex",
                      executable: "codex",
                      model: "",
                    },
                  ],
                })
              }
            >
              Add worker
            </button>
            <button className="button primary" disabled={busy}>
              Save agent configuration
            </button>
            <button
              className="button"
              type="button"
              onClick={() => {
                setDraft(snapshot.config);
                setRevision(snapshot.revision);
                setWorkerBrief(snapshot.workerBrief.content);
              }}
            >
              Reload saved configuration
            </button>
          </div>
          <p>
            Workers use isolated Git worktrees; successful submissions are
            committed there. Acceptance never merges, pushes or deploys. Merge
            accepted branches into the base before dependent work starts. Logs
            stay local and may contain project content.
          </p>
        </form>
      </details>
      <form
        className="agent-delegate"
        onSubmit={(e) => {
          e.preventDefault();
          const t = tickets.find((t) => t.meta.id === ticket);
          if (!t) return;
          void action(
            () =>
              api("/orchestration/queue", "POST", {
                ticket,
                revision: t.revision,
                kind,
                worker: worker || undefined,
                actor,
              }),
            "Assignment queued.",
          );
        }}
      >
        <h2>Delegate work</h2>
        <div className="agent-fields">
          <label>
            Approved ticket
            <select
              value={ticket}
              required
              onChange={(e) => setTicket(e.target.value)}
            >
              <option value="">Choose a ticket or goal</option>
              {tickets.map((t) => (
                <option value={t.meta.id} key={t.meta.id}>
                  {recordId(t)} {t.meta.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Action
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="work">Implement / verify this ticket</option>
              <option
                value="plan"
                disabled={snapshot.config.reviewerMode === "chat"}
              >
                Decompose goal and assign children
              </option>
            </select>
          </label>
          <label>
            Worker
            <select
              value={worker}
              disabled={kind === "plan"}
              required={kind === "work"}
              onChange={(e) => setWorker(e.target.value)}
            >
              <option value="">
                Choose the worker best suited to this task
              </option>
              {snapshot.config.workers.map((w) => (
                <option key={w.name} value={w.name}>
                  {w.name} · {w.model || w.provider}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="button primary"
          disabled={
            busy ||
            !snapshot.config.enabled ||
            !tickets.some((t) => t.meta.id === ticket) ||
            (kind === "work" &&
              !snapshot.config.workers.some((w) => w.name === worker))
          }
        >
          Queue assignment
        </button>
      </form>
      <div className="agents-heading">
        <h2>Runs & review queue</h2>
        <label>
          Show runs
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All runs</option>
            <option value="work">Workers</option>
            <option value="review">Reviews</option>
            <option value="plan">Plans</option>
            <option value="needs-human">Needs human / recovery</option>
          </select>
        </label>
      </div>
      {!runs.length && (
        <div className="agent-empty">
          No managed runs yet. Choose an approved ticket above to start.
        </div>
      )}
      <div className="agent-runs">
        {runs.map((run) => {
          const t = state.records.find((t) => t.meta.id === run.ticket);
          const ticketRole = state.config.columns.find(
            (c) => c.id === t?.meta.status,
          )?.role;
          const takeoverEligible =
            t &&
            !t.meta.archived &&
            ticketRole !== "done" &&
            ticketRole !== "review" &&
            (["assigned", "acknowledged"].includes(
              t.meta.assignment?.state ?? "",
            ) ||
              (t.meta.assignment?.state === "submitted" &&
                (ticketRole === "selected" || ticketRole === "progress")));
          return (
            <article key={run.id} className="agent-run">
              <header>
                <button
                  className="agent-ticket"
                  onClick={() => onOpen(run.ticket)}
                >
                  {t ? `${recordId(t)} ${t.meta.title}` : run.ticket}
                </button>
                <span
                  className={`tag ${run.state === "completed" ? "green" : ""}`}
                >
                  {run.state.replaceAll("_", " ")}
                </span>
              </header>
              <p>
                {run.agent.name} · {run.kind} · attempt {run.attempt} ·{" "}
                {run.verifiedRunning
                  ? "Process verified running"
                  : "No running process verified"}
              </p>
              <small>
                Last reported event: {run.lastEvent ?? "none"} ·{" "}
                {new Date(run.updatedAt).toLocaleString()}
              </small>
              {run.error && <p className="agent-error">{run.error}</p>}
              {run.failureKind === "limit" && (
                <p className="agent-limit">
                  {run.limitReason === "turns"
                    ? "Turn limit reached"
                    : "Time limit reached"}
                  . Resume continues this retained checkout and provider
                  session; it does not start another attempt.
                </p>
              )}
              {run.result && <p>{run.result.summary}</p>}
              {t?.meta.agentReview?.runId === run.id && (
                <p>
                  <strong>
                    {t.meta.agentReview.outcome === "accept"
                      ? `Accepted by ${t.meta.agentReview.reviewer}`
                      : `Reviewer outcome: ${t.meta.agentReview.outcome}`}
                  </strong>{" "}
                  · Review snapshot; integration is tracked in the ticket
                  handoff.
                </p>
              )}
              <details>
                <summary>Run details</summary>
                <dl>
                  <dt>Run</dt>
                  <dd>{run.id}</dd>
                  <dt>Provider / model</dt>
                  <dd>
                    {run.agent.provider} / {run.agent.model || "CLI default"}
                  </dd>
                  <dt>Worktree</dt>
                  <dd>{run.worktree || "Not allocated"}</dd>
                  <dt>Branch</dt>
                  <dd>{run.branch || "Not allocated"}</dd>
                  {run.repositories?.map((repository) => (
                    <div key={repository.name}>
                      <dt>{repository.name} repository</dt>
                      <dd>
                        {repository.worktree} · {repository.mode} ·{" "}
                        {repository.branch ??
                          `detached ${repository.baseCommit}`}
                      </dd>
                    </div>
                  ))}
                  <dt>Code identity</dt>
                  <dd>{run.snapshot || "No submission"}</dd>
                  <dt>Session</dt>
                  <dd>{run.sessionId || "Not reported"}</dd>
                  <dt>Launch</dt>
                  <dd>
                    {run.launch
                      ? [run.launch.command, ...run.launch.args].join(" ")
                      : "Not launched"}
                  </dd>
                  <dt>Environment</dt>
                  <dd>
                    {run.launch?.environment.length
                      ? run.launch.environment.join(", ") + " (values hidden)"
                      : "No project variables"}
                  </dd>
                </dl>
                {run.result && (
                  <>
                    <h4>Criteria checked</h4>
                    <p>{run.result.criteria}</p>
                    <h4>Evidence</h4>
                    <p>{run.result.evidence}</p>
                  </>
                )}
              </details>
              <div className="agent-actions">
                <button
                  className="button"
                  onClick={() =>
                    void action(async () => {
                      const result = await api<{ log: string }>(
                        `/orchestration/${run.id}/log`,
                      );
                      setLog({
                        id: run.id,
                        text: result.log || "No process output recorded.",
                      });
                    })
                  }
                >
                  View log
                </button>
                {[
                  "queued",
                  "awaiting_review",
                  "launching",
                  "running",
                  "verifying",
                  "waiting_input",
                  "recovery",
                ].includes(run.state) && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void action(() =>
                        api(`/orchestration/${run.id}/stop`, "POST", { actor }),
                      )
                    }
                  >
                    Stop run
                  </button>
                )}
                {[
                  "waiting_input",
                  "interrupted",
                  "recovery",
                  "failed",
                ].includes(run.state) && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void action(() =>
                        api(`/orchestration/${run.id}/resume`, "POST", {
                          actor,
                        }),
                      )
                    }
                  >
                    {run.failureKind === "limit"
                      ? "Resume retained session"
                      : "Resume with current context"}
                  </button>
                )}
                {run.kind === "work" &&
                  run.state === "interrupted" &&
                  t?.meta.assignment?.runId === run.id &&
                  t.meta.assignment.worker === run.agent.name &&
                  takeoverEligible && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        void action(
                          () =>
                            api(`/orchestration/${run.id}/takeover`, "POST", {
                              revision: t.revision,
                              actor,
                            }),
                          "Stopped assignment taken over under your identity.",
                        )
                      }
                    >
                      Take over ticket
                    </button>
                  )}
              </div>
            </article>
          );
        })}
      </div>
      {log && <AgentLog log={log} onClose={() => setLog(undefined)} />}
    </section>
  );
}
function AgentLog({
  log,
  onClose,
}: {
  log: { id: string; text: string };
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="agent-log"
      aria-label="Agent run log"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <strong>{log.id}</strong>
        <button className="button" onClick={onClose}>
          Close log
        </button>
      </header>
      <pre tabIndex={0}>{log.text}</pre>
    </dialog>
  );
}
function AgentFields({
  title,
  value,
  onChange,
}: {
  title: string;
  value: AgentProfile;
  onChange: (p: AgentProfile) => void;
}) {
  return (
    <fieldset>
      <legend>{title}</legend>
      <div className="agent-fields">
        <label>
          {title} name
          <input
            required
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
        </label>
        <label>
          {title} tool
          <select
            value={value.provider}
            onChange={(e) =>
              onChange({
                ...value,
                provider: e.target.value as AgentProfile["provider"],
                executable: e.target.value,
              })
            }
          >
            <option value="codex">Codex CLI</option>
            <option value="claude">Claude Code</option>
          </select>
        </label>
        <label>
          {title} executable
          <input
            required
            value={value.executable}
            onChange={(e) => onChange({ ...value, executable: e.target.value })}
          />
        </label>
        <label>
          {title} model
          <input
            value={value.model}
            placeholder="Use CLI default"
            onChange={(e) => onChange({ ...value, model: e.target.value })}
          />
        </label>
        <label>
          {title} turn limit override
          <input
            type="number"
            min={1}
            max={1000}
            placeholder="Use global limit"
            value={value.maxTurns ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                maxTurns: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          />
        </label>
        <label>
          {title} time limit override (minutes)
          <input
            type="number"
            min={1}
            max={720}
            placeholder="Use global limit"
            value={value.timeoutMinutes ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                timeoutMinutes: e.target.value
                  ? Number(e.target.value)
                  : undefined,
              })
            }
          />
        </label>
        <label>
          {title} role note
          <textarea
            rows={3}
            value={value.roleNote ?? ""}
            placeholder="Optional working role for this profile"
            onChange={(e) => onChange({ ...value, roleNote: e.target.value })}
          />
        </label>
      </div>
    </fieldset>
  );
}
