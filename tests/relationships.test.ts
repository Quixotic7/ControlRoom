import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { addImage } from "../src/media.js";
import type { Actor, RecordFile } from "../src/types.js";

const human: Actor = { name: "Human", kind: "human" };
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";

function fixture(t: test.TestContext) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "controlroom-relations-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new Store(root).initialize("Relationships");
}

function ticket(
  store: Store,
  title: string,
  meta: Record<string, unknown> = {},
  body = "",
) {
  return store.create("ticket", { title, ...meta }, body, human);
}

test("related tickets are reciprocal, revision checked, removable, and non-blocking context", async (t) => {
  const store = fixture(t);
  const first = await ticket(store, "First ticket");
  const second = await ticket(store, "Second ticket");
  await assert.rejects(
    store.relate(
      first.meta.id,
      {
        other: second.meta.number!,
        revision: "stale",
        otherRevision: second.revision,
        action: "add",
      },
      human,
    ),
    /changed/,
  );
  const added = await store.relate(
    first.meta.id,
    {
      other: `#${second.meta.number}`,
      revision: first.revision,
      otherRevision: second.revision,
      action: "add",
    },
    human,
  );
  assert.deepEqual(added.ticket.meta.related, [second.meta.id]);
  assert.deepEqual(added.related.meta.related, [first.meta.id]);
  assert.deepEqual(
    store.context(first.meta.id).related.map((r) => r.meta.id),
    [second.meta.id],
  );
  assert.match(
    store.contextMarkdown(first.meta.id).markdown,
    /Related tickets \(context only; not blocking dependencies\)/,
  );
  assert.deepEqual(store.context(first.meta.id).dependencies, []);

  const repeated = await store.relate(
    first.meta.id,
    {
      other: second.meta.id,
      revision: first.revision,
      otherRevision: second.revision,
      action: "add",
    },
    human,
  );
  assert.equal(repeated.changed, false);

  const currentFirst = store.get(first.meta.id);
  const currentSecond = store.get(second.meta.id);
  const removed = await store.relate(
    first.meta.id,
    {
      other: second.meta.id,
      revision: currentFirst.revision,
      otherRevision: currentSecond.revision,
      action: "remove",
    },
    human,
  );
  assert.deepEqual(removed.ticket.meta.related, []);
  assert.deepEqual(removed.related.meta.related, []);
  assert.equal(
    store.historyFor(first.meta.id).at(0)?.action,
    "related ticket removed",
  );
});

test("merge preview requires conflict decisions and merge preserves provenance while redirecting incoming links", async (t) => {
  const store = fixture(t);
  const parentA = await ticket(store, "Parent A");
  const parentB = await ticket(store, "Parent B");
  const decision = await store.create(
    "decision",
    { title: "Source decision", status: "accepted" },
    "Keep the source decision.",
    human,
  );
  const rule = await store.create(
    "rule",
    { title: "Source rule", status: "active", scope: ["source-only"] },
    "Keep the source rule.",
    human,
  );
  const survivor = await ticket(
    store,
    "Canonical ticket",
    {
      parent: parentA.meta.id,
      status: "selected",
      owner: "Ada",
      priority: 1,
    },
    "Survivor description.\n\n## Acceptance criteria\n\n- Keep survivor behavior.\n",
  );
  const image = await addImage(store, "source.png", png);
  const source = await ticket(
    store,
    "Duplicate ticket",
    {
      parent: parentB.meta.id,
      status: "progress",
      owner: "Grace",
      priority: 3,
      attachments: [image.id],
      decisions: [decision.meta.id],
      rules: [rule.meta.id],
      labels: ["source-only"],
    },
    "Original source description.\n\n## Acceptance criteria\n\n- Keep source behavior.\n",
  );
  await store.comment(
    source.meta.id,
    `Original discussion by its author. ![source](/api/images/${image.id}/preview)`,
    human,
  );
  const child = await ticket(store, "Source child", { parent: source.meta.id });
  const dependent = await ticket(store, "Source dependent", {
    dependencies: [source.meta.id],
  });

  const preview = store.mergePreview(survivor.meta.id, source.meta.id);
  assert.deepEqual(Object.keys(preview.conflicts).sort(), [
    "acceptanceCriteria",
    "owner",
    "parent",
    "priority",
    "status",
  ]);
  assert.deepEqual(
    preview.incoming.map((item) => item.id).sort(),
    [child.meta.id, dependent.meta.id].sort(),
  );
  assert.deepEqual(preview.content, {
    description: true,
    comments: 1,
    attachments: 1,
    decisions: [decision.meta.id],
    rules: [rule.meta.id],
  });
  await assert.rejects(
    store.merge(
      survivor.meta.id,
      {
        source: source.meta.id,
        requestId: "merge-request-one",
        revisions: preview.affected,
        resolutions: {},
      },
      human,
    ),
    /Resolve merge conflicts/,
  );

  const resolutions = {
    parent: "survivor",
    status: "survivor",
    owner: "source",
    priority: "source",
    acceptanceCriteria: "both",
  } as const;
  const result = await store.merge(
    survivor.meta.id,
    {
      source: source.meta.id,
      requestId: "merge-request-one",
      revisions: preview.affected,
      resolutions,
    },
    human,
  );
  assert.equal(result.changed, true);
  const savedSurvivor = store.get(survivor.meta.id);
  const savedSource = store.get(source.meta.id);
  assert.equal(savedSurvivor.meta.status, "selected");
  assert.equal(savedSurvivor.meta.owner, "Grace");
  assert.equal(savedSurvivor.meta.priority, 3);
  assert.equal(savedSurvivor.meta.parent, parentA.meta.id);
  assert.match(savedSurvivor.body, /Preserved acceptance criteria from/);
  assert.deepEqual(savedSurvivor.meta.mergedFrom, [source.meta.id]);
  assert.equal(savedSource.meta.archived, true);
  assert.equal(savedSource.meta.duplicateOf, survivor.meta.id);
  assert.equal(savedSource.meta.status, "progress");
  assert.equal(store.get(child.meta.id).meta.parent, survivor.meta.id);
  assert.deepEqual(store.get(dependent.meta.id).meta.dependencies, [
    survivor.meta.id,
  ]);

  const context = store.context(survivor.meta.id);
  assert.deepEqual(
    context.mergedSources.map((r) => r.meta.id),
    [source.meta.id],
  );
  assert.equal(context.comments[0].ticket, source.meta.id);
  assert.deepEqual(
    context.attachments.map((a) => a.id),
    [image.id],
  );
  assert.ok(context.decisions.some((r) => r.meta.id === decision.meta.id));
  assert.ok(context.rules.some((r) => r.meta.id === rule.meta.id));
  const markdown = store.contextMarkdown(survivor.meta.id).markdown;
  assert.match(markdown, /Preserved duplicate sources/);
  assert.match(markdown, /Original author: Human \(human\)/);
  assert.match(markdown, /Original discussion by its author/);
  assert.match(
    store.contextMarkdown(source.meta.id).markdown,
    /Duplicate: this archived ticket points to survivor/,
  );
  assert.ok(store.historyFor(survivor.meta.id).length >= 2);
  assert.ok(store.historyFor(source.meta.id).length >= 2);
  assert.ok(
    store
      .historyFor(child.meta.id)
      .some((event) => /redirected/.test(event.action)),
  );
  assert.notEqual(store.next(human)?.meta.id, source.meta.id);

  const retry = await store.merge(
    survivor.meta.id,
    {
      source: source.meta.id,
      requestId: "merge-request-one",
      revisions: preview.affected,
      resolutions,
    },
    human,
  );
  assert.equal(retry.changed, false);
  assert.equal(retry.recovered, true);
  assert.equal(
    store.get(survivor.meta.id).body.match(/Preserved acceptance criteria/g)
      ?.length,
    1,
  );
});

test("merge rejects stale affected records and parent cycles before writing", async (t) => {
  const store = fixture(t);
  const survivor = await ticket(store, "Survivor");
  const source = await ticket(store, "Source");
  const child = await ticket(store, "Child", { parent: source.meta.id });
  const preview = store.mergePreview(survivor.meta.id, source.meta.id);
  await store.update(
    child.meta.id,
    child.revision,
    { title: "Changed child" },
    undefined,
    human,
  );
  await assert.rejects(
    store.merge(
      survivor.meta.id,
      {
        source: source.meta.id,
        requestId: "stale-merge-request",
        revisions: preview.affected,
        resolutions: {},
      },
      human,
    ),
    /stale revision|changed/i,
  );
  assert.equal(store.get(source.meta.id).meta.archived, undefined);
  assert.equal(store.get(child.meta.id).meta.parent, source.meta.id);

  const parentedSurvivor = await store.update(
    survivor.meta.id,
    survivor.revision,
    { parent: source.meta.id },
    undefined,
    human,
  );
  const cyclePreview = store.mergePreview(
    parentedSurvivor.meta.id,
    source.meta.id,
  );
  await assert.rejects(
    store.merge(
      parentedSurvivor.meta.id,
      {
        source: source.meta.id,
        requestId: "cycle-merge-request",
        revisions: cyclePreview.affected,
        resolutions: { parent: "survivor" },
      },
      human,
    ),
    /child of the source/,
  );
  assert.equal(store.get(source.meta.id).meta.archived, undefined);
});

test("relationship transactions preserve managed ownership and cannot accept Done", async (t) => {
  const store = fixture(t);
  const agent: Actor = { name: "Other agent", kind: "agent" };
  const left = await ticket(store, "Left", { scopeApproved: true });
  const right = await ticket(store, "Right", { scopeApproved: true });
  const assigned = await store.managedUpdate(
    right.meta.id,
    right.revision,
    {
      assignment: {
        runId: "managed-run",
        worker: "Worker",
        state: "acknowledged",
        assignedBy: "Orchestrator",
        assignedAt: new Date().toISOString(),
      },
    },
    human,
    () => {},
  );
  await assert.rejects(
    store.relate(
      left.meta.id,
      {
        other: right.meta.id,
        revision: left.revision,
        otherRevision: assigned.revision,
        action: "add",
      },
      agent,
    ),
    /Assigned to Worker/,
  );
  const p = store.mergePreview(left.meta.id, right.meta.id);
  await assert.rejects(
    store.merge(
      left.meta.id,
      {
        source: right.meta.id,
        requestId: "ownership-merge",
        revisions: p.affected,
      },
      agent,
    ),
    /Assigned to Worker/,
  );
  assert.equal(store.get(left.meta.id).meta.related, undefined);
  assert.equal(store.get(right.meta.id).meta.archived, undefined);
  const done = await ticket(store, "Already done", { status: "done" });
  const donePreview = store.mergePreview(left.meta.id, done.meta.id);
  await assert.rejects(
    store.merge(
      left.meta.id,
      {
        source: done.meta.id,
        requestId: "done-merge-request",
        revisions: donePreview.affected,
        resolutions: { status: "source" },
      },
      human,
    ),
    /cannot accept work into Done/,
  );
  assert.equal(store.get(left.meta.id).meta.status, "backlog");
});

test("merge rejects indirect dependency cycles and clears prior evidence on entering Review", async (t) => {
  const store = fixture(t);
  const source = await ticket(store, "Source");
  const middle = await ticket(store, "Middle", {
    dependencies: [source.meta.id],
  });
  const survivor = await ticket(store, "Survivor", {
    dependencies: [middle.meta.id],
  });
  const p = store.mergePreview(survivor.meta.id, source.meta.id);
  await assert.rejects(
    store.merge(
      survivor.meta.id,
      {
        source: source.meta.id,
        requestId: "dependency-cycle",
        revisions: p.affected,
      },
      human,
    ),
    /Dependencies cannot form a cycle/,
  );
  assert.deepEqual(store.get(middle.meta.id).meta.dependencies, [
    source.meta.id,
  ]);
  const review = await ticket(store, "In review", { status: "review" });
  const earlier = await ticket(store, "Earlier evidence", {
    reviewVerificationAt: "old-run",
  });
  const reviewPreview = store.mergePreview(earlier.meta.id, review.meta.id);
  const result = await store.merge(
    earlier.meta.id,
    {
      source: review.meta.id,
      requestId: "review-merge-request",
      revisions: reviewPreview.affected,
      resolutions: { status: "source" },
    },
    human,
  );
  assert.equal(result.survivor!.meta.reviewVerificationAt, "");
});

test("transaction failures roll back records and audit entries together", async (t) => {
  const store = fixture(t);
  const left = await ticket(store, "Left");
  const right = await ticket(store, "Right");
  const historyBefore = fs.readFileSync(
    store.file("records/history.jsonl"),
    "utf8",
  );
  const rename = fs.renameSync;
  let failed = false;
  t.mock.method(
    fs,
    "renameSync",
    (source: fs.PathLike, destination: fs.PathLike) => {
      if (
        !failed &&
        String(destination) === store.file("records/history.jsonl")
      ) {
        failed = true;
        throw new Error("Injected audit write failure");
      }
      return rename(source, destination);
    },
  );
  await assert.rejects(
    store.relate(
      left.meta.id,
      {
        other: right.meta.id,
        revision: left.revision,
        otherRevision: right.revision,
        action: "add",
      },
      human,
    ),
    /all written records were restored/,
  );
  assert.equal(store.get(left.meta.id).revision, left.revision);
  assert.equal(store.get(right.meta.id).revision, right.revision);
  assert.equal(
    fs.readFileSync(store.file("records/history.jsonl"), "utf8"),
    historyBefore,
  );
  assert.equal(
    fs.existsSync(store.file(".local/record-transaction.json")),
    false,
  );
});

test("interrupted transaction recovery restores partial records but preserves completed audit history", async (t) => {
  const store = fixture(t);
  const left = await ticket(store, "Before");
  const recordPath = store.file(left.path);
  const historyPath = store.file("records/history.jsonl");
  const before = fs.readFileSync(recordPath, "utf8");
  const historyBefore = fs.readFileSync(historyPath, "utf8");
  const after = before.replace("title: Before", "title: After");
  assert.notEqual(before, after);
  const historyAfter =
    historyBefore +
    JSON.stringify({
      id: "recovery-event",
      record: left.meta.id,
      action: "test merge",
      actor: human,
      at: new Date().toISOString(),
    }) +
    "\n";
  const journal = {
    files: [
      { path: left.path, before, after },
      {
        path: "records/history.jsonl",
        before: historyBefore,
        after: historyAfter,
      },
    ],
  };
  const journalPath = store.file(".local/record-transaction.json");
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  fs.writeFileSync(recordPath, after);
  new Store(store.root).initialize();
  assert.equal(fs.readFileSync(recordPath, "utf8"), before);
  assert.equal(fs.readFileSync(historyPath, "utf8"), historyBefore);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  fs.writeFileSync(recordPath, after);
  fs.writeFileSync(historyPath, historyAfter);
  new Store(store.root).initialize();
  assert.equal(fs.readFileSync(recordPath, "utf8"), after);
  assert.equal(fs.readFileSync(historyPath, "utf8"), historyAfter);
  assert.equal(fs.existsSync(journalPath), false);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  fs.writeFileSync(recordPath, after + "Independent edit\n");
  assert.throws(
    () => new Store(store.root).initialize(),
    /changed independently/,
  );
  assert.match(fs.readFileSync(recordPath, "utf8"), /Independent edit/);
});
