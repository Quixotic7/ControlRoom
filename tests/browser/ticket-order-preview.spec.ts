import { expect, test, type Page } from "@playwright/test";

const actor = { name: "Human", kind: "human" };

async function create(page: Page, title: string, order: number) {
  const response = await page.request.post("/api/records", {
    data: { kind: "ticket", meta: { title, order }, actor },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

const get = async (page: Page, id: string) =>
  (await page.request.get(`/api/records/${id}`)).json();

test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board", theme: "dark" },
  });
});

test("board opens a stable ticket-sized gap and commits that exact position", async ({
  page,
}) => {
  const a = await create(page, "Gap preview fixture A", 10);
  const b = await create(page, "Gap preview fixture B", 20);
  const c = await create(page, "Gap preview fixture C", 30);
  await page.goto("/");
  await page.getByLabel("Filter tickets").fill("Gap preview fixture");

  const source = page.locator(`.ticket-card[data-id="${a.meta.id}"]`);
  const middle = page.locator(`.ticket-card[data-id="${b.meta.id}"]`);
  const target = page.locator(`.ticket-card[data-id="${c.meta.id}"]`);
  const lane = source.locator(
    "xpath=ancestor::div[contains(@class, 'board-cell')]",
  );
  const sourceHeight = (await source.boundingBox())!.height;
  const transfer = await page.evaluateHandle(() => new DataTransfer());

  await source.dispatchEvent("dragstart", { dataTransfer: transfer });
  let middleBox = (await middle.boundingBox())!;
  let targetBox = (await target.boundingBox())!;
  await lane.dispatchEvent("dragover", {
    dataTransfer: transfer,
    clientY: (middleBox.y + middleBox.height + targetBox.y) / 2,
  });

  const gap = lane.locator(".ticket-drop-gap.active");
  await expect(gap).toHaveCount(1);
  await expect(target).toHaveClass(/insert-before/);
  await expect
    .poll(() =>
      gap.evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBeGreaterThan(sourceHeight + 8);
  expect(
    await gap.evaluate(
      (element) => getComputedStyle(element).transitionProperty,
    ),
  ).toContain("height");
  expect((await get(page, a.meta.id)).revision).toBe(a.revision);

  targetBox = (await target.boundingBox())!;
  await lane.dispatchEvent("dragover", {
    dataTransfer: transfer,
    clientY: targetBox.y + targetBox.height + 24,
  });
  await expect(gap).toHaveClass(/edge-end/);
  await expect(gap).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(lane.locator(".ticket-drop-gap.active")).toHaveCount(0);
  expect((await get(page, a.meta.id)).revision).toBe(a.revision);

  await source.dispatchEvent("dragstart", { dataTransfer: transfer });
  middleBox = (await middle.boundingBox())!;
  targetBox = (await target.boundingBox())!;
  await lane.dispatchEvent("dragover", {
    dataTransfer: transfer,
    clientY: (middleBox.y + middleBox.height + targetBox.y) / 2,
  });
  await expect(target).toHaveClass(/insert-before/);
  await lane.dispatchEvent("drop", { dataTransfer: transfer });

  await expect
    .poll(async () => (await get(page, a.meta.id)).meta.order)
    .toBeGreaterThan(20);
  expect((await get(page, a.meta.id)).meta.order).toBeLessThan(30);
  await expect
    .poll(async () =>
      page
        .locator(".ticket-card")
        .evaluateAll((cards) =>
          cards.map((card) => card.getAttribute("data-id")),
        ),
    )
    .toEqual([b.meta.id, a.meta.id, c.meta.id]);
});

test("table reserves the dragged row height and disables movement animation when requested", async ({
  page,
}) => {
  const a = await create(page, "Table gap fixture A", 10);
  await create(page, "Table gap fixture B", 20);
  const c = await create(page, "Table gap fixture C", 30);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByLabel("Filter tickets").fill("Table gap fixture");
  await page.getByRole("button", { name: "View options", exact: true }).click();
  await page
    .locator(".view-options")
    .getByRole("button", { name: "Table", exact: true })
    .click();
  await page.getByLabel("Sort by").selectOption("manual");
  await page.keyboard.press("Escape");

  const first = page.locator(`tr[data-id="${a.meta.id}"]`);
  const source = page.locator(`tr[data-id="${c.meta.id}"]`);
  const body = source.locator("xpath=ancestor::tbody");
  const sourceHeight = (await source.boundingBox())!.height;
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await source
    .locator(".ticket-link")
    .dispatchEvent("dragstart", { dataTransfer: transfer });
  const firstBox = (await first.boundingBox())!;
  await body.dispatchEvent("dragover", {
    dataTransfer: transfer,
    clientY: firstBox.y + 1,
  });

  const space = body.locator(".ticket-drop-row.active .ticket-drop-space");
  await expect(space).toHaveCount(1);
  expect(
    await space.evaluate((element) => element.getBoundingClientRect().height),
  ).toBe(sourceHeight);
  expect(
    await space.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    ),
  ).toBe("0s");
  expect((await get(page, c.meta.id)).revision).toBe(c.revision);
  await page.keyboard.press("Escape");
  await expect(body.locator(".ticket-drop-row.active")).toHaveCount(0);
  expect((await get(page, c.meta.id)).revision).toBe(c.revision);
});
