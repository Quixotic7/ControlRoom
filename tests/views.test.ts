import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  attentionReason,
  context,
  groupTickets,
  matches,
  parseFilter,
  sortTickets,
} from "../web/model.js";
import { Store, defaultColumns } from "../src/store.js";
import { hash, read } from "../src/files.js";
import type { Meta, ProjectState, RecordFile } from "../src/types.js";

let n = 0;
function ticket(meta: Partial<Meta>, body = ""): RecordFile {
  const id = meta.id ?? `WB-${n}`;
  const number = meta.number ?? n++;
  return {
    meta: {
      schema: 1,
      kind: "ticket",
      title: `Ticket ${number}`,
      status: "backlog",
      createdAt: `2026-01-01T00:00:${String(number).padStart(2, "0")}Z`,
      updatedAt: "2026-01-01T00:00:00Z",
      author: { name: "You", kind: "human" },
      ...meta,
      id,
      number,
    } as Meta,
    body,
    revision: `rev-${id}`,
    path: `records/tickets/${id}.md`,
  };
}
function stateOf(records: RecordFile[], extra: Partial<ProjectState> = {}) {
  return {
    config: {
      schema: 1,
      projectId: "project-1",
      name: "Test",
      columns: defaultColumns,
      shortcut: { key: 1, modifiers: 0, label: "" },
    },
    configRevision: "",
    records,
    comments: [],
    attachments: [],
    claims: [],
    errors: [],
    branch: "main",
    canonical: "/",
    branchChanged: false,
    acknowledgedBranch: "main",
    revision: "",
    ...extra,
  } as ProjectState;
}

test("filters parse GitHub-style keys, negation, lists, quotes, and free text", () => {
  assert.deepEqual(
    parseFilter('login -label:wip,draft owner:"Agent A" is:blocked bogus:x'),
    {
      text: ["login", "bogus:x"],
      terms: [
        { key: "label", values: ["wip", "draft"], negate: true },
        { key: "owner", values: ["agent a"], negate: false },
        { key: "is", values: ["blocked"], negate: false },
      ],
    },
  );
  assert.deepEqual(parseFilter("   "), { text: [], terms: [] });
});

test("filters match status names, labels, owners, priority, parent, and flags", () => {
  const goal = ticket({ id: "WB-goal", number: 10, title: "Checkout goal" });
  const a = ticket({
    id: "WB-a",
    title: "Fix login button",
    status: "progress",
    labels: ["UI", "forms"],
    owner: "Agent A",
    priority: 1,
    parent: "WB-goal",
  });
  const b = ticket({ id: "WB-b", title: "Write docs", blocked: "Waiting" });
  const s = stateOf([goal, a, b], {
    claims: [
      {
        ticket: "WB-b",
        actor: { name: "x", kind: "agent" },
        worktree: "/w",
        reportedAt: "",
        expiresAt: "2999-01-01T00:00:00Z",
      },
    ],
  });
  const ctx = context(s);
  const pick = (q: string) =>
    [goal, a, b]
      .filter((r) => matches(r, parseFilter(q), ctx))
      .map((r) => r.meta.id);
  assert.deepEqual(pick('status:"In Progress"'), ["WB-a"]);
  assert.deepEqual(pick("status:progress"), ["WB-a"]);
  assert.deepEqual(pick("label:ui"), ["WB-a"]);
  assert.deepEqual(pick("-label:ui"), ["WB-goal", "WB-b"]);
  assert.deepEqual(pick('owner:"agent a"'), ["WB-a"]);
  assert.deepEqual(pick("priority:high"), ["WB-a"]);
  assert.deepEqual(pick("parent:#10"), ["WB-a"]);
  assert.deepEqual(pick("parent:checkout"), ["WB-a"]);
  assert.deepEqual(pick("is:blocked"), ["WB-b"]);
  assert.deepEqual(pick("is:claimed"), ["WB-b"]);
  assert.deepEqual(pick("is:parent"), ["WB-goal"]);
  assert.deepEqual(pick("no:owner"), ["WB-goal", "WB-b"]);
  assert.deepEqual(pick("login"), ["WB-a"]);
  assert.deepEqual(pick("#10"), ["WB-goal"]);
  assert.deepEqual(pick("label:ui,missing is:open"), ["WB-a"]);
});

test("number lookup matches exact public numbers and retains other constraints", () => {
  const records = [
    ticket({
      id: "WB-a",
      number: 36,
      title: "Screenshot feedback",
      archived: true,
      status: "done",
      owner: "Ana",
    }),
    ticket({ id: "WB-b", number: 136, title: "Other ticket" }),
    ticket(
      { id: "WB-36abc", number: 7, title: "Reference 36", owner: "Ana" },
      "version 2",
    ),
    ticket({ id: "WB-zero", number: 0, title: "First ticket" }),
  ];
  const ctx = context(stateOf(records));
  const pick = (query: string) =>
    records
      .filter((r) => matches(r, parseFilter(query), ctx))
      .map((r) => r.meta.number);
  assert.deepEqual(pick("36"), [36]);
  assert.deepEqual(pick("#36"), [36]);
  assert.deepEqual(pick("036 owner:ana status:done"), [36]);
  assert.deepEqual(pick("36 -is:archived"), []);
  assert.deepEqual(pick("36 status:progress"), []);
  assert.deepEqual(pick("36 owner:other"), []);
  assert.deepEqual(pick("0"), [0]);
  assert.deepEqual(pick("#0"), [0]);
  assert.deepEqual(pick("99999999999999999999999"), []);
  assert.deepEqual(pick("version 2"), [7]);
});

test("grouping by parent heads each goal and keeps children nested", () => {
  const goal = ticket({ id: "WB-g", number: 1, title: "Goal" });
  const child = ticket({ id: "WB-c", number: 2, parent: "WB-g" });
  const grandchild = ticket({ id: "WB-gc", number: 3, parent: "WB-c" });
  const loose = ticket({ id: "WB-l", number: 4 });
  const s = stateOf([goal, child, grandchild, loose]);
  const groups = groupTickets(
    [loose, grandchild, goal, child],
    "parent",
    context(s),
  );
  assert.deepEqual(
    groups.map((g) => [
      g.key,
      g.record?.meta.id,
      g.items.map((r) => r.meta.id),
    ]),
    [
      ["WB-g", "WB-g", ["WB-c", "WB-gc"]],
      ["none", undefined, ["WB-l"]],
    ],
  );
  assert.equal(groups[0].defaults.parent, "WB-g");
});

test("grouping by status, priority, owner, and label; sorting", () => {
  const a = ticket({
    id: "A",
    status: "review",
    priority: 0,
    owner: "Ana",
    labels: ["x", "y"],
  });
  const b = ticket({ id: "B", status: "backlog", priority: 3, labels: [] });
  const ctx = context(stateOf([a, b]));
  const keys = (g: ReturnType<typeof groupTickets>) =>
    g.map((x) => `${x.title}:${x.items.map((r) => r.meta.id).join("")}`);
  assert.deepEqual(keys(groupTickets([a, b], "status", ctx)), [
    "Backlog:B",
    "Review:A",
  ]);
  assert.deepEqual(keys(groupTickets([a, b], "priority", ctx)), [
    "Urgent:A",
    "Low:B",
  ]);
  assert.deepEqual(keys(groupTickets([a, b], "owner", ctx)), [
    "Ana:A",
    "No owner:B",
  ]);
  assert.deepEqual(keys(groupTickets([a, b], "label", ctx)), [
    "x:A",
    "y:A",
    "No labels:B",
  ]);
  assert.deepEqual(keys(groupTickets([a, b], "none", ctx)), ["All tickets:AB"]);
  assert.deepEqual(
    sortTickets([b, a], "priority").map((r) => r.meta.id),
    ["A", "B"],
  );
  assert.deepEqual(
    sortTickets([a, b], "title").map((r) => r.meta.title),
    [a.meta.title, b.meta.title].sort(),
  );
});

test("attention covers blockers, reviews, open questions, and changed rules", () => {
  const rule = {
    ...ticket({ id: "UI-r" }),
    meta: { ...ticket({ id: "UI-r" }).meta, kind: "rule", status: "active" },
  } as RecordFile;
  const blocked = ticket({
    id: "WB-b",
    blocked: "Needs keys",
    reviewedRules: { "UI-r": rule.revision },
  });
  const review = ticket({
    id: "WB-r",
    status: "review",
    reviewedRules: { "UI-r": rule.revision },
  });
  const asked = ticket({
    id: "WB-q",
    reviewedRules: { "UI-r": rule.revision },
  });
  const stale = ticket({ id: "WB-s", reviewedRules: { "UI-r": "old" } });
  const calm = ticket({ id: "WB-c", reviewedRules: { "UI-r": rule.revision } });
  const doneStale = ticket({ id: "WB-d", status: "done", reviewedRules: {} });
  const unlinked = ticket({ id: "WB-u", reviewedRules: {} });
  const explicit = ticket({
    id: "WB-e",
    reviewedRules: {},
    rules: ["UI-r"],
  });
  const s = stateOf(
    [rule, blocked, review, asked, stale, calm, doneStale, unlinked, explicit],
    {
      comments: [
        {
          id: "c1",
          ticket: "WB-q",
          actor: { name: "a", kind: "agent" },
          at: "",
          kind: "question",
          body: "?",
          resolved: false,
          revision: "",
        },
      ],
    },
  );
  const ctx = context(s);
  assert.deepEqual(
    [blocked, review, asked, stale, calm, doneStale, unlinked, explicit].map(
      (r) => attentionReason(r, s, ctx),
    ),
    ["blocked", "review", "question", "rules", null, null, null, "rules"],
  );
});

test("failed managed retry stays in attention even if its question could not reopen", () => {
  const ticketRecord = ticket({ status: "progress" });
  const state = stateOf([ticketRecord], {
    comments: [
      {
        id: "question",
        ticket: ticketRecord.meta.id,
        actor: { name: "Agent", kind: "agent" },
        at: "",
        kind: "question",
        body: "Choose a behavior",
        resolved: true,
        revision: "saved",
      },
    ],
    managedQuestions: {
      question: {
        runId: "run",
        state: "recovery",
        canAct: true,
        error: "Question could not be reopened",
      },
    },
  });
  assert.equal(
    attentionReason(ticketRecord, state, context(state)),
    "question",
  );
  state.managedQuestions!.question.canAct = false;
  assert.equal(attentionReason(ticketRecord, state, context(state)), null);
});

test("saved views are validated in the project configuration", async (t) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "workboard-test-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const s = new Store(root).initialize("Views");
  const revision = () => hash(read(s.file("config.yml")));
  const view = {
    id: "mine",
    name: "My work",
    layout: "table",
    filter: "owner:You",
    groupBy: "status",
    sort: "updated",
  };
  await s.updateConfig(revision(), { views: [view] } as any);
  assert.deepEqual(s.config().views, [view]);
  await assert.rejects(
    s.updateConfig(revision(), { views: [view, view] } as any),
    /unique/,
  );
  await assert.rejects(
    s.updateConfig(revision(), {
      views: [{ ...view, layout: "gantt" }],
    } as any),
  );
  assert.deepEqual(s.config().views, [view]);
});

test("status display edits and ordering preserve ticket IDs, history, and views", async (t) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "workboard-test-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const s = new Store(root).initialize("Workflow");
  const revision = () => hash(read(s.file("config.yml")));
  const human = { name: "Human", kind: "human" } as const;
  const view = {
    id: "triage",
    name: "Triage",
    layout: "board",
    filter: "status:backlog",
    groupBy: "none",
    sort: "manual",
  };
  await s.updateConfig(revision(), { views: [view] } as any);
  const ticket = await s.create(
    "ticket",
    { title: "Keep association", status: "backlog" },
    "",
    human,
  );
  await s.comment(ticket.meta.id, "History remains attached", human);
  const before = s.get(ticket.meta.id);
  const columns = [
    { id: "concept", name: "Concept", role: "backlog" as const },
    ...s
      .config()
      .columns.map((column) =>
        column.id === "backlog" ? { ...column, name: "Ideas" } : column,
      ),
  ];
  await s.updateConfig(revision(), { columns } as any);
  assert.equal(s.get(ticket.meta.id).meta.status, "backlog");
  assert.equal(s.get(ticket.meta.id).revision, before.revision);
  assert.equal(s.historyFor(ticket.meta.id).length, 1);
  assert.deepEqual(s.config().views, [view]);
  assert.equal(
    s.config().columns.find((column) => column.role === "backlog")?.id,
    "concept",
  );
  const staleRevision = revision();
  await s.updateConfig(staleRevision, { name: "Workflow renamed" } as any);
  await assert.rejects(
    s.updateConfig(staleRevision, { name: "Stale overwrite" } as any),
    /Configuration changed/,
  );
  await assert.rejects(
    s.updateConfig(revision(), {
      columns: s.config().columns.filter((column) => column.id !== "backlog"),
    } as any),
    /Move tickets out of backlog before removing it/,
  );
});
