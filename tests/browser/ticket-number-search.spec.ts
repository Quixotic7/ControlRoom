import { test, expect } from "@playwright/test";

test("number lookup opens archived tickets despite hidden columns and preserves filters and archive state", async ({
  page,
}) => {
  const actor = { name: "Search tester", kind: "human" };
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board" },
  });
  const response = await page.request.post("/api/records", {
    data: {
      kind: "ticket",
      meta: {
        title: "Archived screenshot feedback",
        status: "done",
        archived: true,
        owner: "Ana",
      },
      body: "Preserve this description.",
      actor,
    },
  });
  expect(response.ok()).toBeTruthy();
  const target = await response.json();
  const decoy = await (
    await page.request.post("/api/records", {
      data: {
        kind: "ticket",
        meta: {
          title: `Mentions ${target.meta.number} in title`,
          status: "done",
        },
        body: "",
        actor,
      },
    })
  ).json();
  await page.goto("/?page=project&view=board");
  const filter = page.getByLabel("Filter tickets");
  const result = page.getByRole("region", { name: "Ticket number result" });
  await filter.fill(target.meta.title);
  await expect(
    page.locator(`.ticket-card[data-id="${target.meta.id}"]`),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Hide Done column", exact: true })
    .click();
  for (const query of [String(target.meta.number), `#${target.meta.number}`]) {
    await filter.fill(query);
    await expect(result).toContainText("Archived");
    await result
      .getByRole("button", {
        name: `Open #${target.meta.number}: ${target.meta.title}`,
        exact: true,
      })
      .click();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
      target.meta.title,
    );
    await page
      .getByRole("button", { name: "Close ticket", exact: true })
      .click();
    await expect(filter).toHaveValue(query);
  }
  await expect(
    page.getByRole("button", { name: "Show Done column", exact: true }),
  ).toBeVisible();
  await filter.fill(`${target.meta.number} -is:archived`);
  await expect(result).toHaveCount(0);
  await filter.fill(`${target.meta.number} owner:other`);
  await expect(result).toHaveCount(0);
  await filter.fill(`${target.meta.number} owner:ana status:done`);
  await expect(result).toContainText(target.meta.title);
  await page.getByRole("button", { name: "View options", exact: true }).click();
  await page
    .locator(".view-options")
    .getByRole("button", { name: "Table", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.locator(`tr[data-id="${target.meta.id}"]`)).toBeVisible();
  await expect(page.locator(`tr[data-id="${decoy.meta.id}"]`)).toHaveCount(0);
  const after = await (
    await page.request.get(`/api/records/${target.meta.id}`)
  ).json();
  expect(after.revision).toBe(target.revision);
  expect(after.meta.archived).toBe(true);
  await filter.fill("99999999999999999");
  await expect(result).toHaveCount(0);
  await expect(
    page.getByText(/No tickets match “99999999999999999”/),
  ).toBeVisible();
});
