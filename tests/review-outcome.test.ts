import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/store.js";
import { decisionProtocol } from "../src/decision-protocol.js";

const human = { name: "Reviewer", kind: "human" as const };
const agent = { name: "Coding agent", kind: "agent" as const };
function fixture(t: test.TestContext) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-review-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new Store(root).initialize();
}
test("review outcomes preserve edits and evidence, do not accept children, and retry once across restarts", async (t) => {
  const s = fixture(t);
  const parent = await s.create(
    "ticket",
    {
      title: "Parent",
      status: "review",
      handoff: "Original handoff",
      evidence: "Tests pass",
      customField: "Keep",
    },
    "Original prose",
    human,
  );
  const child = await s.create(
    "ticket",
    { title: "Child", parent: parent.meta.id },
    "",
    human,
  );
  const input = {
    requestId: randomUUID(),
    revision: parent.revision,
    outcome: "accept",
    target: "done",
    feedback: "Verified on keyboard",
    patch: { title: "Revised parent" },
    body: "Custom prose retained and expanded",
  };
  const saved = await s.reviewOutcome(parent.meta.id, input, human);
  assert.equal(saved.meta.status, "done");
  assert.equal(saved.meta.title, "Revised parent");
  assert.equal(saved.body, input.body);
  assert.equal(saved.meta.customField, "Keep");
  assert.equal(saved.meta.handoff, "Original handoff");
  assert.equal(saved.meta.evidence, "Tests pass");
  assert.equal(s.get(child.meta.id).meta.status, "backlog");
  const restarted = new Store(s.root);
  assert.equal(
    (await restarted.reviewOutcome(parent.meta.id, input, human)).revision,
    saved.revision,
  );
  assert.equal(s.comments().length, 1);
  assert.equal(s.comments()[0].kind, "review");
  assert.equal(s.comments()[0].actor.kind, "human");
  assert.match(s.comments()[0].body, /Verified on keyboard/);
  await assert.rejects(
    s.reviewOutcome(parent.meta.id, { ...input, feedback: "Different" }, human),
    /different content/,
  );
  // Recover the feedback if the process stopped between the record and comment writes.
  fs.unlinkSync(s.file(`records/comments/${s.comments()[0].id}.md`));
  await restarted.reviewOutcome(parent.meta.id, input, human);
  assert.equal(s.comments().length, 1);
});
test("stale reviews, agents, and wrong destination roles cannot write feedback or overwrite drafts", async (t) => {
  const s = fixture(t);
  const r = await s.create(
    "ticket",
    { title: "Review", status: "review" },
    "Before",
    human,
  );
  const input = {
    requestId: randomUUID(),
    revision: r.revision,
    outcome: "changes",
    target: "progress",
    feedback: "Fix this",
    patch: {},
    body: "Draft",
  };
  await assert.rejects(
    s.reviewOutcome(r.meta.id, input, agent),
    /Only a human/,
  );
  await assert.rejects(
    s.reviewOutcome(r.meta.id, { ...input, target: "done" }, human),
    /progress role/,
  );
  const changed = await s.update(
    r.meta.id,
    r.revision,
    { title: "External edit" },
    undefined,
    human,
  );
  await assert.rejects(
    s.reviewOutcome(r.meta.id, input, human),
    /record changed/,
  );
  assert.equal(s.comments().length, 0);
  assert.equal(s.get(r.meta.id).body, "Before");
  const result = await s.reviewOutcome(
    r.meta.id,
    { ...input, revision: changed.revision },
    human,
  );
  assert.equal(result.meta.status, "progress");
  assert.match(s.comments()[0].body, /Changes requested/);
  await assert.rejects(
    s.reviewOutcome(
      r.meta.id,
      { ...input, requestId: randomUUID(), revision: result.revision },
      human,
    ),
    /Only a ticket in Review/,
  );
});
test("decision protocol stays consistent and knowledge survives supersession and ticket archival", async (t) => {
  const s = fixture(t);
  const ticket = await s.create(
    "ticket",
    { title: "Unapproved work" },
    "",
    human,
  );
  const old = await s.create(
    "decision",
    {
      title: "Choose storage",
      status: "accepted",
      references: [ticket.meta.id],
      scope: ["storage"],
    },
    "## Choice\n\nFiles\n\n## Rationale\n\nPortable",
    agent,
  );
  const successor = await s.create(
    "decision",
    {
      title: "Refine storage",
      status: "accepted",
      supersedes: old.meta.id,
      references: [ticket.meta.id],
      scope: ["storage"],
    },
    "## Choice\n\nShared files\n\n## Rationale\n\nCoordinate worktrees\n\n## Alternatives and tradeoffs\n\nA database costs setup.",
    agent,
  );
  const linked = await s.update(
    ticket.meta.id,
    ticket.revision,
    { decisions: [old.meta.id, successor.meta.id] },
    undefined,
    agent,
  );
  assert.equal(s.context(ticket.meta.id).approvedScope, null);
  assert.deepEqual(
    s.context(ticket.meta.id).decisions.map((r) => r.meta.id),
    [successor.meta.id],
  );
  await assert.rejects(
    s.update(
      ticket.meta.id,
      linked.revision,
      { status: "progress" },
      undefined,
      agent,
    ),
    /approv/i,
  );
  await s.update(
    ticket.meta.id,
    linked.revision,
    { archived: true },
    undefined,
    human,
  );
  assert.equal(s.get(old.meta.id).body, old.body);
  assert.equal(s.list().filter((r) => r.meta.kind === "decision").length, 2);
  assert.equal(s.get(successor.meta.id).meta.author.name, agent.name);
  assert.ok(
    s.contextMarkdown(ticket.meta.id, true).markdown.includes(decisionProtocol),
  );
  assert.equal(s.context(ticket.meta.id).decisionProtocol, decisionProtocol);
  assert.ok(
    fs.readFileSync("AGENT_GUIDE.md", "utf8").includes(decisionProtocol),
  );
});
