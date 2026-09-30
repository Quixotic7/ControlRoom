import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { buildServer } from "../src/server.js";
import type { Actor, FeedEntry } from "../src/types.js";

const human: Actor = { name: "Morgan", kind: "human" };
const agent: Actor = { name: "Sol", kind: "agent" };

function fixture(t: test.TestContext) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "controlroom-feed-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new Store(root).initialize("Feed project");
}

function assertNewestFirst(entries: FeedEntry[]) {
  for (let index = 1; index < entries.length; index++) {
    const newer = entries[index - 1];
    const older = entries[index];
    assert.ok(
      newer.at > older.at || (newer.at === older.at && newer.id > older.id),
      `${newer.id} should sort before ${older.id}`,
    );
  }
}

test("feed reconstructs attributed activity, groups edits, filters, and paginates without duplicates", async (t) => {
  const store = fixture(t);
  let ticket = await store.create(
    "ticket",
    { title: "Original", scopeApproved: true },
    "Initial body",
    human,
  );
  ticket = await store.update(
    ticket.meta.id,
    ticket.revision,
    { title: "Readable activity" },
    undefined,
    human,
  );
  ticket = await store.update(
    ticket.meta.id,
    ticket.revision,
    { owner: "Sol" },
    undefined,
    human,
  );
  ticket = await store.update(
    ticket.meta.id,
    ticket.revision,
    { labels: ["activity"] },
    "Revised body",
    human,
  );
  await store.comment(
    ticket.meta.id,
    "Should this open the conversation?",
    agent,
    "question",
  );
  await store.comment(
    ticket.meta.id,
    "Review evidence is ready for inspection.",
    human,
    "review",
  );
  ticket = await store.update(
    ticket.meta.id,
    ticket.revision,
    { status: "progress" },
    undefined,
    human,
  );
  ticket = await store.update(
    ticket.meta.id,
    ticket.revision,
    { archived: true },
    undefined,
    human,
  );
  await store.create(
    "decision",
    { title: "Keep activity durable", status: "accepted" },
    "Use history and comments.",
    human,
  );

  const all = store.feed({ limit: 100 });
  assertNewestFirst(all.entries);
  assert.equal(
    new Set(all.entries.map((entry) => entry.id)).size,
    all.entries.length,
  );
  assert.ok(all.entries.some((entry) => entry.eventType === "question"));
  assert.ok(all.entries.some((entry) => entry.eventType === "review"));
  assert.ok(all.entries.some((entry) => entry.eventType === "transition"));
  assert.ok(all.entries.some((entry) => entry.eventType === "archive"));
  assert.ok(all.entries.some((entry) => entry.eventType === "decision"));
  const grouped = all.entries.find(
    (entry) => entry.eventType === "edit" && entry.record.id === ticket.meta.id,
  );
  assert.equal(grouped?.groupedCount, 3);
  assert.match(grouped?.summary ?? "", /title/);
  const question = all.entries.find(
    (entry) => entry.eventType === "question" && entry.actor.name === "Sol",
  )!;
  assert.equal(question.actor.name, "Sol");
  assert.ok(question.commentId);
  assert.equal(question.record.archived, true);
  assert.equal(question.record.number, ticket.meta.number);

  const byActor = store.feed({ actor: "agent:Sol", limit: 100 });
  assert.deepEqual(
    byActor.entries.map((entry) => entry.eventType),
    ["question"],
  );
  const byType = store.feed({ eventType: "transition", limit: 100 });
  assert.equal(byType.entries.length, 1);
  assert.match(byType.entries[0].summary, /In Progress/);
  const byTicket = store.feed({ ticket: ticket.meta.id, limit: 100 });
  assert.ok(byTicket.entries.length > 1);
  assert.ok(
    byTicket.entries.every((entry) => entry.record.id === ticket.meta.id),
  );

  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = store.feed({ limit: 2, cursor });
    for (const entry of page.entries) {
      assert.equal(seen.has(entry.id), false, `duplicate ${entry.id}`);
      seen.add(entry.id);
    }
    cursor = page.nextCursor;
    assert.equal(page.hasMore, !!cursor);
  } while (cursor);
  assert.deepEqual(seen, new Set(all.entries.map((entry) => entry.id)));
});

test("feed keeps valid history around malformed data and degrades missing references", async (t) => {
  const store = fixture(t);
  await store.create("ticket", { title: "Still visible" }, "", human);
  fs.appendFileSync(
    store.file("records/history.jsonl"),
    [
      "{not json}",
      JSON.stringify({
        id: "event-missing",
        record: "WB-gone",
        actor: human,
        action: "updated",
        at: "2099-01-01T00:00:00.000Z",
        before: {
          meta: {
            kind: "ticket",
            number: 44,
            title: "Removed ticket",
            owner: "A",
          },
        },
        after: {
          meta: {
            kind: "ticket",
            number: 44,
            title: "Removed ticket",
            owner: "B",
          },
        },
      }),
      JSON.stringify({
        id: "event-heartbeat",
        record: "WB-gone",
        actor: agent,
        action: "heartbeat",
        at: "2099-01-01T00:01:00.000Z",
      }),
    ].join("\n") + "\n",
  );
  fs.writeFileSync(store.file("records/comments/broken.md"), "not markdown");

  const feed = store.feed({ limit: 100 });
  const missing = feed.entries.find(
    (entry) => entry.id === "history:event-missing",
  )!;
  assert.equal(missing.record.missing, true);
  assert.equal(missing.record.title, "Removed ticket");
  assert.equal(missing.record.number, 44);
  assert.equal(
    feed.entries.some((entry) => entry.id.includes("heartbeat")),
    false,
  );
  assert.ok(feed.entries.some((entry) => entry.eventType === "created"));
  assert.throws(
    () => store.feed({ cursor: "not-a-cursor" }),
    /Invalid feed cursor/,
  );
});

test("feed API validates and applies pagination query parameters", async (t) => {
  const store = fixture(t);
  const ticket = await store.create("ticket", { title: "API feed" }, "", human);
  await store.comment(ticket.meta.id, "API comment", human);
  const app = await buildServer(store);
  t.after(() => app.close());
  const headers = {
    host: "127.0.0.1",
    authorization: `Bearer ${store.token()}`,
  };
  const first = await app.inject({ url: "/api/feed?limit=1", headers });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().entries.length, 1);
  assert.equal(first.json().hasMore, true);
  const second = await app.inject({
    url: `/api/feed?limit=1&cursor=${encodeURIComponent(first.json().nextCursor)}`,
    headers,
  });
  assert.equal(second.statusCode, 200);
  assert.notEqual(second.json().entries[0].id, first.json().entries[0].id);
  assert.equal(
    (await app.inject({ url: "/api/feed?type=unknown", headers })).statusCode,
    422,
  );
});
