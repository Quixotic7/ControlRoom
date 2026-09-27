import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import {
  activateCapture,
  captureRoot,
  registerCapture,
} from "../src/capture.js";
test("background project registration cannot take capture away from the last interacted project", async (t) => {
  const roots = [0, 1].map(() =>
    fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "cr-capture-routing-")),
    ),
  );
  const [a, b] = roots.map((root) => new Store(root).initialize());
  const files = [a, b].map((s) =>
    path.join(captureRoot, `${s.config().projectId}.json`),
  );
  t.after(() => {
    for (const f of files) fs.rmSync(f, { force: true });
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  });
  const readActive = (index: number) =>
    JSON.parse(fs.readFileSync(files[index], "utf8")).activeAt;
  activateCapture(a, 4101);
  registerCapture(b, 4102);
  assert.ok(readActive(0) > readActive(1));
  await new Promise((resolve) => setTimeout(resolve, 5));
  activateCapture(b, 4102);
  assert.ok(readActive(1) > readActive(0));
  const selected = readActive(1);
  registerCapture(a, 4101);
  registerCapture(b, 4102);
  assert.equal(readActive(1), selected);
  assert.ok(readActive(1) > readActive(0));
});
