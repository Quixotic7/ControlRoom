import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { Store } from "../src/store.js";
import { buildServer } from "../src/server.js";
import {
  parseReviewMedia,
  readReviewMedia,
} from "../src/review-media-input.js";
const run = promisify(execFile),
  loader = path.resolve("node_modules/tsx/dist/loader.mjs"),
  cli = path.resolve("src/cli.ts");
const actor = { name: "Media test agent", kind: "agent" as const },
  human = { name: "Fixture owner", kind: "human" as const };
const env = {
  ...process.env,
  CONTROLROOM_ACTOR: actor.name,
  CONTROLROOM_ACTOR_KIND: "agent",
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VZsAAAAASUVORK5CYII=",
  "base64",
);
function wav() {
  const b = Buffer.alloc(44 + 1600);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(1600, 40);
  return b;
}
function fixture(t: test.TestContext) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-media-cli-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
async function setup(t: test.TestContext) {
  const root = fixture(t),
    s = new Store(root).initialize(),
    code = path.join(root, "code");
  fs.mkdirSync(code);
  fs.writeFileSync(path.join(code, "shot.png"), png);
  fs.writeFileSync(path.join(code, "clip.wav"), wav());
  const app = await buildServer(s),
    url = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
  fs.writeFileSync(
    s.file(".local/service.json"),
    JSON.stringify({ url, pid: process.pid }),
  );
  const ticket = await s.create(
    "ticket",
    { title: "Review media", scopeApproved: true, status: "progress" },
    "",
    human,
  );
  const command = async (args: string[]) =>
    JSON.parse(
      (
        await run(
          process.execPath,
          [
            "--import",
            loader,
            cli,
            "--project",
            root,
            "--no-start",
            ...args,
            "--json",
          ],
          { cwd: code, env, timeout: 15000 },
        )
      ).stdout,
    );
  return { s, code, ticket, command };
}

test("media input resolves captions and bounds files without reading unsupported content", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "a.png"), png);
  fs.writeFileSync(path.join(root, "colon:name.png"), png);
  assert.deepEqual(parseReviewMedia("a.png:before: after", root), {
    path: "a.png",
    caption: "before: after",
  });
  assert.deepEqual(parseReviewMedia("colon:name.png", root), {
    path: "colon:name.png",
  });
  assert.equal(
    readReviewMedia([{ path: "a.png", caption: "meter" }], root)[0].name,
    "a.png",
  );
  assert.throws(() => readReviewMedia([{ path: "bad.svg" }], root), /PNG, WAV/);
  const f = fs.openSync(path.join(root, "large.wav"), "w");
  fs.ftruncateSync(f, 10 * 1024 * 1024 + 1);
  fs.closeSync(f);
  assert.throws(() => readReviewMedia([{ path: "large.wav" }], root), /10 MB/);
  assert.throws(
    () => readReviewMedia(Array(9).fill({ path: "a.png" }), root),
    /8 review/,
  );
});

test("CLI attaches repeated review media, lists it and detaches with revision guards", async (t) => {
  const { s, ticket, command } = await setup(t);
  let r = await command([
    "review",
    "0",
    "--etag",
    ticket.revision,
    "--handoff",
    "Visual and sound example",
    "--evidence",
    "Isolated sample media checked",
    "--media",
    "shot.png:meters while held",
    "--media",
    "clip.wav:short audio",
  ]);
  assert.equal(r.meta.status, "review");
  assert.deepEqual(
    r.meta.media.map((m: any) => [m.kind, m.caption, m.actor]),
    [
      ["image", "meters while held", actor],
      ["audio", "short audio", actor],
    ],
  );
  const shown = await command(["show", "0"]),
    context = await command(["context", "0"]);
  assert.equal(shown.meta.media.length, 2);
  assert.equal(context.ticket.meta.media[1].name, "clip.wav");
  const before = r.revision;
  await assert.rejects(
    command(["attach", "0", "--etag", ticket.revision, "--file", "shot.png"]),
    /changed|conflict/i,
  );
  assert.equal(s.get("0").revision, before);
  r = await command([
    "attach",
    "0",
    "--etag",
    r.revision,
    "--file",
    "shot.png",
    "--caption",
    "a later capture",
  ]);
  assert.equal(r.meta.media.length, 3);
  const removed = r.meta.media[1].id;
  r = await command(["detach", "0", "--etag", r.revision, "--media", removed]);
  assert.equal(r.meta.media.length, 2);
  assert.ok(!r.meta.media.some((m: any) => m.id === removed));
  assert.ok(fs.existsSync(s.file(`records/attachments/${removed}.json`)));
});

test("MCP review and attach/detach transport media from the execution checkout", async (t) => {
  const { s, code, ticket } = await setup(t);
  const child = spawn(
    process.execPath,
    ["--import", loader, cli, "--project", s.root, "--no-start", "mcp"],
    { cwd: code, env },
  );
  let buffer = "",
    sequence = 0;
  const replies = new Map<number, any>();
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const reply = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      replies.set(reply.id, reply);
    }
  });
  const exited = new Promise((resolve) => child.on("close", resolve));
  t.after(async () => {
    child.kill();
    await exited;
  });
  const call = async (name: string, args: object) => {
    const id = ++sequence;
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      }) + "\n",
    );
    for (let i = 0; i < 250 && !replies.has(id); i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(replies.has(id), "MCP response received");
    const r = replies.get(id);
    assert.equal(r.result.isError, undefined, r.result.content?.[0]?.text);
    return JSON.parse(r.result.content[0].text);
  };
  let r = await call("submit_review", {
    id: "0",
    etag: ticket.revision,
    handoff: "MCP samples",
    evidence: "Isolated sample media checked",
    media: [{ path: "shot.png", caption: "MCP meter" }],
  });
  assert.equal(r.meta.media[0].caption, "MCP meter");
  r = await call("attach_media", {
    id: "0",
    etag: r.revision,
    file: "clip.wav",
    caption: "MCP audio",
  });
  assert.equal(r.meta.media.length, 2);
  r = await call("detach_media", {
    id: "0",
    etag: r.revision,
    media_id: r.meta.media[0].id,
  });
  assert.equal(r.meta.media.length, 1);
  assert.equal(r.meta.media[0].kind, "audio");
  assert.deepEqual(r.meta.media[0].actor, actor);
});

test("media flags cannot be silently ignored by unrelated CLI commands", async (t) => {
  const root = fixture(t);
  for (const args of [
    ["show", "0", "--media", "shot.png"],
    ["review", "0", "--caption", "caption"],
    ["detach", "0", "--media", "a", "--media", "b"],
  ])
    await assert.rejects(
      run(
        process.execPath,
        ["--import", loader, cli, "--project", root, ...args],
        { cwd: root, env },
      ),
      /supported|exactly one/,
    );
  assert.equal(fs.existsSync(path.join(root, ".controlroom")), false);
});
