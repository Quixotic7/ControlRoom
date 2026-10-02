import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Store } from "../src/store.js";
import { backup, restore } from "../src/transfer.js";
import type { Actor } from "../src/types.js";

const human: Actor = { name: "Owner", kind: "human" };
const orchestrator: Actor = { name: "Chat Orchestrator", kind: "agent" };
const otherAgent: Actor = { name: "Other Agent", kind: "agent" };
const basis = () => ({
  quote: "I approve this ticket and want you to record that decision.",
  saidAt: new Date(Date.now() - 1000).toISOString(),
});

async function fixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cr-delegation-"));
  const store = new Store(root).initialize("Delegation fixture");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await store.updateConfig(
    store.configRevision(),
    {
      orchestration: {
        enabled: true,
        reviewerMode: "chat",
        reviewer: { name: orchestrator.name },
      },
    },
    human,
  );
  const create = (title: string, input: Record<string, unknown> = {}) =>
    store.create("ticket", { title, ...input }, "Ticket body\n", human);
  return { root, store, create };
}

const scopes = (
  enabled: Partial<{
    approveScope: boolean;
    manageBoard: boolean;
    reviewWork: boolean;
    manageRuns: boolean;
  }> = {},
) => ({
  approveScope: false,
  manageBoard: false,
  reviewWork: false,
  manageRuns: false,
  ...enabled,
});

test("only a human can grant exact current-chat-reviewer authority with a basis", async (t) => {
  const { store, create } = await fixture(t),
    ticket = await create("Delegated approval");
  await assert.rejects(
    store.delegatedBoardAction(
      {
        action: "approve",
        ticket: ticket.meta.id,
        revision: ticket.revision,
        basis: basis(),
      },
      orchestrator,
    ),
    /not enabled/,
  );
  await assert.rejects(
    store.configureDelegation(
      {
        enabled: true,
        scopes: scopes({ approveScope: true }),
        createdBeforeGrant: false,
        approvedGoalsOnly: false,
      },
      store.delegationStatus().revision,
      orchestrator,
    ),
    /Only a human/,
  );
  await store.configureDelegation(
    {
      enabled: true,
      scopes: scopes({ approveScope: true }),
      createdBeforeGrant: false,
      approvedGoalsOnly: false,
    },
    store.delegationStatus().revision,
    human,
  );
  await assert.rejects(
    store.delegatedBoardAction(
      {
        action: "approve",
        ticket: ticket.meta.id,
        revision: ticket.revision,
        basis: basis(),
      },
      otherAgent,
    ),
    /current configured chat reviewer/,
  );
  await assert.rejects(
    store.delegatedBoardAction(
      {
        action: "approve",
        ticket: ticket.meta.id,
        revision: ticket.revision,
        basis: { quote: "", saidAt: new Date().toISOString() },
      },
      orchestrator,
    ),
    /too_small|Too small|string/i,
  );

  const result = await store.delegatedBoardAction(
    {
      action: "approve",
      ticket: ticket.meta.id,
      revision: ticket.revision,
      basis: basis(),
    },
    orchestrator,
  );
  assert.ok("record" in result);
  const approved = result.record!;
  assert.equal(approved.meta.scopeApproved, true);
  assert.deepEqual(approved.meta.scopeApprovedBy, orchestrator);
  assert.equal(
    approved.meta.scopeApprovedDelegation?.grantingHuman.name,
    human.name,
  );
  assert.match(
    approved.meta.scopeApprovedDelegation?.basis.quote ?? "",
    /I approve/,
  );
  assert.equal(result.receipt.actor.kind, "agent");
  assert.equal(result.receipt.grantingHuman.kind, "human");
});

test("delegated approval undo is CAS guarded and creates a new immutable receipt", async (t) => {
  const { store, create } = await fixture(t);
  await store.configureDelegation(
    {
      enabled: true,
      scopes: scopes({ approveScope: true }),
      createdBeforeGrant: false,
      approvedGoalsOnly: false,
    },
    store.delegationStatus().revision,
    human,
  );
  const first = await create("Undo approval"),
    approved = await store.delegatedBoardAction(
      {
        action: "approve",
        ticket: first.meta.id,
        revision: first.revision,
        basis: basis(),
      },
      orchestrator,
    );
  assert.ok("receipt" in approved);
  const undone = await store.undoDelegatedAction(
    approved.receipt.id,
    approved.receipt.revision,
    human,
  );
  assert.equal(undone.records[0].meta.scopeApproved, undefined);
  assert.equal(undone.receipt.undoOf, approved.receipt.id);
  assert.notEqual(undone.records[0].revision, first.revision);
  assert.equal(
    store.delegationStatus().receipts.find((r) => r.id === approved.receipt.id)
      ?.undoReceiptId,
    undone.receipt.id,
  );

  const second = await create("Stale undo"),
    secondApproval = await store.delegatedBoardAction(
      {
        action: "approve",
        ticket: second.meta.id,
        revision: second.revision,
        basis: basis(),
      },
      orchestrator,
    );
  await store.update(
    second.meta.id,
    secondApproval.record!.revision,
    { priority: 1 },
    undefined,
    human,
  );
  await assert.rejects(
    store.undoDelegatedAction(
      secondApproval.receipt.id,
      secondApproval.receipt.revision,
      human,
    ),
    /changed after/,
  );
});

test("scope limits, revocation, reviewer changes and metadata forgery are enforced", async (t) => {
  const { store, create } = await fixture(t),
    goal = await create("Approved goal"),
    approvedGoal = await store.update(
      goal.meta.id,
      goal.revision,
      { scopeApproved: true },
      undefined,
      human,
    ),
    child = await create("Child", { parent: approvedGoal.meta.id }),
    outside = await create("Outside"),
    standaloneDraft = await create("Standalone approved ticket"),
    standalone = await store.update(
      standaloneDraft.meta.id,
      standaloneDraft.revision,
      { scopeApproved: true },
      undefined,
      human,
    );
  await store.configureDelegation(
    {
      enabled: true,
      scopes: scopes({ manageBoard: true }),
      createdBeforeGrant: true,
      approvedGoalsOnly: true,
    },
    store.delegationStatus().revision,
    human,
  );
  const changed = await store.delegatedBoardAction(
    {
      action: "update",
      ticket: child.meta.id,
      revision: child.revision,
      patch: { labels: ["delegated"] },
      basis: basis(),
    },
    orchestrator,
  );
  assert.deepEqual(changed.record!.meta.labels, ["delegated"]);
  await assert.rejects(
    store.delegatedBoardAction(
      {
        action: "update",
        ticket: standalone.meta.id,
        revision: standalone.revision,
        patch: { priority: 1 },
        basis: basis(),
      },
      orchestrator,
    ),
    /under a human-approved goal/,
  );
  await assert.rejects(
    store.delegatedBoardAction(
      {
        action: "update",
        ticket: child.meta.id,
        revision: changed.record!.revision,
        patch: { parent: undefined },
        basis: basis(),
      },
      orchestrator,
    ),
    /outside a human-approved goal/,
  );
  await assert.rejects(
    store.delegatedBoardAction(
      {
        action: "update",
        ticket: child.meta.id,
        revision: changed.record!.revision,
        patch: { parent: outside.meta.id },
        basis: basis(),
      },
      orchestrator,
    ),
    /outside a human-approved goal/,
  );
  const createdLater = await create("Created later", {
    parent: approvedGoal.meta.id,
  });
  await assert.rejects(
    store.delegatedBoardAction(
      {
        action: "update",
        ticket: createdLater.meta.id,
        revision: createdLater.revision,
        patch: { priority: 1 },
        basis: basis(),
      },
      orchestrator,
    ),
    /created before/,
  );
  await assert.rejects(
    store.update(
      child.meta.id,
      changed.record!.revision,
      {
        scopeApprovedDelegation: {
          receiptId: "delegated-action-deadbeefdeadbeef",
          actor: orchestrator,
          grantingHuman: human,
          basis: basis(),
          at: new Date().toISOString(),
        },
      },
      undefined,
      orchestrator,
    ),
    /service-owned/,
  );
  await assert.rejects(
    store.create(
      "ticket",
      {
        title: "Forged",
        scopeApprovedDelegation: {
          receiptId: "delegated-action-deadbeefdeadbeef",
        },
      },
      "",
      orchestrator,
    ),
    /service-owned/,
  );

  await store.updateConfig(
    store.configRevision(),
    {
      orchestration: {
        enabled: true,
        reviewerMode: "chat",
        reviewer: { name: "Replacement Orchestrator" },
      },
    },
    human,
  );
  await assert.rejects(
    store.delegatedBoardAction(
      {
        action: "update",
        ticket: child.meta.id,
        revision: changed.record!.revision,
        patch: { priority: 2 },
        basis: basis(),
      },
      orchestrator,
    ),
    /current configured chat reviewer/,
  );
  await store.updateConfig(
    store.configRevision(),
    {
      orchestration: {
        enabled: true,
        reviewerMode: "chat",
        reviewer: { name: orchestrator.name },
      },
    },
    human,
  );

  const status = store.delegationStatus();
  await store.configureDelegation(
    {
      enabled: false,
      scopes: status.grant!.scopes,
      createdBeforeGrant: true,
      approvedGoalsOnly: true,
    },
    status.revision,
    human,
  );
  await assert.rejects(
    store.delegatedBoardAction(
      {
        action: "update",
        ticket: child.meta.id,
        revision: changed.record!.revision,
        patch: { priority: 2 },
        basis: basis(),
      },
      orchestrator,
    ),
    /not enabled/,
  );
});

test("review and merge receipts are atomic, undoable and survive backup", async (t) => {
  const { store, create } = await fixture(t);
  await store.configureDelegation(
    {
      enabled: true,
      scopes: scopes({ reviewWork: true, manageBoard: true }),
      createdBeforeGrant: false,
      approvedGoalsOnly: false,
    },
    store.delegationStatus().revision,
    human,
  );
  let reviewed = await create("Reviewed", { scopeApproved: true });
  reviewed = await store.update(
    reviewed.meta.id,
    reviewed.revision,
    { status: "review" },
    undefined,
    human,
  );
  const acceptInput = {
      action: "accept" as const,
      ticket: reviewed.meta.id,
      revision: reviewed.revision,
      requestId: crypto.randomUUID(),
      feedback: "Accepted from chat.",
      basis: basis(),
    },
    accepted = await store.delegatedBoardAction(acceptInput, orchestrator),
    recoveredAccept = await store.delegatedBoardAction(
      acceptInput,
      orchestrator,
    );
  assert.equal(accepted.record!.meta.status, "done");
  assert.equal(recoveredAccept.receipt.id, accepted.receipt.id);
  assert.equal(
    accepted.record!.meta.acceptedDelegation?.actor.name,
    orchestrator.name,
  );
  const undoneAccept = await store.undoDelegatedAction(
    accepted.receipt.id,
    accepted.receipt.revision,
    human,
  );
  assert.equal(undoneAccept.records[0].meta.status, "review");

  const survivor = await create("Canonical"),
    source = await create("Duplicate"),
    preview = store.mergePreview(survivor.meta.id, source.meta.id),
    mergeInput = {
      action: "merge" as const,
      ticket: survivor.meta.id,
      source: source.meta.id,
      requestId: crypto.randomUUID(),
      revisions: preview.affected,
      resolutions: {},
      basis: basis(),
    },
    merged = await store.delegatedBoardAction(mergeInput, orchestrator),
    recoveredMerge = await store.delegatedBoardAction(mergeInput, orchestrator);
  assert.equal(merged.source?.meta.archived, true);
  assert.equal(merged.receipt.targets.length, 2);
  assert.equal(recoveredMerge.receipt.id, merged.receipt.id);
  const undoneMerge = await store.undoDelegatedAction(
    merged.receipt.id,
    merged.receipt.revision,
    human,
  );
  assert.equal(
    undoneMerge.records.find((record) => record.meta.id === source.meta.id)
      ?.meta.archived,
    undefined,
  );

  const targetRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "cr-delegation-restore-"),
  );
  t.after(() => fs.rmSync(targetRoot, { recursive: true, force: true }));
  const target = new Store(targetRoot).initialize("Restored delegation");
  await restore(target, await backup(store));
  assert.equal(target.delegationStatus().grant?.reviewer, orchestrator.name);
  assert.equal(
    target.delegationStatus().receipts.length,
    store.delegationStatus().receipts.length,
  );
});

test("managed-assignment guards run only after delegated validation and CAS checks", async (t) => {
  const { store, create } = await fixture(t);
  await store.configureDelegation(
    {
      enabled: true,
      scopes: scopes({ manageBoard: true }),
      createdBeforeGrant: false,
      approvedGoalsOnly: false,
    },
    store.delegationStatus().revision,
    human,
  );
  const ticket = await create("Actively assigned", { scopeApproved: true }),
    assigned = await store.managedUpdate(
      ticket.meta.id,
      ticket.revision,
      {
        assignment: {
          runId: "run-active",
          worker: "Worker",
          assignedBy: orchestrator.name,
          assignedAt: new Date().toISOString(),
          state: "acknowledged",
          mode: "managed",
        },
      },
      orchestrator,
      () => {},
    );
  let guarded = 0;
  const guard = () => {
    guarded += 1;
  };

  await assert.rejects(
    store.delegatedBoardAction(
      {
        action: "update",
        ticket: assigned.meta.id,
        revision: ticket.revision,
        patch: { priority: 1 },
        basis: basis(),
      },
      orchestrator,
      guard,
    ),
    /changed/i,
  );
  await assert.rejects(
    store.delegatedBoardAction(
      {
        action: "update",
        ticket: assigned.meta.id,
        revision: assigned.revision,
        patch: { priority: 1 },
        basis: basis(),
      },
      otherAgent,
      guard,
    ),
    /current configured chat reviewer/,
  );
  await assert.rejects(
    store.delegatedBoardAction(
      {
        action: "update",
        ticket: assigned.meta.id,
        revision: assigned.revision,
        patch: { assignment: undefined },
        basis: basis(),
      },
      orchestrator,
      guard,
    ),
    /service-owned assignment/,
  );
  assert.equal(guarded, 0);

  const changed = await store.delegatedBoardAction(
    {
      action: "update",
      ticket: assigned.meta.id,
      revision: assigned.revision,
      patch: { priority: 1 },
      basis: basis(),
    },
    orchestrator,
    guard,
  );
  assert.equal(guarded, 1);

  await store.update(
    assigned.meta.id,
    changed.record!.revision,
    { priority: 2 },
    undefined,
    human,
  );
  await assert.rejects(
    store.undoDelegatedAction(
      changed.receipt.id,
      changed.receipt.revision,
      human,
      "Undo after a newer human edit",
      guard,
    ),
    /changed after/,
  );
  assert.equal(guarded, 1);
});
