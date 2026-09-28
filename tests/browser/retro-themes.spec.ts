import { test, expect, type Page } from "@playwright/test";
const actor = { name: "Human", kind: "human" };
async function theme(page: Page, id: string) {
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByLabel("Color theme").selectOption(id);
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.fonts.ready);
  // Wait for the existing lane-color transition before capturing a preset.
  const cell = page.locator(".board-cell").first();
  if (await cell.count()) {
    const hex = await page.locator("html").evaluate((e) =>
      getComputedStyle(e).getPropertyValue("--lane").trim().slice(1),
    );
    if (hex.length === 6) {
      const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      await expect(cell).toHaveCSS("background-color", `rgb(${rgb.join(", ")})`);
    }
  }
}
test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { theme: "light", page: "project", selected: null, viewId: "board" },
  });
  await page.goto("/");
});
test("desktop presets load bundled pixel type and provide working period window menus and close controls", async ({
  page,
}) => {
  const r = await (
    await page.request.post("/api/records", {
      data: {
        kind: "ticket",
        meta: { title: "Retro window review fixture" },
        body: "Preserve this description.",
        actor,
      },
    })
  ).json();
  for (const id of ["win95", "win31", "mac7", "amiga", "c64"]) {
    await theme(page, id);
    await page.goto("/#ticket=" + r.meta.id);
    await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => document.fonts.check('16px "Pixelify Sans"')),
    ).toBe(true);
    expect(
      await page
        .getByLabel("Title", { exact: true })
        .evaluate((e) => getComputedStyle(e).fontFamily),
    ).toContain("Pixelify Sans");
    const caption = page.locator(".record-dialog > .dialog-top");
    await expect(caption).toBeVisible();
    if (id !== "win95") {
      const bar = await caption.boundingBox(),
        close = await page
          .getByRole("button", { name: "Close ticket", exact: true })
          .boundingBox();
      expect(close!.x - bar!.x).toBeLessThan(15);
    }
    const color = await caption.evaluate(
      (e) => getComputedStyle(e).backgroundColor,
    );
    if (id === "win95") expect(color).toBe("rgb(0, 0, 128)");
    if (id === "win31") expect(color).toBe("rgb(0, 0, 160)");
    if (id === "amiga") expect(color).toBe("rgb(23, 74, 150)");
    if (id === "c64") {
      expect(color).toBe("rgb(191, 192, 206)");
      await expect(page.locator(".record-subtitle .stage-pill")).toHaveCSS(
        "color",
        "rgb(10, 11, 13)",
      );
      await expect(page.locator(".retro-window-menu")).toHaveCSS(
        "background-color",
        "rgb(64, 54, 124)",
      );
    }
    if (id === "mac7")
      expect(
        await caption.evaluate((e) => getComputedStyle(e).backgroundImage),
      ).toContain("repeating-linear-gradient");
    await page
      .getByLabel("Title", { exact: true })
      .fill("Saved through " + id + " menu");
    await page
      .getByRole("button", { name: "Window file menu", exact: true })
      .click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/records/" + r.meta.id)).json())
            .meta.title,
      )
      .toBe("Saved through " + id + " menu");
    await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Window view menu", exact: true })
      .click();
    await page
      .locator(".retro-window-menu")
      .getByRole("button", { name: "Conversation", exact: true })
      .click();
    await expect(page.locator(".detail-tabs button.active")).toContainText(
      "Conversation",
    );
    await page
      .getByRole("button", { name: "Window view menu", exact: true })
      .click();
    await page
      .locator(".retro-window-menu")
      .getByRole("button", { name: "Details", exact: true })
      .click();
    await page.screenshot({ path: `/private/tmp/cr-retro-${id}-ticket.png` });
    await page
      .getByRole("button", { name: "Close ticket", exact: true })
      .click();
    await expect(page.locator(".record-dialog")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Keyboard shortcuts", exact: true })
      .click();
    await expect(page.locator(".shortcuts-dialog .dialog-top")).toBeVisible();
    await page
      .getByRole("button", { name: "Window file menu", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", { name: "Close window", exact: true })
      .click();
    await expect(page.locator(".shortcuts-dialog")).toHaveCount(0);
  }
  await theme(page, "light");
  await page
    .getByRole("button", { name: "Keyboard shortcuts", exact: true })
    .click();
  await expect(page.locator(".retro-window-menu")).toBeHidden();
  await page.getByRole("button", { name: "Close shortcuts" }).click();
});
test("C64 tracker keeps its palette and usable window controls on narrow screens", async ({
  page,
}) => {
  await theme(page, "c64");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-window-chrome",
    "c64",
  );
  await expect(page.locator(".topnav")).toHaveCSS(
    "background-color",
    "rgb(191, 192, 206)",
  );
  await expect(page.locator(".view-tab.active")).toHaveCSS(
    "background-color",
    "rgb(81, 70, 147)",
  );
  await page.screenshot({ path: "/private/tmp/cr-c64os-board.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "New ticket", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("C64 tracker mobile window");
  const dialog = page.locator(".record-dialog"),
    bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page
    .getByRole("button", { name: "Window file menu", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save and close", exact: true }),
  ).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Window file menu", exact: true }),
  ).toBeFocused();
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: "/private/tmp/cr-c64os-mobile.png" });
  await page.getByRole("button", { name: "Close ticket", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await theme(page, "dark");
  await expect(page.locator("html")).not.toHaveAttribute("data-window-chrome");
  await expect(page.locator(".topnav")).not.toHaveCSS(
    "background-color",
    "rgb(191, 192, 206)",
  );
});
test("hardware presets show chunky pixel headings and remain usable on narrow screens", async ({
  page,
}) => {
  for (const id of ["elektron", "gameboy"]) {
    await theme(page, id);
    await page.getByRole("button", { name: "New ticket", exact: true }).click();
    await page
      .getByLabel("Title", { exact: true })
      .fill("Pixel display review");
    await page.evaluate(() => document.fonts.ready);
    const title = page.getByLabel("Title", { exact: true });
    expect(
      await title.evaluate((e) => getComputedStyle(e).fontFamily),
    ).toContain("Silkscreen");
    expect(
      await page.evaluate(() => document.fonts.check('20px "Silkscreen"')),
    ).toBe(true);
    await page.screenshot({ path: `/private/tmp/cr-retro-${id}-ticket.png` });
    await page
      .getByRole("button", { name: "Create ticket", exact: true })
      .click();
    await expect(title).toHaveCount(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await theme(page, "mac7");
  await page.getByRole("button", { name: "New ticket", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Small retro window");
  const bounds = await page.locator(".record-dialog").boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page
    .getByRole("button", { name: "Window file menu", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save and close", exact: true }),
  ).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Window file menu", exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/private/tmp/cr-retro-mobile.png" });
  await page.getByRole("button", { name: "Close ticket", exact: true }).click();
  await expect(page.locator(".record-dialog")).toHaveCount(0);
});

test("retro screenshot menus save marks, retain failed saves, and keep the editor open on menu Escape", async ({
  page,
}) => {
  await theme(page, "amiga");
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 480;
    return c.toDataURL("image/png").split(",")[1];
  });
  const image = await (
    await page.request.post("/api/images", {
      data: { name: "Retro screenshot review", data: png },
    })
  ).json();
  await page.goto("/#image=" + image.id);
  await expect(page.locator(".annotation-dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Window view menu", exact: true })
    .click();
  await page
    .locator(".retro-window-menu")
    .getByRole("button", { name: "Pin", exact: true })
    .click();
  await page
    .locator(".image-canvas svg")
    .click({ position: { x: 100, y: 100 } });
  await page.getByLabel("Instruction / text").fill("Keep the mark aligned.");
  await page.route("**/api/images/" + image.id + "/annotations", (route) =>
    route.fulfill({ status: 503, json: { error: "Fixture save unavailable" } }),
  );
  await page
    .getByRole("button", { name: "Window file menu", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save and close", exact: true })
    .click();
  await expect(
    page.locator(".annotation-dialog > .banner.error"),
  ).toContainText("Fixture save unavailable");
  await expect(page.getByLabel("Instruction / text")).toHaveValue(
    "Keep the mark aligned.",
  );
  await page.unroute("**/api/images/" + image.id + "/annotations");
  await page
    .getByRole("button", { name: "Window file menu", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Window file menu", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Save and close", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: "/private/tmp/cr-retro-amiga-screenshot.png" });
  await page
    .getByRole("button", { name: "Window file menu", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save and close", exact: true })
    .click();
  await expect(page.locator(".annotation-dialog")).toHaveCount(0);
  const saved = await (
    await page.request.get("/api/images/" + image.id)
  ).json();
  expect(saved.annotations).toHaveLength(1);
  expect(JSON.stringify(saved.annotations)).toContain("Keep the mark aligned.");
});

// Keep a comparable board/ticket/mobile set for the five human references.
test("reference themes preserve readable boards and responsive ticket windows", async ({
  page,
}) => {
  for (const id of ["c64", "elektron", "snes", "synthwave", "gameboy"]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await theme(page, id);
    await page.screenshot({
      path: `/private/tmp/cr-reference-${id}-board.png`,
    });
    await page.getByRole("button", { name: "New ticket", exact: true }).click();
    await page
      .getByLabel("Title", { exact: true })
      .fill("Build a clearer project overview");
    await page.screenshot({
      path: `/private/tmp/cr-reference-${id}-ticket.png`,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await page.locator(".record-dialog").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await page
      .getByRole("button", { name: "Close ticket", exact: true })
      .focus();
    await expect(
      page.getByRole("button", { name: "Close ticket", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: `/private/tmp/cr-reference-${id}-mobile.png`,
    });
    await page
      .getByRole("button", { name: "Close ticket", exact: true })
      .click();
    await expect(page.locator(".record-dialog")).toHaveCount(0);
  }
});
