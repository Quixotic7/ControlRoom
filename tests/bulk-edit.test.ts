import test from "node:test";
import assert from "node:assert/strict";
import type { Meta, RecordFile } from "../src/types.js";
import {
  bulkPatch,
  commonValue,
  reconcileSelection,
  type BulkChanges,
} from "../web/bulkEdit.js";

function ticket(meta: Partial<Meta> = {}): RecordFile {
  return {
    meta: {
      schema: 1,
      id: "WB-one",
      kind: "ticket",
      number: 1,
      title: "One",
      status: "backlog",
      priority: 2,
      owner: "Morgan",
      labels: ["keep", "remove"],
      parent: "WB-parent",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      author: { name: "You", kind: "human" },
      ...meta,
    },
    body: "",
    revision: "revision-one",
    path: "records/tickets/WB-one.md",
  };
}

const emptyChanges = (): BulkChanges => ({
  addLabels: [],
  removeLabels: [],
});

test("bulk mixed values and visibility reconciliation are ID based", () => {
  assert.equal(commonValue(["backlog", "backlog"]), "backlog");
  assert.equal(commonValue(["backlog", "progress"]), undefined);
  assert.equal(commonValue([null, null]), null);
  assert.deepEqual(
    [...reconcileSelection(new Set(["one", "two"]), new Set(["two", "three"]))],
    ["two"],
  );
});

test("bulk patches only enabled scalar fields and preserves unrelated metadata", () => {
  const record = ticket({ blocked: "Keep this", labels: ["keep", "remove"] });
  assert.deepEqual(
    bulkPatch(record, {
      ...emptyChanges(),
      status: "progress",
      owner: "",
      parent: null,
    }),
    { status: "progress", owner: "", parent: null },
  );
  assert.equal(record.meta.blocked, "Keep this");
  assert.equal(record.meta.priority, 2);
});

test("label add and remove operations preserve every other label and report no-ops", () => {
  const record = ticket();
  assert.deepEqual(
    bulkPatch(record, {
      ...emptyChanges(),
      addLabels: ["added", "keep"],
      removeLabels: ["remove"],
    }),
    { labels: ["keep", "added"] },
  );
  assert.deepEqual(
    bulkPatch(record, {
      ...emptyChanges(),
      status: "backlog",
      priority: 2,
      owner: "Morgan",
      parent: "WB-parent",
      addLabels: ["keep"],
      removeLabels: ["missing"],
    }),
    {},
  );
});
