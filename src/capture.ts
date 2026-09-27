import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { atomic, mkdir, now, Problem, read } from "./files.js";
import type { Store } from "./store.js";

export const captureRoot = path.join(
  os.tmpdir(),
  // Keep the shared rendezvous path during upgrades so old/new installations
  // still coordinate one companion instead of competing for the shortcut.
  `workboard-capture-${process.getuid?.() ?? "user"}`,
);
export function registerCapture(store: Store, port: number) {
  mkdir(captureRoot);
  fs.chmodSync(captureRoot, 0o700);
  const config = store.config(),
    file = path.join(captureRoot, `${config.projectId}.json`);
  const prior = fs.existsSync(file) ? JSON.parse(read(file)) : {};
  mkdir(store.file(".local/capture-drafts"));
  atomic(
    file,
    JSON.stringify({
      id: config.projectId,
      name: config.name,
      pid: process.pid,
      url: `http://127.0.0.1:${port}`,
      token: store.token(),
      draftDirectory: store.file(".local/capture-drafts"),
      activeAt: prior.activeAt ?? new Date(0).toISOString(),
      registeredAt: now(),
      shortcut: config.shortcut,
    }),
    0o600,
  );
  return file;
}
export function activateCapture(store: Store, port: number) {
  const file = registerCapture(store, port),
    v = JSON.parse(read(file));
  v.activeAt = now();
  atomic(file, JSON.stringify(v), 0o600);
}
export function captureProjects() {
  if (!fs.existsSync(captureRoot)) return [];
  return fs
    .readdirSync(captureRoot)
    .filter((f) => f.startsWith("project-") && f.endsWith(".json"))
    .flatMap((f) => {
      try {
        const p = JSON.parse(read(path.join(captureRoot, f)));
        if (!Number.isInteger(p.pid)) return [];
        process.kill(p.pid, 0);
        return [{ id: p.id, name: p.name, url: p.url, activeAt: p.activeAt }];
      } catch {
        return [];
      }
    });
}
export function captureStatus() {
  const p = path.join(captureRoot, "status.json");
  if (fs.existsSync(p))
    try {
      const status = JSON.parse(read(p));
      process.kill(status.pid, 0);
      return status;
    } catch {}
  return {
    state: "not-running",
    message:
      "Native capture companion is not running. Paste and drop still work.",
  };
}
// Stops the running companion (permissions apply to new processes) and
// starts a fresh one.
export async function restartCompanion(toolRoot: string) {
  const status = captureStatus();
  if (status.state === "capturing")
    throw new Problem(
      409,
      "Finish or cancel the current capture before relaunching",
    );
  if (Number.isInteger(status.pid)) {
    try {
      process.kill(status.pid, "SIGTERM");
    } catch {}
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        process.kill(status.pid, 0);
      } catch {
        break;
      }
    }
    let alive = true;
    try {
      process.kill(status.pid, 0);
    } catch {
      alive = false;
    }
    if (alive)
      throw new Problem(
        409,
        "The capture companion is still stopping. Try relaunching again shortly.",
      );
  }
  // Keep the flock inode: unlinking it could allow two companions to run.
  startCompanion(toolRoot);
}
export function startCompanion(toolRoot: string) {
  if (process.platform !== "darwin") return;
  const bin = path.join(
    toolRoot,
    "dist",
    "ControlRoomCapture.app",
    "Contents",
    "MacOS",
    "ControlRoomCapture",
  );
  if (!fs.existsSync(bin)) return;
  const child = spawn(
    "/usr/bin/open",
    [
      "-g",
      path.join(toolRoot, "dist", "ControlRoomCapture.app"),
      "--args",
      captureRoot,
    ],
    { detached: true, stdio: "ignore" },
  );
  child.on("error", () => {});
  child.unref();
}
