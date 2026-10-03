import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Store } from "../src/store.js";
import { boardSnapshot } from "../src/boardSnapshot.js";
import { parseArgs, parseSet } from "../src/client.js";
import { buildServer } from "../src/server.js";
import type { Actor } from "../src/types.js";

const human: Actor = { name: "Owner", kind: "human" };
const agent: Actor = { name: "Builder", kind: "agent" };
const run = promisify(execFile);
const cli = path.resolve("src/cli.ts");
const loader = path.resolve("node_modules/tsx/dist/loader.mjs");

function fixture(t: test.TestContext) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-review-build-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new Store(root).initialize("Review build fixture");
}

test("ticket build updates are attributed, replaceable, historical and clearable", async (t) => {
  const store = fixture(t);
  let ticket = await store.create(
    "ticket",
    { title: "Preview", scopeApproved: true },
    "",
    human,
  );
  const before = Date.now();
  ticket = await store.update(
    ticket.meta.id,
    ticket.revision,
    { build: " dist/Preview.app " },
    undefined,
    agent,
  );
  assert.deepEqual(ticket.meta.build?.actor, agent);
  assert.equal(ticket.meta.build?.path, "dist/Preview.app");
  assert.ok(Date.parse(ticket.meta.build!.at) >= before);

  ticket = await store.update(
    ticket.meta.id,
    ticket.revision,
    {
      build: {
        path: "/tmp/Preview 2.app",
        label: "QA Preview",
        sha: "abc123",
      },
    },
    undefined,
    human,
  );
  assert.equal(ticket.meta.build?.label, "QA Preview");
  assert.equal(ticket.meta.build?.sha, "abc123");
  const stampedBuild = structuredClone(ticket.meta.build);
  ticket = await store.update(
    ticket.meta.id,
    ticket.revision,
    { build: stampedBuild, title: "Preview with unchanged build" },
    undefined,
    human,
  );
  assert.deepEqual(ticket.meta.build, stampedBuild);
  const replaced = store
    .historyFor(ticket.meta.id)
    .find(
      (entry) =>
        (entry.after as any)?.meta?.build?.sha === "abc123" &&
        (entry.before as any)?.meta?.build?.path === "dist/Preview.app",
    );
  assert.equal(
    (replaced?.before as any)?.meta?.build?.path,
    "dist/Preview.app",
  );

  ticket = await store.update(
    ticket.meta.id,
    ticket.revision,
    { build: "", title: "Preview after clear" },
    "Replacement body survives clearing the build.\n",
    agent,
  );
  assert.equal(ticket.meta.build, undefined);
  assert.equal(ticket.meta.title, "Preview after clear");
  assert.equal(ticket.body, "Replacement body survives clearing the build.\n");
  const freshAfterClear = new Store(store.root).get(ticket.meta.id);
  assert.equal(freshAfterClear.meta.build, undefined);
  assert.equal(freshAfterClear.meta.title, "Preview after clear");
  assert.equal(
    freshAfterClear.body,
    "Replacement body survives clearing the build.\n",
  );
  ticket = await store.update(
    ticket.meta.id,
    ticket.revision,
    { build: "dist/Preview 3.app" },
    undefined,
    agent,
  );
  ticket = await store.update(
    ticket.meta.id,
    ticket.revision,
    { build: null },
    undefined,
    agent,
  );
  assert.equal(ticket.meta.build, undefined);
});

test("build validation rejects nonlocal paths, forged attribution and non-ticket metadata", async (t) => {
  const store = fixture(t);
  const ticket = await store.create("ticket", { title: "Preview" }, "", human);
  for (const build of ["   ", "https://example.com/build.app", "bad\0path"])
    await assert.rejects(
      store.update(
        ticket.meta.id,
        ticket.revision,
        { build },
        undefined,
        agent,
      ),
      /Build|path|local|NUL|too_small/i,
    );
  await assert.rejects(
    store.update(
      ticket.meta.id,
      ticket.revision,
      {
        build: {
          path: "dist/Forged.app",
          at: "2020-01-01T00:00:00.000Z",
          actor: human,
        },
      },
      undefined,
      agent,
    ),
    /recorded by Control Room/,
  );
  await assert.rejects(
    store.create(
      "decision",
      { title: "Not a build ticket", build: "dist/No.app" },
      "",
      human,
    ),
    /Only tickets/,
  );
});

test("review, context, snapshot and CLI inputs carry the current build", async (t) => {
  const store = fixture(t);
  let ticket = await store.create(
    "ticket",
    { title: "Review preview", scopeApproved: true, status: "progress" },
    "",
    human,
  );
  ticket = await store.review(
    ticket.meta.id,
    ticket.revision,
    "Ready",
    "Checked",
    "",
    agent,
    {
      build: {
        path: "dist/Review.app",
        label: "Review build",
        sha: "def456",
      },
    },
  );
  assert.equal(store.context(ticket.meta.id).ticket.meta.build?.sha, "def456");
  assert.match(
    store.contextMarkdown(ticket.meta.id).markdown,
    /Build under review/,
  );
  assert.equal(
    boardSnapshot(store.state()).tickets[0].build?.path,
    "dist/Review.app",
  );

  const parsed = parseArgs([
    "review",
    "0",
    "--build",
    "dist/Review.app",
    "--build-label",
    "Review build",
    "--build-sha=def456",
  ]);
  assert.equal(parsed.option("build"), "dist/Review.app");
  assert.equal(parsed.option("build-label"), "Review build");
  assert.equal(parsed.option("build-sha"), "def456");
  assert.equal(parseSet(["build=dist/Later.app"]).build, "dist/Later.app");
  assert.equal(parseSet(["build="]).build, "");
  assert.equal(parseSet(["build=null"]).build, null);
});

test("CLI review and update transport build metadata through the live service", async (t) => {
  const store = fixture(t);
  const app = await buildServer(store),
    url = await app.listen({ host: "127.0.0.1", port: 0 });
  fs.writeFileSync(
    store.file(".local/service.json"),
    JSON.stringify({ url, pid: process.pid }),
  );
  t.after(() => app.close());
  let ticket = await store.create(
    "ticket",
    { title: "CLI preview", scopeApproved: true, status: "progress" },
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
            store.root,
            "--agent",
            "--actor",
            agent.name,
            "--no-start",
            ...args,
            "--json",
          ],
          { cwd: store.root, timeout: 15_000 },
        )
      ).stdout,
    );
  ticket = await command([
    "review",
    String(ticket.meta.number),
    "--etag",
    ticket.revision,
    "--handoff",
    "Build is ready",
    "--evidence",
    "Build output inspected",
    "--build",
    "dist/CLI Preview.app",
    "--build-label",
    "CLI Preview",
    "--build-sha",
    "123abc",
  ]);
  assert.equal(ticket.meta.build?.path, "dist/CLI Preview.app");
  assert.deepEqual(ticket.meta.build?.actor, agent);

  ticket = await command([
    "update",
    String(ticket.meta.number),
    "--etag",
    ticket.revision,
    "--set",
    "build=dist/CLI Preview 2.app",
  ]);
  const context = await command(["context", String(ticket.meta.number)]),
    snapshot = await command(["snapshot"]),
    fresh = new Store(store.root).get(ticket.meta.id);
  assert.equal(context.ticket.meta.build.path, "dist/CLI Preview 2.app");
  assert.equal(snapshot.tickets[0].build.path, "dist/CLI Preview 2.app");
  assert.equal(fresh.meta.build?.path, "dist/CLI Preview 2.app");

  await command([
    "update",
    String(ticket.meta.number),
    "--etag",
    ticket.revision,
    "--set",
    "build=",
  ]);
  assert.equal(new Store(store.root).get(ticket.meta.id).meta.build, undefined);
});

test("CLI rejects review-only build flags before initializing a project", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cr-build-args-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(
    run(
      process.execPath,
      [
        "--import",
        loader,
        cli,
        "--project",
        root,
        "show",
        "0",
        "--build",
        "dist/No.app",
      ],
      { cwd: root, timeout: 15_000 },
    ),
    /only supported by review/,
  );
  assert.equal(fs.existsSync(path.join(root, ".controlroom")), false);
});
