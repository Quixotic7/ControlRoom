import { test, expect } from "@playwright/test";

test("feed filters, loads older activity, and queues live updates while reading", async ({
  page,
}) => {
  const actor = { name: `Feed tester ${Date.now()}`, kind: "human" } as const;
  const title = `Feed pagination ${Date.now()}`;
  const record = await (
    await page.request.post("/api/records", {
      data: { kind: "ticket", meta: { title }, body: "", actor },
    })
  ).json();
  for (let index = 0; index < 34; index++)
    await page.request.post(`/api/records/${record.meta.id}/comments`, {
      data: { body: `Earlier feed comment ${index}`, actor },
    });

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

  await feed.evaluate((node) => (node.scrollTop = 0));
  const topText = `Live at top ${Date.now()}`;
  await page.request.post(`/api/records/${record.meta.id}/comments`, {
    data: { body: topText, actor },
  });
  await expect(page.locator(".feed-entry").first()).toContainText(topText);

  await feed.evaluate((node) => (node.scrollTop = node.scrollHeight));
  const before = await feed.evaluate((node) => node.scrollTop);
  const waitingText = `Wait for reader ${Date.now()}`;
  await page.request.post(`/api/records/${record.meta.id}/comments`, {
    data: { body: waitingText, actor },
  });
  const indicator = page.getByRole("button", { name: "1 new update" });
  await expect(indicator).toBeVisible();
  await expect(
    page.locator(".feed-entry").filter({ hasText: waitingText }),
  ).toHaveCount(0);
  expect(
    Math.abs((await feed.evaluate((node) => node.scrollTop)) - before),
  ).toBeLessThan(2);

  await indicator.click();
  const newest = page.locator(".feed-entry").first();
  await expect(newest).toContainText(waitingText);
  await newest.click();
  await expect(page.locator(".detail-tabs button.active")).toHaveText(
    /Conversation/,
  );
  await expect(page.locator('.comment[data-focused="true"]')).toContainText(
    waitingText,
  );
});
