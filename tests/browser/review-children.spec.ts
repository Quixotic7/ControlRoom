import { test, expect, type Page } from "@playwright/test";
const actor = { name: "Browser reviewer", kind: "human" };
async function create(page: Page, title: string, extra = {}) {
  const r = await page.request.post("/api/records", {
    data: {
      kind: "ticket",
      meta: { title, ...extra },
      body: "Original prose",
      actor,
    },
  });
  expect(r.ok()).toBeTruthy();
  return r.json();
}
async function open(page: Page, id: string) {
  await page.goto("about:blank");
  await page.request.patch("/api/preferences", { data: { selected: id } });
  await page.goto("/");
  await expect(page.getByRole("dialog")).toBeVisible();
}
async function state(page: Page) {
  return (await page.request.get("/api/state")).json();
}
test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board" },
  });
  await page.goto("/");
});
test("review buttons save draft prose and accept only the parent", async ({
  page,
}) => {
  const p = await create(page, "Accept parent", {
    status: "review",
    handoff: "Keep handoff",
    evidence: "Keep evidence",
  });
  const c = await create(page, "Unfinished child", { parent: p.meta.id });
  await open(page, p.meta.id);
  await page
    .getByRole("button", { name: "Edit Markdown", exact: true })
    .click();
  await page.getByLabel("Markdown body").fill("My edited prose");
  await page
    .getByRole("button", { name: "Accept into Done", exact: true })
    .press("Enter");
  await page
    .getByRole("button", { name: "Confirm acceptance", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const s = await state(page);
  const saved = s.records.find((r: any) => r.meta.id === p.meta.id);
  expect(saved.meta.status).toBe("done");
  expect(saved.body).toBe("My edited prose");
  expect(saved.meta.handoff).toBe("Keep handoff");
  expect(s.records.find((r: any) => r.meta.id === c.meta.id).meta.status).toBe(
    "backlog",
  );
});
test("request changes retains feedback through stale conflicts and a lost response without duplication", async ({
  page,
}) => {
  const p = await create(page, "Request changes fixture", { status: "review" });
  await open(page, p.meta.id);
  await page
    .getByRole("button", { name: "Request changes", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Review feedback", exact: true })
    .fill("Please fix the keyboard flow");
  await expect(
    page.getByRole("button", { name: "Save feedback & return" }),
  ).toBeDisabled();
  await page
    .getByRole("combobox", { name: "Return to", exact: true })
    .selectOption("progress");
  await page.request.patch(`/api/records/${p.meta.id}`, {
    data: {
      revision: p.revision,
      patch: { title: "Changed by another reviewer" },
      actor,
    },
  });
  await page.getByRole("button", { name: "Save feedback & return" }).click();
  await expect(page.getByRole("alert")).toContainText("record changed");
  await expect(
    page.getByRole("textbox", { name: "Review feedback", exact: true }),
  ).toHaveValue("Please fix the keyboard flow");
  expect(
    (await state(page)).comments.filter((c: any) => c.ticket === p.meta.id),
  ).toHaveLength(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "History", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Review outcome" }),
  ).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Conversation/ })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Review feedback", exact: true }),
  ).toHaveValue("Please fix the keyboard flow");
  await page
    .getByRole("button", { name: "Reload current version", exact: true })
    .click();
  let lost = false;
  await page.route(
    `**/api/records/${p.meta.id}/review-outcome`,
    async (route) => {
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await page.getByRole("button", { name: "Save feedback & return" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Review feedback", exact: true }),
  ).toHaveValue("Please fix the keyboard flow");
  await page.getByRole("button", { name: "Save feedback & return" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const s = await state(page);
  expect(s.records.find((r: any) => r.meta.id === p.meta.id).meta.status).toBe(
    "progress",
  );
  const feedback = s.comments.filter((c: any) => c.ticket === p.meta.id);
  expect(feedback).toHaveLength(1);
  expect(feedback[0].body).toContain("Please fix the keyboard flow");
  expect(feedback[0].actor.kind).toBe("human");
});
test("custom review and Done columns are explicit and Failed Review is preferred", async ({
  page,
}) => {
  const original = await state(page);
  const columns = [
    ...original.config.columns,
    { id: "review-alt", name: "Design review", role: "review" },
    { id: "done-alt", name: "Released", role: "done" },
    { id: "failed-review", name: "Failed Review", role: "progress" },
  ];
  await page.request.patch("/api/config", {
    data: { revision: original.configRevision, patch: { columns } },
  });
  let p: any;
  try {
    p = await create(page, "Custom review fixture", { status: "review-alt" });
    await open(page, p.meta.id);
    await expect(
      page.getByRole("button", { name: "Accept into Done" }),
    ).toBeEnabled();
    await page.getByLabel("Done destination").selectOption("done-alt");
    await expect(
      page.getByRole("button", { name: "Accept into Done" }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Request changes", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Return to", exact: true }),
    ).toHaveValue("failed-review");
    await page
      .getByRole("textbox", { name: "Review feedback", exact: true })
      .fill("Adjust spacing");
    await page.screenshot({ path: "test-results/review-outcomes.png" });
    await page.getByRole("button", { name: "Save feedback & return" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const saved = (await state(page)).records.find(
      (r: any) => r.meta.id === p.meta.id,
    );
    expect(saved.meta.status).toBe("failed-review");
  } finally {
    if (p) {
      const current = (await state(page)).records.find(
        (r: any) => r.meta.id === p.meta.id,
      );
      await page.request.patch(`/api/records/${p.meta.id}`, {
        data: {
          revision: current.revision,
          patch: { status: "backlog" },
          actor,
        },
      });
    }
    const current = await state(page);
    await page.request.patch("/api/config", {
      data: {
        revision: current.configRevision,
        patch: { columns: original.config.columns },
      },
    });
  }
});
test("child quick entry creates numbered children repeatedly, retaining input on failure", async ({
  page,
}) => {
  const p = await create(page, "Quick parent fixture");
  await open(page, p.meta.id);
  const input = page.getByRole("textbox", {
    name: "New ticket in child tickets",
    exact: true,
  });
  await expect(input).toBeVisible();
  await input.fill("   ");
  await input.press("Enter");
  expect(
    (await state(page)).records.filter((r: any) => r.meta.parent === p.meta.id),
  ).toHaveLength(0);
  let requests = 0;
  await page.route("**/api/records", async (route) => {
    if (route.request().method() === "POST") {
      requests++;
      if (requests === 1) {
        await route.fulfill({ status: 503, json: { error: "Try again" } });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await route.continue();
  });
  await input.fill("First child");
  await input.press("Enter");
  await expect(page.locator(".quick-ticket-error")).toContainText("Try again");
  await expect(input).toHaveValue("First child");
  await input.press("Enter");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await input.fill("Second child");
  await input.press("Enter");
  await expect(page.locator(".child-ticket")).toHaveCount(2);
  await expect(input).toBeFocused();
  const children = (await state(page)).records.filter(
    (r: any) => r.meta.parent === p.meta.id,
  );
  expect(children).toHaveLength(2);
  expect(
    children.every(
      (r: any) =>
        r.meta.status === "backlog" && Number.isInteger(r.meta.number),
    ),
  ).toBeTruthy();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: "test-results/quick-children.png" });
});
test("new parents save first and a failed parent save retains the child title", async ({
  page,
}) => {
  await page.getByRole("button", { name: "New ticket", exact: true }).click();
  const input = page.getByRole("textbox", {
    name: "New ticket in child tickets",
    exact: true,
  });
  await input.fill("Child of new parent");
  await input.press("Enter");
  await expect(page.locator(".quick-ticket-error")).toContainText(
    "Save the parent successfully",
  );
  await expect(input).toHaveValue("Child of new parent");
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Saved new parent fixture");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(page.locator(".child-ticket")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toBeVisible();
  const s = await state(page);
  const p = s.records.find(
    (r: any) => r.meta.title === "Saved new parent fixture",
  );
  const child = s.records.find(
    (r: any) => r.meta.title === "Child of new parent",
  );
  expect(child.meta.parent).toBe(p.meta.id);
  expect(child.meta.number).toBe(p.meta.number + 1);
});
