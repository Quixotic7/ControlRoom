import { test, expect, type Page } from "@playwright/test";
const actor = { name: "Human", kind: "human" },
  agent = { name: "Test agent", kind: "agent" };
async function create(
  page: Page,
  title: string,
  meta = {},
  body = "Custom prose\n\n## Acceptance criteria\n- [ ] Keep this criterion\n",
) {
  const r = await page.request.post("/api/records", {
    data: { kind: "ticket", meta: { title, ...meta }, body, actor },
  });
  expect(r.ok()).toBeTruthy();
  return r.json();
}
const get = async (page: Page, id: string) =>
  (await page.request.get("/api/records/" + id)).json();
async function open(page: Page, id: string) {
  await page.goto("/#ticket=" + id);
  await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board", theme: "dark" },
  });
});
test("microtasks retain focus, preserve prose, reorder, save and render on cards", async ({
  page,
}) => {
  const r = await create(page, "Microtask browser fixture");
  await open(page, r.meta.id);
  const add = page.getByLabel("Add microtask");
  await add.fill("One small step");
  await add.press("Enter");
  await expect(add).toBeFocused();
  await add.fill("Second step");
  await add.press("Enter");
  await page
    .getByLabel("Microtask 1", { exact: true })
    .fill("Renamed first step");
  await page.getByLabel("Complete microtask 1", { exact: true }).check();
  await page.getByLabel("Move microtask 2 up", { exact: true }).click();
  await expect(page.getByLabel("Microtask 1", { exact: true })).toHaveValue(
    "Second step",
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveCount(0);
  const saved = await get(page, r.meta.id);
  expect(saved.body).toContain("- [x] Renamed first step");
  expect(saved.body).toContain("- [ ] Keep this criterion");
  expect(saved.meta.status).toBe("backlog");
  await open(page, r.meta.id);
  await page.getByLabel("Remove microtask 1", { exact: true }).click();
  await page.getByRole("button", { name: "Close ticket", exact: true }).click();
  await open(page, r.meta.id);
  await expect(page.getByLabel("Microtask 1", { exact: true })).toHaveValue(
    "Renamed first step",
  );
});
test("questionnaire drafts survive refresh and require explicit answers; edits conflict and history remains", async ({
  page,
}) => {
  const r = await create(page, "Questionnaire browser fixture");
  const questions = [
    {
      id: "style",
      prompt: "Which treatment?",
      type: "choice",
      choices: ["Quiet", "Bright"],
      recommended: "Quiet",
    },
    { id: "reason", prompt: "Explain the choice", type: "text" },
  ];
  const q = await (
    await page.request.post(`/api/records/${r.meta.id}/questionnaires`, {
      data: { questions, actor: agent },
    })
  ).json();
  await open(page, r.meta.id);
  await expect(
    page.getByRole("button", { name: "Submit answers", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Quiet (recommended)", exact: true })
    .click();
  await page
    .getByLabel("Answer: Explain the choice")
    .fill("A draft I can return to");
  await page.reload();
  await expect(page.getByLabel("Answer: Explain the choice")).toHaveValue(
    "A draft I can return to",
  );
  expect((await get(page, r.meta.id)).meta.status).toBe("backlog");
  const edited = await page.request.post(
    `/api/records/${r.meta.id}/questionnaires`,
    {
      data: {
        questions: [
          { ...questions[0], prompt: "Updated treatment?" },
          questions[1],
        ],
        actor: agent,
        replacing: { id: q.id, revision: q.revision },
      },
    },
  );
  expect(edited.ok()).toBeTruthy();
  await expect(
    page.getByRole("button", { name: "I reviewed the updated questions" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit answers", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "I reviewed the updated questions" })
    .click();
  await page
    .getByRole("button", { name: "Submit answers", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Submit answers", exact: true }),
  ).toHaveCount(0);
  const c = await (
    await page.request.get(`/api/records/${r.meta.id}/context`)
  ).json();
  expect(
    c.comments.find((i: any) => i.id === q.id).answers[0].values.reason,
  ).toBe("A draft I can return to");
  expect(c.comments.find((i: any) => i.id === q.id).resolved).toBeTruthy();
  await page.getByRole("button", { name: /^Conversation/ }).click();
  const submitted = page.getByLabel("Submitted answers");
  await expect(submitted).toContainText("A draft I can return to");
  await expect(submitted).toContainText("Explain the choice");
  await expect(page.getByLabel("Answer: Explain the choice")).toHaveValue(
    "A draft I can return to",
  );
  await page
    .getByRole("button", { name: "Reopen questionnaire", exact: true })
    .click();
  await expect(page.getByLabel("Answer: Explain the choice")).toHaveValue(
    "A draft I can return to",
  );
  await expect(
    page.getByRole("button", { name: "Submit amended answers", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Answer: Updated treatment?").fill("Custom purple");
  await page.getByLabel("Answer: Explain the choice").fill("Amended rationale");
  await page
    .getByRole("button", { name: "Submit amended answers", exact: true })
    .click();
  await expect
    .poll(async () => {
      const c = await (
        await page.request.get(`/api/records/${r.meta.id}/context`)
      ).json();
      return c.comments.find((i: any) => i.id === q.id).answers.length;
    })
    .toBe(2);
  await expect(page.getByLabel("Submitted answers")).toContainText(
    "Amended rationale",
  );
});
test("all theme presets persist, preserve page state and offer legible token contrast", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Filter tickets").fill("theme state");
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  const ids = [
    "win95",
    "win31",
    "c64",
    "mac7",
    "amiga",
    "nes",
    "snes",
    "synthwave",
    "elektron",
    "gameboy",
  ];
  for (const id of ids) {
    await page.getByLabel("Color theme").selectOption(id);
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    await expect(page.getByLabel("Filter tickets")).toHaveValue("theme state");
    const contrast = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      function lum(v: string) {
        const x = v.trim().replace("#", "");
        const c = [0, 2, 4]
          .map((i) => parseInt(x.slice(i, i + 2), 16) / 255)
          .map((v) =>
            v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
          );
        return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
      }
      const a = lum(s.getPropertyValue("--ink")),
        b = lum(s.getPropertyValue("--surface")),
        m = lum(s.getPropertyValue("--muted"));
      return Math.min(
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        (Math.max(m, b) + 0.05) / (Math.min(m, b) + 0.05),
      );
    });
    expect(contrast, id).toBeGreaterThanOrEqual(4.5);
  }
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "gameboy");
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByLabel("Color theme").selectOption("system");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await page.emulateMedia({ colorScheme: "light" });
  expect(
    await page.locator("html").evaluate((e) => getComputedStyle(e).colorScheme),
  ).toBe("light");
  await page.emulateMedia({ colorScheme: "dark" });
  expect(
    await page.locator("html").evaluate((e) => getComputedStyle(e).colorScheme),
  ).toBe("dark");
});
test("drag preview is local, supports before/after and cancellation, with keyboard ordering", async ({
  page,
}) => {
  const a = await create(page, "Drag fixture A", { order: 10 }),
    b = await create(page, "Drag fixture B", { order: 20 }),
    c = await create(page, "Drag fixture C", { order: 30 });
  await page.goto("/");
  await page.getByLabel("Filter tickets").fill("Drag fixture");
  const source = page.locator(`.ticket-card[data-id="${a.meta.id}"]`),
    target = page.locator(`.ticket-card[data-id="${c.meta.id}"]`);
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent("dragstart", { dataTransfer: dt });
  const box = (await target.boundingBox())!;
  await target.dispatchEvent("dragover", {
    dataTransfer: dt,
    clientY: box.y + box.height - 2,
  });
  await expect(target).toHaveClass(/insert-after/);
  expect((await get(page, a.meta.id)).revision).toBe(a.revision);
  await page.keyboard.press("Escape");
  await expect(target).not.toHaveClass(/insert-after/);
  expect((await get(page, a.meta.id)).revision).toBe(a.revision);
  await source.dispatchEvent("dragstart", { dataTransfer: dt });
  await target.dispatchEvent("dragover", {
    dataTransfer: dt,
    clientY: box.y + box.height - 2,
  });
  await expect(target).toHaveClass(/insert-after/);
  await target.dispatchEvent("drop", { dataTransfer: dt });
  await expect
    .poll(async () => (await get(page, a.meta.id)).meta.order)
    .toBeGreaterThan(30);
  await expect(page.locator(".ticket-card").last()).toHaveAttribute(
    "data-id",
    a.meta.id,
  );
  await source.focus();
  await source.press("Alt+ArrowUp");
  await expect
    .poll(async () => (await get(page, a.meta.id)).meta.order)
    .toBeLessThan(30);
});
test("reported estimates, expired claims and reduced motion remain honest", async ({
  page,
}) => {
  const r = await create(page, "Progress browser fixture", {
    status: "progress",
    progress: {
      note: "Reviewing outputs",
      percent: 45,
      at: new Date().toISOString(),
      actor: agent,
    },
  });
  await page.route("**/api/state", async (route) => {
    const response = await route.fetch(),
      state = await response.json();
    const item = state.records.find((i: any) => i.meta.id === r.meta.id);
    item.meta.progress.at = "2020-01-01T00:00:00.000Z";
    state.claims.push({
      ticket: r.meta.id,
      actor: agent,
      worktree: "/example",
      expiresAt: "2020-01-01T00:00:00.000Z",
      reportedAt: "2020-01-01T00:00:00.000Z",
    });
    await route.fulfill({ response, json: state });
  });
  await open(page, r.meta.id);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/45% estimate/)).toBeVisible();
  await expect(dialog.getByText(/In Progress · .* elapsed/)).toBeVisible();
  await expect(
    dialog.getByRole("meter", { name: "Reported progress estimate" }),
  ).toHaveAttribute("aria-valuenow", "45");
  await expect(dialog.getByText(/Expired claim · Test agent/)).toBeVisible();
  await expect(dialog.getByText(/stale report/)).toBeVisible();
  await expect(dialog.locator(".recent-report")).toHaveCount(0);
  await page.unroute("**/api/state");
  await page.reload();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(dialog.locator(".recent-report")).toHaveCount(1);
  expect(
    await dialog
      .locator(".recent-report > span")
      .first()
      .evaluate((e) => getComputedStyle(e, "::before").animationName),
  ).toBe("none");
});

test("table insertion preview rejects stale targets and supports keyboard ordering", async ({
  page,
}) => {
  const a = await create(page, "Table drag fixture A", { order: 10 }),
    b = await create(page, "Table drag fixture B", { order: 20 });
  await page.goto("/");
  await page.getByLabel("Filter tickets").fill("Table drag fixture");
  await page.getByRole("button", { name: "View options", exact: true }).click();
  await page
    .locator(".view-options")
    .getByRole("button", { name: "Table", exact: true })
    .click();
  await page.getByLabel("Sort by").selectOption("manual");
  await page.keyboard.press("Escape");
  const source = page.locator(`tr[data-id="${a.meta.id}"]`),
    target = page.locator(`tr[data-id="${b.meta.id}"]`);
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await source
    .locator(".ticket-link")
    .dispatchEvent("dragstart", { dataTransfer: dt });
  let box = (await target.boundingBox())!;
  await target.dispatchEvent("dragover", {
    dataTransfer: dt,
    clientY: box.y + 1,
  });
  await expect(target).toHaveClass(/insert-before/);
  const changed = await page.request.patch(`/api/records/${b.meta.id}`, {
    data: {
      revision: b.revision,
      patch: { title: "Table drag fixture B changed" },
      actor,
    },
  });
  expect(changed.ok()).toBeTruthy();
  await target.dispatchEvent("drop", { dataTransfer: dt });
  await expect(page.getByText(/order changed/i)).toBeVisible();
  expect((await get(page, a.meta.id)).revision).toBe(a.revision);
  await source
    .locator(".ticket-link")
    .dispatchEvent("dragstart", { dataTransfer: dt });
  box = (await target.boundingBox())!;
  await target.dispatchEvent("dragover", {
    dataTransfer: dt,
    clientY: box.y + box.height - 1,
  });
  await expect(target).toHaveClass(/insert-after/);
  await target.dispatchEvent("drop", { dataTransfer: dt });
  await expect
    .poll(async () => (await get(page, a.meta.id)).meta.order)
    .toBeGreaterThan(20);
  await expect(page.locator("tr[data-id]").last()).toHaveAttribute(
    "data-id",
    a.meta.id,
  );
  await source.locator(".ticket-link").focus();
  await source.locator(".ticket-link").press("Alt+ArrowUp");
  await expect
    .poll(async () => (await get(page, a.meta.id)).meta.order)
    .toBeLessThan(20);
});

test("theme pages remain usable and representative layouts can be visually reviewed", async ({
  page,
}) => {
  await page.goto("/");
  for (const theme of ["win95", "c64", "synthwave", "gameboy"]) {
    await page
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    await page.getByLabel("Color theme").selectOption(theme);
    await page.keyboard.press("Escape");
    for (const name of [
      "Decisions",
      "Rulebook",
      "Screenshots",
      "Insights",
      "Project",
    ]) {
      await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("button", { name, exact: true })
        .click();
      await expect(page.locator("main")).toBeVisible();
    }
    await page.screenshot({
      path: `/private/tmp/cr-theme-${theme}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByLabel("Color theme").selectOption("mac7");
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: "/private/tmp/cr-theme-mobile.png",
    fullPage: true,
  });
});

test("cross-parent drag is invalid and leaving a drag target clears its preview", async ({
  page,
}) => {
  const parent = await create(page, "Drag goal fixture");
  const child = await create(page, "Restricted drag child", {
      parent: parent.meta.id,
    }),
    other = await create(page, "Restricted drag other");
  await page.goto("/");
  await page.getByLabel("Filter tickets").fill("Restricted drag");
  const source = page.locator(`.ticket-card[data-id="${child.meta.id}"]`),
    target = page.locator(`.ticket-card[data-id="${other.meta.id}"]`),
    dt = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent("dragstart", { dataTransfer: dt });
  const box = (await target.boundingBox())!;
  await target.dispatchEvent("dragover", {
    dataTransfer: dt,
    clientY: box.y + 2,
  });
  await expect(target).not.toHaveClass(/insert-/);
  await target.dispatchEvent("drop", { dataTransfer: dt });
  expect((await get(page, child.meta.id)).revision).toBe(child.revision);
  await source.dispatchEvent("dragend", { dataTransfer: dt });
});
