import { test, expect, type Page } from "@playwright/test";

const actor = { name: "Annotation performance fixture", kind: "human" };
async function openImage(page: Page, dense = false) {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board" },
  });
  await page.goto("/");
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 6240;
    canvas.height = 3548;
    return canvas.toDataURL("image/png");
  });
  const response = await page.request.post("/api/images", {
    data: { name: `Annotation latency ${test.info().title}`, data },
  });
  expect(response.ok()).toBeTruthy();
  let image = await response.json();
  const annotations = dense
    ? Array.from({ length: 40 }, (_, i) => ({
        id: `dense-${i}`,
        type: "draw",
        x: 0.1,
        y: 0.1 + i / 60,
        points: Array.from({ length: 1500 }, (_, j) => [
          0.1 + j / 2000,
          0.1 + i / 60 + Math.sin(j / 30) / 100,
        ]),
        text: `Stroke ${i}`,
        resolved: false,
        actor,
      }))
    : [];
  if (dense) {
    const saved = await page.request.put(
      `/api/images/${image.id}/annotations`,
      {
        data: { revision: image.revision, annotations, actor },
      },
    );
    expect(saved.ok()).toBeTruthy();
    image = await saved.json();
  }
  await page.getByRole("button", { name: "Screenshots", exact: true }).click();
  await page.getByLabel("Search screenshots").fill(image.name);
  await page.locator(".screenshot-card").click();
  await expect(page.getByAltText("Screenshot being annotated")).toBeVisible();
  await expect(page.locator(".annotation-note")).toHaveCount(
    annotations.length,
  );
  return image;
}

async function startMeasurement(page: Page, eventName: string) {
  await page.evaluate((name) => {
    const win = window as any;
    win.annotationLatency = [];
    win.annotationSerializations = 0;
    const stringify = JSON.stringify;
    JSON.stringify = function (value: any, ...args: any[]) {
      if (Array.isArray(value) && value.some((v) => v?.points?.length >= 1500))
        win.annotationSerializations++;
      return (stringify as any)(value, ...args);
    } as typeof JSON.stringify;
    window.addEventListener(
      name,
      () => {
        const start = performance.now();
        // Run after the editor's own queued drawing frame as well.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            win.annotationLatency.push(performance.now() - start);
          }),
        );
      },
      { capture: true },
    );
  }, eventName);
}
async function measurement(page: Page, label: string) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const result = await page.evaluate(() => {
    const values = (window as any).annotationLatency.toSorted(
      (a: number, b: number) => a - b,
    );
    return {
      count: values.length,
      p95: values[Math.floor((values.length - 1) * 0.95)],
      serializations: (window as any).annotationSerializations,
    };
  });
  console.log(label, result);
  await test.info().attach(label, {
    body: JSON.stringify(result),
    contentType: "application/json",
  });
  return result;
}

test("dense screenshot stays responsive while typing and drawing, then saves unchanged geometry", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const image = await openImage(page, true);
  await page.locator(".annotation-note").first().click();
  const text = page.getByLabel("Instruction / text");
  await text.click();
  await text.press("End");
  await startMeasurement(page, "keydown");
  const sample = " responsive annotation text";
  await text.pressSequentially(sample, { delay: 20 });
  await expect(text).toHaveValue("Stroke 0" + sample);
  const typing = await measurement(page, "typing");

  await page
    .getByRole("toolbar", { name: "Annotation tools" })
    .getByRole("button", { name: "Draw", exact: false })
    .click();
  const canvas = (await page.locator(".image-canvas").boundingBox())!;
  await page.mouse.move(
    canvas.x + canvas.width * 0.2,
    canvas.y + canvas.height * 0.5,
  );
  await page.mouse.down();
  await startMeasurement(page, "pointermove");
  await page.mouse.move(
    canvas.x + canvas.width * 0.8,
    canvas.y + canvas.height * 0.6,
    { steps: 30 },
  );
  await page.mouse.up();
  const drawing = await measurement(page, "drawing");
  await expect(page.locator(".annotation-note")).toHaveCount(41);
  await page
    .getByRole("button", { name: "Save screenshot", exact: true })
    .click();
  await expect(page.locator(".annotation-dialog")).toHaveCount(0);
  const saved = await (
    await page.request.get(`/api/images/${image.id}`)
  ).json();
  expect(saved.annotations.slice(1, 40)).toEqual(image.annotations.slice(1));
  expect(saved.annotations[0]).toEqual({
    ...image.annotations[0],
    text: "Stroke 0" + sample,
  });
  expect(saved.annotations[40].points.length).toBeGreaterThanOrEqual(31);
  expect(saved.annotations[40].points.at(-1)[0]).toBeCloseTo(0.8, 3);
  expect(saved.annotations[40].points.at(-1)[1]).toBeCloseTo(0.6, 3);
  await page.locator(".screenshot-card").click();
  await expect(page.locator(".annotation-note")).toHaveCount(41);
  const preview = await page.request.get(`/api/images/${image.id}/preview`);
  expect(preview.ok()).toBeTruthy();
  const png = await preview.body();
  expect(png.readUInt32BE(16)).toBe(6240);
  expect(png.readUInt32BE(20)).toBe(3548);
  for (const result of [typing, drawing]) {
    expect(result.count).toBeGreaterThan(20);
    // A two-frame budget with headroom for CI, guarding the reported input lag.
    expect(result.p95).toBeLessThan(75);
    // Input must not walk/serialize every saved drawing on every event.
    expect(result.serializations).toBe(0);
  }
});

test("pending stroke samples survive cancellation, undo, redo, movement and keyboard save", async ({
  page,
}) => {
  const image = await openImage(page);
  const svg = page.getByRole("img", {
    name: "Editable screenshot annotations",
  });
  const canvas = (await page.locator(".image-canvas").boundingBox())!;
  const x = canvas.x + canvas.width * 0.2,
    y = canvas.y + canvas.height * 0.3;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Dispatch a burst within one JS turn, then cancel before the queued frame.
  await svg.evaluate(
    (element, { x, y }) => {
      for (let i = 1; i <= 20; i++)
        element.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            pointerId: 1,
            clientX: x + i,
            clientY: y + i,
            buttons: 1,
          }),
        );
      // A second pointer must neither replace the active stroke nor receive its samples.
      const capture = element.setPointerCapture;
      element.setPointerCapture = () => {};
      element.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 99,
          clientX: x + 80,
          clientY: y + 80,
          button: 0,
        }),
      );
      element.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 99,
          clientX: x + 90,
          clientY: y + 90,
          buttons: 1,
        }),
      );
      element.setPointerCapture = capture;
      element.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }),
      );
    },
    { x, y },
  );
  await page.mouse.up();
  const path = await svg.locator("g path").getAttribute("d");
  expect(path!.match(/L/g)).toHaveLength(20);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".annotation-note")).toHaveCount(0);
  await page.getByRole("button", { name: "Close annotation editor" }).click();
  // Undo back to the saved empty image does not falsely warn about unsaved work.
  await expect(page.locator(".annotation-dialog")).toHaveCount(0);
  await page.locator(".screenshot-card").click();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 20, { steps: 10 });
  await page.mouse.up();
  const original = await svg.locator("g path").getAttribute("d");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(svg.locator("g path")).toHaveAttribute("d", original!);
  await page
    .getByRole("button", { name: "Select / move", exact: false })
    .click();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 25, y + 15);
  await page.mouse.up();
  await expect(svg.locator("g path")).not.toHaveAttribute("d", original!);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(svg.locator("g path")).toHaveAttribute("d", original!);
  await page.getByLabel("Instruction / text").fill("Keep this instruction");
  await page.getByRole("button", { name: "Close annotation editor" }).click();
  await expect(
    page.getByRole("button", { name: "Keep editing" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await page.getByLabel("Instruction / text").press("Control+s");
  await expect(page.locator(".annotation-dialog")).toHaveCount(0);
  const saved = await (
    await page.request.get(`/api/images/${image.id}`)
  ).json();
  expect(saved.annotations[0].text).toBe("Keep this instruction");
  expect(saved.annotations[0].points).toHaveLength(11);
  expect(saved.annotations[0].x).toBeCloseTo(0.2, 3);
});

test("closing flushes a pending move before checking saved state", async ({
  page,
}) => {
  await openImage(page);
  await page
    .getByRole("toolbar", { name: "Annotation tools" })
    .getByRole("button", { name: "Text", exact: false })
    .click();
  const svg = page.getByRole("img", {
    name: "Editable screenshot annotations",
  });
  const canvas = (await page.locator(".image-canvas").boundingBox())!;
  const x = canvas.x + canvas.width * 0.2,
    y = canvas.y + canvas.height * 0.3;
  await page.mouse.click(x, y);
  await page.getByLabel("Instruction / text").fill("Visible on the image");
  await expect(svg.locator("g text").last()).toHaveText("Visible on the image");
  const originalX = await svg.locator("g circle").getAttribute("cx");
  await page
    .getByRole("button", { name: "Save annotations", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save annotations", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Select / move", exact: false })
    .click();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await svg.evaluate(
    (element, { x, y }) => {
      element.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 1,
          clientX: x + 30,
          clientY: y + 20,
          buttons: 1,
        }),
      );
      // Native dialog cancellation, before requestAnimationFrame has a chance to run.
      element
        .closest("dialog")!
        .dispatchEvent(new Event("cancel", { cancelable: true }));
    },
    { x, y },
  );
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "Keep editing" }),
  ).toBeVisible();
  await expect(svg.locator("g circle")).not.toHaveAttribute("cx", originalX!);
  await page.getByRole("button", { name: "Keep editing" }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Close annotation editor" }).click();
  await expect(page.locator(".annotation-dialog")).toHaveCount(0);
});
