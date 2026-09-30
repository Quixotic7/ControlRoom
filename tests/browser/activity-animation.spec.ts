import { expect, test, type Page } from "@playwright/test";

const human = { name: "Human", kind: "human" };
const agent = { name: "Animation agent", kind: "agent" };

async function create(
  page: Page,
  title: string,
  meta: Record<string, unknown>,
) {
  const response = await page.request.post("/api/records", {
    data: { kind: "ticket", meta: { title, ...meta }, body: "", actor: human },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board", theme: "dark" },
  });
});

test("only verified running workers animate; reports and claims remain distinct", async ({
  page,
}) => {
  test.setTimeout(60000);
  const recent = new Date().toISOString();
  const old = "2020-01-01T00:00:00.000Z";
  const active = await create(page, "Activity animation active", {
    status: "progress",
    progress: {
      note: "Implementing motion",
      percent: 60,
      at: recent,
      actor: agent,
    },
  });
  const stale = await create(page, "Activity animation stale", {
    status: "progress",
    progress: { note: "Old report", at: old, actor: agent },
  });
  const blocked = await create(page, "Activity animation blocked", {
    status: "progress",
    blocked: "Waiting for a decision",
    progress: { note: "Paused", at: recent, actor: agent },
  });
  const review = await create(page, "Activity animation review", {
    status: "review",
    progress: {
      note: "Ready to inspect",
      percent: 100,
      at: recent,
      actor: agent,
    },
  });
  const noReport = await create(page, "Activity animation no report", {
    status: "progress",
  });
  const claimOnly = await create(page, "Activity animation claim only", {
    status: "progress",
  });
  const expired = await create(page, "Activity animation expired", {
    status: "progress",
    progress: { note: "Claim ended", at: recent, actor: agent },
  });

  await page.route("**/api/state", async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    state.records.find(
      (record: any) => record.meta.id === stale.meta.id,
    ).meta.progress.at = old;
    state.claims.push(
      {
        ticket: claimOnly.meta.id,
        actor: agent,
        worktree: "/example/claim-only",
        expiresAt: "2099-01-01T00:00:00.000Z",
        reportedAt: recent,
      },
      {
        ticket: expired.meta.id,
        actor: agent,
        worktree: "/example/expired",
        expiresAt: old,
        reportedAt: old,
      },
    );
    await route.fulfill({ response, json: state });
  });

  let live = true;
  let unavailable = false;
  await page.route("**/api/activity", async (route) => {
    if (unavailable) return route.fulfill({ status: 503, body: "Unavailable" });
    return route.fulfill({
      json: live
        ? [
            {
              ticket: active.meta.id,
              runId: "verified-fixture",
              worker: agent.name,
            },
          ]
        : [],
    });
  });
  await page.goto("/");
  await page.getByLabel("Filter tickets").fill("Activity animation");
  const card = page.locator(`.ticket-card[data-id="${active.meta.id}"]`);
  await expect(
    card.locator('[data-activity="verified-running"]'),
  ).toBeVisible();
  await expect(card.getByLabel("Verified running agent")).toBeVisible();
  expect(
    await card.evaluate((element) => getComputedStyle(element).animationName),
  ).toContain("activity-highlight");
  expect(
    await card
      .locator(".activity-waveform i")
      .first()
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("activity-wave");

  for (const record of [blocked, review, expired]) {
    await expect(
      page.locator(
        `.ticket-card[data-id="${record.meta.id}"] .activity-signal`,
      ),
    ).toHaveCount(0);
  }

  for (const record of [noReport, claimOnly, stale]) {
    const idle = page.locator(`.ticket-card[data-id="${record.meta.id}"]`);
    await expect(idle.locator(".activity-signal")).toHaveCount(0);
    await expect(idle.getByText("No verified running agent")).toBeVisible();
    expect(
      await idle.evaluate((node) => getComputedStyle(node).animationName),
    ).toBe("none");
  }
  // Stop telemetry must remove animation even when the record/report is unchanged.
  live = false;
  await expect(card.locator(".activity-signal")).toHaveCount(0, {
    timeout: 10000,
  });
  await expect(card.getByText("No verified running agent")).toBeVisible();
  live = true;
  await expect(card.getByLabel("Verified running agent")).toBeVisible({
    timeout: 10000,
  });
  unavailable = true;
  await expect(card.locator(".activity-signal")).toHaveCount(0, {
    timeout: 10000,
  });
  unavailable = false;
  await expect(card.getByLabel("Verified running agent")).toBeVisible({
    timeout: 10000,
  });

  await page.getByRole("button", { name: "View options", exact: true }).click();
  await page
    .locator(".view-options")
    .getByRole("button", { name: "Table", exact: true })
    .click();
  await page.keyboard.press("Escape");
  const row = page.locator(`tr[data-id="${active.meta.id}"]`);
  await expect(row.getByLabel("Verified running agent")).toBeVisible();
  expect(
    await row
      .locator("td")
      .first()
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toContain("activity-highlight");

  await row.getByRole("button", { name: /^Activity animation active/ }).click();
  const detailActivity = page
    .getByRole("dialog")
    .locator('.record-content > [data-activity="verified-running"]');
  await expect(detailActivity).toBeVisible();
  expect(
    await detailActivity.evaluate(
      (element) => getComputedStyle(element).animationName,
    ),
  ).toContain("activity-highlight");

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await row
      .locator("td")
      .first()
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  expect(
    await detailActivity
      .locator(".activity-waveform i")
      .first()
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  expect(
    await detailActivity.evaluate(
      (element) => getComputedStyle(element).animationName,
    ),
  ).toBe("none");
});

test("custom progress-role statuses keep their own name without implying live work", async ({
  page,
}) => {
  const ticket = await create(page, "Failed review activity", {
    status: "progress",
  });
  await page.route("**/api/state", async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    state.config.columns.find((column: any) => column.id === "progress").name =
      "Failed Review";
    await route.fulfill({ response, json: state });
  });
  await page.goto("/");
  await page.getByLabel("Filter tickets").fill("Failed review activity");
  const card = page.locator(`.ticket-card[data-id="${ticket.meta.id}"]`);
  await expect(card.getByText(/Failed Review · .* in stage/)).toBeVisible();
  await expect(card.getByText(/In Progress/)).toHaveCount(0);
  await expect(card.getByText("No verified running agent")).toBeVisible();
  await expect(card.locator(".activity-signal")).toHaveCount(0);
});
