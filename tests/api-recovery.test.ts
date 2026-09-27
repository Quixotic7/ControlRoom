import test from "node:test";
import assert from "node:assert/strict";
import { api, ApiError, ConnectionError } from "../web/api.js";

test("read requests recover from connection loss, including interrupted response bodies", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls === 1) throw new TypeError("Failed to fetch");
    if (calls === 2)
      return {
        text: async () => {
          throw new TypeError("Connection closed");
        },
      };
    return new Response(JSON.stringify({ ok: true }));
  });
  assert.deepEqual(await api("/capture/status"), { ok: true });
  assert.equal(calls, 3);
});
test("persistent read failures stop after three attempts with a useful connection message", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(
    api("/images/image-test"),
    (e) =>
      e instanceof ConnectionError &&
      /local service/.test(String(e)) &&
      !/TypeError/.test(String(e)),
  );
  assert.equal(calls, 3);
});
test("writes with lost responses are never retried automatically", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new TypeError("Failed to fetch");
  });
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    await assert.rejects(
      api("/images", method, {}),
      (e) =>
        e instanceof ConnectionError && /may have completed/.test(String(e)),
    );
  }
  assert.equal(calls, 4);
});
test("HTTP and malformed-response errors retain their semantics without retries", async (t) => {
  let calls = 0;
  const mock = t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(JSON.stringify({ error: "Open locally" }), {
      status: 401,
    });
  });
  await assert.rejects(
    api("/capture/status"),
    (e) => e instanceof ApiError && e.status === 401,
  );
  mock.mock.mockImplementation(async () => {
    calls++;
    return new Response("not JSON");
  });
  await assert.rejects(
    api("/images/image-test"),
    (e) => e instanceof ApiError && /Invalid server response/.test(e.message),
  );
  assert.equal(calls, 2);
});
