import { expect, test, type Page } from "@playwright/test";

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

  // A drag within Normal crosses workflow statuses but only changes rank.
  await page
    .getByLabel(`Drag ${second.meta.title} to reorder`)
    .dragTo(page.getByLabel(`Drag ${first.meta.title} to reorder`));
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
