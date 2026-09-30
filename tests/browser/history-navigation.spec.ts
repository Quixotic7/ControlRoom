import { expect, test, type Page } from "@playwright/test";

const actor = { name: "History tester", kind: "human" };

async function createTicket(page: Page, title: string) {
  return (
    await page.request.post("/api/records", {
      data: {
        kind: "ticket",
        meta: { title, status: "selected", scopeApproved: true },
        body: "History navigation fixture",
        actor,
      },
    })
  ).json();
}

async function openTicket(page: Page, title: string) {
  await page.getByLabel("Filter tickets").fill(title);
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue(title);
}

test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board" },
  });
});

test("Back and Forward restore views, tickets, settings, and direct URLs", async ({
  page,
}) => {
  const title = `History route ${Date.now()}`;
  const ticket = await createTicket(page, title);
  await page.request.patch("/api/preferences", {
    data: { selected: ticket.meta.id, page: "review", viewId: "board" },
  });
  await page.goto("/?page=project&view=board");
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page).toHaveURL(/page=project&view=table/);
  await openTicket(page, title);
  await expect(page).toHaveURL(new RegExp(`#ticket=${ticket.meta.id}$`));

  await page.goBack();
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Table", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue(title);

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Settings & backups" }).click();
  await expect(page).toHaveURL(/page=settings/);
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "Table", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await page.reload();
  await expect(
    page.getByRole("button", { name: "Table", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.goto(`/?page=project&view=table#ticket=${ticket.meta.id}`);
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue(title);
});

test("Back saves a dirty ticket and failed saves preserve its entry and Forward branch", async ({
  page,
}) => {
  const title = `History draft ${Date.now()}`;
  const ticket = await createTicket(page, title);
  await page.goto("/?page=project&view=board");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await openTicket(page, title);
  const input = page.getByRole("textbox", { name: "Title", exact: true });
  const edited = `${title} edited`;
  await input.fill(edited);

  let fail = true;
  let patches = 0;
  await page.route(`**/api/records/${ticket.meta.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    patches++;
    if (fail)
      return route.fulfill({
        status: 503,
        json: { error: "History save unavailable" },
      });
    return route.continue();
  });

  await page.goBack({ waitUntil: "commit" });
  await expect(page.getByRole("alert")).toContainText(
    "History save unavailable",
  );
  await expect(input).toHaveValue(edited);
  await expect(page).toHaveURL(new RegExp(`#ticket=${ticket.meta.id}$`));
  expect(patches).toBe(1);

  fail = false;
  await page.goBack({ waitUntil: "commit" });
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveCount(0);
  expect(patches).toBe(2);
  await page.goForward();
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue(edited);
});

test("rapid Back waits for one save and ticket Close skips related-ticket history", async ({
  page,
}) => {
  const nonce = Date.now();
  const first = await createTicket(page, `History first ${nonce}`);
  const second = await createTicket(page, `History second ${nonce}`);
  await page.goto("/?page=project&view=board");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await openTicket(page, first.meta.title);
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill(`${first.meta.title} saved`);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let patches = 0;
  await page.route(`**/api/records/${first.meta.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    patches++;
    await gate;
    return route.continue();
  });
  await page.evaluate(() => {
    history.back();
    history.back();
  });
  await expect.poll(() => patches).toBe(1);
  release();
  await expect(title).toHaveCount(0);
  await page.goForward();
  await expect(
    page.getByRole("button", { name: "Table", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "Board", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await openTicket(page, `${first.meta.title} saved`);
  await page.evaluate((id) => {
    location.hash = `ticket=${id}`;
  }, second.meta.id);
  await expect(title).toHaveValue(second.meta.title);
  await page.goBack();
  await expect(title).toHaveValue(`${first.meta.title} saved`);
  await page.goForward();
  await expect(title).toHaveValue(second.meta.title);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(title).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Board", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await page.goto(`/?ticketOnly=1#ticket=${second.meta.id}`);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page).not.toHaveURL(/ticketOnly=1/);
  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
});

test("new-ticket save and empty-draft discard still close the editor", async ({
  page,
}) => {
  await page.goto("/?page=project&view=board");
  await page.getByRole("button", { name: "New ticket" }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill(`Created through history ${Date.now()}`);
  await page.getByRole("button", { name: "Create ticket" }).click();
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "New ticket" }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveCount(0);
});
