import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { Orchestrator, defaultOrchestration } from "../src/orchestration.js";
import { execute, git, type Execute } from "../src/agent-runner.js";
import type { Actor } from "../src/types.js";
const human: Actor = { name: "Human", kind: "human" },
  worker: Actor = { name: "Worker 1", kind: "agent" };
const result = (outcome = "ready") => ({
  outcome,
  summary: "Implemented the approved outcome",
  criteria: "Inspected the new file and required behavior",
  evidence: "Independent verification plus diff inspection",
  question: "",
});
async function fixture(t: test.TestContext, runner?: Execute) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-orchestration-")),
  );
  const repository = path.join(root, "code");
  fs.mkdirSync(repository);
  git(repository, "init", "-b", "main");
  git(repository, "config", "user.name", "Test");
  git(repository, "config", "user.email", "test@localhost");
  fs.writeFileSync(path.join(repository, "README.md"), "Fixture\n");
  git(repository, "add", ".");
  git(repository, "commit", "-m", "Initial");
  const board = path.join(root, "board");
  fs.mkdirSync(board);
  const store = new Store(board).initialize("Orchestration fixture");
  const executable = path.join(root, "fixture-agent");
  fs.writeFileSync(
    executable,
    `#!${process.execPath}\n` +
      `
const fs = require('node:fs'), path = require('node:path');
let prompt = ''; process.stdin.on('data', c => prompt += c); process.stdin.on('end', () => {
 const args = process.argv.slice(2), review = prompt.startsWith('Independently'), plan = prompt.startsWith('Decompose');
 let value = ${JSON.stringify(result())};
 if (plan) value = {summary: 'Two independent children', question: '', tasks: [0,1].map(i => ({title:'Child '+i,description:'Create a distinct file for this child',acceptance:'File exists with implemented content',worker:'Worker '+(i+1),dependencies:[],priority:2}))};
 else if (review) value.outcome = 'accept';
 else fs.writeFileSync(path.join(process.cwd(), path.basename(process.cwd())+'.txt'), 'Implemented\\n');
 console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-session'}));
 const at = args.indexOf('--output-last-message');
 if (at >= 0) fs.writeFileSync(args[at+1], JSON.stringify(value));
 else console.log(JSON.stringify({type:'result',structured_output:value}));
});
`,
    { mode: 0o755 },
  );
  const manager = new Orchestrator(store, runner);
  const config = {
    ...structuredClone(defaultOrchestration),
    enabled: true,
    repository,
    verificationCommand: "test -f README.md",
    reviewer: { ...defaultOrchestration.reviewer, executable },
    workers: defaultOrchestration.workers.map((w) => ({ ...w, executable })),
  };
  await manager.configure(config, manager.status().revision, human);
  t.after(async () => {
    await manager.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const create = (title = "Approved", extra = {}) =>
    store.create(
      "ticket",
      { title, scopeApproved: true, ...extra },
      "## Acceptance criteria\nCreate the required file.\n",
      human,
    );
  return { root, repository, store, manager, create, executable, config };
}
async function until(m: Orchestrator, predicate: () => boolean) {
  for (let i = 0; i < 200; i++) {
    await m.tick();
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail(JSON.stringify(m.status().runs, null, 2));
}
test("managed plan launches two distinct harness workers, independently reviews both, and preserves parent and main checkout", async (t) => {
  const { manager, store, create, repository } = await fixture(t);
  const parent = await create("Approved goal");
  await manager.enqueue(
    parent.meta.id,
    "plan",
    undefined,
    human,
    parent.revision,
  );
  await until(
    manager,
    () =>
      store
        .list()
        .filter(
          (r) => r.meta.parent === parent.meta.id && r.meta.status === "done",
        ).length === 2,
  );
  const children = store.list().filter((r) => r.meta.parent === parent.meta.id);
  assert.equal(new Set(children.map((r) => r.meta.assignment?.worker)).size, 2);
  for (const child of children) {
    assert.equal(child.meta.agentReview?.outcome, "accept");
    assert.equal(child.meta.agentReview?.reviewer, "Orchestrator");
    assert.notEqual(
      child.meta.agentReview?.reviewer,
      child.meta.agentReview?.worker,
    );
    assert.equal(child.meta.agentReview?.integration, "not-integrated");
    assert.equal(child.meta.assignment?.state, "submitted");
    assert.equal(child.meta.verification?.exitCode, 0);
    assert.ok(child.meta.commits?.length);
  }
  assert.equal(store.get(parent.meta.id).meta.status, "progress");
  assert.equal(git(repository, "status", "--porcelain"), "");
  assert.equal(git(repository, "rev-list", "--count", "HEAD"), "1");
  assert.ok(
    store
      .comments()
      .some((c) => c.body.includes("Acceptance criteria checked")),
  );
  const restored = new Store(store.root).initialize();
  assert.equal(
    restored.get(children[0].meta.id).meta.agentReview?.reviewer,
    "Orchestrator",
  );
});
test("scope, assignment, authority and receipt forgery are rejected", async (t) => {
  const { manager, store, create, config } = await fixture(t);
  const unapproved = await create("Unapproved", { scopeApproved: false });
  await assert.rejects(
    manager.enqueue(
      unapproved.meta.id,
      "work",
      "Worker 1",
      human,
      unapproved.revision,
    ),
    /approved/,
  );
  const ticket = await create();
  await assert.rejects(
    manager.configure(config, manager.status().revision, worker),
    /human/,
  );
  await assert.rejects(
    manager.enqueue(ticket.meta.id, "work", undefined, worker, ticket.revision),
    /designated/,
  );
  await assert.rejects(
    store.update(
      ticket.meta.id,
      ticket.revision,
      { agentReview: { outcome: "accept" } },
      undefined,
      worker,
    ),
    /service-owned/,
  );
  await assert.rejects(
    store.update(
      ticket.meta.id,
      ticket.revision,
      { status: "done" },
      undefined,
      worker,
    ),
    /human accepts/,
  );
  await manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  const assigned = store.get(ticket.meta.id);
  await assert.rejects(
    store.claim(ticket.meta.id, { name: "Other", kind: "agent" }, "/tmp/other"),
    /Assigned/,
  );
  await assert.rejects(
    store.update(
      ticket.meta.id,
      assigned.revision,
      { handoff: "late write" },
      undefined,
      { name: "Other", kind: "agent" },
    ),
    /Assigned/,
  );
  await assert.rejects(
    manager.enqueue(
      ticket.meta.id,
      "work",
      "Worker 2",
      human,
      assigned.revision,
    ),
    /active assignment/,
  );
});
test("mandatory human review survives reload and never becomes automatic Done", async (t) => {
  const { manager, store, create } = await fixture(t);
  const ticket = await create("Sensitive", { humanReviewRequired: true });
  await manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await until(manager, () =>
    manager.status().runs.some((r) => r.kind === "review" && !!r.questionId),
  );
  const current = store.get(ticket.meta.id);
  assert.equal(current.meta.status, "review");
  assert.equal(current.meta.agentReview?.outcome, "human");
  assert.ok(store.comments().some((c) => c.kind === "question" && !c.resolved));
  await assert.rejects(
    store.update(
      ticket.meta.id,
      current.revision,
      { humanReviewRequired: false },
      undefined,
      worker,
    ),
    /Only a human/,
  );
  await manager.close();
  const recovered = new Orchestrator(store);
  t.after(() => recovered.close());
  assert.equal(recovered.status().runs.at(-1)?.state, "waiting_input");
  await recovered.tick();
  assert.equal(store.get(ticket.meta.id).meta.status, "review");
});
test("stale evidence and reviewer authority changes cannot accept", async (t) => {
  let store!: Store;
  const runner: Execute = async (o) => {
    const review = o.input.startsWith("Independently");
    const response = await execute(o);
    if (review) {
      const ticket = store.list().find((r) => r.meta.kind === "ticket")!;
      await store.comment(ticket.meta.id, "New acceptance detail", human);
    }
    return response;
  };
  const f = await fixture(t, runner);
  store = f.store;
  const ticket = await f.create();
  await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await until(f.manager, () =>
    f.manager
      .status()
      .runs.some((r) => r.kind === "review" && r.state === "waiting_input"),
  );
  assert.equal(store.get(ticket.meta.id).meta.status, "review");
  assert.match(f.manager.status().runs.at(-1)!.error!, /changed/);
  assert.equal(store.get(ticket.meta.id).meta.agentReview, undefined);
});
test("restart holds queued work for explicit recovery without duplicate processes", async (t) => {
  const { manager, store, create } = await fixture(t);
  const ticket = await create();
  const run = await manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await manager.close();
  const recovered = new Orchestrator(store);
  t.after(() => recovered.close());
  assert.equal(recovered.status().runs[0].state, "recovery");
  await recovered.tick();
  assert.equal(recovered.status().runs.length, 1);
  const next = await recovered.resume(run.id, human);
  assert.equal(next.attempt, 2);
  await until(
    recovered,
    () => store.get(ticket.meta.id).meta.status === "done",
  );
});
test("process cancellation stops descendants and retains bounded output", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-runner-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const controller = new AbortController();
  let pid = 0;
  const task = execute({
    command: process.execPath,
    args: ["-e", "console.log('started');setInterval(()=>{},1000)"],
    cwd: dir,
    input: "",
    timeout: 10000,
    signal: controller.signal,
    log: path.join(dir, "run.log"),
    onEvent: () => {},
    onStart: (value) => {
      pid = value;
      setTimeout(() => controller.abort(), 30);
    },
  });
  await assert.rejects(task, /cancelled/);
  assert.ok(pid);
  assert.throws(() => process.kill(pid, 0));
});

test("changed code during review, failed verification, expired claim and revoked settings all block acceptance", async (t) => {
  for (const mode of ["code", "verification", "claim", "revoked"] as const)
    await t.test(mode, async (child) => {
      let f: Awaited<ReturnType<typeof fixture>>;
      const runner: Execute = async (o) => {
        const response = await execute(o);
        if (mode === "code" && o.input.startsWith("Independently"))
          fs.appendFileSync(
            path.join(o.cwd, "README.md"),
            "changed while reviewing\n",
          );
        if (mode === "verification" && o.command === "/bin/sh")
          return { ...response, code: 1 };
        if (mode === "claim" && o.input.startsWith("Implement"))
          fs.writeFileSync(f.store.file(".local/claims.json"), "[]");
        if (mode === "revoked" && o.input.startsWith("Independently"))
          await f.manager.configure(
            { ...f.config, enabled: false },
            f.manager.status().revision,
            human,
          );
        return response;
      };
      f = await fixture(child, runner);
      const ticket = await f.create();
      await f.manager.enqueue(
        ticket.meta.id,
        "work",
        "Worker 1",
        human,
        ticket.revision,
      );
      await until(f.manager, () =>
        f.manager
          .status()
          .runs.some((r) => ["waiting_input", "interrupted"].includes(r.state)),
      );
      assert.notEqual(f.store.get(ticket.meta.id).meta.status, "done");
      assert.equal(f.store.get(ticket.meta.id).meta.agentReview, undefined);
    });
});
test("review changes retry with history, then exhaust the configured limit without spinning", async (t) => {
  const runner: Execute = async (o) => {
    const response = await execute(o);
    if (o.input.startsWith("Independently")) {
      const index = o.args.indexOf("--output-last-message");
      fs.writeFileSync(o.args[index + 1], JSON.stringify(result("changes")));
    }
    return response;
  };
  const { manager, store, create } = await fixture(t, runner);
  const ticket = await create();
  await manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await until(manager, () =>
    manager
      .status()
      .runs.some(
        (r) =>
          r.kind === "review" && r.state === "waiting_input" && !!r.questionId,
      ),
  );
  assert.equal(
    manager.status().runs.filter((r) => r.kind === "work").length,
    3,
  );
  assert.equal(store.get(ticket.meta.id).meta.status, "progress");
  assert.equal(store.get(ticket.meta.id).meta.agentReview?.outcome, "changes");
  for (let i = 0; i < 5; i++) await manager.tick();
  assert.equal(
    manager.status().runs.filter((r) => r.kind === "work").length,
    3,
  );
});
test("a human answer resumes with new context and dependency work waits for an actual merge", async (t) => {
  const f = await fixture(t);
  const first = await f.create("First"),
    second = await f.create("Dependent", { dependencies: [first.meta.id] });
  await f.manager.enqueue(
    first.meta.id,
    "work",
    "Worker 1",
    human,
    first.revision,
  );
  const dependent = await f.manager.enqueue(
    second.meta.id,
    "work",
    "Worker 2",
    human,
    second.revision,
  );
  await until(
    f.manager,
    () => f.store.get(first.meta.id).meta.status === "done",
  );
  await f.manager.tick();
  assert.equal(dependent.state, "queued");
  assert.match(dependent.error!, /Merge dependency/);
  git(
    f.repository,
    "merge",
    "--no-edit",
    f.store.get(first.meta.id).meta.branch!,
  );
  await until(
    f.manager,
    () => f.store.get(second.meta.id).meta.status === "done",
  );
});
test("a resolved human question resumes the worker while unanswered questions stay pending", async (t) => {
  let asked = false;
  const runner: Execute = async (o) => {
    const response = await execute(o);
    if (!asked && o.input.startsWith("Implement")) {
      asked = true;
      const index = o.args.indexOf("--output-last-message");
      fs.writeFileSync(
        o.args[index + 1],
        JSON.stringify({
          ...result("human"),
          question: "Which behavior should this implement?",
        }),
      );
    }
    return response;
  };
  const { manager, store, create } = await fixture(t, runner);
  const ticket = await create();
  await manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await until(manager, () => manager.status().runs.some((r) => !!r.questionId));
  const waiting = manager.status().runs[0];
  await manager.tick();
  assert.equal(manager.status().runs.length, 1);
  await store.comment(
    ticket.meta.id,
    "Use the behavior in the acceptance criteria.",
    human,
  );
  const question = store.comments().find((c) => c.id === waiting.questionId)!;
  await store.resolveComment(question.id, question.revision, true, human);
  await until(manager, () => store.get(ticket.meta.id).meta.status === "done");
  assert.equal(
    manager.status().runs.filter((r) => r.kind === "work").length,
    2,
  );
});

test("cancelling a process group also terminates its child tool", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-runner-tree-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const controller = new AbortController(),
    pidFile = path.join(dir, "child-pid");
  const script = `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); fs.writeFileSync(${JSON.stringify(pidFile)},String(c.pid)); setInterval(()=>{},1000);`;
  const task = execute({
    command: process.execPath,
    args: ["-e", script],
    cwd: dir,
    input: "",
    timeout: 10000,
    signal: controller.signal,
    log: path.join(dir, "run.log"),
    onEvent: () => {},
    onStart: () => {},
  });
  for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.ok(fs.existsSync(pidFile));
  const childPid = Number(fs.readFileSync(pidFile, "utf8"));
  controller.abort();
  await assert.rejects(task, /cancelled/);
  let alive = true;
  for (let i = 0; i < 100 && alive; i++) {
    try {
      process.kill(childPid, 0);
      await new Promise((r) => setTimeout(r, 10));
    } catch {
      alive = false;
    }
  }
  assert.equal(
    alive,
    false,
    "descendant process should not survive cancellation",
  );
});

test("chat-led review never launches a reviewer CLI and requires a fresh designated review", async (t) => {
  let cliReviews = 0;
  const f = await fixture(t, async (o) => {
    if (o.input.startsWith("Independently")) cliReviews++;
    return execute(o);
  });
  await f.manager.configure(
    { ...f.config, reviewerMode: "chat" },
    f.manager.status().revision,
    human,
  );
  const reviewer: Actor = { name: f.config.reviewer.name, kind: "agent" };
  const ticket = await f.create();
  await assert.rejects(
    f.manager.enqueue(
      ticket.meta.id,
      "plan",
      undefined,
      reviewer,
      ticket.revision,
    ),
    /Plan in/,
  );
  await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    reviewer,
    ticket.revision,
  );
  await until(f.manager, () =>
    f.manager.status().runs.some((r) => r.state === "awaiting_review"),
  );
  const run = f.manager
    .status()
    .runs.find((r) => r.state === "awaiting_review")!;
  assert.equal(cliReviews, 0);
  assert.equal(f.store.get(ticket.meta.id).meta.status, "review");
  await assert.rejects(
    f.manager.reviewContext(run.id, worker),
    /designated chat/,
  );
  let packet = await f.manager.reviewContext(run.id, reviewer);
  await f.store.comment(ticket.meta.id, "New acceptance detail", human);
  await assert.rejects(
    f.manager.chatReview(run.id, packet.token, result("accept"), reviewer),
    /changed/,
  );
  packet = await f.manager.reviewContext(run.id, reviewer);
  await f.manager.chatReview(run.id, packet.token, result("accept"), reviewer);
  await until(
    f.manager,
    () => f.store.get(ticket.meta.id).meta.status === "done",
  );
  assert.equal(cliReviews, 0);
  assert.equal(
    f.store.get(ticket.meta.id).meta.agentReview?.reviewer,
    reviewer.name,
  );
});
test("chat review waits survive restart and mandatory human gates still apply", async (t) => {
  const f = await fixture(t);
  await f.manager.configure(
    { ...f.config, reviewerMode: "chat" },
    f.manager.status().revision,
    human,
  );
  const ticket = await f.create("Human gate", { humanReviewRequired: true });
  await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await until(f.manager, () =>
    f.manager.status().runs.some((r) => r.state === "awaiting_review"),
  );
  await f.manager.close();
  const manager = new Orchestrator(f.store);
  t.after(() => manager.close());
  const run = manager.status().runs.find((r) => r.state === "awaiting_review")!;
  assert.ok(run);
  const reviewer: Actor = { name: f.config.reviewer.name, kind: "agent" };
  const packet = await manager.reviewContext(run.id, reviewer);
  await manager.chatReview(run.id, packet.token, result("accept"), reviewer);
  await until(manager, () => manager.status().runs.some((r) => !!r.questionId));
  assert.equal(f.store.get(ticket.meta.id).meta.status, "review");
  assert.equal(f.store.get(ticket.meta.id).meta.agentReview?.outcome, "human");
});

test("delegation requires a deliberate worker choice and never rotates repeated selections", async (t) => {
  const f = await fixture(t);
  const reviewer: Actor = { name: f.config.reviewer.name, kind: "agent" };
  const first = await f.create("Complex task");
  for (const selected of [undefined, "", "Missing worker"]) {
    await assert.rejects(
      f.manager.enqueue(
        first.meta.id,
        "work",
        selected,
        reviewer,
        first.revision,
      ),
      /[Cc]hoose.*worker/,
    );
    assert.equal(f.manager.status().runs.length, 0);
    assert.equal(f.store.get(first.meta.id).revision, first.revision);
  }
  for (const ticket of [first, await f.create("Another complex task")]) {
    const run = await f.manager.enqueue(
      ticket.meta.id,
      "work",
      "Worker 2",
      reviewer,
      ticket.revision,
    );
    assert.equal(run.agent.name, "Worker 2");
    assert.equal(
      f.store.get(ticket.meta.id).meta.assignment?.worker,
      "Worker 2",
    );
  }
});

test("recovery does not substitute another worker when the selected profile is removed", async (t) => {
  const f = await fixture(t);
  const ticket = await f.create();
  const run = await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 2",
    human,
    ticket.revision,
  );
  await f.manager.stop(run.id, human);
  await f.manager.configure(
    { ...f.config, workers: [f.config.workers[0]] },
    f.manager.status().revision,
    human,
  );
  await assert.rejects(f.manager.resume(run.id, human), /no longer configured/);
  assert.equal(f.manager.status().runs.length, 1);
  assert.equal(f.manager.status().runs[0].agent.name, "Worker 2");
  assert.equal(f.manager.status().runs[0].state, "interrupted");
});
