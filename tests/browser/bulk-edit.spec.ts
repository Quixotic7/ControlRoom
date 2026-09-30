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

test("board Shift-arrow starts a range at the focused card", async ({
  page,
}) => {
  const suffix = Date.now();
  const label = `arrow-range-${suffix}`;
  await create(page, `Arrow range one ${suffix}`, { labels: [label] });
  await create(page, `Arrow range two ${suffix}`, { labels: [label] });
  await page.goto("/");
  await page.getByLabel("Filter tickets").fill(`label:${label}`);

  const cards = page.locator(".ticket-card");
  await cards.nth(0).focus();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
});

test("table ranges freeze ticket IDs across filtering and validate clipboard rectangles", async ({
  page,
}) => {
  const suffix = Date.now();
  const label = `frozen-range-${suffix}`;
  const first = await create(page, `Frozen first ${suffix}`, {
    labels: [label],
  });
  const second = await create(page, `Frozen second ${suffix}`, {
    labels: [label],
  });
  const third = await create(page, `Frozen third ${suffix}`, {
    labels: [label],
    priority: 3,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByLabel("Filter tickets").fill(`label:${label}`);
  const cell = (id: string, column: "status" | "priority") =>
    page.locator(`tr[data-id="${id}"] td[data-cell-column="${column}"]`);

  // Copy a real displayed Low value, then use that clipboard value to fill a
  // separate range below. This keeps clipboard coverage on the same keyboard
  // path users take instead of injecting the fill value directly.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await cell(third.meta.id, "priority").click({ position: { x: 3, y: 3 } });
  await page.keyboard.press("Meta+c");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("Low");

  // Both Shift click and Shift arrow retain the original cell as the anchor.
  await cell(first.meta.id, "priority").click({ position: { x: 3, y: 3 } });
  await page.keyboard.press("Shift+ArrowDown");
  await expect(
    page.locator("td.cell-selected[data-cell-column='priority']"),
  ).toHaveCount(2);
  await cell(second.meta.id, "priority").click({
    modifiers: ["Shift"],
    position: { x: 3, y: 3 },
  });
  await expect(
    page.locator("td.cell-selected[data-cell-column='priority']"),
  ).toHaveCount(2);

  // Hide and restore an endpoint. Restoring it must restore the frozen IDs,
  // not select the third row which happens to be adjacent after a refresh.
  await page.getByLabel("Filter tickets").fill(first.meta.title);
  await expect(
    page.locator("td.cell-selected[data-cell-column='priority']"),
  ).toHaveCount(1);

  // The filter is an ordinary text input: pasting there remains native and
  // must not trigger table bulk editing. Clear it again before restoring table
  // focus with Shift, which deliberately preserves the frozen range.
  const filter = page.getByLabel("Filter tickets");
  await page.keyboard.press("Meta+v");
  await expect(filter).toHaveValue(`${first.meta.title}Low`);
  await page.getByLabel("Filter tickets").fill(`label:${label}`);
  await expect(
    page.locator("td.cell-selected[data-cell-column='priority']"),
  ).toHaveCount(2);
  await cell(second.meta.id, "priority").click({
    modifiers: ["Shift"],
    position: { x: 3, y: 3 },
  });
  await expect(
    page.locator("td.cell-selected[data-cell-column='priority']"),
  ).toHaveCount(2);
  await page.keyboard.press("Meta+v");
  await expect(page.getByLabel(`Priority of ${first.meta.title}`)).toHaveValue(
    "3",
  );
  await expect(page.getByLabel(`Priority of ${second.meta.title}`)).toHaveValue(
    "3",
  );
  await expect(page.getByLabel(`Priority of ${third.meta.title}`)).toHaveValue(
    "3",
  );

  // A two-column rectangle updates matching Status/Priority cells.
  await cell(first.meta.id, "status").click({ position: { x: 3, y: 3 } });
  await cell(second.meta.id, "priority").click({
    modifiers: ["Shift"],
    position: { x: 3, y: 3 },
  });
  await page.evaluate(() =>
    navigator.clipboard.writeText("Progress\tHigh\nSelected\tLow"),
  );
  await page.keyboard.press("Meta+v");
  await expect(page.getByLabel(`Status of ${first.meta.title}`)).toHaveValue(
    "progress",
  );
  await expect(page.getByLabel(`Priority of ${first.meta.title}`)).toHaveValue(
    "1",
  );
  await expect(page.getByLabel(`Status of ${second.meta.title}`)).toHaveValue(
    "selected",
  );
  await expect(page.getByLabel(`Priority of ${second.meta.title}`)).toHaveValue(
    "3",
  );

  // Reloading after the successful rectangle paste leaves focus outside the
  // table. Shift-click restores table focus while retaining this rectangle,
  // so the invalid-value assertion below tests the table paste handler.
  await cell(second.meta.id, "priority").click({
    modifiers: ["Shift"],
    position: { x: 3, y: 3 },
  });
  const firstBeforeInvalid = await record(page, first.meta.id);
  const secondBeforeInvalid = await record(page, second.meta.id);
  await page.evaluate(() =>
    navigator.clipboard.writeText("Not a status\tUrgent\nProgress\tLow"),
  );
  await page.keyboard.press("Meta+v");
  await expect(page.locator(".table-paste-feedback")).toContainText(
    "not a valid status value. Nothing was changed.",
  );
  expect((await record(page, first.meta.id)).revision).toBe(
    firstBeforeInvalid.revision,
  );
  expect((await record(page, second.meta.id)).revision).toBe(
    secondBeforeInvalid.revision,
  );
});

test("board Shift-click toggles individual tickets without selecting intervening cards", async ({
  page,
}) => {
  const label = `individual-${Date.now()}`;
  const tickets: Array<{ meta: { id: string } }> = [];
  for (let index = 0; index < 3; index++)
    tickets.push(
      await create(page, `Individual ${index} ${label}`, {
        labels: [label],
        order: index * 10,
      }),
    );
  await page.goto("/");
  await page.getByLabel("Filter tickets").fill(`label:${label}`);
  const card = (index: number) =>
    page.locator(`.ticket-card[data-id="${tickets[index].meta.id}"]`);
  await card(0).click({ modifiers: ["Shift"] });
  await card(2).click({ modifiers: ["Shift"] });
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
  await expect(card(1).locator("..")).not.toHaveClass(/selected/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await card(0).click({ modifiers: ["Shift"] });
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await expect(card(0).locator("..")).not.toHaveClass(/selected/);
  await expect(card(2).locator("..")).toHaveClass(/selected/);
});

test("table dropdown fills only the selected visible column and keeps a rectangular range", async ({
  page,
}) => {
  const label = `dropdown-${Date.now()}`;
  const first = await create(page, `Dropdown retained first ${label}`, {
    labels: [label],
    priority: 2,
    order: 10,
  });
  const second = await create(page, `Dropdown retained second ${label}`, {
    labels: [label],
    priority: 2,
    order: 20,
  });
  const hidden = await create(page, `Dropdown hidden third ${label}`, {
    labels: [label],
    priority: 2,
    order: 30,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByLabel("Filter tickets").fill(`label:${label}`);
  const cell = (id: string, column: string) =>
    page.locator(`td[data-cell-id="${id}"][data-cell-column="${column}"]`);
  await cell(first.meta.id, "status").focus();
  await cell(hidden.meta.id, "priority").click({ modifiers: ["Shift"] });
  await expect(page.locator(".cell-selected")).toHaveCount(6);
  // Focus the native editor inside the range, as a mouse/keyboard user would.
  const priority = page.getByLabel(`Priority of ${first.meta.title}`);
  await priority.focus();
  await priority.selectOption("0");
  await expect(page.locator(".cell-selected")).toHaveCount(6);
  for (const ticket of [first, second, hidden]) {
    await expect
      .poll(async () => (await record(page, ticket.meta.id)).meta.priority)
      .toBe(0);
    expect((await record(page, ticket.meta.id)).meta.status).toBe("backlog");
  }
  // Filtering never transfers the frozen range to an unseen ticket.
  await page.getByLabel("Filter tickets").fill(`Dropdown retained`);
  await expect(page.locator(".cell-selected")).toHaveCount(4);
  const status = page.getByLabel(`Status of ${second.meta.title}`);
  await status.focus();
  await status.selectOption("selected");
  for (const ticket of [first, second])
    await expect
      .poll(async () => (await record(page, ticket.meta.id)).meta.status)
      .toBe("selected");
  expect((await record(page, hidden.meta.id)).meta.status).toBe("backlog");
  expect((await record(page, hidden.meta.id)).meta.priority).toBe(0);
});

test("priority planning retains selected-column edits without changing workflow", async ({
  page,
}) => {
  const label = `planning-fill-${Date.now()}`;
  const first = await create(page, `Planning fill first ${label}`, {
    labels: [label],
    priority: 2,
    order: 10,
    status: "selected",
  });
  const second = await create(page, `Planning fill second ${label}`, {
    labels: [label],
    priority: 2,
    order: 20,
    status: "review",
  });
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "priority-planning" },
  });
  await page.goto("/");
  await page.getByLabel("Filter tickets").fill(`label:${label}`);
  await page
    .locator(`td[data-cell-id="${first.meta.id}"][data-cell-column="priority"]`)
    .focus();
  await page
    .locator(
      `td[data-cell-id="${second.meta.id}"][data-cell-column="priority"]`,
    )
    .click({ modifiers: ["Shift"] });
  const editor = page.getByLabel(`Priority of ${first.meta.title}`);
  await editor.focus();
  await editor.selectOption("1");
  for (const ticket of [first, second]) {
    await expect
      .poll(async () => (await record(page, ticket.meta.id)).meta.priority)
      .toBe(1);
    expect((await record(page, ticket.meta.id)).meta.status).toBe(
      ticket.meta.status,
    );
  }
  await expect(page.locator(".cell-selected")).toHaveCount(2);
});
