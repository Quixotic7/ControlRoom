import { test, expect } from "@playwright/test";

test("feed filters, loads older activity, and queues live updates while reading", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const actor = { name: `Feed tester ${Date.now()}`, kind: "human" } as const;
  const title = `Feed pagination ${Date.now()}`;
  const bootstrap = await page.request.get("/");
  expect(bootstrap.ok()).toBe(true);
  // The browser suite shares its disposable project's saved preferences.
  // Start without a ticket dialog restored by an earlier conversation test.
  const preferences = await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project" },
  });
  expect(preferences.ok()).toBe(true);
  const createResponse = await page.request.post("/api/records", {
    data: { kind: "ticket", meta: { title }, body: "", actor },
  });
  expect(createResponse.ok()).toBe(true);
  const record = await createResponse.json();
  for (let index = 0; index < 34; index++) {
    const response = await page.request.post(
      `/api/records/${record.meta.id}/comments`,
      {
        data: { body: `Earlier feed comment ${index}`, actor },
      },
    );
    expect(response.ok()).toBe(true);
  }

  await page.goto("/");
  await page.getByRole("button", { name: "Feed", exact: true }).click();
  const feed = page.locator(".feed-scroll");
  await expect(page.locator(".feed-entry")).toHaveCount(30);
  await page.getByRole("button", { name: "Load older activity" }).click();
  await expect
    .poll(() => page.locator(".feed-entry").count())
    .toBeGreaterThan(30);

  await page.getByLabel("Actor").selectOption(`${actor.kind}:${actor.name}`);
  await page.getByLabel("Related record").selectOption(record.meta.id);
  await expect(page.locator(".feed-entry")).toHaveCount(30);
  await expect(page.locator(".feed-entry").first()).toContainText(title);

  // A page from the previous filter must not merge into the next result set
  // or replace its cursor/loading state when it eventually resolves.
  let releaseOlder!: () => void;
  let markOlderStarted!: () => void;
  const olderGate = new Promise<void>((resolve) => (releaseOlder = resolve));
  const olderStarted = new Promise<void>(
    (resolve) => (markOlderStarted = resolve),
  );
  await page.route("**/api/feed?*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.has("cursor")) {
      markOlderStarted();
      await olderGate;
    }
    await route.continue();
  });
  const staleResponse = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());
    return (
      responseUrl.pathname === "/api/feed" &&
      responseUrl.searchParams.has("cursor")
    );
  });
  await page.getByRole("button", { name: "Load older activity" }).click();
  await olderStarted;
  await page.getByLabel("Actor").selectOption("human:Morgan");
  await expect(page.locator(".feed-entry")).toHaveCount(0);
  releaseOlder();
  await staleResponse;
  await expect(page.locator(".feed-entry")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.unroute("**/api/feed?*");
  await page.getByLabel("Actor").selectOption(`${actor.kind}:${actor.name}`);
  await expect(page.locator(".feed-entry")).toHaveCount(30);

  await feed.evaluate((node) => (node.scrollTop = 0));
  const topText = `Live at top ${Date.now()}`;
  await page.request.post(`/api/records/${record.meta.id}/comments`, {
    data: { body: topText, actor },
  });
  await expect(page.locator(".feed-entry").first()).toContainText(topText);

  await feed.evaluate((node) => (node.scrollTop = node.scrollHeight));
  const before = await feed.evaluate((node) => node.scrollTop);
  const waitingText = `Wait for reader ${Date.now()}`;
  let releaseRefresh!: () => void;
  let markRefreshStarted!: () => void;
  const refreshGate = new Promise<void>(
    (resolve) => (releaseRefresh = resolve),
  );
  const refreshStarted = new Promise<void>(
    (resolve) => (markRefreshStarted = resolve),
  );
  await page.route("**/api/feed?*", async (route) => {
    markRefreshStarted();
    await refreshGate;
    await route.continue();
  });
  const firstBurstResponse = await page.request.post(
    `/api/records/${record.meta.id}/comments`,
    {
      data: { body: waitingText, actor },
    },
  );
  expect(firstBurstResponse.ok()).toBe(true);
  await refreshStarted;
  let newestText = waitingText;
  for (let index = 1; index < 35; index++) {
    newestText = `Reconnect burst ${index}`;
    const response = await page.request.post(
      `/api/records/${record.meta.id}/comments`,
      { data: { body: newestText, actor } },
    );
    expect(response.ok()).toBe(true);
  }
  releaseRefresh();
  const indicator = page.getByRole("button", { name: "35 new updates" });
  await expect(indicator).toBeVisible();
  await expect(
    page.locator(".feed-entry").filter({ hasText: waitingText }),
  ).toHaveCount(0);
  expect(
    Math.abs((await feed.evaluate((node) => node.scrollTop)) - before),
  ).toBeLessThan(2);

  await indicator.click();
  const newest = page.locator(".feed-entry").first();
  await expect(newest).toContainText(newestText);
  await newest.click();
  await expect(page.locator(".detail-tabs button.active")).toHaveText(
    /Conversation/,
  );
  await expect(page.locator('.comment[data-focused="true"]')).toContainText(
    newestText,
  );
});
