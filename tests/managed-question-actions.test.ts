import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execute, git, type Execute } from "../src/agent-runner.js";
import { Orchestrator, defaultOrchestration } from "../src/orchestration.js";
import { buildServer } from "../src/server.js";
import { Store } from "../src/store.js";
import type { Actor } from "../src/types.js";

const human: Actor = { name: "Human", kind: "human" };
const agent: Actor = { name: "Worker 1", kind: "agent" };
const finalResult = (outcome: string) => ({
  outcome,
  summary: outcome === "human" ? "Need a decision" : "Ready",
  criteria: "Checked",
  evidence: "Fixture evidence",
  question: outcome === "human" ? "Which behavior should be used?" : "",
});

async function fixture(t: test.TestContext) {
  const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "cr-question-action-")),
    ),
    repository = path.join(root, "repository"),
    board = path.join(root, "board");
  fs.mkdirSync(repository);
  fs.mkdirSync(board);
  git(repository, "init", "-b", "main");
  git(repository, "config", "user.name", "Test");
  git(repository, "config", "user.email", "test@localhost");
  fs.writeFileSync(path.join(repository, "README.md"), "Fixture\n");
  git(repository, "add", ".");
  git(repository, "commit", "-m", "Initial");
  const store = new Store(board).initialize("Managed question fixture");
  let workCalls = 0;
  const runner: Execute = async (options) => {
    if (options.command === "/bin/sh") return execute(options);
    // Model an owned process that has exited without weakening recovery checks.
    options.onStart(99_998);
    const isReview = options.input.startsWith("Independently"),
      value = isReview
        ? finalResult("accept")
        : finalResult(++workCalls === 1 ? "human" : "ready"),
      resultAt = options.args.indexOf("--output-last-message");
    if (resultAt >= 0)
      fs.writeFileSync(options.args[resultAt + 1], JSON.stringify(value));
    options.onEvent("thread.started", `fixture-session-${workCalls}`);
    return { code: 0, output: "", eventCount: 1, structured: value };
  };
  const manager = new Orchestrator(store, runner),
    config = {
      ...structuredClone(defaultOrchestration),
      enabled: true,
      repository,
      verificationCommand: "true",
      reviewer: {
        ...defaultOrchestration.reviewer,
        executable: "fixture-agent",
      },
      workers: defaultOrchestration.workers.map((worker) => ({
        ...worker,
        executable: "fixture-agent",
      })),
    };
  await manager.configure(config, manager.status().revision, human);
  const ticket = await store.create(
    "ticket",
    { title: "Managed question", scopeApproved: true },
    "## Acceptance criteria\nImplement the selected behavior.\n",
    human,
  );
  await manager.enqueue(
    ticket.meta.id,
    "work",
    "Worker 1",
    human,
    ticket.revision,
  );
  for (let i = 0; i < 100; i++) {
    await manager.tick();
    if (manager.status().runs[0]?.questionId) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const run = manager.status().runs[0],
    question = store.comments().find((row) => row.id === run.questionId)!;
  assert.equal(run.state, "waiting_input");
  assert.ok(question);
  t.after(async () => {
    await manager.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    repository,
    board,
    store,
    manager,
    config,
    run,
    question,
    workCalls: () => workCalls,
  };
}

test("answer and retry saves an attributed reply and queues one guarded successor", async (t) => {
  const f = await fixture(t),
    before = f.manager.projectState(f.store.state()),
    response = await f.manager.questionAction(
      f.run.id,
      {
        questionId: f.question.id,
        revision: f.question.revision,
        action: "answer_retry",
        answer: "Use the acceptance criteria behavior.",
      },
      human,
    );
  assert.equal(response.retried, true);
  assert.equal(response.run.previous, f.run.id);
  assert.equal(response.run.state, "queued");
  const answered = f.store.comments().find((row) => row.id === f.question.id)!;
  assert.equal(answered.resolved, true);
  assert.deepEqual(answered.replies?.[0], {
    actor: human,
    at: answered.replies?.[0].at,
    body: "Use the acceptance criteria behavior.",
    runId: f.run.id,
  });
  const queued = f.manager.projectState(f.store.state());
  assert.equal(queued.managedQuestions?.[f.question.id].runId, f.run.id);
  assert.equal(
    queued.managedQuestions?.[f.question.id].retryRunId,
    response.run.id,
  );
  assert.equal(queued.managedQuestions?.[f.question.id].state, "queued");
  assert.equal(queued.managedQuestions?.[f.question.id].canAct, false);
  assert.notEqual(queued.revision, before.revision);
  response.run.state = "running";
  const running = f.manager.projectState(f.store.state());
  assert.equal(running.managedQuestions?.[f.question.id].state, "running");
  assert.notEqual(running.revision, queued.revision);
  response.run.state = "queued";
  for (let i = 0; i < 50 && f.workCalls() < 2; i++) {
    await f.manager.tick();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(f.workCalls(), 2);
});

test("answer only remains open and a blank follow-up retries the saved answer", async (t) => {
  const f = await fixture(t),
    answered = await f.manager.questionAction(
      f.run.id,
      {
        questionId: f.question.id,
        revision: f.question.revision,
        action: "answer_only",
        answer: "Keep this reply without retrying yet.",
      },
      human,
    );
  assert.equal(answered.retried, false);
  assert.equal(answered.question.resolved, false);
  await f.manager.tick();
  assert.equal(f.workCalls(), 1);
  const retried = await f.manager.questionAction(
    f.run.id,
    {
      questionId: f.question.id,
      revision: answered.question.revision,
      action: "answer_retry",
      answer: "",
    },
    human,
  );
  assert.equal(retried.retried, true);
  assert.equal(retried.question.replies?.length, 1);
  assert.equal(retried.question.resolved, true);
});

test("stop keeps the question and draft history open without launching", async (t) => {
  const f = await fixture(t),
    stopped = await f.manager.questionAction(
      f.run.id,
      {
        questionId: f.question.id,
        revision: f.question.revision,
        action: "stop",
        answer: "This unsaved draft must not be recorded",
      },
      human,
    );
  assert.equal(stopped.run.state, "interrupted");
  assert.equal(stopped.question.resolved, false);
  assert.equal(stopped.question.replies, undefined);
  await f.manager.tick();
  assert.equal(f.workCalls(), 1);
});

test("stale, wrong and historical questions cannot launch another retry", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.manager.questionAction(
      f.run.id,
      {
        questionId: "comment-wrong",
        revision: f.question.revision,
        action: "answer_retry",
        answer: "No",
      },
      human,
    ),
    /not the current question/,
  );
  await assert.rejects(
    f.manager.questionAction(
      f.run.id,
      {
        questionId: f.question.id,
        revision: "stale-revision",
        action: "answer_retry",
        answer: "No",
      },
      human,
    ),
    /changed; reload/,
  );
  const first = await f.manager.questionAction(
    f.run.id,
    {
      questionId: f.question.id,
      revision: f.question.revision,
      action: "answer_retry",
      answer: "Retry once",
    },
    human,
  );
  await assert.rejects(
    f.manager.questionAction(
      f.run.id,
      {
        questionId: f.question.id,
        revision: first.question.revision,
        action: "answer_retry",
        answer: "Retry twice",
      },
      human,
    ),
    /already has a retry run/,
  );
  assert.equal(
    f.manager.status().runs.filter((run) => run.previous === f.run.id).length,
    1,
  );
});

test("a rejected retry preserves the answer, reopens the question and does not tick", async (t) => {
  const f = await fixture(t);
  await f.manager.configure(
    { ...f.config, maxAttempts: 1 },
    f.manager.status().revision,
    human,
  );
  const response = await f.manager.questionAction(
    f.run.id,
    {
      questionId: f.question.id,
      revision: f.question.revision,
      action: "answer_retry",
      answer: "Preserve this before checking retry guards.",
    },
    human,
  );
  assert.equal(response.retried, false);
  assert.match(response.retryError ?? "", /Attempt limit reached/);
  assert.equal(response.run.state, "waiting_input");
  assert.equal(response.question.resolved, false);
  assert.equal(response.question.replies?.[0].actor.name, human.name);
  assert.equal(
    response.question.replies?.[0].body,
    "Preserve this before checking retry guards.",
  );
  await f.manager.tick();
  assert.equal(f.workCalls(), 1);
  assert.equal(
    f.manager.status().runs.filter((run) => run.previous === f.run.id).length,
    0,
  );
});

test("a failed reopen remains explicitly retry-blocked and cannot auto-resume", async (t) => {
  const f = await fixture(t);
  await f.manager.configure(
    { ...f.config, maxAttempts: 1 },
    f.manager.status().revision,
    human,
  );
  const resolveManagedQuestion = f.store.resolveManagedQuestion.bind(f.store);
  f.store.resolveManagedQuestion = (async (
    ...args: Parameters<Store["resolveManagedQuestion"]>
  ) => {
    if (args[3] === false)
      throw new Error("simulated concurrent question edit");
    return resolveManagedQuestion(...args);
  }) as Store["resolveManagedQuestion"];
  const response = await f.manager.questionAction(
    f.run.id,
    {
      questionId: f.question.id,
      revision: f.question.revision,
      action: "answer_retry",
      answer: "This answer remains durable after both failures.",
    },
    human,
  );
  assert.equal(response.retried, false);
  assert.match(response.retryError ?? "", /could not be reopened/);
  assert.equal(response.question.resolved, true);
  assert.equal(response.run.state, "waiting_input");
  assert.equal(response.run.questionRetryBlocked, true);
  const state = f.manager.projectState(f.store.state());
  assert.equal(state.managedQuestions?.[f.question.id].canAct, true);
  assert.match(
    state.managedQuestions?.[f.question.id].error ?? "",
    /retry-blocked/,
  );
  for (let i = 0; i < 3; i++) await f.manager.tick();
  assert.equal(f.workCalls(), 1);
});

test("the retry block is durable before a question write can partially fail", async (t) => {
  const f = await fixture(t),
    replyManagedQuestion = f.store.replyManagedQuestion.bind(f.store);
  f.store.replyManagedQuestion = (async (
    ...args: Parameters<Store["replyManagedQuestion"]>
  ) => {
    await replyManagedQuestion(...args);
    throw new Error("simulated failure after durable question write");
  }) as Store["replyManagedQuestion"];
  await assert.rejects(
    f.manager.questionAction(
      f.run.id,
      {
        questionId: f.question.id,
        revision: f.question.revision,
        action: "answer_retry",
        answer: "This write completed before its caller observed failure.",
      },
      human,
    ),
    /failure after durable question write/,
  );
  const run = f.manager.status().runs.find((row) => row.id === f.run.id)!,
    question = f.store.comments().find((row) => row.id === f.question.id)!;
  assert.equal(run.questionRetryBlocked, true);
  assert.equal(question.resolved, true);
  assert.equal(question.replies?.length, 1);
  assert.equal(
    f.manager.projectState(f.store.state()).managedQuestions?.[question.id]
      .canAct,
    true,
  );
  for (let i = 0; i < 3; i++) await f.manager.tick();
  assert.equal(f.workCalls(), 1);
});

test("the managed question endpoint rejects agents", async (t) => {
  const f = await fixture(t),
    app = await buildServer(f.store);
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: `/api/orchestration/${f.run.id}/question-action`,
    headers: {
      host: "127.0.0.1",
      authorization: `Bearer ${f.store.token()}`,
    },
    payload: {
      questionId: f.question.id,
      revision: f.question.revision,
      action: "answer_retry",
      answer: "An agent must not answer this.",
      actor: agent,
    },
  });
  assert.equal(response.statusCode, 403);
  assert.match(response.json().error, /human/i);
  assert.equal(
    f.store.comments().find((row) => row.id === f.question.id)?.resolved,
    false,
  );
});
