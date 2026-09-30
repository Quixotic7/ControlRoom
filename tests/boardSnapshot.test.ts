import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { boardSnapshot } from "../src/boardSnapshot.js";
import type { Comment } from "../src/types.js";

test("refresh snapshot detects comment additions, edits, answers and deletion independently of ticket revisions", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cr-snapshot-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(root).initialize("Snapshot");
  const ticket = await store.create(
    "ticket",
    { title: "Example" },
    "Private long body",
    { name: "Tester", kind: "human" },
  );
  const state = store.state();
  const before = structuredClone(state);
  const empty = boardSnapshot(state);
  const question: Comment = {
    id: "comment-1",
    ticket: ticket.meta.id,
    actor: { name: "Agent", kind: "agent" },
    at: "2026-09-30T00:00:00Z",
    kind: "question",
    body: "Question",
    revision: "new",
  };
  state.comments = [question];
  const added = boardSnapshot(state);
  assert.equal(added.tickets[0].revision, empty.tickets[0].revision);
  assert.notEqual(
    added.tickets[0].conversationRevision,
    empty.tickets[0].conversationRevision,
  );
  assert.deepEqual(added.tickets[0].openQuestions, ["comment-1"]);
  state.comments = [
    { ...question, body: "Edited question", revision: "edited" },
  ];
  const edited = boardSnapshot(state);
  assert.notEqual(
    edited.tickets[0].conversationRevision,
    added.tickets[0].conversationRevision,
  );
  state.comments = [{ ...question, resolved: true, revision: "answered" }];
  const answered = boardSnapshot(state);
  assert.notEqual(
    answered.tickets[0].conversationRevision,
    edited.tickets[0].conversationRevision,
  );
  assert.deepEqual(answered.tickets[0].openQuestions, []);
  state.comments = [];
  assert.equal(
    boardSnapshot(state).tickets[0].conversationRevision,
    empty.tickets[0].conversationRevision,
  );
  assert.deepEqual(state, before, "snapshot never changes state");
  assert.ok(!JSON.stringify(empty).includes("Private long body"));
});

test("refresh includes done and archived tickets, actual stage names and claims without asserting a running agent", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cr-snapshot-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(root).initialize("Snapshot");
  const ticket = await store.create("ticket", { title: "Archived" }, "", {
    name: "Tester",
    kind: "human",
  });
  const state = store.state();
  state.records[0].meta.status = "done";
  state.records[0].meta.archived = true;
  state.config.columns.find((column) => column.id === "done")!.name =
    "Accepted";
  state.claims = [
    {
      ticket: ticket.meta.id,
      actor: { name: "Agent", kind: "agent" },
      worktree: root,
      reportedAt: "2026-09-30T00:00:00Z",
      expiresAt: "2026-09-30T00:30:00Z",
    },
  ];
  const original = structuredClone(state);
  const snapshot = boardSnapshot(state);
  assert.equal(snapshot.tickets.length, 1);
  assert.equal(snapshot.tickets[0].archived, true);
  assert.equal(
    snapshot.workflow.find((column) => column.id === "done")?.name,
    "Accepted",
  );
  assert.deepEqual(snapshot.tickets[0].claims, state.claims);
  assert.equal("running" in snapshot.tickets[0], false);
  assert.deepEqual(state, original);
});
