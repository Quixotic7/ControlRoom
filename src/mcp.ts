// A Model Context Protocol server over stdio, so coding agents call the
// board as typed tools instead of shelling out. `controlroom mcp` starts it;
// register it with your agent (for Claude Code: `claude mcp add controlroom
// -- ./controlroom mcp`). Every call goes through the same local service as the
// CLI, so revisions, authority, and claims behave identically.
import readline from "node:readline";
import path from "node:path";
import type { Store } from "./store.js";
import {
  api,
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
) {
  const cwd = path.resolve(worktree);
  const text = (v: unknown) =>
    typeof v === "string" ? v : JSON.stringify(v, null, 2);
  const tools: Tool[] = [
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
        "Everything an agent needs before working on a ticket, as a prompt-ready Markdown brief: description, approved scope, applicable decisions and rules, dependencies, conversation, screenshot paths, claim, and the protocol to follow. Includes the etag.",
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
        "Change fields on a ticket (title, labels, priority, owner, parent, dependencies, blocked, handoff, branch, pr) and/or replace its body. Needs the current etag.",
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
        },
        required: ["id", "etag"],
      },
      run: (a) =>
        api(store, `/api/records/${encodeURIComponent(a.id)}`, "PATCH", {
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
        properties: { id, etag, status: str("Column id, e.g. progress") },
        required: ["id", "etag", "status"],
      },
      run: async (a) => {
        const state = await api(store, "/api/state");
        const col = state.config.columns.find(
          (c: any) => c.id === a.status || c.role === a.status,
        );
        return api(store, `/api/records/${encodeURIComponent(a.id)}`, "PATCH", {
          revision: a.etag,
          patch: { status: col?.id ?? a.status },
          actor: who,
        });
      },
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
      name: "submit_review",
      description:
        "Submit finished work for human review with a handoff and evidence. Optionally run the verification command here so the result is recorded as it happened; a failing run is refused unless allow_failure is set. Records branch, pull request, and commits on the ticket.",
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
          manual_review_required: { type: "boolean", description: "Set false only when no manual checks are requested; a passing recorded run is still required for a current verification pass summary." },
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
          exceptions: str("Rule deviations and why"),
        },
        required: ["id", "etag", "handoff"],
      },
      run: async (a, signal) => {
        const verification = a.run
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
        instructions: `You are "${who.name}" (${who.kind}) on the Control Room board for ${store.root}. Before implementing, call get_context (or next_ticket) and claim_ticket. Work only inside an approved scope. Record discoveries with comment, questions with ask_question, and finish with submit_review including a run command; a human moves work to Done.\n\n${decisionProtocol}\n\nUse list_knowledge with include_inactive to check existing decisions, create_decision to record one, and update_ticket to link its ID in the ticket's decisions field (preserving existing links).`,
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
