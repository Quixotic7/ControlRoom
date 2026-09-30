import { expect, test, type Page } from "@playwright/test";

const actor = { name: "Scrolling performance fixture", kind: "human" };

test.beforeEach(async ({ page }) => {
  const response = await page.request.get("/");
  expect(response.ok()).toBeTruthy();
  const preferences = await page.request.patch("/api/preferences", {
    data: { page: "project", viewId: "board", selected: null },
  });
  expect(preferences.ok()).toBeTruthy();
});

async function createTicket(
  page: Page,
  title: string,
  body = "",
  meta: Record<string, unknown> = {},
) {
  const response = await page.request.post("/api/records", {
    data: { kind: "ticket", meta: { title, ...meta }, body, actor },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function scrollFrames(page: Page, selector: string) {
  const scroller = page.locator(selector);
  await scroller.hover();
  const before = await scroller.evaluate((node) => node.scrollTop);
  await page.evaluate(() => {
    const sample = { running: true, frames: [] as number[] };
    (window as any).scrollSample = sample;
    let last = performance.now();
    function frame(now: number) {
      if (!sample.running) return;
      sample.frames.push(now - last);
      last = now;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(40);
  }
  await expect
    .poll(() => scroller.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(before + 500);
  return page.evaluate(() => {
    const sample = (window as any).scrollSample;
    sample.running = false;
    return sample.frames as number[];
  });
}

test("large ticket scrolling avoids per-event comment layout scans", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const ticket = await createTicket(page, "Long scrolling ticket");
  const responses = await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      page.request.post(`/api/records/${ticket.meta.id}/comments`, {
        data: {
          body: `Conversation entry ${index}\n\n${"Representative Markdown content. ".repeat(30)}`,
          actor,
        },
      }),
    ),
  );
  for (const response of responses) expect(response.ok()).toBeTruthy();

  await page.goto(`/#ticket=${ticket.meta.id}`);
  await page.getByRole("button", { name: /^Conversation/ }).click();
  await expect(page.locator(".comment")).toHaveCount(100);

  const commentLayoutReads = await page.evaluate(async () => {
    const original = Element.prototype.getBoundingClientRect;
    let reads = 0;
    Element.prototype.getBoundingClientRect = function () {
      if (this instanceof HTMLElement && this.classList.contains("comment"))
        reads++;
      return original.call(this);
    };
    const scroller = document.querySelector<HTMLElement>(".detail-body")!;
    for (let index = 0; index < 20; index++) {
      scroller.scrollTop += 180;
      scroller.dispatchEvent(new Event("scroll"));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
    Element.prototype.getBoundingClientRect = original;
    return reads;
  });
  expect(commentLayoutReads).toBe(0);

  const frames = await scrollFrames(page, ".detail-body");
  const ordered = frames.toSorted((a, b) => a - b);
  const p95 = ordered[Math.floor((ordered.length - 1) * 0.95)];
  await test.info().attach("ticket-scroll-to-frame.json", {
    body: JSON.stringify({ samples: frames.length, p95, max: ordered.at(-1) }),
    contentType: "application/json",
  });
  expect(p95).toBeLessThan(75);
});

test("large boards contain off-screen cards while retaining navigation", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const parent = await createTicket(page, "Scrollable board parent");
  const responses = await Promise.all(
    Array.from({ length: 120 }, (_, index) =>
      createTicket(
        page,
        `Scrollable board ticket ${String(index).padStart(3, "0")}`,
        "## Microtasks\n- [ ] One\n- [ ] Two\n- [ ] Three",
        { parent: parent.meta.id },
      ),
    ),
  );
  expect(responses).toHaveLength(120);

  await page.goto("/");
  const group = page.locator(".board-group").filter({
    has: page.getByRole("button", { name: /Scrollable board parent/ }),
  });
  const fixtureCards = group.locator(".ticket-card");
  await expect(fixtureCards).toHaveCount(120);
  const card = group.locator(".board-ticket").first();
  await expect(card).toHaveCSS("content-visibility", "auto");
  await expect(card).toHaveCSS("contain-intrinsic-size", /140px/);

  const frames = await scrollFrames(page, ".board-scroll");
  const ordered = frames.toSorted((a, b) => a - b);
  const p95 = ordered[Math.floor((ordered.length - 1) * 0.95)];
  await test.info().attach("board-scroll-to-frame.json", {
    body: JSON.stringify({ samples: frames.length, p95, max: ordered.at(-1) }),
    contentType: "application/json",
  });
  expect(p95).toBeLessThan(75);

  const first = fixtureCards.first();
  await first.focus();
  await first.press("ArrowDown");
  await expect(fixtureCards.nth(1)).toBeFocused();
});

for (const order of ["oldest", "newest"] as const) {
  test(`gradual scrolling keeps the reading position on incoming updates (${order})`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.request.patch("/api/preferences", {
      data: { conversationOrder: order },
    });
    const ticket = await createTicket(page, `Reading anchor ${order}`);
    for (let i = 0; i < 30; i++) {
      const response = await page.request.post(
        `/api/records/${ticket.meta.id}/comments`,
        {
          data: {
            body: `Entry ${i}\n\n${"Representative reading content. ".repeat(50)}`,
            actor,
          },
        },
      );
      expect(response.ok()).toBeTruthy();
    }
    await page.goto(`/#ticket=${ticket.meta.id}`);
    await page.getByRole("button", { name: /^Conversation/ }).click();
    await expect(page.locator(".comment")).toHaveCount(30);
    const scroller = page.locator(".detail-body");
    for (const tab of ["Conversation", "Details"]) {
      if (tab === "Details")
        await page.getByRole("button", { name: tab, exact: true }).click();
      await scroller.evaluate((node) => {
        node.scrollTop = 0;
      });
      await scroller.hover();
      for (let i = 0; i < 8; i++) {
        await page.mouse.wheel(0, 80);
        await page.waitForTimeout(60);
      }
      await expect
        .poll(() => scroller.evaluate((node) => node.scrollTop))
        .toBeGreaterThan(500);
      await page.waitForTimeout(100);
      const before = await scroller.evaluate((node) => {
        const viewport = node.getBoundingClientRect();
        const comment = [
          ...node.querySelectorAll<HTMLElement>(".comment"),
        ].find((el) => el.getBoundingClientRect().bottom > viewport.top + 30)!;
        return { id: comment.id, y: comment.getBoundingClientRect().y };
      });
      const body = `Incoming update during ${tab} ${order}`;
      const response = await page.request.post(
        `/api/records/${ticket.meta.id}/comments`,
        { data: { body, actor } },
      );
      expect(response.ok()).toBeTruthy();
      await expect(page.getByText(body, { exact: true })).toBeAttached();
      await page.waitForTimeout(150);
      const after = await page
        .locator(`[id="${before.id}"]`)
        .evaluate((node) => node.getBoundingClientRect().y);
      expect(Math.abs(after - before.y)).toBeLessThan(2);
    }
  });
}
