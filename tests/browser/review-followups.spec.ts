import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { page: "project", selected: null, viewId: "board" },
  });
});
test("standalone ticket saves when returning through its logo and omits the board", async ({
  page,
}) => {
  const response = await page.request.post("/api/records", {
    data: {
      kind: "ticket",
      meta: { title: "Standalone editing" },
      body: "Original",
      actor: { name: "You", kind: "human" },
    },
  });
  const r = await response.json();
  await page.goto(`/?ticketOnly=1#ticket=${r.meta.id}`);
  await expect(page.locator(".standalone-record")).toBeVisible();
  await expect(page.locator(".board-head")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Control Room: back to board" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Standalone saved");
  await page.screenshot({ path: "test-results/standalone-ticket.png" });
  await page
    .getByRole("button", { name: "Control Room: back to board" })
    .click();
  await expect(page.locator(".record-dialog")).toHaveCount(0);
  await expect(page.locator(".board-head")).toBeVisible();
  const saved = await (
    await page.request.get(`/api/records/${r.meta.id}`)
  ).json();
  expect(saved.meta.title).toBe("Standalone saved");
  await expect(page).toHaveURL(/\/$/);
});
test("review instructions appear beside review actions without searching the thread", async ({
  page,
}) => {
  const r = await (
    await page.request.post("/api/records", {
      data: {
        kind: "ticket",
        meta: {
          title: "Clear review instructions",
          status: "review",
          reviewInstructions:
            "Search for an existing child by number, attach it, and confirm its parent.",
        },
        body: "",
        actor: { name: "You", kind: "human" },
      },
    })
  ).json();
  await page.goto(`/#ticket=${r.meta.id}`);
  await expect(
    page.getByRole("region", { name: "What to review" }),
  ).toContainText("Search for an existing child");
  await expect(
    page.getByRole("button", { name: "Accept into Done", exact: true }),
  ).toBeVisible();
});
test("actual interaction activates capture; background refresh and unfocused events do not", async ({
  page,
}) => {
  let activations = 0;
  await page.addInitScript(() => {
    (window as any).testFocused = true;
    document.hasFocus = () => (window as any).testFocused;
  });
  await page.route("**/api/active", async (route) => {
    activations++;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await expect(page.locator(".board-head")).toBeVisible();
  await expect.poll(() => activations).toBeGreaterThan(0);
  const first = activations;
  await page.evaluate(() =>
    window.dispatchEvent(new PointerEvent("pointerdown")),
  );
  await expect.poll(() => activations).toBeGreaterThan(first);
  const second = activations;
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" })),
  );
  await expect.poll(() => activations).toBeGreaterThan(second);
  const final = activations;
  await page.evaluate(() => {
    (window as any).testFocused = false;
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new PointerEvent("pointerdown"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // Wait through a real state read initiated by the synthetic focus event.
  await page.request.get("/api/state");
  await expect(page.locator(".board-head")).toBeVisible();
  expect(activations).toBe(final);
});
