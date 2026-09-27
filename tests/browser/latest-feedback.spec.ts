import { test, expect, type Page } from "@playwright/test";
const actor = { name: "Reviewer", kind: "human" };
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
async function create(page: Page, title: string, extra = {}) {
  const r = await page.request.post("/api/records", {
    data: {
      kind: "ticket",
      meta: { title, ...extra },
      body: "Description to preserve",
      actor,
    },
  });
  expect(r.ok()).toBeTruthy();
  return r.json();
}
async function open(page: Page, id: string) {
  await page.goto("/#ticket=" + id);
  await expect(page.getByRole("dialog")).toBeVisible();
}
async function record(page: Page, id: string) {
  return (await page.request.get("/api/records/" + id)).json();
}
test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board" },
  });
  await page.goto("/");
});
test("accept opens optional feedback and focuses it before confirming", async ({
  page,
}) => {
  const r = await create(page, "Acceptance comment", { status: "review" });
  await open(page, r.meta.id);
  await page
    .getByRole("button", { name: "Accept into Done", exact: true })
    .click();
  const input = page.getByRole("textbox", {
    name: "Review feedback",
    exact: true,
  });
  await expect(input).toBeFocused();
  expect((await record(page, r.meta.id)).meta.status).toBe("review");
  await input.fill("Checked the keyboard behavior");
  await page
    .getByRole("button", { name: "Confirm acceptance", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const context = await (
    await page.request.get(`/api/records/${r.meta.id}/context`)
  ).json();
  expect(context.ticket.meta.status).toBe("done");
  expect(context.comments.at(-1).body).toContain(
    "Checked the keyboard behavior",
  );
  const empty = await create(page, "Accept without note", { status: "review" });
  await open(page, empty.meta.id);
  await page
    .getByRole("button", { name: "Accept into Done", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm acceptance" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await record(page, empty.meta.id)).meta.status).toBe("done");
});
test("existing child search excludes cycles and rejects stale reparenting without losing selection", async ({
  page,
}) => {
  const ancestor = await create(page, "An ancestor");
  const parent = await create(page, "Existing child parent", {
    parent: ancestor.meta.id,
  });
  const child = await create(page, "Child to attach");
  await open(page, parent.meta.id);
  const input = page.getByRole("combobox", {
    name: "Attach existing ticket",
    exact: true,
  });
  await input.fill("#" + ancestor.meta.number);
  await expect(
    page
      .getByRole("listbox", { name: "Attach existing ticket suggestions" })
      .getByRole("option"),
  ).toHaveCount(0);
  await input.fill("#" + child.meta.number);
  await expect(
    page
      .getByRole("listbox", { name: "Attach existing ticket suggestions" })
      .getByRole("option"),
  ).toHaveCount(1);
  await input.press("Enter");
  await page.request.patch("/api/records/" + child.meta.id, {
    data: {
      revision: child.revision,
      patch: { title: "Child changed elsewhere" },
      actor,
    },
  });
  await page
    .getByRole("button", { name: "Attach as child", exact: true })
    .click();
  await expect(page.locator(".existing-child [role=alert]")).toContainText(
    "record changed",
  );
  expect((await record(page, child.meta.id)).meta.parent).toBeUndefined();
  await input.fill("#" + child.meta.number);
  await expect(
    page
      .getByRole("listbox", { name: "Attach existing ticket suggestions" })
      .getByRole("option"),
  ).toHaveCount(1);
  await input.press("Enter");
  await page
    .getByRole("button", { name: "Attach as child", exact: true })
    .click();
  await expect(page.locator(".child-ticket")).toContainText(
    "Child changed elsewhere",
  );
  expect((await record(page, child.meta.id)).meta.parent).toBe(parent.meta.id);
  await expect(page.getByRole("dialog")).toBeVisible();
});
test("recent screenshot posts into conversation and is available in agent context", async ({
  page,
}) => {
  const image = await (
    await page.request.post("/api/images", {
      data: { name: "Conversation screenshot", data: png },
    })
  ).json();
  const r = await create(page, "Screenshot conversation", {
    attachments: [image.id],
  });
  await open(page, r.meta.id);
  await expect(
    page.getByLabel("Description screenshots").locator("img"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Attach screenshot to comment", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Recent screenshots" })
    .getByRole("button", { name: /Conversation screenshot/ })
    .click();
  const draft = page.getByRole("textbox", { name: "Add to the conversation" });
  await expect(draft).toHaveValue(new RegExp("#image=" + image.id));
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(page.locator(".comment .inline-image img")).toBeVisible();
  const c = await (
    await page.request.get(`/api/records/${r.meta.id}/context`)
  ).json();
  expect(c.comments.at(-1).body).toContain("#image=" + image.id);
  expect(c.attachments.map((a: any) => a.id)).toContain(image.id);
  expect(c.ticket.body).toBe("Description to preserve");
});
test("ticket middle-click opens an independent, reloadable tab", async ({
  page,
  context,
}) => {
  const r = await create(page, "Middle click ticket");
  await page.reload();
  const card = page.locator(`.ticket-card[data-id="${r.meta.id}"]`);
  await expect(card).toBeVisible();
  const next = context.waitForEvent("page");
  await card.click({ button: "middle" });
  const tab = await next;
  await tab.waitForURL("**/?ticketOnly=1#ticket=" + r.meta.id);
  await expect(
    tab.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue(r.meta.title);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(tab.locator(".top-nav, .project-page, .board")).toHaveCount(0);
  await expect(tab.getByRole("button", { name: "Control Room: back to board" })).toBeVisible();
  await tab.reload();
  await expect(
    tab.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue(r.meta.title);
  await tab.close();
  await card.click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
test("ticket dialog expands on desktop and stays within mobile viewport", async ({
  page,
}) => {
  const r = await create(page, "Large dialog");
  await page.setViewportSize({ width: 2200, height: 1200 });
  await open(page, r.meta.id);
  const box = await page.getByRole("dialog").boundingBox();
  expect(box!.width).toBeCloseTo(1800, 0);
  expect(box!.height).toBeCloseTo(1140, 0);
  expect(box!.x).toBeCloseTo(200, 0);
  await page.screenshot({ path: "test-results/expanded-ticket.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.getByRole("dialog").boundingBox();
  expect(mobile!.width).toBeLessThan(391);
  expect(mobile!.height).toBeLessThan(845);
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeInViewport();
});
test("state connection failure retains ticket drafts and reconnect clears the warning", async ({
  page,
}) => {
  const r = await create(page, "Recover state");
  await open(page, r.meta.id);
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Unsaved title");
  let offline = true;
  await page.route("**/api/state", (route) =>
    offline ? route.abort("failed") : route.continue(),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("button", { name: "Reconnect now" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Unsaved title");
  offline = false;
  await page
    .getByRole("button", { name: "Reconnect now" })
    .click({ force: true });
  await expect(page.getByRole("button", { name: "Reconnect now" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Unsaved title");
});
