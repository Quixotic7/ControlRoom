import { expect, test, type Page } from "@playwright/test";

const actor = { name: "Review media fixture", kind: "human" };
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";

function wav() {
  const sampleRate = 8_000;
  const samples = sampleRate;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    bytes.writeInt16LE(
      Math.round(Math.sin((i / sampleRate) * Math.PI * 440) * 8_000),
      44 + i * 2,
    );
  return bytes.toString("base64");
}

async function createTicket(page: Page) {
  const created = await page.request.post("/api/records", {
    data: {
      kind: "ticket",
      meta: {
        title: `Review media ${Date.now()}`,
        status: "review",
        reviewInstructions: "Listen to the clip and inspect the screenshot.",
      },
      body: "Review fixture",
      actor,
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const ticket = await created.json();
  const attached = await page.request.post(
    `/api/records/${ticket.meta.id}/media`,
    {
      data: {
        revision: ticket.revision,
        actor,
        files: [
          { name: "review.png", data: png, caption: "Expected layout" },
          { name: "tone.wav", data: wav(), caption: "Expected sound" },
        ],
      },
    },
  );
  expect(attached.ok(), await attached.text()).toBe(true);
  return await (
    await page.request.get(`/api/records/${ticket.meta.id}`)
  ).json();
}

for (const standalone of [false, true]) {
  test(`review media renders in ${standalone ? "standalone" : "ticket"} review`, async ({
    page,
  }) => {
    await page.request.get("/");
    const ticket = await createTicket(page);
    const image = ticket.meta.media.find(
      (item: { kind: string }) => item.kind === "image",
    );
    const audio = ticket.meta.media.find(
      (item: { kind: string }) => item.kind === "audio",
    );
    expect(image).toBeTruthy();
    expect(audio).toBeTruthy();

    if (standalone)
      await page.route(
        `**/api/records/${ticket.meta.id}/context`,
        async (route) => {
          const response = await route.fetch();
          const context = await response.json();
          await route.fulfill({
            response,
            contentType: "application/json",
            body: JSON.stringify({
              ...context,
              media: [
                {
                  ...image,
                  source: {
                    id: ticket.meta.id,
                    number: ticket.meta.number,
                    title: ticket.meta.title,
                  },
                  missing: false,
                },
                {
                  ...audio,
                  source: {
                    id: "merged-source",
                    number: 42,
                    title: "Merged evidence",
                  },
                  missing: false,
                },
                {
                  id: "audio-missing",
                  kind: "audio",
                  name: "removed.wav",
                  caption: "Keep this fallback instruction",
                  at: audio.at,
                  actor,
                  source: {
                    id: "merged-source",
                    number: 42,
                    title: "Merged evidence",
                  },
                  missing: true,
                },
              ],
            }),
          });
        },
      );

    await page.goto(
      `/${standalone ? "?ticketOnly=1" : ""}#ticket=${ticket.meta.id}`,
    );
    const review = page.getByRole("region", { name: "What to review" });
    await expect(
      review.getByRole("region", { name: "Review media" }),
    ).toBeVisible();
    await expect(review).toContainText("Attached to this ticket");
    if (standalone) {
      await expect(review).toContainText("From merged #42: Merged evidence");
      await expect(review).toContainText(
        "Audio unavailable locally · removed.wav",
      );
      await expect(review).toContainText("Keep this fallback instruction");
    }
    await expect(
      review.getByText("Expected layout", { exact: true }),
    ).toBeVisible();
    await expect(
      review.getByText("Expected sound", { exact: true }),
    ).toBeVisible();

    const clip = review.getByLabel("Review audio tone.wav");
    await expect
      .poll(() =>
        clip.evaluate((node: HTMLAudioElement) => node.readyState >= 1),
      )
      .toBe(true);
    expect(await clip.evaluate((node: HTMLAudioElement) => node.autoplay)).toBe(
      false,
    );
    await expect
      .poll(() => clip.evaluate((node: HTMLAudioElement) => node.duration))
      .toBeGreaterThan(0.9);
    await clip.evaluate((node: HTMLAudioElement) => {
      node.currentTime = 0.5;
    });
    await expect
      .poll(() => clip.evaluate((node: HTMLAudioElement) => node.currentTime))
      .toBeGreaterThan(0.4);

    await clip.evaluate(async (node: HTMLAudioElement) => {
      node.muted = true;
      await node.play();
    });
    const beforePlayback = await clip.evaluate(
      (node: HTMLAudioElement) => node.currentTime,
    );
    await expect
      .poll(() => clip.evaluate((node: HTMLAudioElement) => node.currentTime))
      .toBeGreaterThan(beforePlayback + 0.08);
    await clip.evaluate((node: HTMLAudioElement) => node.pause());

    if (!standalone)
      await page.screenshot({
        path: "/private/tmp/cr90-review-media.png",
        fullPage: true,
      });

    if (!standalone) {
      const beforeAttach = await (
        await page.request.get(`/api/records/${ticket.meta.id}`)
      ).json();
      const append = await page.request.post(
        `/api/records/${ticket.meta.id}/media`,
        {
          data: {
            revision: beforeAttach.revision,
            actor,
            files: [{ name: "later.png", data: png }],
          },
        },
      );
      expect(append.ok(), await append.text()).toBe(true);
      await expect(review.getByText("later.png", { exact: true })).toBeVisible({
        timeout: 10_000,
      });
      const beforeDetach = await (
        await page.request.get(`/api/records/${ticket.meta.id}`)
      ).json();
      const later = beforeDetach.meta.media.find(
        (item: { name: string }) => item.name === "later.png",
      );
      const detach = await page.request.delete(
        `/api/records/${ticket.meta.id}/media/${later.id}`,
        { data: { revision: beforeDetach.revision, actor } },
      );
      expect(detach.ok(), await detach.text()).toBe(true);
      await expect(review.getByText("later.png", { exact: true })).toHaveCount(
        0,
        { timeout: 10_000 },
      );
    }

    await review
      .getByRole("button", { name: "Open review image review.png" })
      .click();
    await expect(page.locator(".annotation-dialog")).toBeVisible();
  });
}
