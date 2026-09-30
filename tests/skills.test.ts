import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bundledSkills, installSkills, packageSkills } from "../src/skills.js";
import { Store } from "../src/store.js";

function fixture(t: test.TestContext) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "controlroom-skills-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  for (const skill of bundledSkills) {
    const directory = path.join(source, skill);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "SKILL.md"), `# ${skill}\n`);
  }
  return { root, source };
}

test("installs every bundled skill into both local agent directories idempotently", (t) => {
  const { root, source } = fixture(t);
  const destination = path.join(root, "checkout");
  fs.mkdirSync(destination);

  const first = installSkills(destination, source);
  assert.equal(first.copied, bundledSkills.length * 2);
  for (const location of [".agents", ".claude"])
    for (const skill of bundledSkills)
      assert.equal(
        fs.readFileSync(
          path.join(destination, location, "skills", skill, "SKILL.md"),
          "utf8",
        ),
        `# ${skill}\n`,
      );
  assert.equal(installSkills(destination, source).copied, 0);
});

test("refuses custom collisions before changing either skill destination", (t) => {
  const { root, source } = fixture(t);
  const destination = path.join(root, "checkout");
  const collision = path.join(
    destination,
    ".claude",
    "skills",
    "crnext",
    "SKILL.md",
  );
  fs.mkdirSync(path.dirname(collision), { recursive: true });
  fs.writeFileSync(collision, "# custom\n");

  assert.throws(
    () => installSkills(destination, source),
    /Refusing to overwrite custom skill file/,
  );
  assert.equal(fs.existsSync(path.join(destination, ".agents")), false);
  assert.equal(fs.readFileSync(collision, "utf8"), "# custom\n");
});

test("refuses symlinked destination roots and ancestors", (t) => {
  const { root, source } = fixture(t);
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  const linkedCheckout = path.join(root, "linked-checkout");
  fs.symlinkSync(outside, linkedCheckout);
  assert.throws(
    () => installSkills(linkedCheckout, source),
    /must not contain symbolic links/,
  );

  const destination = path.join(root, "checkout");
  fs.mkdirSync(destination);
  fs.symlinkSync(outside, path.join(destination, ".agents"));
  assert.throws(
    () => installSkills(destination, source),
    /must not contain symbolic links/,
  );
  assert.equal(fs.existsSync(path.join(destination, ".claude")), false);
});

test("packages bundled skills beside the installed runtime", (t) => {
  const { root, source } = fixture(t);
  const runtime = path.join(root, "runtime");
  packageSkills(source, runtime);
  for (const skill of bundledSkills)
    assert.equal(
      fs.readFileSync(path.join(runtime, "skills", skill, "SKILL.md"), "utf8"),
      `# ${skill}\n`,
    );
});

test("skills install uses the execution directory without initializing a board", (t) => {
  const { root } = fixture(t);
  const destination = path.join(root, "checkout");
  fs.mkdirSync(destination);
  const repository = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const output = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      path.join(repository, "src", "cli.ts"),
      "skills",
      "install",
      "--worktree",
      destination,
    ],
    { cwd: repository, encoding: "utf8" },
  );
  assert.match(output, /Installed crrefresh, crnext, ccrefresh/);
  assert.equal(fs.existsSync(path.join(destination, ".controlroom")), false);
  assert.equal(
    fs.existsSync(
      path.join(destination, ".agents", "skills", "crrefresh", "SKILL.md"),
    ),
    true,
  );
});

test("snapshot refuses an absent board without creating it", (t) => {
  const { root } = fixture(t);
  const destination = path.join(root, "checkout");
  fs.mkdirSync(destination);
  const repository = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      path.join(repository, "src", "cli.ts"),
      "snapshot",
      "--project",
      destination,
    ],
    { cwd: repository, encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No Control Room project exists/);
  assert.equal(fs.existsSync(path.join(destination, ".controlroom")), false);
});

test("no-start reads never create a board or service files", (t) => {
  const { root } = fixture(t);
  const destination = path.join(root, "checkout");
  fs.mkdirSync(destination);
  const repository = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  for (const args of [
    ["list"],
    ["next"],
    ["context", "1"],
    ["snapshot"],
    ["wait", "1", "--timeout", "1"],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(repository, "src", "cli.ts"),
        ...args,
        "--project",
        destination,
        "--no-start",
      ],
      { cwd: repository, encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
  }
  assert.equal(fs.existsSync(path.join(destination, ".controlroom")), false);
  assert.equal(
    fs.existsSync(path.join(destination, ".local", "service.log")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(destination, ".local", "service.json")),
    false,
  );
});

test("no-start reads leave a stopped board's service state untouched", (t) => {
  const { root } = fixture(t);
  const destination = path.join(root, "checkout");
  fs.mkdirSync(destination);
  new Store(destination).initialize("Stopped");
  const repository = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  for (const args of [
    ["list"],
    ["next"],
    ["context", "1"],
    ["snapshot"],
    ["wait", "1", "--timeout", "1"],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(repository, "src", "cli.ts"),
        ...args,
        "--project",
        destination,
        "--no-start",
      ],
      { cwd: repository, encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /service is not running/);
  }
  assert.equal(
    fs.existsSync(
      path.join(destination, ".controlroom", ".local", "service.log"),
    ),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(destination, ".controlroom", ".local", "service.json"),
    ),
    false,
  );
});
