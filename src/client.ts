// Shared by the CLI and the MCP server: who is acting, how to reach the
// project's local service, and helpers that turn agent-friendly inputs into
// API calls.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec, spawn } from "node:child_process";
import type { Store } from "./store.js";
import { git, now, read } from "./files.js";
import type { Actor, RecordFile, Verification } from "./types.js";

// ------------------------------------------------------------------ args

export const valueOptions = new Set([
  "--project",
  "--actor",
  "--body-file",
  "--body",
  "--file",
  "--patch",
  "--set",
  "--title",
  "--parent",
  "--labels",
  "--priority",
  "--owner",
  "--status",
  "--label",
  "--kind",
  "--revision",
  "--etag",
  "--if-match",
  "--handoff",
  "--evidence",
  "--review-notes",
  "--exceptions",
  "--branch",
  "--pr",
  "--commits",
  "--commits-since",
  "--run",
  "--for",
  "--timeout",
  "--output",
  "--port",
  "--worktree",
]);
export function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (valueOptions.has(a)) {
      values.set(a, [...(values.get(a) ?? []), argv[++i] ?? ""]);
    } else if (a.startsWith("--")) flags.add(a);
    else positional.push(a);
  }
  return {
    positional,
    option: (name: string, fallback?: string) =>
      values.get(`--${name}`)?.at(-1) ?? fallback,
    all: (name: string) => values.get(`--${name}`) ?? [],
    has: (name: string) => flags.has(`--${name}`) || values.has(`--${name}`),
  };
}

// -------------------------------------------------------------- identity

// Identity comes from the environment first, so an agent cannot become a
// human by forgetting a flag. WORKBOARD_ACTOR names the session and
// WORKBOARD_ACTOR_KIND fixes human or agent. Without them, a known agent
// harness or a non-interactive terminal counts as an agent.
export function resolveActor(opts: {
  name?: string;
  agent?: boolean;
  human?: boolean;
}): { actor: Actor; inferred: boolean } {
  const env = process.env;
  const harness = env.CLAUDECODE
    ? "Claude Code"
    : env.CODEX_SANDBOX || env.CODEX_CI
      ? "Codex"
      : env.CURSOR_TRACE_ID
        ? "Cursor"
        : env.GEMINI_CLI
          ? "Gemini CLI"
          : env.AIDER_MODEL
            ? "Aider"
            : null;
  let kind: Actor["kind"] | undefined;
  if (opts.agent) kind = "agent";
  else if (opts.human) kind = "human";
  else if ((env.CONTROLROOM_ACTOR_KIND ?? env.WORKBOARD_ACTOR_KIND) === "agent")
    kind = "agent";
  else if ((env.CONTROLROOM_ACTOR_KIND ?? env.WORKBOARD_ACTOR_KIND) === "human")
    kind = "human";
  const inferred = kind === undefined;
  if (inferred) kind = harness || !process.stdin.isTTY ? "agent" : "human";
  const name =
    opts.name?.trim() ||
    env.CONTROLROOM_ACTOR?.trim() ||
    env.WORKBOARD_ACTOR?.trim() ||
    (kind === "agent" ? (harness ?? "agent") : "You");
  return { actor: { name, kind: kind! }, inferred };
}

// --------------------------------------------------------------- service

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function endpoint(store: Store): Promise<string | null> {
  try {
    const v = JSON.parse(read(store.file(".local/service.json")));
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(v.url)) return null;
    const r = await fetch(v.url + "/health", {
      signal: AbortSignal.timeout(500),
    });
    const health: any = await r.json();
    return health.project === store.config().projectId ? v.url : null;
  } catch {
    return null;
  }
}
export async function service(store: Store): Promise<string> {
  let url = await endpoint(store);
  if (url) return url;
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.ts");
  const entry = fs.existsSync(cli) ? cli : cli.replace(/\.ts$/, ".js");
  const log = fs.openSync(store.file(".local/service.log"), "a");
  const child = spawn(
    process.execPath,
    [
      ...(entry.endsWith(".ts")
        ? ["--import", import.meta.resolve("tsx")]
        : []),
      entry,
      "serve",
      "--headless",
      "--project",
      store.root,
    ],
    { detached: true, stdio: ["ignore", log, log] },
  );
  child.unref();
  fs.closeSync(log);
  for (let i = 0; i < 80; i++) {
    await delay(100);
    url = await endpoint(store);
    if (url) return url;
  }
  throw new Error(
    `Service did not start. See ${store.file(".local/service.log")}`,
  );
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  store: Store,
  url: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const base = await service(store);
  const res = await fetch(base + url, {
    method,
    signal,
    headers: {
      Authorization: `Bearer ${store.token()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: any = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error, data.detail);
  return data;
}

// ---------------------------------------------------------------- inputs

const listKeys = new Set([
  "labels",
  "dependencies",
  "commits",
  "scope",
  "references",
  "decisions",
  "rules",
  "attachments",
]);
// `--set key=value`: JSON when it parses (numbers, booleans, null, arrays),
// comma lists for list fields, otherwise the raw string.
export function parseSet(pairs: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new Error(`--set expects key=value, got "${pair}"`);
    const key = pair.slice(0, eq).trim(),
      raw = pair.slice(eq + 1);
    let value: unknown = raw;
    if (listKeys.has(key))
      value = raw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    else if (/^(true|false|null|-?\d+(\.\d+)?|\[.*\]|\{.*\})$/.test(raw.trim()))
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw;
      }
    out[key] = value;
  }
  return out;
}

export type ListFilter = {
  kind?: string;
  status?: string;
  owner?: string;
  label?: string;
  mine?: string;
  open?: boolean;
  archived?: boolean;
  columns?: { id: string; name: string; role: string }[];
  claims?: { ticket: string; actor: Actor; expiresAt: string }[];
};
export function filterRecords(records: RecordFile[], f: ListFilter) {
  const stamp = now();
  const wants = (v?: string) =>
    v
      ?.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean) ?? [];
  const statuses = wants(f.status);
  const labels = wants(f.label);
  return records.filter((r) => {
    const m = r.meta;
    if (f.kind && m.kind !== f.kind) return false;
    const ticketOnly = !!(f.status || f.owner || f.label || f.mine || f.open);
    if (ticketOnly && m.kind !== "ticket") return false;
    if (f.archived ? !m.archived : m.archived) return false;
    if (statuses.length) {
      const col = f.columns?.find((c) => c.id === m.status);
      const names = [
        m.status.toLowerCase(),
        col?.name.toLowerCase() ?? "",
        col?.role ?? "",
      ];
      if (!statuses.some((s) => names.includes(s))) return false;
    }
    if (f.owner && (m.owner ?? "").toLowerCase() !== f.owner.toLowerCase())
      return false;
    if (labels.length) {
      const have = (m.labels ?? []).map((l) => l.toLowerCase());
      if (!labels.some((l) => have.includes(l))) return false;
    }
    if (f.mine) {
      const me = f.mine.toLowerCase();
      const claimed = f.claims?.some(
        (c) =>
          c.ticket === m.id &&
          c.expiresAt > stamp &&
          c.actor.name.toLowerCase() === me,
      );
      if ((m.owner ?? "").toLowerCase() !== me && !claimed) return false;
    }
    if (f.open) {
      const col = f.columns?.find((c) => c.id === m.status);
      if (col?.role === "done") return false;
    }
    return true;
  });
}

// ----------------------------------------------------------- code links

export function currentBranch(cwd: string) {
  return git(cwd, ["symbolic-ref", "--short", "HEAD"]) || undefined;
}
export function commitsSince(cwd: string, since: string): string[] {
  const out = git(cwd, ["log", "--format=%h %s", `${since}..HEAD`]);
  return out ? out.split("\n").filter(Boolean) : [];
}
// Runs the verification command and captures how it ended, so review
// evidence carries what actually ran rather than a description of it.
export function runVerification(
  command: string,
  cwd: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Verification> {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd,
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
        timeout: options.timeoutMs ?? 20 * 60_000,
        signal: options.signal,
      },
      (error, stdout, stderr) => {
        const diagnostic = error
          ? `\nVerification failed: ${error.signal ? `terminated by ${error.signal}. ` : ""}${error.message}`
          : "";
        const output = `${stdout}${stderr}${diagnostic}`;
        resolve({
          command,
          exitCode: error
            ? typeof error.code === "number" && error.code !== 0
              ? error.code
              : 1
            : 0,
          output: (output.length > 16000
            ? "…\n" + output.slice(-16000)
            : output
          ).trim(),
          at: now(),
          cwd,
        });
      },
    );
  });
}

// ------------------------------------------------------------------ wait

export type WaitFor = "comment" | "status" | "any";
// Resolves when the ticket gains a comment, changes status, or changes at
// all, driven by the service's change events with a polling fallback.
export async function waitForChange(
  store: Store,
  id: string,
  waitFor: WaitFor,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ change: string; ticket: RecordFile; comments: any[] } | null> {
  if (!["comment", "status", "any"].includes(waitFor))
    throw new Error("Unknown wait condition");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 86_400_000)
    throw new Error("Wait timeout must be between 0 and 86400 seconds");
  if (timeoutMs === 0) return null;
  const controller = new AbortController();
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([
    controller.signal,
    deadline,
    ...(signal ? [signal] : []),
  ]);
  const snapshot = async () => {
    const c = await api(
      store,
      `/api/records/${encodeURIComponent(id)}/context`,
      "GET",
      undefined,
      combined,
    );
    return { ticket: c.ticket as RecordFile, comments: c.comments as any[] };
  };
  let first: Awaited<ReturnType<typeof snapshot>>;
  const changed = (next: typeof first) => {
    if (next.comments.length > first.comments.length && waitFor !== "status")
      return "comment";
    if (
      next.ticket.meta.status !== first.ticket.meta.status &&
      waitFor !== "comment"
    )
      return "status";
    if (waitFor === "any" && next.ticket.revision !== first.ticket.revision)
      return "update";
    return null;
  };
  let events: Promise<void> | null = null;
  const wake: { fn: null | (() => void) } = { fn: null };
  let pending = false;
  try {
    first = await snapshot();
    const base = await service(store);
    try {
      const res = await fetch(base + "/api/events", {
        headers: { Authorization: `Bearer ${store.token()}` },
        signal: combined,
      });
      const reader = res.body?.getReader();
      if (reader)
        events = (async () => {
          while (true) {
            const { done } = await reader.read();
            if (done) break;
            pending = true;
            wake.fn?.();
          }
        })().catch(() => {});
    } catch {
      combined.throwIfAborted(); /* Poll only. */
    }
    while (!combined.aborted) {
      pending = false;
      const next = await snapshot();
      const change = changed(next);
      if (change) return { change, ...next };
      if (pending) continue;
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          combined.removeEventListener("abort", finish);
          wake.fn = null;
          resolve();
        };
        const timer = setTimeout(finish, 15_000);
        wake.fn = finish;
        combined.addEventListener("abort", finish, { once: true });
        if (combined.aborted) finish();
      });
    }
    signal?.throwIfAborted();
    return null;
  } catch (error) {
    signal?.throwIfAborted();
    if (deadline.aborted) return null;
    throw error;
  } finally {
    controller.abort();
    await events;
  }
}
