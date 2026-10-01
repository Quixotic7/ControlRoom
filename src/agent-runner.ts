import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { atomic, hash, Problem } from "./files.js";
import type { AgentProfile } from "./orchestration-types.js";

export function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 20_000_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
export function codeIdentity(cwd: string, base: string) {
  const files = git(cwd, "ls-files", "--others", "--exclude-standard", "-z")
    .split("\0")
    .filter(Boolean)
    .sort();
  const parts = [
    git(cwd, "rev-parse", "HEAD"),
    git(cwd, "diff", "--binary", base, "--"),
  ];
  let size = 0;
  for (const file of files) {
    const full = path.join(cwd, file),
      stat = fs.lstatSync(full);
    size += stat.size;
    if (size > 50_000_000)
      throw new Problem(
        413,
        "Untracked source exceeds 50 MB; ignore generated files before review",
      );
    parts.push(
      file,
      stat.isSymbolicLink()
        ? fs.readlinkSync(full)
        : hash(fs.readFileSync(full)),
    );
  }
  return {
    hash: hash(JSON.stringify(parts)),
    files: [
      ...new Set([
        ...git(cwd, "diff", "--name-only", base, "--")
          .split("\n")
          .filter(Boolean),
        ...files,
      ]),
    ],
  };
}
export function processStart(pid?: number) {
  if (!pid) return "";
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
  } catch {
    return "";
  }
}
export function processAlive(pid?: number) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === "EPERM";
  }
}
export function processGroupAlive(pid?: number) {
  if (!pid || process.platform === "win32") return false;
  return processAlive(-pid);
}

export type ProcessResult = {
  code: number;
  output: string;
  structured?: unknown;
  limitReason?: "turns";
  permissionDenials?: string[];
};
export class AgentLimitError extends Error {
  constructor(
    readonly reason: "turns" | "timeout",
    readonly sessionId?: string,
  ) {
    super(
      reason === "turns"
        ? "Agent reached its configured turn limit"
        : "Agent reached its configured time limit",
    );
  }
}
export type Execute = (options: {
  command: string;
  args: string[];
  cwd: string;
  input: string;
  timeout: number;
  signal: AbortSignal;
  log: string;
  onEvent: (event: string, session?: string) => void;
  onStart: (pid: number) => void;
  actorName?: string;
  environment?: Record<string, string>;
}) => Promise<ProcessResult>;

// Only retain bounded logs, never serialize the inherited environment or CLI credentials.
// Child process groups let cancellation stop tool descendants, not just their parent CLI.
export const execute: Execute = (o) =>
  new Promise((resolve, reject) => {
    if (o.signal.aborted) return reject(new Error("Run cancelled"));
    fs.mkdirSync(path.dirname(o.log), { recursive: true });
    const fd = fs.openSync(o.log, "w", 0o600);
    let output = "",
      pending = "",
      structured: unknown,
      limitReason: ProcessResult["limitReason"],
      permissionDenials: string[] = [],
      total = 0,
      stopped = "",
      killTimer: NodeJS.Timeout | undefined;
    const child = spawn(o.command, o.args, {
      cwd: o.cwd,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...o.environment,
        CONTROLROOM_MANAGED: "1",
        CONTROLROOM_ACTOR_KIND: "agent",
        WORKBOARD_ACTOR_KIND: "agent",
        ...(o.actorName
          ? { CONTROLROOM_ACTOR: o.actorName, WORKBOARD_ACTOR: o.actorName }
          : {}),
      },
    });
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (child.pid && process.platform !== "win32")
          process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {}
    };
    const stop = (reason: string) => {
      if (stopped) return;
      stopped = reason;
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 1500);
    };
    const abort = () => stop("Run cancelled");
    o.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => stop("Run exceeded its time limit"),
      o.timeout,
    );
    child.on("spawn", () => {
      if (child.pid) o.onStart(child.pid);
    });
    const parseEvent = (line: string) => {
      try {
        const e = JSON.parse(line);
        // Store event types only. Raw provider payloads remain in the private local log.
        const type = String(e.type ?? "event").slice(0, 100);
        o.onEvent(
          type,
          typeof (e.thread_id ?? e.session_id) === "string"
            ? (e.thread_id ?? e.session_id)
            : undefined,
        );
        if (e.type === "result" && e.structured_output)
          structured = e.structured_output;
        if (e.type === "result" && Array.isArray(e.permission_denials))
          permissionDenials = [
            ...new Set<string>(
              e.permission_denials
                .map((denial: unknown) =>
                  typeof denial === "object" && denial
                    ? String(
                        (denial as Record<string, unknown>).tool_name ??
                          "unknown tool",
                      ).slice(0, 100)
                    : "unknown tool",
                )
                .slice(0, 20),
            ),
          ];
        if (
          e.type === "result" &&
          /(?:max[_ -]?turns|turn[_ -]?limit)/i.test(
            String(e.subtype ?? e.error ?? ""),
          )
        )
          limitReason = "turns";
      } catch {}
    };
    const collect = (chunk: Buffer, events: boolean) => {
      const text = chunk.toString("utf8");
      total += chunk.length;
      if (total <= 2_000_000) fs.writeSync(fd, text);
      output = (output + text).slice(-100000);
      if (total > 8_000_000) stop("Run exceeded its output limit");
      if (!events) return;
      pending += text;
      const lines = pending.split("\n");
      pending = lines.pop()!.slice(-500000);
      for (const line of lines) parseEvent(line);
    };
    child.stdout.on("data", (c) => collect(c, true));
    child.stderr.on("data", (c) => collect(c, false));
    child.stdin.on("error", () => {});
    child.stdin.end(o.input);
    let error: Error | undefined;
    child.on("error", (e) => {
      error = e;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      // A CLI may leave tool descendants behind even after closing stdout.
      kill("SIGKILL");
      o.signal.removeEventListener("abort", abort);
      if (pending) parseEvent(pending);
      fs.closeSync(fd);
      if (error || stopped) reject(error ?? new Error(stopped));
      else
        resolve({
          code: code ?? -1,
          output,
          structured,
          limitReason,
          permissionDenials,
        });
    });
  });

export async function runAgent(
  profile: AgentProfile,
  kind: "plan" | "work" | "review",
  prompt: string,
  schema: object,
  options: Omit<Parameters<Execute>[0], "command" | "args" | "input"> & {
    directory: string;
    maxTurns: number;
    additionalDirectories?: string[];
    claudeAllowedTools?: string[];
    onLaunch?: (launch: {
      command: string;
      args: string[];
      environment: string[];
    }) => void;
    sessionId?: string;
  },
  runner = execute,
) {
  const schemaFile = path.join(options.directory, "schema.json"),
    resultFile = path.join(options.directory, "result.json");
  atomic(schemaFile, JSON.stringify(schema), 0o600);
  if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);
  const extraDirectories =
      kind === "work" ? (options.additionalDirectories ?? []) : [],
    args =
      profile.provider === "codex"
        ? [
            "exec",
            ...(options.sessionId ? ["resume", options.sessionId] : []),
            "--json",
            ...(options.sessionId
              ? [
                  "-c",
                  `sandbox_mode="${kind === "work" ? "workspace-write" : "read-only"}"`,
                ]
              : [
                  "--color",
                  "never",
                  "--sandbox",
                  kind === "work" ? "workspace-write" : "read-only",
                ]),
            "-c",
            'approval_policy="never"',
            ...(options.sessionId && extraDirectories.length
              ? [
                  "-c",
                  `sandbox_workspace_write.writable_roots=${JSON.stringify([
                    options.cwd,
                    ...extraDirectories,
                  ])}`,
                ]
              : []),
            "--output-schema",
            schemaFile,
            "--output-last-message",
            resultFile,
            ...(profile.model ? ["--model", profile.model] : []),
            ...(!options.sessionId
              ? extraDirectories.flatMap((directory) => [
                  "--add-dir",
                  directory,
                ])
              : []),
            "-",
          ]
        : [
            "-p",
            ...(options.sessionId ? ["--resume", options.sessionId] : []),
            "--output-format",
            "stream-json",
            "--verbose",
            "--json-schema",
            JSON.stringify(schema),
            "--max-turns",
            String(options.maxTurns),
            "--permission-mode",
            kind === "work" ? "acceptEdits" : "plan",
            ...(profile.model ? ["--model", profile.model] : []),
            ...(extraDirectories.length
              ? ["--add-dir", ...extraDirectories]
              : []),
            ...(kind === "work" && options.claudeAllowedTools?.length
              ? ["--allowedTools", options.claudeAllowedTools.join(",")]
              : []),
          ];
  options.onLaunch?.({
    command: profile.executable,
    args: args.map((arg, index) => {
      const prior = args[index - 1];
      if (prior === "--json-schema") return "<generated schema>";
      if (prior === "--output-schema") return "<run schema>";
      if (prior === "--output-last-message") return "<run result>";
      return arg;
    }),
    environment: Object.keys(options.environment ?? {}).sort(),
  });
  let sessionId = options.sessionId;
  let result: ProcessResult;
  try {
    result = await runner({
      ...options,
      command: profile.executable,
      args,
      input: prompt,
      actorName: profile.name,
      onEvent: (event, session) => {
        if (session) sessionId = session;
        options.onEvent(event, session);
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Run exceeded its time limit"
    )
      throw new AgentLimitError("timeout", sessionId);
    throw error;
  }
  if (result.permissionDenials?.length)
    throw new Error(
      `Provider denied permission to use ${result.permissionDenials.join(", ")}. Review the managed worker grants and ambient provider policy, then resolve the ticket question to retry.`,
    );
  if (result.limitReason)
    throw new AgentLimitError(result.limitReason, sessionId);
  if (result.code !== 0)
    throw new Error(
      `Agent exited ${result.code}. Check the local log for authentication, permissions, usage limits or tool errors.`,
    );
  if (profile.provider === "codex") {
    if (!fs.existsSync(resultFile))
      throw new Error(
        "Agent exited without a structured final result; review the local log",
      );
    return JSON.parse(fs.readFileSync(resultFile, "utf8"));
  }
  if (!result.structured)
    throw new Error(
      "Claude returned no structured result; check its local log for permission denials or turn limits",
    );
  return result.structured;
}
