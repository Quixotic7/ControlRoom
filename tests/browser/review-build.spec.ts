import { expect, test, type Page } from "@playwright/test";

const actor = { name: "Build fixture", kind: "human" };

async function create(
  page: Page,
  title: string,
  path = "artifacts/Fixture.app",
) {
  const response = await page.request.post("/api/records", {
    data: {
      kind: "ticket",
      meta: {
        title,
        status: "review",
        build: {
          path,
          label: "Fixture build",
          sha: "1234567890abcdef",
        },
      },
      body: "A fixture review build.",
      actor,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board" },
  });
});

test("review builds show a compact card badge and use the checked endpoint only after opening", async ({
  page,
}) => {
  const title = `Review build ${Date.now()}`;
  const ticket = await create(page, title);
  let statusReads = 0;
  const actions: Array<{ action: string; data: Record<string, unknown> }> = [];
  await page.route(
    new RegExp(`/api/records/${ticket.meta.id}/build(?:/[^?]+)?$`),
    async (route) => {
      if (route.request().method() === "GET") {
        statusReads++;
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            build: ticket.meta.build,
            revision: ticket.revision,
            available: true,
            resolvedPath: "/tmp/review-build/Fixture.app",
          }),
        });
        return;
      }
      actions.push({
        action: route.request().url().endsWith("/launch") ? "launch" : "reveal",
        data: route.request().postDataJSON(),
      });
      await route.fulfill({
        contentType: "application/json",
        body: '{"ok":true}',
      });
    },
  );

  await page.goto("/");
  const card = page.locator(".ticket-card").filter({ hasText: title });
  await expect(
    card.getByText("Build · Fixture build · 12345678"),
  ).toBeVisible();
  expect(statusReads).toBe(0);

  const quickReview = page.getByLabel(`Actions for ${title}`);
  await quickReview.locator("summary").click();
  const build = quickReview.getByRole("region", { name: "Review build" });
  await expect(build).toContainText("Fixture build");
  await expect(build).toContainText("/tmp/review-build/Fixture.app");
  await expect(build.getByRole("button", { name: "Launch" })).toBeEnabled();
  await build.getByRole("button", { name: "Launch" }).click();
  await expect(build.getByRole("status")).toContainText("Build launched");
  await expect(page).not.toHaveURL(new RegExp(`#ticket=${ticket.meta.id}$`));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await build.getByRole("button", { name: "Reveal" }).click();
  await expect(build.getByRole("status")).toContainText(
    "Build revealed in Finder",
  );
  expect(actions).toEqual([
    {
      action: "launch",
      data: {
        revision: ticket.revision,
        actor: { name: "You", kind: "human" },
      },
    },
    {
      action: "reveal",
      data: {
        revision: ticket.revision,
        actor: { name: "You", kind: "human" },
      },
    },
  ]);
  expect(statusReads).toBeGreaterThanOrEqual(3);
});

test("unavailable review builds explain why and never offer a native action", async ({
  page,
}) => {
  const ticket = await create(
    page,
    `Unavailable review build ${Date.now()}`,
    `artifacts/missing-${Date.now()}.app`,
  );
  let actions = 0;
  await page.route(
    new RegExp(`/api/records/${ticket.meta.id}/build/(?:launch|reveal)$`),
    async (route) => {
      actions++;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    },
  );
  await page.goto(`/#ticket=${ticket.meta.id}`);
  const build = page.getByRole("region", { name: "Review build" });
  await expect(build).toContainText("Build not found at");
  await expect(build.getByRole("button", { name: "Launch" })).toBeDisabled();
  await expect(build.getByRole("button", { name: "Reveal" })).toBeDisabled();
  expect(actions).toBe(0);
});
