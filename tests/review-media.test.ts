import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { buildServer } from "../src/server.js";
import { backup, restore } from "../src/transfer.js";
import type { Actor, ReviewMediaInput } from "../src/types.js";

const human: Actor = { name: "Reviewer", kind: "human" };
const agent: Actor = { name: "Worker", kind: "agent" };
const otherAgent: Actor = { name: "Other worker", kind: "agent" };
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";

function wav() {
  const bytes = Buffer.alloc(48);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(4, 40);
  bytes.writeInt16LE(100, 44);
  bytes.writeInt16LE(-100, 46);
  return bytes;
}
function box(type: string, content = Buffer.alloc(0)) {
  const result = Buffer.alloc(8 + content.length);
  result.writeUInt32BE(result.length, 0);
  result.write(type, 4);
  content.copy(result, 8);
  return result;
}
function m4a() {
  return Buffer.concat([
    box("ftyp", Buffer.from("M4A \u0000\u0000\u0000\u0000M4A ", "binary")),
    box("moov"),
    box("mdat", Buffer.from([1, 2, 3, 4])),
  ]);
}
function aac() {
  return Buffer.from([0xff, 0xf1, 0x50, 0x80, 0x01, 0x1f, 0xfc, 0]);
}
const input = (
  name: string,
  bytes: Buffer,
  caption?: string,
): ReviewMediaInput => ({
  name,
  data: bytes.toString("base64"),
  ...(caption ? { caption } : {}),
});
function fixture(t: test.TestContext) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-review-media-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new Store(root, true).initialize("Review media fixture");
}
async function ticket(store: Store, title = "Media review") {
  return store.create(
    "ticket",
    { title, scopeApproved: true },
    "Review the attached evidence.",
    human,
  );
}

test("attaches attributed image and audio media without exposing audio as a screenshot", async (t) => {
  const store = fixture(t);
  let record = await ticket(store);
  record = await store.attachReviewMedia(
    record.meta.id,
    record.revision,
    [
      { name: "screen.png", data: png, caption: "Visible result" },
      input("sample.wav", wav(), "Audible result"),
      input("sample.m4a", m4a()),
      input("sample.aac", aac()),
    ],
    agent,
  );
  assert.deepEqual(
    record.meta.media?.map((item) => item.kind),
    ["image", "audio", "audio", "audio"],
  );
  assert.ok(record.meta.media?.every((item) => item.actor.name === agent.name));
  assert.equal(store.attachments().length, 1);
  assert.equal(store.reviewMediaAssets().length, 3);
  assert.equal(store.state().attachments.length, 1);
  await assert.rejects(
    async () => store.attachment(record.meta.media![1].id),
    /Screenshot .* not found/,
  );
  const context = store.context(record.meta.id);
  assert.equal(context.media.length, 4);
  assert.equal(context.attachments.length, 1);
  assert.equal(context.attachments[0].id, record.meta.media?.[0].id);
  assert.ok(context.media.every((item) => !item.missing));
  assert.match(
    store.contextMarkdown(record.meta.id).markdown,
    /## Review media/,
  );

  const detached = await store.detachReviewMedia(
    record.meta.id,
    record.revision,
    record.meta.media![1].id,
    agent,
  );
  assert.equal(detached.meta.media?.length, 3);
  assert.ok(
    fs.existsSync(store.file(`assets/${record.meta.media![1].id}/base`)),
  );
});

test("rejects malformed, mismatched, oversized and forged media without partial files", async (t) => {
  const store = fixture(t);
  const record = await ticket(store);
  const beforeFiles = fs.readdirSync(store.file("records/attachments"));
  for (const file of [
    input("short.wav", Buffer.from("RIFF1234WAVE")),
    input(
      "video.m4a",
      Buffer.concat([
        box("ftyp", Buffer.from("mp42\0\0\0\0mp42")),
        box("moov"),
        box("mdat", Buffer.from([1])),
      ]),
    ),
    input("short.aac", Buffer.from([0xff, 0xf1])),
    input("renamed.png", wav()),
    input("../escape.wav", wav()),
  ])
    await assert.rejects(
      store.attachReviewMedia(record.meta.id, record.revision, [file], agent),
      /valid signature|filename|must use/i,
    );
  await assert.rejects(
    store.attachReviewMedia(
      record.meta.id,
      record.revision,
      [
        input("valid.wav", wav()),
        input("bad.wav", Buffer.from("RIFF1234WAVE")),
      ],
      agent,
    ),
    /valid signature/i,
  );
  assert.deepEqual(
    fs.readdirSync(store.file("records/attachments")),
    beforeFiles,
  );
  assert.equal(fs.readdirSync(store.file("assets")).length, 0);
  await assert.rejects(
    store.attachReviewMedia(
      record.meta.id,
      record.revision,
      Array.from({ length: 9 }, (_, index) =>
        input(`sample-${index}.wav`, wav()),
      ),
      agent,
    ),
    /at most 8|too_big/i,
  );
  const withoutMedia = await ticket(store, "No media review");
  const submittedWithoutMedia = await store.review(
    withoutMedia.meta.id,
    withoutMedia.revision,
    "Handoff",
    "Evidence",
    "",
    agent,
  );
  assert.equal(submittedWithoutMedia.meta.media, undefined);
  await assert.rejects(
    store.attachReviewMedia(
      record.meta.id,
      record.revision,
      [input("huge.wav", Buffer.alloc(10 * 1024 * 1024 + 1))],
      agent,
    ),
    /too large/i,
  );
  await assert.rejects(
    store.update(
      record.meta.id,
      record.revision,
      { media: [] },
      undefined,
      agent,
    ),
    /service-owned/i,
  );
  await assert.rejects(
    store.create("ticket", { title: "Forged", media: [] }, "", agent),
    /service-owned/i,
  );
});

test("review media is atomic with review, revision, scope and claim guards", async (t) => {
  const store = fixture(t);
  let record = await ticket(store);
  await assert.rejects(
    store.review(record.meta.id, "stale", "Handoff", "Evidence", "", agent, {
      media: [input("sample.wav", wav())],
    }),
    /changed/i,
  );
  assert.equal(store.get(record.meta.id).meta.media, undefined);
  assert.equal(fs.readdirSync(store.file("assets")).length, 0);
  await store.claim(record.meta.id, otherAgent, store.root, false);
  await assert.rejects(
    store.attachReviewMedia(
      record.meta.id,
      record.revision,
      [input("sample.wav", wav())],
      agent,
    ),
    /different live claim/i,
  );
  await store.claim(record.meta.id, otherAgent, store.root, true);
  record = await store.review(
    record.meta.id,
    record.revision,
    "Handoff",
    "Evidence",
    "",
    agent,
    { media: [input("sample.wav", wav())] },
  );
  assert.equal(record.meta.media?.length, 1);
  assert.equal(
    store.config().columns.find((column) => column.id === record.meta.status)
      ?.role,
    "review",
  );
  assert.ok(
    store
      .historyFor(record.meta.id)
      .some((event) => (event.after as any)?.meta?.media?.length === 1),
  );
  await assert.rejects(
    store.review(record.meta.id, record.revision, "H", "E", "", agent, {
      media: null as never,
    }),
    /array/i,
  );
});

test("merge context and backup preserve media provenance and bytes", async (t) => {
  const store = fixture(t);
  let survivor = await ticket(store, "Survivor"),
    source = await ticket(store, "Source");
  source = await store.attachReviewMedia(
    source.meta.id,
    source.revision,
    [input("source.wav", wav(), "From source")],
    agent,
  );
  const preview = store.mergePreview(survivor.meta.id, source.meta.id);
  await store.merge(
    survivor.meta.id,
    {
      source: source.meta.id,
      requestId: "media-merge-request",
      revisions: preview.affected,
      resolutions: Object.fromEntries(
        Object.keys(preview.conflicts).map((key) => [key, "survivor"]),
      ),
    },
    human,
  );
  survivor = store.get(survivor.meta.id);
  const context = store.context(survivor.meta.id);
  assert.equal(context.media[0].source.id, source.meta.id);
  assert.equal(context.media[0].caption, "From source");

  const restored = fixture(t);
  await restore(restored, await backup(store));
  const restoredContext = restored.context(survivor.meta.id);
  assert.equal(restoredContext.media[0].missing, false);
  assert.deepEqual(
    fs.readFileSync(restored.file(`assets/${source.meta.media![0].id}/base`)),
    wav(),
  );
});

test("media HTTP endpoints attach, detach and serve byte ranges", async (t) => {
  const store = fixture(t),
    app = await buildServer(store),
    record = await ticket(store);
  t.after(() => app.close());
  const headers = {
    host: "127.0.0.1",
    origin: "http://127.0.0.1",
    authorization: `Bearer ${store.token()}`,
  };
  const attached = await app.inject({
    method: "POST",
    url: `/api/records/${record.meta.id}/media`,
    headers,
    payload: {
      revision: record.revision,
      actor: agent,
      files: [input("sample.wav", wav(), "Listen")],
    },
  });
  assert.equal(attached.statusCode, 200, attached.body);
  const updated = attached.json(),
    mediaId = updated.meta.media[0].id;
  const partial = await app.inject({
    method: "GET",
    url: `/api/media/${mediaId}/base`,
    headers: { ...headers, range: "bytes=4-11" },
  });
  assert.equal(partial.statusCode, 206);
  assert.equal(partial.headers["content-range"], `bytes 4-11/${wav().length}`);
  assert.deepEqual(partial.rawPayload, wav().subarray(4, 12));
  const invalidRange = await app.inject({
    method: "GET",
    url: `/api/media/${mediaId}/base`,
    headers: { ...headers, range: "bytes=999-1000" },
  });
  assert.equal(invalidRange.statusCode, 416);
  const detached = await app.inject({
    method: "DELETE",
    url: `/api/records/${record.meta.id}/media/${mediaId}`,
    headers,
    payload: { revision: updated.revision, actor: agent },
  });
  assert.equal(detached.statusCode, 200, detached.body);
  assert.deepEqual(detached.json().meta.media, []);
});

test("interrupted media transaction rolls back binary files", (t) => {
  const store = fixture(t),
    bytes = wav(),
    asset = "assets/audio-deadbeef/base",
    historyPath = "records/history.jsonl",
    historyBefore = fs.existsSync(store.file(historyPath))
      ? fs.readFileSync(store.file(historyPath), "utf8")
      : "";
  fs.mkdirSync(path.dirname(store.file(asset)), { recursive: true });
  fs.writeFileSync(store.file(asset), bytes);
  fs.writeFileSync(
    store.file(".local/record-transaction.json"),
    JSON.stringify({
      schema: 1,
      files: [
        {
          path: asset,
          before: "",
          after: bytes.toString("base64"),
          existed: false,
          encoding: "base64",
        },
        {
          path: historyPath,
          before: historyBefore,
          after: historyBefore + "pending\n",
          existed: fs.existsSync(store.file(historyPath)),
        },
      ],
    }),
  );
  new Store(store.root, true).initialize();
  assert.equal(fs.existsSync(store.file(asset)), false);
  assert.equal(
    fs.existsSync(store.file(".local/record-transaction.json")),
    false,
  );
});
