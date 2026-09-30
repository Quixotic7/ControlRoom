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

async function openFromQueue(page: Page, title: string, id: string) {
  const queue = page.getByRole("region", { name: "Review queue" });
  await queue.locator(".review-queue-item").filter({ hasText: title }).click();
  await expect(page).toHaveURL(new RegExp(`#ticket=${id}$`));
}

async function expectOpenTicket(page: Page, title: string, id: string) {
  await expect(page).toHaveURL(new RegExp(`#ticket=${id}$`));
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(title);
}

test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board" },
  });
});

test("review queue keeps feedback while keyboard navigation exposes evidence and missing diffs honestly", async ({
  page,
}) => {
  const nonce = `${Date.now()}-${Math.random()}`;
  const first = await create(page, `First queued review ${nonce}`, {
    verification: {
      command: "npm test",
      exitCode: 0,
      output: "passed",
      at: "2026-01-01T00:00:00Z",
    },
    reviewVerificationAt: "2026-01-01T00:00:00Z",
  });
  const second = await create(page, `Second queued review ${nonce}`, {
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

  await openFromQueue(page, first.meta.title, first.meta.id);
  await expect(
    page.getByRole("region", { name: "Change source" }),
  ).toContainText("Change and diff information is unavailable");
  await page.getByRole("button", { name: "Request changes" }).click();
  const feedback = page.getByRole("textbox", { name: "Review feedback" });
  await feedback.fill("Keep this feedback while I inspect the next item.");
  // Preserve native Option+Arrow word navigation while feedback is being
  // typed. The visible navigation buttons remain keyboard-operable.
  await feedback.press("Alt+ArrowRight");
  await expectOpenTicket(page, first.meta.title, first.meta.id);
  await page.getByRole("button", { name: "Next" }).press("Alt+ArrowRight");

  await expectOpenTicket(page, second.meta.title, second.meta.id);
  await expect(
    page.getByRole("region", { name: "What to review" }),
  ).toContainText("not linked to this review submission");
  await page.getByRole("button", { name: "Previous" }).press("Alt+ArrowLeft");
  await expectOpenTicket(page, first.meta.title, first.meta.id);
  await expect(feedback).toHaveValue(
    "Keep this feedback while I inspect the next item.",
  );

  await page.setViewportSize({ width: 430, height: 900 });
  await expect(
    page.getByRole("navigation", { name: "Review queue navigation" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
});

test("queue navigation saves ticket drafts, retains them on failure, and waits for review outcomes", async ({
  page,
}) => {
  const nonce = `${Date.now()}-${Math.random()}`;
  const first = await create(page, `Draft-safe queued review ${nonce}`);
  const second = await create(page, `Second draft-safe review ${nonce}`);
  await page.goto("/");
  await page.getByRole("button", { name: "Review queue" }).click();
  await openFromQueue(page, first.meta.title, first.meta.id);

  const title = page.getByRole("textbox", { name: "Title" });
  await title.fill("Saved before moving on");
  await page.getByRole("button", { name: "Next" }).click();
  await expectOpenTicket(page, second.meta.title, second.meta.id);
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/records/${first.meta.id}`);
      return (await response.json()).meta.title;
    })
    .toBe("Saved before moving on");

  await page.getByRole("button", { name: "Previous" }).click();
  await expectOpenTicket(page, "Saved before moving on", first.meta.id);
  await title.fill("Keep this unsaved title");
  await page.route(`**/api/records/${first.meta.id}`, (route) => {
    if (route.request().method() === "PATCH") return route.abort();
    return route.continue();
  });
  await page.getByRole("button", { name: "Next" }).click();
  await expect(title).toHaveValue("Keep this unsaved title");
  await expectOpenTicket(page, "Keep this unsaved title", first.meta.id);
  await page.unroute(`**/api/records/${first.meta.id}`);

  let releaseOutcome!: () => void;
  const outcomeBlocked = new Promise<void>((resolve) => {
    releaseOutcome = resolve;
  });
  await page.route(
    `**/api/records/${first.meta.id}/review-outcome`,
    async (route) => {
      await outcomeBlocked;
      await route.continue();
    },
  );
  await page.getByRole("button", { name: "Request changes" }).click();
  await page.getByLabel("Review feedback", { exact: true }).fill("Please finish the remaining acceptance criterion.");
  await page.getByLabel("Return to").selectOption("progress");
  await page.getByRole("button", { name: "Save feedback & return" }).click();
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  await page.keyboard.press("Alt+ArrowRight");
  await expectOpenTicket(page, "Keep this unsaved title", first.meta.id);
  releaseOutcome();
  await expectOpenTicket(page, second.meta.title, second.meta.id);
});
