// A Model Context Protocol server over stdio, so coding agents call the
// board as typed tools instead of shelling out. `controlroom mcp` starts it;
// register it with your agent (for Claude Code: `claude mcp add controlroom
// -- ./controlroom mcp`). Every call goes through the same local service as the
// CLI, so revisions, authority, and claims behave identically.
import readline from "node:readline";
import path from "node:path";
import type { Store } from "./store.js";
import {
  api as clientApi,
  ApiError,
  commitsSince,
  currentBranch,
  filterRecords,
  runVerification,
  waitForChange,
} from "./client.js";
import type { Actor } from "./types.js";
import { decisionProtocol } from "./decision-protocol.js";

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: any, signal: AbortSignal) => Promise<unknown>;
};
const str = (description: string) => ({ type: "string", description });
const id = str("Ticket number like 3 or #3, or a record ID");
const etag = str(
  "The record's current etag (revision) from get_ticket or get_context; guards against overwriting someone else's edit",
);

export async function startMcp(
  store: Store,
  who: Actor,
  worktree = process.cwd(),
  allowStart = true,
) {
  const api = <T = any>(
    store: Store,
    url: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ) => clientApi<T>(store, url, method, body, signal, allowStart);
  const cwd = path.resolve(worktree);
  const text = (v: unknown) =>
    typeof v === "string" ? v : JSON.stringify(v, null, 2);
  const basisFields = {
    on_behalf: str(
      "Exact words of a decision actually given by the human in this chat; never infer or invent approval",
    ),
    said_at: str("ISO timestamp when that human decision was given"),
  };
  function basis(a: any) {
    if (a.on_behalf === undefined && a.said_at === undefined) return undefined;
    if (
      !a.on_behalf?.trim() ||
      !a.said_at?.trim() ||
      !Number.isFinite(Date.parse(a.said_at))
    )
      throw new Error(
        "Provide both on_behalf (the human's words) and said_at (their timestamp).",
      );
    return {
      quote: a.on_behalf.trim(),
      saidAt: new Date(a.said_at).toISOString(),
    };
  }
  function delegated(a: any, input: Record<string, unknown>) {
    const decision = basis(a);
    if (!decision)
      throw new Error("A delegated action requires on_behalf and said_at.");
    return api(store, "/api/orchestration/delegation/actions", "POST", {
      ...input,
      basis: decision,
      actor: who,
    });
  }
  function reviewBuild(a: any) {
    if (
      a.build === undefined &&
      (a.build_label !== undefined || a.build_sha !== undefined)
    )
      throw new Error("build_label and build_sha require build");
    if (
      a.build !== undefined &&
      (!a.build.trim() ||
        a.build.includes("\0") ||
        /^[A-Za-z][A-Za-z0-9+.-]*:/.test(a.build.trim()))
    )
      throw new Error("build must be a nonempty local file path, not a URL");
    return a.build === undefined
      ? undefined
      : {
          path: a.build,
          ...(a.build_label === undefined ? {} : { label: a.build_label }),
          ...(a.build_sha === undefined ? {} : { sha: a.build_sha }),
        };
  }
  const tools: Tool[] = [
    {
      name: "get_delegation",
      description:
        "Read the current human-granted chat delegation and durable action receipts. This never enables or expands authority.",
      inputSchema: { type: "object", properties: {} },
      run: () => api(store, "/api/orchestration/delegation"),
    },
    ...(
      ["approve", "accept", "request_changes", "archive", "unarchive"] as const
    ).map(
      (action): Tool => ({
        name: `${action}_ticket`,
        description: `Record the human's chat decision to ${action.replaceAll("_", " ")} a ticket. Requires a current matching delegation for this exact agent, a current etag, and the human's exact words/timestamp. Actor stays agent; every action is audited for human review and guarded Undo. No grant is activated by this tool.`,
        inputSchema: {
          type: "object",
          properties: {
            id,
            etag,
            ...basisFields,
            feedback: str(
              "Review feedback for acceptance or requested changes",
            ),
            target: str("Optional destination column for a review outcome"),
            request_id: str(
              "Optional stable UUID for retrying a review outcome after a lost response",
            ),
          },
          required: ["id", "etag", "on_behalf", "said_at"],
        },
        run: (a) =>
          delegated(a, {
            action: action === "unarchive" ? "archive" : action,
            ticket: a.id,
            revision: a.etag,
            ...(action === "archive" || action === "unarchive"
              ? { archived: action === "archive" }
              : {}),
            ...(["accept", "request_changes"].includes(action)
              ? {
                  feedback: a.feedback ?? "",
                  target: a.target,
                  requestId: a.request_id,
                }
              : {}),
          }),
      }),
    ),
    {
      name: "resolve_managed_question",
      description:
        "Record the human's actual chat answer and retry instruction for the current managed question. Requires manageRuns delegation, ticket and question revisions; existing process/scope/recovery guards remain. Never invent an answer.",
      inputSchema: {
        type: "object",
        properties: {
          id,
          etag,
          run: str("Current managed run ID"),
          question: str("Current question comment ID"),
          question_etag: str("Current question revision"),
          answer: str(
            "Optional answer text; defaults to the human's quoted chat words",
          ),
          ...basisFields,
        },
        required: [
          "id",
          "etag",
          "run",
          "question",
          "question_etag",
          "on_behalf",
          "said_at",
        ],
      },
      run: (a) =>
        delegated(a, {
          action: "resolve",
          ticket: a.id,
          revision: a.etag,
          runId: a.run,
          questionId: a.question,
          questionRevision: a.question_etag,
          answer: a.answer ?? a.on_behalf,
        }),
    },
    {
      name: "resume_managed_run",
      description:
        "Resume a stopped/recoverable managed run only on a human's actual chat instruction under manageRuns delegation. Requires current ticket etag; process, ownership and scope checks remain.",
      inputSchema: {
        type: "object",
        properties: { id, etag, run: str("Run ID to resume"), ...basisFields },
        required: ["id", "etag", "run", "on_behalf", "said_at"],
      },
      run: (a) =>
        delegated(a, {
          action: "resume",
          ticket: a.id,
          revision: a.etag,
          runId: a.run,
        }),
    },
    {
      name: "agent_review_context",
      description:
        "The designated chat orchestrator retrieves a managed submission, exact worktree/base commit, criteria/guidance and a freshness token. Inspect the code before submitting a decision.",
      inputSchema: {
        type: "object",
        properties: { run: str("Awaiting-review run ID") },
        required: ["run"],
      },
      run: (a) =>
        api(
          store,
          `/api/orchestration/${encodeURIComponent(a.run)}/review-context`,
          "POST",
          { actor: who },
        ),
    },
    {
      name: "review_agent_submission",
      description:
        "Submit an independently reasoned chat review. The service verifies code and evidence again, enforces human gates, and rejects changed context. No implicit Git integration.",
      inputSchema: {
        type: "object",
        properties: {
          run: str("Review run ID"),
          token: str("Token from agent_review_context"),
          result: {
            type: "object",
            properties: {
              outcome: { type: "string", enum: ["accept", "changes", "human"] },
              summary: str("Review rationale"),
              criteria: str("Acceptance criteria checked"),
              evidence: str("Independent evidence inspected"),
              question: str("Human question, or empty string"),
            },
            required: [
              "outcome",
              "summary",
              "criteria",
              "evidence",
              "question",
            ],
          },
        },
        required: ["run", "token", "result"],
      },
      run: (a) =>
        api(
          store,
          `/api/orchestration/${encodeURIComponent(a.run)}/review`,
          "POST",
          { token: a.token, result: a.result, actor: who },
        ),
    },
    {
      name: "agent_runs",
      description:
        "Inspect the configured orchestrator, worker roster, assignments and managed process states. A claim or last event is not proof of running. Configuration requires a human on the local host.",
      inputSchema: { type: "object", properties: {} },
      run: () => api(store, "/api/orchestration"),
    },
    {
      name: "propose_agent_config",
      description:
        "Stage a full agent configuration for human review. This never changes the live configuration or starts agents. A human sees the exact diff and must Apply it. Optionally pass the current agent_runs revision to reject stale proposals.",
      inputSchema: {
        type: "object",
        properties: {
          config: { type: "object", additionalProperties: true },
          revision: str("Current configuration revision from agent_runs"),
          workerBrief: str(
            "Optional proposed project worker brief Markdown; omitted preserves the current brief",
          ),
        },
        required: ["config"],
      },
      run: (a) =>
        api(store, "/api/orchestration/proposals", "POST", {
          config: a.config,
          revision: a.revision,
          workerBrief: a.workerBrief,
          actor: who,
        }),
    },
    {
      name: "delegate_ticket",
      description:
        "The human-designated orchestrator can queue approved work or decompose an approved goal. The service launches an isolated worker, independently verifies and reviews results. Workers cannot self-accept. No implicit merge, push or deployment.",
      inputSchema: {
        type: "object",
        properties: {
          ticket: id,
          revision: etag,
          kind: { type: "string", enum: ["plan", "work"] },
          worker: str(
            "Required for work: explicitly choose the configured worker best suited to the task complexity, uncertainty and risk. Omit only for plan.",
          ),
        },
        required: ["ticket", "revision", "kind"],
      },
      run: (a) =>
        api(store, "/api/orchestration/queue", "POST", { ...a, actor: who }),
    },
    {
      name: "stop_agent_run",
      description:
        "The designated orchestrator or human can cancel a managed run. Its checkout and evidence remain available; a recovered unknown process is never blindly killed.",
      inputSchema: {
        type: "object",
        properties: { run: str("Managed run ID") },
        required: ["run"],
      },
      run: (a) =>
        api(
          store,
          `/api/orchestration/${encodeURIComponent(a.run)}/stop`,
          "POST",
          { actor: who },
        ),
    },
    {
      name: "take_over_stopped_agent_run",
      description:
        "Explicitly take over an interrupted managed worker ticket under your own identity. Only the designated orchestrator or a human may do this. The service requires the current ticket etag and matching run/assignment, verifies that owned processes exited, retains the original run/worktree/logs/history, and releases only its obsolete claim.",
      inputSchema: {
        type: "object",
        properties: {
          run: str("Interrupted managed worker run ID"),
          revision: etag,
        },
        required: ["run", "revision"],
      },
      run: (a) =>
        api(
          store,
          `/api/orchestration/${encodeURIComponent(a.run)}/takeover`,
          "POST",
          { revision: a.revision, actor: who },
        ),
    },
    {
      name: "list_tickets",
      description:
        "List tickets on the board, optionally filtered. Returns number, status, title, owner, labels, and etag for each.",
      inputSchema: {
        type: "object",
        properties: {
          status: str(
            "Comma-separated status ids, names, or roles (backlog, selected, progress, review, done)",
          ),
          owner: str("Owner name"),
          label: str("Comma-separated labels; any match"),
          mine: {
            type: "boolean",
            description: "Only tickets I own or have claimed",
          },
          open: { type: "boolean", description: "Exclude Done" },
          archived: {
            type: "boolean",
            description: "Show archived tickets instead",
          },
        },
      },
      run: async (a) => {
        const state = await api(store, "/api/state");
        return filterRecords(state.records, {
          kind: "ticket",
          status: a.status,
          owner: a.owner,
          label: a.label,
          mine: a.mine ? who.name : undefined,
          open: a.open,
          archived: a.archived,
          columns: state.config.columns,
          claims: state.claims,
        }).map((r) => ({
          number: r.meta.number,
          id: r.meta.id,
          status: r.meta.status,
          title: r.meta.title,
          owner: r.meta.owner,
          labels: r.meta.labels,
          priority: r.meta.priority ?? 2,
          parent: r.meta.parent,
          related: r.meta.related,
          duplicateOf: r.meta.duplicateOf,
          blocked: r.meta.blocked,
          etag: r.revision,
        }));
      },
    },
    {
      name: "get_ticket",
      description:
        "One record (ticket, decision, or rule) with its body and etag.",
      inputSchema: { type: "object", properties: { id }, required: ["id"] },
      run: (a) => api(store, `/api/records/${encodeURIComponent(a.id)}`),
    },
    {
      name: "get_context",
      description:
        "Everything an agent needs before working on a ticket, as a prompt-ready Markdown brief: description, approved scope, applicable decisions and rules, non-blocking related tickets, preserved duplicate provenance, dependencies, conversation, screenshot paths, claim, and the protocol to follow. Includes the etag.",
      inputSchema: {
        type: "object",
        properties: {
          id,
          brief: {
            type: "boolean",
            description:
              "Trim decision and rule bodies to their first paragraph and keep the last five comments (default true)",
          },
        },
        required: ["id"],
      },
      run: async (a) => {
        const r = await api(
          store,
          `/api/records/${encodeURIComponent(a.id)}/context?format=markdown${a.brief === false ? "" : "&brief=1"}`,
        );
        return `${r.markdown}\n<!-- about ${r.tokens} tokens -->`;
      },
    },
    {
      name: "next_ticket",
      description:
        "The ticket this agent should pick up next: unclaimed or claimed by me, not blocked, inside a human-approved scope, Selected before Backlog, by priority. Returns its brief, or explains why there is nothing to do.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const r = await api(store, "/api/next", "POST", { actor: who });
        return r.ticket
          ? r.brief.markdown
          : "Nothing to pick up: no unclaimed, unblocked ticket inside an approved scope. Ask a human to approve a scope or select work.";
      },
    },
    {
      name: "claim_ticket",
      description:
        "Claim a ticket for this agent before working on it (30-minute lease; call again to renew). Fails if someone else holds a live claim.",
      inputSchema: {
        type: "object",
        properties: {
          id,
          worktree: str(
            "Absolute path of the worktree doing the work (defaults to the MCP execution directory)",
          ),
        },
        required: ["id"],
      },
      run: (a) =>
        api(store, `/api/records/${encodeURIComponent(a.id)}/claim`, "POST", {
          actor: who,
          worktree: a.worktree ?? cwd,
          release: false,
        }),
    },
    {
      name: "release_ticket",
      description:
        "Release this agent's claim on a ticket, for example when pausing.",
      inputSchema: { type: "object", properties: { id }, required: ["id"] },
      run: (a) =>
        api(store, `/api/records/${encodeURIComponent(a.id)}/claim`, "POST", {
          actor: who,
          worktree: cwd,
          release: true,
        }),
    },
    {
      name: "create_ticket",
      description:
        "Create a ticket. Agents may create backlog tickets anywhere; selecting or implementing needs an approved scope.",
      inputSchema: {
        type: "object",
        properties: {
          title: str("Short imperative title"),
          body: str(
            "Markdown description, acceptance criteria, starting points",
          ),
          parent: str("Parent ticket (number or ID) for grouping under a goal"),
          labels: { type: "array", items: { type: "string" } },
          priority: {
            type: "integer",
            description: "0 urgent, 1 high, 2 normal (default), 3 low",
          },
        },
        required: ["title"],
      },
      run: (a) =>
        api(store, "/api/records", "POST", {
          kind: "ticket",
          meta: {
            title: a.title,
            parent: a.parent ?? null,
            ...(a.labels ? { labels: a.labels } : {}),
            ...(a.priority !== undefined ? { priority: a.priority } : {}),
          },
          body: a.body ?? "",
          actor: who,
        }),
    },
    {
      name: "update_ticket",
      description:
        "Change fields on a ticket (title, labels, priority, owner, parent, dependencies, blocked, handoff, branch, pr, build) and/or replace its body. A build may be a local path string, null to clear, or {path,label?,sha?}; Control Room stamps its actor and time. Needs the current etag.",
      inputSchema: {
        type: "object",
        properties: {
          id,
          etag,
          fields: {
            type: "object",
            description:
              "Field values to set; omit fields to leave them unchanged",
            additionalProperties: true,
          },
          body: str("New Markdown body (replaces the whole body)"),
          ...basisFields,
        },
        required: ["id", "etag"],
      },
      run: (a) =>
        basis(a)
          ? delegated(a, {
              action: "update",
              ticket: a.id,
              revision: a.etag,
              patch: a.fields ?? {},
              body: a.body,
            })
          : api(store, `/api/records/${encodeURIComponent(a.id)}`, "PATCH", {
              revision: a.etag,
              patch: a.fields ?? {},
              body: a.body,
              actor: who,
            }),
    },
    {
      name: "move_ticket",
      description:
        "Move a ticket to a status (column id or role: backlog, selected, progress, review). Agents cannot move to done; use submit_review to reach review with evidence.",
      inputSchema: {
        type: "object",
        properties: {
          id,
          etag,
          status: str("Column id, e.g. progress"),
          ...basisFields,
        },
        required: ["id", "etag", "status"],
      },
      run: async (a) => {
        const state = await api(store, "/api/state");
        const col = state.config.columns.find(
          (c: any) => c.id === a.status || c.role === a.status,
        );
        if (basis(a))
          return delegated(a, {
            action: "update",
            ticket: a.id,
            revision: a.etag,
            patch: { status: col?.id ?? a.status },
          });
        return api(store, `/api/records/${encodeURIComponent(a.id)}`, "PATCH", {
          revision: a.etag,
          patch: { status: col?.id ?? a.status },
          actor: who,
        });
      },
    },
    {
      name: "set_related_ticket",
      description:
        "Add or remove a reciprocal, non-blocking related-ticket link. Requires current etags for both records so neither side is silently overwritten.",
      inputSchema: {
        type: "object",
        properties: {
          id,
          other: str("Other ticket number or ID"),
          etag,
          other_etag: str("Current etag for the other ticket"),
          action: { type: "string", enum: ["add", "remove"] },
        },
        required: ["id", "other", "etag", "other_etag", "action"],
      },
      run: (a) =>
        api(
          store,
          `/api/records/${encodeURIComponent(a.id)}/relationships`,
          "POST",
          {
            other: a.other,
            revision: a.etag,
            otherRevision: a.other_etag,
            action: a.action,
            actor: who,
          },
        ),
    },
    {
      name: "preview_ticket_merge",
      description:
        "Preview merging a duplicate source into a chosen survivor. Returns preserved content, metadata conflicts, incoming parent/dependency rewrites, and the exact etag set required to apply it.",
      inputSchema: {
        type: "object",
        properties: {
          survivor: id,
          source: str("Duplicate source number or ID"),
        },
        required: ["survivor", "source"],
      },
      run: (a) =>
        api(
          store,
          `/api/records/${encodeURIComponent(a.survivor)}/merge-preview`,
          "POST",
          { source: a.source },
        ),
    },
    {
      name: "merge_duplicate_ticket",
      description:
        "Apply a reviewed duplicate merge. The survivor remains active; the source is archived as a duplicate without becoming Done. Supply all revisions from preview_ticket_merge and an explicit resolution for every reported conflict. Retries with the same request_id are idempotent.",
      inputSchema: {
        type: "object",
        properties: {
          survivor: id,
          source: str("Duplicate source number or ID"),
          request_id: str(
            "Stable unique ID reused only when retrying this merge",
          ),
          revisions: {
            type: "object",
            additionalProperties: { type: "string" },
            description:
              "Exact affected record etags returned by preview_ticket_merge",
          },
          resolutions: {
            type: "object",
            additionalProperties: {
              type: "string",
              enum: ["survivor", "source", "both"],
            },
            description:
              "Explicit choices for parent, status, owner, priority, and acceptanceCriteria conflicts; both is valid only for acceptanceCriteria",
          },
          ...basisFields,
        },
        required: [
          "survivor",
          "source",
          "request_id",
          "revisions",
          "resolutions",
        ],
      },
      run: (a) =>
        basis(a)
          ? delegated(a, {
              action: "merge",
              ticket: a.survivor,
              merge: {
                source: a.source,
                requestId: a.request_id,
                revisions: a.revisions,
                resolutions: a.resolutions,
              },
            })
          : api(
              store,
              `/api/records/${encodeURIComponent(a.survivor)}/merge`,
              "POST",
              {
                source: a.source,
                requestId: a.request_id,
                revisions: a.revisions,
                resolutions: a.resolutions,
                actor: who,
              },
            ),
    },
    {
      name: "comment",
      description:
        "Add to a ticket's conversation: a discovery, a progress note, or a handoff note. Use ask_question for things a human must answer.",
      inputSchema: {
        type: "object",
        properties: {
          id,
          body: str("Markdown"),
          kind: {
            type: "string",
            enum: ["comment", "handoff", "review"],
            description: "Default comment",
          },
        },
        required: ["id", "body"],
      },
      run: (a) =>
        api(
          store,
          `/api/records/${encodeURIComponent(a.id)}/comments`,
          "POST",
          {
            body: a.body,
            kind: a.kind ?? "comment",
            actor: who,
          },
        ),
    },
    {
      name: "ask_question",
      description:
        "Ask the human a question on a ticket. It appears in their Needs-you queue; use wait_for_update to block until they answer.",
      inputSchema: {
        type: "object",
        properties: { id, body: str("The question, with the options you see") },
        required: ["id", "body"],
      },
      run: (a) =>
        api(
          store,
          `/api/records/${encodeURIComponent(a.id)}/comments`,
          "POST",
          {
            body: a.body,
            kind: "question",
            actor: who,
          },
        ),
    },
    {
      name: "ask_questionnaire",
      description:
        "Attach persistent structured questions. Recommended choices are suggestions only; answers require explicit human submission. Supply replacing with the comment revision to replace questions while retaining history.",
      inputSchema: {
        type: "object",
        properties: {
          id,
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: str("Stable question ID"),
                prompt: str("Question wording"),
                type: { enum: ["text", "choice"] },
                required: { type: "boolean" },
                multiple: {
                  type: "boolean",
                  description:
                    "For choice questions, allow multiple selected options. Custom text remains separate.",
                },
                choices: { type: "array", items: { type: "string" } },
                recommended: { type: "string" },
              },
              required: ["id", "prompt", "type"],
            },
          },
          replacing: {
            type: "object",
            properties: { id: str("Questionnaire comment ID"), revision: etag },
            required: ["id", "revision"],
          },
        },
        required: ["id", "questions"],
      },
      run: (a) =>
        api(
          store,
          `/api/records/${encodeURIComponent(a.id)}/questionnaires`,
          "POST",
          { questions: a.questions, replacing: a.replacing, actor: who },
        ),
    },
    {
      name: "report_progress",
      description:
        "Report a progress note and optional 0–100 estimate. This is reported activity, not proof a process is running; 100% never completes the ticket.",
      inputSchema: {
        type: "object",
        properties: {
          id,
          etag,
          note: str("Concrete progress and remaining work"),
          percent: { type: "number", minimum: 0, maximum: 100 },
        },
        required: ["id", "etag", "note"],
      },
      run: (a) =>
        api(store, `/api/records/${encodeURIComponent(a.id)}`, "PATCH", {
          revision: a.etag,
          actor: who,
          patch: {
            progress: {
              note: a.note,
              ...(a.percent === undefined ? {} : { percent: a.percent }),
            },
          },
        }),
    },
    {
      name: "submit_review",
      description:
        "Submit finished work for human review with a handoff and evidence. Optionally run the verification command here so the result is recorded as it happened; a failing run is refused unless allow_failure is set. Records branch, pull request, commits, and an optional local build artifact on the ticket. This records a path; agents cannot launch it.",
      inputSchema: {
        type: "object",
        properties: {
          id,
          etag,
          handoff: str(
            "What changed, where things stand, the next concrete step",
          ),
          review_instructions: str(
            "Specific steps the human should take to review this work; published with the handoff and evidence in the conversation",
          ),
          manual_review_required: {
            type: "boolean",
            description:
              "Set false only when no manual checks are requested; a passing recorded run is still required for a current verification pass summary.",
          },
          evidence: str(
            "How it was verified (auto-filled from run when omitted)",
          ),
          run: str("Shell command to execute as verification, e.g. npm test"),
          allow_failure: { type: "boolean" },
          branch: str("Git branch (defaults to the current branch)"),
          pr: str("Pull request URL"),
          commits: { type: "array", items: { type: "string" } },
          commits_since: str(
            "Git ref; records `git log REF..HEAD` as the commits",
          ),
          build: str(
            "Local build artifact path to record for human review; relative paths resolve from the canonical project checkout",
          ),
          build_label: str("Optional display label for the build"),
          build_sha: str("Optional source or artifact revision for the build"),
          exceptions: str("Rule deviations and why"),
        },
        required: ["id", "etag", "handoff"],
      },
      run: async (a, signal) => {
        const build = reviewBuild(a),
          verification = a.run
            ? await runVerification(a.run, cwd, { signal })
            : undefined;
        signal.throwIfAborted();
        if (verification && verification.exitCode !== 0 && !a.allow_failure)
          throw new Error(
            `Verification failed (exit ${verification.exitCode}); not submitting. Output tail:\n${verification.output.slice(-2000)}`,
          );
        return api(
          store,
          `/api/records/${encodeURIComponent(a.id)}/review`,
          "POST",
          {
            revision: a.etag,
            handoff: a.handoff,
            reviewInstructions: a.review_instructions,
            manualReviewRequired: a.manual_review_required,
            evidence:
              a.evidence ??
              (verification
                ? `\`${verification.command}\` exited ${verification.exitCode} at ${verification.at}.`
                : ""),
            exceptions: a.exceptions ?? "",
            branch: a.branch ?? currentBranch(cwd),
            pr: a.pr,
            commits:
              a.commits ??
              (a.commits_since
                ? commitsSince(cwd, a.commits_since)
                : undefined),
            build,
            verification,
            actor: who,
          },
        );
      },
    },
    {
      name: "wait_for_update",
      description:
        "Block until a ticket gains a comment (for example a human's answer), changes status, or changes at all. Returns the change and the latest comment, or null on timeout.",
      inputSchema: {
        type: "object",
        properties: {
          id,
          for: {
            type: "string",
            enum: ["comment", "status", "any"],
            description: "Default any",
          },
          timeout_seconds: { type: "integer", description: "Default 600" },
        },
        required: ["id"],
      },
      run: async (a, signal) => {
        const r = await waitForChange(
          store,
          a.id,
          a.for ?? "any",
          (a.timeout_seconds ?? 600) * 1000,
          signal,
          allowStart,
        );
        return r
          ? {
              change: r.change,
              status: r.ticket.meta.status,
              etag: r.ticket.revision,
              latestComment: r.comments.at(-1) ?? null,
            }
          : { change: null, note: "Timed out with no change." };
      },
    },
    {
      name: "create_decision",
      description:
        "Record a consequential project decision after searching list_knowledge. Include choice, context, rationale, alternatives, tradeoffs, scope, attribution and related references. Defaults to proposed; never invent human agreement. Link the returned ID from the ticket's decisions field using update_ticket. A decision grants no scope approval or Done authority.",
      inputSchema: {
        type: "object",
        properties: {
          title: str("Short name for the choice"),
          body: str(
            "Markdown: choice, context, rationale, alternatives, tradeoffs and attribution",
          ),
          status: { type: "string", enum: ["proposed", "accepted"] },
          scope: {
            type: "array",
            items: str("Applicable ticket label; empty means project-wide"),
          },
          references: {
            type: "array",
            items: str(
              "Related ticket ID or implementation/document reference",
            ),
          },
          supersedes: str(
            "Predecessor decision ID; explain why the choice changed in the body",
          ),
        },
        required: ["title", "body"],
      },
      run: (a) =>
        api(store, "/api/records", "POST", {
          kind: "decision",
          meta: {
            title: a.title,
            status: a.status ?? "proposed",
            scope: a.scope ?? [],
            references: a.references ?? [],
            ...(a.supersedes ? { supersedes: a.supersedes } : {}),
          },
          body: a.body,
          actor: who,
        }),
    },
    {
      name: "list_knowledge",
      description:
        "Search project decisions and rules before creating new guidance. Defaults to current accepted decisions and active rules. include_inactive also returns proposals, rejected and superseded guidance. Independent of ticket archival; use get_ticket for full record/history references.",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["decision", "rule"] },
          query: str(
            "Case-insensitive text in title, body, scope or references",
          ),
          include_inactive: {
            type: "boolean",
            description:
              "Include proposals and predecessor history when checking for existing decisions",
          },
        },
      },
      run: async (a) => {
        const state = await api(store, "/api/state");
        const replaced = new Set(
          state.records
            .filter(
              (r: any) =>
                r.meta.kind !== "ticket" &&
                ["accepted", "active"].includes(r.meta.status),
            )
            .map((r: any) => r.meta.supersedes)
            .filter(Boolean),
        );
        return state.records
          .filter(
            (r: any) =>
              (a.kind ? r.meta.kind === a.kind : r.meta.kind !== "ticket") &&
              (a.include_inactive ||
                (["accepted", "active"].includes(r.meta.status) &&
                  !replaced.has(r.meta.id))) &&
              (!a.query ||
                `${r.meta.title}\n${r.body}\n${(r.meta.scope ?? []).join(" ")}\n${(r.meta.references ?? []).join(" ")}`
                  .toLowerCase()
                  .includes(a.query.toLowerCase())),
          )
          .map((r: any) => ({
            id: r.meta.id,
            kind: r.meta.kind,
            status: r.meta.status,
            etag: r.revision,
            author: r.meta.author,
            supersedes: r.meta.supersedes,
            references: r.meta.references,
            reference_checks: state.referenceChecks?.[r.meta.id] ?? [],
            title: r.meta.title,
            scope: r.meta.scope,
            strength: r.meta.strength,
            body: r.body,
          }));
      },
    },
  ];

  const send = (msg: unknown) =>
    process.stdout.write(JSON.stringify(msg) + "\n");
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  const pending = new Map<string | number, AbortController>();
  const running = new Set<Promise<void>>();
  const cancelAll = () => {
    for (const controller of pending.values()) controller.abort();
  };
  rl.on("close", cancelAll);
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      continue;
    }
    const reply = (result: unknown) =>
      send({ jsonrpc: "2.0", id: msg.id, result });
    const fail = (code: number, message: string) =>
      send({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
    if (msg.method === "initialize")
      reply({
        protocolVersion: msg.params?.protocolVersion ?? "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "controlroom", version: "0.2.0" },
        instructions: `You are "${who.name}" (${who.kind}) on the Control Room board for ${store.root}. Before implementing, call get_context (or next_ticket) and claim_ticket. Work only inside an approved scope. Record discoveries with comment, questions with ask_question, and finish with submit_review including a run command; a human accepts Done unless the managed orchestration controller records an independent review receipt. Ordinary workers cannot accept Done.${allowStart ? "" : " Auto-start is disabled: the local Control Room service must already be running before tools can read or write."}\n\n${decisionProtocol}\n\nUse list_knowledge with include_inactive to check existing decisions, create_decision to record one, and update_ticket to link its ID in the ticket's decisions field (preserving existing links).`,
      });
    else if (msg.method === "notifications/cancelled") {
      pending.get(msg.params?.requestId)?.abort();
    } else if (
      msg.method === "notifications/initialized" ||
      msg.method?.startsWith("notifications/")
    ) {
      /* no reply to notifications */
    } else if (msg.method === "ping") reply({});
    else if (msg.method === "tools/list")
      reply({
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });
    else if (msg.method === "tools/call") {
      const tool = tools.find((t) => t.name === msg.params?.name);
      if (!tool) {
        fail(-32602, `Unknown tool ${msg.params?.name}`);
        continue;
      }
      if (pending.has(msg.id)) {
        fail(-32600, "Duplicate in-flight request ID");
        continue;
      }
      const controller = new AbortController();
      pending.set(msg.id, controller);
      const task = (async () => {
        try {
          const result = await tool.run(
            msg.params?.arguments ?? {},
            controller.signal,
          );
          controller.signal.throwIfAborted();
          reply({ content: [{ type: "text", text: text(result) }] });
        } catch (e: any) {
          const message =
            e instanceof ApiError
              ? `${e.status}: ${e.message}${e.detail ? "\n" + JSON.stringify(e.detail, null, 2) : ""}`
              : String(e?.message ?? e);
          reply({
            content: [
              {
                type: "text",
                text: controller.signal.aborted ? "Request cancelled" : message,
              },
            ],
            isError: true,
          });
        } finally {
          pending.delete(msg.id);
        }
      })();
      running.add(task);
      void task.finally(() => running.delete(task));
    } else if (msg.id !== undefined)
      fail(-32601, `Method not found: ${msg.method}`);
  }
  cancelAll();
  await Promise.allSettled(running);
}
