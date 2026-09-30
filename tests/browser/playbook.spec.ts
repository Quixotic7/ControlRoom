import { test, expect, type Page } from "@playwright/test";

async function openPlaybook(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Help & playbook" }).click();
  await expect(
    page.getByRole("heading", { name: "Help & playbook" }),
  ).toBeVisible();
}

function recipe(page: Page, title: string) {
  return page.locator(".playbook-card").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  });
}

test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board" },
  });
});

test("playbook searches recipes and uses stable labelled group headings", async ({
  page,
}) => {
  await openPlaybook(page);
  await page.getByLabel("Search playbook recipes").fill("screenshot");
  await expect(recipe(page, "Give screenshot feedback")).toBeVisible();
  await expect(recipe(page, "Pick up approved work")).toHaveCount(0);
  await expect(
    page.locator("section[aria-labelledby='playbook-feedback-navigation']"),
  ).toHaveCount(1);
  await expect(page.locator("#playbook-feedback-navigation")).toHaveText(
    "Feedback & navigation",
  );
});

test("prompts can switch from the open project to a reusable template", async ({
  page,
}) => {
  await openPlaybook(page);
  const connect = recipe(page, "Connect a coding agent").getByRole("textbox");
  await expect(connect).not.toHaveValue(/PROJECT_NAME/);
  await page.getByLabel("Project context").selectOption("template");
  await expect(connect).toHaveValue(
    /PROJECT_NAME project on branch PROJECT_BRANCH/,
  );
  await expect(connect).toHaveValue(/that project's checkout/);
});

test("short command recipe gives native invocation and preserves read-only behavior", async ({
  page,
}) => {
  await openPlaybook(page);
  const prompt = recipe(page, "Install short command skills").getByRole(
    "textbox",
  );
  await expect(prompt).toHaveValue(
    /skills install \/absolute\/path\/to\/code-checkout/,
  );
  await expect(prompt).toHaveValue(/Codex invokes \$crrefresh/);
  await expect(prompt).toHaveValue(/Claude Code invokes \/crrefresh/);
  await expect(prompt).toHaveValue(/without claiming it/);
  await expect(prompt).toHaveValue(
    /not permission to write, claim, move, assign, or implement/,
  );
});

test("keyboard copy substitutes public ticket context without running writes", async ({
  page,
}) => {
  await openPlaybook(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByLabel(/Ticket number/).fill("26");
  const card = recipe(page, "Pick up approved work");
  const prompt = card.getByRole("textbox", {
    name: "Pick up approved work prompt",
  });
  await expect(prompt).toHaveValue(/ticket #26/);
  await expect(prompt).toHaveValue(/\.\/\.controlroom\/controlroom claim 26/);
  await expect(prompt).not.toHaveValue(
    /(?:Bearer\s+|CONTROLROOM_TOKEN=|sk-[a-z0-9])/i,
  );

  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/") && request.method() !== "GET")
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  const copy = card.getByRole("button", { name: "Copy prompt" });
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[aria-live='polite']")).toHaveText(
    "Prompt copied successfully.",
  );
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("ticket #26");
  expect(writes).toEqual([]);
});

test("clipboard denial selects the prompt for manual keyboard copying", async ({
  page,
}) => {
  await openPlaybook(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("Denied")) },
    });
    document.execCommand = () => false;
  });
  const card = recipe(page, "Connect a coding agent");
  const prompt = card.getByRole("textbox", {
    name: "Connect a coding agent prompt",
  });
  const copy = card.getByRole("button", { name: "Copy prompt" });
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText(
    "Copy is unavailable here. The prompt is selected; copy it manually.",
  );
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveJSProperty("selectionStart", 0);
  await expect(prompt).toHaveJSProperty(
    "selectionEnd",
    await prompt.evaluate(
      (element: HTMLTextAreaElement) => element.value.length,
    ),
  );
});
