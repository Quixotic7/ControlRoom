import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/store.js";

const human = { name: "Reviewer", kind: "human" as const };
const agent = { name: "Worker", kind: "agent" as const };

function fixture(t: test.TestContext) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-approval-actions-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new Store(root).initialize();
}

test("bulk scope approval reports stale and inherited items without changing their fields", async (t) => {
  const store = fixture(t);
  const approvable = await store.create(
    "ticket",
    { title: "Approve me", owner: "Keep", customField: "Untouched" },
    "Body remains",
    human,
  );
  const stale = await store.create("ticket", { title: "Stale" }, "", human);
  const parent = await store.create(
    "ticket",
    { title: "Approved parent", scopeApproved: true },
    "",
    human,
  );
  const inherited = await store.create(
    "ticket",
    { title: "Inherited child", parent: parent.meta.id },
    "",
    human,
  );
  await store.update(
    stale.meta.id,
    stale.revision,
    { owner: "Someone else" },
    undefined,
    human,
  );

  const response = await store.approvalActions(
    {
      action: "approve-scope",
      items: [
        { id: approvable.meta.id, revision: approvable.revision },
        { id: stale.meta.id, revision: stale.revision },
        { id: inherited.meta.id, revision: inherited.revision },
      ],
    },
    human,
  );

  assert.deepEqual(
    response.results.map((result) => result.outcome),
    ["succeeded", "failed", "ineligible"],
  );
  assert.match(response.results[1].error ?? "", /changed/);
  assert.match(response.results[2].error ?? "", /inherited/);
  const approved = store.get(approvable.meta.id);
  assert.equal(approved.meta.status, approvable.meta.status);
  assert.equal(approved.meta.owner, "Keep");
  assert.equal(approved.meta.customField, "Untouched");
  assert.equal(approved.body, "Body remains");
  assert.equal(approved.meta.scopeApproved, true);
  assert.deepEqual(approved.meta.scopeApprovedBy, human);
  assert.equal(
    store.historyFor(approvable.meta.id).at(-1)?.actor.name,
    human.name,
  );
  assert.equal(store.get(stale.meta.id).meta.scopeApproved, undefined);
  assert.equal(store.get(inherited.meta.id).meta.scopeApproved, undefined);
});

test("quick acceptance preserves review evidence and rejects agent use of the bulk path", async (t) => {
  const store = fixture(t);
  const review = await store.create(
    "ticket",
    {
      title: "Ready",
      status: "review",
      scopeApproved: true,
      handoff: "Summary stays visible",
      evidence: "Tests passed",
      customField: "Untouched",
    },
    "Acceptance criteria",
    human,
  );
  const agentInput = {
    action: "accept-review",
    target: "done",
    items: [
      {
        id: review.meta.id,
        revision: review.revision,
        requestId: randomUUID(),
      },
    ],
  };
  await assert.rejects(
    store.approvalActions(agentInput, agent),
    /Only a human/,
  );
  assert.equal(store.get(review.meta.id).meta.status, "review");

  const response = await store.approvalActions(agentInput, human);
  assert.equal(response.results[0].outcome, "succeeded");
  const accepted = store.get(review.meta.id);
  assert.equal(accepted.meta.status, "done");
  assert.deepEqual(accepted.meta.acceptedBy, human);
  assert.equal(accepted.meta.handoff, "Summary stays visible");
  assert.equal(accepted.meta.evidence, "Tests passed");
  assert.equal(accepted.meta.customField, "Untouched");
  assert.equal(accepted.body, "Acceptance criteria");
  assert.equal(store.comments().at(-1)?.actor.kind, "human");
  assert.match(store.comments().at(-1)?.body ?? "", /Accepted into Done/);
});

test("agents cannot approve scope through approval actions", async (t) => {
  const store = fixture(t);
  const ticket = await store.create("ticket", { title: "Planned" }, "", human);
  await assert.rejects(
    store.approvalActions(
      {
        action: "approve-scope",
        items: [{ id: ticket.meta.id, revision: ticket.revision }],
      },
      agent,
    ),
    /Only a human/,
  );
  assert.equal(store.get(ticket.meta.id).meta.scopeApproved, undefined);
});
