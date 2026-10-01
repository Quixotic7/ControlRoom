import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs, validatePositionals } from "../src/client.js";
import { Store } from "../src/store.js";
import { buildServer } from "../src/server.js";
import { readAgentConfigProposal } from "../src/agent-config-proposals.js";

const run = promisify(execFile);
const cli = process.env.CONTROLROOM_TEST_CLI ?? path.resolve("src/cli.ts");
const loader = path.resolve("node_modules/tsx/dist/loader.mjs");
const agent = { name: "CLI proposal fixture", kind: "agent" as const };
const human = { name: "Isolated fixture owner", kind: "human" as const };
function command(root: string, args: string[], noStart = true) {
  return run(
    process.execPath,
    [
      "--import",
      loader,
      cli,
      "--project",
      root,
      "--agent",
      "--actor",
      agent.name,
      ...(noStart ? ["--no-start"] : []),
      ...args,
    ],
    {
      cwd: root,
      timeout: 15000,
      env: { ...process.env, CONTROLROOM_ACTOR_KIND: "agent" },
    },
  );
}

test("argument parsing rejects unknown flags and missing values while preserving literal and repeated values", () => {
  const parsed = parseArgs([
    "agents",
    "propose",
    "--brief-file",
    "brief with spaces.md",
    "--set",
    "priority=1",
    "--set=labels=ui,agent",
    "--body=--literal text",
    "--title",
    "",
    "--json",
  ]);
  assert.deepEqual(parsed.positional, ["agents", "propose"]);
  assert.equal(parsed.option("brief-file"), "brief with spaces.md");
  assert.equal(parsed.option("body"), "--literal text");
  assert.equal(parsed.option("title"), "");
  assert.deepEqual(parsed.all("set"), ["priority=1", "labels=ui,agent"]);
  assert.equal(parsed.has("json"), true);
  for (const args of [["--brief-fiel", "file"], ["--unknown=value"], ["-x"]])
    assert.throws(() => parseArgs(args), /Unknown option/);
  for (const args of [
    ["--brief-file"],
    ["--brief-file", "--json"],
    ["--port", "--lan"],
  ])
    assert.throws(() => parseArgs(args), /requires a value/);
  assert.throws(() => parseArgs(["--json=false"]), /does not take a value/);
  assert.deepEqual(parseArgs(["show", "--", "--literal-id"]).positional, [
    "show",
    "--literal-id",
  ]);
  assert.equal(parseArgs(["-h"]).has("help"), true);
});

test("command arity refuses ignored arguments without rejecting supported command forms", () => {
  for (const args of [
    ["agents", "propose", "stray.md"],
    ["list", "stray"],
    ["show", "4", "extra"],
    ["agents", "status", "extra"],
    ["skills", "install", "/tmp", "extra"],
  ])
    assert.throws(() => validatePositionals(args), /Unexpected positional/);
  for (const args of [
    ["agents"],
    ["agents", "review", "run-1"],
    ["skills", "install"],
    ["skills", "install", "/tmp"],
    ["create", "ticket"],
    ["move", "1", "progress"],
    ["merge-preview", "1", "2"],
    ["import", "stage"],
    ["show", "#0"],
  ])
    assert.doesNotThrow(() => validatePositionals(args));
});

test("CLI errors on invalid arguments before creating a project or contacting a service", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cr-cli-invalid-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const args of [
    ["init", "--made-up", "value"],
    ["init", "extra"],
    ["agents", "propose", "--brief-file"],
    ["agents", "propose", "stray.md"],
    ["agents", "propose", "--brief-file="],
    ["serve", "--port", "--lan"],
  ]) {
    await assert.rejects(command(root, args, false), (e: any) => {
      assert.equal(e.code, 1);
      assert.match(
        e.stderr,
        /Unknown option|Unexpected positional|requires a value|Provide a path/,
      );
      assert.ok(
        !e.stderr.includes("at parseArgs"),
        "CLI errors should not emit an internal stack",
      );
      return true;
    });
    assert.equal(fs.existsSync(path.join(root, ".controlroom")), false);
  }
});

test("CLI stages the complete brief and applying its proposal writes the worker brief", async (t) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-cli-brief-")),
  );
  const store = new Store(root).initialize("CLI brief fixture");
  const app = await buildServer(store);
  const url = await app.listen({ host: "127.0.0.1", port: 0 });
  fs.writeFileSync(
    store.file(".local/service.json"),
    JSON.stringify({ url, pid: process.pid }),
  );
  t.after(async () => {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const statusResponse = await app.inject({
    method: "GET",
    url: "/api/orchestration",
    headers: {
      host: new URL(url).host,
      authorization: `Bearer ${store.token()}`,
    },
  });
  assert.equal(statusResponse.statusCode, 200, statusResponse.body);
  const status = statusResponse.json();
  const configFile = path.join(root, "saved config.json"),
    briefFile = path.join(root, "worker brief.md");
  fs.writeFileSync(configFile, JSON.stringify(status.config));
  const brief =
    "# JuiceLab build guidance\n\nPreserve **project instructions** and Unicode: café.\n\n- Run the approved checks.\n";
  fs.writeFileSync(briefFile, brief);
  const staged = JSON.parse(
    (
      await command(root, [
        "agents",
        "propose",
        "--file",
        configFile,
        "--brief-file",
        briefFile,
        "--etag",
        status.revision,
        "--json",
      ])
    ).stdout,
  );
  assert.equal(staged.workerBrief, brief);
  assert.equal(staged.baseWorkerBrief, "");
  assert.equal(readAgentConfigProposal(store, staged.id).workerBrief, brief);
  assert.deepEqual(staged.proposedBy, agent);
  assert.equal(
    fs.existsSync(store.file("agents/worker-brief.md")),
    false,
    "Staging must not apply authority/guidance",
  );
  const applied = await app.inject({
    method: "POST",
    url: `/api/orchestration/proposals/${staged.id}/apply`,
    headers: {
      host: new URL(url).host,
      authorization: `Bearer ${store.token()}`,
    },
    payload: { actor: human, revision: staged.revision },
  });
  assert.equal(applied.statusCode, 200, applied.body);
  assert.equal(
    fs.readFileSync(store.file("agents/worker-brief.md"), "utf8"),
    brief,
  );
  assert.equal(applied.json().workerBrief.content, brief);
  // Omission preserves the now-active brief; an explicit empty file can clear it.
  const omitted = JSON.parse(
    (await command(root, ["agents", "propose", "--file", configFile, "--json"]))
      .stdout,
  );
  assert.equal(omitted.workerBrief, undefined);
  fs.writeFileSync(briefFile, "");
  const cleared = JSON.parse(
    (
      await command(root, [
        "agents",
        "propose",
        "--file",
        configFile,
        `--brief-file=${briefFile}`,
        "--json",
      ])
    ).stdout,
  );
  assert.equal(cleared.workerBrief, "");
  assert.equal(cleared.baseWorkerBrief, brief);
  await assert.rejects(
    command(root, [
      "agents",
      "propose",
      "--file",
      configFile,
      "--brief-file=",
      "--json",
    ]),
    /Provide a path/,
  );
  await assert.rejects(
    command(root, [
      "agents",
      "propose",
      "--file",
      configFile,
      "--brief-file",
      path.join(root, "missing.md"),
      "--json",
    ]),
    /ENOENT/,
  );
});
