import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { patchMd } from "../../src/files";
import { defaultViews } from "../../web/model";

const actor = { name: "Browser reviewer", kind: "human" };
async function create(page: Page, title: string, extra = {}) {
  const response = await page.request.post("/api/records", {
    data: {
      kind: "ticket",
      meta: { title, ...extra },
      body: "Preserve these notes.",
      actor,
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function open(page: Page, id: string) {
  await page.goto("about:blank");
  await page.request.patch("/api/preferences", { data: { selected: id } });
  await page.goto("/");
  await expect(page.getByRole("dialog")).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: {
      selected: null,
      page: "project",
      viewId: "board",
      density: "comfortable",
      conversationOrder: "oldest",
    },
  });
  await page.goto("/");
});

test("view tabs keep their geometry through selection and unsaved changes", async ({
  page,
}) => {
  const state = await (await page.request.get("/api/state")).json();
  const views = [
    ...(state.config.views ?? defaultViews),
    {
      id: "test-long",
      name: "A much longer saved view",
      layout: "table",
      filter: "",
      groupBy: "none",
      sort: "number",
    },
  ];
  await page.request.patch("/api/config", {
    data: { revision: state.configRevision, patch: { views } },
  });
  await page.reload();
  const tabs = page.locator(".view-tab");
  await expect(tabs).toHaveCount(views.length);
  const geometry = () =>
    tabs.evaluateAll((nodes) =>
      nodes.map((n) => {
        const b = n.getBoundingClientRect();
        return { x: b.x, width: b.width };
      }),
    );
  const original = await geometry();
  for (const theme of ["light", "dark"]) {
    await page.request.patch("/api/preferences", {
      data: { theme, density: theme === "dark" ? "compact" : "comfortable" },
    });
    await page.reload();
    for (const view of views) {
      await page.getByRole("button", { name: view.name, exact: true }).click();
      const actual = await geometry();
      actual.forEach((b, i) => {
        expect(Math.abs(b.width - original[i].width)).toBeLessThan(1);
        expect(Math.abs(b.x - original[i].x)).toBeLessThan(1);
      });
      await expect(
        page.getByRole("button", { name: /Options for .* view/ }),
      ).toHaveCount(1);
    }
  }
  await page
    .getByRole("textbox", { name: "Filter tickets" })
    .fill("draft filter");
  await expect(
    page.locator('.unsaved-dot[title="Unsaved changes"]'),
  ).toBeVisible();
  expect(await geometry()).toEqual(original);
  await page
    .getByRole("button", { name: "Options for A much longer saved view view" })
    .click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "View name" }).fill("Renamed view");
  await page.getByRole("textbox", { name: "View name" }).press("Enter");
  await expect(
    page.getByRole("button", { name: "Renamed view", exact: true }),
  ).toBeVisible();
  const latest = await (await page.request.get("/api/state")).json();
  await page.request.patch("/api/config", {
    data: {
      revision: latest.configRevision,
      patch: { views: state.config.views ?? defaultViews },
    },
  });
});

test("parent autocomplete selects by number, preserves drafts, and excludes child cycles", async ({
  page,
}) => {
  const parent = await create(page, "Parent choice twin", { archived: true });
  const twin = await create(page, "Parent choice twin");
  const current = await create(page, "Autocomplete test", {
    parent: parent.meta.id,
  });
  const child = await create(page, "Descendant cannot be parent", {
    parent: current.meta.id,
  });
  await create(page, "Nested descendant", { parent: child.meta.id });
  await open(page, current.meta.id);
  let input = page.getByRole("combobox", {
    name: "Parent ticket",
    exact: true,
  });
  await expect(input).toHaveValue(`#${parent.meta.number} Parent choice twin`);
  await expect(page.getByText(/Selected:.*\(archived\)/)).toBeVisible();
  await input.fill("choice twin");
  const options = page
    .getByRole("listbox", { name: "Parent ticket suggestions" })
    .getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.first()).toContainText(`#${twin.meta.number}`);
  await input.fill("descendant");
  await expect(options).toHaveCount(0);
  await expect(page.getByText("No matching parent tickets.")).toBeVisible();
  await input.press("Escape");
  await expect(input).toHaveValue(`#${parent.meta.number} Parent choice twin`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await input.fill("#0");
  await expect(options.first()).toContainText("#0");
  await input.press("ArrowDown");
  await input.press("ArrowUp");
  await input.press("Enter");
  await expect(input).toHaveValue(/#0 /);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  let saved = await (
    await page.request.get(`/api/records/${current.meta.id}`)
  ).json();
  expect(saved.meta.parent).not.toBe(parent.meta.id);
  expect(saved.body).toBe("Preserve these notes.");
  await open(page, current.meta.id);
  input = page.getByRole("combobox", { name: "Parent ticket", exact: true });
  await input.fill("unsaved search text");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  expect(
    (await (await page.request.get(`/api/records/${current.meta.id}`)).json())
      .meta.parent,
  ).toBe(saved.meta.parent);
  await open(page, current.meta.id);
  await page.getByRole("button", { name: "Clear parent", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  expect(
    (await (await page.request.get(`/api/records/${current.meta.id}`)).json())
      .meta.parent,
  ).toBeNull();
  await open(page, current.meta.id);
  await page
    .getByRole("combobox", { name: "Parent ticket", exact: true })
    .fill("choice twin");
  await page.screenshot({ path: "test-results/parent-autocomplete.png" });
  await options.first().click();
  await expect(
    page.getByRole("combobox", { name: "Parent ticket", exact: true }),
  ).toHaveValue(`#${twin.meta.number} Parent choice twin`);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  expect(
    (await (await page.request.get(`/api/records/${current.meta.id}`)).json())
      .meta.parent,
  ).toBe(twin.meta.id);
});

test("conversation sort is explicit, deterministic, persistent, and keeps the reader in place", async ({
  page,
}) => {
  const ticket = await create(page, "Sorted thread fixture");
  const state = await (await page.request.get("/api/state")).json();
  const entries = [];
  for (const [body, at, kind] of [
    ["Latest note", "2025-03-01T00:00:00Z", "review"],
    ["Earliest note", "2025-01-01T00:00:00Z", "comment"],
    ["Equal time A", "2025-02-01T00:00:00Z", "question"],
    ["Equal time B", "2025-02-01T00:00:00Z", "handoff"],
  ]) {
    const comment = await (
      await page.request.post(`/api/records/${ticket.meta.id}/comments`, {
        data: { body, kind, actor },
      })
    ).json();
    const file = path.join(
      state.canonical,
      ".workboard/records/comments",
      `${comment.id}.md`,
    );
    fs.writeFileSync(file, patchMd(fs.readFileSync(file, "utf8"), { at }));
    entries.push({ ...comment, at, body });
  }
  const ordered = entries
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
    .map((c) => c.body);
  await open(page, ticket.meta.id);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Conversation/ }).click();
  const bodies = page.locator(".comment .markdown");
  await expect(bodies).toHaveText(ordered);
  await dialog
    .getByRole("button", {
      name: "Comments: oldest first. Switch to newest first",
    })
    .press("Enter");
  await expect(bodies).toHaveText([...ordered].reverse());
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/preferences")).json())
          .conversationOrder,
    )
    .toBe("newest");
  await page.reload();
  await dialog.getByRole("button", { name: /^Conversation/ }).click();
  await expect(bodies).toHaveText([...ordered].reverse());
  const anchor = page.locator(".comment").filter({ hasText: "Equal time A" });
  await anchor.scrollIntoViewIfNeeded();
  const before = await anchor.boundingBox();
  await page.request.post(`/api/records/${ticket.meta.id}/comments`, {
    data: {
      body: "New external update\n\n" + "Extra context.\n\n".repeat(20),
      kind: "comment",
      actor,
    },
  });
  await expect(bodies.first()).toContainText("New external update");
  const after = await anchor.boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
  await page.getByLabel("Add to the conversation").fill("My new reply");
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(bodies.first()).toHaveText("My new reply");
  await page
    .getByRole("button", { name: "View your new comment", exact: true })
    .click();
  await expect(bodies.first()).toBeInViewport();
  await dialog.getByRole("button", { name: "Details", exact: true }).click();
  await anchor.scrollIntoViewIfNeeded();
  const detailsBefore = await anchor.boundingBox();
  await page.request.post(`/api/records/${ticket.meta.id}/comments`, {
    data: { body: "Update while reading Details", actor },
  });
  await expect(bodies.first()).toContainText("Update while reading Details");
  expect(
    Math.abs((await anchor.boundingBox())!.y - detailsBefore!.y),
  ).toBeLessThan(2);
  await dialog.getByRole("button", { name: /^Conversation/ }).click();
  await page.locator(".detail-body").evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.screenshot({ path: "test-results/conversation-sort.png" });
});
