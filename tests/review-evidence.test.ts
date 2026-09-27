import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
test("new review submissions never silently reuse a prior verification pass or manual-check exemption", async (t) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-review-evidence-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const s = new Store(root).initialize();
  const human = { name: "Reviewer", kind: "human" as const },
    agent = { name: "Agent", kind: "agent" as const };
  let r = await s.create(
    "ticket",
    { title: "Review current run", scopeApproved: true, status: "progress" },
    "",
    human,
  );
  const v = {
    command: "npm test",
    exitCode: 0,
    output: "Checks passed",
    at: new Date().toISOString(),
  };
  r = await s.review(
    r.meta.id,
    r.revision,
    "First implementation",
    "Evidence",
    "",
    agent,
    {
      verification: v,
      manualReviewRequired: false,
      reviewInstructions: "No manual checks requested.",
    },
  );
  assert.equal(r.meta.reviewVerificationAt, v.at);
  assert.equal(r.meta.manualReviewRequired, false);
  r = await s.update(
    r.meta.id,
    r.revision,
    { status: "progress" },
    undefined,
    human,
  );
  r = await s.review(
    r.meta.id,
    r.revision,
    "Second implementation",
    "Not run yet",
    "",
    agent,
  );
  assert.equal(r.meta.reviewVerificationAt, "");
  assert.equal(r.meta.verification?.at, v.at);
  assert.equal(r.meta.manualReviewRequired, true);
  assert.equal(r.meta.reviewInstructions, "");
  assert.match(s.comments().at(-1)!.body, /Earlier run \(not linked/);
});
