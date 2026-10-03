import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { Store } from "../src/store.js";
import { buildServer } from "../src/server.js";
import { runVerification, waitForChange } from "../src/client.js";

const run = promisify(execFile);
const tool = path.resolve(".");
const loader = path.join(tool, "node_modules/tsx/dist/loader.mjs");
const cli = path.join(tool, "src/cli.ts");
const human = { name: "Fixture human", kind: "human" as const };
const env = {
  ...process.env,
  WORKBOARD_ACTOR: "Regression agent",
  WORKBOARD_ACTOR_KIND: "agent",
};
function fixture(t: test.TestContext) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "controlroom-fix-")),
  );
  t.after(async () => {
    const info = path.join(root, ".controlroom/.local/service.json");
    if (fs.existsSync(info)) {
      const { pid } = JSON.parse(fs.readFileSync(info, "utf8"));
      if (pid !== process.pid) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {}
        for (let i = 0; i < 40; i++) {
          try {
            process.kill(pid, 0);
          } catch {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return new Store(root).initialize();
}
async function command(root: string, args: string[], cwd = root) {
  const result = await run(
    process.execPath,
    ["--import", loader, cli, "--project", root, ...args, "--json"],
    { cwd, env, timeout: 15_000 },
  );
  return JSON.parse(result.stdout);
}
async function listening(t: test.TestContext, s: Store) {
  const app = await buildServer(s);
  const url = await app.listen({ host: "127.0.0.1", port: 0 });
  fs.writeFileSync(
    s.file(".local/service.json"),
    JSON.stringify({ url, pid: process.pid }),
  );
  t.after(() => app.close());
  return app;
}

test("startup resolves the source loader outside the tool directory", async (t) => {
  const s = fixture(t);
  const records = await command(s.root, ["list"]);
  assert.deepEqual(records, []);
  const status = JSON.parse(
    fs.readFileSync(s.file(".local/service.json"), "utf8"),
  );
  assert.notEqual(status.pid, process.pid);
});

test("numeric links persist canonical IDs and preserve relationship validation", async (t) => {
  const s = fixture(t);
  const parent = await s.create(
    "ticket",
    { title: "Parent", scopeApproved: true },
    "",
    human,
  );
  let child = await s.create(
    "ticket",
    { title: "Child", parent: "#0", dependencies: [0] },
    "Custom prose",
    human,
  );
  assert.equal(child.meta.parent, parent.meta.id);
  assert.deepEqual(child.meta.dependencies, [parent.meta.id]);
  child = await s.update(
    "1",
    child.revision,
    { parent: 0, dependencies: ["#0"] },
    undefined,
    human,
  );
  assert.equal(child.meta.parent, parent.meta.id);
  assert.equal(child.body, "Custom prose");
  await assert.rejects(
    s.update("0", parent.revision, { parent: "#1" }, undefined, human),
    /cycle/,
  );
  await assert.rejects(
    s.update("1", child.revision, { dependencies: [1] }, undefined, human),
    /Invalid dependency/,
  );
  await assert.rejects(
    s.create("ticket", { title: "Missing", parent: "#999" }, "", human),
  );
  const rule = await s.create("rule", { title: "Rule" }, "", human);
  await assert.rejects(
    s.update("1", child.revision, { parent: rule.meta.id }, undefined, human),
    /refer to a ticket/,
  );
  assert.equal(s.context("#1").parent?.meta.id, parent.meta.id);
});

test("briefs retain ancestor approval boundaries and generate executable commands", async (t) => {
  const s = fixture(t);
  const scope = await s.create(
    "ticket",
    { title: "Approved goal", scopeApproved: true },
    "Only change the parser.\n\nNever change the renderer.",
    human,
  );
  const parent = await s.create(
    "ticket",
    { title: "Parent", parent: scope.meta.id },
    "Keep output compatible.",
    human,
  );
  const child = await s.create(
    "ticket",
    { title: "Child", parent: parent.meta.id },
    "Implement parser fix.",
    human,
  );
  for (const brief of [true, false]) {
    const result = s.contextMarkdown(child.meta.id, brief).markdown;
    assert.match(result, /Never change the renderer/);
    assert.match(result, /Keep output compatible/);
    assert.match(result, /Author: Fixture human/);
    assert.match(result, /controlroom claim 2`/);
    assert.doesNotMatch(result, /controlroom (claim|comment|review) #/);
  }
  const direct = s.contextMarkdown(parent.meta.id, true).markdown;
  assert.equal(direct.split("Never change the renderer").length, 2);
});

test("verification records signal, timeout, and spawn errors as failures", async (t) => {
  const s = fixture(t);
  assert.equal((await runVerification("printf passed", s.root)).exitCode, 0);
  assert.equal((await runVerification("exit 7", s.root)).exitCode, 7);
  const signal = await runVerification("kill -TERM $$", s.root);
  assert.notEqual(signal.exitCode, 0);
  assert.match(signal.output, /SIGTERM/);
  const timeout = await runVerification("exec sleep 5", s.root, {
    timeoutMs: 50,
  });
  assert.notEqual(timeout.exitCode, 0);
  assert.match(timeout.output, /Verification failed/);
  const absent = await runVerification("pwd", path.join(s.root, "absent"));
  assert.notEqual(absent.exitCode, 0);
  assert.match(absent.output, /ENOENT/);
});

test("agent review transitions publish durable summaries without duplicating routine edits", async (t) => {
  const s = fixture(t);
  const agent = { name: "Review agent", kind: "agent" as const };
  let ticket = await s.create(
    "ticket",
    { title: "Review feedback", scopeApproved: true },
    "Acceptance criteria remain here.",
    human,
  );
  await assert.rejects(
    s.update("0", ticket.revision, { status: "review" }, undefined, agent),
    /handoff/,
  );
  assert.equal(s.comments().length, 0);
  const oldRevision = ticket.revision;
  ticket = await s.review(
    "0",
    ticket.revision,
    "Fixed the form.",
    "Three browser checks passed.",
    "Native check still needed.",
    agent,
    {
      reviewInstructions:
        "Open the form, submit a title, and expect the modal to close.",
      pr: "https://example.invalid/pull/1",
    },
  );
  let comments = s.context("0").comments;
  assert.equal(comments.length, 1);
  assert.equal(comments[0].kind, "review");
  assert.deepEqual(comments[0].actor, agent);
  for (const text of [
    "## Work completed",
    "Fixed the form.",
    "## What to review",
    "expect the modal to close",
    "Three browser checks passed",
    "Native check still needed",
    "https://example.invalid/pull/1",
  ])
    assert.ok(comments[0].body.includes(text), text);
  assert.equal(
    new Store(s.root).context("0").comments[0].body,
    comments[0].body,
  );
  await assert.rejects(
    s.review("0", oldRevision, "Stale", "Stale", "", agent),
    /changed/,
  );
  ticket = await s.update(
    "0",
    ticket.revision,
    { labels: ["forms"] },
    undefined,
    agent,
  );
  assert.equal(s.comments().length, 1);
  await s.comment("0", "Please fix the remaining issue.", human, "review");
  ticket = await s.update(
    "0",
    ticket.revision,
    { status: "progress" },
    undefined,
    agent,
  );
  await s.update(
    "0",
    ticket.revision,
    {
      status: "review",
      handoff: "Remaining issue fixed.",
      reviewInstructions: "",
    },
    undefined,
    agent,
  );
  comments = s.context("0").comments;
  assert.equal(comments.length, 3);
  assert.ok(
    comments.some(
      (c) => c.actor.kind === "human" && c.body.includes("remaining issue"),
    ),
  );
  assert.ok(
    comments.some(
      (c) =>
        c.body.includes("Remaining issue fixed.") &&
        c.body.includes("acceptance criteria"),
    ),
  );
});

test("CLI accepts hash IDs for reads, writes, relationships, and rejects interrupted review", async (t) => {
  const s = fixture(t);
  await s.create("ticket", { title: "Goal", scopeApproved: true }, "", human);
  await listening(t, s);
  const root = await command(s.root, ["show", "#0"]);
  assert.equal(root.meta.number, 0);
  let child = await command(s.root, [
    "create",
    "ticket",
    "--title",
    "Child",
    "--parent",
    "#0",
  ]);
  assert.equal(child.meta.parent, root.meta.id);
  child = await command(s.root, [
    "update",
    "#1",
    "--etag",
    child.revision,
    "--set",
    "parent=0",
    "--set",
    "dependencies=#0",
  ]);
  await command(s.root, ["claim", "#1"]);
  await command(s.root, [
    "comment",
    "#1",
    "--body",
    "Read and write succeeded",
  ]);
  const context = await command(s.root, ["context", "#1"]);
  assert.equal(context.comments.length, 1);
  assert.equal(context.dependencies[0].meta.number, 0);
  await assert.rejects(
    command(s.root, [
      "review",
      "#1",
      "--etag",
      child.revision,
      "--handoff",
      "Work complete",
      "--run",
      "kill -TERM $$",
    ]),
    /Verification failed/,
  );
  assert.equal(s.get("1").meta.status, "backlog");
  const overridden = await command(s.root, [
    "review",
    "#1",
    "--etag",
    child.revision,
    "--handoff",
    "Failed run acknowledged",
    "--review-notes",
    "Inspect the recorded interrupted run before accepting.",
    "--run",
    "kill -TERM $$",
    "--allow-failure",
  ]);
  assert.notEqual(overridden.meta.verification.exitCode, 0);
  assert.match(
    s.context("1").comments.find((c) => c.kind === "review")!.body,
    /Inspect the recorded interrupted run/,
  );
  const wait = waitForChange(s, "#1", "comment", 3000);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await s.comment("1", "Wake hash waiter", human);
  assert.equal((await wait)?.change, "comment");
  const questionnaire = await s.questionnaire(
    "1",
    [{ id: "answer", prompt: "Ready?", type: "text" }],
    human,
  );
  const answerWait = waitForChange(s, "1", "comment", 3000);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await s.answerQuestionnaire(
    questionnaire.id,
    questionnaire.revision,
    { answer: "Yes" },
    human,
  );
  const answered = await answerWait;
  assert.equal(answered?.change, "comment");
  assert.equal(
    answered?.comments.find((c) => c.id === questionnaire.id).answers[0].values
      .answer,
    "Yes",
  );
  const start = Date.now();
  assert.equal(await waitForChange(s, "#1", "comment", 80), null);
  assert.ok(Date.now() - start < 1000);
});

test("MCP uses the execution checkout and responds during a cancellable wait", async (t) => {
  const s = fixture(t);
  const checkout = path.join(s.root, "code-checkout");
  fs.mkdirSync(checkout);
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: checkout, encoding: "utf8" }).trim();
  git(["init", "-b", "agent-fix"]);
  git([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "baseline",
  ]);
  const base = git(["rev-parse", "HEAD"]);
  git([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "code fix",
  ]);
  const record = await s.create(
    "ticket",
    { title: "Approved work", scopeApproved: true },
    "",
    human,
  );
  await listening(t, s);
  const child = spawn(
    process.execPath,
    ["--import", loader, cli, "--project", s.root, "mcp"],
    { cwd: checkout, env },
  );
  let buffer = "";
  const replies = new Map<number, any>();
  child.stdout.on("data", (d) => {
    buffer += d;
    let i: number;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const reply = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      replies.set(reply.id, reply);
    }
  });
  const exited = new Promise((resolve) => child.on("close", resolve));
  t.after(async () => {
    child.kill();
    await exited;
  });
  const send = (message: unknown) =>
    child.stdin.write(JSON.stringify(message) + "\n");
  const call = (id: number, name: string, args: object) =>
    send({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    });
  const response = async (id: number) => {
    for (let i = 0; i < 150 && !replies.has(id); i++)
      await new Promise((r) => setTimeout(r, 20));
    assert.ok(replies.has(id), `No reply for ${id}`);
    return replies.get(id);
  };
  const value = async (id: number) =>
    JSON.parse((await response(id)).result.content[0].text);
  call(1, "claim_ticket", { id: "#0" });
  await response(1);
  assert.equal(s.claims()[0].worktree, checkout);
  assert.equal(s.claims()[0].branch, "agent-fix");
  call(2, "submit_review", {
    id: "#0",
    etag: record.revision,
    handoff: "Verified here",
    review_instructions: "Check the recorded checkout path and branch.",
    run: "pwd",
    commits_since: base,
    build: "dist/MCP Preview.app",
    build_label: "MCP Preview",
    build_sha: "abc123",
  });
  const reviewed = await value(2);
  assert.equal(reviewed.meta.verification.cwd, checkout);
  assert.equal(reviewed.meta.verification.output, checkout);
  assert.equal(reviewed.meta.branch, "agent-fix");
  assert.match(reviewed.meta.commits.join("\n"), /code fix/);
  assert.equal(reviewed.meta.build.path, "dist/MCP Preview.app");
  assert.equal(reviewed.meta.build.label, "MCP Preview");
  assert.equal(reviewed.meta.build.sha, "abc123");
  assert.deepEqual(reviewed.meta.build.actor, {
    name: "Regression agent",
    kind: "agent",
  });
  assert.equal(s.context("0").ticket.meta.build?.path, "dist/MCP Preview.app");
  assert.match(
    s.context("0").comments[0].body,
    /Check the recorded checkout path and branch/,
  );
  const invalidBuildMarker = path.join(checkout, "invalid-build-ran");
  call(8, "submit_review", {
    id: "0",
    etag: reviewed.revision,
    handoff: "Must fail before verification",
    build_label: "Orphan label",
    run: "touch invalid-build-ran",
  });
  assert.equal((await response(8)).result.isError, true);
  assert.match(
    (await response(8)).result.content[0].text,
    /build_label and build_sha require build/,
  );
  assert.equal(fs.existsSync(invalidBuildMarker), false);
  call(3, "submit_review", {
    id: "0",
    etag: reviewed.revision,
    handoff: "Interrupted",
    run: "kill -TERM $$",
  });
  assert.equal((await response(3)).result.isError, true);
  call(4, "wait_for_update", { id: "#0", for: "comment", timeout_seconds: 30 });
  call(5, "get_ticket", { id: "#0" });
  send({ jsonrpc: "2.0", id: 6, method: "ping" });
  await response(5);
  await response(6);
  assert.equal(replies.has(4), false);
  send({
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: { requestId: 4 },
  });
  assert.match((await response(4)).result.content[0].text, /cancelled/);
  call(7, "wait_for_update", { id: "#0", for: "comment", timeout_seconds: 30 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  child.stdin.end();
  await Promise.race([
    exited,
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("MCP did not exit after stdin closed")),
        1500,
      );
      timer.unref();
    }),
  ]);
});
