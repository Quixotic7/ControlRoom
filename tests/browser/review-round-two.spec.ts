import { test, expect, type Page } from "@playwright/test";
const actor = { name: "Round two reviewer", kind: "human" };
test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board" },
  });
  await page.goto("/");
});
async function screenshot(page: Page, name: string) {
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 400;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#214654";
    ctx.fillRect(0, 0, 600, 400);
    ctx.fillStyle = "white";
    ctx.font = "24px sans-serif";
    ctx.fillText("Review screenshot", 40, 80);
    return c.toDataURL("image/png");
  });
  return (
    await page.request.post("/api/images", { data: { name, data } })
  ).json();
}
async function ticket(page: Page, title: string, body = "", meta = {}) {
  return (
    await page.request.post("/api/records", {
      data: { kind: "ticket", meta: { title, ...meta }, body, actor },
    })
  ).json();
}
async function openTicket(page: Page, id: string) {
  await page.goto("about:blank");
  await page.request.patch("/api/preferences", {
    data: { selected: id, page: "project" },
  });
  await page.goto("/");
  await expect(page.locator(".record-dialog")).toBeVisible();
}
async function library(page: Page, query: string) {
  await page.getByRole("button", { name: "Screenshots", exact: true }).click();
  await page.getByLabel("Search screenshots").fill(query);
}
test("recent screenshots attach from a ticket, preserve its draft, and appear as board thumbnails", async ({
  page,
}) => {
  const a = await screenshot(page, "Recent picker first");
  const b = await screenshot(page, "Recent picker second");
  const hidden = await screenshot(page, "Recent picker trashed");
  await page.request.put(`/api/images/${hidden.id}/trash`, {
    data: { revision: hidden.revision, trashed: true, actor },
  });
  const r = await ticket(
    page,
    "Recent screenshot target",
    "Preserve custom prose.",
  );
  await openTicket(page, r.meta.id);
  await page
    .getByRole("button", { name: "Edit Markdown", exact: true })
    .click();
  await page
    .getByLabel("Markdown body")
    .fill("Preserve custom prose. And this draft.");
  await page.getByRole("button", { name: "Attach recent screenshot" }).click();
  const picker = page.getByRole("region", {
    name: "Recent screenshots",
    exact: true,
  });
  await page.getByLabel("Find a screenshot").fill("Recent picker");
  await expect(picker.locator(".screenshot-card")).toHaveCount(2);
  await expect(picker.locator(".screenshot-card strong").first()).toHaveText(
    b.name,
  );
  await picker.locator(".screenshot-card").filter({ hasText: b.name }).click();
  await expect(page.getByLabel("Markdown body")).toHaveValue(
    "Preserve custom prose. And this draft.",
  );
  await page.getByRole("button", { name: "Attach recent screenshot" }).click();
  await page.getByLabel("Find a screenshot").fill(b.name);
  await expect(picker.locator(".screenshot-card")).toHaveCount(0);
  await page.getByLabel("Find a screenshot").press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(page.locator(".record-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const card = page.locator(".ticket-card").filter({ hasText: r.meta.title });
  await expect(card.getByRole("img", { name: b.name })).toBeVisible();
  const saved = await (
    await page.request.get(`/api/records/${r.meta.id}`)
  ).json();
  expect(saved.meta.attachments).toEqual([b.id]);
  expect(saved.body).toBe("Preserve custom prose. And this draft.");
  await card.click();
  await expect(
    page.locator(".attachment-grid").getByRole("img", { name: b.name }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/recent-screenshot-ticket.png" });
});

test("annotation destination autocomplete searches ticket numbers and titles with keyboard and pointer", async ({
  page,
}) => {
  const r = await ticket(page, "Destination autocomplete unique");
  const a = await screenshot(page, "Destination chooser image");
  await library(page, a.name);
  await page.locator(".screenshot-card").click();
  await page
    .getByText("Attach to a ticket (optional)", { exact: true })
    .click();
  const input = page.getByRole("combobox", {
    name: "Attach to ticket",
    exact: true,
  });
  await input.fill(`#${r.meta.number}`);
  const options = page.getByRole("listbox", {
    name: "Attach to ticket suggestions",
  });
  await expect(options.getByRole("option")).toHaveCount(1);
  const choice = options.getByRole("option").first();
  expect(
    await choice.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return el.contains(
        document.elementFromPoint(b.x + 15, b.y + b.height / 2),
      );
    }),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/screenshot-ticket-autocomplete.png",
  });
  await input.press("Enter");
  await expect(input).toHaveValue(`#${r.meta.number} ${r.meta.title}`);
  await input.fill("Not a ticket");
  await input.press("Escape");
  await expect(input).toHaveValue(`#${r.meta.number} ${r.meta.title}`);
  await input.fill("Destination autocomplete");
  await options.getByRole("option").click();
  await page
    .getByRole("button", { name: "Save to ticket", exact: true })
    .click();
  await expect(page.locator(".annotation-dialog")).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/records/${r.meta.id}`)).json()).meta
      .attachments,
  ).toEqual([a.id]);
});

test("view options escape the tab strip and stay clickable without shifting tab widths", async ({
  page,
}) => {
  const tab = page
    .locator(".view-tab")
    .filter({ has: page.getByRole("button", { name: "Board", exact: true }) });
  const before = (await tab.boundingBox())!;
  const trigger = page.getByRole("button", { name: "Options for Board view" });
  await trigger.click();
  const rename = page.getByRole("button", { name: "Rename", exact: true });
  await expect(rename).toBeVisible();
  expect(
    await rename.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return el.contains(
        document.elementFromPoint(b.x + 15, b.y + b.height / 2),
      );
    }),
  ).toBeTruthy();
  expect((await tab.boundingBox())!.width).toBeCloseTo(before.width, 1);
  await page.screenshot({ path: "test-results/view-options-visible.png" });
  await trigger.press("Escape");
  await expect(rename).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await rename.click();
  await expect(page.getByLabel("View name")).toBeVisible();
  await page.getByLabel("View name").press("Escape");
});

test("multi-screenshot deletion excludes filtered images and reports stale items without losing successful deletes", async ({
  page,
}) => {
  const a = await screenshot(page, "Bulk picture one");
  const b = await screenshot(page, "Bulk picture two");
  await library(page, "Bulk picture");
  await expect(
    page.getByRole("button", { name: "Delete screenshot", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Select screenshots", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select visible", exact: true })
    .click();
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
  await page.getByLabel("Search screenshots").fill(a.name);
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await page.getByLabel("Search screenshots").fill("Bulk picture");
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await page
    .getByRole("checkbox", { name: `Select ${b.name}`, exact: true })
    .check();
  const changed = await page.request.put(`/api/images/${b.id}/annotations`, {
    data: {
      revision: b.revision,
      annotations: [
        {
          id: "new-note",
          type: "pin",
          x: 0.5,
          y: 0.5,
          text: "Concurrent annotation",
          resolved: false,
        },
      ],
      actor,
    },
  });
  expect(changed.ok()).toBeTruthy();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete selected", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("1 succeeded; 1 failed");
  expect(
    (await (await page.request.get(`/api/images/${a.id}`)).json()).trashedAt,
  ).toBeTruthy();
  expect(
    (await (await page.request.get(`/api/images/${b.id}`)).json()).trashedAt,
  ).toBeUndefined();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page
    .getByRole("button", { name: "Select visible", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore selected", exact: true })
    .click();
  await expect(page.locator(".screenshot-card")).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/images/${a.id}`)).json()).trashedAt,
  ).toBeUndefined();
});

test("incoming captured images appear live without opening an editor or changing the current page", async ({
  page,
}) => {
  await library(page, "Silent native delivery");
  const initialURL = page.url();
  const a = await screenshot(page, "Silent native delivery");
  await expect(
    page.locator(".screenshot-card").filter({ hasText: a.name }),
  ).toBeVisible();
  await expect(page.locator(".annotation-dialog")).toHaveCount(0);
  expect(page.url()).toBe(initialURL);
  await page.locator(".screenshot-card").filter({ hasText: a.name }).click();
  await expect(page.getByAltText("Screenshot being annotated")).toBeVisible();
});
