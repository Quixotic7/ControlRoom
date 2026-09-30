import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Establish the local session before resetting shared fixture preferences.
  await page.request.get("/");
  const reset = await page.request.patch("/api/preferences", {
    data: { theme: "dark", page: "project", selected: null, viewId: "board" },
  });
  expect(reset.ok()).toBeTruthy();
  await page.goto("/");
  await page.getByRole("button", { name: "More actions", exact: true }).click();
});

test("every theme option has a named, clickable visual preview", async ({
  page,
}) => {
  const select = page.getByLabel("Color theme");
  const optionIds = await select
    .locator("option")
    .evaluateAll((options) =>
      options.map((option) => option.getAttribute("value")),
    );
  const previews = page.locator(".theme-preview");

  await expect(previews).toHaveCount(optionIds.length);
  await expect(previews).toHaveText(
    await select.locator("option").allTextContents(),
  );
  expect(
    await previews.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("data-theme-preview")),
    ),
  ).toEqual(optionIds);

  for (const id of optionIds) {
    if (!id) throw new Error("Theme option is missing a value");
    await page.locator(`[data-theme-preview="${id}"]`).click();
    await expect(select).toHaveValue(id);
    await expect(page.locator(`[data-theme-preview="${id}"]`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }

  await page.locator('[data-theme-preview="gameboy"]').click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "gameboy");
});
