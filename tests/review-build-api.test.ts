import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { buildServer } from "../src/server.js";

const human = { name: "Build reviewer", kind: "human" as const };
async function fixture(
  t: test.TestContext,
  lan = false,
  platform: NodeJS.Platform = "darwin",
) {
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-review-build-api-")),
  );
  const root = path.join(base, "board");
  fs.mkdirSync(root);
  const store = new Store(root).initialize();
  fs.writeFileSync(
    store.file(".local/network.json"),
    JSON.stringify({ enabled: lan, requirePairing: false, sessionHours: 8 }),
  );
  const calls: string[][] = [];
  const app = await buildServer(store, {
    lan,
    addresses: () => ["192.168.44.2"],
    buildOpener: {
      platform,
      open: async (args) => {
        calls.push(args);
      },
    },
  });
  const headers = {
    host: "127.0.0.1",
    origin: "http://127.0.0.1",
    authorization: `Bearer ${store.token()}`,
  };
  t.after(async () => {
    await app.close();
    fs.rmSync(base, { recursive: true, force: true });
  });
  const create = (file: string) =>
    store.create(
      "ticket",
      { title: "Build fixture", build: { path: file } },
      "",
      human,
    );
  const post = (
    id: string,
    revision: string,
    action = "launch",
    extra: object = {},
  ) =>
    app.inject({
      method: "POST",
      url: `/api/records/${id}/build/${action}`,
      headers,
      payload: { actor: human, revision, ...extra },
    });
  return { base, root, store, app, headers, calls, create, post };
}

test("human launch/reveal use one checked absolute filename and reject stale builds or path overrides", async (t) => {
  const f = await fixture(t),
    filename = "Preview $(touch nope) --args.app";
  fs.mkdirSync(path.join(f.root, filename));
  const ticket = await f.create(filename),
    url = `/api/records/${ticket.meta.id}/build`;
  const status = await f.app.inject({ url, headers: f.headers });
  assert.equal(status.json().available, true);
  assert.equal(status.json().resolvedPath, path.join(f.root, filename));
  assert.equal((await f.post(ticket.meta.id, ticket.revision)).statusCode, 200);
  assert.equal(
    (await f.post(ticket.meta.id, ticket.revision, "reveal")).statusCode,
    200,
  );
  assert.deepEqual(f.calls, [
    [path.join(f.root, filename)],
    ["-R", path.join(f.root, filename)],
  ]);
  assert.equal(
    (
      await f.post(ticket.meta.id, ticket.revision, "launch", {
        path: "/Applications/Other.app",
      })
    ).statusCode,
    422,
  );
  await f.store.update(
    ticket.meta.id,
    ticket.revision,
    { build: { path: "replacement.app" } },
    undefined,
    human,
  );
  assert.equal((await f.post(ticket.meta.id, ticket.revision)).statusCode, 409);
  assert.equal(f.calls.length, 2);
});

test("launch requires authenticated same-origin human loopback access; LAN binding disables even local requests", async (t) => {
  for (const lan of [false, true]) {
    const f = await fixture(t, lan);
    fs.writeFileSync(path.join(f.root, "build.txt"), "fixture");
    const ticket = await f.create("build.txt"),
      url = `/api/records/${ticket.meta.id}/build/launch`,
      payload = { actor: human, revision: ticket.revision };
    assert.equal(
      (
        await f.post(ticket.meta.id, ticket.revision, "launch", {
          actor: { name: "Worker", kind: "agent" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url,
          headers: { host: "127.0.0.1" },
          payload,
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url,
          headers: { ...f.headers, origin: "http://evil.example" },
          payload,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url,
          headers: {
            host: "127.0.0.1",
            authorization: f.headers.authorization,
          },
          payload,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url,
          headers: f.headers,
          remoteAddress: "192.168.44.3",
          payload,
        })
      ).statusCode,
      403,
    );
    if (lan) {
      const availability = await f.app.inject({
        url: `/api/records/${ticket.meta.id}/build`,
        headers: f.headers,
      });
      assert.equal(availability.json().available, false);
      assert.match(availability.json().reason, /LAN mode/);
      assert.equal(
        (await f.post(ticket.meta.id, ticket.revision)).statusCode,
        403,
      );
      assert.equal(
        (
          await f.app.inject({
            method: "POST",
            url,
            headers: { host: "192.168.44.2", origin: "http://192.168.44.2" },
            remoteAddress: "192.168.44.3",
            payload,
          })
        ).statusCode,
        403,
      );
    }
    assert.equal(f.calls.length, 0);
  }
});

test("missing, outside-root, symlink-escape and unsupported platform builds cannot launch", async (t) => {
  const f = await fixture(t),
    external = path.join(f.base, "outside.txt");
  fs.writeFileSync(external, "outside");
  fs.symlinkSync(external, path.join(f.root, "escape.txt"));
  for (const [filename, code, reason] of [
    ["missing.app", 404, /Build not found at/],
    [external, 403, /inside this project/],
    ["escape.txt", 403, /resolves outside/],
  ] as const) {
    const ticket = await f.create(filename),
      result = await f.post(ticket.meta.id, ticket.revision);
    assert.equal(result.statusCode, code, result.body);
    assert.match(result.json().error, reason);
  }
  assert.equal(f.calls.length, 0);
  const linux = await fixture(t, false, "linux"),
    ticket = await linux.create("missing.app");
  assert.match(
    (await linux.post(ticket.meta.id, ticket.revision)).json().error,
    /macOS only/,
  );
  assert.equal(linux.calls.length, 0);
});

test("configured code repositories are allowed and native opener failures are visible", async (t) => {
  const f = await fixture(t),
    repo = path.join(f.base, "code");
  fs.mkdirSync(repo);
  const file = path.join(repo, "build.txt");
  fs.writeFileSync(file, "fixture");
  await f.store.updateConfig(
    f.store.configRevision(),
    { orchestration: { repository: repo } },
    human,
  );
  const ticket = await f.create(file);
  assert.equal((await f.post(ticket.meta.id, ticket.revision)).statusCode, 200);
  const failed = await buildServer(f.store, {
    buildOpener: {
      platform: "darwin",
      open: async () => {
        throw Error("native opener refused");
      },
    },
  });
  t.after(() => failed.close());
  const result = await failed.inject({
    method: "POST",
    url: `/api/records/${ticket.meta.id}/build/launch`,
    headers: f.headers,
    payload: { actor: human, revision: ticket.revision },
  });
  assert.equal(result.statusCode, 422);
  assert.match(result.json().error, /macOS could not launch/);
});
