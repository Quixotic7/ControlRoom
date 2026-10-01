import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Store } from "../src/store.js";
import {
  Orchestrator,
  defaultOrchestration,
  agentResultJSONSchema,
} from "../src/orchestration.js";
import { type Execute, runAgent, git } from "../src/agent-runner.js";

const human = { name: "Test fixture human", kind: "human" as const };
const agent = { name: "Test fixture agent", kind: "agent" as const };
const ready = {
  outcome: "ready",
  summary: "Schema check",
  criteria: "Valid result",
  evidence: "Fixture",
  question: "",
};
async function fixture(t: test.TestContext, runner: Execute) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cr-profile-test-"));
  const store = new Store(root).initialize("Profile check fixture");
  const manager = new Orchestrator(store, runner);
  const config = structuredClone(defaultOrchestration);
  config.workers = [
    {
      name: "Claude saved",
      provider: "claude",
      executable: process.execPath,
      model: "fixture-model",
    },
  ];
  config.workerPermissions = {
    claudeAllowedTools: ["Bash(*)"],
    additionalDirectories: [],
    environment: [
      { name: "PROFILE_PRIVATE", source: "literal", value: "private-value" },
    ],
  };
  await manager.configure(config, manager.status().revision, human);
  t.after(async () => {
    await manager.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    store,
    manager,
    request: {
      profile: "worker:0",
      kind: "work",
      revision: manager.status().revision,
      confirmUsage: true,
    },
  };
}

test("all Claude role schemas compile as draft-07 and retain managed validation", () => {
  const require = createRequire(import.meta.url);
  const Ajv = require("ajv");
  for (const kind of ["work", "review", "plan"] as const) {
    const schema = agentResultJSONSchema(kind, "claude");
    assert.equal(schema.$schema, undefined);
    assert.ok(!JSON.stringify(schema).includes("2020-12"));
    const validate = new Ajv({ strict: false }).compile(schema);
    const value =
      kind === "plan" ? { summary: "Plan", question: "", tasks: [] } : ready;
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
    assert.equal(validate({ ...value, unexpected: true }), false);
    assert.equal(validate({}), false);
    assert.match(
      String(agentResultJSONSchema(kind, "codex").$schema),
      /2020-12/,
    );
  }
});

test("profile test requires human opt-in, a current saved Claude profile and isolates grants", async (t) => {
  let calls = 0;
  const { store, manager, request } = await fixture(t, async (o) => {
    calls++;
    assert.equal(o.command, process.execPath);
    assert.equal(o.args[o.args.indexOf("--model") + 1], "fixture-model");
    assert.ok(o.args.includes("--safe-mode"));
    assert.equal(o.args[o.args.indexOf("--tools") + 1], "");
    assert.equal(o.args[o.args.indexOf("--permission-mode") + 1], "plan");
    assert.ok(!o.args.includes("--allowedTools"));
    assert.ok(!o.args.includes("--add-dir"));
    assert.ok(!o.environment?.PROFILE_PRIVATE);
    assert.deepEqual(fs.readdirSync(o.cwd), []);
    return { code: 0, output: "", structured: ready };
  });
  await assert.rejects(manager.testProfile(request, agent), /human/);
  await assert.rejects(
    manager.testProfile({ ...request, confirmUsage: false }, human),
  );
  await assert.rejects(
    manager.testProfile({ ...request, revision: "old" }, human),
    /changed/,
  );
  await assert.rejects(
    manager.testProfile({ ...request, profile: "worker:9" }, human),
    /saved Claude/,
  );
  assert.equal(calls, 0);
  assert.equal((await manager.testProfile(request, human)).state, "passed");
  assert.equal(calls, 1);
  assert.equal(manager.status().config.enabled, false);
  assert.equal(manager.status().runs.length, 0);
  assert.equal(store.list().length, 0);
});

test("profile checks serialize, reject setting changes and abort on shutdown", async (t) => {
  let entered!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  const { manager, request } = await fixture(
    t,
    (o) =>
      new Promise((_resolve, reject) => {
        entered();
        o.signal.addEventListener(
          "abort",
          () => reject(new Error("Run cancelled")),
          { once: true },
        );
      }),
  );
  const first = manager.testProfile(request, human);
  await started;
  assert.equal(manager.status().profileTest?.state, "running");
  await assert.rejects(manager.testProfile(request, human), /Wait/);
  await assert.rejects(
    manager.configure(manager.status().config, request.revision, human),
    /finish/,
  );
  await manager.close();
  assert.equal((await first).state, "failed");
  assert.match(manager.status().profileTest?.error ?? "", /cancelled/);
});

test("schema-invalid output and wrong outcomes fail without echoing provider payloads", async (t) => {
  let value: unknown = { outcome: "private-output-secret" };
  const { manager, request } = await fixture(t, async () => ({
    code: 0,
    output: "",
    structured: value,
  }));
  const result = await manager.testProfile(request, human);
  assert.equal(result.state, "failed");
  assert.ok(!result.error?.includes("private-output-secret"));
  value = { ...ready, outcome: "human", question: "Input needed" };
  assert.equal((await manager.testProfile(request, human)).state, "failed");
});

// Deliberately opt-in: the native CLI consumes provider quota. Supply a JSON file
// containing a saved Claude AgentProfile, never credentials or environment values.
test(
  "native configured Claude returns all real managed schemas",
  {
    skip: process.env.CONTROLROOM_NATIVE_PROFILE_TEST !== "1",
    timeout: 400000,
  },
  async (t) => {
    const profileFile = process.env.CONTROLROOM_NATIVE_PROFILE_FILE;
    assert.ok(
      profileFile,
      "Set CONTROLROOM_NATIVE_PROFILE_FILE to the chosen saved profile JSON",
    );
    const profile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
    assert.equal(profile.provider, "claude");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cr-native-profile-"));
    for (const kind of ["work", "plan", "review"] as const) {
      const directory = path.join(root, kind),
        cwd = path.join(directory, "workspace");
      fs.mkdirSync(cwd, { recursive: true });
      const expected =
        kind === "plan"
          ? { summary: "Profile check", question: "", tasks: [] }
          : { ...ready, outcome: kind === "review" ? "accept" : "ready" };
      const schema = agentResultJSONSchema(kind, "claude");
      const actual = await runAgent(
        profile,
        kind,
        `Return this exact structured result without using tools: ${JSON.stringify(expected)}`,
        schema,
        {
          directory,
          cwd,
          log: path.join(directory, "agent.log"),
          signal: new AbortController().signal,
          timeout: 120000,
          maxTurns: 5,
          smokeTest: true,
          onStart() {},
          onEvent() {},
        },
      );
      const Ajv = createRequire(import.meta.url)("ajv");
      const validate = new Ajv({ strict: false }).compile(schema);
      assert.equal(validate(actual), true);
      assert.deepEqual(actual, expected);
      t.diagnostic(
        `${profile.name}: ${kind} real schema accepted and structured result validated`,
      );
    }
  },
);

test("early provider failure reaches the managed ticket question with redacted stderr", async (t) => {
  const { store, manager } = await fixture(t, async () => ({
    code: 1,
    output: "private stdout context",
    eventCount: 0,
    stderrPrefix:
      "Error: --json-schema is not a valid JSON Schema: unsupported dialect\napi_key=private-token",
  }));
  const repository = path.join(store.root, "fixture-code");
  fs.mkdirSync(repository);
  git(repository, "init", "-b", "main");
  git(repository, "config", "user.name", "Test");
  git(repository, "config", "user.email", "test@localhost");
  fs.writeFileSync(path.join(repository, "README.md"), "Fixture");
  git(repository, "add", ".");
  git(repository, "commit", "-m", "Fixture");
  await manager.configure(
    {
      ...manager.status().config,
      enabled: true,
      repository,
      baseRef: "main",
      verificationCommand: "true",
    },
    manager.status().revision,
    human,
  );
  const ticket = await store.create(
    "ticket",
    { title: "Approved fixture", scopeApproved: true },
    "Check startup",
    human,
  );
  const run = await manager.enqueue(
    ticket.meta.id,
    "work",
    "Claude saved",
    human,
    ticket.revision,
  );
  await manager.tick();
  for (let i = 0; i < 100; i++) {
    const current = manager.status().runs.find((r) => r.id === run.id);
    if (current?.questionId) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const question = store
    .comments()
    .find((c) => c.kind === "question" && c.ticket === ticket.meta.id);
  assert.ok(question, "Managed startup failure must create a question");
  assert.match(question.body, /Managed run needs you/);
  assert.match(question.body, /--json-schema is not a valid JSON Schema/);
  assert.ok(!question.body.includes("private-token"));
  assert.ok(!question.body.includes("private stdout context"));
});
