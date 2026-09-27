import { test, expect, type Page } from "@playwright/test";
const actor = { name: "Reviewer", kind: "human" };
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const create = async (page: Page, title: string, meta = {}) =>
  (
    await page.request.post("/api/records", {
      data: {
        kind: "ticket",
        meta: { title, ...meta },
        body: "Preserve description",
        actor,
      },
    })
  ).json();
const get = async (page: Page, id: string) =>
  (await page.request.get(`/api/records/${id}`)).json();
test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board", theme: "dark" },
  });
});
test("parent navigation saves drafts, supports archived parents and leaves failed saves open", async ({
  page,
  context,
}) => {
  const parent = await create(page, "Parent navigation target", {
    archived: true,
  });
  const child = await create(page, "Child to navigate", {
    parent: parent.meta.id,
  });
  await page.goto(`/#ticket=${child.meta.id}`);
  const link = page.getByRole("button", {
    name: `Parent: #${parent.meta.number} ${parent.meta.title} (Archived)`,
    exact: true,
  });
  await expect(link).toBeVisible();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Saved before parent navigation");
  await page.route(`**/api/records/${child.meta.id}`, async (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, json: { error: "Save unavailable" } })
      : route.continue(),
  );
  await link.click();
  await expect(page.getByRole("alert")).toContainText("Save unavailable");
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Saved before parent navigation");
  await page.unroute(`**/api/records/${child.meta.id}`);
  const opened = context.waitForEvent("page");
  await link.click({ button: "middle" });
  const tab = await opened;
  await expect(
    tab.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue(parent.meta.title);
  await tab.close();
  await link.click();
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue(parent.meta.title);
  expect((await get(page, child.meta.id)).meta.title).toBe(
    "Saved before parent navigation",
  );
});
test("open questions stay prominent, persist reply drafts, retain errors and resolve independently", async ({
  page,
}) => {
  const r = await create(page, "Question attention", {
    status: "review",
    reviewInstructions: "Check parent linking",
  });
  for (const body of [
    "Which color should the action use?",
    "Which label should we show?",
  ])
    await page.request.post(`/api/records/${r.meta.id}/comments`, {
      data: {
        body,
        kind: "question",
        actor: { name: "Agent A", kind: "agent" },
      },
    });
  await page.goto(`/#ticket=${r.meta.id}`);
  const questions = page.getByRole("region", { name: "Open questions" });
  await expect(questions.locator(".open-question")).toHaveCount(2);
  const first = questions.locator(".open-question").first();
  await first.getByLabel("Answer this question").fill("Use teal.");
  await page.reload();
  await expect(first.getByLabel("Answer this question")).toHaveValue(
    "Use teal.",
  );
  await page.route(`**/api/records/${r.meta.id}/comments`, (route) =>
    route.fulfill({ status: 503, json: { error: "Comment save unavailable" } }),
  );
  await first.getByRole("button", { name: "Post answer" }).click();
  await expect(first.getByRole("alert")).toContainText(
    "Comment save unavailable",
  );
  await expect(first.getByLabel("Answer this question")).toHaveValue(
    "Use teal.",
  );
  await page.unroute(`**/api/records/${r.meta.id}/comments`);
  await first.getByRole("button", { name: "Post answer" }).click();
  await expect(first.getByRole("status")).toContainText("Answer posted");
  await expect(questions.locator(".open-question")).toHaveCount(2);
  await first.getByRole("button", { name: "Resolve question" }).click();
  await expect(questions.locator(".open-question")).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "What to review" }),
  ).toContainText("Check parent linking");
  const c = await (
    await page.request.get(`/api/records/${r.meta.id}/context`)
  ).json();
  expect(c.comments.filter((c: any) => c.kind === "comment")).toHaveLength(1);
  expect(
    c.comments.filter((c: any) => c.kind === "question" && !c.resolved),
  ).toHaveLength(1);
  await page.screenshot({ path: "test-results/open-questions-review.png" });
});
test("review displays current automated checks and distinguishes old evidence", async ({
  page,
}) => {
  const r = await create(page, "Verification summary", {
    status: "review",
    manualReviewRequired: false,
    reviewVerificationAt: "2026-01-01T00:00:00Z",
    verification: {
      command: "npm test",
      exitCode: 0,
      output: "Passed",
      at: "2026-01-01T00:00:00Z",
    },
  });
  await page.goto(`/#ticket=${r.meta.id}`);
  await expect(
    page.getByRole("region", { name: "What to review" }),
  ).toContainText("Automated checks passed. No manual checks requested.");
  const current = await get(page, r.meta.id);
  await page.request.patch(`/api/records/${r.meta.id}`, {
    data: {
      revision: current.revision,
      patch: { reviewVerificationAt: "" },
      actor,
    },
  });
  await page.reload();
  await expect(
    page.getByRole("region", { name: "What to review" }),
  ).toContainText("not linked to this review submission");
  await expect(
    page.getByRole("region", { name: "What to review" }),
  ).not.toContainText("Automated checks passed.");
});
async function imageEditor(page: Page) {
  const a = await (
    await page.request.post("/api/images", {
      data: { name: "Screenshot creation", data: png },
    })
  ).json();
  await page.goto(`/#image=${a.id}`);
  await expect(page.getByAltText("Screenshot being annotated")).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByAltText("Screenshot being annotated")
        .evaluate((i: HTMLImageElement) => i.complete),
    )
    .toBe(true);
  return a;
}
test("review return controls align on desktop and remain usable on narrow screens", async ({
  page,
}) => {
  const r = await create(page, "Aligned review controls", { status: "review" });
  await page.goto(`/#ticket=${r.meta.id}`);
  await page
    .getByRole("button", { name: "Request changes", exact: true })
    .click();
  const select = page.getByRole("combobox", { name: "Return to", exact: true }),
    button = page.getByRole("button", { name: "Save feedback & return" });
  const a = await select.boundingBox(),
    b = await button.boundingBox();
  expect(Math.abs(a!.y + a!.height - b!.y - b!.height)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/review-alignment-desktop.png" });
  await page.setViewportSize({ width: 430, height: 900 });
  await expect(select).toBeVisible();
  await expect(button).toBeVisible();
  const bounds = await button.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(430);
  await page.screenshot({ path: "test-results/review-alignment-mobile.png" });
});
test("screenshot creation prompts once, cancels safely, then opens the exact created ticket", async ({
  page,
}) => {
  const image = await imageEditor(page);
  await page
    .getByRole("button", { name: "Save to ticket", exact: true })
    .click();
  const prompt = page.getByRole("dialog", {
    name: "Create ticket from screenshot",
  });
  await expect(prompt.getByLabel("New ticket title")).toBeFocused();
  await prompt.getByLabel("New ticket title").fill("   ");
  await prompt
    .getByRole("button", { name: "Create ticket", exact: true })
    .click();
  await expect(prompt.getByRole("alert")).toContainText("Enter a ticket title");
  await prompt.press("Escape");
  await expect(prompt).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save to ticket", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Save to ticket", exact: true })
    .click();
  await prompt.getByLabel("New ticket title").fill("Named screenshot ticket");
  await prompt.getByLabel("New ticket title").press("Enter");
  await expect(page.locator(".annotation-dialog")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Named screenshot ticket");
  const state = await (await page.request.get("/api/state")).json();
  const matches = state.records.filter(
    (r: any) => r.meta.title === "Named screenshot ticket",
  );
  expect(matches).toHaveLength(1);
  expect(matches[0].meta.attachments).toEqual([image.id]);
  expect(matches[0].body).toContain(`#image=${image.id}`);
  await expect(page).toHaveURL(new RegExp(`#ticket=${matches[0].meta.id}$`));
});
test("lost screenshot ticket response recovers the created ticket without another POST", async ({
  page,
}) => {
  await imageEditor(page);
  let posts = 0;
  await page.route("**/api/records", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    posts++;
    await route.fetch();
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "Save to ticket", exact: true })
    .click();
  const prompt = page.getByRole("dialog", {
    name: "Create ticket from screenshot",
  });
  await prompt.getByLabel("New ticket title").fill("Recover screenshot ticket");
  await prompt
    .getByRole("button", { name: "Create ticket", exact: true })
    .click();
  await expect(
    prompt.getByRole("button", { name: "Check created ticket" }),
  ).toBeVisible();
  await prompt.getByRole("button", { name: "Check created ticket" }).click();
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Recover screenshot ticket");
  expect(posts).toBe(1);
});
test("screenshot save failures retain annotations and title, and repeated submit creates once", async ({
  page,
}) => {
  const image = await imageEditor(page);
  const note = {
    id: "note-retry",
    type: "pin",
    x: 0.5,
    y: 0.5,
    text: "Keep this instruction",
    resolved: false,
  };
  await page.request.put(`/api/images/${image.id}/annotations`, {
    data: { revision: image.revision, annotations: [note], actor },
  });
  await page.reload();
  await expect(page.locator(".annotation-note")).toContainText(note.text);
  await page
    .getByRole("button", { name: "Save to ticket", exact: true })
    .click();
  const prompt = page.getByRole("dialog", {
    name: "Create ticket from screenshot",
  });
  await prompt.getByLabel("New ticket title").fill("Retry retained screenshot");
  await page.route(`**/api/images/${image.id}/annotations`, (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Annotation save unavailable" },
    }),
  );
  await prompt
    .getByRole("button", { name: "Create ticket", exact: true })
    .click();
  await expect(prompt.getByRole("alert")).toContainText(
    "Annotation save unavailable",
  );
  await expect(prompt.getByLabel("New ticket title")).toHaveValue(
    "Retry retained screenshot",
  );
  await page.unroute(`**/api/images/${image.id}/annotations`);
  await page.route("**/api/records", (route) =>
    route.fulfill({ status: 422, json: { error: "Creation unavailable" } }),
  );
  await prompt
    .getByRole("button", { name: "Create ticket", exact: true })
    .click();
  await expect(prompt.getByRole("alert")).toContainText("Creation unavailable");
  await expect(prompt.getByLabel("New ticket title")).toHaveValue(
    "Retry retained screenshot",
  );
  await page.unroute("**/api/records");
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/records")) posts++;
  });
  await prompt.locator("form").evaluate((form) => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Retry retained screenshot");
  expect(posts).toBe(1);
  const state = await (await page.request.get("/api/state")).json();
  const record = state.records.find(
    (r: any) => r.meta.title === "Retry retained screenshot",
  );
  expect(record.body).toContain("note-retry");
  expect(record.body).toContain(note.text);
  const saved = await (
    await page.request.get(`/api/images/${image.id}`)
  ).json();
  expect(saved.annotations).toEqual([note]);
});
