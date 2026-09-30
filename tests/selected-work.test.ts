import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { atomic, read, patchMd } from "../src/files.js";
import type { Actor } from "../src/types.js";
const human: Actor = { name: "Human", kind: "human" },
  agent: Actor = { name: "Agent", kind: "agent" };
const fixture = (t: test.TestContext) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-selected-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new Store(root).initialize("Tests");
};
test("questionnaires retain drafts protocol, wording, amendments and replacement history; revisions guard answers", async (t) => {
  const s = fixture(t),
    ticket = await s.create(
      "ticket",
      { title: "Questions" },
      "Custom prose",
      human,
    );
  const qs = [
    {
      id: "color",
      prompt: "Which color?",
      type: "choice",
      choices: ["Blue", "Red"],
      recommended: "Blue",
    },
    { id: "why", prompt: "Why?", type: "text" },
  ];
  await assert.rejects(
    s.questionnaire(
      ticket.meta.id,
      [{ id: "constructor", prompt: "Invalid ID", type: "text" }],
      agent,
    ),
    /reserved/,
  );
  const q = await s.questionnaire(ticket.meta.id, qs, agent);
  assert.equal(q.resolved, false);
  assert.equal(s.get(ticket.meta.id).meta.status, "backlog");
  await assert.rejects(
    s.answerQuestionnaire(q.id, q.revision, { color: "Blue" }, human),
    /required/,
  );
  await assert.rejects(
    s.answerQuestionnaire(
      q.id,
      q.revision,
      { color: "Blue", why: "Reason" },
      agent,
    ),
    /human/,
  );
  let answered = await s.answerQuestionnaire(
    q.id,
    q.revision,
    { color: "Custom green", why: "Readable" },
    human,
  );
  assert.equal(answered.resolved, true);
  assert.equal(answered.answers?.[0].values.color, "Custom green");
  assert.match(answered.body, /Which color/);
  assert.match(answered.body, /Readable/);
  await assert.rejects(
    s.answerQuestionnaire(
      q.id,
      q.revision,
      { color: "Red", why: "Race" },
      human,
    ),
    /changed/,
  );
  answered = await s.answerQuestionnaire(
    q.id,
    answered.revision,
    { color: "Red", why: "Amendment" },
    human,
  );
  assert.equal(answered.answers?.length, 2);
  const replaced = await s.questionnaire(
    ticket.meta.id,
    [{ id: "color", prompt: "Updated color?", type: "text" }],
    agent,
    { id: q.id, revision: answered.revision },
  );
  assert.equal(replaced.resolved, false);
  assert.match(replaced.body, /Which color/);
  assert.equal(replaced.answers?.length, 2);
  await assert.rejects(
    s.answerQuestionnaire(q.id, answered.revision, { color: "Blue" }, human),
    /changed/,
  );
  assert.ok(s.historyFor(ticket.meta.id).length >= 3);
  assert.match(s.contextMarkdown(ticket.meta.id).markdown, /Updated color/);
  const other = await s.questionnaire(
    ticket.meta.id,
    [{ id: "other", prompt: "Other?", type: "text" }],
    agent,
  );
  await s.answerQuestionnaire(
    q.id,
    replaced.revision,
    { color: "Purple" },
    human,
  );
  assert.equal(s.comments().find((c) => c.id === other.id)?.resolved, false);
  await assert.rejects(
    s.questionnaire(ticket.meta.id, [qs[0], qs[0]], agent),
    /unique/,
  );
});
test("progress sessions reset only on entry, reports are bounded and attributed, and 100 does not complete work", async (t) => {
  const s = fixture(t);
  let r = await s.create(
    "ticket",
    { title: "Progress", scopeApproved: true },
    "Description",
    human,
  );
  r = await s.update(
    r.meta.id,
    r.revision,
    { status: "progress" },
    undefined,
    agent,
  );
  assert.ok(r.meta.progressStartedAt);
  const started = r.meta.progressStartedAt;
  r = await s.update(
    r.meta.id,
    r.revision,
    {
      progress: {
        note: "Tests pass",
        percent: 100,
        actor: human,
        at: "forged",
      },
    },
    undefined,
    agent,
  );
  assert.equal(r.meta.status, "progress");
  assert.equal(r.meta.progressStartedAt, started);
  assert.equal(r.meta.progress?.actor.name, "Agent");
  assert.notEqual(r.meta.progress?.at, "forged");
  await assert.rejects(
    s.update(
      r.meta.id,
      r.revision,
      { progress: { note: "Too high", percent: 101 } },
      undefined,
      agent,
    ),
  );
  await assert.rejects(
    s.update(
      r.meta.id,
      "stale",
      { progress: { note: "Conflict" } },
      undefined,
      agent,
    ),
    /changed/,
  );
  r = await s.update(
    r.meta.id,
    r.revision,
    { status: "selected" },
    undefined,
    agent,
  );
  // Simulate an older session without relying on clock sleeps.
  atomic(
    s.file(r.path),
    patchMd(read(s.file(r.path)), {
      progressStartedAt: "2020-01-01T00:00:00.000Z",
    }),
  );
  r = s.get(r.meta.id);
  r = await s.update(
    r.meta.id,
    r.revision,
    { status: "progress" },
    undefined,
    agent,
  );
  assert.notEqual(r.meta.progressStartedAt, "2020-01-01T00:00:00.000Z");
  assert.match(s.contextMarkdown(r.meta.id).markdown, /100% estimate/);
});
test("placement is serialized against target revisions and preserves source on conflict", async (t) => {
  const s = fixture(t);
  const a = await s.create("ticket", { title: "A" }, "", human),
    b = await s.create("ticket", { title: "B" }, "", human);
  await s.update(b.meta.id, b.revision, { title: "Changed" }, undefined, human);
  await assert.rejects(
    s.placement(
      a.meta.id,
      a.revision,
      {
        expected: [{ id: b.meta.id, revision: b.revision }],
        patch: { status: "backlog", order: 1 },
      },
      human,
    ),
    /order changed/,
  );
  assert.equal(s.get(a.meta.id).revision, a.revision);
});

test("questionnaire choice selections and custom notes round trip independently with immutable amendments", async (t) => {
  const s = fixture(t);
  const ticket = await s.create(
    "ticket",
    { title: "Choice details" },
    "",
    human,
  );
  const q = await s.questionnaire(
    ticket.meta.id,
    [
      {
        id: "single",
        prompt: "One option",
        type: "choice",
        choices: ["A", "B"],
      },
      {
        id: "multi",
        prompt: "Several options",
        type: "choice",
        multiple: true,
        choices: ["X", "Y", "Z"],
      },
    ],
    agent,
  );
  const choiceAnswers = {
    single: { selected: ["A"], custom: "My separate note" },
    multi: { selected: ["X", "Z"], custom: "Keep this too" },
  };
  for (const single of [
    { selected: ["A", "B"], custom: "" },
    { selected: ["A", "A"], custom: "" },
    { selected: ["Unknown"], custom: "" },
  ]) {
    await assert.rejects(
      s.answerQuestionnaire(q.id, q.revision, {}, human, {
        ...choiceAnswers,
        single,
      }),
      /valid options/,
    );
  }
  await assert.rejects(
    s.answerQuestionnaire(q.id, q.revision, {}, human, {
      unknown: { selected: [], custom: "No" },
    }),
    /Unknown choice/,
  );
  await assert.rejects(
    s.answerQuestionnaire(q.id, q.revision, {}, agent, choiceAnswers),
    /human/,
  );
  const saved = await s.answerQuestionnaire(
    q.id,
    q.revision,
    {},
    human,
    choiceAnswers,
  );
  assert.deepEqual(saved.answers?.[0].choiceAnswers, choiceAnswers);
  assert.equal(saved.answers?.[0].values.multi, "X\n\nZ\n\nKeep this too");
  await assert.rejects(
    s.answerQuestionnaire(q.id, q.revision, {}, human, choiceAnswers),
    /changed/,
  );
  const amended = await s.answerQuestionnaire(q.id, saved.revision, {}, human, {
    ...choiceAnswers,
    single: { selected: ["B"], custom: "My separate note" },
  });
  const disk = new Store(s.root).comments().find((c) => c.id === q.id)!;
  assert.deepEqual(disk.answers, amended.answers);
  assert.deepEqual(disk.answers?.[0].choiceAnswers, choiceAnswers);
  assert.deepEqual(disk.answers?.[1].choiceAnswers?.single, {
    selected: ["B"],
    custom: "My separate note",
  });
  assert.match(s.contextMarkdown(ticket.meta.id).markdown, /Keep this too/);
});
