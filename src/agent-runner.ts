import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { atomic, hash, Problem } from "./files.js";
import type { AgentProfile, PermissionDenial } from "./orchestration-types.js";
export type { PermissionDenial } from "./orchestration-types.js";

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
  permissionDenials?: PermissionDenial[];
  eventCount?: number;
  stderrPrefix?: string;
  stderrTruncated?: boolean;
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

const stderrPrefixLimit = 8192,
  diagnosticLineLimit = 6,
  diagnosticLineLength = 500,
  diagnosticLength = 2400;
const secretEnvironmentValues = () =>
  Object.entries(process.env)
    .filter(([name, value]) => {
      const parts = name.toUpperCase().split("_");
      return (
        !!value &&
        (parts.some((part) =>
          [
            "KEY",
            "TOKEN",
            "SECRET",
            "PASSWORD",
            "PASSWD",
            "CREDENTIAL",
            "CREDENTIALS",
            "AUTH",
            "AUTHORIZATION",
            "COOKIE",
          ].includes(part),
        ) ||
          /API_?KEY/i.test(name))
      );
    })
    .map(([, value]) => value!);

/** Sanitize a provider startup failure before placing it in API/UI diagnostics. */
export function redactStartupDiagnostic(
  input: string,
  extraSecrets: Iterable<string> = [],
) {
  let value = String(input);
  const secrets = [...secretEnvironmentValues(), ...extraSecrets]
    .flatMap((secret) => [secret, ...secret.split(/\r?\n/)])
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const secret of new Set(secrets))
    value = value.split(secret).join("[REDACTED]");
  value = value
    // OSC, CSI and two-byte escape sequences, followed by remaining controls.
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-_]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
      "",
    )
    .replace(
      /\b(authorization)\s*:\s*(?:bearer|basic)\s+[^\s,;]+/gi,
      "$1: [REDACTED]",
    )
    .replace(/\bbearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(api[_ -]?key|access[_ -]?token|auth[_ -]?token|token|secret|password|passwd|credentials?)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /\b([A-Za-z_][A-Za-z0-9_]*(?:key|token|secret|password|passwd|credential)[A-Za-z0-9_]*)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /(--[A-Za-z0-9_-]*(?:key|token|secret|password|passwd|credential)[A-Za-z0-9_-]*)\s+(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1 [REDACTED]",
    )
    .replace(
      /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|AKIA[0-9A-Z]{16})\b/g,
      "[REDACTED]",
    )
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1[REDACTED]@");
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, diagnosticLineLimit)
    .map((line) => line.slice(0, diagnosticLineLength))
    .join("\n")
    .slice(0, diagnosticLength);
}

const denialLimit = 12,
  denialToolLength = 100,
  denialCommandLength = 400;

/** Reduce provider permission payloads to bounded, display-safe tool/command summaries. */
export function sanitizePermissionDenials(
  input: unknown,
  extraSecrets: Iterable<string> = [],
): PermissionDenial[] {
  if (!Array.isArray(input)) return [];
  const denials: PermissionDenial[] = [];
  for (const value of input) {
    const record =
        typeof value === "object" && value
          ? (value as Record<string, unknown>)
          : undefined,
      rawTool = record?.tool ?? record?.tool_name ?? value,
      tool = redactStartupDiagnostic(String(rawTool), extraSecrets)
        .replace(/[^A-Za-z0-9_.: -]/g, "?")
        .slice(0, denialToolLength),
      toolInput =
        typeof record?.tool_input === "object" && record.tool_input
          ? (record.tool_input as Record<string, unknown>)
          : undefined,
      rawCommand = toolInput?.command ?? record?.command,
      command =
        typeof rawCommand === "string"
          ? redactStartupDiagnostic(rawCommand, extraSecrets)
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, denialCommandLength)
          : "";
    if (!tool) continue;
    const denial = { tool, ...(command ? { command } : {}) };
    if (
      !denials.some(
        (existing) =>
          existing.tool === denial.tool && existing.command === denial.command,
      )
    )
      denials.push(denial);
    if (denials.length === denialLimit) break;
  }
  return denials;
}

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
      permissionDenials: PermissionDenial[] = [],
      eventCount = 0,
      stderrPrefixParts: Buffer[] = [],
      stderrPrefixBytes = 0,
      stderrTruncated = false,
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
        if (
          !e ||
          typeof e !== "object" ||
          Array.isArray(e) ||
          typeof e.type !== "string"
        )
          return;
        eventCount++;
        // Store event types only. Raw provider payloads remain in the private local log.
        const type = e.type.slice(0, 100);
        o.onEvent(
          type,
          typeof (e.thread_id ?? e.session_id) === "string"
            ? (e.thread_id ?? e.session_id)
            : undefined,
        );
        if (e.type === "result" && e.structured_output)
          structured = e.structured_output;
        if (e.type === "result" && Array.isArray(e.permission_denials))
          permissionDenials = sanitizePermissionDenials(
            [...permissionDenials, ...e.permission_denials],
            Object.values(o.environment ?? {}),
          );
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
      if (!events) {
        const remaining = stderrPrefixLimit - stderrPrefixBytes;
        if (remaining > 0) {
          const prefix = chunk.subarray(0, remaining);
          stderrPrefixParts.push(prefix);
          stderrPrefixBytes += prefix.length;
        }
        if (chunk.length > remaining) stderrTruncated = true;
      }
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
          eventCount,
          stderrPrefix: Buffer.concat(stderrPrefixParts).toString("utf8"),
          stderrTruncated,
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
    smokeTest?: boolean;
    onPermissionDenials?: (denials: PermissionDenial[]) => void;
  },
  runner = execute,
) {
  const schemaFile = path.join(options.directory, "schema.json"),
    resultFile = path.join(options.directory, "result.json");
  atomic(schemaFile, JSON.stringify(schema), 0o600);
  if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);
  const smokeTest = options.smokeTest === true,
    sessionId = smokeTest ? undefined : options.sessionId,
    extraDirectories =
      !smokeTest && kind === "work"
        ? (options.additionalDirectories ?? [])
        : [],
    args =
      profile.provider === "codex"
        ? [
            "exec",
            ...(sessionId ? ["resume", sessionId] : []),
            "--json",
            ...(sessionId
              ? [
                  "-c",
                  `sandbox_mode="${kind === "work" ? "workspace-write" : "read-only"}"`,
                ]
              : [
                  "--color",
                  "never",
                  "--sandbox",
                  !smokeTest && kind === "work"
                    ? "workspace-write"
                    : "read-only",
                ]),
            "-c",
            'approval_policy="never"',
            ...(sessionId && extraDirectories.length
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
            ...(!sessionId
              ? extraDirectories.flatMap((directory) => [
                  "--add-dir",
                  directory,
                ])
              : []),
            "-",
          ]
        : [
            "-p",
            ...(sessionId ? ["--resume", sessionId] : []),
            "--output-format",
            "stream-json",
            "--verbose",
            "--json-schema",
            JSON.stringify(schema),
            "--max-turns",
            String(options.maxTurns),
            "--permission-mode",
            !smokeTest && kind === "work" ? "acceptEdits" : "plan",
            ...(profile.model ? ["--model", profile.model] : []),
            ...(smokeTest
              ? [
                  "--safe-mode",
                  "--tools",
                  "",
                  "--strict-mcp-config",
                  "--mcp-config",
                  '{"mcpServers":{}}',
                  "--disable-slash-commands",
                  "--no-session-persistence",
                ]
              : []),
            ...(extraDirectories.length
              ? ["--add-dir", ...extraDirectories]
              : []),
            ...(!smokeTest &&
            kind === "work" &&
            options.claudeAllowedTools?.length
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
    environment: smokeTest ? [] : Object.keys(options.environment ?? {}).sort(),
  });
  let retainedSessionId = sessionId;
  let result: ProcessResult;
  try {
    result = await runner({
      ...options,
      environment: smokeTest ? undefined : options.environment,
      command: profile.executable,
      args,
      input: prompt,
      actorName: profile.name,
      onEvent: (event, session) => {
        if (session) retainedSessionId = session;
        options.onEvent(event, session);
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Run exceeded its time limit"
    )
      throw new AgentLimitError("timeout", retainedSessionId);
    throw error;
  }
  const permissionDenials = sanitizePermissionDenials(
    result.permissionDenials,
    Object.values(options.environment ?? {}),
  );
  if (permissionDenials.length)
    options.onPermissionDenials?.(permissionDenials);
  // A worker may recover after a refused tool and still return a complete
  // ready handoff. The controller still validates its schema, context, code,
  // independent verification and review; planners and reviewers never recover
  // through this exception because denied inspection could weaken their result.
  const recoveredReadyWorker =
    kind === "work" &&
    result.code === 0 &&
    !result.limitReason &&
    !!result.structured &&
    typeof result.structured === "object" &&
    !Array.isArray(result.structured) &&
    (result.structured as Record<string, unknown>).outcome === "ready";
  if (permissionDenials.length && !recoveredReadyWorker)
    throw new Error(
      `Provider denied permission to use ${[...new Set(permissionDenials.map((denial) => denial.tool))].join(", ")}. Review the managed worker grants and ambient provider policy, then answer the ticket question to retry.`,
    );
  if (result.limitReason)
    throw new AgentLimitError(result.limitReason, retainedSessionId);
  if (result.code !== 0) {
    if ((result.eventCount ?? 0) === 0 && result.stderrPrefix) {
      const stderr =
        result.stderrTruncated && !result.stderrPrefix.endsWith("\n")
          ? result.stderrPrefix.slice(
              0,
              result.stderrPrefix.lastIndexOf("\n") + 1,
            )
          : result.stderrPrefix;
      const diagnostic = redactStartupDiagnostic(stderr, [
        ...Object.values(options.environment ?? {}),
      ]);
      if (diagnostic)
        throw new Error(
          `Agent exited ${result.code} before reporting a structured event. Provider stderr:\n${diagnostic}`,
        );
    }
    throw new Error(
      `Agent exited ${result.code}. Check the local log for authentication, permissions, usage limits or tool errors.`,
    );
  }
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
