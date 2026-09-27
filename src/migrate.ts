import fs from "node:fs";
import path from "node:path";
import {
  atomic,
  canonicalProject,
  dataDirectory,
  Problem,
  read,
} from "./files.js";

export const projectLauncher =
  '#!/bin/sh\nHERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nif [ -d "$HERE/.controlroom" ]; then DATA="$HERE/.controlroom"; else DATA="$HERE/.workboard"; fi\nexec "$DATA/controlroom" serve --open\n';

export function migrateProject(project: string) {
  const root = canonicalProject(project);
  const source = dataDirectory(root);
  const target = path.join(root, ".controlroom");
  if (!fs.existsSync(path.join(source, "config.yml")))
    throw new Problem(404, "No existing project records to migrate");
  if (source === target)
    return { project: root, records: target, migrated: false };
  if (
    fs.existsSync(path.join(source, "workboard")) &&
    !fs.existsSync(path.join(source, "controlroom"))
  )
    throw new Problem(
      409,
      "Upgrade this installation before migrating so its runtime understands .controlroom. Records were not moved.",
    );
  // Share the service startup lock, so a new service cannot race the rename.
  const lock = path.join(source, ".local/service.lock");
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (const file of [lock, path.join(source, ".local/service.json")]) {
    if (!fs.existsSync(file)) continue;
    let pid: number;
    try {
      pid = file === lock ? Number(read(file)) : JSON.parse(read(file)).pid;
    } catch {
      throw new Problem(
        409,
        "Cannot verify service state. Stop the service and reconcile its local runtime files first.",
      );
    }
    if (!Number.isInteger(pid) || pid <= 0)
      throw new Problem(
        409,
        "Invalid service PID; reconcile local runtime files first",
      );
    try {
      process.kill(pid, 0);
    } catch (error: any) {
      if (error.code === "ESRCH") continue;
      throw error;
    }
    throw new Problem(
      409,
      "Stop the project service before migrating (.workboard/workboard stop or controlroom stop), then retry.",
    );
  }
  if (fs.existsSync(lock)) fs.unlinkSync(lock);
  fs.writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
  let moved = false;
  try {
    fs.renameSync(source, target);
    moved = true;
    const command = path.join(target, "controlroom");
    if (
      fs.existsSync(command) &&
      !fs.existsSync(path.join(root, "ControlRoom.command"))
    )
      atomic(path.join(root, "ControlRoom.command"), projectLauncher, 0o755);
    return {
      project: root,
      records: target,
      migrated: true,
      next: "Use ./.controlroom/controlroom. Update custom launchers, MCP paths and external scripts referencing .workboard. Keep old launchers until checked. Review the directory rename in Git before committing.",
    };
  } finally {
    const held = moved ? path.join(target, ".local/service.lock") : lock;
    if (fs.existsSync(held)) fs.unlinkSync(held);
  }
}
