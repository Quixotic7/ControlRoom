import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Problem } from "./files.js";
import type { Store } from "./store.js";

export type BuildOpener = {
  platform?: NodeJS.Platform;
  open?: (args: string[]) => Promise<void>;
};
export type BuildAccess = { local: boolean; lan: boolean };
const within = (root: string, file: string) =>
  file === root || file.startsWith(root + path.sep);

function resolveBuild(store: Store, input: string) {
  if (!input.trim() || /\0|^[a-z][a-z0-9+.-]*:/i.test(input))
    throw new Problem(422, "Build must be a local file path, not a URL");
  const config = store.config().orchestration as
    | { repository?: string; companionRepositories?: { repository: string }[] }
    | undefined;
  const roots = [
    store.root,
    config?.repository,
    ...(config?.companionRepositories ?? []).map((r) => r.repository),
  ]
    .filter((root): root is string => !!root)
    .map((root) => path.resolve(store.root, root));
  const resolved = path.resolve(store.root, input);
  if (!roots.some((root) => within(root, resolved)))
    throw new Problem(
      403,
      "Build must be inside this project or a configured code repository",
    );
  if (!fs.existsSync(resolved))
    throw new Problem(404, `Build not found at ${resolved}`);
  const real = fs.realpathSync(resolved);
  if (
    !roots.some(
      (root) => fs.existsSync(root) && within(fs.realpathSync(root), real),
    )
  )
    throw new Problem(
      403,
      "Build resolves outside this project and its configured code repositories",
    );
  const stat = fs.statSync(real);
  if (
    !stat.isFile() &&
    !(stat.isDirectory() && resolved.toLowerCase().endsWith(".app"))
  )
    throw new Problem(
      422,
      "Choose an app bundle, executable, or document as the build",
    );
  return real;
}

export function buildAvailability(
  store: Store,
  id: string,
  access: BuildAccess,
  opener: BuildOpener = {},
) {
  const ticket = store.get(id);
  if (ticket.meta.kind !== "ticket")
    throw new Problem(422, "Review builds belong to tickets");
  const build = ticket.meta.build;
  const result = { build: build ?? null, revision: ticket.revision };
  try {
    if (!build)
      throw new Problem(404, "No review build is recorded for this ticket");
    if (access.lan)
      throw new Problem(
        403,
        "Build launch and reveal are disabled while the service is in LAN mode. Use local-only mode on the host.",
      );
    if (!access.local)
      throw new Problem(
        403,
        "Open Control Room at 127.0.0.1 on the host to launch or reveal a build",
      );
    if ((opener.platform ?? process.platform) !== "darwin")
      throw new Problem(
        422,
        "Build launch and reveal are available on macOS only",
      );
    return {
      ...result,
      available: true as const,
      resolvedPath: resolveBuild(store, build.path),
    };
  } catch (error) {
    if (!(error instanceof Problem)) throw error;
    return {
      ...result,
      available: false as const,
      reason: error.message,
      status: error.status,
    };
  }
}

export async function openReviewBuild(
  store: Store,
  id: string,
  revision: string,
  action: "launch" | "reveal",
  access: BuildAccess,
  opener: BuildOpener = {},
) {
  const status = buildAvailability(store, id, access, opener);
  if (status.revision !== revision)
    throw new Problem(
      409,
      "Ticket build changed; reload before launching or revealing it",
    );
  if (!status.available)
    throw new Problem(
      status.status ?? 422,
      status.reason ?? "Build is unavailable",
    );
  const args =
    action === "reveal" ? ["-R", status.resolvedPath] : [status.resolvedPath];
  try {
    // An absolute, checked filename is one argument, never shell text or open flags.
    if (opener.open) await opener.open(args);
    else
      await promisify(execFile)("/usr/bin/open", args, {
        timeout: 10000,
        maxBuffer: 16384,
      });
  } catch {
    throw new Problem(
      422,
      `macOS could not ${action} the build at ${status.resolvedPath}`,
    );
  }
  return { ok: true };
}
