import { test, expect } from "@playwright/test";
const proposer = { name: "Proposal agent", kind: "agent" },
  human = { name: "Fixture human", kind: "human" };
let originalConfig: unknown;
test.beforeEach(async ({page}) => {
  await page.request.get("/");
  originalConfig = (await (await page.request.get("/api/orchestration")).json()).config;
});
test.afterEach(async ({page}) => {
  const current = await (await page.request.get("/api/orchestration")).json();
  const response = await page.request.put("/api/orchestration/config", {data:{actor:human, revision:current.revision, config:originalConfig}});
  expect(response.ok()).toBe(true);
});
test("proposal appears in Needs you, shows exact diff, and only applies on human click", async ({
  page,
}) => {
  await page.request.get("/");
  const current = await (await page.request.get("/api/orchestration")).json();
  const config = {
    ...current.config,
    enabled: false,
    maxTurns: 41,
    humanPolicy: "all",
    workers: current.config.workers.map((w: any, i: number) => ({
      ...w,
      model: i ? w.model : "proposed-model",
    })),
  };
  const response = await page.request.post("/api/orchestration/proposals", {
    data: { actor: proposer, config, revision: current.revision },
  });
  expect(response.ok()).toBe(true);
  const p = await response.json();
  expect(
    (await (await page.request.get("/api/orchestration")).json()).config,
  ).toEqual(current.config);
  expect(
    (
      await page.request.post(`/api/orchestration/proposals/${p.id}/apply`, {
        data: { actor: proposer, revision: p.revision },
      })
    ).status(),
  ).toBe(403);
  await page.goto("/?page=attention");
  await page
    .getByRole("button")
    .filter({ hasText: "Agent configuration proposal" })
    .click();
  const card = page.locator(".agent-config-proposal").filter({ hasText: p.id });
  await expect(card.getByRole("table")).toContainText("proposed-model");
  await expect(card.getByRole("table")).toContainText("humanPolicy");
  await card.getByRole("button", { name: "Apply proposal" }).click();
  await expect(card).toHaveCount(0);
  const applied = await (await page.request.get("/api/orchestration")).json();
  expect(applied.config.maxTurns).toBe(41);
  expect(applied.config.enabled).toBe(false);
  expect(
    applied.proposals.proposals.find((v: any) => v.id === p.id).decidedBy,
  ).toEqual({ name: "You", kind: "human" });
});
test("stale proposal disables Apply and can be discarded without replacing live settings", async ({
  page,
}) => {
  await page.request.get("/");
  const current = await (await page.request.get("/api/orchestration")).json();
  const p = await (
    await page.request.post("/api/orchestration/proposals", {
      data: { actor: proposer, config: { ...current.config, maxTurns: 42 } },
    })
  ).json();
  const changed = await page.request.put("/api/orchestration/config", {
    data: {
      actor: human,
      revision: current.revision,
      config: { ...current.config, maxTurns: 43 },
    },
  });
  expect(changed.ok()).toBe(true);
  await page.goto("/?page=agents");
  const card = page.locator(".agent-config-proposal").filter({ hasText: p.id });
  await expect(card).toContainText("stale");
  await expect(
    card.getByRole("button", { name: "Apply proposal" }),
  ).toBeDisabled();
  expect(
    (
      await page.request.post(`/api/orchestration/proposals/${p.id}/apply`, {
        data: { actor: human, revision: p.revision },
      })
    ).status(),
  ).toBe(409);
  await card.getByRole("button", { name: "Discard proposal" }).click();
  await expect(card).toHaveCount(0);
  expect(
    (await (await page.request.get("/api/orchestration")).json()).config
      .maxTurns,
  ).toBe(43);
});
