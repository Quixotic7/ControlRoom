import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { Store } from "../src/store.js";
import { canonicalProject, walk, hash } from "../src/files.js";
import { migrateProject } from "../src/migrate.js";
import { backup, restore } from "../src/transfer.js";
import { resolveActor } from "../src/client.js";
function fixture(t: test.TestContext) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-migrate-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new Store(root).initialize();
}
test("new data naming and explicit legacy migration preserve every record and local asset", async (t) => {
  const s = fixture(t);
  assert.equal(path.basename(s.dir), ".controlroom");
  const r = await s.create("ticket", { title: "Preserve me" }, "Custom prose", {
    name: "You",
    kind: "human",
  });
  fs.writeFileSync(s.file("assets/local.bin"), Buffer.from([1, 2, 3]));
  fs.writeFileSync(s.file(".local/preferences.json"), '{"density":"compact"}');
  const before = walk(s.dir).map((f) => [
    path.relative(s.dir, f),
    hash(fs.readFileSync(f)),
  ]);
  const legacy = path.join(s.root, ".workboard");
  fs.renameSync(s.dir, legacy);
  assert.equal(new Store(s.root).dir, legacy);
  assert.equal(canonicalProject(path.join(legacy, "records")), s.root);
  assert.equal(migrateProject(s.root).migrated, true);
  const after = new Store(s.root).initialize();
  for (const [file, digest] of before)
    assert.equal(hash(fs.readFileSync(after.file(file))), digest);
  assert.equal(after.get(r.meta.id).revision, r.revision);
  assert.equal(migrateProject(s.root).migrated, false);
  assert.equal(fs.existsSync(legacy), false);
});
test("migration refuses running, ambiguous and old-runtime installations without moving data", (t) => {
  const s = fixture(t),
    legacy = path.join(s.root, ".workboard");
  fs.renameSync(s.dir, legacy);
  const lock = path.join(legacy, ".local/service.lock");
  fs.writeFileSync(lock, String(process.pid));
  assert.throws(() => migrateProject(s.root), /Stop the project service/);
  fs.unlinkSync(lock);
  fs.writeFileSync(path.join(legacy, "workboard"), "old runtime");
  assert.throws(() => migrateProject(s.root), /Upgrade this installation/);
  fs.mkdirSync(s.dir);
  assert.throws(() => new Store(s.root), /Both .controlroom and .workboard/);
  assert.ok(fs.existsSync(path.join(legacy, "config.yml")));
});
test("new exports restore and legacy exports remain compatible", async (t) => {
  const s = fixture(t),
    dest = fixture(t),
    oldDest = fixture(t);
  await s.create("ticket", { title: "Export compatibility" }, "Keep this", {
    name: "You",
    kind: "human",
  });
  const bytes = await backup(s);
  const pack = JSON.parse(gunzipSync(bytes).toString());
  assert.equal(pack.format, "controlroom-backup");
  await restore(dest, bytes);
  pack.format = "workboard-backup";
  await restore(oldDest, gzipSync(JSON.stringify(pack)));
  assert.equal(dest.list()[0].body, "Keep this");
  assert.equal(oldDest.list()[0].body, "Keep this");
});
test("ControlRoom identity variables take precedence over compatibility aliases", (t) => {
  const values = {
    CONTROLROOM_ACTOR: "New Agent",
    CONTROLROOM_ACTOR_KIND: "agent",
    WORKBOARD_ACTOR: "Old Agent",
  };
  const before = Object.fromEntries(
    Object.keys(values).map((k) => [k, process.env[k]]),
  );
  t.after(() => {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  Object.assign(process.env, values);
  assert.deepEqual(resolveActor({}).actor, {
    name: "New Agent",
    kind: "agent",
  });
});
