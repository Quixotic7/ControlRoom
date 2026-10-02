import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { Store } from "../src/store.js";
import { buildServer } from "../src/server.js";
import { defaultOrchestration } from "../src/orchestration.js";

const run = promisify(execFile),
  cli = path.resolve("src/cli.ts"),
  loader = path.resolve("node_modules/tsx/dist/loader.mjs");
const owner = { name: "Fixture owner", kind: "human" as const },
  reviewer = { name: "Chat fixture", kind: "agent" as const };
const scopes = {
  approveScope: true,
  manageBoard: true,
  reviewWork: true,
  manageRuns: false,
};
async function fixture(t: test.TestContext) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-delegation-protocol-")),
  );
  const store = new Store(root).initialize("Delegation protocol fixture");
  await store.updateConfig(
    store.configRevision(),
    {
      orchestration: {
        ...structuredClone(defaultOrchestration),
        enabled: true,
        reviewerMode: "chat",
        repository: root,
        reviewer: { ...defaultOrchestration.reviewer, name: reviewer.name },
      },
    },
    owner,
  );
  const app = await buildServer(store),
    url = await app.listen({ host: "127.0.0.1", port: 0 });
  fs.writeFileSync(
    store.file(".local/service.json"),
    JSON.stringify({ url, pid: process.pid }),
  );
  const headers = {
    host: new URL(url).host,
    authorization: `Bearer ${store.token()}`,
  };
  const request = (method: any, route: string, payload?: Record<string, any>) =>
    app.inject({ method, url: route, headers, payload });
  const configure = async (enabled = true) => {
    const status = (
      await request("GET", "/api/orchestration/delegation")
    ).json();
    const reply = await request("PUT", "/api/orchestration/delegation", {
      revision: status.revision,
      enabled,
      scopes,
      actor: owner,
    });
    assert.equal(reply.statusCode, 200, reply.body);
    return reply.json();
  };
  const command = (args: string[], name = reviewer.name) =>
    run(
      process.execPath,
      [
        "--import",
        loader,
        cli,
        "--project",
        root,
        "--no-start",
        "--agent",
        "--actor",
        name,
        "--json",
        ...args,
      ],
      { cwd: root, timeout: 15000 },
    );
  t.after(async () => {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, store, app, request, configure, command };
}

test("CLI chat decisions retain agent attribution, audit, reject stale/off/wrong identity, and support guarded Undo", async (t) => {
  const f = await fixture(t),
    ticket = await f.store.create(
      "ticket",
      { title: "Approve from chat" },
      "Custom Markdown",
      owner,
    );
  const decision = [
    "--on-behalf",
    "I approve this ticket. Please start.",
    "--said-at",
    new Date().toISOString(),
  ];
  await assert.rejects(
    f.command([
      "approve",
      String(ticket.meta.number),
      "--etag",
      ticket.revision,
      ...decision,
    ]),
    /delegation is not enabled/,
  );
  await f.configure();
  await assert.rejects(
    f.command(
      [
        "approve",
        String(ticket.meta.number),
        "--etag",
        ticket.revision,
        ...decision,
      ],
      "Other worker",
    ),
    /configured chat reviewer/,
  );
  await assert.rejects(
    f.command([
      "approve",
      String(ticket.meta.number),
      "--etag",
      ticket.revision,
    ]),
    /on-behalf/,
  );
  await f.command([
    "approve",
    String(ticket.meta.number),
    "--etag",
    ticket.revision,
    ...decision,
  ]);
  const approved = f.store.get(ticket.meta.id);
  assert.equal(approved.meta.scopeApproved, true);
  assert.equal(approved.meta.scopeApprovedBy?.kind, "agent");
  assert.equal(approved.body, ticket.body);
  const status = JSON.parse((await f.command(["agents", "delegation"])).stdout);
  const receipt = status.receipts.find(
    (r: any) => r.action === "approve_scope",
  );
  assert.equal(receipt.actor.kind, "agent");
  assert.equal(receipt.grantingHuman.name, owner.name);
  assert.equal(receipt.basis.quote, decision[1]);
  await assert.rejects(
    f.command([
      "move",
      String(ticket.meta.number),
      "progress",
      "--etag",
      ticket.revision,
      ...decision,
    ]),
    /changed|revision/i,
  );
  const agentUndo = await f.request(
    "POST",
    `/api/orchestration/delegation/${receipt.id}/undo`,
    { revision: receipt.revision, actor: reviewer },
  );
  assert.equal(agentUndo.statusCode, 403);
  const humanUndo = await f.request(
    "POST",
    `/api/orchestration/delegation/${receipt.id}/undo`,
    { revision: receipt.revision, actor: owner },
  );
  assert.equal(humanUndo.statusCode, 200, humanUndo.body);
  assert.equal(!!f.store.get(ticket.meta.id).meta.scopeApproved, false);
  await f.configure(false);
  await assert.rejects(
    f.command([
      "approve",
      String(ticket.meta.number),
      "--etag",
      f.store.get(ticket.meta.id).revision,
      ...decision,
    ]),
    /delegation is not enabled/,
  );
  assert.ok(
    f.store.delegationStatus().receipts.some((r) => r.undoOf === receipt.id),
  );
});

test("CLI delegates review, board edits and duplicate merge through the shared action endpoint", async (t) => {
  const f = await fixture(t);
  await f.configure();
  const basis = [
    "--on-behalf",
    "Accept this result and merge the duplicate.",
    "--said-at",
    new Date().toISOString(),
  ];
  let ticket = await f.store.create(
    "ticket",
    { title: "Reviewed fixture", status: "review" },
    "Keep custom prose",
    owner,
  );
  await f.command([
    "accept",
    ticket.meta.id,
    "--etag",
    ticket.revision,
    ...basis,
  ]);
  ticket = f.store.get(ticket.meta.id);
  assert.equal(ticket.meta.status, "done");
  assert.equal((ticket.meta.acceptedBy as { kind: string })?.kind, "agent");
  assert.equal(ticket.meta.acceptedDelegation?.grantingHuman.name, owner.name);
  const second = await f.store.create(
    "ticket",
    { title: "Changes fixture", status: "review", scopeApproved: true },
    "",
    owner,
  );
  await f.command([
    "request-changes",
    second.meta.id,
    "--etag",
    second.revision,
    ...basis,
  ]);
  assert.equal(f.store.get(second.meta.id).meta.status, "progress");
  const survivor = await f.store.create(
    "ticket",
    { title: "Survivor" },
    "Keep this",
    owner,
  );
  const duplicate = await f.store.create(
    "ticket",
    { title: "Duplicate" },
    "Keep that",
    owner,
  );
  const preview = f.store.mergePreview(survivor.meta.id, duplicate.meta.id);
  const mergeFile = path.join(f.root, "merge.json");
  fs.writeFileSync(
    mergeFile,
    JSON.stringify({
      source: duplicate.meta.id,
      requestId: "delegation-protocol-merge",
      revisions: preview.affected,
      resolutions: {},
    }),
  );
  await f.command([
    "merge",
    survivor.meta.id,
    duplicate.meta.id,
    "--file",
    mergeFile,
    ...basis,
  ]);
  assert.equal(
    f.store.get(duplicate.meta.id).meta.duplicateOf,
    survivor.meta.id,
  );
  assert.ok(
    f.store
      .delegationStatus()
      .receipts.some((r) => r.action === "merge_duplicate"),
  );
});

test("MCP exposes delegated actions with required basis and uses the same live grant", async (t) => {
  const f = await fixture(t);
  await f.configure();
  const ticket = await f.store.create(
    "ticket",
    { title: "MCP approval" },
    "",
    owner,
  );
  const child = spawn(
    process.execPath,
    [
      "--import",
      loader,
      cli,
      "--project",
      f.root,
      "--no-start",
      "--agent",
      "--actor",
      reviewer.name,
      "mcp",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  t.after(() => child.kill());
  let buffer = "",
    seq = 0;
  const pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const p = pending.get(message.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(message.id);
        p.resolve(message);
      }
    }
  });
  const rpc = (method: string, params?: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("MCP response timed out"));
      }, 10000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "Delegation test", version: "1" },
  });
  const list = await rpc("tools/list");
  for (const name of [
    "approve_ticket",
    "accept_ticket",
    "archive_ticket",
    "resolve_managed_question",
    "resume_managed_run",
    "get_delegation",
  ])
    assert.ok(
      list.result.tools.some((tool: any) => tool.name === name),
      name,
    );
  const call = (name: string, args: unknown) =>
    rpc("tools/call", { name, arguments: args });
  const absent = await call("approve_ticket", {
    id: ticket.meta.id,
    etag: ticket.revision,
  });
  assert.equal(absent.result.isError, true);
  const approved = await call("approve_ticket", {
    id: ticket.meta.id,
    etag: ticket.revision,
    on_behalf: "Approve this MCP fixture ticket.",
    said_at: new Date().toISOString(),
  });
  assert.ok(!approved.result.isError, JSON.stringify(approved));
  assert.equal(f.store.get(ticket.meta.id).meta.scopeApproved, true);
  const fresh = f.store.get(ticket.meta.id);
  const archived = await call("archive_ticket", {
    id: ticket.meta.id,
    etag: fresh.revision,
    on_behalf: "Withdraw and archive this ticket.",
    said_at: new Date().toISOString(),
  });
  assert.ok(!archived.result.isError, JSON.stringify(archived));
  assert.equal(f.store.get(ticket.meta.id).meta.archived, true);
  assert.equal(
    f.store.delegationStatus().receipts.filter((r) => r.actor.kind === "agent")
      .length,
    2,
  );
});

test("delegation CLI rejects incomplete basis and unsupported delegation flags before creating a board", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cr-basis-invalid-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const args of [
    ["approve", "0"],
    ["approve", "0", "--on-behalf", "Approve"],
    ["init", "--on-behalf", "Grant", "--said-at", "2026-01-01T00:00Z"],
    [
      "approve",
      "0",
      "--latest",
      "--on-behalf",
      "Approve",
      "--said-at",
      "2026-01-01T00:00Z",
    ],
  ]) {
    await assert.rejects(
      run(process.execPath, [
        "--import",
        loader,
        cli,
        "--project",
        root,
        ...args,
      ]),
      /on-behalf|Delegated actions|only supported/,
    );
    assert.equal(fs.existsSync(path.join(root, ".controlroom")), false);
  }
});
