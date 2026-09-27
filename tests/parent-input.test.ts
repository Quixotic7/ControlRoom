import test from "node:test";
import assert from "node:assert/strict";
import { parentChoices } from "../web/ParentInput.js";
import type { RecordFile } from "../src/types.js";

test("parent search scales past a dropdown, preserves zero, and excludes descendants and cycles", () => {
  const records = Array.from(
    { length: 350 },
    (_, number) =>
      ({
        meta: {
          id: `WB-${number}`,
          number,
          kind: "ticket",
          title: `Task ${number}`,
          status: "backlog",
        },
        body: "",
        path: "",
        revision: "",
      }) as RecordFile,
  );
  records[5].meta.parent = "WB-4";
  records[6].meta.parent = "WB-5";
  records[7].meta.parent = "WB-8";
  records[8].meta.parent = "WB-7";
  records[10].meta.title = records[11].meta.title = "Duplicate title";
  records[10].meta.archived = true;
  for (const query of ["0", "#0"])
    assert.equal(parentChoices(records, "WB-4", query)[0].meta.number, 0);
  for (const query of ["349", "#349", "Task 349"])
    assert.equal(parentChoices(records, "WB-4", query)[0].meta.number, 349);
  const choices = parentChoices(records, "WB-4", "");
  for (const excluded of [4, 5, 6, 7, 8])
    assert.ok(!choices.some((r) => r.meta.number === excluded));
  assert.deepEqual(
    parentChoices(records, "WB-4", "Duplicate").map((r) => r.meta.number),
    [11, 10],
  );
  assert.equal(parentChoices(records, "WB-4", "does not exist").length, 0);
});
