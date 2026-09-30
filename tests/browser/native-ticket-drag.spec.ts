import { expect, test, type Page } from "@playwright/test";
const actor = { name: "Native drag fixture", kind: "human" };
async function create(
  page: Page,
  title: string,
  meta: Record<string, unknown> = {},
) {
  const response = await page.request.post("/api/records", {
    data: { kind: "ticket", meta: { title, ...meta }, actor },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
test("ordinary pointer dragging moves a board ticket across columns", async ({
  page,
}) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board" },
  });
  const parent = await create(page, "Native pointer drag parent");
  const source = await create(page, "Native pointer drag source", {
    parent: parent.meta.id,
    status: "backlog",
  });
  const target = await create(page, "Native pointer drag target", {
    parent: parent.meta.id,
    status: "selected",
  });
  await page.goto("/");
  await page.getByLabel("Filter tickets").fill("Native pointer drag");
  const card = page.locator(`.ticket-card[data-id="${source.meta.id}"]`);
  const destination = page.locator(`.ticket-card[data-id="${target.meta.id}"]`);
  await card.scrollIntoViewIfNeeded();
  await destination.scrollIntoViewIfNeeded();
  await card.dragTo(destination);
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/records/${source.meta.id}`)
          ).json()
        ).meta.status,
    )
    .toBe("selected");
  await expect(page.locator(".ticket-drop-gap.active")).toHaveCount(0);
  await expect(page.locator(".drag-source")).toHaveCount(0);
});

for (const layout of ["Board", "Table"] as const) {
  test(`native pointer reorders tickets and cancels safely in ${layout}`, async ({
    page,
  }) => {
    await page.request.get("/");
    await page.request.patch("/api/preferences", {
      data: { selected: null, page: "project", viewId: "board" },
    });
    const parent = await create(page, `Native ${layout} order parent`);
    const a = await create(page, `Native ${layout} order A`, {
      parent: parent.meta.id,
      order: 10,
    });
    await create(page, `Native ${layout} order B`, {
      parent: parent.meta.id,
      order: 20,
    });
    const c = await create(page, `Native ${layout} order C`, {
      parent: parent.meta.id,
      order: 30,
    });
    await page.goto("/");
    await page.getByLabel("Filter tickets").fill(`Native ${layout} order`);
    if (layout === "Table") {
      await page
        .getByRole("button", { name: "View options", exact: true })
        .click();
      await page
        .locator(".view-options")
        .getByRole("button", { name: "Table", exact: true })
        .click();
      await page.getByLabel("Sort by").selectOption("manual");
      await page.keyboard.press("Escape");
    }
    const item = (id: string) =>
      page.locator(
        layout === "Board"
          ? `.ticket-card[data-id="${id}"]`
          : `tr[data-id="${id}"] .ticket-link`,
      );
    await item(c.meta.id).dragTo(item(a.meta.id), {
      targetPosition: { x: 20, y: 2 },
    });
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/records/${c.meta.id}`)).json())
            .meta.order,
      )
      .toBeLessThan(10);
    await expect(page.locator(".drag-source")).toHaveCount(0);
    const current = await (
      await page.request.get(`/api/records/${c.meta.id}`)
    ).json();
    const from = (await item(c.meta.id).boundingBox())!;
    const to = (await item(a.meta.id).boundingBox())!;
    await page.mouse.move(from.x + 20, from.y + from.height / 2);
    await page.mouse.down();
    // One movement starts the browser's native drag interception. Synthetic
    // DragEvents cannot detect a source that disappears during dragstart.
    await page.mouse.move(to.x + 20, to.y + to.height / 2);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator(".drag-source")).toHaveCount(0);
    expect(
      (await (await page.request.get(`/api/records/${c.meta.id}`)).json())
        .revision,
    ).toBe(current.revision);
  });
}
