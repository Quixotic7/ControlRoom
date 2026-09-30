import { test, expect, type Page } from "@playwright/test";

const actor = { name: "Progress test", kind: "human" };

async function create(page: Page, title: string, meta = {}, body = "") {
  return (
    await page.request.post("/api/records", {
      data: { kind: "ticket", meta: { title, ...meta }, body, actor },
    })
  ).json();
}

test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board" },
  });
});

test("ticket progress bars separate microtasks and all direct child tickets", async ({
  page,
}) => {
  const suffix = Date.now();
  const parent = await create(
    page,
    `Progress parent ${suffix}`,
    {},
    "## Microtasks\n- [x] Draft\n- [ ] Publish\n",
  );
  await create(page, `Completed child ${suffix}`, {
    parent: parent.meta.id,
    status: "done",
  });
  // It is hidden from a normal board view, but remains a direct child in the
  // progress total and is not complete just because it is archived.
  await create(page, `Archived open child ${suffix}`, {
    parent: parent.meta.id,
    archived: true,
  });

  const many = await create(
    page,
    `Progress large parent ${suffix}`,
    {},
    "## Microtasks\n" +
      Array.from({ length: 40 }, (_, i) => `- [x] Task ${i}`).join("\n"),
  );
  await create(page, `Open large child ${suffix}`, { parent: many.meta.id });

  await page.goto("/");
  const group = page.locator(".group-header", { hasText: parent.meta.title });
  await expect(
    group.getByRole("progressbar", {
      name: "Microtasks progress: 1 of 2 complete",
    }),
  ).toBeVisible();
  await expect(
    group.getByRole("progressbar", {
      name: "Child tickets progress: 1 of 2 complete",
    }),
  ).toBeVisible();

  const largeGroup = page.locator(".group-header", {
    hasText: many.meta.title,
  });
  const half = group.getByRole("progressbar", {
    name: "Microtasks progress: 1 of 2 complete",
  });
  const full = largeGroup.getByRole("progressbar", {
    name: "Microtasks progress: 40 of 40 complete",
  });
  await expect(full).toBeVisible();
  expect((await half.boundingBox())!.width).toBe(
    (await full.boundingBox())!.width,
  );
  await expect(half.locator(".ticket-progress-cell")).toHaveCount(0);
  const fillRatio = (bar: typeof half) =>
    bar.evaluate(
      (el) =>
        el.firstElementChild!.getBoundingClientRect().width /
        el.getBoundingClientRect().width,
    );
  expect(await fillRatio(half)).toBeCloseTo(0.5);
  expect(await fillRatio(full)).toBe(1);
  expect(
    await fillRatio(
      largeGroup.getByRole("progressbar", {
        name: "Child tickets progress: 0 of 1 complete",
      }),
    ),
  ).toBe(0);

  await group.locator(".group-goal").click();
  const detail = page.getByRole("dialog");
  await expect(
    detail.getByRole("progressbar", {
      name: "Microtasks progress: 1 of 2 complete",
    }),
  ).toBeVisible();
  await expect(
    detail.getByRole("progressbar", {
      name: "Child tickets progress: 1 of 2 complete",
    }),
  ).toBeVisible();
  await detail.getByRole("button", { name: "Close ticket" }).click();

  await page.getByRole("button", { name: "Table", exact: true }).click();
  const row = page.locator("tr", { hasText: parent.meta.title });
  await expect(
    row.getByRole("progressbar", {
      name: "Child tickets progress: 1 of 2 complete",
    }),
  ).toBeVisible();
});
