import Fastify from "fastify";
import staticFiles from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { ZodError } from "zod";
import { Store } from "./store.js";
import { atomic, Problem, read } from "./files.js";
import { addImage, imageContext, saveAnnotations } from "./media.js";
import {
  applyImport,
  backup,
  documentFiles,
  importBatches,
  importBrief,
  restore,
  stageImport,
} from "./transfer.js";
import {
  activateCapture,
  captureProjects,
  captureRoot,
  captureStatus,
  registerCapture,
  restartCompanion,
  startCompanion,
} from "./capture.js";
import type { Actor, Kind } from "./types.js";

export const toolRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export async function buildServer(
  store: Store,
  options: { webRoot?: string; dev?: boolean; native?: boolean } = {},
) {
  store.initialize();
  if (!store.branchState().branchChanged) await store.migrateTicketNumbers();
  const projectId = store.config().projectId;
  const app = Fastify({ logger: false, bodyLimit: 50_000_000 });
  const token = store.token();
  function actor(body: any): Actor {
    const a = body?.actor;
    if (
      !a ||
      !["human", "agent"].includes(a.kind) ||
      typeof a.name !== "string" ||
      !a.name.trim()
    )
      throw new Problem(
        422,
        "Provide an actor with a name and human/agent kind",
      );
    return a;
  }
  app.setErrorHandler((err: any, _req, reply) => {
    const status =
      err instanceof ZodError ? 422 : (err.status ?? err.statusCode ?? 500);
    reply.code(status).send({
      error: status === 500 ? "Unexpected server error" : err.message,
      detail: err.detail ?? (err instanceof ZodError ? err.issues : undefined),
    });
    if (status === 500) console.error(err);
  });
  app.addHook("onRequest", async (req, reply) => {
    const host = req.headers.host ?? "";
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(host))
      throw new Problem(403, "Use the loopback address 127.0.0.1");
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}`)
      throw new Problem(403, "Cross-origin access is not allowed");
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer");
    // The router matches percent-decoded paths, so authorize by the matched route
    // (or the decoded path for unmatched requests), never the raw URL.
    const route = req.routeOptions.url;
    if (route === "/health") return;
    let pathname = req.url.split("?")[0];
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      /* Malformed escapes cannot match an API route. */
    }
    if (route?.startsWith("/api/") || /^\/+api(?:\/|$)/i.test(pathname)) {
      const header = req.headers.authorization?.replace(/^Bearer /, "");
      const cookie = req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("workboard="))
        ?.slice(10);
      const supplied = header ?? cookie ?? "";
      if (
        supplied.length !== token.length ||
        !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
      )
        throw new Problem(
          401,
          "Open Control Room locally or provide its project token",
        );
    } else {
      if (req.headers["sec-fetch-site"] === "cross-site")
        throw new Problem(403, "Open Control Room from its launcher");
      reply.header(
        "Set-Cookie",
        `workboard=${token}; HttpOnly; SameSite=Strict; Path=/`,
      );
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws://127.0.0.1:*; frame-ancestors 'none'; object-src 'none'",
      );
    }
  });
  app.get("/health", async () => ({
    ok: true,
    project: store.config().projectId,
  }));
  app.get("/api/state", async () => store.state());
  app.post("/api/shutdown", async () => {
    setTimeout(() => process.kill(process.pid, "SIGTERM"), 100).unref();
    return { ok: true };
  });
  app.get("/api/preferences", async () => {
    const p = store.file(".local/preferences.json");
    return fs.existsSync(p) ? JSON.parse(read(p)) : {};
  });
  app.patch("/api/preferences", async (req: any) => {
    const p = store.file(".local/preferences.json");
    const before = fs.existsSync(p) ? JSON.parse(read(p)) : {};
    atomic(p, JSON.stringify({ ...before, ...req.body }));
    return { ok: true };
  });
  app.get("/api/records/:id", async (req: any) => store.get(req.params.id));
  app.get("/api/records/:id/context", async (req: any) => {
    // ?format=markdown returns a prompt-ready brief with a token estimate;
    // ?brief=1 trims decision and rule bodies to their first paragraph.
    if (req.query?.format === "markdown")
      return store.contextMarkdown(req.params.id, !!req.query?.brief);
    const c = store.context(req.params.id);
    return {
      ...c,
      attachments: c.attachments.map((a) => imageContext(store, a)),
    };
  });
  app.post("/api/next", async (req: any) => {
    const r = store.next(actor(req.body));
    return r
      ? { ticket: r, brief: store.contextMarkdown(r.meta.id, true) }
      : { ticket: null, brief: null };
  });
  app.get("/api/records/:id/history", async (req: any) =>
    store.historyFor(req.params.id),
  );
  app.post("/api/records", async (req: any) => {
    const b = req.body;
    return store.create(b.kind as Kind, b.meta ?? {}, b.body ?? "", actor(b));
  });
  app.patch("/api/records/:id", async (req: any) => {
    const b = req.body;
    return store.update(
      req.params.id,
      b.revision,
      b.patch ?? {},
      b.body,
      actor(b),
    );
  });
  app.post("/api/records/:id/comments", async (req: any) =>
    store.comment(
      req.params.id,
      req.body.body ?? "",
      actor(req.body),
      req.body.kind,
    ),
  );
  app.patch("/api/comments/:id", async (req: any) => {
    await store.resolveComment(
      req.params.id,
      req.body.revision,
      !!req.body.resolved,
      actor(req.body),
    );
    return { ok: true };
  });
  app.post("/api/records/:id/claim", async (req: any) =>
    store.claim(
      req.params.id,
      actor(req.body),
      req.body.worktree ?? store.root,
      !!req.body.release,
    ),
  );
  app.post("/api/records/:id/review", async (req: any) => {
    const b = req.body;
    return store.review(
      req.params.id,
      b.revision,
      b.handoff ?? "",
      b.evidence ?? "",
      b.exceptions ?? "",
      actor(b),
      {
        branch: b.branch,
        pr: b.pr,
        commits: b.commits,
        verification: b.verification,
      },
    );
  });
  app.patch("/api/config", async (req: any) =>
    store.updateConfig(req.body.revision, req.body.patch),
  );
  app.post("/api/reconcile", async (req: any) => {
    await store.reconcile(req.body.branch);
    return { ok: true };
  });
  app.post("/api/images", async (req: any) =>
    addImage(store, req.body.name ?? "Screenshot", req.body.data ?? ""),
  );
  app.get("/api/images/:id", async (req: any) =>
    store.attachment(req.params.id),
  );
  app.get("/api/images/:id/base", async (req: any, reply) => {
    const a = store.attachment(req.params.id);
    if (a.missing)
      throw new Problem(
        404,
        "Image is local and is not present in this checkout. Restore an attachment backup.",
      );
    return reply
      .type("image/png")
      .send(fs.readFileSync(store.file(`assets/${a.id}/base.png`)));
  });
  app.get("/api/images/:id/preview", async (req: any, reply) => {
    const a = store.attachment(req.params.id),
      p = store.file(`assets/${a.id}/preview.png`);
    if (!fs.existsSync(p))
      throw new Problem(404, "No current annotated preview");
    return reply.type("image/png").send(fs.readFileSync(p));
  });
  app.put("/api/images/:id/annotations", async (req: any) => {
    const b = req.body;
    return saveAnnotations(
      store,
      req.params.id,
      b.revision,
      b.annotations,
      b.preview,
      actor(b),
    );
  });
  app.get("/api/export", async (_req, reply) =>
    reply
      .type("application/gzip")
      .header(
        "Content-Disposition",
        'attachment; filename="workboard-backup.json.gz"',
      )
      .send(await backup(store)),
  );
  app.post("/api/restore", { bodyLimit: 300_000_000 }, async (req: any) => {
    const result = await restore(
      store,
      Buffer.from(req.body.data ?? "", "base64"),
    );
    await store.migrateTicketNumbers();
    return result;
  });
  app.get("/api/documents", async () => documentFiles(store));
  app.post("/api/import/brief", async (req: any) =>
    importBrief(store, req.body.files),
  );
  app.get("/api/import", async () => importBatches(store));
  app.post("/api/import", async (req: any) =>
    stageImport(store, req.body.proposals, actor(req.body)),
  );
  app.post("/api/import/:id/apply", async (req: any) =>
    applyImport(
      store,
      req.params.id,
      req.body.ids,
      req.body.revision,
      actor(req.body),
    ),
  );
  const servicePort = () => Number(new URL(app.listeningOrigin).port);
  app.post("/api/active", async () => {
    activateCapture(store, servicePort());
    if (options.native) startCompanion(toolRoot);
    return { ok: true };
  });
  app.get("/api/capture/status", async () => captureStatus());
  app.post("/api/capture/restart", async () => {
    if (process.platform !== "darwin")
      throw new Problem(400, "The capture companion is macOS only");
    await restartCompanion(toolRoot);
    return { ok: true };
  });
  // Opens the macOS privacy pane the capture companion needs.
  app.post("/api/capture/settings", async (req: any) => {
    const panes: Record<string, string> = {
      "input-monitoring": "Privacy_ListenEvent",
      "screen-recording": "Privacy_ScreenCapture",
    };
    const pane = panes[req.body?.pane];
    if (!pane) throw new Problem(400, "Unknown settings pane");
    if (process.platform !== "darwin")
      throw new Problem(400, "System permissions are only needed on macOS");
    spawn(
      "open",
      [`x-apple.systempreferences:com.apple.preference.security?${pane}`],
      { stdio: "ignore" },
    ).unref();
    return { ok: true };
  });
  app.get("/api/capture/drafts", async () => {
    const p = store.file(".local/capture-drafts");
    return fs.existsSync(p)
      ? fs.readdirSync(p).filter((f) => /^capture-[\w-]+\.png$/.test(f))
      : [];
  });
  app.post("/api/capture/recover", async (req: any) => {
    const name = String(req.body.name);
    if (!/^capture-[\w-]+\.png$/.test(name))
      throw new Problem(422, "Invalid capture draft");
    const p = store.file(`.local/capture-drafts/${name}`);
    const image = await addImage(
      store,
      name,
      fs.readFileSync(p).toString("base64"),
    );
    fs.unlinkSync(p);
    return image;
  });
  app.get("/api/capture/projects", async () => captureProjects());
  app.post("/api/capture/request", async () => {
    if (process.platform !== "darwin")
      throw new Problem(422, "Native capture requires macOS");
    activateCapture(store, servicePort());
    atomic(
      path.join(captureRoot, "request.json"),
      JSON.stringify({ at: Date.now() }),
      0o600,
    );
    return { ok: true };
  });
  app.post("/api/capture/move/:id", async (req: any) => {
    const targetId = String(req.body.project);
    const p = path.join(captureRoot, `${targetId}.json`);
    if (!/^project-[a-f0-9]+$/.test(targetId) || !fs.existsSync(p))
      throw new Problem(422, "Destination project is not running");
    const target = JSON.parse(read(p));
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(target.url))
      throw new Problem(422, "Invalid local destination");
    const a = store.attachment(req.params.id);
    const response = await fetch(target.url + "/api/images", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${target.token}`,
      },
      body: JSON.stringify({
        name: a.name,
        data: fs
          .readFileSync(store.file(`assets/${a.id}/base.png`))
          .toString("base64"),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new Problem(
        502,
        "Destination could not accept the image; the original is retained",
      );
    const moved: any = await response.json();
    const preview = store.file(`assets/${a.id}/preview.png`);
    const copied = await fetch(
      `${target.url}/api/images/${moved.id}/annotations`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${target.token}`,
        },
        body: JSON.stringify({
          revision: moved.revision,
          annotations: a.annotations,
          preview: fs.existsSync(preview)
            ? fs.readFileSync(preview).toString("base64")
            : undefined,
          actor: { name: "You", kind: "human" },
        }),
      },
    );
    if (!copied.ok)
      throw new Problem(
        502,
        "Image copied but annotation copy failed; original retained",
      );
    return { url: `${target.url}/#image=${moved.id}`, retainedOriginal: true };
  });
  // Files are the authoritative index. Watching invalidates browser views; reconnects fetch a fresh snapshot.
  const clients = new Set<any>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(store.dir, { recursive: true }, (_event, name) => {
      if (
        !name ||
        String(name).startsWith(".local") ||
        String(name).endsWith(".tmp")
      )
        return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const response of clients) response.write("data: changed\n\n");
      }, 100);
    });
    watcher.on("error", () => {
      watcher?.close();
      watcher = undefined;
    });
  } catch {
    /* Periodic client refresh also supports systems without recursive watching. */
  }
  app.get("/api/events", async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    reply.raw.write("data: connected\n\n");
    clients.add(reply.raw);
    req.raw.on("close", () => clients.delete(reply.raw));
  });
  const heartbeat = setInterval(() => {
    for (const response of clients) response.write(": ping\n\n");
  }, 15000);
  heartbeat.unref();
  app.addHook("preClose", async () => {
    for (const c of clients) c.end();
    clients.clear();
  });
  app.addHook("onClose", async () => {
    const registration = path.join(captureRoot, `${projectId}.json`);
    if (fs.existsSync(registration)) fs.unlinkSync(registration);
    watcher?.close();
    clearInterval(heartbeat);
    clearTimeout(timer);
    for (const c of clients) c.end();
  });
  const web = options.webRoot ?? path.join(toolRoot, "dist", "web");
  if (options.dev) {
    const { createServer } = await import("vite").catch(() => {
      throw new Error(
        "--dev needs the tool source checkout with its development dependencies installed",
      );
    });
    const vite = await createServer({
      configFile: path.join(toolRoot, "vite.config.ts"),
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/"))
        return reply.code(404).send({ error: "Unknown API route" });
      // Hijacking bypasses Fastify's reply, so the session cookie and other
      // headers set by the request hook must be copied to the raw response.
      // Vite's inline refresh preamble needs the production CSP relaxed here.
      for (const [name, value] of Object.entries(reply.getHeaders()))
        if (value !== undefined && name !== "content-security-policy")
          reply.raw.setHeader(name, value as string);
      reply.hijack();
      vite.middlewares(req.raw, reply.raw, () => {
        reply.raw.statusCode = 404;
        reply.raw.end("Not found");
      });
    });
    app.addHook("onClose", async () => vite.close());
  } else if (fs.existsSync(web)) {
    await app.register(staticFiles, { root: web });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.code(404).send({ error: "Unknown API route" })
        : reply.sendFile("index.html"),
    );
  }
  return app;
}
