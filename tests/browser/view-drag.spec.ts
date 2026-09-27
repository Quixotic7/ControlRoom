import { test, expect } from "@playwright/test";
import { defaultViews } from "../../web/model";

test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  const s = await (await page.request.get("/api/state")).json();
  await page.request.patch("/api/config", {
    data: {
      revision: s.configRevision,
      patch: {
        views: [
          ...defaultViews,
          { ...defaultViews[0], id: "third", name: "Third view" },
        ],
      },
    },
  });
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board" },
  });
  await page.goto("/");
  await page.locator(".view-tab").first().waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts.ready);
});
test.afterEach(async ({ page }) => {
  const s = await (await page.request.get("/api/state")).json();
  await page.request.patch("/api/config", {
    data: { revision: s.configRevision, patch: { views: defaultViews } },
  });
});
test("view tabs drag in both directions, retain active drafts, and persist after refresh", async ({
  page,
}) => {
  await page.getByLabel("Filter tickets").fill("unsaved tab draft");
  const order = () =>
    page
      .locator(".view-tab")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-view-id")));
  const width = (await page.locator('[data-view-id="board"]').boundingBox())!
    .width;
  await page
    .getByRole("button", { name: "Third view", exact: true })
    .dragTo(page.locator('[data-view-id="board"]'), {
      targetPosition: { x: 3, y: 12 },
    });
  await expect.poll(order).toEqual(["third", "board", "table"]);
  await expect(
    page.getByRole("button", { name: "Board", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("Filter tickets")).toHaveValue(
    "unsaved tab draft",
  );
  expect(
    (await page.locator('[data-view-id="board"]').boundingBox())!.width,
  ).toBeCloseTo(width, 1);
  const target = page.locator('[data-view-id="table"]');
  await page
    .getByRole("button", { name: "Third view", exact: true })
    .dragTo(target, {
      targetPosition: { x: (await target.boundingBox())!.width - 3, y: 12 },
    });
  await expect.poll(order).toEqual(["board", "table", "third"]);
  await page.reload();
  await expect.poll(order).toEqual(["board", "table", "third"]);
  await page.getByRole("button", { name: "Third view", exact: true }).click();
  await page
    .getByRole("button", { name: "Options for Third view view" })
    .click();
  await page.getByRole("button", { name: "Move left", exact: true }).click();
  await expect.poll(order).toEqual(["board", "third", "table"]);
});
test("a configuration change during dragging is rejected without overwriting newer views", async ({
  page,
}) => {
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await page
    .getByRole("button", { name: "Third view", exact: true })
    .dispatchEvent("dragstart", { dataTransfer: transfer });
  const s = await (await page.request.get("/api/state")).json();
  const changed = s.config.views.map((v: any) =>
    v.id === "third" ? { ...v, name: "Renamed elsewhere" } : v,
  );
  await page.request.patch("/api/config", {
    data: { revision: s.configRevision, patch: { views: changed } },
  });
  await expect(
    page.getByRole("button", { name: "Renamed elsewhere", exact: true }),
  ).toBeVisible();
  const target = page.locator('[data-view-id="board"]'),
    b = (await target.boundingBox())!;
  await target.dispatchEvent("drop", {
    dataTransfer: transfer,
    clientX: b.x + 2,
    clientY: b.y + 10,
  });
  await expect(page.getByRole("alert")).toContainText("Configuration changed");
  const latest = await (await page.request.get("/api/state")).json();
  expect(latest.config.views.map((v: any) => v.id)).toEqual([
    "board",
    "table",
    "third",
  ]);
  expect(latest.config.views[2].name).toBe("Renamed elsewhere");
  await transfer.dispose();
});
test("dropping on the same view does not write configuration", async ({
  page,
}) => {
  let writes = 0;
  await page.route("**/api/config", async (route) => {
    if (route.request().method() === "PATCH") writes++;
    await route.continue();
  });
  const board = page.getByRole("button", { name: "Board", exact: true });
  await board.dragTo(page.locator('[data-view-id="board"]'), {
    targetPosition: { x: 4, y: 12 },
  });
  expect(writes).toBe(0);
});
