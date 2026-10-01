import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  execute,
  redactStartupDiagnostic,
  runAgent,
  type Execute,
} from "../src/agent-runner.js";
import type { AgentProfile } from "../src/orchestration-types.js";

const profile = (provider: "claude" | "codex", executable: string) =>
  ({
    name: `${provider} smoke`,
    provider,
    executable,
    model: "",
  }) satisfies AgentProfile;

function directory(t: test.TestContext) {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "cr-startup-error-"));
  t.after(() => fs.rmSync(value, { recursive: true, force: true }));
  return value;
}

function options(root: string) {
  return {
    directory: root,
    cwd: root,
    timeout: 10_000,
    signal: new AbortController().signal,
    log: path.join(root, "agent.log"),
    onEvent: () => {},
    onStart: () => {},
    maxTurns: 10,
  };
}

test("startup diagnostics remove credentials and terminal controls and stay bounded", () => {
  const previous = process.env.CONTROLROOM_TEST_API_TOKEN;
  process.env.CONTROLROOM_TEST_API_TOKEN = "host-environment-secret";
  try {
    const lines = [
      "\u001b[31mProvider could not start\u001b[0m\u0000",
      "Authorization: Bearer bearer-secret-value",
      "api_key=explicit-api-secret",
      "https://user:password@example.test/path",
      "configured-secret-value",
      "host-environment-secret",
      "sixth useful line",
      "seventh line must be omitted",
    ];
    const diagnostic = redactStartupDiagnostic(lines.join("\n"), [
      "configured-secret-value",
    ]);
    assert.match(diagnostic, /Provider could not start/);
    assert.match(diagnostic, /Authorization: \[REDACTED\]/);
    assert.match(diagnostic, /api_key=\[REDACTED\]/);
    assert.match(diagnostic, /https:\/\/\[REDACTED\]@example\.test\/path/);
    assert.doesNotMatch(
      diagnostic,
      /bearer-secret|explicit-api-secret|configured-secret|host-environment-secret|\u001b|\u0000/,
    );
    assert.equal(diagnostic.split("\n").length, 6);
    assert.doesNotMatch(diagnostic, /seventh line/);
    assert.ok(diagnostic.length <= 2400);
    assert.equal(
      redactStartupDiagnostic("configured=q7z", ["q7z"]),
      "configured=[REDACTED]",
    );
  } finally {
    if (previous === undefined) delete process.env.CONTROLROOM_TEST_API_TOKEN;
    else process.env.CONTROLROOM_TEST_API_TOKEN = previous;
  }
});

test("a pre-event process failure surfaces only sanitized stderr while retaining the private raw log", async (t) => {
  const root = directory(t),
    executable = path.join(root, "startup-failure"),
    configuredSecret = "configured-environment-secret",
    stdoutMarker = "stdout-content-must-stay-private";
  fs.writeFileSync(
    executable,
    `#!${process.execPath}\n` +
      `process.stdout.write(JSON.stringify({message:${JSON.stringify(stdoutMarker)}}));\n` +
      `process.stderr.write("\\u001b[31mAuthentication setup failed\\u001b[0m\\n");\n` +
      `process.stderr.write("token=" + process.env.STARTUP_SECRET + "\\n");\n` +
      `process.stderr.write("Authorization: Bearer leaked-bearer-value\\n");\n` +
      `process.stderr.write("https://user:password@example.test/repository\\n");\n` +
      `process.exitCode = 7;\n`,
    { mode: 0o755 },
  );
  const runOptions = {
    ...options(root),
    environment: { STARTUP_SECRET: configuredSecret },
  };
  await assert.rejects(
    runAgent(
      profile("claude", executable),
      "work",
      "diagnose startup",
      { type: "object" },
      runOptions,
    ),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /exited 7 before reporting a structured event/);
      assert.match(message, /Authentication setup failed/);
      assert.match(message, /token=\[REDACTED\]/);
      assert.doesNotMatch(
        message,
        new RegExp(
          [
            configuredSecret,
            "leaked-bearer-value",
            "user:password",
            stdoutMarker,
            "\\u001b",
          ].join("|"),
        ),
      );
      return true;
    },
  );
  const rawLog = fs.readFileSync(runOptions.log, "utf8");
  assert.match(rawLog, new RegExp(configuredSecret));
  assert.match(rawLog, new RegExp(stdoutMarker));
});

test("stderr is not surfaced after the provider reports a structured event", async (t) => {
  const root = directory(t),
    executable = path.join(root, "event-then-failure"),
    stderrMarker = "private-detail-after-event";
  fs.writeFileSync(
    executable,
    `#!${process.execPath}\n` +
      `process.stdout.write(JSON.stringify({type:"thread.started",thread_id:"started"}));\n` +
      `process.stderr.write(${JSON.stringify(stderrMarker)});\n` +
      `process.exitCode = 9;\n`,
    { mode: 0o755 },
  );
  await assert.rejects(
    runAgent(
      profile("claude", executable),
      "work",
      "fail after event",
      { type: "object" },
      options(root),
    ),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /Agent exited 9\. Check the local log/);
      assert.doesNotMatch(message, new RegExp(stderrMarker));
      return true;
    },
  );
});

test("a stderr prefix cutoff never publishes a partial configured secret", async (t) => {
  const root = directory(t),
    executable = path.join(root, "boundary-failure"),
    secret = "zxq-configured-secret-crosses-boundary";
  fs.writeFileSync(
    executable,
    `#!${process.execPath}\n` +
      `const first = "Safe boundary failure\\n";\n` +
      `const padding = "\\n".repeat(8192 - Buffer.byteLength(first) - 3);\n` +
      `process.stderr.write(first + padding + process.env.BOUNDARY_SECRET);\n` +
      `process.exitCode = 11;\n`,
    { mode: 0o755 },
  );
  const log = path.join(root, "boundary.log");
  await assert.rejects(
    runAgent(
      profile("claude", executable),
      "work",
      "fail at stderr boundary",
      { type: "object" },
      {
        ...options(root),
        log,
        environment: { BOUNDARY_SECRET: secret },
      },
    ),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /Safe boundary failure/);
      assert.doesNotMatch(message, /zxq|configured-secret/);
      return true;
    },
  );
  assert.match(fs.readFileSync(log, "utf8"), new RegExp(secret));
});

test("smoke runs remove grants, directories, sessions and configured environment", async (t) => {
  const root = directory(t),
    seen: Parameters<Execute>[0][] = [],
    launches: Array<{
      command: string;
      args: string[];
      environment: string[];
    }> = [];
  const runner: Execute = async (run) => {
    seen.push(run);
    const resultAt = run.args.indexOf("--output-last-message");
    if (resultAt >= 0)
      fs.writeFileSync(run.args[resultAt + 1], JSON.stringify({ ok: true }));
    return {
      code: 0,
      output: "",
      structured: { ok: true },
      eventCount: 1,
    };
  };
  const configured = {
    ...options(root),
    environment: { PROJECT_API_TOKEN: "must-not-reach-smoke" },
    additionalDirectories: [path.join(root, "extra")],
    claudeAllowedTools: ["Bash(*)", "Write"],
    sessionId: "existing-provider-session",
    smokeTest: true,
    onLaunch: (launch: (typeof launches)[number]) => launches.push(launch),
  };

  assert.deepEqual(
    await runAgent(
      profile("claude", "claude"),
      "work",
      "smoke",
      { type: "object" },
      configured,
      runner,
    ),
    { ok: true },
  );
  assert.deepEqual(
    await runAgent(
      profile("codex", "codex"),
      "work",
      "smoke",
      { type: "object" },
      configured,
      runner,
    ),
    { ok: true },
  );

  const claude = seen[0];
  assert.equal(claude.environment, undefined);
  assert.equal(claude.args.includes("--resume"), false);
  assert.equal(claude.args.includes("--add-dir"), false);
  assert.equal(claude.args.includes("--allowedTools"), false);
  assert.equal(
    claude.args[claude.args.indexOf("--permission-mode") + 1],
    "plan",
  );
  assert.ok(claude.args.includes("--safe-mode"));
  assert.equal(claude.args[claude.args.indexOf("--tools") + 1], "");
  assert.ok(claude.args.includes("--strict-mcp-config"));
  assert.equal(
    claude.args[claude.args.indexOf("--mcp-config") + 1],
    '{"mcpServers":{}}',
  );
  assert.ok(claude.args.includes("--disable-slash-commands"));
  assert.ok(claude.args.includes("--no-session-persistence"));

  const codex = seen[1];
  assert.equal(codex.environment, undefined);
  assert.equal(codex.args.includes("resume"), false);
  assert.equal(codex.args.includes("--add-dir"), false);
  assert.equal(codex.args[codex.args.indexOf("--sandbox") + 1], "read-only");
  assert.deepEqual(
    launches.map((launch) => launch.environment),
    [[], []],
  );
});
