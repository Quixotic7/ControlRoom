import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { Orchestrator, defaultOrchestration } from "../src/orchestration.js";
import {
  AgentLimitError,
  execute,
  git,
  processStart,
  runAgent,
  sanitizePermissionDenials,
  type Execute,
} from "../src/agent-runner.js";
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
 else {
   fs.writeFileSync(path.join(process.cwd(), path.basename(process.cwd())+'.txt'), 'Implemented\\n');
   if (process.env.FIXTURE_DENY_MODE === 'human') value = {...value, outcome:'human', question:'A denied command still blocks this work'};
   if (process.env.FIXTURE_DENY_MODE === 'malformed') value = {outcome:'ready'};
 }
 console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-session'}));
 const at = args.indexOf('--output-last-message');
 if (at >= 0) fs.writeFileSync(args[at+1], JSON.stringify(value));
 else {
   const event = JSON.stringify({type:'result',structured_output:value,...(process.env.FIXTURE_DENY_MODE ? {permission_denials:[{tool_name:'Bash',tool_use_id:'denied-fixture',tool_input:{command:'node -e "process.exit(0)" && git -C . status --api-token super-secret-value',secret:'never surface this value'}}]} : {})});
   if (process.env.FIXTURE_DENY_MODE) process.stdout.write(event);
   else console.log(event);
 }
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
function createRepository(root: string, name: string) {
  const repository = path.join(root, name);
  fs.mkdirSync(repository);
  git(repository, "init", "-b", "main");
  git(repository, "config", "user.name", "Test");
  git(repository, "config", "user.email", "test@localhost");
  fs.writeFileSync(path.join(repository, "README.md"), `${name}\n`);
  git(repository, "add", ".");
  git(repository, "commit", "-m", "Initial");
  return repository;
}

test("managed runs lay out companion repositories and review a two-repository submission", async (t) => {
  const runner: Execute = async (options) => {
    const response = await execute(options);
    if (!options.input.startsWith("Independently"))
      fs.writeFileSync(
        path.resolve(options.cwd, "../companion/feature.txt"),
        "companion change\n",
      );
    return response;
  };
  const f = await fixture(t, runner);
  const companion = createRepository(f.root, "companion-source");
  await f.manager.configure(
    {
      ...f.config,
      verificationCommand:
        "test -f README.md && test -f ../companion/README.md",
      companionRepositories: [
        {
          name: "companion",
          repository: companion,
          baseRef: "main",
          relativePath: "../companion",
          mode: "writable",
        },
      ],
    },
    f.manager.status().revision,
    human,
  );
  const ticket = await f.create("Cross repository", {
    repositories: ["main", "companion"],
  });
  await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await until(
    f.manager,
    () => f.store.get(ticket.meta.id).meta.status === "done",
  );
  const work = f.manager.status().runs.find((run) => run.kind === "work")!;
  assert.deepEqual(
    work.repositories?.map((repo) => repo.mode),
    ["writable", "writable"],
  );
  assert.equal(
    path.relative(work.worktree!, work.repositories![1].worktree),
    "../companion",
  );
  assert.ok(work.changedFiles?.some((file) => file.startsWith("main:")));
  assert.ok(work.changedFiles?.includes("companion:feature.txt"));
  const receipt = f.store.get(ticket.meta.id).meta.agentReview!;
  assert.deepEqual(
    receipt.repositories?.map((repo) => repo.name),
    ["main", "companion"],
  );
  assert.ok(receipt.repositories?.every((repo) => repo.branch));
});

test("unselected companions are detached and changed read-only repositories are rejected", async (t) => {
  const runner: Execute = async (options) => {
    const response = await execute(options);
    if (!options.input.startsWith("Independently"))
      fs.writeFileSync(
        path.resolve(options.cwd, "../companion/forbidden.txt"),
        "changed\n",
      );
    return response;
  };
  const f = await fixture(t, runner);
  const companion = createRepository(f.root, "readonly-source");
  await f.manager.configure(
    {
      ...f.config,
      companionRepositories: [
        {
          name: "companion",
          repository: companion,
          baseRef: "main",
          relativePath: "../companion",
          mode: "writable",
        },
      ],
    },
    f.manager.status().revision,
    human,
  );
  const ticket = await f.create("Main only");
  await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await until(f.manager, () =>
    f.manager.status().runs.some((run) => run.state === "waiting_input"),
  );
  const run = f.manager
    .status()
    .runs.find((candidate) => candidate.kind === "work")!;
  assert.equal(run.repositories?.[1].mode, "read-only");
  assert.equal(run.repositories?.[1].branch, undefined);
  assert.match(run.error ?? "", /Read-only repository companion changed/);
  assert.equal(f.store.get(ticket.meta.id).meta.status, "progress");
});

test("read-only head movement is rejected before writable repositories are committed", async (t) => {
  const runner: Execute = async (options) => {
    const response = await execute(options);
    if (!options.input.startsWith("Independently"))
      git(
        path.resolve(options.cwd, "../companion"),
        "commit",
        "--allow-empty",
        "-m",
        "forbidden detached commit",
      );
    return response;
  };
  const f = await fixture(t, runner);
  const companion = createRepository(f.root, "head-source");
  await f.manager.configure(
    {
      ...f.config,
      companionRepositories: [
        {
          name: "companion",
          repository: companion,
          baseRef: "main",
          relativePath: "../companion",
          mode: "writable",
        },
      ],
    },
    f.manager.status().revision,
    human,
  );
  const ticket = await f.create("Reject read-only commit");
  await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await until(f.manager, () =>
    f.manager.status().runs.some((run) => run.state === "waiting_input"),
  );
  const run = f.manager
    .status()
    .runs.find((candidate) => candidate.kind === "work")!;
  assert.match(run.error ?? "", /Read-only repository companion changed/);
  assert.equal(git(run.worktree!, "rev-parse", "HEAD"), run.baseCommit);
});

test("two-repository chat review rejects a companion change after submission", async (t) => {
  const runner: Execute = async (options) => {
    const response = await execute(options);
    if (!options.input.startsWith("Independently"))
      fs.writeFileSync(
        path.resolve(options.cwd, "../companion/submitted.txt"),
        "submitted\n",
      );
    return response;
  };
  const f = await fixture(t, runner);
  const companion = createRepository(f.root, "stale-source");
  await f.manager.configure(
    {
      ...f.config,
      reviewerMode: "chat",
      companionRepositories: [
        {
          name: "companion",
          repository: companion,
          baseRef: "main",
          relativePath: "../companion",
          mode: "writable",
        },
      ],
    },
    f.manager.status().revision,
    human,
  );
  const ticket = await f.create("Stale companion review", {
    repositories: ["main", "companion"],
  });
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
      .runs.some(
        (run) => run.kind === "review" && run.state === "awaiting_review",
      ),
  );
  const review = f.manager.status().runs.find((run) => run.kind === "review")!;
  const companionWorktree = review.repositories!.find(
    (repo) => repo.name === "companion",
  )!.worktree;
  fs.writeFileSync(
    path.join(companionWorktree, "after-submission.txt"),
    "stale\n",
  );
  await assert.rejects(
    f.manager.reviewContext(review.id, { name: "Orchestrator", kind: "agent" }),
    /Submitted code changed/,
  );
});

test("companion configuration rejects duplicate roots and escaping destinations", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.manager.configure(
      {
        ...f.config,
        companionRepositories: [
          {
            name: "duplicate",
            repository: f.repository,
            baseRef: "main",
            relativePath: "../duplicate",
            mode: "read-only",
          },
        ],
      },
      f.manager.status().revision,
      human,
    ),
    /destinations overlap/,
  );
  const companion = createRepository(f.root, "escape-source");
  await assert.rejects(
    f.manager.configure(
      {
        ...f.config,
        companionRepositories: [
          {
            name: "escape",
            repository: companion,
            baseRef: "main",
            relativePath: "../../../outside",
            mode: "read-only",
          },
        ],
      },
      f.manager.status().revision,
      human,
    ),
    /escapes the run workspace/,
  );
  const validationRoot = f.store.file(
    ".local/orchestration/worktrees/validation",
  );
  fs.mkdirSync(path.dirname(validationRoot), { recursive: true });
  fs.symlinkSync(f.root, validationRoot);
  await assert.rejects(
    f.manager.configure(
      {
        ...f.config,
        companionRepositories: [
          {
            name: "linked",
            repository: companion,
            baseRef: "main",
            relativePath: "../linked",
            mode: "read-only",
          },
        ],
      },
      f.manager.status().revision,
      human,
    ),
    /[Ss]ymbolic link/,
  );
});
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

test("designated orchestrator takes over a stopped worker with stale, identity and unrelated-work guards", async (t) => {
  const blocking: Execute = (options) =>
    new Promise((_resolve, reject) => {
      fs.mkdirSync(path.dirname(options.log), { recursive: true });
      fs.writeFileSync(options.log, "retained worker log\n");
      options.onStart(987_654_321);
      options.signal.addEventListener(
        "abort",
        () => reject(new Error("fixture worker stopped")),
        { once: true },
      );
    });
  const f = await fixture(t, blocking);
  const reviewer: Actor = { name: f.config.reviewer.name, kind: "agent" };
  const ticket = await f.create("Stopped worker ticket");
  const run = await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await until(f.manager, () => run.state === "running");
  await f.manager.stop(run.id, human);
  await until(
    f.manager,
    () => run.state === "interrupted" && (f.manager as any).active.size === 0,
  );
  assert.ok(run.worktree);
  assert.ok(
    fs.existsSync(f.store.file(`.local/orchestration/${run.id}/agent.log`)),
  );

  await f.store.claim(ticket.meta.id, worker, run.worktree!);
  const unrelated = await f.create("Unrelated assignment");
  const unrelatedRun = await f.manager.enqueue(
    unrelated.meta.id,
    "work",
    "Worker 2",
    human,
    unrelated.revision,
  );
  await f.store.claim(
    unrelated.meta.id,
    { name: "Worker 2", kind: "agent" },
    "/tmp/unrelated-worker",
  );
  const before = f.store.get(ticket.meta.id);
  await assert.rejects(
    f.manager.takeover(run.id, before.revision, {
      name: "Worker 2",
      kind: "agent",
    }),
    /designated orchestrator or a human/,
  );
  const changed = await f.store.update(
    ticket.meta.id,
    before.revision,
    { progress: { note: "Stopped checkout inspected" } },
    undefined,
    worker,
  );
  await assert.rejects(
    f.manager.takeover(run.id, before.revision, reviewer),
    /record changed/,
  );

  const worktree = run.worktree;
  const attempts = run.attempt;
  const taken = await f.manager.takeover(run.id, changed.revision, reviewer);
  assert.equal(taken.run.state, "taken_over");
  assert.equal(taken.run.worktree, worktree);
  assert.equal(taken.run.attempt, attempts);
  assert.equal(taken.ticket.meta.owner, reviewer.name);
  assert.deepEqual(taken.ticket.meta.assignment, {
    runId: run.id,
    worker: reviewer.name,
    assignedBy: reviewer.name,
    assignedAt: taken.ticket.meta.assignment?.assignedAt,
    state: "acknowledged",
    mode: "takeover",
  });
  assert.equal(taken.ticket.meta.scopeApproved, true);
  assert.equal(
    f.store.claims().some((claim) => claim.ticket === ticket.meta.id),
    false,
  );
  assert.ok(
    f.store.claims().some((claim) => claim.ticket === unrelated.meta.id),
  );
  assert.equal(
    f.store.get(unrelated.meta.id).meta.assignment?.runId,
    unrelatedRun.id,
  );
  const restoredStore = new Store(f.store.root).initialize();
  const restoredManager = new Orchestrator(restoredStore);
  t.after(() => restoredManager.close());
  assert.equal(
    restoredManager.status().runs.find((candidate) => candidate.id === run.id)
      ?.state,
    "taken_over",
  );
  await assert.rejects(
    restoredManager.resume(run.id, human),
    /can no longer resume/,
  );
  await assert.rejects(
    restoredManager.enqueue(
      ticket.meta.id,
      "work",
      "Worker 2",
      human,
      taken.ticket.revision,
    ),
    /active takeover assignment/,
  );
  await assert.rejects(
    restoredStore.update(
      ticket.meta.id,
      taken.ticket.revision,
      { progress: { note: "Original worker tried to continue" } },
      undefined,
      worker,
    ),
    /Assigned to Orchestrator/,
  );

  await restoredStore.claim(ticket.meta.id, reviewer, worktree!);
  const reported = await restoredStore.update(
    ticket.meta.id,
    taken.ticket.revision,
    {
      progress: {
        note: "Chat orchestrator implementing directly",
        percent: 75,
      },
    },
    undefined,
    reviewer,
  );
  const submitted = await restoredStore.review(
    ticket.meta.id,
    reported.revision,
    "Direct implementation is ready for human review",
    "Focused takeover lifecycle tests passed",
    "",
    reviewer,
  );
  assert.equal(submitted.meta.status, "review");
  assert.equal(submitted.meta.manualReviewRequired, true);
  assert.equal(submitted.meta.progress?.actor.name, reviewer.name);
  assert.equal(submitted.meta.assignment?.worker, reviewer.name);

  const history = fs
    .readFileSync(restoredStore.file("records/history.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find(
      (event) =>
        event.record === ticket.meta.id &&
        event.before?.meta?.assignment?.worker === "Worker 1" &&
        event.after?.meta?.assignment?.worker === reviewer.name,
    );
  assert.equal(history.actor.name, reviewer.name);
  assert.equal(history.before.meta.assignment.runId, run.id);
});

test("takeover preserves an unanswered managed-run question", async (t) => {
  let asked = false;
  const asksForInput: Execute = async (options) => {
    const response = await execute(options);
    if (!asked && options.input.startsWith("Implement")) {
      asked = true;
      const index = options.args.indexOf("--output-last-message");
      fs.writeFileSync(
        options.args[index + 1],
        JSON.stringify({
          ...result("human"),
          question: "Which customer-visible behavior should this implement?",
        }),
      );
    }
    return response;
  };
  const f = await fixture(t, asksForInput);
  const reviewer: Actor = { name: f.config.reviewer.name, kind: "agent" };
  const ticket = await f.create("Stopped worker with a product question");
  const run = await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await until(
    f.manager,
    () =>
      run.state === "waiting_input" &&
      !!run.questionId &&
      (f.manager as any).active.size === 0,
  );
  const before = f.store
    .comments()
    .find((comment) => comment.id === run.questionId)!;
  assert.equal(before.resolved, false);
  assert.match(before.body, /Which customer-visible behavior/);

  await f.manager.stop(run.id, human);
  await f.manager.takeover(
    run.id,
    f.store.get(ticket.meta.id).revision,
    reviewer,
  );

  const preserved = f.store
    .comments()
    .find((comment) => comment.id === run.questionId)!;
  assert.equal(preserved.resolved, false);
  assert.equal(preserved.revision, before.revision);
  assert.equal(preserved.body, before.body);
});

test("takeover refuses active and uncertain original worker processes", async (t) => {
  let finish!: () => void;
  const lingering: Execute = (options) =>
    new Promise((resolve) => {
      options.onStart(987_654_320);
      finish = () => resolve({ code: 0, output: "", structured: result() });
    });
  const f = await fixture(t, lingering);
  const ticket = await f.create("Lingering worker");
  const run = await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await until(f.manager, () => run.state === "running");
  await f.manager.stop(run.id, human);
  await assert.rejects(
    f.manager.takeover(run.id, f.store.get(ticket.meta.id).revision, human),
    /Wait for every owned worker process to exit/,
  );
  finish();
  await until(f.manager, () => (f.manager as any).active.size === 0);

  run.state = "interrupted";
  run.pid = undefined;
  run.processStartedAt = undefined;
  run.lastProcess = { pid: process.pid };
  await assert.rejects(
    f.manager.takeover(run.id, f.store.get(ticket.meta.id).revision, human),
    /exit cannot be verified/,
  );
  assert.equal(f.store.get(ticket.meta.id).meta.assignment?.worker, "Worker 1");

  run.lastProcess = { pid: 987_654_319, startedAt: "not running" };
  const current = f.store.get(ticket.meta.id);
  const reassigned = await f.store.managedUpdate(
    ticket.meta.id,
    current.revision,
    {
      assignment: {
        ...current.meta.assignment!,
        runId: "run-reassigned-elsewhere",
      },
    },
    human,
    () => {},
  );
  await assert.rejects(
    f.manager.takeover(run.id, reassigned.revision, human),
    /Managed assignment changed/,
  );
  assert.equal(
    f.store.get(ticket.meta.id).meta.assignment?.runId,
    "run-reassigned-elsewhere",
  );
});

test("takeover of submitted work requires reopened development and no other live run", async (t) => {
  const f = await fixture(t);
  const ticket = await f.create("Reopened submission");
  const run = await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await until(
    f.manager,
    () =>
      f.store.get(ticket.meta.id).meta.status === "done" &&
      (f.manager as any).active.size === 0,
  );
  await f.manager.stop(run.id, human);
  const reviewer: Actor = { name: f.config.reviewer.name, kind: "agent" };
  const take = () =>
    f.manager.takeover(run.id, f.store.get(ticket.meta.id).revision, reviewer);
  const patch = (fields: Record<string, unknown>) =>
    f.store.update(
      ticket.meta.id,
      f.store.get(ticket.meta.id).revision,
      fields,
      undefined,
      human,
    );
  await assert.rejects(take(), /Reopen the ticket/);
  await patch({ status: "review" });
  await assert.rejects(take(), /Reopen the ticket/);
  await patch({ status: "progress", archived: true });
  await assert.rejects(take(), /Reopen the ticket/);
  await patch({ archived: false });
  const other = {
    ...run,
    id: "another-review",
    kind: "review",
    state: "awaiting_review",
  };
  (f.manager as any).runs.push(other);
  await assert.rejects(take(), /Another managed run/);
  (f.manager as any).runs.pop();
  const original = f.store.get(ticket.meta.id);
  assert.equal(original.meta.assignment?.state, "submitted");
  const taken = await take();
  assert.equal(taken.ticket.meta.assignment?.worker, reviewer.name);
  assert.equal(taken.ticket.meta.assignment?.mode, "takeover");
  assert.equal(taken.ticket.meta.status, "progress");
  assert.equal(taken.run.attempt, run.attempt);
  assert.deepEqual(taken.ticket.meta.agentReview, original.meta.agentReview);
  await f.store.claim(ticket.meta.id, reviewer, run.worktree!);
  await assert.rejects(f.manager.resume(run.id, human), /can no longer resume/);
});

test("failed verification returns the retained worktree to its worker without human approval", async (t) => {
  let checks = 0;
  const prompts: string[] = [];
  const runner: Execute = async (o) => {
    if (o.input.startsWith("Implement")) prompts.push(o.input);
    const response = await execute(o);
    if (o.command === "/bin/sh" && ++checks === 1) {
      fs.appendFileSync(o.log, "Fix the missing acceptance case\n");
      return { ...response, code: 1 };
    }
    return response;
  };
  const f = await fixture(t, runner),
    ticket = await f.create();
  const first = await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await until(
    f.manager,
    () => f.store.get(ticket.meta.id).meta.status === "done",
  );
  const workers = f.manager.status().runs.filter((r) => r.kind === "work");
  assert.equal(workers.length, 2);
  assert.equal(workers[1].previous, first.id);
  assert.equal(workers[1].worktree, workers[0].worktree);
  assert.equal(workers[1].agent.name, "Worker 1");
  assert.equal(workers[1].attempt, 2);
  assert.match(prompts[1], /Fix the missing acceptance case/);
  assert.equal(
    f.store.comments().filter((c) => c.kind === "question").length,
    0,
  );
  assert.equal(f.store.get(ticket.meta.id).meta.agentReview?.outcome, "accept");
});

test("verification correction stops at the attempt limit instead of looping indefinitely", async (t) => {
  const runner: Execute = async (o) => {
    const response = await execute(o);
    return o.command === "/bin/sh" ? { ...response, code: 1 } : response;
  };
  const f = await fixture(t, runner),
    ticket = await f.create();
  await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await until(f.manager, () =>
    f.store
      .comments()
      .some(
        (c) => c.kind === "question" && c.body.includes("attempts exhausted"),
      ),
  );
  assert.equal(
    f.manager.status().runs.filter((r) => r.kind === "work").length,
    3,
  );
  for (let i = 0; i < 5; i++) await f.manager.tick();
  assert.equal(f.manager.status().runs.length, 3);
  assert.notEqual(f.store.get(ticket.meta.id).meta.status, "done");
});

test("legacy verification questions recover once with agent attribution", async (t) => {
  const f = await fixture(t),
    ticket = await f.create();
  const run = await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await f.manager.close();
  const question = await f.store.comment(
    ticket.meta.id,
    "Legacy controller verification failure",
    { name: "Orchestrator", kind: "agent" },
    "question",
  );
  const journal = f.store.file(".local/orchestration/runs.json");
  const rows = JSON.parse(fs.readFileSync(journal, "utf8"));
  rows[0].state = "waiting_input";
  rows[0].result = result();
  rows[0].error =
    "Error: Independent verification failed with exit 1. Inspect the verification log.";
  rows[0].questionId = question.id;
  fs.writeFileSync(journal, JSON.stringify(rows));
  const recovered = new Orchestrator(f.store);
  t.after(() => recovered.close());
  await until(
    recovered,
    () => f.store.get(ticket.meta.id).meta.status === "done",
  );
  const resolved = f.store.comments().find((c) => c.id === question.id)!;
  assert.equal(resolved.resolvedBy?.kind, "agent");
  assert.equal(
    recovered.status().runs.filter((r) => r.kind === "work").length,
    2,
  );
  assert.equal(
    recovered.status().runs.find((r) => r.previous === run.id)?.attempt,
    2,
  );
});

test("ticket activity requires a verified running work process and clears on stop", async (t) => {
  const runner: Execute = (options) =>
    execute({
      ...options,
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      input: "",
    });
  const { manager, create } = await fixture(t, runner);
  const ticket = await create("Actual process activity");
  const run = await manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  assert.deepEqual(manager.activity(), []);
  await until(manager, () =>
    manager.status().runs.some((item) => item.verifiedRunning),
  );
  assert.deepEqual(manager.activity(), [
    { ticket: ticket.meta.id, runId: run.id, worker: "Worker 1" },
  ]);
  // Even a live process cannot make queued/review/verification activity look
  // like the coding worker is currently implementing this ticket.
  for (const state of [
    "queued",
    "verifying",
    "waiting_input",
    "awaiting_review",
  ] as const) {
    run.state = state;
    assert.deepEqual(manager.activity(), []);
  }
  run.state = "running";
  run.kind = "review";
  assert.deepEqual(manager.activity(), []);
  run.kind = "work";
  const identity = run.processStartedAt;
  run.processStartedAt = "different process";
  assert.deepEqual(manager.activity(), []);
  run.processStartedAt = identity;
  await manager.stop(run.id, human);
  assert.deepEqual(manager.activity(), []);
});

test("only humans can configure worker authority and worker brief revisions are guarded", async (t) => {
  const f = await fixture(t),
    before = f.manager.status();
  await assert.rejects(
    f.manager.configure(
      before.config,
      before.revision,
      { name: "Managed worker", kind: "agent" },
      "Agent-authored authority",
    ),
    (error: any) => error.status === 403,
  );
  assert.equal(f.manager.status().workerBrief.content, "");
  const changed = await f.manager.configure(
    before.config,
    before.revision,
    human,
    "# Human worker brief\n",
  );
  assert.equal(changed.workerBrief.content, "# Human worker brief\n");
  await assert.rejects(
    f.manager.configure(
      changed.config,
      before.revision,
      human,
      "stale overwrite",
    ),
    (error: any) => error.status === 409,
  );
  assert.equal(
    fs.readFileSync(f.store.file("agents/worker-brief.md"), "utf8"),
    "# Human worker brief\n",
  );
});

test("approved Claude patterns, directories, role and redacted environment reach a work launch", async (t) => {
  const previousSecret = process.env.CR78_TEST_SECRET;
  process.env.CR78_TEST_SECRET = "do-not-render";
  t.after(() => {
    if (previousSecret === undefined) delete process.env.CR78_TEST_SECRET;
    else process.env.CR78_TEST_SECRET = previousSecret;
  });
  const calls: Parameters<Execute>[0][] = [];
  const runner: Execute = async (options) => {
    calls.push(options);
    return {
      code: 0,
      output: "fixture output",
      structured: result(),
    };
  };
  const f = await fixture(t, runner),
    before = f.manager.status(),
    config = {
      ...before.config,
      reviewerMode: "chat" as const,
      reviewer: { ...before.config.reviewer, name: "Chat reviewer" },
      workers: [
        {
          name: "Claude builder",
          provider: "claude" as const,
          executable: f.executable,
          model: "",
          roleNote: "Principal engineer for audio-thread work",
        },
      ],
      workerPermissions: {
        claudeAllowedTools: [
          "Bash(swift build *)",
          "Bash(git add *)",
          "Bash(git commit *)",
        ],
        additionalDirectories: [f.root],
        environment: [
          {
            name: "MODULE_CACHE_PATH",
            source: "literal" as const,
            value: "/tmp/modules",
          },
          {
            name: "PROJECT_TOKEN",
            source: "host" as const,
            value: "CR78_TEST_SECRET",
          },
        ],
      },
    };
  await f.manager.configure(
    config,
    before.revision,
    human,
    "# Build guidance\nRun the focused self-test.",
  );
  const ticket = await f.create("Permission fixture");
  const run = await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Claude builder",
    human,
    ticket.revision,
  );
  await until(f.manager, () =>
    f.manager
      .status()
      .runs.some(
        (candidate) =>
          candidate.id === run.id && candidate.state === "completed",
      ),
  );
  const workerCall = calls.find((call) => call.command === f.executable)!;
  assert.ok(workerCall.args.includes("--allowedTools"));
  const allowed =
    workerCall.args[workerCall.args.indexOf("--allowedTools") + 1];
  assert.match(allowed, /Bash\(swift build \*\)/);
  assert.doesNotMatch(allowed, /swift package reset/);
  assert.deepEqual(
    workerCall.args.slice(
      workerCall.args.indexOf("--add-dir"),
      workerCall.args.indexOf("--allowedTools"),
    ),
    ["--add-dir", f.root],
  );
  assert.equal(workerCall.environment?.MODULE_CACHE_PATH, "/tmp/modules");
  assert.equal(workerCall.environment?.PROJECT_TOKEN, "do-not-render");
  assert.match(workerCall.input, /Principal engineer for audio-thread work/);
  assert.match(workerCall.input, /Run the focused self-test/);
  const verificationCall = calls.find((call) => call.command === "/bin/sh")!;
  assert.equal(verificationCall.environment?.MODULE_CACHE_PATH, "/tmp/modules");
  const launch = f.manager
    .status()
    .runs.find((candidate) => candidate.id === run.id)!.launch!;
  assert.deepEqual(launch.environment, ["MODULE_CACHE_PATH", "PROJECT_TOKEN"]);
  assert.doesNotMatch(JSON.stringify(launch), /do-not-render|\/tmp\/modules/);
  assert.doesNotMatch(
    JSON.stringify(f.manager.status().config),
    /do-not-render/,
  );
  assert.doesNotMatch(JSON.stringify(launch), /dangerously-skip-permissions/);
});

test("managed process environment cannot override identity or provider policy roots", async (t) => {
  const f = await fixture(t),
    before = f.manager.status();
  for (const name of [
    "CONTROLROOM_ACTOR",
    "CONTROLROOM_MANAGED",
    "HOME",
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
    "BASH_ENV",
  ]) {
    const config = structuredClone(before.config);
    config.workerPermissions = {
      claudeAllowedTools: [],
      additionalDirectories: [],
      environment: [{ name, source: "literal", value: "override" }],
    };
    await assert.rejects(
      f.manager.configure(config, before.revision, human),
      (error: any) => error.status === 422 && String(error).includes(name),
    );
  }
});

test("execute passes configured values to a real child while forcing managed identity", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cr-child-env-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const response = await execute({
    command: process.execPath,
    args: [
      "-e",
      `process.stdout.write(JSON.stringify({
        cache: process.env.MODULE_CACHE_PATH,
        managed: process.env.CONTROLROOM_MANAGED,
        controlActor: process.env.CONTROLROOM_ACTOR,
        controlKind: process.env.CONTROLROOM_ACTOR_KIND,
        boardActor: process.env.WORKBOARD_ACTOR,
        boardKind: process.env.WORKBOARD_ACTOR_KIND,
      }) + "\\n")`,
    ],
    cwd: directory,
    input: "",
    timeout: 10_000,
    signal: new AbortController().signal,
    log: path.join(directory, "environment.log"),
    environment: {
      MODULE_CACHE_PATH: "/tmp/managed-cache",
      CONTROLROOM_MANAGED: "0",
      CONTROLROOM_ACTOR: "Spoofed human",
      CONTROLROOM_ACTOR_KIND: "human",
      WORKBOARD_ACTOR: "Spoofed human",
      WORKBOARD_ACTOR_KIND: "human",
    },
    actorName: "Managed Worker",
    onEvent: () => {},
    onStart: () => {},
  });
  assert.deepEqual(JSON.parse(response.output.trim()), {
    cache: "/tmp/managed-cache",
    managed: "1",
    controlActor: "Managed Worker",
    controlKind: "agent",
    boardActor: "Managed Worker",
    boardKind: "agent",
  });
});

test("a recovered ready worker preserves redacted denials for verification and review", async (t) => {
  const calls: Parameters<Execute>[0][] = [];
  const f = await fixture(t, async (options) => {
    calls.push(options);
    return execute(options);
  });
  const config = structuredClone(f.config);
  config.workerPermissions = {
    claudeAllowedTools: ["Read"],
    additionalDirectories: [],
    environment: [
      { name: "FIXTURE_DENY_MODE", source: "literal", value: "ready" },
    ],
  };
  await f.manager.configure(config, f.manager.status().revision, human);
  const ticket = await f.create("Recovered after denied command");
  const run = await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 2",
    human,
    ticket.revision,
  );
  await until(
    f.manager,
    () => f.store.get(ticket.meta.id).meta.status === "done",
  );
  assert.deepEqual(run.permissionDenials, [
    {
      tool: "Bash",
      command:
        'node -e "process.exit(0)" && git -C . status --api-token [REDACTED]',
    },
  ]);
  const saved = f.store.get(ticket.meta.id);
  assert.equal(saved.meta.verification?.exitCode, 0);
  assert.match(saved.meta.handoff ?? "", /untrusted diagnostic data/);
  assert.match(saved.meta.handoff ?? "", /git -C \. status/);
  assert.match(saved.meta.handoff ?? "", /\[REDACTED\]/);
  assert.doesNotMatch(saved.meta.handoff ?? "", /super-secret|never surface/);
  const reviewPrompt = calls.find((call) =>
    call.input.startsWith("Independently"),
  )!.input;
  assert.match(reviewPrompt, /required check or evidence remains missing/);
  assert.match(reviewPrompt, /git -C \. status/);
  assert.doesNotMatch(reviewPrompt, /super-secret|never surface/);
  assert.match(
    f.store.contextMarkdown(ticket.meta.id).markdown,
    /git -C \. status/,
  );
  assert.match(
    fs.readFileSync(
      f.store.file(`.local/orchestration/${run.id}/agent.log`),
      "utf8",
    ),
    /super-secret-value/,
  );
});

test("a recovered ready denial cannot bypass failed required verification", async (t) => {
  const f = await fixture(t);
  await f.manager.configure(
    {
      ...f.config,
      maxAttempts: 1,
      verificationCommand: "false",
      workerPermissions: {
        claudeAllowedTools: ["Read"],
        additionalDirectories: [],
        environment: [
          { name: "FIXTURE_DENY_MODE", source: "literal", value: "ready" },
        ],
      },
    },
    f.manager.status().revision,
    human,
  );
  const ticket = await f.create("Denied command and failed verification");
  const run = await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 2",
    human,
    ticket.revision,
  );
  await until(
    f.manager,
    () => run.state === "waiting_input" && !!run.questionId,
  );
  assert.equal(run.failureKind, "verification");
  assert.notEqual(f.store.get(ticket.meta.id).meta.status, "done");
  assert.equal(
    f.manager.status().runs.some((candidate) => candidate.kind === "review"),
    false,
  );
  const question = f.store.comments().find((row) => row.id === run.questionId)!;
  assert.match(question.body, /Correction attempts exhausted/);
  assert.match(question.body, /git -C \. status/);
  assert.match(question.body, /\[REDACTED\]/);
  assert.doesNotMatch(question.body, /super-secret|never surface/);
});

test("blocked and malformed denial results pause with bounded redacted commands", async (t) => {
  for (const mode of ["human", "malformed"] as const)
    await t.test(mode, async (child) => {
      const f = await fixture(child);
      await f.manager.configure(
        {
          ...f.config,
          workerPermissions: {
            claudeAllowedTools: ["Read"],
            additionalDirectories: [],
            environment: [
              { name: "FIXTURE_DENY_MODE", source: "literal", value: mode },
            ],
          },
        },
        f.manager.status().revision,
        human,
      );
      const ticket = await f.create(`${mode} denied result`);
      const run = await f.manager.enqueue(
        ticket.meta.id,
        "work",
        "Worker 2",
        human,
        ticket.revision,
      );
      await until(
        f.manager,
        () => run.state === "waiting_input" && !!run.questionId,
      );
      assert.notEqual(f.store.get(ticket.meta.id).meta.status, "done");
      const question = f.store
        .comments()
        .find((row) => row.id === run.questionId)!;
      assert.match(question.body, /Up to 12 bounded/);
      assert.match(question.body, /untrusted diagnostic data/);
      assert.match(question.body, /git -C \. status/);
      assert.match(question.body, /\[REDACTED\]/);
      assert.doesNotMatch(
        question.body,
        /super-secret|never surface|tool_use_id/,
      );
    });
});

test("permission denial summaries are bounded and redact provider command secrets", () => {
  const denials = sanitizePermissionDenials(
    Array.from({ length: 20 }, (_, index) => ({
      tool_name: `Bash-${index}`,
      tool_input: {
        command:
          index === 0
            ? `printf '\u001b[31m' --api-token exposed MY_SECRET=hidden https://user:password@example.com/${"x".repeat(500)}`
            : `echo command-${index}`,
        secret: "ignored-provider-field",
      },
    })),
  );
  assert.equal(denials.length, 12);
  assert.ok(denials.every((denial) => (denial.command?.length ?? 0) <= 400));
  assert.doesNotMatch(
    JSON.stringify(denials),
    /exposed|hidden|password|ignored-provider-field|\u001b/,
  );
  assert.match(denials[0].command ?? "", /\[REDACTED\]/);
});

test("permission denial takes precedence over a simultaneous turn limit", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cr-denied-limit-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await assert.rejects(
    runAgent(
      { name: "Claude", provider: "claude", executable: "claude", model: "" },
      "work",
      "prompt",
      {},
      {
        directory,
        cwd: directory,
        timeout: 10_000,
        signal: new AbortController().signal,
        log: path.join(directory, "agent.log"),
        onEvent: () => {},
        onStart: () => {},
        maxTurns: 10,
      },
      async () => ({
        code: 1,
        output: "",
        structured: result(),
        limitReason: "turns",
        permissionDenials: [{ tool: "Bash", command: "git status" }],
      }),
    ),
    (error: unknown) =>
      !(error instanceof AgentLimitError) &&
      String(error).includes("denied permission to use Bash"),
  );
});

test("a denied reviewer tool can never produce an accepted review", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cr-review-denial-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await assert.rejects(
    runAgent(
      { name: "Reviewer", provider: "claude", executable: "claude", model: "" },
      "review",
      "prompt",
      {},
      {
        directory,
        cwd: directory,
        timeout: 10_000,
        signal: new AbortController().signal,
        log: path.join(directory, "review.log"),
        onEvent: () => {},
        onStart: () => {},
        maxTurns: 10,
      },
      async () => ({
        code: 0,
        output: "",
        structured: result("accept"),
        permissionDenials: [
          { tool: "Read", command: "cat required-evidence.txt" },
        ],
      }),
    ),
    /denied permission to use Read/,
  );
});

test("profiles can use 400 turns and six hours while verification has its own timeout", async (t) => {
  const calls: Parameters<Execute>[0][] = [];
  const runner: Execute = async (options) => {
    calls.push(options);
    return execute(options);
  };
  const f = await fixture(t, runner);
  const config = {
    ...f.config,
    verificationTimeoutMinutes: 7,
    workers: f.config.workers.map((profile) =>
      profile.name === "Worker 2"
        ? { ...profile, maxTurns: 400, timeoutMinutes: 360 }
        : profile,
    ),
  };
  await f.manager.configure(config, f.manager.status().revision, human);
  const ticket = await f.create("Long-running profile");
  await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 2",
    human,
    ticket.revision,
  );
  await until(
    f.manager,
    () => f.store.get(ticket.meta.id).meta.status === "done",
  );
  const worker = calls.find(
    (call) =>
      call.command === f.executable && call.args.includes("--max-turns"),
  )!;
  assert.equal(worker.args[worker.args.indexOf("--max-turns") + 1], "400");
  assert.equal(worker.timeout, 360 * 60_000);
  assert.equal(
    calls.find((call) => call.command === "/bin/sh")!.timeout,
    7 * 60_000,
  );
});

test("a turn-limited run resumes its retained session without a new attempt", async (t) => {
  let workerCalls = 0;
  const calls: Parameters<Execute>[0][] = [];
  const runner: Execute = async (options) => {
    calls.push(options);
    if (options.input.startsWith("Implement") && ++workerCalls === 1) {
      options.onStart(987_654_321);
      options.onEvent("thread.started", "retained-session");
      fs.writeFileSync(options.log, "limited invocation retained\n");
      throw new AgentLimitError("turns", "retained-session");
    }
    return execute(options);
  };
  const f = await fixture(t, runner);
  const ticket = await f.create("Resume retained session");
  const run = await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await until(
    f.manager,
    () => run.state === "waiting_input" && run.failureKind === "limit",
  );
  const reviewer: Actor = { name: f.config.reviewer.name, kind: "agent" };
  const worktree = run.worktree;
  const attempt = run.attempt;
  await assert.rejects(
    f.manager.resume(run.id, worker),
    /designated orchestrator/,
  );
  run.lastProcess = {
    pid: process.pid,
    startedAt: processStart(process.pid),
  };
  await assert.rejects(f.manager.resume(run.id, reviewer), /still alive/);
  run.lastProcess = { pid: process.pid };
  await assert.rejects(
    f.manager.resume(run.id, reviewer),
    /exit cannot be verified/,
  );
  run.lastProcess = { pid: 987_654_321, startedAt: "not running" };
  const resumed = await f.manager.resume(run.id, reviewer);
  assert.equal(resumed, run);
  assert.equal(run.attempt, attempt);
  assert.equal(run.worktree, worktree);
  assert.equal(run.sessionId, "retained-session");
  await until(
    f.manager,
    () => f.store.get(ticket.meta.id).meta.status === "done",
  );
  const resumedWorker = calls.find(
    (call) =>
      call.input.startsWith("Implement") &&
      call.args.includes("resume") &&
      call.args.includes("retained-session"),
  )!;
  assert.equal(resumedWorker.cwd, worktree);
  assert.equal(workerCalls, 2);
  const directory = f.store.file(`.local/orchestration/${run.id}`);
  assert.equal(
    fs.readFileSync(path.join(directory, "agent.log"), "utf8"),
    "limited invocation retained\n",
  );
  assert.ok(fs.existsSync(path.join(directory, "agent-resume-1.log")));
  assert.match(f.manager.log(run.id), /## agent\.log/);
  assert.match(f.manager.log(run.id), /## agent-resume-1\.log/);
});

test("an explicit stop wins a race with a provider limit result", async (t) => {
  let reportLimit!: () => void;
  const runner: Execute = (options) =>
    new Promise((_resolve, reject) => {
      options.onStart(987_654_321);
      options.onEvent("thread.started", "retained-session");
      reportLimit = () =>
        reject(new AgentLimitError("turns", "retained-session"));
    });
  const f = await fixture(t, runner);
  const ticket = await f.create("Stop wins limit race");
  const run = await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await until(f.manager, () => run.state === "running");
  await f.manager.stop(run.id, human);
  reportLimit();
  await until(f.manager, () => (f.manager as any).active.size === 0);
  assert.equal(run.state, "interrupted");
  assert.equal(run.failureKind, undefined);
  assert.equal(run.limitReason, undefined);
});

test("limit resume keeps stale-context and missing-session safeguards", async (t) => {
  const runner: Execute = async (options) => {
    if (options.input.startsWith("Implement")) {
      options.onStart(987_654_321);
      options.onEvent("thread.started", "retained-session");
      throw new AgentLimitError("turns", "retained-session");
    }
    return execute(options);
  };
  const f = await fixture(t, runner);
  const ticket = await f.create("Guard retained session");
  const run = await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await until(f.manager, () => run.failureKind === "limit");
  await f.store.comment(ticket.meta.id, "Acceptance detail changed", human);
  await assert.rejects(f.manager.resume(run.id, human), /Discussion.*changed/);
  run.contextHash = undefined;
  run.sessionId = undefined;
  await assert.rejects(
    f.manager.resume(run.id, human),
    /no retained provider session/,
  );
  await f.manager.stop(run.id, human);
  assert.equal(run.failureKind, undefined);
  assert.equal(run.limitReason, undefined);
  await assert.rejects(
    f.manager.resume(run.id, { name: f.config.reviewer.name, kind: "agent" }),
    /human must configure or recover/i,
  );
});

test("agent runners pass retained sessions to both providers and classify turn limits", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cr-agent-resume-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const seen: Parameters<Execute>[0][] = [];
  const runner: Execute = async (options) => {
    seen.push(options);
    options.onEvent("thread.started", "continued-session");
    return { code: 1, output: "", limitReason: "turns" };
  };
  const options = {
    directory,
    cwd: directory,
    input: "",
    timeout: 360 * 60_000,
    signal: new AbortController().signal,
    log: path.join(directory, "agent.log"),
    onEvent: () => {},
    onStart: () => {},
    maxTurns: 400,
    sessionId: "prior-session",
  };
  await assert.rejects(
    runAgent(
      { name: "Codex", provider: "codex", executable: "codex", model: "" },
      "work",
      "prompt",
      {},
      options,
      runner,
    ),
    (error: unknown) =>
      error instanceof AgentLimitError &&
      error.sessionId === "continued-session",
  );
  await assert.rejects(
    runAgent(
      { name: "Claude", provider: "claude", executable: "claude", model: "" },
      "work",
      "prompt",
      {},
      options,
      runner,
    ),
    AgentLimitError,
  );
  assert.deepEqual(seen[0].args.slice(0, 3), [
    "exec",
    "resume",
    "prior-session",
  ]);
  assert.equal(seen[0].args.includes("--sandbox"), false);
  assert.equal(seen[0].args.includes("--color"), false);
  assert.ok(seen[0].args.includes('sandbox_mode="workspace-write"'));
  assert.ok(seen[0].args.includes("--output-schema"));
  assert.ok(seen[0].args.includes("--output-last-message"));
  assert.deepEqual(seen[1].args.slice(0, 3), [
    "-p",
    "--resume",
    "prior-session",
  ]);
  assert.equal(seen[1].args[seen[1].args.indexOf("--max-turns") + 1], "400");
  await assert.rejects(
    runAgent(
      { name: "Codex", provider: "codex", executable: "codex", model: "" },
      "review",
      "prompt",
      {},
      options,
      runner,
    ),
    AgentLimitError,
  );
  assert.ok(seen[2].args.includes('sandbox_mode="read-only"'));
});

test("planned children retain an approved goal's repository selection", async (t) => {
  const f = await fixture(t),
    companion = createRepository(f.root, "goal-companion");
  await f.manager.configure(
    {
      ...f.config,
      companionRepositories: [
        {
          name: "companion",
          repository: companion,
          baseRef: "main",
          relativePath: "../companion",
          mode: "writable",
        },
      ],
    },
    f.manager.status().revision,
    human,
  );
  const parent = await f.create("Companion-only goal", {
    repositories: ["companion"],
  });
  const run = await f.manager.enqueue(
    parent.meta.id,
    "plan",
    undefined,
    human,
    parent.revision,
  );
  await until(
    f.manager,
    () =>
      f.manager.status().runs.find((r) => r.id === run.id)?.state ===
      "completed",
  );
  const children = f.store
    .list()
    .filter((r) => r.meta.parent === parent.meta.id);
  assert.equal(children.length, 2);
  for (const child of children)
    assert.deepEqual(child.meta.repositories, ["companion"]);
});

test("verification subprocesses replace inherited reviewer identity with a distinct agent", async (t) => {
  const f = await fixture(t);
  const names = [
    "CONTROLROOM_ACTOR",
    "WORKBOARD_ACTOR",
    "CONTROLROOM_ACTOR_KIND",
    "WORKBOARD_ACTOR_KIND",
  ];
  const saved = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  t.after(() => {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });
  process.env.CONTROLROOM_ACTOR = "Control Room verifier";
  process.env.WORKBOARD_ACTOR = "Control Room verifier";
  process.env.CONTROLROOM_ACTOR_KIND = "human";
  process.env.WORKBOARD_ACTOR_KIND = "human";
  await f.manager.configure(
    {
      ...f.config,
      reviewer: { ...f.config.reviewer, name: "Control Room verifier" },
      verificationCommand:
        'test "$CONTROLROOM_ACTOR_KIND" = agent && test "$WORKBOARD_ACTOR_KIND" = agent && test "$CONTROLROOM_ACTOR" = "Control Room verifier (verification)" && test "$WORKBOARD_ACTOR" = "$CONTROLROOM_ACTOR"',
    },
    f.manager.status().revision,
    human,
  );
  const ticket = await f.create("Verifier attribution");
  await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await until(
    f.manager,
    () => f.store.get(ticket.meta.id).meta.status === "done",
  );
  assert.equal(f.store.get(ticket.meta.id).meta.verification?.exitCode, 0);
});

test("restart cannot resume live work whose process identity was never persisted", async (t) => {
  const f = await fixture(t),
    ticket = await f.create("Unknown process after crash");
  const run = await f.manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  await f.manager.close();
  const journal = f.store.file(".local/orchestration/runs.json"),
    runs = JSON.parse(fs.readFileSync(journal, "utf8"));
  runs[0].state = "launching";
  delete runs[0].pid;
  delete runs[0].lastProcess;
  delete runs[0].sessionId;
  delete runs[0].lastEvent;
  fs.writeFileSync(journal, JSON.stringify(runs));
  const restored = new Orchestrator(f.store);
  t.after(() => restored.close());
  assert.equal(restored.status().runs[0].processIdentityMissing, true);
  await assert.rejects(
    restored.resume(run.id, human),
    /exit cannot be verified/,
  );
  await restored.stop(run.id, human);
  await assert.rejects(
    restored.resume(run.id, human),
    /exit cannot be verified/,
  );
  await restored.close();
  const again = new Orchestrator(f.store);
  t.after(() => again.close());
  await assert.rejects(again.resume(run.id, human), /exit cannot be verified/);
  assert.equal(again.status().runs.length, 1);
});
