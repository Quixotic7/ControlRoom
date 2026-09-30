import { test, expect, type Page } from "@playwright/test";

const actor = { name: "Screenshot reviewer", kind: "human" };
test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board" },
  });
  await page.goto("/");
});
async function openTicket(page: Page, id: string) {
  await page.goto(`/#ticket=${id}`);
  await expect(page.locator(".record-dialog")).toBeVisible();
}
async function image(page: Page, name: string) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1800;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#19343c";
    ctx.fillRect(0, 0, 2400, 1800);
    ctx.strokeStyle = "#40636a";
    for (let x = 0; x < 2400; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 1800);
      ctx.stroke();
    }
    ctx.fillStyle = "#fff";
    ctx.font = "30px sans-serif";
    ctx.fillText("Inspect the original pixels", 900, 900);
    return canvas.toDataURL("image/png");
  });
  const response = await page.request.post("/api/images", {
    data: { name, data },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function library(page: Page, name: string) {
  await page.getByRole("button", { name: "Screenshots", exact: true }).click();
  await page.getByLabel("Search screenshots").fill(name);
}

test("existing descriptions preview by default while empty tickets stay editable", async ({
  page,
}) => {
  const r = await (
    await page.request.post("/api/records", {
      data: {
        kind: "ticket",
        meta: { title: "Preview default" },
        body: "## Existing outcome\n\nKeep **formatting** and custom prose.",
        actor,
      },
    })
  ).json();
  await openTicket(page, r.meta.id);
  await expect(
    page.getByRole("heading", { name: "Existing outcome" }),
  ).toBeVisible();
  await expect(page.getByLabel("Markdown body")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Edit Markdown", exact: true })
    .click();
  await page
    .getByLabel("Markdown body")
    .fill(r.body + "\n\nAdditional detail.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".record-dialog")).toHaveCount(0);
  await openTicket(page, r.meta.id);
  await expect(
    page.getByText("Additional detail.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit Markdown", exact: true })
    .click();
  await page.getByLabel("Markdown body").fill(" ");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".record-dialog")).toHaveCount(0);
  await openTicket(page, r.meta.id);
  await expect(page.getByLabel("Markdown body")).toBeVisible();
});

test("screenshots can be deleted, restored, and still opened from linked tickets", async ({
  page,
}) => {
  const asset = await image(page, "Trash roundtrip");
  const ticket = await (
    await page.request.post("/api/records", {
      data: {
        kind: "ticket",
        meta: { title: "Linked trash", attachments: [asset.id] },
        body: "",
        actor,
      },
    })
  ).json();
  await library(page, asset.name);
  await expect(
    page.getByRole("button", { name: "Delete screenshot", exact: true }),
  ).toHaveCount(0);
  await page.locator(".screenshot-card").click();
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "Delete screenshot", exact: true })
    .click();
  await expect(page.locator(".annotation-dialog")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete screenshot", exact: true })
    .click();
  await expect(page.locator(".screenshot-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(page.locator(".screenshot-card")).toHaveCount(1);
  const stale = await page.request.put(`/api/images/${asset.id}/trash`, {
    data: { revision: asset.revision, trashed: false, actor },
  });
  expect(stale.status()).toBe(409);
  await page.locator(".screenshot-card").click();
  await expect(page.getByText(/This screenshot is in Trash/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save screenshot", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Restore screenshot", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("button", { name: "Save screenshot", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Close annotation editor" }).click();
  await expect(page.locator(".screenshot-card")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Back to screenshots", exact: true })
    .click();
  await expect(page.locator(".screenshot-card")).toHaveCount(1);
  expect(
    (await (await page.request.get(`/api/records/${ticket.meta.id}`)).json())
      .meta.attachments,
  ).toEqual([asset.id]);
});

test("permanent deletion freezes selected and full-Trash scope with explicit results", async ({
  page,
}) => {
  // The browser server shares a disposable project across tests. Restore
  // earlier fixtures so this confirmation has a known, exact Trash scope.
  const state = await (await page.request.get("/api/state")).json();
  for (const asset of state.attachments.filter(
    (item: { trashedAt?: string; permanentlyDeletedAt?: string }) =>
      item.trashedAt && !item.permanentlyDeletedAt,
  )) {
    const restored = await page.request.put(`/api/images/${asset.id}/trash`, {
      data: { revision: asset.revision, trashed: false, actor },
    });
    expect(restored.ok()).toBeTruthy();
  }
  const alpha = await image(page, "Permanent alpha"),
    hidden = await image(page, "Permanent hidden");
  const ticket = await (
    await page.request.post("/api/records", {
      data: {
        kind: "ticket",
        meta: { title: "Permanent deletion link", attachments: [alpha.id] },
        body: `[![Screenshot](/api/images/${alpha.id}/base)](#image=${alpha.id})`,
        actor,
      },
    })
  ).json();
  for (const asset of [alpha, hidden])
    expect(
      (
        await page.request.put(`/api/images/${asset.id}/trash`, {
          data: { revision: asset.revision, trashed: true, actor },
        })
      ).ok(),
    ).toBeTruthy();

  await library(page, alpha.name);
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByLabel("Interface density").selectOption("comfortable");
  await page.keyboard.press("Escape");
  await expect(page.locator(".app-shell")).toHaveClass(/comfortable/);
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page
    .getByRole("button", { name: "Select screenshots", exact: true })
    .click();
  await page.getByLabel(`Select ${alpha.name}`).check();
  await page
    .getByRole("button", { name: "Delete permanently (1)", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Delete permanently" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(alpha.name, { exact: true })).toBeVisible();
  await expect(dialog.getByText(hidden.name, { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/images/${alpha.id}`)).json())
      .permanentlyDeletedAt,
  ).toBeUndefined();

  await page
    .getByRole("button", { name: "Delete permanently (1)", exact: true })
    .click();
  const currentAlpha = await (
    await page.request.get(`/api/images/${alpha.id}`)
  ).json();
  await page.request.put(`/api/images/${alpha.id}/trash`, {
    data: { revision: currentAlpha.revision, trashed: false, actor },
  });
  await dialog
    .getByRole("button", { name: "Delete 1 permanently", exact: true })
    .click();
  await expect(dialog.getByText(/0 confirmed deleted; 1 remain/)).toBeVisible();
  await expect(dialog.getByText(/no longer in Trash/)).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".screenshot-card")).toHaveCount(0);

  const restoredAlpha = await (
    await page.request.get(`/api/images/${alpha.id}`)
  ).json();
  await page.request.put(`/api/images/${alpha.id}/trash`, {
    data: { revision: restoredAlpha.revision, trashed: true, actor },
  });
  await page.reload();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page.getByLabel("Search screenshots").fill(alpha.name);
  await expect(page.locator(".screenshot-card")).toHaveCount(1);
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByLabel("Interface density").selectOption("compact");
  await page.keyboard.press("Escape");
  await expect(page.locator(".app-shell")).toHaveClass(/compact/);
  await page
    .getByRole("button", { name: "Empty Trash (2)", exact: true })
    .click();
  const emptyDialog = page.getByRole("dialog", { name: "Empty Trash" });
  await expect(emptyDialog.getByText(/entire Trash/)).toBeVisible();
  await expect(
    emptyDialog.getByText(alpha.name, { exact: true }),
  ).toBeVisible();
  await expect(
    emptyDialog.getByText(hidden.name, { exact: true }),
  ).toBeVisible();

  const late = await image(page, "Trashed after preview");
  await page.request.put(`/api/images/${late.id}/trash`, {
    data: { revision: late.revision, trashed: true, actor },
  });
  await expect(emptyDialog.getByText(late.name, { exact: true })).toHaveCount(
    0,
  );
  await page.setViewportSize({ width: 390, height: 800 });
  await expect
    .poll(async () => (await emptyDialog.boundingBox())?.width ?? 1000)
    .toBeLessThanOrEqual(358);
  await emptyDialog
    .getByRole("button", { name: "Delete 2 permanently", exact: true })
    .click();
  await expect(
    emptyDialog.getByText(/2 confirmed deleted; 0 remain/),
  ).toBeVisible();
  await emptyDialog.getByRole("button", { name: "Close", exact: true }).click();

  const alphaDeleted = await (
    await page.request.get(`/api/images/${alpha.id}`)
  ).json();
  const lateStillTrashed = await (
    await page.request.get(`/api/images/${late.id}`)
  ).json();
  expect(alphaDeleted.permanentlyDeletedAt).toBeTruthy();
  expect(lateStillTrashed.trashedAt).toBeTruthy();
  expect(lateStillTrashed.permanentlyDeletedAt).toBeUndefined();
  const placeholder = await page.request.get(`/api/images/${alpha.id}/base`);
  expect(placeholder.ok()).toBeTruthy();
  expect(placeholder.headers()["content-type"]).toContain("image/svg+xml");
  expect(
    (await (await page.request.get(`/api/records/${ticket.meta.id}`)).json())
      .meta.attachments,
  ).toEqual([alpha.id]);

  await openTicket(page, ticket.meta.id);
  await expect(
    page.getByText(
      "Screenshot permanently deleted · written annotations preserved",
    ),
  ).toBeVisible();
});

test("zoom and pan preserve source coordinates through export and reopening", async ({
  page,
}) => {
  const asset = await image(page, "Zoom viewport");
  await library(page, asset.name);
  await page.locator(".screenshot-card").click();
  const canvas = page.locator(".image-canvas");
  const stage = page.getByLabel("Screenshot viewport");
  await expect(page.getByAltText("Screenshot being annotated")).toBeVisible();
  await page.getByRole("button", { name: "100%", exact: true }).click();
  await expect(page.getByLabel("Image zoom")).toHaveText("100%");
  expect((await canvas.boundingBox())!.width).toBeCloseTo(2400, 0);
  const b = (await stage.boundingBox())!;
  const point = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await page.getByRole("button", { name: "Pin", exact: false }).click();
  await page.mouse.click(point.x, point.y);
  await page
    .getByLabel("Instruction / text")
    .fill("Inspect this precise point");
  await page
    .getByRole("button", { name: "Save annotations", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save annotations", exact: true }),
  ).toBeEnabled();
  const saved = await (
    await page.request.get(`/api/images/${asset.id}`)
  ).json();
  expect(saved.annotations).toHaveLength(1);
  expect(saved.annotations[0].x).toBeCloseTo(0.5, 2);
  expect(saved.annotations[0].y).toBeCloseTo(0.5, 2);
  await stage.focus();
  const before = (await canvas.boundingBox())!;
  await page.keyboard.down("Space");
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 110, point.y + 70);
  await page.mouse.up();
  await page.keyboard.up("Space");
  const after = (await canvas.boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(110, 0);
  expect(after.y - before.y).toBeCloseTo(70, 0);
  await expect(page.locator(".annotation-note")).toHaveCount(1);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -180);
  await expect
    .poll(async () => (await canvas.boundingBox())!.width)
    .toBeGreaterThan(2400);
  const zoomed = (await canvas.boundingBox())!;
  expect((point.x - zoomed.x) / zoomed.width).toBeCloseTo(
    (point.x - after.x) / after.width,
    3,
  );
  // Marks created while zoomed and panned still use source-image coordinates.
  await page.mouse.click(point.x, point.y);
  await expect(page.locator(".annotation-note")).toHaveCount(2);
  const marked = page
    .locator(".image-canvas svg g[data-note]")
    .last()
    .locator("circle");
  expect(Number(await marked.getAttribute("cx")) / asset.width).toBeCloseTo(
    (point.x - zoomed.x) / zoomed.width,
    3,
  );
  expect(Number(await marked.getAttribute("cy")) / asset.height).toBeCloseTo(
    (point.y - zoomed.y) / zoomed.height,
    3,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  for (const method of ["middle", "hand"]) {
    if (method === "hand")
      await page.getByRole("button", { name: /Pan/, exact: false }).click();
    const start = (await canvas.boundingBox())!;
    await page.mouse.move(point.x, point.y);
    await page.mouse.down({ button: method === "middle" ? "middle" : "left" });
    await page.mouse.move(point.x - 40, point.y - 30);
    await page.mouse.up({ button: method === "middle" ? "middle" : "left" });
    const end = (await canvas.boundingBox())!;
    expect(end.x - start.x).toBeCloseTo(-40, 0);
    expect(end.y - start.y).toBeCloseTo(-30, 0);
    await expect(page.locator(".annotation-note")).toHaveCount(1);
  }
  await page.screenshot({ path: "test-results/screenshot-zoom.png" });
  await page
    .getByRole("button", { name: "Save screenshot", exact: true })
    .click();
  await expect(page.locator(".annotation-dialog")).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/images/${asset.id}`)).json())
      .annotations,
  ).toEqual(saved.annotations);
  const preview = await page.request.get(`/api/images/${asset.id}/preview`);
  const bytes = await preview.body();
  expect(bytes.readUInt32BE(16)).toBe(2400);
  expect(bytes.readUInt32BE(20)).toBe(1800);
  await page.locator(".screenshot-card").click();
  await expect(page.locator(".annotation-note")).toHaveCount(1);
  await page.getByRole("button", { name: "Fit image", exact: true }).click();
  const fitted = (await canvas.boundingBox())!;
  const bounds = (await stage.boundingBox())!;
  expect(fitted.width).toBeLessThan(bounds.width);
  expect(fitted.height).toBeLessThan(bounds.height);
  await page.setViewportSize({ width: 1050, height: 800 });
  await expect
    .poll(async () => (await canvas.boundingBox())!.height)
    .toBeLessThan(fitted.height);
  await page.screenshot({ path: "test-results/screenshot-fit.png" });
});
