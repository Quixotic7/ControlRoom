import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Store } from "./store.js";
import { atomic, read, Problem } from "./files.js";

export function privateIPv4(value: string) {
  return (
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value) &&
    value.split(".").length === 4 &&
    value.split(".").every((v) => /^\d{1,3}$/.test(v) && Number(v) <= 255)
  );
}
export function lanAddresses() {
  return [
    ...new Set(
      Object.values(os.networkInterfaces()).flatMap((list) =>
        (list ?? [])
          .filter(
            (i) => i.family === "IPv4" && !i.internal && privateIPv4(i.address),
          )
          .map((i) => i.address),
      ),
    ),
  ];
}
type NetworkPreferences = {
  enabled: boolean;
  requirePairing: boolean;
  sessionHours: number;
};
const validHours = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0.25 &&
  value <= 8760;
export function networkSettings(store: Store): NetworkPreferences {
  const p = store.file(".local/network.json");
  const saved = fs.existsSync(p) ? JSON.parse(read(p)) : {};
  return {
    enabled: saved.enabled === true,
    requirePairing: saved.requirePairing !== false,
    sessionHours: validHours(saved.sessionHours) ? saved.sessionHours : 8,
  };
}
export function networkPreference(store: Store): boolean {
  return networkSettings(store).enabled;
}
export function saveNetworkPreference(store: Store, enabled: boolean) {
  atomic(
    store.file(".local/network.json"),
    JSON.stringify({ ...networkSettings(store), enabled }),
    0o600,
  );
}
const digest = (s: string) =>
  crypto.createHash("sha256").update(s).digest("hex");
const equal = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const loopback = (ip: string) =>
  ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
const peerIPv4 = (ip: string) => ip.replace(/^::ffff:/, "");
type Session = { hash: string; expiresAt: number };
export function registerNetwork(
  app: FastifyInstance,
  store: Store,
  options: { lan?: boolean; addresses?: () => string[] },
) {
  const project = store.config().projectId,
    localToken = store.token();
  const sessionFile = store.file(".local/lan-sessions.json");
  let enabled = !!options.lan;
  let preferences = networkSettings(store);
  let sessions: Session[] = [];
  if (enabled && fs.existsSync(sessionFile)) {
    const parsed = JSON.parse(read(sessionFile));
    if (Array.isArray(parsed))
      sessions = parsed.filter(
        (s) =>
          typeof s.hash === "string" &&
          typeof s.expiresAt === "number" &&
          s.expiresAt > Date.now(),
      );
  }
  let pairing: { hash: string; expiresAt: number } | null = null;
  const attempts = new Map<string, { count: number; until: number }>();
  const revoked = new Set<() => void>();
  const port = () => {
    const address = app.server.address();
    return address && typeof address === "object" ? address.port : 0;
  };
  const addresses = () =>
    (options.addresses ?? lanAddresses)().filter(privateIPv4);
  const isLocal = (req: FastifyRequest) =>
    /^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host ?? "") && loopback(req.ip);
  const cookieName = (req: FastifyRequest) =>
    `controlroom_lan_${project}_${port() || new URL("http://" + req.headers.host).port || 80}`;
  const cookie = (req: FastifyRequest, name: string) =>
    req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(name + "="))
      ?.slice(name.length + 1) ?? "";
  const supplied = (req: FastifyRequest, local: boolean) =>
    req.headers.authorization?.replace(/^Bearer /, "") ??
    cookie(req, local ? `workboard_${project}` : cookieName(req));
  const authorized = (req: FastifyRequest) => {
    if (isLocal(req)) return equal(supplied(req, true), localToken);
    if (enabled && !preferences.requirePairing) return true;
    const value = supplied(req, false);
    return (
      enabled &&
      !!value &&
      sessions.some(
        (s) => s.expiresAt > Date.now() && equal(s.hash, digest(value)),
      )
    );
  };
  const persist = () => {
    sessions = sessions.filter((s) => s.expiresAt > Date.now());
    atomic(sessionFile, JSON.stringify(sessions), 0o600);
  };
  const revoke = () => {
    sessions = [];
    pairing = null;
    persist();
    for (const fn of revoked) fn();
  };
  const hostOnly = (req: FastifyRequest) => {
    if (!isLocal(req))
      throw new Problem(
        403,
        "This control is available only on the host at 127.0.0.1",
      );
  };
  const status = () => ({
    enabled,
    boundToLan: !!options.lan,
    configured: networkPreference(store),
    restartRequired: networkPreference(store) && !options.lan,
    urls: enabled ? addresses().map((ip) => `http://${ip}:${port()}`) : [],
    sessions: sessions.filter((s) => s.expiresAt > Date.now()).length,
    requirePairing: preferences.requirePairing,
    sessionHours: preferences.sessionHours,
    transport: "HTTP on a trusted LAN; traffic is not encrypted.",
    port: port(),
  });
  app.addHook("onRequest", async (req, reply) => {
    const host = req.headers.host ?? "",
      local = isLocal(req);
    const match = /^(\d+\.\d+\.\d+\.\d+)(?::(\d+))?$/.exec(host);
    if (
      !local &&
      (!enabled ||
        !match ||
        !addresses().includes(match[1]) ||
        (!loopback(req.ip) && !privateIPv4(peerIPv4(req.ip))) ||
        (port() && Number(match[2] ?? 80) !== port()))
    )
      throw new Problem(
        403,
        "Use 127.0.0.1 locally, or an enabled LAN address shown on the host.",
      );
    if (req.headers.origin && req.headers.origin !== `http://${host}`)
      throw new Problem(403, "Cross-origin access is not allowed");
    if (req.headers["sec-fetch-site"] === "cross-site")
      throw new Problem(403, "Cross-site access is not allowed");
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("Cache-Control", "no-store");
    const route = req.routeOptions.url;
    let pathname = req.url.split("?")[0];
    try {
      pathname = decodeURIComponent(pathname);
    } catch {}
    const api = route?.startsWith("/api/") || /^\/+api(?:\/|$)/i.test(pathname);
    if (route === "/api/session" || route === "/api/pair") return;
    if (route === "/health" && local) return;
    if (api || route === "/health") {
      if (!authorized(req))
        throw new Problem(
          401,
          local
            ? "Open Control Room locally or provide its project token"
            : "Pair this browser using a code from the host’s Network access settings.",
        );
      if (
        !local &&
        (route?.startsWith("/api/network") ||
          route?.startsWith("/api/capture") ||
          route?.startsWith("/api/import") ||
          route?.startsWith("/api/orchestration") ||
          [
            "/api/active",
            "/api/shutdown",
            "/api/documents",
            "/api/restore",
            "/api/reconcile",
            "/api/config",
          ].includes(route ?? ""))
      )
        hostOnly(req);
    } else {
      if (local)
        reply.header(
          "Set-Cookie",
          `workboard_${project}=${localToken}; HttpOnly; SameSite=Strict; Path=/`,
        );
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws://127.0.0.1:*; frame-ancestors 'none'; object-src 'none'",
      );
    }
  });
  app.get("/api/session", async (req) => ({
    local: isLocal(req),
    authenticated: authorized(req),
    requirePairing: preferences.requirePairing,
    sessionHours: preferences.sessionHours,
  }));
  app.post("/api/pair", async (req: any, reply) => {
    if (!enabled) throw new Problem(403, "LAN access is disabled");
    if (!preferences.requirePairing)
      throw new Problem(
        409,
        "Pairing is not required. Open the board directly.",
      );
    // Pairing is for the LAN origin, never a replacement for local bootstrap.
    if (isLocal(req))
      throw new Problem(
        400,
        "Open the LAN address on the other device to pair",
      );
    const now = Date.now(),
      ip = req.ip;
    for (const [key, value] of attempts)
      if (value.until <= now) attempts.delete(key);
    if (attempts.size >= 1000 && !attempts.has(ip))
      throw new Problem(429, "Too many pairing attempts. Try again later.");
    const rate = attempts.get(ip) ?? { count: 0, until: now + 60000 };
    rate.count++;
    attempts.set(ip, rate);
    if (rate.count > 10)
      throw new Problem(
        429,
        "Too many pairing attempts. Wait one minute and retry.",
      );
    const code =
      typeof req.body?.code === "string"
        ? req.body.code.trim().replace(/[ -]/g, "").toLowerCase()
        : "";
    if (
      !pairing ||
      pairing.expiresAt <= now ||
      !equal(pairing.hash, digest(code))
    )
      throw new Problem(
        401,
        "Invalid or expired pairing code. Generate a new code on the host.",
      );
    const value = crypto.randomBytes(32).toString("hex");
    pairing = null;
    const seconds = Math.round(preferences.sessionHours * 3600);
    sessions.push({ hash: digest(value), expiresAt: now + seconds * 1000 });
    persist();
    reply.header(
      "Set-Cookie",
      `${cookieName(req)}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}`,
    );
    return { ok: true };
  });
  app.get("/api/network", async (req) => {
    hostOnly(req);
    return status();
  });
  app.post("/api/network/pairing", async (req) => {
    hostOnly(req);
    if (!enabled)
      throw new Problem(409, "Enable LAN access and restart the service first");
    if (!preferences.requirePairing)
      throw new Problem(409, "Enable Require pairing code first");
    const code = crypto.randomBytes(12).toString("hex");
    pairing = { hash: digest(code), expiresAt: Date.now() + 600000 };
    return { code, expiresAt: new Date(pairing.expiresAt).toISOString() };
  });
  app.post("/api/network/revoke", async (req) => {
    hostOnly(req);
    revoke();
    return status();
  });
  app.post("/api/network/config", async (req: any) => {
    hostOnly(req);
    const patch = req.body;
    if (
      !patch ||
      typeof patch !== "object" ||
      Array.isArray(patch) ||
      !Object.keys(patch).length ||
      Object.keys(patch).some(
        (k) => !["enabled", "requirePairing", "sessionHours"].includes(k),
      )
    )
      throw new Problem(422, "Provide enabled, requirePairing or sessionHours");
    for (const key of ["enabled", "requirePairing"])
      if (key in patch && typeof patch[key] !== "boolean")
        throw new Problem(422, `${key} must be a boolean`);
    if ("sessionHours" in patch && !validHours(patch.sessionHours))
      throw new Problem(
        422,
        "Access duration must be between 0.25 and 8760 hours",
      );
    const next = { ...preferences, ...patch };
    atomic(store.file(".local/network.json"), JSON.stringify(next), 0o600);
    const changedPairing = preferences.requirePairing !== next.requirePairing;
    preferences = next;
    enabled = !!options.lan && preferences.enabled;
    if (!enabled || changedPairing) revoke();
    return status();
  });
  if (!enabled) revoke();
  return {
    authorized,
    isLocal,
    status,
    onRevoke: (fn: () => void) => {
      revoked.add(fn);
      return () => revoked.delete(fn);
    },
  };
}
