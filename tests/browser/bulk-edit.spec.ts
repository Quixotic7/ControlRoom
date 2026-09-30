import { test, expect, type Page } from "@playwright/test";

const actor = { name: "Bulk edit reviewer", kind: "human" };

async function create(page: Page, title: string, meta = {}) {
  const response = await page.request.post("/api/records", {
    data: { kind: "ticket", meta: { title, ...meta }, body: "", actor },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

const record = async (page: Page, id: string) =>
  (await page.request.get(`/api/records/${id}`)).json();

test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board", theme: "dark" },
  });
});

test("board/table selection reconciles visibility and partial bulk results retry only failures", async ({
  page,
}) => {
  const suffix = Date.now();
  const label = `bulk-${suffix}`;
  const ancestor = await create(page, `Bulk ancestor ${suffix}`, {
    labels: [label, "remove-me"],
    status: "backlog",
    priority: 0,
  });
  const child = await create(page, `Bulk cycle child ${suffix}`, {
    labels: [label],
    parent: ancestor.meta.id,
  });
  const good = await create(page, `Bulk good ${suffix}`, {
    labels: [label, "remove-me"],
    status: "progress",
    priority: 2,
  });
  const stale = await create(page, `Bulk stale ${suffix}`, {
    labels: [label, "remove-me"],
    status: "selected",
    priority: 3,
  });

  await page.goto("/");
  await page.getByLabel("Filter tickets").fill(good.meta.title);
  await page
    .locator(".ticket-card")
    .filter({ hasText: good.meta.title })
    .click({ modifiers: ["Shift"] });
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();

  // A normal live refresh replaces record objects, but selection remains on
  // the durable ID and never jumps to a different card.
  let current = await record(page, good.meta.id);
  await page.request.patch(`/api/records/${good.meta.id}`, {
    data: {
      revision: current.revision,
      patch: { owner: "Refreshed owner" },
      actor,
    },
  });
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await page.getByLabel("Filter tickets").fill("does-not-match-anything");
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByLabel("Filter tickets").fill(`label:${label}`);

  for (const ticket of [ancestor, good, stale])
    await page.getByLabel(`Select ${ticket.meta.title}`).check();
  await expect(page.getByText("3 selected", { exact: true })).toBeVisible();
  await expect(
    page.locator(".bulk-enable").filter({ hasText: "Change status" }),
  ).toContainText("Mixed");
  await expect(
    page.locator(".bulk-enable").filter({ hasText: "Change priority" }),
  ).toContainText("Mixed");

  await page.getByLabel("Change parent").check();
  const parentInput = page.getByRole("combobox", {
    name: "New parent",
    exact: true,
  });
  await parentInput.click();
  await parentInput.fill(child.meta.title);
  await page
    .getByRole("option", { name: new RegExp(child.meta.title) })
    .click();
  await page.getByLabel("Add labels").fill("added-by-bulk");
  await page.getByLabel("Remove labels").fill("remove-me");

  // Change this record after Apply has frozen its revision but before its
  // request reaches the server, creating one real stale-revision failure.
  let injectedConflict = false;
  await page.route(`**/api/records/${stale.meta.id}`, async (route) => {
    if (route.request().method() !== "PATCH" || injectedConflict) {
      await route.continue();
      return;
    }
    injectedConflict = true;
    const latest = await record(page, stale.meta.id);
    await page.request.patch(`/api/records/${stale.meta.id}`, {
      data: {
        revision: latest.revision,
        patch: { title: `${stale.meta.title} externally changed` },
        actor,
      },
    });
    await route.continue();
  });

  await page.getByRole("button", { name: "Apply to 3" }).click();
  const results = page.locator(".bulk-results");
  await expect(results).toContainText("1 succeeded");
  await expect(results).toContainText("2 failed");
  await expect(results).toContainText("0 unchanged");
  await expect(results).toContainText("Parent tickets cannot form a cycle");
  await expect(results).toContainText("This record changed");
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();

  const goodAfterFirst = await record(page, good.meta.id);
  expect(goodAfterFirst.meta.labels).toEqual([label, "added-by-bulk"]);
  expect(goodAfterFirst.meta.owner).toBe("Refreshed owner");
  expect(goodAfterFirst.meta.status).toBe("progress");
  expect(goodAfterFirst.meta.priority).toBe(2);
  expect((await record(page, ancestor.meta.id)).meta.labels).toEqual([
    label,
    "remove-me",
  ]);
  expect((await record(page, ancestor.meta.id)).meta.status).toBe("backlog");
  expect((await record(page, ancestor.meta.id)).meta.priority).toBe(0);

  await page.getByRole("button", { name: "Clear parent" }).click();
  await page.getByRole("button", { name: "Apply to 2" }).click();
  await expect(results).toContainText("2 succeeded");
  await expect(results).toContainText("0 failed");
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
  expect((await record(page, good.meta.id)).revision).toBe(
    goodAfterFirst.revision,
  );
  expect((await record(page, ancestor.meta.id)).meta.labels).toEqual([
    label,
    "added-by-bulk",
  ]);
  expect((await record(page, stale.meta.id)).meta.labels).toEqual([
    label,
    "added-by-bulk",
  ]);
});

test("board Shift selection excludes hidden and collapsed tickets and reports unchanged writes", async ({
  page,
}) => {
  const suffix = Date.now();
  const label = `visible-${suffix}`;
  const goal = await create(page, `Bulk goal ${suffix}`);
  const backlog = await create(page, `Bulk hidden ${suffix}`, {
    labels: [label],
    parent: goal.meta.id,
    status: "backlog",
  });
  const progress = await create(page, `Bulk shown ${suffix}`, {
    labels: [label],
    parent: goal.meta.id,
    status: "progress",
  });

  await page.goto("/");
  await page.getByLabel("Filter tickets").fill(`label:${label}`);

  const backlogCard = page
    .locator(".ticket-card")
    .filter({ hasText: backlog.meta.title });
  await backlogCard.click({ modifiers: ["Shift"] });
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  const parentField = page
    .locator(".bulk-enable")
    .filter({ hasText: "Change parent" });
  await expect(parentField).toContainText(
    `#${goal.meta.number} ${goal.meta.title}`,
  );
  await expect(parentField).not.toContainText(goal.meta.id);
  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Hide Backlog column" }).click();
  await expect(backlogCard).toHaveCount(0);
  await page.getByRole("button", { name: "Select visible (1)" }).click();
  await expect(
    page
      .locator(".board-ticket.selected .ticket-card")
      .filter({ hasText: progress.meta.title }),
  ).toHaveCount(1);
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();

  await page
    .getByRole("button", { name: `Collapse ${goal.meta.title}` })
    .click();
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Select visible (0)" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: `Expand ${goal.meta.title}` }).click();
  await page.getByRole("button", { name: "Show Backlog column" }).click();
  await page.getByRole("button", { name: "Select visible (2)" }).click();
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();

  // Adding a label every ticket already has is an explicit unchanged result.
  await page.getByLabel("Add labels").fill(label);
  const apply = page.getByRole("button", { name: "Apply to 2" });
  await apply.focus();
  await page.keyboard.press("Enter");
  const results = page.locator(".bulk-results");
  await expect(results).toContainText("0 succeeded");
  await expect(results).toContainText("0 failed");
  await expect(results).toContainText("2 unchanged");
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
  expect((await record(page, backlog.meta.id)).meta.status).toBe("backlog");
  expect((await record(page, progress.meta.id)).meta.status).toBe("progress");
});

test("table Shift ranges copy displayed values and report a stale paste conflict", async ({
  page,
}) => {
  const suffix = Date.now();
  const first = await create(page, `Cell paste first ${suffix}`);
  const second = await create(page, `Cell paste second ${suffix}`);
  await page.goto("/");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByLabel("Filter tickets").fill(`Cell paste ${suffix}`);
  const priorityCell = (id: string) =>
    page.locator(`tr[data-id="${id}"] td[data-cell-column="priority"]`);
  await priorityCell(first.meta.id).click({ position: { x: 3, y: 3 } });
  await priorityCell(second.meta.id).click({
    modifiers: ["Shift"],
    position: { x: 3, y: 3 },
  });
  await expect(
    page.locator("td.cell-selected[data-cell-column='priority']"),
  ).toHaveCount(2);

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.keyboard.press("Meta+c");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("Normal\nNormal");

  let conflicted = false;
  await page.route(`**/api/records/${second.meta.id}`, async (route) => {
    if (route.request().method() !== "PATCH" || conflicted) {
      await route.continue();
      return;
    }
    conflicted = true;
    const latest = await record(page, second.meta.id);
    await page.request.patch(`/api/records/${second.meta.id}`, {
      data: { revision: latest.revision, patch: { owner: "external" }, actor },
    });
    await route.continue();
  });
  await page.evaluate(() => navigator.clipboard.writeText("Low"));
  await page.keyboard.press("Meta+v");
  await expect(page.locator(".table-paste-feedback")).toContainText(
    "1 updated; 1 conflict",
  );
  await expect(page.getByLabel(`Priority of ${first.meta.title}`)).toHaveValue(
    "3",
  );
  await expect(page.getByLabel(`Priority of ${second.meta.title}`)).toHaveValue(
    "2",
  );
});
