import test from "node:test";
import assert from "node:assert/strict";
import {
  approvalFilterOf,
  attentionReason,
  context,
  matches,
  parseFilter,
  showsArchived,
  withApprovalFilter,
} from "../web/model.js";
import { defaultColumns } from "../src/store.js";
import type { Meta, ProjectState, RecordFile } from "../src/types.js";

let n = 0;
function ticket(meta: Partial<Meta>): RecordFile {
  const id = meta.id ?? `WB-${n}`;
  const number = meta.number ?? n++;
  return {
    meta: {
      schema: 1,
      kind: "ticket",
      title: `Ticket ${number}`,
      status: "backlog",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      author: { name: "You", kind: "human" },
      ...meta,
      id,
      number,
    } as Meta,
    body: "",
    revision: `rev-${id}`,
    path: `records/tickets/${id}.md`,
  };
}
const stateOf = (records: RecordFile[]): ProjectState => ({
  config: {
    schema: 1,
    projectId: "project-1",
    name: "Test",
    columns: defaultColumns,
    shortcut: { key: 1, modifiers: 0, label: "" },
  },
  configRevision: "",
  records,
  comments: [],
  attachments: [],
  claims: [],
  errors: [],
  branch: "main",
  canonical: "/",
  branchChanged: false,
  acknowledgedBranch: "main",
  revision: "",
});

test("Done tickets leave Needs you while retaining historical blockers and questions", () => {
  const r = ticket({ status: "done", blocked: "Old permission check" });
  const state = stateOf([r]);
  state.comments.push({
    id: "question",
    ticket: r.meta.id,
    kind: "question",
    body: "Old question",
    resolved: false,
    actor: { name: "Agent", kind: "agent" },
    at: "2026-01-01",
    revision: "q1",
  });
  assert.equal(attentionReason(r, state, context(state)), null);
  assert.equal(r.meta.blocked, "Old permission check");
  assert.equal(state.comments[0].resolved, false);
  r.meta.status = "progress";
  assert.equal(attentionReason(r, state, context(state)), "blocked");
  r.meta.blocked = "";
  assert.equal(attentionReason(r, state, context(state)), "question");
});

test("is:archived matches archived tickets and -is:archived excludes them", () => {
  const live = ticket({ id: "WB-live" });
  const gone = ticket({ id: "WB-gone", archived: true, status: "done" });
  const ctx = context(stateOf([live, gone]));
  const pick = (q: string) =>
    [live, gone]
      .filter((r) => matches(r, parseFilter(q), ctx))
      .map((r) => r.meta.id);
  assert.deepEqual(pick("is:archived"), ["WB-gone"]);
  assert.deepEqual(pick("-is:archived"), ["WB-live"]);
  // Combined with is:open, which keeps its meaning.
  assert.deepEqual(pick("is:archived is:open"), []);
  assert.deepEqual(pick("is:open"), ["WB-live"]);
});

test("showsArchived only for a positive is:archived term", () => {
  assert.equal(showsArchived(parseFilter("is:archived")), true);
  assert.equal(
    showsArchived(parseFilter("label:ui is:blocked,archived")),
    true,
  );
  assert.equal(showsArchived(parseFilter("-is:archived")), false);
  assert.equal(showsArchived(parseFilter("archived")), false);
  assert.equal(showsArchived(parseFilter("")), false);
});

test("approval control preserves non-approval constraints and exposes mixed expressions", () => {
  assert.equal(approvalFilterOf("label:ui is:approved login"), "approved");
  assert.equal(approvalFilterOf("-is:approved owner:ana"), "not-approved");
  assert.equal(approvalFilterOf("is:approved,blocked"), "custom");
  assert.equal(approvalFilterOf("is:approved -is:approved"), "custom");
  assert.equal(
    withApprovalFilter("label:ui is:approved is:blocked login", "not-approved"),
    "label:ui is:blocked login -is:approved",
  );
  assert.equal(
    withApprovalFilter("label:ui is:approved,blocked login", "all"),
    "label:ui is:blocked login",
  );
  assert.equal(
    withApprovalFilter(
      'label:"needs design" -is:approved,blocked "customer login"',
      "all",
    ),
    'label:"needs design" -is:blocked "customer login"',
  );
});
