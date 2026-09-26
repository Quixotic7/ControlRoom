import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const root = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "workboard-install-")),
);
const original = path.resolve("workboard");
const run = (args: string[]) =>
  execFileSync(path.join(root, ".workboard", "workboard"), args, {
    cwd: root,
    encoding: "utf8",
    timeout: 20000,
  });
try {
  execFileSync(original, ["install", root], {
    encoding: "utf8",
    timeout: 60000,
  });
  assert.ok(fs.existsSync(path.join(root, "Workboard.command")));
  assert.match(run(["help"]), /Control Room/);
  const record = JSON.parse(
    run(["create", "ticket", "--title", "Installed tool works", "--json"]),
  );
  assert.equal(record.meta.title, "Installed tool works");
  assert.equal(JSON.parse(run(["list", "--json"])).length, 1);
  const ctx = JSON.parse(run(["context", record.meta.id, "--json"]));
  assert.equal(ctx.ticket.meta.id, record.meta.id);
  run(["serve"]);
  const service = JSON.parse(
    fs.readFileSync(
      path.join(root, ".workboard", ".local", "service.json"),
      "utf8",
    ),
  );
  const health = (await (await fetch(service.url + "/health")).json()) as {
    project: string;
  };
  const registration = JSON.parse(
    fs.readFileSync(
      path.join(
        os.tmpdir(),
        `workboard-capture-${process.getuid?.() ?? "user"}`,
        `${health.project}.json`,
      ),
      "utf8",
    ),
  );
  assert.equal(
    registration.pid,
    service.pid,
    "Capture registration belongs to the persistent service",
  );
  console.log(
    "Installed launcher, copied runtime, service autostart, create/list/context: passed",
  );
  run(["stop"]);
  for (
    let i = 0;
    i < 40 &&
    fs.existsSync(path.join(root, ".workboard", ".local", "service.lock"));
    i++
  )
    await new Promise((r) => setTimeout(r, 100));
  execFileSync(original, ["upgrade", root], {
    encoding: "utf8",
    timeout: 60000,
  });
  assert.equal(JSON.parse(run(["list", "--json"]))[0].meta.id, record.meta.id);
  console.log("Upgrade preserved project records: passed");
} finally {
  try {
    run(["stop"]);
  } catch {}
  for (
    let i = 0;
    i < 40 &&
    fs.existsSync(path.join(root, ".workboard", ".local", "service.lock"));
    i++
  )
    await new Promise((r) => setTimeout(r, 100));
  fs.rmSync(root, { recursive: true, force: true });
}
