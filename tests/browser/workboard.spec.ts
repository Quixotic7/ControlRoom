import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, view: "board", density: "comfortable" },
  });
  await page.goto("/");
});

test("quick entry creates tickets in their swimlane with an optional longer description", async ({
  page,
}) => {
  const input = page.getByRole("textbox", {
    name: "New ticket in A calmer customer experience / Backlog",
    exact: true,
  });
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
  const ungrouped = page.getByRole("textbox", {
    name: "New ticket in Ungrouped work / Backlog",
    exact: true,
  });
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
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Project board" }),
  ).toBeVisible();
  await expect(
    page.getByText("A calmer customer experience").first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/board-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Search tickets").fill("Preserve search");
  await expect(page.locator(".lane-cell .ticket-card")).toHaveCount(1);
  await page.locator(".lane-cell .ticket-card").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Preserve search between all views");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Search tickets").fill("");
  await page.getByLabel("Interface density").selectOption("compact");
  await page.reload();
  await expect(page.getByLabel("Interface density")).toHaveValue("compact");
  await page.getByLabel("Interface density").selectOption("comfortable");
  await page.getByRole("button", { name: "All tickets", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "All tickets" }),
  ).toBeVisible();
  const status = page.getByLabel(
    "Status of Preserve search between all views",
    { exact: true },
  );
  await status.focus();
  await expect(status).toBeFocused();
  // Native macOS select popups are outside headless Chromium's keyboard surface.
  await status.selectOption("backlog");
  await expect(status).toHaveValue("backlog");
  await page.getByRole("heading", { name: "All tickets" }).click();
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
  await page.getByRole("button", { name: "UI rulebook", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "One primary action per form" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/rulebook.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
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
  await page.locator(".upload-link input").setInputFiles({
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
  await page.getByLabel("Search tickets").fill("Annotated search alignment");
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
    const entry = page.getByRole("textbox", {
      name: `New ticket in A calmer customer experience / ${column.name}`,
      exact: true,
    });
    await entry.fill(`Quick ${column.name}`);
    await entry.press("Enter");
    await expect(entry).toHaveValue("");
  }
  const latest = await (await page.request.get("/api/state")).json();
  for (const column of state.config.columns)
    expect(
      latest.records.find((r: any) => r.meta.title === `Quick ${column.name}`)
        .meta.status,
    ).toBe(column.id);
  const parent = page
    .locator(".parent-ticket-row .ticket-card")
    .filter({ hasText: "A calmer customer experience" });
  const child = page
    .locator(".child-columns .ticket-card")
    .filter({ hasText: "Quick In Progress" });
  await expect(parent).toBeVisible();
  await expect(child.locator(".card-parent")).toContainText(
    "A calmer customer experience",
  );
  expect((await parent.boundingBox())!.y).toBeLessThan(
    (await child.boundingBox())!.y,
  );
  await expect(child.locator(".record-id")).toHaveText(/^#\d+$/);
});

test("centered ticket saves on outside click, offers tag suggestions, and keeps a comment thread", async ({
  page,
}) => {
  const input = page.getByRole("textbox", {
    name: "New ticket in Ungrouped work / Backlog",
    exact: true,
  });
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
  await page.getByLabel("Search tickets").fill(title);
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
