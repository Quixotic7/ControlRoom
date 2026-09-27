import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { buildServer } from "../src/server.js";
import { addImage } from "../src/media.js";
function fixture(t: test.TestContext) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-session-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new Store(root).initialize();
}
test("two project sessions coexist on one host without overwriting each other", async (t) => {
  const a = fixture(t),
    b = fixture(t);
  const aa = await buildServer(a),
    bb = await buildServer(b);
  t.after(() => aa.close());
  t.after(() => bb.close());
  const rootA = await aa.inject({
    url: "/",
    headers: { host: "127.0.0.1:4173" },
  });
  const rootB = await bb.inject({
    url: "/",
    headers: { host: "127.0.0.1:4280" },
  });
  const ca = String(rootA.headers["set-cookie"]).split(";")[0],
    cb = String(rootB.headers["set-cookie"]).split(";")[0];
  assert.notEqual(ca.split("=")[0], cb.split("=")[0]);
  const cookies = ca + "; " + cb;
  for (const [app, port, s] of [
    [aa, 4173, a],
    [bb, 4280, b],
  ] as const) {
    const r = await app.inject({
      url: "/api/state",
      headers: { host: `127.0.0.1:${port}`, cookie: cookies },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().config.projectId, s.config().projectId);
  }
  const rejected = await aa.inject({
    url: "/api/state",
    headers: { host: "127.0.0.1:4173", cookie: cb },
  });
  assert.equal(rejected.statusCode, 401);
});
test("screenshots referenced only in a conversation are included in agent context", async (t) => {
  const s = fixture(t);
  const actor = { name: "Reviewer", kind: "human" as const };
  const r = await s.create(
    "ticket",
    { title: "Conversation images" },
    "",
    actor,
  );
  const image = await addImage(
    s,
    "Only in comment",
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  );
  await s.comment(
    r.meta.id,
    `[![Screenshot](/api/images/${image.id}/base)](#image=${image.id})`,
    actor,
  );
  assert.equal(s.get(r.meta.id).meta.attachments, undefined);
  assert.deepEqual(
    s.context(r.meta.id).attachments.map((a) => a.id),
    [image.id],
  );
  await s.comment(
    r.meta.id,
    "A missing reference #image=image-unavailable",
    actor,
  );
  assert.equal(s.context(r.meta.id).attachments.length, 1);
});
