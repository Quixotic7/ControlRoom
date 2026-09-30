import fs from "node:fs";
import path from "node:path";

export const bundledSkills = ["crrefresh", "crnext", "ccrefresh"] as const;

function existingPathParts(target: string) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  const parts = resolved
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);
  const existing: string[] = [parsed.root];
  let current = parsed.root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      fs.lstatSync(current);
      existing.push(current);
    } catch (error: any) {
      if (error.code === "ENOENT") break;
      throw error;
    }
  }
  return existing;
}

function assertNoSymlink(target: string, label: string) {
  for (const current of existingPathParts(target)) {
    if (fs.lstatSync(current).isSymbolicLink())
      throw new Error(`${label} must not contain symbolic links: ${current}`);
  }
}

type SourceFile = { relative: string; content: Buffer; mode: number };

function sourceFiles(root: string) {
  assertNoSymlink(root, "Bundled skills");
  if (!fs.statSync(root).isDirectory())
    throw new Error(`Bundled skills directory is not a directory: ${root}`);
  const files: SourceFile[] = [];
  const walk = (relative = "") => {
    const current = path.join(root, relative);
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      const absolute = path.join(root, next);
      if (entry.isSymbolicLink())
        throw new Error(
          `Bundled skills must not contain symbolic links: ${absolute}`,
        );
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile()) {
        const stat = fs.statSync(absolute);
        files.push({
          relative: next,
          content: fs.readFileSync(absolute),
          mode: stat.mode,
        });
      } else
        throw new Error(
          `Bundled skill entry is not a file or directory: ${absolute}`,
        );
    }
  };
  walk();
  return files;
}

function skillFiles(sourceRoot: string) {
  return bundledSkills.flatMap((skill) => {
    const root = path.join(sourceRoot, skill);
    if (!fs.existsSync(root))
      throw new Error(`Missing bundled skill: ${skill}`);
    const files = sourceFiles(root);
    if (!files.some((file) => file.relative === "SKILL.md"))
      throw new Error(`Bundled skill is missing SKILL.md: ${skill}`);
    return files.map((file) => ({ ...file, skill }));
  });
}

function installRoot(destination: string, rootName: ".agents" | ".claude") {
  return path.join(destination, rootName, "skills");
}

export function installSkills(destination: string, sourceRoot: string) {
  const target = path.resolve(destination);
  assertNoSymlink(target, "Skill destination");
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory())
    throw new Error(
      `Skill destination must be an existing directory: ${target}`,
    );
  const files = skillFiles(path.resolve(sourceRoot));
  const roots = [
    installRoot(target, ".agents"),
    installRoot(target, ".claude"),
  ];

  // Inspect every output before creating a directory or copying a file. This
  // leaves both integrations untouched when either has a custom collision.
  for (const root of roots)
    for (const file of files) {
      const output = path.join(root, file.skill, file.relative);
      assertNoSymlink(output, "Skill destination");
      if (!fs.existsSync(output)) continue;
      const stat = fs.lstatSync(output);
      if (!stat.isFile() || !fs.readFileSync(output).equals(file.content))
        throw new Error(`Refusing to overwrite custom skill file: ${output}`);
    }

  let copied = 0;
  for (const root of roots)
    for (const file of files) {
      const output = path.join(root, file.skill, file.relative);
      if (fs.existsSync(output)) continue;
      fs.mkdirSync(path.dirname(output), { recursive: true });
      assertNoSymlink(output, "Skill destination");
      fs.writeFileSync(output, file.content, { mode: file.mode, flag: "wx" });
      copied++;
    }
  return { destination: target, copied, skills: [...bundledSkills] };
}

// The installed CLI resolves its tool root beside dist/cli.js, so the skill
// sources must travel with that runtime rather than relying on a global path.
export function packageSkills(sourceRoot: string, packageRoot: string) {
  const source = path.resolve(sourceRoot);
  const files = skillFiles(source);
  const destination = path.join(path.resolve(packageRoot), "skills");
  assertNoSymlink(destination, "Packaged skills destination");
  for (const file of files) {
    const output = path.join(destination, file.skill, file.relative);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, file.content, { mode: file.mode });
  }
}
