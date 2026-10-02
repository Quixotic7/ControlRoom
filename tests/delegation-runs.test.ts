import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { Orchestrator, defaultOrchestration } from "../src/orchestration.js";
import { git } from "../src/agent-runner.js";
import type { Actor } from "../src/types.js";
import type { ManagedRun } from "../src/orchestration-types.js";

const human: Actor = { name: "Owner", kind: "human" };
const orchestrator: Actor = { name: "Chat Orchestrator", kind: "agent" };
const basis = {
  quote: "Please resume this stopped run.",
  saidAt: "2026-10-01T20:00:00.000Z",
};

async function fixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cr-delegated-runs-"));
  const repository = path.join(root, "code");
  fs.mkdirSync(repository);
  git(repository, "init", "-b", "main");
  git(repository, "config", "user.name", "Test");
  git(repository, "config", "user.email", "test@localhost");
  fs.writeFileSync(path.join(repository, "README.md"), "fixture\n");
  git(repository, "add", ".");
  git(repository, "commit", "-m", "initial");
  const board = path.join(root, "board");
  fs.mkdirSync(board);
  const store = new Store(board).initialize("Delegated runs");
  const manager = new Orchestrator(store);
  const config = {
    ...structuredClone(defaultOrchestration),
    enabled: true,
    reviewerMode: "chat" as const,
    repository,
    baseRef: "main",
    verificationCommand: "true",
    reviewer: { ...defaultOrchestration.reviewer, name: orchestrator.name },
  };
  await manager.configure(config, manager.status().revision, human);
  const stamp = new Date().toISOString();
  let ticket = await store.create(
    "ticket",
    {
      title: "Stopped delegated run",
      scopeApproved: true,
    },
    "## Acceptance criteria\nResume safely.\n",
    human,
  );
  ticket = await store.managedUpdate(
    ticket.meta.id,
    ticket.revision,
    {
      status: store
        .config()
        .columns.find((column) => column.role === "progress")!.id,
      assignment: {
        runId: "run-stopped",
        worker: "Worker 1",
        assignedBy: orchestrator.name,
        assignedAt: stamp,
        state: "acknowledged",
        mode: "managed",
      },
    },
    orchestrator,
    () => {},
  );
  const run: ManagedRun = {
    id: "run-stopped",
    ticket: ticket.meta.id,
    kind: "work",
    agent: config.workers[0],
    state: "interrupted",
    attempt: 0,
    createdAt: stamp,
    updatedAt: stamp,
    revision: ticket.revision,
    configHash: "fixture",
    worktree: repository,
    branch: "main",
    baseCommit: git(repository, "rev-parse", "HEAD"),
  };
  (manager as any).runs.push(run);
  (manager as any).persist();
  t.after(async () => {
    await manager.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { store, manager, ticket, run };
}

test("manageRuns delegation resumes with agent attribution and human undo restores the paused run", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.manager.delegatedAction(
      {
        action: "resume",
        ticket: f.ticket.meta.id,
        revision: f.ticket.revision,
        runId: f.run.id,
        basis,
      },
      orchestrator,
    ),
    /delegation is not enabled/i,
  );
  const status = f.store.delegationStatus();
  await f.manager.configureDelegation(
    {
      enabled: true,
      scopes: {
        approveScope: false,
        manageBoard: false,
        reviewWork: false,
        manageRuns: true,
      },
      createdBeforeGrant: false,
      approvedGoalsOnly: false,
    },
    status.revision,
    human,
  );
  await assert.rejects(
    f.manager.delegatedAction(
      {
        action: "resume",
        ticket: f.ticket.meta.id,
        revision: f.ticket.revision,
        runId: f.run.id,
        basis,
      },
      { name: "Different Agent", kind: "agent" },
    ),
    /configured chat reviewer/i,
  );
  const delegated = (await f.manager.delegatedAction(
    {
      action: "resume",
      ticket: f.ticket.meta.id,
      revision: f.ticket.revision,
      runId: f.run.id,
      basis,
    },
    orchestrator,
  )) as any;
  assert.equal(delegated.receipt.actor.kind, "agent");
  assert.equal(delegated.receipt.actor.name, orchestrator.name);
  assert.deepEqual(delegated.receipt.basis, basis);
  assert.equal(delegated.receipt.externalUndo.successorId, delegated.result.id);
  assert.equal(f.run.state, "interrupted");
  const successor = (f.manager.status().runs as ManagedRun[]).find(
    (candidate) => candidate.previous === f.run.id,
  )!;
  assert.equal(successor.state, "queued");
  const undone = (await f.manager.undoDelegatedAction(
    delegated.receipt.id,
    delegated.receipt.revision,
    human,
  )) as any;
  assert.equal(undone.undoOf, delegated.receipt.id);
  assert.equal(f.run.state, "interrupted");
  const stoppedSuccessor = (f.manager.status().runs as ManagedRun[]).find(
    (candidate) => candidate.id === successor.id,
  )!;
  assert.equal(stoppedSuccessor.state, "interrupted");
  assert.match(stoppedSuccessor.error ?? "", /Stopped explicitly/);
  const restoredTicket = f.store.get(f.ticket.meta.id);
  assert.equal(restoredTicket.meta.status, f.ticket.meta.status);
  assert.equal(restoredTicket.meta.assignment?.runId, f.run.id);
  await assert.rejects(
    f.manager.undoDelegatedAction(
      delegated.receipt.id,
      delegated.receipt.revision,
      human,
    ),
    /already undone/,
  );
});

test("delegated resume retains stale ticket and basis requirements", async (t) => {
  const f = await fixture(t);
  await f.manager.configureDelegation(
    {
      enabled: true,
      scopes: {
        approveScope: false,
        manageBoard: false,
        reviewWork: false,
        manageRuns: true,
      },
      createdBeforeGrant: false,
      approvedGoalsOnly: false,
    },
    f.store.delegationStatus().revision,
    human,
  );
  await assert.rejects(
    f.manager.delegatedAction(
      {
        action: "resume",
        ticket: f.ticket.meta.id,
        revision: "stale",
        runId: f.run.id,
        basis,
      },
      orchestrator,
    ),
    /Ticket changed/,
  );
  await assert.rejects(
    f.manager.delegatedAction(
      {
        action: "resume",
        ticket: f.ticket.meta.id,
        revision: f.ticket.revision,
        runId: f.run.id,
      },
      orchestrator,
    ),
    /basis|quote|invalid_type/i,
  );
});

test("delegated question retry checks both revisions and undo reopens the recorded question", async (t) => {
  const f = await fixture(t);
  const createdQuestion = await f.store.comment(
    f.ticket.meta.id,
    "Which approved option should the worker use?",
    orchestrator,
    "question",
  );
  const question = f.store
    .comments()
    .find((comment) => comment.id === createdQuestion.id)!;
  Object.assign(f.run, {
    state: "waiting_input",
    questionId: question.id,
    error: "Waiting for owner input",
  });
  (f.manager as any).persist();
  await f.manager.configureDelegation(
    {
      enabled: true,
      scopes: {
        approveScope: false,
        manageBoard: false,
        reviewWork: false,
        manageRuns: true,
      },
      createdBeforeGrant: false,
      approvedGoalsOnly: false,
    },
    f.store.delegationStatus().revision,
    human,
  );
  const input = {
    action: "resolve" as const,
    ticket: f.ticket.meta.id,
    revision: f.ticket.revision,
    runId: f.run.id,
    questionId: question.id,
    questionRevision: question.revision,
    answer: "Use the existing compatible option.",
    basis: {
      quote: "Use the existing compatible option and retry.",
      saidAt: basis.saidAt,
    },
  };
  await assert.rejects(
    f.manager.delegatedAction(
      { ...input, questionRevision: "stale" },
      orchestrator,
    ),
    /question changed/i,
  );
  const delegated = (await f.manager.delegatedAction(
    input,
    orchestrator,
  )) as any;
  const answered = f.store
    .comments()
    .find((comment) => comment.id === question.id)!;
  assert.equal(answered.resolved, true);
  assert.equal(answered.resolvedBy?.kind, "agent");
  assert.equal(delegated.receipt.externalUndo.questionId, question.id);
  await f.manager.undoDelegatedAction(
    delegated.receipt.id,
    delegated.receipt.revision,
    human,
  );
  const reopened = f.store
    .comments()
    .find((comment) => comment.id === question.id)!;
  assert.equal(reopened.resolved, false);
  assert.equal(f.run.state, "waiting_input");
  assert.match(reopened.body, /Use the existing compatible option/);
});

test("delegated board edits validate stale input before pausing assigned work", async (t) => {
  const f = await fixture(t);
  f.run.state = "queued";
  (f.manager as any).persist();
  await f.manager.configureDelegation(
    {
      enabled: true,
      scopes: {
        approveScope: false,
        manageBoard: true,
        reviewWork: false,
        manageRuns: false,
      },
      createdBeforeGrant: false,
      approvedGoalsOnly: false,
    },
    f.store.delegationStatus().revision,
    human,
  );
  const action = {
    action: "update" as const,
    ticket: f.ticket.meta.id,
    revision: "stale",
    patch: { priority: 1 },
    basis: {
      quote: "Raise this ticket's priority.",
      saidAt: basis.saidAt,
    },
  };
  await assert.rejects(
    f.manager.delegatedAction(action, orchestrator),
    /changed|reload/i,
  );
  assert.equal(f.run.state, "queued");
  const result = (await f.manager.delegatedAction(
    { ...action, revision: f.ticket.revision },
    orchestrator,
  )) as any;
  assert.equal(result.record.meta.priority, 1);
  assert.equal(f.run.state, "interrupted");
});

test("delegated merge pauses managed work for every affected relationship record", async (t) => {
  const f = await fixture(t);
  const source = await f.store.create(
    "ticket",
    { title: "Duplicate", scopeApproved: true },
    "",
    human,
  );
  let child = await f.store.create(
    "ticket",
    { title: "Incoming child", parent: source.meta.id, scopeApproved: true },
    "",
    human,
  );
  child = await f.store.managedUpdate(
    child.meta.id,
    child.revision,
    {
      status: f.store.config().columns.find((column) => column.role === "progress")!.id,
      assignment: {
        runId: "run-child",
        worker: "Worker 2",
        assignedBy: orchestrator.name,
        assignedAt: new Date().toISOString(),
        state: "acknowledged",
        mode: "managed",
      },
    },
    orchestrator,
    () => {},
  );
  const childRun: ManagedRun = {
    ...structuredClone(f.run),
    id: "run-child",
    ticket: child.meta.id,
    state: "queued",
    revision: child.revision,
  };
  (f.manager as any).runs.push(childRun);
  (f.manager as any).persist();
  await f.manager.configureDelegation(
    {
      enabled: true,
      scopes: {
        approveScope: false,
        manageBoard: true,
        reviewWork: false,
        manageRuns: false,
      },
      createdBeforeGrant: false,
      approvedGoalsOnly: false,
    },
    f.store.delegationStatus().revision,
    human,
  );
  const preview = f.store.mergePreview(f.ticket.meta.id, source.meta.id);
  await f.manager.delegatedAction(
    {
      action: "merge",
      ticket: f.ticket.meta.id,
      basis: { quote: "Merge this duplicate.", saidAt: basis.saidAt },
      merge: {
        source: source.meta.id,
        requestId: "merge-affected-records",
        revisions: preview.affected,
        resolutions: Object.fromEntries(
          Object.keys(preview.conflicts).map((field) => [field, "survivor"]),
        ),
      },
    },
    orchestrator,
  );
  assert.equal(childRun.state, "interrupted");
  assert.equal(f.store.get(child.meta.id).meta.parent, f.ticket.meta.id);
});

test("receipt failure leaves durable blocked evidence when a resolved question cannot be reopened", async (t) => {
  const f = await fixture(t);
  const createdQuestion = await f.store.comment(
    f.ticket.meta.id,
    "Choose an option?",
    orchestrator,
    "question",
  );
  const question = f.store.comments().find((item) => item.id === createdQuestion.id)!;
  Object.assign(f.run, { state: "waiting_input", questionId: question.id });
  (f.manager as any).persist();
  await f.manager.configureDelegation(
    {
      enabled: true,
      scopes: {
        approveScope: false,
        manageBoard: false,
        reviewWork: false,
        manageRuns: true,
      },
      createdBeforeGrant: false,
      approvedGoalsOnly: false,
    },
    f.store.delegationStatus().revision,
    human,
  );
  (f.store as any).resolveManagedQuestion = async () => {
    throw new Error("grant expired during receipt write");
  };
  (f.store as any).recordDelegatedExternalAction = async () => {
    const current = f.store.get(f.ticket.meta.id);
    await f.store.managedUpdate(
      current.meta.id,
      current.revision,
      { priority: 1 },
      human,
      () => {},
    );
    throw new Error("receipt storage unavailable");
  };
  await assert.rejects(
    f.manager.delegatedAction(
      {
        action: "resolve",
        ticket: f.ticket.meta.id,
        revision: f.ticket.revision,
        runId: f.run.id,
        questionId: question.id,
        questionRevision: question.revision,
        answer: "Use option A.",
        basis: { quote: "Use option A and retry.", saidAt: basis.saidAt },
      },
      orchestrator,
    ),
    /receipt storage unavailable/,
  );
  assert.equal(f.run.state, "waiting_input");
  assert.equal(f.run.questionRetryBlocked, true);
  const retained = f.store.comments().find((item) => item.id === question.id)!;
  assert.equal(retained.resolved, true);
  assert.match(retained.body, /Use option A/);
  const retainedTicket = f.store.get(f.ticket.meta.id);
  assert.equal(retainedTicket.meta.priority, 1);
  assert.notEqual(retainedTicket.meta.assignment?.runId, f.run.id);
  assert.match(f.run.error ?? "", /assignment could not be restored/i);
  assert.ok(
    f.store.comments().some((item) =>
      item.body.includes("Delegated managed action not completed"),
    ),
  );
});
