import { test, expect, type Page } from "@playwright/test";
const actor = { name: "Relationship reviewer", kind: "human" };
async function create(
  page: Page,
  title: string,
  meta = {},
  body = "Original description",
) {
  const response = await page.request.post("/api/records", {
    data: { kind: "ticket", meta: { title, ...meta }, body, actor },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
const get = async (page: Page, id: string) =>
  (await page.request.get(`/api/records/${id}`)).json();
test("related tickets and duplicate preview retain provenance and reject stale merges", async ({
  page,
}) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board" },
  });
  const survivor = await create(
    page,
    "Relationship survivor",
    { owner: "Ada" },
    "Survivor instructions\n\n## Acceptance criteria\n\n- Keep survivor behavior.",
  );
  const source = await create(
    page,
    "Relationship source",
    { owner: "Grace" },
    "Original source instructions\n\n## Acceptance criteria\n\n- Preserve source behavior.",
  );
  const child = await create(page, "Relationship child", {
    parent: source.meta.id,
  });
  await page.request.post(`/api/records/${source.meta.id}/comments`, {
    data: { actor, body: "Original discussion stays attributed" },
  });
  await page.goto(`/#ticket=${survivor.meta.id}`);
  const links = page.getByRole("region", { name: "Ticket relationships" });
  await links
    .getByLabel("Find by number or title", { exact: true })
    .fill(`#${source.meta.number}`);
  await links
    .getByRole("button", { name: new RegExp(`${source.meta.title}.*Relate`) })
    .click();
  await expect
    .poll(async () => (await get(page, source.meta.id)).meta.related)
    .toEqual([survivor.meta.id]);
  await links.getByRole("button", { name: "Remove", exact: true }).click();
  await expect
    .poll(async () => (await get(page, source.meta.id)).meta.related)
    .toEqual([]);
  await links
    .getByText("Merge a duplicate into this ticket", { exact: true })
    .click();
  const preview = async () => {
    await links
      .getByLabel("Find duplicate by number or title")
      .fill(source.meta.title);
    await links
      .getByRole("button", {
        name: new RegExp(`${source.meta.title}.*Preview`),
      })
      .click();
    await expect(
      links.getByRole("heading", { name: "Merge preview", exact: true }),
    ).toBeVisible();
  };
  await preview();
  const merge = links.getByRole("button", {
    name: "Merge and archive source",
    exact: true,
  });
  await expect(merge).toBeEnabled();
  const ownerResolution = links
    .locator(".merge-conflict")
    .filter({ hasText: "Owner" })
    .getByRole("combobox");
  const criteriaResolution = links
    .locator(".merge-conflict")
    .filter({ hasText: "Acceptance criteria" })
    .getByRole("combobox");
  await expect(ownerResolution).toHaveValue("survivor");
  await expect(criteriaResolution).toHaveValue("survivor");
  await ownerResolution.selectOption("source");
  await criteriaResolution.selectOption("both");
  const fresh = await get(page, source.meta.id);
  await page.request.patch(`/api/records/${source.meta.id}`, {
    data: {
      actor,
      revision: fresh.revision,
      patch: {},
      body: "Updated source instructions",
    },
  });
  await merge.click();
  await expect(page.getByText(/Missing or stale revision/)).toBeVisible();
  expect((await get(page, source.meta.id)).meta.archived).toBeFalsy();
  await links.getByRole("button", { name: "Cancel", exact: true }).click();
  await preview();
  await expect(merge).toBeEnabled();
  await links.locator(".merge-conflict select").selectOption("source");
  await merge.click();
  await expect
    .poll(async () => (await get(page, source.meta.id)).meta.duplicateOf)
    .toBe(survivor.meta.id);
  expect((await get(page, child.meta.id)).meta.parent).toBe(survivor.meta.id);
  expect((await get(page, survivor.meta.id)).meta.status).toBe("backlog");
  await expect(
    links.getByRole("heading", { name: "Preserved duplicate sources" }),
  ).toBeVisible();
  await links
    .getByRole("button", {
      name: new RegExp(`${source.meta.title}.*Original record`),
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: `Open survivor #${survivor.meta.number}`,
      exact: true,
    }),
  ).toBeVisible();
  const c = await (
    await page.request.get(`/api/records/${survivor.meta.id}/context`)
  ).json();
  expect(c.mergedSources[0].body).toContain("Updated source instructions");
  expect(
    c.comments.some(
      (comment: any) =>
        comment.ticket === source.meta.id &&
        comment.body === "Original discussion stays attributed",
    ),
  ).toBeTruthy();
});
