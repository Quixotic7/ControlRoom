import { test, expect, type Page } from "@playwright/test";
const actor = { name: "Board reviewer", kind: "human" };
const state = async (page: Page) =>
  (await page.request.get("/api/state")).json();
const record = async (page: Page, id: string) =>
  (await page.request.get(`/api/records/${id}`)).json();
async function create(page: Page, title: string, meta = {}) {
  const result = await page.request.post("/api/records", {
    data: {
      kind: "ticket",
      meta: { title, ...meta },
      body: "Original Markdown with custom details.",
      actor,
    },
  });
  expect(result.ok()).toBeTruthy();
  return result.json();
}
test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board", theme: "dark" },
  });
});

test("hidden columns persist by project/view, preserve filters and records, and skip keyboard targets", async ({
  page,
}) => {
  const r = await create(page, "Hidden backlog fixture", { status: "backlog" });
  await page.goto("/");
  const before = await record(page, r.meta.id);
  const width = (await page.locator('.column-head[data-column="backlog"]').boundingBox())!.width;
  await page
    .getByRole("button", { name: "Hide Backlog column", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("button", { name: "Show Backlog column", exact: true }),
  ).toBeFocused();
  await expect(page.locator('.board-cell[data-column="backlog"]')).toHaveCount(
    0,
  );
  await expect(
    page.locator('.column-head[data-column="backlog"]'),
  ).toContainText("Hidden");
  expect((await page.locator('.column-head[data-column="backlog"]').boundingBox())!.width).toBe(width);
  expect((await record(page, r.meta.id)).revision).toBe(before.revision);
  await page.getByLabel("Filter tickets").fill("Hidden backlog");
  await expect(page.getByLabel("Filter tickets")).toHaveValue("Hidden backlog");
  await page
    .getByRole("button", { name: "Show Backlog column", exact: true })
    .click();
  await expect(
    page.locator(".ticket-card").filter({ hasText: r.meta.title }),
  ).toBeVisible();
  await expect(page.getByLabel("Filter tickets")).toHaveValue("Hidden backlog");
  await page
    .getByRole("button", { name: "Hide Backlog column", exact: true })
    .click();
  await page.getByRole("button", { name: "Clear filter", exact: true }).click();
  const selected = page
    .locator('.board-cell[data-column="selected"] .ticket-card')
    .first();
  await selected.focus();
  await selected.press("ArrowLeft");
  await expect(selected).toBeFocused();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Show Backlog column", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(
    page
      .locator(".project-table .ticket-link")
      .filter({ hasText: r.meta.title }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View options", exact: true }).click();
  await page
    .getByRole("group")
    .getByRole("button", { name: "Board", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Hide Backlog column", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Board", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Show Backlog column", exact: true }),
  ).toBeVisible();
  const config = (await state(page)).config;
  for (const c of config.columns.filter((c: any) => c.id !== "backlog"))
    await page
      .getByRole("button", { name: `Hide ${c.name} column`, exact: true })
      .click();
  await expect(page.locator(".board-cell")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Show all columns" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/all-columns-hidden.png" });
  await page.getByRole("button", { name: "Show all columns" }).click();
  await expect(
    page.getByRole("button", { name: "Hide Backlog column", exact: true }),
  ).toBeVisible();
  expect((await record(page, r.meta.id)).revision).toBe(before.revision);
});

test("column identity survives rename and reorder, ignores removed IDs, and isolates project preferences", async ({
  page,
}) => {
  const original = await state(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Hide Backlog column", exact: true })
    .click();
  try {
    const s = await state(page);
    const columns = [...s.config.columns]
      .reverse()
      .map((c) => (c.id === "backlog" ? { ...c, name: "Later work" } : c));
    expect(
      (
        await page.request.patch("/api/config", {
          data: { revision: s.configRevision, patch: { columns } },
        })
      ).ok(),
    ).toBeTruthy();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Show Later work column", exact: true }),
    ).toBeVisible();
    const keys = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) =>
        k.startsWith("controlroom:hidden-columns:"),
      ),
    );
    expect(keys).toContain(
      `controlroom:hidden-columns:${s.config.projectId}:board`,
    );
    await page.evaluate(
      ({ key, other }) => {
        localStorage.removeItem(key);
        localStorage.setItem(
          other,
          JSON.stringify(["backlog", "deleted-column"]),
        );
      },
      {
        key: keys[0],
        other: "controlroom:hidden-columns:another-project:board",
      },
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Hide Later work column", exact: true }),
    ).toBeVisible();
    await page.evaluate(
      (key) => localStorage.setItem(key, JSON.stringify(["deleted-column"])),
      `controlroom:hidden-columns:${s.config.projectId}:board`,
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Show all columns" }),
    ).toHaveCount(0);
  } finally {
    const latest = await state(page);
    await page.request.patch("/api/config", {
      data: {
        revision: latest.configRevision,
        patch: { columns: original.config.columns },
      },
    });
  }
});

async function archivePreview(page: Page, column = "Done") {
  await page
    .getByRole("button", { name: `Options for ${column} column`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Archive completed tickets…", exact: true })
    .click();
  return page.getByRole("dialog", {
    name: "Archive completed tickets",
    exact: true,
  });
}
test("archive preview freezes filtered visible scope, rejects stale records, and restores linked parents intact", async ({
  page,
}) => {
  const parent = await create(page, "Archive parent roundtrip", {
    status: "done",
    labels: ["archive-scope"],
  });
  const child = await create(page, "Archive child stale", {
    status: "done",
    parent: parent.meta.id,
    labels: ["archive-scope"],
  });
  const active = await create(page, "Active child retained", {
    status: "progress",
    parent: parent.meta.id,
    labels: ["archive-scope"],
  });
  const outside = await create(page, "Unfiltered done retained", {
    status: "done",
  });
  const other = await create(page, "Collapsed goal", {
    labels: ["archive-scope"],
  });
  const collapsed = await create(page, "Collapsed done retained", {
    status: "done",
    parent: other.meta.id,
    labels: ["archive-scope"],
  });
  await page.request.post(`/api/records/${parent.meta.id}/comments`, {
    data: { body: "Keep this conversation.", kind: "comment", actor },
  });
  await page.goto("/");
  await page.getByLabel("Filter tickets").fill("label:archive-scope");
  await page
    .getByRole("button", { name: "Collapse Collapsed goal", exact: true })
    .click();
  const dialog = await archivePreview(page);
  await expect(dialog).toContainText("2 tickets");
  await expect(dialog).toContainText("label:archive-scope");
  await expect(dialog.getByRole("link")).toHaveCount(2);
  await expect(dialog).not.toContainText(collapsed.meta.title);
  const changed = await record(page, child.meta.id);
  await page.request.patch(`/api/records/${child.meta.id}`, {
    data: {
      revision: changed.revision,
      patch: { title: "Child changed during preview" },
      actor,
    },
  });
  const arrival = await create(page, "Arrived after preview", {
    status: "done",
    labels: ["archive-scope"],
  });
  await dialog
    .getByRole("button", { name: "Archive 2 tickets", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "1 confirmed archived; 1 need review.",
  );
  await expect(dialog.getByRole("status")).toContainText("This record changed");
  expect((await record(page, parent.meta.id)).meta.archived).toBe(true);
  for (const r of [child, active, outside, collapsed, arrival])
    expect((await record(page, r.meta.id)).meta.archived).not.toBe(true);
  expect((await record(page, child.meta.id)).meta.title).toBe(
    "Child changed during preview",
  );
  await page.screenshot({ path: "test-results/archive-partial-result.png" });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Archived tickets", exact: true })
    .click();
  await page
    .getByLabel("Search archived tickets")
    .fill(`#${parent.meta.number}`);
  const archived = page.getByRole("region", {
    name: "Archived tickets",
    exact: true,
  });
  await expect(archived.locator(".archive-results li")).toHaveCount(1);
  await archived
    .getByRole("button", {
      name: `#${parent.meta.number} ${parent.meta.title}`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue(parent.meta.title);
  await page.getByRole("button", { name: "Close ticket", exact: true }).click();
  await expect(page.locator(".record-dialog")).toHaveCount(0);
  await archived
    .getByRole("button", {
      name: `Unarchive #${parent.meta.number} ${parent.meta.title}`,
      exact: true,
    })
    .click();
  await expect(archived.locator(".archive-results li")).toHaveCount(0);
  const restored = await record(page, parent.meta.id);
  expect(restored.meta.archived).toBe(false);
  expect(restored.meta.status).toBe("done");
  expect(restored.meta.number).toBe(parent.meta.number);
  expect(restored.body).toBe(parent.body);
  expect((await record(page, child.meta.id)).meta.parent).toBe(parent.meta.id);
  const context = await (
    await page.request.get(`/api/records/${parent.meta.id}/context`)
  ).json();
  expect(
    context.comments.some((c: any) => c.body === "Keep this conversation."),
  ).toBe(true);
  await archived.getByRole("button", { name: "Back to project view" }).click();
  await expect(page.getByLabel("Filter tickets")).toHaveValue(
    "label:archive-scope",
  );
});

test("archive controls follow Done role, cancel is harmless, and hidden columns cannot be archived", async ({
  page,
}) => {
  const original = await state(page);
  const r = await create(page, "Cancel archive fixture", { status: "done" });
  try {
    const s = await state(page);
    await page.request.patch("/api/config", {
      data: {
        revision: s.configRevision,
        patch: {
          columns: s.config.columns.map((c: any) =>
            c.id === "done" ? { ...c, name: "Released" } : c,
          ),
        },
      },
    });
    await page.goto("/");
    await expect(
      page.getByRole("button", {
        name: "Options for Backlog column",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.getByLabel("Filter tickets").fill("Cancel archive fixture");
    let dialog = await archivePreview(page, "Released");
    await expect(dialog).toContainText("Released");
    await expect(dialog).toContainText("1 ticket");
    await expect(
      dialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeFocused();
    await dialog.press("Escape");
    await expect(dialog).not.toBeVisible();
    expect((await record(page, r.meta.id)).meta.archived).not.toBe(true);
    await expect(
      page.getByRole("button", {
        name: "Options for Released column",
        exact: true,
      }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Hide Released column", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Options for Released column",
        exact: true,
      }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Show Released column", exact: true })
      .click();
    await page.getByLabel("Filter tickets").fill("no-such-completed-fixture");
    dialog = await archivePreview(page, "Released");
    await expect(
      dialog.getByRole("button", { name: "Archive 0 tickets", exact: true }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    const latest = await state(page);
    await page.request.patch("/api/config", {
      data: {
        revision: latest.configRevision,
        patch: { columns: original.config.columns },
      },
    });
  }
});
