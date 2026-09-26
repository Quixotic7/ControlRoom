#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Store } from "./store.js";
import { atomic, canonicalProject, now, read, uid } from "./files.js";
import { buildServer, toolRoot } from "./server.js";
import { registerCapture, startCompanion } from "./capture.js";
import type { Actor } from "./types.js";

const args = process.argv.slice(2);
function option(name: string, fallback?: string) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}
function has(name: string) {
  return args.includes(`--${name}`);
}
const cwd = path.resolve(option("project", process.cwd())!);
const who: Actor = {
  name: option("actor", "You")!,
  kind: has("agent") ? "agent" : "human",
};
const json = has("json");
function output(value: any) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (value?.meta) {
    console.log(
      `${value.meta.number === undefined ? value.meta.id : `#${value.meta.number}`}  ${value.meta.title}\n${value.meta.status} · ${value.meta.kind}\n\n${value.body}`,
    );
    return;
  }
  if (Array.isArray(value) && value[0]?.meta) {
    for (const v of value)
      console.log(
        `${v.meta.number === undefined ? v.meta.id : `#${v.meta.number}`}  ${v.meta.status.padEnd(12)} ${v.meta.title}`,
      );
    return;
  }
  console.log(
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  );
}
function bodyFile() {
  const p = option("body-file");
  return p ? read(path.resolve(p)) : option("body", "")!;
}
function inputJson() {
  const p = option("file");
  return p
    ? JSON.parse(read(path.resolve(p)))
    : JSON.parse(option("patch", "{}")!);
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function endpoint(store: Store): Promise<string | null> {
  try {
    const v = JSON.parse(read(store.file(".local/service.json")));
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(v.url)) return null;
    const r = await fetch(v.url + "/health", {
      signal: AbortSignal.timeout(500),
    });
    const health: any = await r.json();
    return health.project === store.config().projectId ? v.url : null;
  } catch {
    return null;
  }
}
async function service(store: Store) {
  let url = await endpoint(store);
  if (url) return url;
  const cli = fileURLToPath(import.meta.url);
  const log = fs.openSync(store.file(".local/service.log"), "a");
  const child = spawn(
    process.execPath,
    [
      ...(cli.endsWith(".ts") ? ["--import", "tsx"] : []),
      cli,
      "serve",
      "--headless",
      "--project",
      store.root,
    ],
    { detached: true, stdio: ["ignore", log, log] },
  );
  child.unref();
  fs.closeSync(log);
  for (let i = 0; i < 80; i++) {
    await delay(100);
    url = await endpoint(store);
    if (url) return url;
  }
  throw new Error("Service did not start. See .workboard/.local/service.log");
}
async function api(store: Store, url: string, method = "GET", body?: unknown) {
  const base = await service(store);
  const res = await fetch(base + url, {
    method,
    headers: {
      Authorization: `Bearer ${store.token()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: any = await res.json();
  if (!res.ok)
    throw new Error(
      `${res.status}: ${data.error}${data.detail ? "\n" + JSON.stringify(data.detail) : ""}`,
    );
  return data;
}
async function serve(store: Store) {
  const running = await endpoint(store);
  if (running) {
    if (!has("headless")) {
      // Registration must belong to the persistent server, not this short-lived CLI.
      await api(store, "/api/active", "POST", {});
      startCompanion(toolRoot);
    }
    output(`Workboard is already running: ${running}`);
    if (has("open")) spawn("open", [running], { stdio: "ignore" });
    return;
  }
  const lock = store.file(".local/service.lock");
  try {
    fs.writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
  } catch {
    const pid = Number(read(lock));
    try {
      process.kill(pid, 0);
      throw new Error("Another Workboard service is starting");
    } catch (e: any) {
      if (e.code !== "ESRCH") throw e;
      fs.unlinkSync(lock);
      fs.writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
    }
  }
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  const cleanup = () => {
    for (const f of [lock, store.file(".local/service.json")])
      if (fs.existsSync(f)) fs.unlinkSync(f);
  };
  try {
    app = await buildServer(store, {
      dev: has("dev"),
      native: !has("headless"),
    });
    const url = await app.listen({
      host: "127.0.0.1",
      port: Number(option("port", "0")),
    });
    atomic(
      store.file(".local/service.json"),
      JSON.stringify({ url, pid: process.pid, startedAt: now() }),
      0o600,
    );
    let captureFile: string | undefined;
    if (!has("headless")) {
      captureFile = registerCapture(store, Number(new URL(url).port));
      startCompanion(toolRoot);
    }
    console.log(`Workboard: ${url}\nProject: ${store.root}`);
    if (has("open") && process.platform === "darwin")
      spawn("open", [url], { stdio: "ignore" });
    const stop = async () => {
      if (captureFile && fs.existsSync(captureFile)) fs.unlinkSync(captureFile);
      await app?.close();
      cleanup();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (e) {
    await app?.close();
    cleanup();
    throw e;
  }
}
// Copies only runtime dependencies: packages the lockfile marks as dev-only
// (TypeScript, Vite, esbuild, Playwright…) are not needed by the built CLI.
function copyRuntimeModules(target: string) {
  const lock = JSON.parse(read(path.join(toolRoot, "package-lock.json")));
  for (const [key, entry] of Object.entries<any>(lock.packages ?? {})) {
    // Top-level packages only; nested node_modules travel with their parent.
    if (!/^node_modules\/(@[^/]+\/)?[^/]+$/.test(key) || entry.dev) continue;
    const from = path.join(toolRoot, key);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(target, key), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
}
async function install(destination: string) {
  const root = canonicalProject(path.resolve(destination), false);
  const store = new Store(root, true).initialize();
  if (await endpoint(store))
    throw new Error(
      "Stop the destination service before installing or upgrading it.",
    );
  const version: string = JSON.parse(
    read(path.join(toolRoot, "package.json")),
  ).version;
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error(`Unsupported tool version: ${version}`);
  const finalTarget = store.file(`tool/${version}`);
  const target = store.file(`tool/.${uid("install")}`);
  if (!fs.existsSync(path.join(toolRoot, "dist", "cli.js")))
    throw new Error("Run npm run build before installing a project copy");
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(path.join(toolRoot, "dist"), path.join(target, "dist"), {
    recursive: true,
  });
  fs.copyFileSync(
    path.join(toolRoot, "package.json"),
    path.join(target, "package.json"),
  );
  fs.copyFileSync(
    path.join(toolRoot, "package-lock.json"),
    path.join(target, "package-lock.json"),
  );
  fs.copyFileSync(
    path.join(toolRoot, "AGENT_GUIDE.md"),
    path.join(target, "AGENT_GUIDE.md"),
  );
  copyRuntimeModules(target);
  // Runtime is copied into the project, so the user’s global Node is never modified.
  const bundled = path.join(
    toolRoot,
    ".runtime",
    "node_modules",
    "node",
    "bin",
    "node",
  );
  const executable = fs.existsSync(bundled) ? bundled : process.execPath;
  fs.mkdirSync(path.join(target, "runtime"), { recursive: true });
  fs.copyFileSync(executable, path.join(target, "runtime", "node"));
  fs.chmodSync(path.join(target, "runtime", "node"), 0o755);
  const retired = store.file(`tool/.${uid("previous")}`);
  const replacing = fs.existsSync(finalTarget);
  if (replacing) fs.renameSync(finalTarget, retired);
  try {
    fs.renameSync(target, finalTarget);
  } catch (e) {
    if (replacing) fs.renameSync(retired, finalTarget);
    throw e;
  }
  if (replacing) fs.rmSync(retired, { recursive: true, force: true });
  const wrapper = `#!/bin/sh\nHERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$HERE/tool/${version}/runtime/node" "$HERE/tool/${version}/dist/cli.js" --project "$HERE/.." "$@"\n`;
  atomic(path.join(root, ".workboard", "workboard"), wrapper);
  fs.chmodSync(path.join(root, ".workboard", "workboard"), 0o755);
  // The launcher now points at this version; earlier versions are unused.
  for (const old of fs.readdirSync(store.file("tool")))
    if (old !== version && /^\d+\.\d+\.\d+$/.test(old))
      fs.rmSync(store.file(`tool/${old}`), { recursive: true, force: true });
  atomic(
    path.join(root, "Workboard.command"),
    '#!/bin/sh\nHERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$HERE/.workboard/workboard" serve --open\n',
  );
  fs.chmodSync(path.join(root, "Workboard.command"), 0o755);
  const ignore = store.file(".gitignore");
  if (!read(ignore).includes("tool/")) atomic(ignore, read(ignore) + "tool/\n");
  atomic(
    path.join(root, ".workboard", "AGENT_GUIDE.md"),
    read(path.join(toolRoot, "AGENT_GUIDE.md")),
  );
  output(
    `Installed Workboard ${version} in ${root}\nRun ./.workboard/workboard serve --open or double-click Workboard.command.\nProject records were preserved.`,
  );
}
async function main() {
  // Options can precede commands in the installed launcher.
  const valueOptions = new Set([
    "--project",
    "--actor",
    "--body-file",
    "--body",
    "--file",
    "--patch",
    "--title",
    "--parent",
    "--labels",
    "--revision",
    "--handoff",
    "--evidence",
    "--exceptions",
    "--output",
    "--port",
    "--worktree",
  ]);
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (valueOptions.has(args[i])) {
      i++;
      continue;
    }
    if (!args[i].startsWith("--")) positional.push(args[i]);
  }
  const [command, id, extra] = positional;
  if (!command || command === "help") {
    output(
      `Workboard — project-local tasks, decisions, and UI rules\n\ninit | serve [--open] [--dev] | stop | list | show ID | context ID\ncreate ticket|decision|rule --title TITLE [--body-file FILE] [--parent ID]\nupdate ID --revision HASH --patch JSON [--body-file FILE]\nmove ID STATUS --revision HASH\ncomment ID --body TEXT | ask ID --body TEXT\nclaim ID | release ID [--worktree PATH]\nhandoff ID --revision HASH --body TEXT\nreview ID --revision HASH --handoff TEXT --evidence TEXT [--exceptions TEXT]\nexport --output FILE | restore --file FILE\nimport brief --file PATHS_JSON | import stage --file PROPOSALS_JSON\ninstall DESTINATION | upgrade DESTINATION\n\nAll commands accept --project PATH, --actor NAME, --agent, and --json.\nMutations require a revision from show/context to prevent lost updates.\nClaims expire after 30 minutes; repeat claim to renew.\n`,
    );
    return;
  }
  if (command === "install" || command === "upgrade") {
    if (!id) throw new Error("Provide a destination project");
    await install(id);
    return;
  }
  const store = new Store(cwd).initialize();
  if (command === "init") {
    output({ project: store.root, records: store.dir });
    return;
  }
  if (command === "serve") {
    await serve(store);
    return;
  }
  if (command === "stop") {
    const url = await endpoint(store);
    if (!url) {
      output("Workboard is not running.");
      return;
    }
    const result = await fetch(url + "/api/shutdown", {
      method: "POST",
      headers: { Authorization: `Bearer ${store.token()}` },
    });
    if (!result.ok) throw new Error("Could not stop service");
    output("Workboard is stopping.");
    return;
  }
  const rev = () => {
    const r = option("revision");
    if (!r)
      throw new Error(
        "--revision is required; obtain the current revision using show --json",
      );
    return r;
  };
  if (command === "list") {
    output((await api(store, "/api/state")).records);
    return;
  }
  if (command === "show" || command === "context") {
    output(
      await api(
        store,
        `/api/records/${id}${command === "context" ? "/context" : ""}`,
      ),
    );
    return;
  }
  if (command === "create") {
    output(
      await api(store, "/api/records", "POST", {
        kind: id,
        meta: {
          title: option("title"),
          parent: option("parent") ?? null,
          labels: option("labels", "")!.split(",").filter(Boolean),
        },
        body: bodyFile(),
        actor: who,
      }),
    );
    return;
  }
  if (command === "update" || command === "move" || command === "handoff") {
    const patch =
      command === "move"
        ? { status: extra }
        : command === "handoff"
          ? { handoff: bodyFile() }
          : inputJson();
    output(
      await api(store, `/api/records/${id}`, "PATCH", {
        revision: rev(),
        patch,
        body:
          command === "update" && option("body-file") ? bodyFile() : undefined,
        actor: who,
      }),
    );
    return;
  }
  if (command === "comment" || command === "ask") {
    output(
      await api(store, `/api/records/${id}/comments`, "POST", {
        body: bodyFile(),
        kind: command === "ask" ? "question" : "comment",
        actor: who,
      }),
    );
    return;
  }
  if (command === "claim" || command === "release") {
    output(
      await api(store, `/api/records/${id}/claim`, "POST", {
        actor: who,
        worktree: option("worktree", cwd),
        release: command === "release",
      }),
    );
    return;
  }
  if (command === "review") {
    output(
      await api(store, `/api/records/${id}/review`, "POST", {
        revision: rev(),
        handoff: option("handoff", ""),
        evidence: option("evidence", ""),
        exceptions: option("exceptions", ""),
        actor: who,
      }),
    );
    return;
  }
  if (command === "export") {
    const url = await service(store),
      res = await fetch(url + "/api/export", {
        headers: { Authorization: `Bearer ${store.token()}` },
      });
    if (!res.ok) throw new Error(await res.text());
    const dest = path.resolve(option("output", "workboard-backup.json.gz")!);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()), {
      flag: "wx",
    });
    output(`Exported ${dest}`);
    return;
  }
  if (command === "restore") {
    const f = option("file");
    if (!f) throw new Error("--file is required");
    output(
      await api(store, "/api/restore", "POST", {
        data: fs.readFileSync(path.resolve(f)).toString("base64"),
      }),
    );
    return;
  }
  if (command === "import" && id === "brief") {
    output(
      await api(store, "/api/import/brief", "POST", { files: inputJson() }),
    );
    return;
  }
  if (command === "import" && id === "stage") {
    output(
      await api(store, "/api/import", "POST", {
        proposals: inputJson(),
        actor: who,
      }),
    );
    return;
  }
  throw new Error(`Unknown command: ${command}. Run workboard help.`);
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
