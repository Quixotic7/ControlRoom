import { expect, test, type Page } from "@playwright/test";

const state = async (page: Page) =>
  (await page.request.get("/api/state")).json();

test.beforeEach(async ({ page }) => {
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board" },
  });
});

test("status customization preserves a local draft through a concurrent update", async ({
  page,
}) => {
  const original = await state(page);
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Customize statuses", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Customize statuses", exact: true }),
    ).toBeVisible();

    await page.getByLabel("Name for backlog").fill("Local intake");
    const beforeRemoteChange = await state(page);
    const remoteColumns = beforeRemoteChange.config.columns.map(
      (column: any) =>
        column.id === "selected"
          ? { ...column, name: "Remote selection" }
          : column,
    );
    expect(
      (
        await page.request.patch("/api/config", {
          data: {
            revision: beforeRemoteChange.configRevision,
            patch: { columns: remoteColumns },
          },
        })
      ).ok(),
    ).toBeTruthy();

    await expect(page.getByRole("alert")).toContainText(
      "Workflow configuration changed elsewhere",
    );
    await expect(page.getByLabel("Name for backlog")).toHaveValue(
      "Local intake",
    );
    await page.getByRole("button", { name: "Reapply my draft" }).click();
    await expect(page.getByLabel("Name for backlog")).toHaveValue(
      "Local intake",
    );
    await page.getByRole("button", { name: "Save project settings" }).click();
    await expect(page.getByRole("status")).toContainText("saved");

    let saved = await state(page);
    expect(
      saved.config.columns.find((column: any) => column.id === "backlog")?.name,
    ).toBe("Local intake");
    expect(
      saved.config.columns.find((column: any) => column.id === "selected")
        ?.name,
    ).toBe("Remote selection");

    await page.getByRole("button", { name: "+ Add column" }).click();
    const added = page.locator(".column-setting").last();
    await added.getByRole("textbox").fill("Discovery");
    await added.getByRole("combobox").selectOption("review");
    await page.getByRole("button", { name: "Move Local intake later" }).click();
    await page.getByRole("button", { name: "Save project settings" }).click();
    await expect(page.getByRole("status")).toContainText("saved");
    saved = await state(page);
    expect(
      saved.config.columns.find((column: any) => column.name === "Discovery")
        ?.role,
    ).toBe("review");
    expect(
      saved.config.columns.findIndex((column: any) => column.id === "selected"),
    ).toBeLessThan(
      saved.config.columns.findIndex((column: any) => column.id === "backlog"),
    );
    await page.reload();
    await expect(page.getByLabel("Name for backlog")).toHaveValue(
      "Local intake",
    );

    await page.getByRole("button", { name: "Remove Review" }).click();
    await expect(page.getByRole("alert")).toContainText("Review still has");
    await page.getByRole("button", { name: "Move tickets on board" }).click();
    await expect(
      page.getByRole("button", { name: "Customize statuses", exact: true }),
    ).toBeVisible();
  } finally {
    const latest = await state(page);
    await page.request.patch("/api/config", {
      data: {
        revision: latest.configRevision,
        patch: {
          name: original.config.name,
          columns: original.config.columns,
          shortcut: original.config.shortcut,
        },
      },
    });
  }
});
