import test from "node:test";
import assert from "node:assert/strict";
import { context } from "../web/model.js";
import { ticketCompletion } from "../web/TicketProgress.js";
import { defaultColumns } from "../src/store.js";
import type { Meta, ProjectState, RecordFile } from "../src/types.js";

function ticket(meta: Partial<Meta>, body = ""): RecordFile {
  const id = meta.id ?? "WB-ticket";
  return {
    meta: {
      schema: 1,
      id,
      kind: "ticket",
      number: 1,
      title: id,
      status: "backlog",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      author: { name: "You", kind: "human" },
      ...meta,
    } as Meta,
    body,
    revision: `revision-${id}`,
    path: `records/tickets/${id}.md`,
  };
}

function stateOf(records: RecordFile[]): ProjectState {
  return {
    config: {
      schema: 1,
      projectId: "progress-test",
      name: "Progress test",
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
  };
}

test("ticket progress keeps microtasks and all direct children distinct", () => {
  const parent = ticket(
    { id: "WB-parent" },
    "## Microtasks\n- [x] Draft copy\n- [ ] Ship copy\n",
  );
  const doneChild = ticket({
    id: "WB-done",
    parent: parent.meta.id,
    status: "done",
  });
  // Archived children are intentionally included, even when a board filter
  // would hide them. Archived does not itself mean complete.
  const archivedOpenChild = ticket({
    id: "WB-archived-open",
    parent: parent.meta.id,
    archived: true,
  });
  const grandchild = ticket({
    id: "WB-grandchild",
    parent: doneChild.meta.id,
    status: "done",
  });

  assert.deepEqual(
    ticketCompletion(
      parent,
      context(stateOf([parent, doneChild, archivedOpenChild, grandchild])),
    ),
    {
      microtasks: { complete: 1, total: 2 },
      children: { complete: 1, total: 2 },
    },
  );
  assert.equal(parent.meta.status, "backlog");
});
