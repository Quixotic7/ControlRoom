import { test, expect, type Page } from "@playwright/test";

const actor = { name: "Archive grouping reviewer", kind: "human" };
const state = async (page: Page) =>
  (await page.request.get("/api/state")).json();
const record = async (page: Page, id: string) =>
  (await page.request.get(`/api/records/${id}`)).json();

async function create(page: Page, title: string, meta = {}) {
  const result = await page.request.post("/api/records", {
    data: {
      kind: "ticket",
      meta: { title, ...meta },
      body: "Archived ticket fixture.",
      actor,
    },
  });
  expect(result.ok()).toBeTruthy();
  return result.json();
}

async function archive(page: Page, id: string) {
  const current = await record(page, id);
  const result = await page.request.patch(`/api/records/${id}`, {
    data: { revision: current.revision, patch: { archived: true }, actor },
  });
  expect(result.ok()).toBeTruthy();
}

test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board", theme: "dark" },
  });
});

test("archive history uses board-style workflow columns with parent context", async ({
  page,
}) => {
  const original = await state(page);
  const parent = await create(page, "Archived grouping parent", {
    status: "done",
  });
  const doneChild = await create(page, "Archived shipped child", {
    status: "done",
    parent: parent.meta.id,
  });
  const reviewChild = await create(page, "Archived review child", {
    status: "review",
    parent: parent.meta.id,
  });

  try {
    const current = await state(page);
    const configResult = await page.request.patch("/api/config", {
      data: {
        revision: current.configRevision,
        patch: {
          columns: current.config.columns.map((column: any) =>
            column.id === "done"
              ? { ...column, name: "Shipped work" }
              : column.id === "review"
                ? { ...column, name: "Ready for archive" }
                : column,
          ),
        },
      },
    });
    expect(configResult.ok()).toBeTruthy();
    await Promise.all(
      [parent, doneChild, reviewChild].map((ticket) =>
        archive(page, ticket.meta.id),
      ),
    );

    await page.goto("/");
    await page
      .getByRole("button", { name: "Archived tickets", exact: true })
      .click();
    const archiveView = page.getByRole("region", {
      name: "Archived tickets",
      exact: true,
    });
    const shipped = archiveView.getByRole("region", {
      name: "Shipped work swimlane",
      exact: true,
    });
    const review = archiveView.getByRole("region", {
      name: "Ready for archive swimlane",
      exact: true,
    });
    await expect(shipped).toContainText("2");
    await expect(shipped).toContainText(parent.meta.title);
    await expect(shipped).toContainText(doneChild.meta.title);
    await expect(shipped).toContainText(`Parent: #${parent.meta.number}`);
    await expect(review).toContainText(reviewChild.meta.title);
    await expect(review).not.toContainText(doneChild.meta.title);
    const [reviewBox, shippedBox] = await Promise.all([
      review.boundingBox(),
      shipped.boundingBox(),
    ]);
    expect(reviewBox).not.toBeNull();
    expect(shippedBox).not.toBeNull();
    // Columns should sit beside each other as on the active board, not stack
    // as headings in one history list.
    expect(Math.abs(reviewBox!.y - shippedBox!.y)).toBeLessThan(2);
    expect(reviewBox!.x).not.toBe(shippedBox!.x);

    await archiveView
      .getByLabel("Search archived tickets")
      .fill(`#${reviewChild.meta.number}`);
    await expect(review).toContainText(reviewChild.meta.title);
    await expect(shipped).toContainText("No archived tickets.");
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
