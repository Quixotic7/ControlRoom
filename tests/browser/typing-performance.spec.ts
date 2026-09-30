import { test, expect, type Page } from "@playwright/test";

const actor = { name: "Typing performance fixture", kind: "human" };
const sample = " responsive typing sample";

async function measureKeyToFrame(page: Page, label: string) {
  await page.evaluate(() => {
    (window as any).keyToFrame = [];
    const target = document.activeElement;
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.target !== target || event.key.length !== 1) return;
        const started = performance.now();
        requestAnimationFrame(() => {
          (window as any).keyToFrame.push(performance.now() - started);
        });
      },
      { capture: true },
    );
  });
  await page.keyboard.type(sample, { delay: 20 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const durations = await page.evaluate<number[]>(() =>
    (window as any).keyToFrame.slice(),
  );
  expect(durations.length).toBe(sample.length);
  const ordered = durations.toSorted((a, b) => a - b);
  const p95 = ordered[Math.floor((ordered.length - 1) * 0.95)];
  await test.info().attach(`${label}-key-to-frame.json`, {
    body: JSON.stringify({
      samples: durations.length,
      p95,
      max: ordered.at(-1),
    }),
    contentType: "application/json",
  });
  // This deliberately leaves room for a slow CI frame while guarding against
  // the reported approximately 100 ms key-to-render regression.
  expect(p95).toBeLessThan(75);
}

test("title and description stay responsive on a large ticket without per-key activation", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const ticket = await (
    await page.request.post("/api/records", {
      data: {
        kind: "ticket",
        meta: { title: "Large editable ticket" },
        body: "Existing description.",
        actor,
      },
    })
  ).json();
  await Promise.all([
    ...Array.from({ length: 80 }, (_, index) =>
      page.request.post("/api/records", {
        data: {
          kind: "ticket",
          meta: { title: `Performance board record ${index}` },
          body: "Representative board data.",
          actor,
        },
      }),
    ),
    ...Array.from({ length: 80 }, (_, index) =>
      page.request.post(`/api/records/${ticket.meta.id}/comments`, {
        data: {
          body: `Conversation entry ${index}\n\n${"Long project context. ".repeat(20)}`,
          actor,
        },
      }),
    ),
  ]);

  let activations = 0;
  await page.route("**/api/active", async (route) => {
    activations++;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto(`/#ticket=${ticket.meta.id}`);
  await expect(page.locator(".comment")).toHaveCount(80);

  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.click();
  const titleActivation = activations;
  await measureKeyToFrame(page, "title");
  await expect(title).toBeFocused();
  expect(activations).toBe(titleActivation);

  await page.getByRole("button", { name: "Edit Markdown" }).click();
  const description = page.getByRole("textbox", { name: "Markdown body" });
  await description.click();
  const descriptionActivation = activations;
  await measureKeyToFrame(page, "description");
  await expect(description).toBeFocused();
  expect(activations).toBe(descriptionActivation);

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".record-dialog")).toHaveCount(0);
  const saved = await (
    await page.request.get(`/api/records/${ticket.meta.id}`)
  ).json();
  expect(saved.meta.title).toBe(`Large editable ticket${sample}`);
  expect(saved.body).toBe(`Existing description.${sample}`);
});
