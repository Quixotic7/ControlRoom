import { expect, test, type Page } from "@playwright/test";
import { defaultViews } from "../../web/model";

const actor = { name: "Priority planning fixture", kind: "human" };
const create = async (
  page: Page,
  title: string,
  meta: Record<string, unknown>,
) => {
  const response = await page.request.post("/api/records", {
    data: { kind: "ticket", meta: { title, ...meta }, actor },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
};
const record = async (page: Page, id: string) =>
  (await page.request.get(`/api/records/${id}`)).json();

test("priority planning ranks across statuses without changing workflow or parent", async ({
  page,
}) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "priority-planning" },
  });
  const parent = await create(page, "Priority planning parent", {});
  const first = await create(page, "Priority planning first", {
    parent: parent.meta.id,
    status: "backlog",
    priority: 2,
    order: 10,
  });
  const second = await create(page, "Priority planning second", {
    parent: parent.meta.id,
    status: "selected",
    priority: 2,
    order: 20,
  });
  const high = await create(page, "Priority planning high", {
    parent: parent.meta.id,
    status: "review",
    priority: 1,
    order: 30,
  });

  await page.goto("/");
  await page.getByLabel("Filter tickets").fill("Priority planning");
  await expect(page.getByText("Start of Urgent priority")).toBeVisible();
  await expect(page.getByText("End of Low priority")).toBeVisible();
  await expect(page.getByText("Priority planning is active:")).toBeVisible();

  // Use a native pointer gesture and deliberately stop at the *top* edge of
  // the first row.  Dropping on a handle's center means "after" that row;
  // asserting the insertion preview here makes the chosen edge, and the
  // resulting rank, agree.
  const sourceHandle = page.getByLabel(
    `Drag ${second.meta.title} to reorder`,
  );
  const firstRow = page.locator(`tr[data-id="${first.meta.id}"]`);
  await sourceHandle.scrollIntoViewIfNeeded();
  await firstRow.scrollIntoViewIfNeeded();
  const sourceBox = (await sourceHandle.boundingBox())!;
  const firstBox = (await firstRow.boundingBox())!;
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + 2, {
    steps: 8,
  });
  await expect(firstRow).toHaveClass(/insert-before/);
  await page.mouse.up();
  await expect
    .poll(async () => (await record(page, second.meta.id)).meta.order)
    .toBeLessThan(10);
  const reordered = await record(page, second.meta.id);
  expect(reordered.meta.status).toBe("selected");
  expect(reordered.meta.parent).toBe(parent.meta.id);

  // The keyboard-selectable control transfers it to High, retaining both
  // workflow stage and parent while assigning a rank in the target bucket.
  await page
    .getByLabel(`Move ${second.meta.title} to priority`)
    .selectOption("1");
  await expect
    .poll(async () => (await record(page, second.meta.id)).meta.priority)
    .toBe(1);
  const moved = await record(page, second.meta.id);
  expect(moved.meta.status).toBe("selected");
  expect(moved.meta.parent).toBe(parent.meta.id);
  expect(moved.meta.order).toBeGreaterThan(
    (await record(page, high.meta.id)).meta.order,
  );

  await page.reload();
  await expect(page.locator(`tr[data-id="${second.meta.id}"]`)).toHaveCount(1);
  expect((await record(page, second.meta.id)).meta.order).toBe(moved.meta.order);

  // First/last controls are ordinary buttons, so they remain keyboard usable.
  await page.getByLabel(`Move ${second.meta.title} to first position`).click();
  await expect
    .poll(async () => (await record(page, second.meta.id)).meta.order)
    .toBeLessThan((await record(page, high.meta.id)).meta.order);
});

test("keyboard priority controls step once, then move to the ends", async ({
  page,
}) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "priority-planning" },
  });
  const prefix = `Priority keyboard ${Date.now()}`;
  const first = await create(page, `${prefix} first`, {
    status: "backlog",
    priority: 2,
    order: 10,
  });
  const second = await create(page, `${prefix} second`, {
    status: "selected",
    priority: 2,
    order: 20,
  });
  const third = await create(page, `${prefix} third`, {
    status: "review",
    priority: 2,
    order: 30,
  });
  const fourth = await create(page, `${prefix} fourth`, {
    status: "backlog",
    priority: 2,
    order: 40,
  });

  await page.goto("/");
  await page.getByLabel("Filter tickets").fill(prefix);
  await expect(
    page.getByLabel(`Move ${first.meta.title} to first position`),
  ).toBeDisabled();
  await expect(
    page.getByLabel(`Move ${fourth.meta.title} to last position`),
  ).toBeDisabled();

  await page.getByLabel(`Move ${second.meta.title} later`).click();
  await expect.poll(async () => (await record(page, second.meta.id)).meta.order).toBeGreaterThan(
    (await record(page, third.meta.id)).meta.order,
  );
  expect((await record(page, second.meta.id)).meta.order).toBeLessThan(
    (await record(page, fourth.meta.id)).meta.order,
  );

  await page.getByLabel(`Move ${second.meta.title} to last position`).click();
  await expect.poll(async () => (await record(page, second.meta.id)).meta.order).toBeGreaterThan(
    (await record(page, fourth.meta.id)).meta.order,
  );
  await page.getByLabel(`Move ${second.meta.title} to first position`).click();
  await expect.poll(async () => (await record(page, second.meta.id)).meta.order).toBeLessThan(
    (await record(page, first.meta.id)).meta.order,
  );
});

test("priority planning uses visible anchors and can enter an empty bucket", async ({
  page,
}) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "priority-planning" },
  });
  const prefix = `Priority filtered ${Date.now()}`;
  const parent = await create(page, `${prefix} parent`, {});
  const first = await create(page, `${prefix} visible first`, {
    parent: parent.meta.id,
    status: "backlog",
    priority: 2,
    order: 10,
  });
  const hidden = await create(page, `${prefix} hidden anchor`, {
    parent: parent.meta.id,
    status: "review",
    priority: 2,
    order: 20,
  });
  const source = await create(page, `${prefix} visible source`, {
    parent: parent.meta.id,
    status: "selected",
    priority: 2,
    order: 30,
  });

  await page.goto("/");
  await page.getByLabel("Filter tickets").fill(`${prefix} visible`);
  await expect(page.locator(`tr[data-id="${hidden.meta.id}"]`)).toHaveCount(0);

  // Only the visible tickets are anchors. The hidden ticket is neither
  // rewritten nor used as an implicit insertion point.
  const hiddenBefore = await record(page, hidden.meta.id);
  await page.getByLabel(`Move ${source.meta.title} earlier`).click();
  await expect
    .poll(async () => (await record(page, source.meta.id)).meta.order)
    .toBeLessThan((await record(page, first.meta.id)).meta.order);
  const hiddenAfter = await record(page, hidden.meta.id);
  expect(hiddenAfter.meta.order).toBe(hiddenBefore.meta.order);
  expect(hiddenAfter.revision).toBe(hiddenBefore.revision);

  // Low has no visible members. Its boundary remains a real destination.
  await page
    .getByLabel(`Move ${source.meta.title} to priority`)
    .selectOption("3");
  await expect
    .poll(async () => (await record(page, source.meta.id)).meta.priority)
    .toBe(3);
  const moved = await record(page, source.meta.id);
  expect(moved.meta.status).toBe("selected");
  expect(moved.meta.parent).toBe(parent.meta.id);
});

test("priority planning cancels a stale placement and reloads the ticket list", async ({
  page,
}) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "priority-planning" },
  });
  const prefix = `Priority stale ${Date.now()}`;
  const source = await create(page, `${prefix} source`, {
    status: "selected",
    priority: 2,
    order: 10,
  });
  const target = await create(page, `${prefix} target`, {
    status: "backlog",
    priority: 2,
    order: 20,
  });

  await page.goto("/");
  await page.getByLabel("Filter tickets").fill(prefix);
  const sourceHandle = page.getByLabel(
    `Drag ${source.meta.title} to reorder`,
  );
  const targetRow = page.locator(`tr[data-id="${target.meta.id}"]`);
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await sourceHandle.dispatchEvent("dragstart", { dataTransfer: transfer });
  const targetBox = (await targetRow.boundingBox())!;
  await targetRow.dispatchEvent("dragover", {
    dataTransfer: transfer,
    clientY: targetBox.y + 1,
  });
  await expect(targetRow).toHaveClass(/insert-before/);

  const changed = await page.request.patch(`/api/records/${target.meta.id}`, {
    data: {
      revision: target.revision,
      patch: { title: `${prefix} target changed` },
      actor,
    },
  });
  expect(changed.ok()).toBeTruthy();
  await targetRow.dispatchEvent("drop", { dataTransfer: transfer });

  await expect(page.getByText(/order changed/i)).toBeVisible();
  expect((await record(page, source.meta.id)).revision).toBe(source.revision);
  await expect(page.locator(`tr[data-id="${source.meta.id}"]`)).toHaveCount(1);
  await expect(page.locator(`tr[data-id="${target.meta.id}"]`)).toHaveCount(1);
  await expect(page.getByText(`${prefix} target changed`)).toBeVisible();
});

test("manual table ordering only operates on same-status peers", async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "table" },
  });
  const prefix = `Manual peers ${Date.now()}`;
  const first = await create(page, `${prefix} first`, {
    status: "backlog",
    order: 10,
  });
  await create(page, `${prefix} other stage`, {
    status: "selected",
    order: 20,
  });
  const last = await create(page, `${prefix} last`, {
    status: "backlog",
    order: 30,
  });

  await page.goto("/");
  await page.getByLabel("Filter tickets").fill(prefix);
  await page.getByRole("button", { name: "View options" }).click();
  await page.getByLabel("Sort by").selectOption("manual");
  await page.keyboard.press("Escape");
  await page.getByLabel(`Move ${last.meta.title} earlier`).click();
  await expect.poll(async () => (await record(page, last.meta.id)).meta.order).toBeLessThan(
    (await record(page, first.meta.id)).meta.order,
  );
  expect((await record(page, last.meta.id)).meta.status).toBe("backlog");
  await expect(
    page.getByLabel(`Move ${last.meta.title} later`),
  ).toHaveCount(0);
});

test("priority planning is discoverable beside a legacy saved view list", async ({
  page,
}) => {
  await page.request.get("/");
  const initial = await (await page.request.get("/api/state")).json();
  const legacy = defaultViews.filter(
    (view) => view.id === "board" || view.id === "table",
  );
  await page.request.patch("/api/config", {
    data: { revision: initial.configRevision, patch: { views: legacy } },
  });
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "priority-planning" },
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Priority planning", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const unchanged = await (await page.request.get("/api/state")).json();
  expect(unchanged.config.views.map((view: { id: string }) => view.id)).toEqual(
    legacy.map((view) => view.id),
  );
  await page.request.patch("/api/config", {
    data: { revision: unchanged.configRevision, patch: { views: initial.config.views } },
  });
});
