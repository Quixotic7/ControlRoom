import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";
import { execFileSync } from "node:child_process";

export class Problem extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}
export const hash = (s: string | Buffer) =>
  crypto.createHash("sha256").update(s).digest("hex");
export const uid = (prefix: string) =>
  `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
export const now = () => new Date().toISOString();
export function mkdir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}
export function safe(root: string, relative: string): string {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).includes("..")
  )
    throw new Problem(400, "Unsafe path");
  const full = path.resolve(root, relative);
  const base = fs.realpathSync(root);
  let current = root;
  for (const bit of relative.split(/[\\/]/).filter(Boolean)) {
    current = path.join(current, bit);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw new Problem(
        400,
        "Symbolic links are not allowed in project records",
      );
  }
  if (full !== base && !full.startsWith(base + path.sep))
    throw new Problem(400, "Path outside project");
  return full;
}
export function atomic(file: string, content: string | Buffer, mode?: number) {
  mkdir(path.dirname(file));
  const temp = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temp, content, { mode: mode ?? 0o644, flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
export function read(file: string) {
  return fs.readFileSync(file, "utf8");
}
export function parseMd(text: string) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match)
    throw new Problem(422, "Expected YAML frontmatter between --- lines");
  const doc = YAML.parseDocument(match[1]);
  if (doc.errors.length)
    throw new Problem(422, doc.errors.map((e) => e.message).join("; "));
  const meta = doc.toJS();
  if (!meta || typeof meta !== "object" || Array.isArray(meta))
    throw new Problem(422, "Frontmatter must be a mapping");
  return { doc, meta, body: match[2] };
}
export function markdown(meta: object, body: string) {
  return `---\n${YAML.stringify(meta)}---\n${body}`;
}
export function patchMd(text: string, patch: object, body?: string) {
  const parsed = parseMd(text);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    parsed.doc.set(key, value);
  }
  return `---\n${parsed.doc.toString()}---\n${body === undefined ? parsed.body : body}`;
}
export function walk(root: string, ext?: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((e) => {
    if (e.isSymbolicLink()) return [];
    const file = path.join(root, e.name);
    return e.isDirectory()
      ? walk(file, ext)
      : !ext || e.name.endsWith(ext)
        ? [file]
        : [];
  });
}
export function git(cwd: string, args: string[]) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}
function gitProject(resolved: string) {
  const list = git(resolved, ["worktree", "list", "--porcelain"]);
  if (list) {
    const main = list
      .split("\n")
      .find((l) => l.startsWith("worktree "))
      ?.slice(9);
    if (main) return fs.realpathSync(main);
  }
  const top = git(resolved, ["rev-parse", "--show-toplevel"]);
  return top ? fs.realpathSync(top) : "";
}
// Legacy projects stay readable until explicitly migrated. Never silently
// choose between two histories in the same checkout.
export function dataDirectory(root: string) {
  const current = path.join(root, ".controlroom");
  const legacy = path.join(root, ".workboard");
  if (fs.existsSync(current) && fs.existsSync(legacy))
    throw new Problem(
      409,
      "Both .controlroom and .workboard exist. Reconcile them before opening this project; no records were changed.",
    );
  const selected = fs.existsSync(legacy) ? legacy : current;
  if (fs.existsSync(selected) && fs.lstatSync(selected).isSymbolicLink())
    throw new Problem(
      400,
      "The project data directory must not be a symbolic link",
    );
  return selected;
}
function hasBoard(root: string) {
  return [".controlroom", ".workboard"].some((name) =>
    fs.existsSync(path.join(root, name, "config.yml")),
  );
}
export function canonicalProject(cwd: string, discoverParents = true): string {
  const resolved = fs.realpathSync(cwd);
  const repo = gitProject(resolved);
  if (repo) {
    // A submodule shares its superproject's board, but only when that project
    // already has one: a library submodule must not create a board in its host.
    if (discoverParents) {
      const parent = git(repo, [
        "rev-parse",
        "--show-superproject-working-tree",
      ]);
      if (parent) {
        const shared = canonicalProject(parent);
        if (hasBoard(shared)) return shared;
      }
    }
    return repo;
  }
  if (!discoverParents) return resolved;
  let dir = resolved;
  while (true) {
    if (hasBoard(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return resolved;
    dir = parent;
  }
}
export function branch(cwd: string) {
  return (
    git(cwd, ["symbolic-ref", "--short", "HEAD"]) ||
    git(cwd, ["rev-parse", "--short", "HEAD"]) ||
    "(no Git repository)"
  );
}
