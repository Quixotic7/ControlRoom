// The agent-facing surface: next-ticket selection, prompt-ready context,
// append-only history, the cached index, CLI input helpers, identity, and an
// end-to-end run of the CLI and the MCP server against a temporary project.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { Store } from "../src/store.js";
import { read } from "../src/files.js";
import { filterRecords, parseSet, resolveActor } from "../src/client.js";
import type { Actor } from "../src/types.js";
import { decisionProtocol } from "../src/decision-protocol.js";

const human: Actor = { name: "Human", kind: "human" },
  agent: Actor = { name: "Agent A", kind: "agent" },
  other: Actor = { name: "Agent B", kind: "agent" };
function fixture(t: test.TestContext) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "workboard-agent-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new Store(root).initialize("Agent project");
}

test("next picks approved, unblocked, unclaimed work: Selected first, then priority", async (t) => {
  const s = fixture(t);
  const goal = await s.create(
    "ticket",
    { title: "Goal", scopeApproved: true },
    "",
    human,
  );
  const low = await s.create(
    "ticket",
    { title: "Backlog low", parent: goal.meta.id, priority: 3 },
    "",
    human,
  );
  const urgent = await s.create(
    "ticket",
    { title: "Backlog urgent", parent: goal.meta.id, priority: 0 },
    "",
    human,
  );
  await s.create("ticket", { title: "Unapproved", priority: 0 }, "", human);
  await s.create(
    "ticket",
    { title: "Blocked", parent: goal.meta.id, priority: 0, blocked: "Waiting" },
    "",
    human,
  );
  // The goal itself is a container with open children, so it is skipped.
  assert.equal(s.next(agent)?.meta.title, "Backlog urgent");
  const selected = await s.update(
    low.meta.id,
    low.revision,
    { status: "selected" },
    undefined,
    human,
  );
  assert.equal(s.next(agent)?.meta.title, "Backlog low");
  await s.claim(selected.meta.id, other, "/tmp/other");
  assert.equal(s.next(agent)?.meta.title, "Backlog urgent");
  assert.equal(s.next(other)?.meta.title, "Backlog low");
  await s.claim(urgent.meta.id, other, "/tmp/other");
  await s.claim(selected.meta.id, other, "/tmp/other", true);
  assert.equal(s.next(agent)?.meta.title, "Backlog low");
});

test("context Markdown is a prompt-ready brief with an etag and token estimate", async (t) => {
  const s = fixture(t);
  await s.create(
    "rule",
    { title: "One primary action", status: "active", strength: "required" },
    "## Rule\n\nUse PrimaryButton.\n\n## Why\n\nA long rationale that brief mode trims.",
    human,
  );
  const goal = await s.create(
    "ticket",
    { title: "Goal", scopeApproved: true },
    "",
    human,
  );
  const child = await s.create(
    "ticket",
    { title: "Child", parent: goal.meta.id, labels: ["ui"] },
    "Do the thing.",
    human,
  );
  await s.comment(child.meta.id, "Which button?", agent, "question");
  const full = s.contextMarkdown(child.meta.id);
  assert.match(full.markdown, /^# #1 Child/);
  assert.match(full.markdown, new RegExp(`--etag\\)?: ${child.revision}`));
  assert.match(full.markdown, /Approved scope: #0 Goal/);
  assert.match(full.markdown, /One primary action \(required\)/);
  assert.match(full.markdown, /long rationale/);
  assert.match(full.markdown, /Agent A \(question/);
  assert.match(full.markdown, /controlroom claim 1/);
  assert.equal(full.tokens, Math.ceil(full.markdown.length / 4));
  const brief = s.contextMarkdown(child.meta.id, true);
  assert.doesNotMatch(brief.markdown, /long rationale/);
  assert.match(brief.markdown, /Use PrimaryButton/);
  assert.ok(brief.tokens < full.tokens);
});

test("history appends to one JSON Lines file and still reads legacy events", async (t) => {
  const s = fixture(t);
  const r = await s.create("ticket", { title: "Task" }, "", human);
  await s.update(r.meta.id, r.revision, { title: "Task 2" }, undefined, human);
  const file = s.file("records/history.jsonl");
  assert.equal(read(file).trim().split("\n").length, 2);
  assert.equal(fs.readdirSync(s.file("records/history")).length, 0);
  fs.writeFileSync(
    s.file("records/history/event-legacy.md"),
    `---\nid: event-legacy\nrecord: ${r.meta.id}\nactor:\n  name: Old\n  kind: human\naction: created\nat: 2020-01-01T00:00:00.000Z\n---\nold\n`,
  );
  const history = s.historyFor(r.meta.id);
  assert.equal(history.length, 3);
  assert.equal(history.at(-1)?.actor.name, "Old");
  assert.equal(history[0].action, "updated");
});

test("the index serves unchanged files from memory and notices direct edits", async (t) => {
  const s = fixture(t);
  const r = await s.create("ticket", { title: "Cached" }, "body", human);
  const first = s.get(r.meta.id);
  assert.equal(s.get(r.meta.id), first, "same object while unchanged");
  const file = s.file(r.path);
  fs.writeFileSync(file, read(file).replace("body", "edited outside"));
  const next = s.get(r.meta.id);
  assert.notEqual(next, first);
  assert.equal(next.body.trim(), "edited outside");
  assert.notEqual(next.revision, first.revision);
  const before = s.state().revision;
  await s.comment(r.meta.id, "hello", agent);
  assert.notEqual(s.state().revision, before);
});

test("review records code links and structured verification", async (t) => {
  const s = fixture(t);
  const r = await s.create(
    "ticket",
    { title: "Work", scopeApproved: true, status: "progress" },
    "",
    human,
  );
  const reviewed = await s.review(
    r.meta.id,
    r.revision,
    "Done the thing",
    "npm test passed",
    "",
    agent,
    {
      branch: "feature/x",
      pr: "https://example.com/pr/1",
      commits: ["abc123 first"],
      verification: {
        command: "npm test",
        exitCode: 0,
        output: "ok",
        at: "2026-01-01T00:00:00.000Z",
      },
    },
  );
  assert.equal(reviewed.meta.status, "review");
  assert.equal(reviewed.meta.branch, "feature/x");
  assert.equal(reviewed.meta.verification?.exitCode, 0);
  assert.match(s.contextMarkdown(r.meta.id).markdown, /`npm test` exited 0/);
});

test("--set parses JSON, lists, and strings; list filters match ids, names, roles, and claims", () => {
  assert.deepEqual(
    parseSet([
      "priority=1",
      "labels=a, b",
      "blocked=Needs API",
      "scopeApproved=true",
      "parent=null",
    ]),
    {
      priority: 1,
      labels: ["a", "b"],
      blocked: "Needs API",
      scopeApproved: true,
      parent: null,
    },
  );
  assert.throws(() => parseSet(["nonsense"]));
  const columns = [
    { id: "backlog", name: "Backlog", role: "backlog" },
    { id: "done", name: "Finished", role: "done" },
  ];
  const mk = (id: string, meta: Record<string, unknown>) =>
    ({
      meta: { id, kind: "ticket", title: id, status: "backlog", ...meta },
      body: "",
      revision: "",
      path: "",
    }) as any;
  const records = [
    mk("a", { owner: "Agent A", labels: ["ui"] }),
    mk("b", { status: "done" }),
    mk("c", { archived: true }),
    mk("d", { kind: "rule", status: "active" }),
  ];
  const claims = [
    { ticket: "b", actor: agent, expiresAt: "2999-01-01T00:00:00.000Z" },
  ];
  const ids = (rs: any[]) => rs.map((r) => r.meta.id);
  assert.deepEqual(ids(filterRecords(records, {})), ["a", "b", "d"]);
  assert.deepEqual(
    ids(filterRecords(records, { status: "Finished", columns })),
    ["b"],
  );
  assert.deepEqual(ids(filterRecords(records, { status: "done", columns })), [
    "b",
  ]);
  assert.deepEqual(ids(filterRecords(records, { open: true, columns })), ["a"]);
  assert.deepEqual(ids(filterRecords(records, { mine: "agent a", claims })), [
    "a",
    "b",
  ]);
  assert.deepEqual(ids(filterRecords(records, { label: "UI" })), ["a"]);
  assert.deepEqual(ids(filterRecords(records, { archived: true })), ["c"]);
  assert.deepEqual(ids(filterRecords(records, { kind: "rule" })), ["d"]);
});

const identityEnvironment = [
  "CONTROLROOM_MANAGED",
  "CONTROLROOM_ACTOR",
  "CONTROLROOM_ACTOR_KIND",
  "WORKBOARD_ACTOR",
  "WORKBOARD_ACTOR_KIND",
  "CLAUDECODE",
  "CODEX_SANDBOX",
  "CODEX_CI",
  "CURSOR_TRACE_ID",
  "GEMINI_CLI",
  "AIDER_MODEL",
] as const;

function isolatedChildEnvironment(overrides: Record<string, string> = {}) {
  const env = { ...process.env };
  for (const key of [
    "CONTROLROOM_MANAGED",
    "CONTROLROOM_ACTOR",
    "CONTROLROOM_ACTOR_KIND",
    "WORKBOARD_ACTOR",
    "WORKBOARD_ACTOR_KIND",
  ])
    delete env[key];
  return { ...env, ...overrides };
}

test("identity comes from the environment before flags, and agents never default to human", (t) => {
  const before = Object.fromEntries(
    identityEnvironment.map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const key of identityEnvironment) {
      const value = before[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  t_env({ WORKBOARD_ACTOR: "Session 7", WORKBOARD_ACTOR_KIND: "agent" });
  assert.deepEqual(resolveActor({}), {
    actor: { name: "Session 7", kind: "agent" },
    inferred: false,
  });
  t_env({ WORKBOARD_ACTOR: "Session 7", WORKBOARD_ACTOR_KIND: "human" });
  assert.equal(resolveActor({ name: "Morgan" }).actor.name, "Morgan");
  assert.equal(resolveActor({}).actor.kind, "human");
  t_env({ CLAUDECODE: "1" });
  const inferred = resolveActor({});
  assert.deepEqual(inferred.actor, { name: "Claude Code", kind: "agent" });
  assert.equal(inferred.inferred, true);
  assert.equal(resolveActor({ human: true }).actor.kind, "human");
  t_env({
    CONTROLROOM_MANAGED: "1",
    CONTROLROOM_ACTOR: "Managed Sol",
    CONTROLROOM_ACTOR_KIND: "agent",
  });
  assert.deepEqual(resolveActor({}).actor, {
    name: "Managed Sol",
    kind: "agent",
  });
  function t_env(vars: Record<string, string>) {
    for (const key of identityEnvironment) delete process.env[key];
    Object.assign(process.env, vars);
  }
});

const node = process.execPath;
const cli = path.resolve("src/cli.ts");
function run(root: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(
    node,
    ["--import", "tsx", cli, "--project", root, ...args],
    {
      encoding: "utf8",
      env: isolatedChildEnvironment({
        WORKBOARD_ACTOR: "Agent CLI",
        WORKBOARD_ACTOR_KIND: "agent",
        ...env,
      }),
      timeout: 60_000,
    },
  );
  return { out: r.stdout.trim(), err: r.stderr.trim(), code: r.status };
}

test("CLI: next, context brief, --set, --latest, review --run, wait, and MCP over stdio", async (t) => {
  const s = fixture(t);
  t.after(() => run(s.root, ["stop"]));
  const goal = await s.create(
    "ticket",
    { title: "Goal", scopeApproved: true, labels: ["cli"] },
    "",
    human,
  );
  const child = await s.create(
    "ticket",
    { title: "Child work", parent: goal.meta.id, priority: 1 },
    "Do it.",
    human,
  );

  let r = run(s.root, ["next"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^# #1 Child work/);
  assert.match(r.out, /Approved scope: #0 Goal/);

  r = run(s.root, ["context", "1", "--brief", "--json"]);
  const brief = JSON.parse(r.out);
  assert.ok(brief.tokens > 10);

  r = run(s.root, [
    "update",
    "1",
    "--latest",
    "--set",
    "labels=cli,agent",
    "--set",
    "priority=0",
  ]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(
    JSON.parse(run(s.root, ["show", "1", "--json"]).out).meta.labels,
    ["cli", "agent"],
  );

  r = run(s.root, ["move", "1", "progress"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /--etag is required/);
  r = run(s.root, ["claim", "1"]);
  assert.equal(r.code, 0, r.err);
  r = run(s.root, ["move", "1", "progress", "--latest"]);
  assert.equal(r.code, 0, r.err);

  r = run(s.root, [
    "review",
    "1",
    "--latest",
    "--handoff",
    "Implemented",
    "--run",
    "exit 3",
  ]);
  assert.equal(r.code, 1);
  assert.match(r.err, /Verification failed \(exit 3\)/);
  r = run(s.root, [
    "review",
    "1",
    "--latest",
    "--handoff",
    "Implemented",
    "--run",
    "echo tests-ok",
    "--commits",
    "abc123 first",
    "--json",
  ]);
  assert.equal(r.code, 0, r.err);
  const reviewed = JSON.parse(r.out);
  assert.equal(reviewed.meta.status, "review");
  assert.equal(reviewed.meta.verification.exitCode, 0);
  assert.match(reviewed.meta.verification.output, /tests-ok/);
  assert.match(reviewed.meta.evidence, /exited 0/);

  r = run(s.root, ["list", "--status", "review", "--mine"]);
  assert.match(r.out, /#1 +review +Child work/);
  r = run(s.root, ["list", "--open", "--label", "nope"]);
  assert.equal(r.out, "No matching records.");

  // A human forgetting flags in an interactive shell would be a human; an
  // agent harness or a pipe is an agent, and cannot mark work done.
  r = run(s.root, ["move", "1", "done", "--latest"], {
    WORKBOARD_ACTOR_KIND: "",
    WORKBOARD_ACTOR: "",
    CLAUDECODE: "1",
  });
  assert.equal(r.code, 1);
  assert.match(r.err, /Acting as agent "Claude Code"/);
  assert.match(r.err, /human accepts Done/);

  // wait resolves when a comment lands.
  const waiter = spawn(
    node,
    [
      "--import",
      "tsx",
      cli,
      "--project",
      s.root,
      "wait",
      "1",
      "--for",
      "comment",
      "--timeout",
      "30",
      "--json",
    ],
    {
      env: isolatedChildEnvironment({
        WORKBOARD_ACTOR: "Agent CLI",
        WORKBOARD_ACTOR_KIND: "agent",
      }),
    },
  );
  let waited = "";
  waiter.stdout.on("data", (d) => (waited += d));
  await new Promise((resolve) => setTimeout(resolve, 2500));
  run(s.root, ["comment", "1", "--body", "Looks good"], {
    WORKBOARD_ACTOR: "Human",
    WORKBOARD_ACTOR_KIND: "human",
  });
  const code = await new Promise<number | null>((resolve) =>
    waiter.on("close", resolve),
  );
  assert.equal(code, 0, waited);
  const change = JSON.parse(waited);
  assert.equal(change.change, "comment");
  assert.equal(change.comments.at(-1).body.trim(), "Looks good");

  // MCP: initialize, list tools, call one.
  const mcp = spawn(
    node,
    ["--import", "tsx", cli, "--project", s.root, "mcp"],
    {
      env: isolatedChildEnvironment({
        WORKBOARD_ACTOR: "Agent MCP",
        WORKBOARD_ACTOR_KIND: "agent",
      }),
    },
  );
  t.after(() => mcp.kill());
  const lines: any[] = [];
  let buffer = "";
  mcp.stdout.on("data", (d) => {
    buffer += d;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      lines.push(JSON.parse(buffer.slice(0, i)));
      buffer = buffer.slice(i + 1);
    }
  });
  const send = (m: unknown) => mcp.stdin.write(JSON.stringify(m) + "\n");
  const until = async (n: number) => {
    for (let i = 0; i < 300 && lines.length < n; i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.equal(
      lines.length >= n,
      true,
      `expected ${n} replies, got ${JSON.stringify(lines)}`,
    );
  };
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "list_tickets", arguments: { status: "review" } },
  });
  send({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "move_ticket",
      arguments: { id: "1", etag: "stale", status: "progress" },
    },
  });
  await until(4);
  lines.sort((a, b) => a.id - b.id);
  assert.equal(lines[0].result.serverInfo.name, "controlroom");
  assert.match(lines[0].result.instructions, /Agent MCP/);
  assert.ok(lines[0].result.instructions.includes(decisionProtocol));
  const names = lines[1].result.tools.map((t: any) => t.name);
  assert.ok(
    names.includes("get_context") &&
      names.includes("submit_review") &&
      names.includes("wait_for_update"),
  );
  const listed = JSON.parse(lines[2].result.content[0].text);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, "Child work");
  assert.equal(lines[3].result.isError, true);
  assert.match(lines[3].result.content[0].text, /^409/);
  // CLI and MCP share a durable decision workflow, including predecessor search.
  const cliDecision = JSON.parse(
    run(s.root, [
      "create",
      "decision",
      "--title",
      "Storage choice",
      "--body",
      "## Choice\n\nFiles\n\n## Rationale\n\nPortable",
      "--set",
      "status=accepted",
      "--json",
    ]).out,
  );
  send({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "create_decision",
      arguments: {
        title: "Storage choice refined",
        body: "## Choice\n\nShared files\n\n## Rationale\n\nSerialize concurrent writes\n\n## Alternatives and tradeoffs\n\nDatabase adds setup",
        status: "accepted",
        supersedes: cliDecision.meta.id,
        references: [child.meta.id],
        scope: ["storage"],
      },
    },
  });
  await until(5);
  const successor = JSON.parse(
    lines.find((l) => l.id === 5).result.content[0].text,
  );
  assert.equal(successor.meta.author.name, "Agent MCP");
  const freshChild = JSON.parse(run(s.root, ["show", "1", "--json"]).out);
  send({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: {
      name: "update_ticket",
      arguments: {
        id: "1",
        etag: freshChild.revision,
        fields: { decisions: [successor.meta.id], archived: true },
      },
    },
  });
  await until(6);
  assert.ok(!lines.find((l) => l.id === 6).result.isError);
  send({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: {
      name: "list_knowledge",
      arguments: { kind: "decision", query: "STORAGE CHOICE" },
    },
  });
  send({
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: {
      name: "list_knowledge",
      arguments: {
        kind: "decision",
        query: "storage choice",
        include_inactive: true,
      },
    },
  });
  await until(8);
  const currentKnowledge = JSON.parse(
    lines.find((l) => l.id === 7).result.content[0].text,
  );
  assert.deepEqual(
    currentKnowledge.map((r: any) => r.id),
    [successor.meta.id],
  );
  const allKnowledge = JSON.parse(
    lines.find((l) => l.id === 8).result.content[0].text,
  );
  assert.equal(allKnowledge.length, 2);
  assert.equal(currentKnowledge[0].supersedes, cliDecision.meta.id);
  const decisionBrief = JSON.parse(
    run(s.root, ["context", "1", "--brief", "--json"]).out,
  );
  assert.ok(decisionBrief.markdown.includes(decisionProtocol));
  assert.match(decisionBrief.markdown, /Shared files/);
  const questionnaireFile = path.join(s.root, "questions.json");
  fs.writeFileSync(
    questionnaireFile,
    JSON.stringify([
      {
        id: "pick",
        prompt: "Which option?",
        type: "choice",
        choices: ["A", "B"],
        recommended: "A",
      },
    ]),
  );
  const questionnaire = run(s.root, [
    "questionnaire",
    "1",
    "--file",
    questionnaireFile,
    "--json",
  ]);
  assert.equal(questionnaire.code, 0, questionnaire.err);
  const question = JSON.parse(questionnaire.out);
  assert.equal(question.questions[0].id, "pick");
  const progress = run(s.root, [
    "progress",
    "1",
    "--latest",
    "--body",
    "Checking interfaces",
    "--percent",
    "70",
    "--json",
  ]);
  assert.equal(progress.code, 0, progress.err);
  assert.equal(JSON.parse(progress.out).meta.progress.percent, 70);
  send({
    jsonrpc: "2.0",
    id: 9,
    method: "tools/call",
    params: {
      name: "ask_questionnaire",
      arguments: {
        id: "1",
        questions: [{ id: "why", prompt: "Why?", type: "text" }],
      },
    },
  });
  await until(9);
  assert.ok(!lines.find((l) => l.id === 9).result.isError);
  const current = s.get("1");
  send({
    jsonrpc: "2.0",
    id: 10,
    method: "tools/call",
    params: {
      name: "report_progress",
      arguments: {
        id: "1",
        etag: current.revision,
        note: "MCP progress",
        percent: 80,
      },
    },
  });
  await until(10);
  assert.ok(!lines.find((l) => l.id === 10).result.isError);
  assert.equal(s.get("1").meta.progress?.percent, 80);
  const createRelated = (title: string) => {
    const response = run(s.root, [
      "create",
      "ticket",
      "--title",
      title,
      "--json",
    ]);
    assert.equal(response.code, 0, response.err);
    return JSON.parse(response.out);
  };
  const left = createRelated("CLI merge survivor"),
    right = createRelated("CLI duplicate source");
  const relate = run(s.root, [
    "relate",
    String(left.meta.number),
    String(right.meta.number),
    "--etag",
    left.revision,
    "--other-etag",
    right.revision,
    "--json",
  ]);
  assert.equal(relate.code, 0, relate.err);
  const linked = JSON.parse(relate.out);
  send({
    jsonrpc: "2.0",
    id: 11,
    method: "tools/call",
    params: {
      name: "set_related_ticket",
      arguments: {
        id: left.meta.id,
        other: right.meta.id,
        etag: linked.ticket.revision,
        other_etag: linked.related.revision,
        action: "remove",
      },
    },
  });
  await until(11);
  assert.ok(!lines.find((l) => l.id === 11).result.isError);
  assert.deepEqual(s.get(left.meta.id).meta.related, []);
  const cliPreview = run(s.root, [
    "merge-preview",
    String(left.meta.number),
    String(right.meta.number),
    "--json",
  ]);
  assert.equal(cliPreview.code, 0, cliPreview.err);
  send({
    jsonrpc: "2.0",
    id: 12,
    method: "tools/call",
    params: {
      name: "preview_ticket_merge",
      arguments: { survivor: left.meta.id, source: right.meta.id },
    },
  });
  await until(12);
  const previewReply = lines.find((l) => l.id === 12).result;
  assert.ok(!previewReply.isError, previewReply.content[0].text);
  const preview = JSON.parse(previewReply.content[0].text);
  assert.deepEqual(preview.affected, JSON.parse(cliPreview.out).affected);
  send({
    jsonrpc: "2.0",
    id: 13,
    method: "tools/call",
    params: {
      name: "merge_duplicate_ticket",
      arguments: {
        survivor: left.meta.id,
        source: right.meta.id,
        request_id: "mcp-merge-request",
        revisions: preview.affected,
        resolutions: {},
      },
    },
  });
  await until(13);
  const mergeReply = lines.find((l) => l.id === 13).result;
  assert.ok(!mergeReply.isError, mergeReply.content[0].text);
  assert.equal(s.get(right.meta.id).meta.duplicateOf, left.meta.id);
  assert.equal(s.get(right.meta.id).meta.status, "backlog");
  mcp.stdin.end();
  await new Promise((resolve) => mcp.on("close", resolve));
});
