import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { Orchestrator, defaultOrchestration } from "../src/orchestration.js";
import {
  readAgentConfigProposal,
  proposalPath,
} from "../src/agent-config-proposals.js";
const agent = { name: "Coordinator", kind: "agent" as const },
  human = { name: "Owner", kind: "human" as const };
function fixture(t: test.TestContext) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-proposals-")),
  );
  const store = new Store(root).initialize("Proposals"),
    manager = new Orchestrator(store);
  t.after(async () => {
    await manager.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { store, manager };
}

test("agent proposals preserve live authority, appear in attention and survive reconstruction; only human applies", async (t) => {
  const { store, manager } = fixture(t),
    before = manager.status(),
    stateBefore = store.state().revision;
  const config = {
    ...structuredClone(before.config),
    maxTurns: 40,
    humanPolicy: "all" as const,
  };
  const p = await manager.proposeConfig(config, before.revision, agent);
  assert.deepEqual(manager.config(), before.config);
  assert.equal(manager.status().runs.length, 0);
  assert.equal(store.state().agentConfigProposals?.[0].id, p.id);
  assert.notEqual(store.state().revision, stateBefore);
  assert.deepEqual(
    readAgentConfigProposal(new Store(store.root), p.id).config,
    config,
  );
  await assert.rejects(
    manager.applyConfigProposal(p.id, p.revision, agent),
    /human/,
  );
  await assert.rejects(
    manager.discardConfigProposal(p.id, p.revision, agent),
    /human/,
  );
  await assert.rejects(
    manager.configure(config, before.revision, agent),
    /human/,
  );
  const applied = await manager.applyConfigProposal(p.id, p.revision, human);
  assert.equal(applied.config.maxTurns, 40);
  assert.equal(applied.config.enabled, false);
  assert.equal(applied.runs.length, 0);
  assert.equal(store.state().agentConfigProposals?.length, 0);
  const receipt = readAgentConfigProposal(store, p.id);
  assert.equal(receipt.status, "applied");
  assert.deepEqual(receipt.proposedBy, agent);
  assert.deepEqual(receipt.decidedBy, human);
  const history = fs
    .readFileSync(store.file("records/history.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((x) => JSON.parse(x));
  const event = history.find(
    (e) => e.action === "agent configuration proposal applied",
  );
  assert.deepEqual(event.after.proposedBy, agent);
  assert.deepEqual(event.after.approvedBy, human);
  assert.equal(
    fs.existsSync(store.file(".local/record-transaction.json")),
    false,
  );
  await assert.rejects(
    manager.applyConfigProposal(p.id, p.revision, human),
    /Proposal changed/,
  );
});

test("stale configuration or proposal content refuses approval; discard retains history without changing config", async (t) => {
  const { store, manager } = fixture(t),
    initial = manager.status();
  const p = await manager.proposeConfig(
    { ...initial.config, maxTurns: 45 },
    initial.revision,
    agent,
  );
  await manager.configure(
    { ...initial.config, concurrency: 3 },
    initial.revision,
    human,
  );
  await assert.rejects(
    manager.applyConfigProposal(p.id, p.revision, human),
    /stale/,
  );
  assert.equal(manager.config().maxTurns, 30);
  await manager.discardConfigProposal(p.id, p.revision, human);
  assert.equal(readAgentConfigProposal(store, p.id).status, "discarded");
  const p2 = await manager.proposeConfig(
    { ...manager.config(), maxTurns: 50 },
    undefined,
    agent,
  );
  const raw = JSON.parse(
    fs.readFileSync(store.file(proposalPath(p2.id)), "utf8"),
  );
  raw.config.maxTurns = 51;
  fs.writeFileSync(store.file(proposalPath(p2.id)), JSON.stringify(raw));
  await assert.rejects(
    manager.applyConfigProposal(p2.id, p2.revision, human),
    /Proposal changed/,
  );
  assert.equal(manager.config().maxTurns, 30);
  await assert.rejects(
    manager.proposeConfig(initial.config, initial.revision, agent),
    /changed/,
  );
  await assert.rejects(
    manager.proposeConfig(
      { ...initial.config, enabled: true },
      undefined,
      agent,
    ),
    /repository/,
  );
  await assert.rejects(
    manager.proposeConfig(
      { ...initial.config, workers: [initial.config.reviewer] },
      undefined,
      agent,
    ),
    /distinct/,
  );
});

test("proposal transaction recovery restores config, proposal and audit together", async (t) => {
  const { store, manager } = fixture(t),
    p = await manager.proposeConfig(
      { ...defaultOrchestration, maxTurns: 40 },
      undefined,
      agent,
    );
  const files = ["config.yml", proposalPath(p.id), "records/history.jsonl"].map(
    (relative) => ({
      path: relative,
      before: fs.readFileSync(store.file(relative), "utf8"),
      after:
        relative === "config.yml"
          ? fs.readFileSync(store.file(relative), "utf8") + "# interrupted\n"
          : "changed",
    }),
  );
  fs.writeFileSync(
    store.file(".local/record-transaction.json"),
    JSON.stringify({ files }),
  );
  fs.writeFileSync(store.file("config.yml"), files[0].after);
  new Store(store.root).initialize();
  for (const f of files)
    assert.equal(fs.readFileSync(store.file(f.path), "utf8"), f.before);
  assert.equal(readAgentConfigProposal(store, p.id).status, "pending");
});

test("malformed proposal files surface in state, and path traversal is rejected", async (t) => {
  const { store, manager } = fixture(t);
  fs.mkdirSync(store.file("records/agent-proposals"), { recursive: true });
  fs.writeFileSync(
    store.file("records/agent-proposals/agent-proposal-abc.json"),
    "bad-json",
  );
  assert.ok(
    store.state().errors.some((e) => e.path.includes("agent-proposals")),
  );
  await assert.rejects(
    manager.applyConfigProposal("../../config.yml", "bad", human),
    /Invalid/,
  );
});


test("worker brief proposal applies atomically and brief edits invalidate proposals", async (t) => {
  const {store,manager} = fixture(t);
  const original = manager.status();
  const p = await manager.proposeConfig(original.config, original.revision, agent, "# Build\nUse the project caches.");
  assert.equal(manager.workerBrief().content, "");
  await manager.applyConfigProposal(p.id,p.revision,human);
  assert.equal(manager.workerBrief().content, "# Build\nUse the project caches.");
  assert.equal(readAgentConfigProposal(store,p.id).status,"applied");
  const next = await manager.proposeConfig(manager.config(),undefined,agent,"Replacement");
  await manager.configure(manager.config(),manager.status().revision,human,"Human edit");
  await assert.rejects(manager.applyConfigProposal(next.id,next.revision,human), /stale/);
  assert.equal(manager.workerBrief().content,"Human edit");
  const preserved = await manager.proposeConfig(manager.config(),undefined,agent);
  await manager.applyConfigProposal(preserved.id,preserved.revision,human);
  assert.equal(manager.workerBrief().content,"Human edit");
});
