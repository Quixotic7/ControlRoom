import { expect, test, type Page } from "@playwright/test";

const actor = { name: "Queue reviewer", kind: "human" };
const create = async (page: Page, title: string, meta = {}) =>
  (
    await page.request.post("/api/records", {
      data: {
        kind: "ticket",
        meta: { title, status: "review", ...meta },
        body: "Implementation notes",
        actor,
      },
    })
  ).json();

test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board" },
  });
});

test("review queue keeps feedback while keyboard navigation exposes evidence and missing diffs honestly", async ({
  page,
}) => {
  const first = await create(page, "First queued review", {
    verification: {
      command: "npm test",
      exitCode: 0,
      output: "passed",
      at: "2026-01-01T00:00:00Z",
    },
    reviewVerificationAt: "2026-01-01T00:00:00Z",
  });
  const second = await create(page, "Second queued review", {
    verification: {
      command: "npm test",
      exitCode: 0,
      output: "passed earlier",
      at: "2026-01-02T00:00:00Z",
    },
    reviewVerificationAt: "",
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Review queue" }).click();
  const queue = page.getByRole("region", { name: "Review queue" });
  await expect(queue).toContainText("First queued review");
  await expect(queue).toContainText("Current verification passed");
  await expect(queue).toContainText("No PR or diff supplied");

  await queue.getByRole("button").filter({ hasText: first.meta.title }).click();
  await expect(page.getByText("Review 1 of 2", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Change source" }),
  ).toContainText("Change and diff information is unavailable");
  await page.getByRole("button", { name: "Request changes" }).click();
  const feedback = page.getByRole("textbox", { name: "Review feedback" });
  await feedback.fill("Keep this feedback while I inspect the next item.");
  await feedback.press("Alt+ArrowRight");

  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(
    second.meta.title,
  );
  await expect(page.getByText("Review 2 of 2", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "What to review" }),
  ).toContainText("not linked to this review submission");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(feedback).toHaveValue(
    "Keep this feedback while I inspect the next item.",
  );

  await page.setViewportSize({ width: 430, height: 900 });
  await expect(
    page.getByRole("navigation", { name: "Review queue navigation" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
});
