import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../../src/store";
import { buildServer } from "../../src/server";
import { lanAddresses, saveNetworkPreference } from "../../src/network";
const ip = lanAddresses()[0];
let app: Awaited<ReturnType<typeof buildServer>>,
  store: Store,
  root: string,
  local: string,
  lan: string;
test.beforeAll(async () => {
  if (!ip) return;
  root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-lan-browser-")),
  );
  store = new Store(root).initialize("LAN review fixture");
  saveNetworkPreference(store, true);
  app = await buildServer(store, { lan: true });
  await app.listen({ host: "0.0.0.0", port: 0 });
  const port = (app.server.address() as any).port;
  local = `http://127.0.0.1:${port}`;
  lan = `http://${ip}:${port}`;
});
test.afterAll(async () => {
  if (app) await app.close();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});
async function hostSettings(page: Page) {
  await page.goto(local);
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page
    .getByRole("button", { name: "Settings & backups", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Network access", exact: true }),
  ).toBeVisible();
}
async function generate(page: Page) {
  await page
    .getByRole("button", { name: "Generate pairing code", exact: true })
    .click();
  return page.getByLabel("One-use pairing code", { exact: true }).inputValue();
}
async function connect(page: Page, code: string) {
  await page.getByLabel("Pairing code", { exact: true }).fill(code);
  await page
    .getByRole("button", { name: "Connect to project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to Control Room", exact: true }),
  ).toHaveCount(0);
}
test("LAN browsers pair without receiving the local token, edit tickets, annotate over HTTP, and retain drafts through revocation", async ({
  page,
  browser,
}) => {
  test.skip(
    !ip,
    "Requires a private IPv4 interface for a real LAN-origin browser check",
  );
  await hostSettings(page);
  await expect(
    page.getByRole("link", { name: lan, exact: true }),
  ).toBeVisible();
  const remoteContext = await browser.newContext(),
    remote = await remoteContext.newPage();
  try {
    await remote.goto(lan);
    await expect(
      remote.getByRole("heading", { name: "Connect to Control Room" }),
    ).toBeVisible();
    await remote.screenshot({ path: "/private/tmp/cr-network-pairing.png" });
    expect((await remote.request.get(lan + "/api/state")).status()).toBe(401);
    expect(
      (await remoteContext.cookies()).some((c) =>
        c.name.startsWith("workboard_"),
      ),
    ).toBe(false);
    await connect(remote, await generate(page));
    // Local UI preferences are shared, so explicitly return to Project after pairing.
    await remote.getByRole("button", { name: "Project", exact: true }).click();
    expect(await remote.evaluate(() => typeof crypto.randomUUID)).toBe(
      "undefined",
    );
    await remote
      .getByRole("button", { name: "New ticket", exact: true })
      .click();
    await remote
      .getByLabel("Title", { exact: true })
      .fill("Created from the LAN browser");
    await remote
      .getByRole("button", { name: "Create ticket", exact: true })
      .click();
    const created = store
      .list()
      .find((r) => r.meta.title === "Created from the LAN browser");
    expect(created).toBeTruthy();
    await remote.goto(lan + "/#ticket=" + created!.meta.id);
    await remote
      .getByLabel("Title", { exact: true })
      .fill("Unsaved LAN draft survives");
    await page
      .getByRole("button", { name: "Revoke all remote sessions", exact: true })
      .click();
    // The next API read reports revocation; pairing overlays any open ticket dialog.
    await remote.evaluate(async () => {
      await fetch("/api/state");
      window.dispatchEvent(new Event("focus"));
    });
    await expect(
      remote.getByRole("heading", {
        name: "Connect to Control Room",
        exact: true,
      }),
    ).toBeVisible();
    await connect(remote, await generate(page));
    await expect(remote.getByLabel("Title", { exact: true })).toHaveValue(
      "Unsaved LAN draft survives",
    );
    await remote
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(remote.getByLabel("Title", { exact: true })).toHaveCount(0);
    const png = await remote.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 480;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(0, 0, 640, 480);
      return c.toDataURL("image/png").split(",")[1];
    });
    const image = await (
      await remote.request.post(lan + "/api/images", {
        data: { name: "LAN screenshot", data: png },
      })
    ).json();
    await remote.goto(lan + "/#image=" + image.id);
    await expect(
      remote.getByRole("button", { name: "Close annotation editor" }),
    ).toBeVisible();
    await remote.getByRole("button", { name: "Pin", exact: false }).click();
    const area = remote.locator(".image-canvas svg");
    await area.click({ position: { x: 100, y: 100 } });
    await remote
      .getByLabel("Instruction / text")
      .fill("Feedback added over LAN HTTP");
    await remote
      .getByRole("button", { name: "Save screenshot", exact: true })
      .click();
    await expect(remote.locator(".annotation-dialog")).toHaveCount(0);
    await remote.goto(lan + "/#image=" + image.id);
    await expect(remote.locator(".image-canvas svg g[data-note]")).toHaveCount(
      1,
    );
    await remote
      .getByRole("button", { name: "Select / move", exact: false })
      .click();
    await remote.locator(".image-canvas svg g[data-note]").click();
    await expect(remote.getByLabel("Instruction / text")).toHaveValue(
      "Feedback added over LAN HTTP",
    );
    await remote
      .getByRole("button", { name: "Close annotation editor" })
      .click();
    expect(
      (
        await remote.request.post(lan + "/api/capture/request", { data: {} })
      ).status(),
    ).toBe(403);
    await remote.reload();
    await expect(
      remote.getByRole("heading", { name: "Connect to Control Room" }),
    ).toHaveCount(0);
    await page.screenshot({ path: "/private/tmp/cr-network-settings.png" });
  } finally {
    await remoteContext.close();
  }
});
test("disabling LAN immediately denies remote requests while the host remains available", async ({
  page,
  browser,
}) => {
  test.skip(!ip, "Requires a private IPv4 interface");
  await hostSettings(page);
  const context = await browser.newContext(),
    remote = await context.newPage();
  try {
    await remote.goto(lan);
    await connect(remote, await generate(page));
    await page
      .getByRole("button", { name: "Disable LAN access", exact: true })
      .click();
    expect((await remote.request.get(lan + "/api/state")).status()).toBe(403);
    expect((await page.request.get(local + "/api/state")).status()).toBe(200);
    await expect(
      page.getByRole("button", { name: "Enable LAN access", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Enable LAN access", exact: true })
      .click();
    expect((await remote.request.get(lan + "/api/state")).status()).toBe(401);
  } finally {
    await context.close();
  }
});

test("host can choose open LAN or configurable paired access without losing remote drafts", async ({
  page,
  browser,
}) => {
  test.skip(!ip, "Requires a private IPv4 interface");
  await hostSettings(page);
  const hours = page.getByLabel("Paired access duration (hours)", {
    exact: true,
  });
  await hours.fill("72");
  await page
    .getByRole("button", { name: "Save access duration", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save access duration", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(hours).toHaveValue("72");
  const context = await browser.newContext(),
    remote = await context.newPage();
  try {
    await remote.goto(lan);
    await expect(
      remote.getByText("Pairing grants access to this project for 72 hours", {
        exact: false,
      }),
    ).toBeVisible();
    await page.getByLabel("Require pairing code", { exact: true }).click();
    await expect(
      page.getByLabel("Require pairing code", { exact: true }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("button", { name: "Generate pairing code", exact: true }),
    ).toHaveCount(0);
    await expect(
      remote.getByRole("heading", {
        name: "Connect to Control Room",
        exact: true,
      }),
    ).toHaveCount(0, { timeout: 10000 });
    expect((await remote.request.get(lan + "/api/state")).status()).toBe(200);
    expect(
      (await context.cookies()).some(
        (c) =>
          c.name.startsWith("controlroom_lan_") ||
          c.name.startsWith("workboard_"),
      ),
    ).toBe(false);
    await remote.getByRole("button", { name: "Project", exact: true }).click();
    await remote
      .getByRole("button", { name: "New ticket", exact: true })
      .click();
    await remote
      .getByLabel("Title", { exact: true })
      .fill("Draft created without a code");
    await page.screenshot({ path: "/private/tmp/cr-lan-open-settings.png" });
    await page.getByLabel("Require pairing code", { exact: true }).click();
    await expect(
      page.getByLabel("Require pairing code", { exact: true }),
    ).toBeChecked();
    await expect(hours).toHaveValue("72");
    await remote.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      remote.getByRole("heading", {
        name: "Connect to Control Room",
        exact: true,
      }),
    ).toBeVisible();
    expect((await remote.request.get(lan + "/api/state")).status()).toBe(401);
    await connect(remote, await generate(page));
    await expect(remote.getByLabel("Title", { exact: true })).toHaveValue(
      "Draft created without a code",
    );
    const cookie = (await context.cookies()).find((c) =>
      c.name.startsWith("controlroom_lan_"),
    )!;
    expect(cookie.expires - Date.now() / 1000).toBeGreaterThan(71.9 * 3600);
    expect(cookie.expires - Date.now() / 1000).toBeLessThanOrEqual(72 * 3600);
    await remote
      .getByRole("button", { name: "Create ticket", exact: true })
      .click();
    await expect(remote.getByLabel("Title", { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: "/private/tmp/cr-lan-duration-settings.png",
    });
  } finally {
    await context.close();
  }
});
