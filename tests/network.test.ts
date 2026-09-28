import http from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Store } from "../src/store.js";
import { buildServer } from "../src/server.js";
import {
  saveNetworkPreference,
  networkPreference,
  networkSettings,
  privateIPv4,
} from "../src/network.js";
const addr = "192.168.44.2";
function fixture(t: test.TestContext) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-lan-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new Store(root).initialize("LAN test");
}
async function server(t: test.TestContext, lan = true) {
  const store = fixture(t);
  saveNetworkPreference(store, lan);
  const app = await buildServer(store, { lan, addresses: () => [addr] });
  t.after(() => app.close());
  return { store, app };
}
const headers = { host: addr, origin: `http://${addr}` };
async function pair(
  app: Awaited<ReturnType<typeof buildServer>>,
  store: Store,
) {
  const code = await app.inject({
    method: "POST",
    url: "/api/network/pairing",
    headers: { host: "127.0.0.1", authorization: "Bearer " + store.token() },
  });
  assert.equal(code.statusCode, 200, code.body);
  const res = await app.inject({
    method: "POST",
    url: "/api/pair",
    headers,
    payload: { code: code.json().code },
  });
  assert.equal(res.statusCode, 200, res.body);
  return String(res.headers["set-cookie"]).split(";")[0];
}
test("LAN is opt-in; remote Host spoofing and unpaired readers receive no project credentials", async (t) => {
  const { store, app } = await server(t, false);
  assert.equal(networkPreference(store), false);
  assert.equal((await app.inject({ url: "/", headers })).statusCode, 403);
  const spoof = await app.inject({
    url: "/",
    headers: { host: "127.0.0.1" },
    remoteAddress: "192.168.44.3",
  });
  assert.equal(spoof.statusCode, 403);
  assert.equal(spoof.headers["set-cookie"], undefined);
});
test("pairing grants separate project/port cookies and blocks host controls and cross-origin requests", async (t) => {
  const { store, app } = await server(t);
  const root = await app.inject({ url: "/", headers });
  assert.equal(root.headers["set-cookie"], undefined);
  assert.ok(!root.body.includes(store.token()));
  for (const url of [
    "/api/state",
    "/api/export",
    "/api/events",
    "/api/images/example/base",
    "/api/%73tate",
    "/health",
  ])
    assert.equal((await app.inject({ url, headers })).statusCode, 401, url);
  assert.equal(
    (
      await app.inject({
        url: "/api/state",
        headers: { ...headers, authorization: "Bearer " + store.token() },
      })
    ).statusCode,
    401,
  );
  const cookie = await pair(app, store);
  assert.ok(!cookie.includes(store.token()));
  assert.match(cookie, /controlroom_lan_/);
  const cookieFlags = (
    await app.inject({ url: "/", headers: { host: "127.0.0.1" } })
  ).headers["set-cookie"];
  assert.match(String(cookieFlags), /HttpOnly; SameSite=Strict/);
  assert.equal(
    (await app.inject({ url: "/api/state", headers: { ...headers, cookie } }))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/state",
        headers: { ...headers, cookie, origin: "http://evil.example" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/state",
        headers: { ...headers, cookie, host: "evil.example" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/state",
        headers: { ...headers, cookie },
        remoteAddress: "8.8.8.8",
      })
    ).statusCode,
    403,
  );
  for (const [method, url, payload] of [
    ["POST", "/api/shutdown", {}],
    ["POST", "/api/active", {}],
    ["GET", "/api/capture/status", undefined],
    ["GET", "/api/documents", undefined],
    ["GET", "/api/network", undefined],
    ["GET", "/api/orchestration", undefined],
    ["PUT", "/api/orchestration/config", {}],
    ["POST", "/api/orchestration/queue", {}],
    ["POST", "/api/restore", {}],
    ["PATCH", "/api/config", {}],
    ["POST", "/api/reconcile", {}],
    ["GET", "/api/import", undefined],
  ] as const) {
    const res = await app.inject({
      method,
      url,
      headers: { ...headers, cookie },
      payload,
    });
    assert.equal(res.statusCode, 403, url);
  }
  const created = await app.inject({
    method: "POST",
    url: "/api/records",
    headers: { ...headers, cookie },
    payload: {
      kind: "ticket",
      meta: { title: "Remote ticket" },
      body: "From another browser",
      actor: { name: "You", kind: "human" },
    },
  });
  assert.equal(created.statusCode, 200, created.body);
  const onDisk = fs.readFileSync(
    store.file(".local/lan-sessions.json"),
    "utf8",
  );
  assert.ok(!onDisk.includes(cookie.split("=")[1]));
  const { app: other } = await server(t);
  assert.equal(
    (await other.inject({ url: "/api/state", headers: { ...headers, cookie } }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/state",
        headers: { host: addr + ":42", origin: `http://${addr}:42`, cookie },
      })
    ).statusCode,
    401,
  );
});
test("pairing codes are one-use, expire, replace safely and rate limit guesses; sessions expire", async (t) => {
  const { store, app } = await server(t);
  const local = { host: "127.0.0.1", authorization: "Bearer " + store.token() };
  const generate = async () =>
    (
      await app.inject({
        method: "POST",
        url: "/api/network/pairing",
        headers: local,
      })
    ).json();
  let old = await generate();
  const fresh = await generate();
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/pair",
        headers,
        payload: { code: old.code },
      })
    ).statusCode,
    401,
  );
  const first = await app.inject({
    method: "POST",
    url: "/api/pair",
    headers,
    payload: { code: fresh.code },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/pair",
        headers,
        payload: { code: fresh.code },
      })
    ).statusCode,
    401,
  );
  old = await generate();
  const clock = Date.now;
  try {
    Date.now = () => clock() + 600001;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/pair",
          headers,
          payload: { code: old.code },
        })
      ).statusCode,
      401,
    );
    Date.now = () => clock() + 28800001;
    assert.equal(
      (
        await app.inject({
          url: "/api/state",
          headers: {
            ...headers,
            cookie: String(first.headers["set-cookie"]).split(";")[0],
          },
        })
      ).statusCode,
      401,
    );
  } finally {
    Date.now = clock;
  }
  for (let i = 0; i < 11; i++)
    await app.inject({
      method: "POST",
      url: "/api/pair",
      headers,
      payload: { code: "wrong" },
      remoteAddress: "192.168.44.90",
    });
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/pair",
        headers,
        payload: { code: "wrong" },
        remoteAddress: "192.168.44.90",
      })
    ).statusCode,
    429,
  );
});
test("disable and revoke invalidate sessions while keeping local tokens and persisted mode independent", async (t) => {
  const { store, app } = await server(t),
    cookie = await pair(app, store),
    local = { host: "127.0.0.1", authorization: "Bearer " + store.token() };
  await app.inject({
    method: "POST",
    url: "/api/network/revoke",
    headers: local,
  });
  assert.equal(
    (await app.inject({ url: "/api/state", headers: { ...headers, cookie } }))
      .statusCode,
    401,
  );
  assert.equal(
    (await app.inject({ url: "/api/state", headers: local })).statusCode,
    200,
  );
  const again = await pair(app, store);
  await app.inject({
    method: "POST",
    url: "/api/network/config",
    headers: local,
    payload: { enabled: false },
  });
  assert.equal(networkPreference(store), false);
  assert.equal(
    (
      await app.inject({
        url: "/api/state",
        headers: { ...headers, cookie: again },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: "/api/state", headers: local })).statusCode,
    200,
  );
});
test("revocation immediately closes an established remote event stream", async (t) => {
  const { store, app } = await server(t);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const port = (app.server.address() as any).port,
    base = `http://127.0.0.1:${port}`,
    remote = { host: `${addr}:${port}`, origin: `http://${addr}:${port}` };
  const code = await (
    await fetch(base + "/api/network/pairing", {
      method: "POST",
      headers: { authorization: "Bearer " + store.token() },
    })
  ).json();
  const res = await app.inject({
    method: "POST",
    url: "/api/pair",
    headers: remote,
    payload: { code: code.code },
  });
  assert.equal(res.statusCode, 200, res.body);
  const cookie = String(res.headers["set-cookie"]).split(";")[0];
  const stream = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/events",
        headers: { ...remote, cookie },
      },
      resolve,
    );
    req.on("error", reject);
    t.after(() => req.destroy());
  });
  assert.equal(stream.statusCode, 200);
  const ended = new Promise<void>((resolve) => stream.on("end", resolve));
  stream.resume();
  const revoked = await fetch(base + "/api/network/revoke", {
    method: "POST",
    headers: { authorization: "Bearer " + store.token() },
  });
  assert.equal(revoked.status, 200);
  await Promise.race([
    ended,
    new Promise<never>((_, reject) => {
      const id = setTimeout(() => reject(Error("Stream remained open")), 1500);
      id.unref();
    }),
  ]);
});
test("private IPv4 matching excludes public and malformed destinations", () => {
  assert.equal(privateIPv4("172.31.1.1"), true);
  assert.equal(privateIPv4("172.32.1.1"), false);
  assert.equal(privateIPv4("192.168.0.999"), false);
});

test("paired sessions survive a LAN restart and are removed by local-only startup", async (t) => {
  const store = fixture(t);
  let app = await buildServer(store, { lan: true, addresses: () => [addr] });
  const cookie = await pair(app, store);
  await app.close();
  app = await buildServer(store, { lan: true, addresses: () => [addr] });
  assert.equal(
    (await app.inject({ url: "/api/state", headers: { ...headers, cookie } }))
      .statusCode,
    200,
  );
  await app.close();
  app = await buildServer(store, {});
  await app.close();
  app = await buildServer(store, { lan: true, addresses: () => [addr] });
  try {
    assert.equal(
      (await app.inject({ url: "/api/state", headers: { ...headers, cookie } }))
        .statusCode,
      401,
    );
  } finally {
    await app.close();
  }
});

test("CLI persists LAN choice, keeps discovery on loopback, and returns to local-only explicitly", async (t) => {
  const store = fixture(t),
    loader = path.resolve("node_modules/tsx/dist/loader.mjs"),
    cli = path.resolve("src/cli.ts");
  async function start(flags: string[]) {
    const child = spawn(
      process.execPath,
      [
        "--import",
        loader,
        cli,
        "--project",
        store.root,
        "serve",
        "--headless",
        "--port",
        "0",
        ...flags,
      ],
      { stdio: "ignore" },
    );
    const closed = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    const stop = async () => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await closed;
      }
    };
    t.after(stop);
    for (
      let i = 0;
      i < 200 && !fs.existsSync(store.file(".local/service.json"));
      i++
    )
      await new Promise((r) => setTimeout(r, 25));
    const service = JSON.parse(
      fs.readFileSync(store.file(".local/service.json"), "utf8"),
    );
    assert.equal(new URL(service.url).hostname, "127.0.0.1");
    const res = await fetch(service.url + "/api/network", {
      headers: { authorization: "Bearer " + store.token() },
    });
    assert.equal(res.status, 200);
    return { state: await res.json(), stop };
  }
  let running = await start(["--lan"]);
  assert.equal(running.state.enabled, true);
  const service = JSON.parse(
    fs.readFileSync(store.file(".local/service.json"), "utf8"),
  );
  assert.equal(
    (
      await fetch(service.url + "/api/network/config", {
        method: "POST",
        headers: {
          authorization: "Bearer " + store.token(),
          "content-type": "application/json",
        },
        body: JSON.stringify({ requirePairing: false, sessionHours: 72 }),
      })
    ).status,
    200,
  );
  assert.equal(networkPreference(store), true);
  const records = await promisify(execFile)(process.execPath, [
    "--import",
    loader,
    cli,
    "--project",
    store.root,
    "list",
    "--json",
  ]);
  assert.deepEqual(JSON.parse(records.stdout), []);
  await running.stop();
  running = await start([]);
  assert.equal(running.state.enabled, true);
  assert.equal(running.state.requirePairing, false);
  assert.equal(running.state.sessionHours, 72);
  await running.stop();
  running = await start(["--local"]);
  assert.equal(running.state.enabled, false);
  assert.equal(running.state.boundToLan, false);
  assert.equal(networkPreference(store), false);
  assert.equal(running.state.requirePairing, false);
  assert.equal(running.state.sessionHours, 72);
  await running.stop();
});

test("open LAN permits board work without credentials while retaining host controls and origin checks", async (t) => {
  const { store, app } = await server(t),
    local = { host: "127.0.0.1", authorization: "Bearer " + store.token() };
  const old = await pair(app, store);
  const configure = (payload: object) =>
    app.inject({
      method: "POST",
      url: "/api/network/config",
      headers: local,
      payload,
    });
  assert.equal((await configure({ requirePairing: false })).statusCode, 200);
  assert.equal(networkSettings(store).requirePairing, false);
  const state = await app.inject({ url: "/api/state", headers });
  assert.equal(state.statusCode, 200);
  assert.equal(state.headers["set-cookie"], undefined);
  assert.equal(
    (await app.inject({ url: "/api/session", headers })).json().authenticated,
    true,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/records",
        headers,
        payload: {
          kind: "ticket",
          meta: { title: "Open LAN ticket" },
          body: "",
          actor: { name: "You", kind: "human" },
        },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ url: "/api/export", headers })).statusCode,
    200,
  );
  for (const url of ["/api/network", "/api/capture/status", "/api/documents"])
    assert.equal((await app.inject({ url, headers })).statusCode, 403, url);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/network/config",
        headers,
        payload: { requirePairing: true },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/state",
        headers: { ...headers, origin: "http://evil.example" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/state",
        headers: { ...headers, host: "evil.example" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: "/api/state", headers, remoteAddress: "8.8.8.8" }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/network/pairing",
        headers: local,
      })
    ).statusCode,
    409,
  );
  await configure({ requirePairing: true });
  assert.equal(
    (
      await app.inject({
        url: "/api/state",
        headers: { ...headers, cookie: old },
      })
    ).statusCode,
    401,
  );
  const fresh = await pair(app, store);
  assert.equal(
    (
      await app.inject({
        url: "/api/state",
        headers: { ...headers, cookie: fresh },
      })
    ).statusCode,
    200,
  );
  await configure({ requirePairing: false });
  await configure({ enabled: false });
  assert.equal(
    (await app.inject({ url: "/api/state", headers })).statusCode,
    403,
  );
});

test("access duration validates atomically, applies to new sessions, and upgrades legacy preferences", async (t) => {
  const store = fixture(t);
  fs.writeFileSync(
    store.file(".local/network.json"),
    JSON.stringify({ enabled: true }),
  );
  assert.deepEqual(networkSettings(store), {
    enabled: true,
    requirePairing: true,
    sessionHours: 8,
  });
  const app = await buildServer(store, { lan: true, addresses: () => [addr] });
  t.after(() => app.close());
  const local = { host: "127.0.0.1", authorization: "Bearer " + store.token() },
    old = await pair(app, store);
  const configure = (payload: object) =>
    app.inject({
      method: "POST",
      url: "/api/network/config",
      headers: local,
      payload,
    });
  for (const sessionHours of [0, -1, 0.1, 8761, "24", null])
    assert.equal(
      (await configure({ requirePairing: false, sessionHours })).statusCode,
      422,
    );
  assert.equal(networkSettings(store).requirePairing, true);
  assert.equal((await configure({ requirePairing: "false" })).statusCode, 422);
  assert.equal((await configure({ sessionHours: 0.25 })).statusCode, 200);
  const code = (
    await app.inject({
      method: "POST",
      url: "/api/network/pairing",
      headers: local,
    })
  ).json().code;
  const res = await app.inject({
    method: "POST",
    url: "/api/pair",
    headers,
    payload: { code },
  });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["set-cookie"]), /Max-Age=900/);
  const cookie = String(res.headers["set-cookie"]).split(";")[0],
    clock = Date.now;
  try {
    Date.now = () => clock() + 900001;
    assert.equal(
      (await app.inject({ url: "/api/state", headers: { ...headers, cookie } }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/state",
          headers: { ...headers, cookie: old },
        })
      ).statusCode,
      200,
    );
  } finally {
    Date.now = clock;
  }
  assert.equal((await configure({ sessionHours: 8760 })).statusCode, 200);
  assert.equal(networkSettings(store).sessionHours, 8760);
});

test("requiring pairing again closes an open-mode event stream immediately", async (t) => {
  const { store, app } = await server(t),
    local = { host: "127.0.0.1", authorization: "Bearer " + store.token() };
  await app.inject({
    method: "POST",
    url: "/api/network/config",
    headers: local,
    payload: { requirePairing: false },
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const port = (app.server.address() as any).port;
  const stream = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/events",
        headers: { host: `${addr}:${port}` },
      },
      resolve,
    );
    req.on("error", reject);
    t.after(() => req.destroy());
  });
  assert.equal(stream.statusCode, 200);
  const ended = new Promise<void>((resolve) => stream.on("end", resolve));
  stream.resume();
  await app.inject({
    method: "POST",
    url: "/api/network/config",
    headers: local,
    payload: { requirePairing: true },
  });
  await Promise.race([
    ended,
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(Error("Open event stream remained connected")),
        1500,
      ).unref();
    }),
  ]);
});
