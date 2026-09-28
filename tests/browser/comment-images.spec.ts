import { test, expect } from "@playwright/test";
const actor = { name: "Review fixture", kind: "human" };
for (const standalone of [false, true]) {
  test(`typing preserves comment images and scroll in ${standalone ? "standalone" : "modal"} tickets`, async ({
    page,
  }) => {
    await page.request.get("/");
    await page.request.patch("/api/preferences", {
      data: {
        page: "project",
        selected: null,
        theme: "dark",
        conversationOrder: "oldest",
      },
    });
    await page.goto("/");
    const data = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 480;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#6953ab";
      ctx.fillRect(0, 0, 640, 480);
      return c.toDataURL("image/png").split(",")[1];
    });
    const image = await (
      await page.request.post("/api/images", {
        data: { name: "Typing regression image", data },
      })
    ).json();
    const ticket = await (
      await page.request.post("/api/records", {
        data: {
          kind: "ticket",
          meta: { title: "Stable image conversation" },
          body: "Typing must not remount existing Markdown images.",
          actor,
        },
      })
    ).json();
    const markdown = `[![Typing regression image](/api/images/${image.id}/base)](#image=${image.id})`;
    for (let i = 0; i < 3; i++) {
      const response = await page.request.post(
        `/api/records/${ticket.meta.id}/comments`,
        { data: { body: `Screenshot ${i}\n\n${markdown}`, actor } },
      );
      expect(response.ok()).toBe(true);
    }
    // Exercise both annotated-preview success and persistent base fallback.
    let requests = 0;
    await page.route(`**/api/images/${image.id}/preview`, async (route) => {
      requests++;
      if (standalone)
        await route.fulfill({ status: 404, body: "No preview yet" });
      else
        await route.fulfill({
          contentType: "image/png",
          body: Buffer.from(data, "base64"),
        });
    });
    await page.goto(
      `/${standalone ? "?ticketOnly=1" : ""}#ticket=${ticket.meta.id}`,
    );
    for (const tab of ["Details", "Conversation"]) {
      await page
        .locator(".detail-tabs")
        .getByRole("button", { name: new RegExp(`^${tab}`) })
        .click();
      const imgs = page.locator(".comment .inline-image img");
      await expect(imgs).toHaveCount(3);
      for (const img of await imgs.all()) {
        await img.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            img.evaluate(
              (e: HTMLImageElement) => e.complete && e.naturalWidth > 0,
            ),
          )
          .toBe(true);
      }
      const editor = page.getByLabel("Add to the conversation");
      await editor.scrollIntoViewIfNeeded();
      await editor.click();
      await page.evaluate(() => {
        const images = Array.from(document.querySelectorAll(".comment img"));
        (window as any).typingImages = images;
        (window as any).imageRemovals = 0;
        const observer = new MutationObserver(() => {
          if (images.some((e) => !e.isConnected))
            (window as any).imageRemovals++;
        });
        observer.observe(document.querySelector(".conversation")!, {
          childList: true,
          subtree: true,
        });
      });
      const beforeRequests = requests;
      const top = await page
        .locator(".detail-body")
        .evaluate((e) => e.scrollTop);
      await editor.pressSequentially(
        "Typing stays in place with image comments.",
        { delay: 15 },
      );
      await expect(editor).toBeFocused();
      await expect(editor).toBeInViewport();
      expect(await page.evaluate(() => (window as any).imageRemovals)).toBe(0);
      expect(
        await page.evaluate(() =>
          (window as any).typingImages.every(
            (e: Element, i: number) =>
              e === document.querySelectorAll(".comment img")[i],
          ),
        ),
      ).toBe(true);
      expect(requests).toBe(beforeRequests);
      expect(
        Math.abs(
          (await page.locator(".detail-body").evaluate((e) => e.scrollTop)) -
            top,
        ),
      ).toBeLessThan(2);
      await editor.fill("");
    }
    await page
      .getByLabel("Add to the conversation")
      .fill("Images stayed stable.");
    await page
      .getByRole("button", { name: "Post comment", exact: true })
      .click();
    await expect(page.locator(".comment").last()).toContainText(
      "Images stayed stable.",
    );
    await page.locator(".comment .inline-image").first().click();
    await expect(page.locator(".annotation-dialog")).toBeVisible();
  });
}
