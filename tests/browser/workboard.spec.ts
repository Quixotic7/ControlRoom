import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: {
      selected: null,
      page: "project",
      viewId: "board",
      density: "comfortable",
    },
  });
  await page.goto("/");
});
// Opens a column's "+ Add item" and returns its title input.
async function addItem(page: Page, lane: string) {
  await page
    .getByRole("button", { name: `Add item to ${lane}`, exact: true })
    .click();
  return page.getByRole("textbox", {
    name: `New ticket in ${lane}`,
    exact: true,
  });
}
async function moreActions(page: Page) {
  await page.getByRole("button", { name: "More actions" }).click();
}

test("quick entry creates tickets in their swimlane with an optional longer description", async ({
  page,
}) => {
  const input = await addItem(page, "A calmer customer experience / Backlog");
  await input.fill("   ");
  await input.press("Enter");
  await expect(input).toHaveValue("   ");
  await input.fill("Build feature X");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let state = await (await page.request.get("/api/state")).json();
  const ticket = state.records.find(
    (r: any) => r.meta.title === "Build feature X",
  );
  const parent = state.records.find(
    (r: any) => r.meta.title === "A calmer customer experience",
  );
  expect(ticket.meta.parent).toBe(parent.meta.id);
  expect(ticket.meta.status).toBe("backlog");
  expect(ticket.body.trim()).toBe("");
  await input.fill("Build feature Y");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  const ungrouped = await addItem(page, "No parent goal / Backlog");
  await ungrouped.fill("Independent idea");
  await ungrouped.press("Enter");
  await expect(ungrouped).toHaveValue("");
  await page
    .locator(".ticket-card")
    .filter({ hasText: "Build feature X" })
    .click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Build feature X",
  );
  await expect(
    page.getByRole("heading", { name: "Description", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Markdown body")
    .fill("A longer explanation of the outcome and why it matters.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  state = await (await page.request.get("/api/state")).json();
  expect(
    state.records.find((r: any) => r.meta.id === ticket.meta.id).body,
  ).toContain("A longer explanation");
  expect(
    state.records.find((r: any) => r.meta.title === "Independent idea").meta
      .parent,
  ).toBeNull();
});

test("external Markdown changes appear and document imports require review", async ({
  page,
}) => {
  const state = await (await page.request.get("/api/state")).json();
  const record = await (
    await page.request.post("/api/records", {
      data: {
        kind: "ticket",
        meta: { title: "External edit example" },
        body: "Preserve this body.",
        actor: { name: "Browser test", kind: "human" },
      },
    })
  ).json();
  const file = path.join(state.canonical, ".workboard", record.path);
  const source = fs.readFileSync(file, "utf8");
  fs.writeFileSync(
    file,
    source.replace(/^title:.*$/m, "title: Externally edited task"),
  );
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(
    page.locator(".ticket-card").filter({ hasText: "Externally edited task" }),
  ).toHaveCount(1, { timeout: 10000 });
  const notes = path.join(state.canonical, "design-notes.md");
  fs.writeFileSync(notes, "# Design notes\nUse clear action labels.\n");
  await moreActions(page);
  await page
    .getByRole("button", { name: "Import project knowledge", exact: false })
    .click();
  await page
    .getByRole("checkbox", { name: "design-notes.md", exact: true })
    .check();
  await page.getByRole("button", { name: "Prepare agent briefing" }).click();
  await expect(
    page.getByRole("heading", { name: "Briefing ready" }),
  ).toBeVisible();
  await page.locator(".import-layout input[type=file]").setInputFiles({
    name: "proposals.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify([
        {
          kind: "decision",
          title: "Use explicit action labels",
          body: "## Why\nMake intent clear.",
          references: ["design-notes.md"],
        },
      ]),
    ),
  });
  await expect(page.locator(".proposal")).toHaveCount(1);
  let latest = await (await page.request.get("/api/state")).json();
  expect(
    latest.records.some(
      (r: any) => r.meta.title === "Use explicit action labels",
    ),
  ).toBe(false);
  await page.getByLabel("Select proposal Use explicit action labels").check();
  await page.getByRole("button", { name: "Import selected proposals" }).click();
  await expect(page.locator(".proposal .tag.green")).toContainText("Imported");
  latest = await (await page.request.get("/api/state")).json();
  expect(
    latest.records.find(
      (r: any) => r.meta.title === "Use explicit action labels",
    ).meta.status,
  ).toBe("proposed");
  expect(fs.readFileSync(notes, "utf8")).toBe(
    "# Design notes\nUse clear action labels.\n",
  );
});
test("board, filtering, task editing, and persistent density", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const board = page.getByRole("button", { name: "Board", exact: true });
  await expect(board).toHaveAttribute("aria-current", "page");
  await expect(
    page.locator(".group-goal").filter({
      hasText: "A calmer customer experience",
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/board-desktop.png",
    fullPage: true,
  });
  const filter = page.getByLabel("Filter tickets");
  await filter.fill("Preserve search");
  await expect(page.locator(".board-cell .ticket-card")).toHaveCount(1);
  await page.locator(".board-cell .ticket-card").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Preserve search between all views");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Field syntax, then save it as the view's filter.
  await filter.fill("label:navigation -status:done");
  await expect(page.locator(".board-cell .ticket-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save view", exact: true }),
  ).toHaveCount(0);
  const state = await (await page.request.get("/api/state")).json();
  expect(state.config.views.find((v: any) => v.id === "board").filter).toBe(
    "label:navigation -status:done",
  );
  await page.reload();
  await expect(filter).toHaveValue("label:navigation -status:done");
  await filter.fill("");
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await moreActions(page);
  await page.getByLabel("Interface density").selectOption("compact");
  await page.reload();
  await expect(page.locator(".app-shell.compact")).toHaveCount(1);
  await moreActions(page);
  await expect(page.getByLabel("Interface density")).toHaveValue("compact");
  await page.getByLabel("Interface density").selectOption("comfortable");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Table", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const status = page.getByLabel(
    "Status of Preserve search between all views",
    { exact: true },
  );
  await status.focus();
  await expect(status).toBeFocused();
  // Native macOS select popups are outside headless Chromium's keyboard surface.
  await status.selectOption("backlog");
  await expect(status).toHaveValue("backlog");
  await status.blur();
  await page.keyboard.press("n");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close ticket" }).click();
  expect(errors).toEqual([]);
});
test("create a ticket, discuss it, and submit evidence for review", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("button", { name: "New ticket", exact: false }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Browser acceptance ticket");
  await page
    .getByLabel("Markdown body")
    .fill("## Outcome\nA verified workflow.");
  await page
    .getByRole("button", { name: "Create ticket", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .locator(".ticket-card")
    .filter({ hasText: "Browser acceptance ticket" })
    .click();
  await page
    .getByRole("button", { name: "Conversation", exact: false })
    .click();
  await page
    .getByLabel("Add to the conversation")
    .fill("Does the new workflow preserve the notes?");
  await page.getByLabel("Comment type").selectOption("question");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(
    page.getByText("Does the new workflow preserve the notes?"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resolve question" }).click();
  await page.getByRole("button", { name: "Details", exact: true }).click();
  await page
    .getByText("Agent handoff, review & dependencies", { exact: true })
    .click();
  await page
    .getByLabel("Current handoff")
    .fill("Implemented and ready to inspect.");
  await page
    .getByLabel("Verification evidence")
    .fill("Browser workflow passed.");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const reviewed = await (await page.request.get("/api/state")).json();
  expect(
    reviewed.records.find(
      (r: any) => r.meta.title === "Browser acceptance ticket",
    ).meta.status,
  ).toBe("review");
});
test("knowledge views, import preview, and mobile layout", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Decisions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Project decisions" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Rulebook", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "One primary action per form" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/rulebook.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  // The board scrolls inside its own area; the page itself never does.
  await page.getByRole("button", { name: "Project", exact: true }).click();
  await expect(page.locator(".board")).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});
test("draw, comment, undo, save, and reopen screenshot annotations", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1000;
    c.height = 600;
    const x = c.getContext("2d")!;
    x.fillStyle = "#f3f5f1";
    x.fillRect(0, 0, 1000, 600);
    x.fillStyle = "#263d31";
    x.font = "32px sans-serif";
    x.fillText("Find a customer", 80, 100);
    x.fillStyle = "#fff";
    x.fillRect(80, 140, 820, 70);
    x.strokeStyle = "#cad4cb";
    x.strokeRect(80, 140, 820, 70);
    x.fillStyle = "#345f47";
    x.fillRect(110, 240, 180, 55);
    x.fillStyle = "#fff";
    x.font = "22px sans-serif";
    x.fillText("Go", 175, 276);
    return c.toDataURL("image/png").split(",")[1];
  });
  await moreActions(page);
  await page.locator(".menu-file input").setInputFiles({
    name: "search-feedback.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(page.locator(".annotation-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Box", exact: false }).click();
  const area = page.locator(".image-canvas svg");
  const box = await area.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width * 0.07,
    box!.y + box!.height * 0.38,
  );
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width * 0.31,
    box!.y + box!.height * 0.53,
    { steps: 5 },
  );
  await page.mouse.up();
  await page
    .getByLabel("Instruction / text")
    .fill("Align this button with the field above.");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Instruction / text")).toHaveValue("");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByLabel("Instruction / text")).toHaveValue(
    "Align this button with the field above.",
  );
  await page
    .getByRole("button", { name: "Save annotations", exact: true })
    .click();
  await expect(page.locator(".annotation-dialog .banner.error")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/annotations.png",
    fullPage: true,
  });
  await page
    .getByText("Attach to a ticket (optional)", { exact: true })
    .click();
  await page.getByLabel("New ticket title").fill("Annotated search alignment");
  await page
    .getByRole("button", { name: "Save to ticket", exact: true })
    .click();
  await expect(page.locator(".annotation-dialog")).toHaveCount(0);
  await page.getByLabel("Filter tickets").fill("Annotated search alignment");
  await page.locator(".ticket-card").click();
  await page.locator(".attachment").click();
  await expect(page.locator(".annotation-note")).toContainText(
    "Align this button with the field above.",
  );
  await page.getByRole("button", { name: "Close annotation editor" }).click();
  await page.getByRole("button", { name: "Close ticket" }).click();
});

test("every column supports quick entry and children appear under their parent", async ({
  page,
}) => {
  const state = await (await page.request.get("/api/state")).json();
  for (const column of state.config.columns) {
    const entry = await addItem(
      page,
      `A calmer customer experience / ${column.name}`,
    );
    await entry.fill(`Quick ${column.name}`);
    await entry.press("Enter");
    await expect(entry).toHaveValue("");
    await entry.press("Escape");
  }
  const latest = await (await page.request.get("/api/state")).json();
  const goal = latest.records.find(
    (r: any) => r.meta.title === "A calmer customer experience",
  );
  for (const column of state.config.columns) {
    const created = latest.records.find(
      (r: any) => r.meta.title === `Quick ${column.name}`,
    );
    expect(created.meta.status).toBe(column.id);
    expect(created.meta.parent).toBe(goal.meta.id);
  }
  // The goal heads its swimlane; its children fill the columns below.
  const lane = page.locator(".board-group").filter({
    has: page.locator(".group-goal", {
      hasText: "A calmer customer experience",
    }),
  });
  const heading = lane.locator(".group-goal");
  const child = lane
    .locator(".board-cell .ticket-card")
    .filter({ hasText: "Quick In Progress" });
  await expect(child).toBeVisible();
  expect((await heading.boundingBox())!.y).toBeLessThan(
    (await child.boundingBox())!.y,
  );
  await expect(child.locator(".record-id")).toHaveText(/^#\d+$/);
  await heading.click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "A calmer customer experience",
  );
});

test("centered ticket saves on outside click, offers tag suggestions, and keeps a comment thread", async ({
  page,
}) => {
  const input = await addItem(page, "No parent goal / Backlog");
  await input.fill("Autosave interaction");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  const card = page
    .locator(".ticket-card")
    .filter({ hasText: "Autosave interaction" });
  await card.click();
  const bounds = (await page.locator(".record-dialog").boundingBox())!;
  expect(Math.abs(bounds.x + bounds.width / 2 - 720)).toBeLessThan(3);
  expect(Math.abs(bounds.y + bounds.height / 2 - 500)).toBeLessThan(3);
  await page
    .getByLabel("Markdown body")
    .fill("Saved when clicking the backdrop.");
  await page
    .getByRole("combobox", { name: "Owner", exact: true })
    .fill("Agent");
  await page
    .getByRole("listbox", { name: "Owner suggestions" })
    .getByRole("option", { name: "Agent A", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Labels", exact: true })
    .fill("navig");
  await page
    .getByRole("listbox", { name: "Labels suggestions" })
    .getByRole("option", { name: "navigation", exact: true })
    .click();
  await page.mouse.click(8, 8);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await card.click();
  await expect(page.getByLabel("Markdown body")).toHaveValue(
    "Saved when clicking the backdrop.",
  );
  await expect(
    page.getByRole("combobox", { name: "Owner", exact: true }),
  ).toHaveValue("Agent A");
  for (const text of ["First update", "Second reply"]) {
    await page.getByLabel("Add to the conversation").fill(text);
    await page.getByLabel("Add to the conversation").press("Meta+Enter");
    await expect(
      page.locator(".comment").filter({ hasText: text }),
    ).toHaveCount(1);
  }
  await page.getByLabel("Markdown body").fill("Saved on Escape too.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await card.click();
  await expect(page.getByLabel("Markdown body")).toHaveValue(
    "Saved on Escape too.",
  );
  await page.screenshot({
    path: "test-results/ticket-thread.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("standalone screenshots reopen with annotations and support Delete and undo", async ({
  page,
}) => {
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 400;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#203833";
    ctx.fillRect(0, 0, 600, 400);
    return c.toDataURL("image/png");
  });
  const image = await (
    await page.request.post("/api/images", {
      data: { name: "Standalone screenshot", data },
    })
  ).json();
  await page.getByRole("button", { name: "Screenshots", exact: true }).click();
  await page
    .locator(".screenshot-card")
    .filter({ hasText: "Standalone screenshot" })
    .click();
  await expect(page.locator(".annotation-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Pin", exact: false }).click();
  await page.locator(".image-canvas svg").click({ position: { x: 25, y: 25 } });
  await page
    .getByLabel("Instruction / text")
    .fill("Keep this standalone note.");
  await page
    .getByRole("button", { name: "Save screenshot", exact: true })
    .click();
  await expect(page.locator(".annotation-dialog")).toHaveCount(0);
  await page
    .locator(".screenshot-card")
    .filter({ hasText: "Standalone screenshot" })
    .click();
  const note = page
    .locator(".annotation-note")
    .filter({ hasText: "Keep this standalone note." });
  await note.click();
  await page.keyboard.press("Delete");
  await expect(note).toHaveCount(0);
  await page.keyboard.press("Meta+z");
  await expect(note).toHaveCount(1);
  await page
    .getByRole("button", { name: "Save screenshot", exact: true })
    .click();
  const latest = await (await page.request.get("/api/state")).json();
  expect(
    latest.records.some((r: any) => r.meta.attachments?.includes(image.id)),
  ).toBe(false);
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  await expect(
    page.getByText("Double-tap Option / Alt", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Delete / Backspace", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close shortcuts" }).click();
  await page.screenshot({
    path: "test-results/screenshots-library.png",
    fullPage: true,
  });
});

async function openNewTicket(page: any, title: string) {
  const created = await (
    await page.request.post("/api/records", {
      data: {
        kind: "ticket",
        meta: { title },
        body: "",
        actor: { name: "You", kind: "human" },
      },
    })
  ).json();
  await page.goto("/");
  await page.getByLabel("Filter tickets").fill(title);
  await page.locator(".ticket-card").filter({ hasText: title }).click();
  await expect(page.getByLabel("Markdown body")).toBeVisible();
  return created;
}
const record = async (page: any, id: string) =>
  (await page.request.get(`/api/records/${id}`)).json();

test("saving merges a concurrent edit to different fields", async ({
  page,
}) => {
  const created = await openNewTicket(page, "Merge target");
  await page.getByLabel("Markdown body").fill("My description.");
  await page.request.patch(`/api/records/${created.meta.id}`, {
    data: {
      revision: created.revision,
      patch: { labels: ["external"] },
      actor: { name: "Agent A", kind: "agent" },
    },
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = await record(page, created.meta.id);
  expect(saved.body).toBe("My description.");
  expect(saved.meta.labels).toEqual(["external"]);
});

test("overlapping edits keep the draft and let the user choose", async ({
  page,
}) => {
  const created = await openNewTicket(page, "Conflict target");
  await page.getByLabel("Markdown body").fill("Mine.");
  await page.request.patch(`/api/records/${created.meta.id}`, {
    data: {
      revision: created.revision,
      patch: { labels: ["external"] },
      body: "Theirs.",
      actor: { name: "Agent A", kind: "agent" },
    },
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByText(/changed elsewhere \(description\)/),
  ).toBeVisible();
  await expect(page.getByLabel("Markdown body")).toHaveValue("Mine.");
  expect((await record(page, created.meta.id)).body).toBe("Theirs.");
  await page
    .getByRole("button", { name: "Keep my edits on top", exact: true })
    .click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = await record(page, created.meta.id);
  expect(saved.body).toBe("Mine.");
  expect(saved.meta.labels).toEqual(["external"]);
});

test("a record that cannot be saved can still be discarded", async ({
  page,
}) => {
  const created = await openNewTicket(page, "Discard target");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Your changes were not saved.")).toBeVisible();
  await page
    .getByRole("button", { name: "Discard changes and close", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await record(page, created.meta.id)).meta.title).toBe(
    "Discard target",
  );
});

test("closing the annotation editor asks before discarding marks", async ({
  page,
}) => {
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 300;
    c.getContext("2d")!.fillRect(0, 0, 400, 300);
    return c.toDataURL("image/png");
  });
  await page.request.post("/api/images", {
    data: { name: "Unsaved marks", data },
  });
  await page.getByRole("button", { name: "Screenshots", exact: true }).click();
  const card = page
    .locator(".screenshot-card")
    .filter({ hasText: "Unsaved marks" });
  await card.click();
  const editor = page.locator(".annotation-dialog");
  // An untouched editor closes immediately.
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await card.click();
  await page.getByRole("button", { name: "Pin", exact: false }).click();
  await page.locator(".image-canvas svg").click({ position: { x: 30, y: 30 } });
  await page.getByLabel("Instruction / text").fill("Do not lose this.");
  await page.keyboard.press("Escape");
  await expect(editor).toBeVisible();
  await expect(
    page.getByText("You have unsaved annotation changes."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Instruction / text")).toHaveValue(
    "Do not lose this.",
  );
  await page.getByRole("button", { name: "Close annotation editor" }).click();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await card.click();
  await expect(page.locator(".annotation-note")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
});

test("saved views: create, rename, change layout and grouping, save, delete", async ({
  page,
}) => {
  await page.getByRole("button", { name: "New view" }).click();
  // A new view starts renaming immediately.
  const name = page.getByLabel("View name");
  await name.fill("By owner");
  await name.press("Enter");
  const tab = page.getByRole("button", { name: "By owner", exact: true });
  await expect(tab).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "View options" }).click();
  await page
    .locator(".segmented")
    .getByRole("button", { name: "Board" })
    .click();
  await page.getByLabel("Group by").selectOption("owner");
  await page.keyboard.press("Escape");
  await expect(
    page.locator(".group-header").filter({ hasText: "Agent A" }),
  ).toBeVisible();
  await expect(page.locator(".unsaved-dot")).toHaveCount(1);
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await expect(page.locator(".unsaved-dot")).toHaveCount(0);
  await page.reload();
  await expect(tab).toHaveAttribute("aria-current", "page");
  await expect(
    page.locator(".group-header").filter({ hasText: "No owner" }),
  ).toBeVisible();
  let state = await (await page.request.get("/api/state")).json();
  expect(state.config.views.map((v: any) => v.name)).toEqual([
    "Board",
    "Table",
    "By owner",
  ]);
  expect(state.config.views[2]).toMatchObject({
    layout: "board",
    groupBy: "owner",
  });
  await page.getByRole("button", { name: "Options for By owner view" }).click();
  await page.getByRole("button", { name: "Delete view" }).click();
  await expect(tab).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Board", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  state = await (await page.request.get("/api/state")).json();
  expect(state.config.views.map((v: any) => v.name)).toEqual([
    "Board",
    "Table",
  ]);
});

const human = { name: "You", kind: "human" };
const createTicket = async (page: any, meta: Record<string, unknown>) =>
  (
    await page.request.post("/api/records", {
      data: { kind: "ticket", meta, body: "", actor: human },
    })
  ).json();

test("arrow keys move focus between board cards with a single tab stop", async ({
  page,
}) => {
  const goal = await createTicket(page, { title: "Keyboard lane" });
  const lane = { parent: goal.meta.id };
  await createTicket(page, { title: "Keyboard card A", ...lane });
  await createTicket(page, {
    title: "Keyboard card B",
    status: "selected",
    ...lane,
  });
  await createTicket(page, {
    title: "Keyboard card C",
    status: "selected",
    ...lane,
  });
  await createTicket(page, {
    title: "Keyboard card D",
    status: "progress",
    ...lane,
  });
  await page.goto("/");
  await page.getByLabel("Filter tickets").fill("Keyboard card");
  const cards = page.locator(".board-cell .ticket-card");
  await expect(cards).toHaveCount(4);
  const card = (name: string) =>
    cards.filter({ hasText: `Keyboard card ${name}` });
  // Roving tabindex: exactly one card is in the Tab order.
  await expect(page.locator('.ticket-card[tabindex="0"]')).toHaveCount(1);
  await expect(page.locator('.ticket-card[tabindex="-1"]')).toHaveCount(3);
  await card("A").focus();
  await page.keyboard.press("ArrowRight");
  await expect(card("B")).toBeFocused();
  await expect(card("B")).toHaveAttribute("tabindex", "0");
  await expect(page.locator('.ticket-card[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await expect(card("C")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(card("C")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(card("D")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(card("B")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(card("B")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(card("A")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Keyboard card A",
  );
  await page.getByRole("button", { name: "Close ticket" }).click();
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  await expect(page.getByText("← → ↑ ↓", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close shortcuts" }).click();
});

test("selected table rows change status together", async ({ page }) => {
  const one = await createTicket(page, { title: "Bulk move one" });
  const two = await createTicket(page, { title: "Bulk move two" });
  await page.goto("/");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByLabel("Filter tickets").fill("Bulk move");
  await expect(page.locator(".project-table tr[data-stage]")).toHaveCount(2);
  await expect(page.locator(".bulk-bar")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Select all rows" }).check();
  await expect(page.locator(".bulk-bar")).toContainText("2 selected");
  const second = page.getByRole("checkbox", { name: "Select Bulk move two" });
  await second.uncheck();
  await expect(page.locator(".bulk-bar")).toContainText("1 selected");
  await expect(
    page.getByRole("checkbox", { name: "Select all rows" }),
  ).toHaveJSProperty("indeterminate", true);
  await second.check();
  await page.getByLabel("Status for selected rows").selectOption("done");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".bulk-bar")).toHaveCount(0);
  for (const title of ["Bulk move one", "Bulk move two"])
    await expect(
      page.getByLabel(`Status of ${title}`, { exact: true }),
    ).toHaveValue("done");
  for (const t of [one, two])
    expect((await record(page, t.meta.id)).meta.status).toBe("done");
  // A filter change drops the selection.
  await page.getByRole("checkbox", { name: "Select Bulk move one" }).check();
  await expect(page.locator(".bulk-bar")).toContainText("1 selected");
  await page.getByLabel("Filter tickets").fill("Bulk move one");
  await expect(page.locator(".bulk-bar")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filter" }).click();
});

test("archived tickets leave the board until a view asks for is:archived", async ({
  page,
}) => {
  const created = await openNewTicket(page, "Archive candidate");
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".ticket-card")).toHaveCount(0);
  expect((await record(page, created.meta.id)).meta.archived).toBe(true);
  const filter = page.getByLabel("Filter tickets");
  await filter.fill("is:archived Archive candidate");
  await expect(page.locator(".ticket-card")).toHaveCount(1);
  await filter.fill("is:archived");
  await expect(
    page.locator(".ticket-card").filter({ hasText: "Archive candidate" }),
  ).toHaveCount(1);
  await expect(
    page
      .locator(".ticket-card")
      .filter({ hasText: "Export a project handoff" }),
  ).toHaveCount(0);
  await filter.fill("-is:archived Archive candidate");
  await expect(page.locator(".ticket-card")).toHaveCount(0);
  await filter.fill("is:archived Archive candidate");
  await page.locator(".ticket-card").click();
  await expect(
    page.locator(".record-subtitle .tag").filter({ hasText: "Archived" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Unarchive", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".ticket-card")).toHaveCount(0);
  await filter.fill("Archive candidate");
  await expect(page.locator(".ticket-card")).toHaveCount(1);
  expect((await record(page, created.meta.id)).meta.archived).toBe(false);
});

test("insights summarizes open work, weekly flow, columns, and labels", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Insights", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
  const state = await (await page.request.get("/api/state")).json();
  const roles = new Map<string, string>(
    state.config.columns.map((c: any) => [c.id, c.role]),
  );
  const tickets = state.records.filter(
    (r: any) => r.meta.kind === "ticket" && !r.meta.archived,
  );
  const ids = new Set(tickets.map((r: any) => r.meta.id));
  const byRole = (role: string) =>
    tickets.filter((r: any) => roles.get(r.meta.status) === role).length;
  const tile = (name: string) =>
    page.locator(".stat-tile").filter({ hasText: name }).locator(".num");
  await expect(tile("Open tickets")).toHaveText(
    String(tickets.length - byRole("done")),
  );
  await expect(tile("In progress")).toHaveText(String(byRole("progress")));
  await expect(tile("In review")).toHaveText(String(byRole("review")));
  await expect(tile("Blocked")).toHaveText(
    String(tickets.filter((r: any) => r.meta.blocked?.trim()).length),
  );
  await expect(tile("Open questions")).toHaveText(
    String(
      state.comments.filter(
        (c: any) => c.kind === "question" && !c.resolved && ids.has(c.ticket),
      ).length,
    ),
  );
  const chart = page.locator(".flow-chart");
  await expect(chart).toBeVisible();
  await expect(chart.locator("rect")).toHaveCount(16);
  await expect(chart.locator("text.axis")).toHaveCount(8 + 3);
  await expect(page.locator(".legend")).toContainText("Created");
  await expect(page.locator(".legend")).toContainText("Done");
  // Everything was created this week, so the last pair of bars carries it.
  const heights = await chart
    .locator("rect")
    .evaluateAll((els) => els.map((e) => Number(e.getAttribute("height"))));
  expect(heights[14]).toBeGreaterThan(0);
  expect(heights[15]).toBeGreaterThan(0);
  expect(heights.slice(0, 14).every((h) => h === 0)).toBe(true);
  await expect(page.locator(".insight-table tbody tr")).toHaveCount(
    state.config.columns.length,
  );
  await expect(
    page
      .locator(".insight-table tbody tr")
      .filter({ hasText: "In Progress" })
      .locator(".num"),
  ).toHaveText(
    String(tickets.filter((r: any) => r.meta.status === "progress").length),
  );
  await expect(page.locator(".label-ranking li").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
});

test("code links and a verification run show in the ticket, its card, and its row", async ({
  page,
}) => {
  const output = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join(
    "\n",
  );
  const created = await createTicket(page, {
    title: "Verified change",
    branch: "feature/verified",
    pr: "https://example.com/pull/42",
    commits: ["0123456789abcdef", "fedcba9876543210"],
    verification: {
      command: "npm test",
      exitCode: 0,
      output,
      at: new Date().toISOString(),
    },
  });
  await page.goto("/");
  await page.getByLabel("Filter tickets").fill("Verified change");
  const card = page
    .locator(".ticket-card")
    .filter({ hasText: "Verified change" });
  await expect(card.locator(".tag.green")).toHaveText("Verified ✓");
  await card.click();
  await page
    .getByText("Agent handoff, review & dependencies", { exact: true })
    .click();
  const branch = page.getByLabel("Branch", { exact: true });
  await expect(branch).toHaveValue("feature/verified");
  await expect(
    page.getByRole("link", { name: "Open pull request" }),
  ).toHaveAttribute("href", "https://example.com/pull/42");
  await expect(page.locator(".commit-list code")).toHaveText([
    "0123456",
    "fedcba9",
  ]);
  const panel = page.locator(".verification");
  await expect(panel.locator(".tag.green")).toHaveText("Exit 0");
  await expect(panel.locator(".verification-command")).toHaveText("npm test");
  await expect(panel.locator("pre")).toContainText("line 12");
  await expect(panel.locator("pre")).not.toContainText("line 13");
  await page.getByRole("button", { name: /^Show all/ }).click();
  await expect(panel.locator("pre")).toContainText("line 20");
  await page.getByRole("button", { name: "Show less" }).click();
  await expect(panel.locator("pre")).not.toContainText("line 20");
  await branch.fill("feature/verified-2");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = await record(page, created.meta.id);
  expect(saved.meta.branch).toBe("feature/verified-2");
  expect(saved.meta.verification.exitCode).toBe(0);
  await page.request.patch(`/api/records/${created.meta.id}`, {
    data: {
      revision: saved.revision,
      patch: {
        verification: {
          command: "npm test",
          exitCode: 1,
          output: "1 failing",
          at: new Date().toISOString(),
        },
      },
      actor: { name: "Agent A", kind: "agent" },
    },
  });
  await expect(card.locator(".tag.danger")).toHaveText("Failed ✗", {
    timeout: 10000,
  });
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(
    page
      .locator(".title-cell")
      .filter({ hasText: "Verified change" })
      .locator(".tag.danger"),
  ).toHaveText("Failed ✗");
});
