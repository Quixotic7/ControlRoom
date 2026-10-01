#!/usr/bin/env node
import {
  networkPreference,
  saveNetworkPreference,
  lanAddresses,
} from "./network.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { migrateProject, projectLauncher } from "./migrate.js";
import { Store } from "./store.js";
import { atomic, canonicalProject, now, read, uid } from "./files.js";
import { buildServer, toolRoot } from "./server.js";
import { registerCapture, startCompanion } from "./capture.js";
import {
  api as clientApi,
  ApiError,
  commitsSince,
  currentBranch,
  endpoint,
  filterRecords,
  parseArgs,
  validatePositionals,
  parseSet,
  resolveActor,
  runVerification,
  service,
  waitForChange,
} from "./client.js";
import { startMcp } from "./mcp.js";
import { installSkills, packageSkills } from "./skills.js";
import { boardSnapshot } from "./boardSnapshot.js";
import type { Actor } from "./types.js";

const parsed = (() => {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();
const { option, has, all, positional } = parsed;
const cwd = path.resolve(option("project", process.cwd())!);
const executionDirectory = path.resolve(option("worktree", process.cwd())!);
const identity = resolveActor({
  name: option("actor"),
  agent: has("agent"),
  human: has("human"),
});
const who: Actor = identity.actor;
const json = has("json");
const api = <T = any>(
  store: Store,
  url: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
) => clientApi<T>(store, url, method, body, signal, !has("no-start"));
function output(value: any) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (value?.meta) {
    console.log(
      `${value.meta.number === undefined ? value.meta.id : `#${value.meta.number}`}  ${value.meta.title}\n${value.meta.status} · ${value.meta.kind} · etag ${value.revision}\n\n${value.body}`,
    );
    return;
  }
  if (Array.isArray(value) && value.length === 0) {
    console.log("No matching records.");
    return;
  }
  if (Array.isArray(value) && value[0]?.meta) {
    for (const v of value)
      console.log(
        `${(v.meta.number === undefined ? v.meta.id : `#${v.meta.number}`).padEnd(6)} ${v.meta.status.padEnd(12)} ${v.meta.title}${v.meta.owner ? `  (${v.meta.owner})` : ""}`,
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
async function serve(store: Store) {
  if (has("lan") && has("local"))
    throw new Error("Choose --lan or --local, not both");
  const desiredLan = has("lan")
    ? true
    : has("local")
      ? false
      : networkPreference(store);
  if (desiredLan && has("dev"))
    throw new Error("LAN mode requires a production build; omit --dev");
  const running = await endpoint(store);
  if (running) {
    const current = await api(store, "/api/network");
    if (current.enabled !== desiredLan || current.restartRequired)
      throw new Error(
        "Network mode changed. Stop the service, then run serve with --lan or --local to restart in the desired mode.",
      );
    if (!has("headless")) {
      // Registration must belong to the persistent server, not this short-lived CLI.
      await api(store, "/api/active", "POST", {});
      startCompanion(toolRoot);
    }
    output(`Control Room is already running: ${running}`);
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
      throw new Error("Another Control Room service is starting");
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
    saveNetworkPreference(store, desiredLan);
    app = await buildServer(store, {
      lan: desiredLan,
      dev: has("dev"),
      native: !has("headless"),
    });
    const listening = await app.listen({
      host: desiredLan ? "0.0.0.0" : "127.0.0.1",
      port: Number(option("port", "0")),
    });
    const url = `http://127.0.0.1:${new URL(listening).port}`;
    atomic(
      store.file(".local/service.json"),
      JSON.stringify({
        url,
        pid: process.pid,
        startedAt: now(),
        lan: desiredLan,
      }),
      0o600,
    );
    let captureFile: string | undefined;
    if (!has("headless")) {
      captureFile = registerCapture(store, Number(new URL(url).port));
      startCompanion(toolRoot);
    }
    console.log(`Control Room: ${url}\nProject: ${store.root}`);
    if (desiredLan)
      console.log(
        `LAN: ${
          lanAddresses()
            .map((ip) => `http://${ip}:${new URL(url).port}`)
            .join(", ") || "No private IPv4 interface available"
        }\nPair devices in local Settings → Network access. HTTP traffic is not encrypted; use a trusted LAN.`,
      );
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
  // Copy current build artifacts only, not retired companion bundles left in dist.
  fs.mkdirSync(path.join(target, "dist"), { recursive: true });
  for (const artifact of ["cli.js", "web", "ControlRoomCapture.app"])
    if (fs.existsSync(path.join(toolRoot, "dist", artifact)))
      fs.cpSync(
        path.join(toolRoot, "dist", artifact),
        path.join(target, "dist", artifact),
        { recursive: true },
      );
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
  packageSkills(path.join(toolRoot, "skills"), target);
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
  atomic(store.file("controlroom"), wrapper, 0o755);
  // Old automation keeps working during the explicit naming migration.
  atomic(store.file("workboard"), wrapper, 0o755);
  // The launcher now points at this version; earlier versions are unused.
  for (const old of fs.readdirSync(store.file("tool")))
    if (old !== version && /^\d+\.\d+\.\d+$/.test(old))
      fs.rmSync(store.file(`tool/${old}`), { recursive: true, force: true });
  if (!fs.existsSync(path.join(root, "ControlRoom.command")))
    atomic(path.join(root, "ControlRoom.command"), projectLauncher, 0o755);
  const ignore = store.file(".gitignore");
  if (!read(ignore).includes("tool/")) atomic(ignore, read(ignore) + "tool/\n");
  atomic(
    store.file("AGENT_GUIDE.md"),
    read(path.join(toolRoot, "AGENT_GUIDE.md")),
  );
  output(
    `Installed ControlRoom ${version} in ${root}\nRun ./${path.basename(store.dir)}/controlroom serve --open or double-click ControlRoom.command.\nProject records were preserved.`,
  );
}
const help = `Control Room — project-local tasks, decisions, and UI rules for humans and coding agents

Reading
  list [--status S] [--owner O] [--label L] [--mine] [--open] [--archived] [--kind ticket|decision|rule]
  show ID                      the record and its etag
  context ID [--markdown] [--brief]   everything an agent needs, as JSON or a prompt-ready brief
  snapshot                    compact read-only board state for refresh skills
  merge-preview SURVIVOR SOURCE        review conflicts, preserved content, incoming links, and required etags
  next                         the ticket this agent should pick up next, with its brief
  wait ID [--for comment|status|any] [--timeout SECONDS]   block until the ticket changes

Writing (need --etag from show or context, or --latest to use the current one)
  create ticket|decision|rule --title TITLE [--body-file FILE|--body TEXT] [--parent ID] [--labels a,b] [--set key=value ...]
  update ID --etag HASH [--set key=value ...] [--patch JSON] [--body-file FILE]
  relate ID OTHER --etag HASH --other-etag HASH | unrelate ID OTHER --etag HASH --other-etag HASH
  merge SURVIVOR SOURCE --file MERGE_JSON   requestId, preview revisions, and explicit conflict resolutions
  move ID STATUS --etag HASH
  handoff ID --etag HASH --body TEXT
  questionnaire ID --file questions.json [--patch '{"id":"comment-id","revision":"HASH"}']
  progress ID --etag HASH --body TEXT [--percent 0..100]
  comment ID --body TEXT | ask ID --body TEXT
  claim ID [--worktree PATH] | release ID
  review ID --etag HASH --handoff TEXT [--review-notes TEXT] [--evidence TEXT] [--run "test command"] [--branch B] [--pr URL] [--commits a,b|--commits-since REF] [--exceptions TEXT]

Service and data
  agents status | agents log RUN
  agents propose --file CONFIG_JSON [--brief-file MARKDOWN] [--etag CONFIG_REVISION]   stage a proposal for human approval
  agents configure --file CONFIG_JSON --etag CONFIG_REVISION
  agents queue --file ASSIGNMENT_JSON   {ticket, revision, kind: work|plan, worker} (worker required for work)
  agents stop RUN | agents resume RUN | agents takeover RUN --etag TICKET_ETAG
  agents review-context RUN | agents review RUN --file REVIEW_JSON
  serve [--open] [--port PORT] [--lan | --local] [--dev] | stop | mcp | init
  export --output FILE | restore --file FILE
  import brief --file PATHS_JSON | import stage --file PROPOSALS_JSON
  install DESTINATION | upgrade DESTINATION
  skills install [DIR]           install bundled agent skills in DIR (defaults to --worktree or the current directory)
  migrate                      rename stopped project .workboard to .controlroom

Identity: set CONTROLROOM_ACTOR (name) and CONTROLROOM_ACTOR_KIND (human|agent) in the environment, or pass --actor NAME with --agent or --human. A known agent harness or a non-interactive terminal counts as an agent.
All commands accept --project PATH and --json. --no-start prevents automatic project initialization and service startup; it is not a read-only permission mode. --project selects the board; --worktree selects the execution checkout (defaults to the caller directory). IDs may be numbers, quoted '#numbers', or record IDs. Claims expire after 30 minutes; repeat claim to renew.
`;
async function main() {
  const [command, id, extra] = positional;
  if (has("help")) {
    output(help);
    return;
  }
  validatePositionals(positional);
  if (
    command === "agents" &&
    id === "propose" &&
    has("brief-file") &&
    !option("brief-file")?.trim()
  )
    throw new Error("Provide a path for --brief-file");
  if (!command || command === "help") {
    output(help);
    return;
  }
  if (command === "install" || command === "upgrade") {
    if (!id) throw new Error("Provide a destination project");
    await install(id);
    return;
  }
  if (command === "skills") {
    if (id !== "install") throw new Error("Use skills install [DIR]");
    const result = installSkills(
      path.resolve(extra || executionDirectory),
      path.join(toolRoot, "skills"),
    );
    output(
      json
        ? result
        : `Installed ${result.skills.join(", ")} in .agents/skills and .claude/skills (${result.copied} file(s) copied).`,
    );
    return;
  }
  if (command === "migrate") {
    output(migrateProject(cwd));
    return;
  }
  const store = new Store(cwd);
  if (command === "snapshot") {
    if (!fs.existsSync(path.join(store.dir, "config.yml")))
      throw new Error(
        `No Control Room project exists at ${store.root}; choose an existing project before requesting a snapshot.`,
      );
    output(
      boardSnapshot(
        await clientApi(
          store,
          "/api/state",
          "GET",
          undefined,
          undefined,
          false,
        ),
      ),
    );
    return;
  }
  if (!has("no-start")) store.initialize();
  if (command === "init") {
    output({ project: store.root, records: store.dir, actor: who });
    return;
  }
  if (command === "serve") {
    await serve(store);
    return;
  }
  if (command === "mcp") {
    await startMcp(store, who, executionDirectory, !has("no-start"));
    return;
  }
  if (command === "agents") {
    if (!id || id === "status") output(await api(store, "/api/orchestration"));
    else if (id === "propose") {
      output(
        await api(store, "/api/orchestration/proposals", "POST", {
          config: inputJson(),
          revision: option("etag"),
          actor: who,
          ...(option("brief-file")
            ? { workerBrief: read(path.resolve(option("brief-file")!)) }
            : {}),
        }),
      );
    } else if (id === "configure") {
      if (!option("etag"))
        throw new Error(
          "Provide --etag from agents status so a stale configuration cannot overwrite another edit",
        );
      output(
        await api(store, "/api/orchestration/config", "PUT", {
          config: inputJson(),
          revision: option("etag"),
          actor: who,
        }),
      );
    } else if (id === "queue") {
      const input = inputJson();
      output(
        await api(store, "/api/orchestration/queue", "POST", {
          ...input,
          actor: who,
        }),
      );
    } else if (["review-context", "review"].includes(id)) {
      const run = positional[2];
      if (!run) throw new Error("Provide a run ID");
      output(
        await api(
          store,
          `/api/orchestration/${encodeURIComponent(run)}/${id}`,
          "POST",
          { ...(id === "review" ? inputJson() : {}), actor: who },
        ),
      );
    } else if (["stop", "resume", "takeover", "log"].includes(id)) {
      const run = positional[2];
      if (!run) throw new Error("Provide a run ID");
      if (id === "takeover" && !option("etag"))
        throw new Error(
          "Provide --etag from the current ticket so a stale assignment cannot be taken over",
        );
      output(
        await api(
          store,
          `/api/orchestration/${encodeURIComponent(run)}/${id}`,
          id === "log" ? "GET" : "POST",
          id === "log"
            ? undefined
            : {
                actor: who,
                ...(id === "takeover" ? { revision: option("etag") } : {}),
              },
        ),
      );
    } else
      throw new Error(
        "Use agents status|configure --file config.json|queue --file assignment.json|stop RUN|resume RUN|takeover RUN --etag TICKET_ETAG|log RUN",
      );
    return;
  }
  if (command === "stop") {
    const url = await endpoint(store);
    if (!url) {
      output("Control Room is not running.");
      return;
    }
    const result = await fetch(url + "/api/shutdown", {
      method: "POST",
      headers: { Authorization: `Bearer ${store.token()}` },
    });
    if (!result.ok) throw new Error("Could not stop service");
    output("Control Room is stopping.");
    return;
  }
  const mutation = [
    "create",
    "update",
    "move",
    "handoff",
    "comment",
    "ask",
    "questionnaire",
    "progress",
    "claim",
    "release",
    "review",
    "relate",
    "unrelate",
    "merge",
  ].includes(command);
  if (mutation && identity.inferred && who.kind === "agent")
    console.error(
      `Acting as agent "${who.name}". Set CONTROLROOM_ACTOR to name this session, or pass --human if you are a person.`,
    );
  // The record's content hash guards against lost updates. --latest opts into
  // writing over whatever is current, for fields nobody else is editing.
  const etag = async () => {
    const r = option("etag") ?? option("if-match") ?? option("revision");
    if (r) return r;
    if (has("latest"))
      return (await api(store, `/api/records/${encodeURIComponent(id)}`))
        .revision;
    throw new Error(
      "--etag is required: take it from `show ID` or `context ID`, or pass --latest to write over the current version.",
    );
  };
  if (command === "list") {
    const state = await api(store, "/api/state");
    output(
      filterRecords(state.records, {
        kind: option("kind"),
        status: option("status"),
        owner: option("owner"),
        label: option("label"),
        mine: has("mine") ? who.name : undefined,
        open: has("open"),
        archived: has("archived"),
        columns: state.config.columns,
        claims: state.claims,
      }),
    );
    return;
  }
  if (command === "show") {
    output(await api(store, `/api/records/${encodeURIComponent(id)}`));
    return;
  }
  if (command === "context") {
    if (has("markdown") || has("brief")) {
      const r = await api(
        store,
        `/api/records/${encodeURIComponent(id)}/context?format=markdown${has("brief") ? "&brief=1" : ""}`,
      );
      output(json ? r : r.markdown);
    } else
      output(
        await api(store, `/api/records/${encodeURIComponent(id)}/context`),
      );
    return;
  }
  if (command === "merge-preview") {
    if (!extra) throw new Error("merge-preview needs a source ticket");
    output(
      await api(
        store,
        `/api/records/${encodeURIComponent(id)}/merge-preview`,
        "POST",
        { source: extra },
      ),
    );
    return;
  }
  if (command === "next") {
    const r = await api(store, "/api/next", "POST", { actor: who });
    if (json) output(r);
    else if (!r.ticket)
      output(
        "Nothing to pick up: no unclaimed, unblocked ticket inside an approved scope. Ask a human to approve a scope or select work.",
      );
    else output(r.brief.markdown);
    return;
  }
  if (command === "wait") {
    const seconds = Number(option("timeout", "600"));
    const waitFor = (option("for", "any") ?? "any") as
      | "comment"
      | "status"
      | "any";
    if (!["comment", "status", "any"].includes(waitFor))
      throw new Error("--for must be comment, status, or any");
    const r = await waitForChange(
      store,
      id,
      waitFor,
      seconds * 1000,
      undefined,
      !has("no-start"),
    );
    if (!r) {
      output(json ? { change: null } : `No change within ${seconds}s.`);
      process.exitCode = 2;
      return;
    }
    if (json) output(r);
    else {
      const last = r.comments.at(-1);
      output(
        `${r.change}: ${r.ticket.meta.title} is now ${r.ticket.meta.status}` +
          (r.change === "comment" && last
            ? `\n${last.actor.name} (${last.kind}): ${last.body}`
            : ""),
      );
    }
    return;
  }
  if (command === "create") {
    const labels = option("labels", "")!
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean);
    output(
      await api(store, "/api/records", "POST", {
        kind: id,
        meta: {
          ...(option("title") ? { title: option("title") } : {}),
          parent: option("parent") ?? null,
          ...(labels.length ? { labels } : {}),
          ...(option("priority")
            ? { priority: Number(option("priority")) }
            : {}),
          ...(option("owner") ? { owner: option("owner") } : {}),
          ...(option("status") ? { status: option("status") } : {}),
          ...parseSet(all("set")),
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
          : { ...inputJson(), ...parseSet(all("set")) };
    if (command === "move" && !extra)
      throw new Error("move needs a status, e.g. move 3 progress");
    output(
      await api(store, `/api/records/${encodeURIComponent(id)}`, "PATCH", {
        revision: await etag(),
        patch,
        body:
          command === "update" && option("body-file") ? bodyFile() : undefined,
        actor: who,
      }),
    );
    return;
  }
  if (command === "relate" || command === "unrelate") {
    if (!extra) throw new Error(`${command} needs another ticket`);
    const otherRevision = option("other-etag");
    if (!otherRevision)
      throw new Error("--other-etag is required from the other ticket");
    output(
      await api(
        store,
        `/api/records/${encodeURIComponent(id)}/relationships`,
        "POST",
        {
          other: extra,
          revision: await etag(),
          otherRevision,
          action: command === "relate" ? "add" : "remove",
          actor: who,
        },
      ),
    );
    return;
  }
  if (command === "merge") {
    if (!extra) throw new Error("merge needs a source ticket");
    output(
      await api(store, `/api/records/${encodeURIComponent(id)}/merge`, "POST", {
        ...inputJson(),
        source: extra,
        actor: who,
      }),
    );
    return;
  }
  if (command === "questionnaire") {
    const questions = JSON.parse(read(option("file")!));
    output(
      await api(
        store,
        `/api/records/${encodeURIComponent(id)}/questionnaires`,
        "POST",
        {
          questions,
          actor: who,
          replacing: option("patch") ? JSON.parse(option("patch")!) : undefined,
        },
      ),
    );
    return;
  }
  if (command === "progress") {
    output(
      await api(store, `/api/records/${encodeURIComponent(id)}`, "PATCH", {
        revision: await etag(),
        actor: who,
        patch: {
          progress: {
            note: bodyFile(),
            ...(option("percent") === undefined
              ? {}
              : { percent: Number(option("percent")) }),
          },
        },
      }),
    );
    return;
  }
  if (command === "comment" || command === "ask") {
    output(
      await api(
        store,
        `/api/records/${encodeURIComponent(id)}/comments`,
        "POST",
        {
          body: bodyFile(),
          kind: command === "ask" ? "question" : "comment",
          actor: who,
        },
      ),
    );
    return;
  }
  if (command === "claim" || command === "release") {
    output(
      await api(store, `/api/records/${encodeURIComponent(id)}/claim`, "POST", {
        actor: who,
        worktree: executionDirectory,
        release: command === "release",
      }),
    );
    return;
  }
  if (command === "review") {
    const run = option("run");
    const verification = run
      ? await runVerification(run, executionDirectory)
      : undefined;
    if (verification) {
      console.error(`${verification.command} exited ${verification.exitCode}`);
      if (verification.exitCode !== 0 && !has("allow-failure"))
        throw new Error(
          `Verification failed (exit ${verification.exitCode}); not submitting for review. Fix it, or pass --allow-failure to submit anyway.\n${verification.output.slice(-2000)}`,
        );
    }
    const commits = option("commits")
      ? option("commits")!
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean)
      : option("commits-since")
        ? commitsSince(executionDirectory, option("commits-since")!)
        : undefined;
    const evidence =
      option("evidence") ??
      (verification
        ? `\`${verification.command}\` exited ${verification.exitCode} at ${verification.at}.`
        : "");
    output(
      await api(
        store,
        `/api/records/${encodeURIComponent(id)}/review`,
        "POST",
        {
          revision: await etag(),
          handoff: option("handoff", ""),
          reviewInstructions: option("review-notes"),
          manualReviewRequired: !has("no-manual-checks"),
          evidence,
          exceptions: option("exceptions", ""),
          branch: option("branch") ?? currentBranch(executionDirectory),
          pr: option("pr"),
          commits,
          verification,
          actor: who,
        },
      ),
    );
    return;
  }
  if (command === "export") {
    const url = await service(store),
      res = await fetch(url + "/api/export", {
        headers: { Authorization: `Bearer ${store.token()}` },
      });
    if (!res.ok) throw new Error(await res.text());
    const dest = path.resolve(option("output", "controlroom-backup.json.gz")!);
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
  throw new Error(`Unknown command: ${command}. Run controlroom help.`);
}
main().catch((e) => {
  console.error(
    e instanceof ApiError
      ? `${e.status}: ${e.message}${e.detail ? "\n" + JSON.stringify(e.detail) : ""}`
      : e.message,
  );
  process.exitCode = 1;
});
