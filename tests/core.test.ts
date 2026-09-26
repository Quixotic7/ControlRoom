import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../src/store.js";
import {
  atomic,
  hash,
  read,
  canonicalProject,
  parseMd,
  safe,
} from "../src/files.js";
import { addImage, saveAnnotations } from "../src/media.js";
import {
  backup,
  restore,
  stageImport,
  importBatches,
  applyImport,
  importBrief,
  documentFiles,
} from "../src/transfer.js";
import { buildServer } from "../src/server.js";
import type { Actor } from "../src/types.js";

const human: Actor = { name: "Human", kind: "human" },
  a: Actor = { name: "Agent A", kind: "agent" },
  b: Actor = { name: "Agent B", kind: "agent" };
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
function fixture(t: test.TestContext) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "workboard-test-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new Store(root).initialize("Test project");
}
async function ticket(
  s: Store,
  title = "Task",
  meta: Record<string, unknown> = {},
) {
  return s.create(
    "ticket",
    { title, ...meta },
    "## Outcome\n\nA concrete result.\n",
    human,
  );
}

test("Markdown updates preserve unknown YAML, comments, and unrelated body", async (t) => {
  const s = fixture(t);
  let r = await ticket(s);
  const file = s.file(r.path);
  atomic(
    file,
    read(file).replace(
      "schema: 1",
      "schema: 1 # custom schema note\ncustom:\n  important: keep me",
    ),
  );
  r = s.get(r.meta.id);
  const updated = await s.update(
    r.meta.id,
    r.revision,
    { title: "New title" },
    undefined,
    human,
  );
  assert.equal(updated.body, r.body);
  assert.deepEqual(updated.meta.custom, { important: "keep me" });
  assert.match(read(file), /# custom schema note/);
});
test("concurrent coordinated edits reject the stale writer", async (t) => {
  const s = fixture(t),
    r = await ticket(s);
  const results = await Promise.allSettled([
    s.update(r.meta.id, r.revision, { title: "First" }, undefined, human),
    s.update(r.meta.id, r.revision, { title: "Second" }, undefined, human),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
      .reason.status,
    409,
  );
});

test("ticket numbers start at zero, serialize concurrent creates, and survive backup", async (t) => {
  const s = fixture(t);
  const records = await Promise.all([
    ticket(s, "First"),
    ticket(s, "Second"),
    ticket(s, "Third"),
  ]);
  assert.deepEqual(
    records.map((r) => r.meta.number),
    [0, 1, 2],
  );
  assert.equal(s.get("0").meta.id, records[0].meta.id);
  await s.comment("0", "Numbered comment", human);
  assert.equal(s.context("0").comments.length, 1);
  const edited = await s.update(
    "0",
    records[0].revision,
    { title: "Updated" },
    undefined,
    human,
  );
  assert.equal(s.historyFor("0").length, 2);
  await assert.rejects(
    s.update("0", edited.revision, { number: 7 }, undefined, human),
    /Cannot change number/,
  );
  const target = fixture(t);
  await restore(target, await backup(s));
  assert.equal((await ticket(target, "Next")).meta.number, 3);
});

test("legacy tickets acquire durable numbers without breaking links or custom prose", async (t) => {
  const s = fixture(t);
  const parent = await ticket(s, "Original parent");
  const child = await ticket(s, "Original child", { parent: parent.meta.id });
  for (const r of [parent, child])
    atomic(s.file(r.path), read(s.file(r.path)).replace(/^number:.*\n/m, ""));
  fs.unlinkSync(s.file("records/ticket-sequence.json"));
  const body = s.get(child.meta.id).body;
  await s.migrateTicketNumbers();
  assert.equal(s.get(child.meta.id).meta.parent, parent.meta.id);
  assert.equal(s.get(child.meta.id).body, body);
  assert.deepEqual(
    s
      .list()
      .map((r) => r.meta.number)
      .sort(),
    [0, 1],
  );
  await s.migrateTicketNumbers();
  assert.equal((await ticket(s, "Next")).meta.number, 2);
});
test("approved parents allow agent work; completion remains human", async (t) => {
  const s = fixture(t),
    parent = await ticket(s, "Parent", { scopeApproved: true });
  const child = await s.create(
    "ticket",
    { title: "Child", parent: parent.meta.id, status: "progress" },
    "",
    a,
  );
  await assert.rejects(
    s.update(child.meta.id, child.revision, { status: "done" }, undefined, a),
    /human accepts/,
  );
  await assert.rejects(
    s.create("ticket", { title: "Unapproved", status: "progress" }, "", a),
    /approved/,
  );
  await assert.rejects(
    s.create("ticket", { title: "Self-approved", scopeApproved: true }, "", a),
    /Only a human/,
  );
  const review = await s.review(
    child.meta.id,
    child.revision,
    "Implemented",
    "Tests passed",
    "",
    a,
  );
  const done = await s.update(
    child.meta.id,
    review.revision,
    { status: "done" },
    undefined,
    human,
  );
  assert.equal(done.meta.status, "done");
  assert.equal(s.get(parent.meta.id).meta.status, "backlog");
});
test("review submission requires meaningful handoff and evidence", async (t) => {
  const s = fixture(t),
    r = await ticket(s, "Task", { scopeApproved: true });
  await assert.rejects(
    s.update(r.meta.id, r.revision, { status: "review" }, undefined, a),
    /handoff/,
  );
});
test("parent cycles and missing dependencies are rejected", async (t) => {
  const s = fixture(t),
    parent = await ticket(s),
    child = await ticket(s, "Child", { parent: parent.meta.id });
  await assert.rejects(
    s.update(
      parent.meta.id,
      parent.revision,
      { parent: child.meta.id },
      undefined,
      human,
    ),
    /cycle/,
  );
  await assert.rejects(
    ticket(s, "Missing", { dependencies: ["missing"] }),
    /dependency/,
  );
});
test("claims are exclusive, renewable and expire visibly", async (t) => {
  const s = fixture(t),
    r = await ticket(s, "Task", { scopeApproved: true });
  await s.claim(r.meta.id, a, "/worktree/a");
  await assert.rejects(s.claim(r.meta.id, b, "/worktree/b"), /Claimed/);
  const old = s.claims();
  old[0].expiresAt = "2000-01-01T00:00:00Z";
  atomic(s.file(".local/claims.json"), JSON.stringify(old));
  assert.equal(s.state().claims.length, 1);
  await s.claim(r.meta.id, b, "/worktree/b");
  assert.equal(s.claims()[0].actor.name, "Agent B");
  // Agents address tickets by number; context must still report the live claim.
  assert.equal(s.context(String(r.meta.number)).claim?.actor.name, "Agent B");
  assert.equal(s.context(`#${r.meta.number}`).claim?.actor.name, "Agent B");
});
test("active rules are scoped, versioned, and changed guidance is detectable", async (t) => {
  const s = fixture(t);
  const rule = await s.create(
    "rule",
    { title: "Buttons", status: "active", scope: ["ui"] },
    "Use PrimaryButton.",
    a,
  );
  const parent = await ticket(s, "UI goal", {
    scopeApproved: true,
    labels: ["ui"],
  });
  const r = await ticket(s, "Form", { parent: parent.meta.id });
  assert.equal(s.context(r.meta.id).rules[0].meta.id, rule.meta.id);
  assert.equal(
    s.get(r.meta.id).meta.reviewedRules?.[rule.meta.id],
    rule.revision,
  );
  const updated = await s.update(
    rule.meta.id,
    rule.revision,
    {},
    "Use ActionButton.",
    b,
  );
  assert.notEqual(
    updated.revision,
    s.get(r.meta.id).meta.reviewedRules?.[rule.meta.id],
  );
  assert.equal(s.historyFor(rule.meta.id).length, 2);
});
test("successor decisions retain history and replace prior context", async (t) => {
  const s = fixture(t),
    old = await s.create(
      "decision",
      { title: "Old approach", status: "accepted" },
      "Old rationale.",
      a,
    );
  const next = await s.create(
    "decision",
    { title: "New approach", status: "accepted", supersedes: old.meta.id },
    "New rationale.",
    b,
  );
  const r = await ticket(s);
  assert.equal(s.get(old.meta.id).body, "Old rationale.");
  assert.deepEqual(
    s.context(r.meta.id).decisions.map((d) => d.meta.id),
    [next.meta.id],
  );
});
test("external malformed files remain on disk and produce visible errors", async (t) => {
  const s = fixture(t);
  atomic(
    s.file("records/tickets/broken.md"),
    "---\ntitle: [broken\n---\noriginal",
  );
  assert.equal(s.state().errors.length, 1);
  assert.match(read(s.file("records/tickets/broken.md")), /original/);
});
test("unsupported schema is reported without rewriting", async (t) => {
  const s = fixture(t),
    r = await ticket(s);
  const p = s.file(r.path);
  atomic(p, read(p).replace("schema: 1", "schema: 20"));
  assert.equal(s.state().errors.length, 1);
  assert.match(read(p), /schema: 20/);
});
test("source images and normalized geometry round-trip in backups", async (t) => {
  const s = fixture(t),
    image = await addImage(s, "sample", png);
  const marked = await saveAnnotations(
    s,
    image.id,
    image.revision,
    [
      {
        id: "a1",
        type: "box",
        x: 0.1,
        y: 0.2,
        x2: 0.8,
        y2: 0.7,
        text: "Align this",
        resolved: false,
      },
    ],
    png,
    human,
  );
  await ticket(s, "Visual change", { attachments: [image.id] });
  const bytes = await backup(s);
  const other = fixture(t);
  await restore(other, bytes);
  assert.equal(other.list().length, 1);
  assert.equal(other.attachment(image.id).annotations[0].text, "Align this");
  assert.equal(other.attachment(image.id).hash, image.hash);
  assert.deepEqual(
    fs.readFileSync(other.file(`assets/${image.id}/base.png`)),
    Buffer.from(png, "base64"),
  );
  await assert.rejects(restore(other, bytes), /empty project/);
  assert.equal(marked.width, 1);
});
test("missing images retain readable annotations and show placeholders", async (t) => {
  const s = fixture(t),
    a = await addImage(s, "sample", png);
  await saveAnnotations(
    s,
    a.id,
    a.revision,
    [
      {
        id: "n1",
        type: "pin",
        x: 0.5,
        y: 0.5,
        text: "Keep this text",
        resolved: false,
      },
    ],
    png,
    human,
  );
  fs.unlinkSync(s.file(`assets/${a.id}/base.png`));
  assert.equal(s.attachment(a.id).missing, true);
  assert.match(
    read(s.file(`records/attachments/${a.id}.md`)),
    /Keep this text/,
  );
});
test("stale annotation edits and invalid coordinates are rejected", async (t) => {
  const s = fixture(t),
    a = await addImage(s, "sample", png);
  await assert.rejects(
    saveAnnotations(
      s,
      a.id,
      a.revision,
      [{ id: "bad", type: "pin", x: 2, y: 0, text: "bad", resolved: false }],
      undefined,
      human,
    ),
  );
  await saveAnnotations(s, a.id, a.revision, [], png, human);
  await assert.rejects(
    saveAnnotations(s, a.id, a.revision, [], png, human),
    /changed/,
  );
});
test("imports preview and preserve originals; changed sources stop application", async (t) => {
  const s = fixture(t);
  atomic(path.join(s.root, "notes.md"), "# Existing notes\nKeep this.");
  const brief = importBrief(s, ["notes.md"]);
  assert.equal(brief.sources.length, 1);
  const batch = await stageImport(
    s,
    [
      {
        kind: "decision",
        title: "Imported choice",
        body: "Reason",
        references: ["notes.md"],
      },
    ],
    a,
  );
  assert.equal(s.list().length, 0);
  const staged = importBatches(s)[0];
  await assert.rejects(
    applyImport(s, batch.id, [batch.proposals[0].id], staged.revision, a),
    /human/,
  );
  await applyImport(
    s,
    batch.id,
    [batch.proposals[0].id],
    staged.revision,
    human,
  );
  assert.equal(s.list()[0].meta.status, "proposed");
  assert.equal(
    read(path.join(s.root, "notes.md")),
    "# Existing notes\nKeep this.",
  );
  const second = await stageImport(
    s,
    [
      {
        kind: "rule",
        title: "Another",
        body: "Rule",
        references: ["notes.md"],
      },
    ],
    a,
  );
  atomic(path.join(s.root, "notes.md"), "Changed");
  await assert.rejects(
    applyImport(
      s,
      second.id,
      [second.proposals[0].id],
      importBatches(s).find((v) => v.id === second.id)!.revision,
      human,
    ),
    /changed/,
  );
});

test("rulebook briefings include components and local screenshot references", async (t) => {
  const s = fixture(t);
  atomic(
    path.join(s.root, "Button.tsx"),
    "export const Button = () => <button>Save</button>;",
  );
  atomic(path.join(s.root, "reference.png"), Buffer.from(png, "base64"));
  assert.ok(documentFiles(s).includes("Button.tsx"));
  assert.ok(documentFiles(s).includes("reference.png"));
  const brief = importBrief(s, ["Button.tsx", "reference.png"]);
  assert.match(brief.sources[0].content!, /<button>/);
  assert.equal(brief.sources[1].localPath, path.join(s.root, "reference.png"));
  assert.equal(brief.sources[1].content, undefined);
  const batch = await stageImport(
    s,
    [
      {
        kind: "rule",
        title: "Button shape",
        body: "Use the existing component.",
        references: ["reference.png"],
      },
    ],
    a,
  );
  const revision = importBatches(s)[0].revision;
  const changed = fs.readFileSync(path.join(s.root, "reference.png"));
  changed[changed.length - 1] ^= 1;
  atomic(path.join(s.root, "reference.png"), changed);
  await assert.rejects(
    applyImport(s, batch.id, [batch.proposals[0].id], revision, human),
    /changed/,
  );
});
test("paths and symbolic links cannot escape the project", async (t) => {
  const s = fixture(t);
  assert.throws(() => s.file("../outside"), /Unsafe/);
  const other = fixture(t);
  fs.symlinkSync(other.root, path.join(s.root, "outside-link"));
  assert.throws(() => safe(s.root, "outside-link/something"), /Symbolic/);
});
test("two actual Git worktrees resolve to one canonical board; branch changes pause writes", async (t) => {
  const s = fixture(t);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", s.root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  git("init", "-b", "main");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  );
  const worktree = path.join(s.root, "isolated");
  git("worktree", "add", "-b", "agent-task", worktree);
  await s.reconcile("main");
  const linked = new Store(worktree).initialize();
  assert.equal(linked.root, s.root);
  assert.equal(canonicalProject(worktree), s.root);
  const r = await ticket(s);
  assert.equal(linked.get(r.meta.id).meta.title, "Task");
  git("switch", "-c", "another-branch");
  assert.equal(s.state().branchChanged, true);
  await assert.rejects(ticket(linked), /changed branches/);
  await s.reconcile("another-branch");
  assert.equal((await ticket(linked)).meta.title, "Task");
});
test("a submodule shares its superproject's board only when one exists", async (t) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "workboard-test-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      "git",
      [
        "-C",
        cwd,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        ...args,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  const host = path.join(root, "host"),
    tool = path.join(host, "tool"),
    nested = path.join(tool, "src");
  fs.mkdirSync(nested, { recursive: true });
  git(host, "init", "-b", "main");
  git(tool, "init", "-b", "main");
  git(tool, "commit", "--allow-empty", "-m", "tool");
  git(host, "submodule", "add", "./tool", "tool");
  // A library submodule in a project without a board keeps its own root.
  assert.equal(canonicalProject(nested), tool);
  const board = new Store(host).initialize();
  assert.equal(canonicalProject(tool), host);
  assert.equal(canonicalProject(nested), host);
  const fromSubmodule = new Store(nested).initialize();
  assert.equal(fromSubmodule.root, host);
  assert.equal(fs.existsSync(path.join(tool, ".workboard")), false);
  const r = await ticket(board);
  assert.equal(fromSubmodule.get(r.meta.id).meta.title, "Task");
  // Explicit destinations (install/upgrade) are never redirected.
  assert.equal(canonicalProject(tool, false), tool);
});
test("API requires local authentication and rejects cross-origin writes", async (t) => {
  const s = fixture(t),
    app = await buildServer(s);
  t.after(() => app.close());
  const host = { host: "127.0.0.1" };
  assert.equal(
    (await app.inject({ url: "/api/state", headers: host })).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/state",
        headers: { ...host, authorization: `Bearer ${s.token()}` },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/records",
        headers: {
          ...host,
          authorization: `Bearer ${s.token()}`,
          origin: "https://example.com",
        },
        payload: {},
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        url: "/api/state",
        headers: { host: "evil.test", authorization: `Bearer ${s.token()}` },
      })
    ).statusCode,
    403,
  );
  // The router decodes percent-escapes, so encoded API paths must still require the token.
  for (const url of [
    "/%61pi/state",
    "/%61%70%69/state",
    "//api/state",
    "/API/state",
  ])
    assert.notEqual(
      (await app.inject({ url, headers: host })).statusCode,
      200,
      url,
    );
  const unauthenticated = await app.inject({
    method: "POST",
    url: "/%61pi/records",
    headers: host,
    payload: { kind: "ticket", meta: { title: "x" }, actor: human },
  });
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(s.list().length, 0);
  assert.equal(
    (await app.inject({ url: "/health", headers: host })).statusCode,
    200,
  );
});
test("API roundtrip, persistent preferences, and comment resolution", async (t) => {
  const s = fixture(t),
    app = await buildServer(s);
  t.after(() => app.close());
  const headers = { host: "127.0.0.1", authorization: `Bearer ${s.token()}` };
  const created = await app.inject({
    method: "POST",
    url: "/api/records",
    headers,
    payload: {
      kind: "ticket",
      meta: { title: "From API" },
      body: "Hello",
      actor: human,
    },
  });
  assert.equal(created.statusCode, 200);
  const r = created.json();
  const comment = await app.inject({
    method: "POST",
    url: `/api/records/${r.meta.id}/comments`,
    headers,
    payload: { body: "Which approach?", kind: "question", actor: a },
  });
  assert.equal(comment.statusCode, 200);
  const q = s.comments()[0];
  await app.inject({
    method: "PATCH",
    url: `/api/comments/${q.id}`,
    headers,
    payload: { revision: q.revision, resolved: true, actor: human },
  });
  assert.equal(s.comments()[0].resolved, true);
  await app.inject({
    method: "PATCH",
    url: "/api/preferences",
    headers,
    payload: { view: "rulebook", density: "compact" },
  });
  assert.equal(
    (await app.inject({ url: "/api/preferences", headers })).json().view,
    "rulebook",
  );
});
