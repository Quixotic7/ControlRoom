import { test, expect } from "@playwright/test";

for (const [density, width, height] of [
  ["comfortable", 1440, 800],
  ["compact", 390, 700],
] as const) {
  test(`long Needs you lists remain reachable at ${width}px (${density})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.request.get("/");
    await page.request.patch("/api/preferences", {
      data: { selected: null, page: "attention", density, knowledgeRead: 0 },
    });
    const actor = { name: "Scroll fixture", kind: "human" };
    let ticket: any;
    for (let index = 0; index < 30; index++) {
      const response = await page.request.post("/api/records", {
        data: {
          actor,
          kind: "ticket",
          meta: {
            title: `Scroll fixture ${width}: review ${index}`,
            status: "review",
          },
          body: "A long attention list must keep this ticket reachable.",
        },
      });
      expect(response.ok()).toBe(true);
      ticket = await response.json();
    }
    // Read-only fixture receipts exercise the section below the list without
    // enabling orchestration or granting delegation in the browser project.
    await page.route("**/api/state", async (route) => {
      const response = await route.fetch(),
        state = await response.json();
      state.delegation = {
        grant: null,
        revision: "scroll-fixture",
        receipts: [
          {
            schema: 1,
            id: "delegated-action-scroll-fixture",
            revision: "fixture",
            action: "approve_scope",
            scope: "approveScope",
            grantRevision: "fixture",
            at: new Date().toISOString(),
            actor: { name: "Chat fixture", kind: "agent" },
            grantingHuman: actor,
            basis: {
              quote: "Approve this test ticket.",
              saidAt: new Date().toISOString(),
            },
            targets: [
              {
                kind: "record",
                id: ticket.meta.id,
                title: ticket.meta.title,
                beforeRevision: "before",
                afterRevision: "after",
              },
            ],
          },
        ],
      };
      await route.fulfill({ response, json: state });
    });
    await page.goto("/?page=attention");
    const main = page.locator(".main-content"),
      list = main.locator(".list-panel").first();
    await expect
      .poll(() => list.locator(".list-row").count())
      .toBeGreaterThanOrEqual(30);
    // All rows must fit inside the panel itself. Merely existing in the DOM,
    // or programmatically scrolling a hidden-overflow panel, is insufficient.
    const layout = await list.evaluate((panel) => {
      const last = panel.lastElementChild!.getBoundingClientRect();
      return {
        bottom: last.bottom,
        panelBottom: panel.getBoundingClientRect().bottom,
      };
    });
    expect(layout.bottom).toBeLessThanOrEqual(layout.panelBottom + 1);
    await main.hover({ position: { x: 12, y: 120 } });
    await page.mouse.wheel(0, 100000);
    const digest = page.getByRole("region", { name: "Done on your behalf" });
    await expect(
      digest.getByRole("button", { name: "Undo", exact: true }),
    ).toBeInViewport();
    const knowledge = main.locator(".list-panel").last();
    await expect(knowledge.locator(".list-row").last()).toBeInViewport();
    const last = list.locator(".list-row").last();
    const title = await last.locator("strong").innerText();
    // Keyboard focus must bring the last ticket into the page's viewport.
    await last.focus();
    await expect(last).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(title);
    await page
      .getByRole("button", { name: "Close ticket", exact: true })
      .click();
  });
}
