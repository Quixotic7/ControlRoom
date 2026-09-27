import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "screenshots" },
  });
  await page.goto("/");
});
test("a dropped status read recovers without recapturing or leaving a failure banner", async ({
  page,
}) => {
  let captures = 0,
    reads = 0;
  await page.route("**/api/capture/request", async (route) => {
    captures++;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/capture/status", async (route) => {
    reads++;
    if (reads === 1) await route.abort("failed");
    else await route.fulfill({ json: { state: "ready" } });
  });
  await page
    .getByRole("button", { name: "Capture a region or window", exact: true })
    .click();
  await expect.poll(() => reads).toBe(2);
  await expect(
    page.getByRole("button", {
      name: "Capture a region or window",
      exact: true,
    }),
  ).toBeEnabled();
  expect(captures).toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".annotation-dialog")).toHaveCount(0);
});
test("persistent capture-status failures offer a safe reconnect and preserve the library", async ({
  page,
}) => {
  let captures = 0,
    reads = 0,
    disconnected = true;
  await page.route("**/api/capture/request", async (route) => {
    captures++;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/capture/status", async (route) => {
    reads++;
    if (disconnected) await route.abort("failed");
    else await route.fulfill({ json: { state: "ready" } });
  });
  await page
    .getByRole("button", { name: "Capture a region or window", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Capture was requested, but its status is temporarily unavailable",
  );
  expect(reads).toBe(3);
  expect(captures).toBe(1);
  await expect(page.getByLabel("Search screenshots")).toBeEnabled();
  await page.screenshot({ path: "test-results/capture-recovery.png" });
  disconnected = false;
  await page
    .getByRole("button", { name: "Check capture status", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(reads).toBe(4);
  expect(captures).toBe(1);
});
test("an uncertain capture command is not replayed and permission messages remain distinct", async ({
  page,
}) => {
  let captures = 0;
  await page.route("**/api/capture/request", async (route) => {
    captures++;
    await route.abort("failed");
  });
  await page.route("**/api/capture/status", async (route) =>
    route.fulfill({
      json: {
        state: "input-monitoring-required",
        message: "Double-tap Option needs Input Monitoring permission.",
      },
    }),
  );
  await page
    .getByRole("button", { name: "Capture a region or window", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Couldn't confirm the capture request",
  );
  expect(captures).toBe(1);
  await page
    .getByRole("button", { name: "Check capture status", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "Input Monitoring permission",
  );
  expect(captures).toBe(1);
});
test("a newly captured screenshot opens after a transient metadata disconnect without reloading", async ({
  page,
}) => {
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 200;
    return c.toDataURL("image/png");
  });
  const image = await (
    await page.request.post("/api/images", {
      data: { name: "Recover metadata", data },
    })
  ).json();
  let reads = 0;
  await page.route(`**/api/images/${image.id}`, async (route) => {
    reads++;
    if (reads === 1) await route.abort("failed");
    else await route.continue();
  });
  await page.getByLabel("Search screenshots").fill("Recover metadata");
  await page.locator(".screenshot-card").click();
  await expect(
    page.getByRole("img", { name: "Screenshot being annotated" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(reads).toBe(2);
  await page
    .getByRole("button", { name: "Save screenshot", exact: true })
    .click();
  await expect(page.locator(".annotation-dialog")).toHaveCount(0);
});
