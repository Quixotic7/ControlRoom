import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test.use({ timezoneId: "America/Los_Angeles" });

test("chat delegation is off by default and sends the host human grant settings", async ({
  page,
}) => {
  let saved: Record<string, unknown> | undefined;
  let status: Record<string, unknown> = {
    revision: "delegation-revision-1",
    grant: null,
    receipts: [],
  };
  await page.route("**/api/orchestration/delegation", async (route) => {
    if (route.request().method() === "PUT") {
      saved = route.request().postDataJSON();
      status = {
        ...status,
        revision: "delegation-revision-2",
        grant: {
          schema: 1,
          enabled: true,
          reviewer: "Chat captain",
          scopes: (saved?.scopes as {
            approveScope: boolean;
            manageBoard: boolean;
            reviewWork: boolean;
            manageRuns: boolean;
          }) ?? {
            approveScope: false,
            manageBoard: false,
            reviewWork: false,
            manageRuns: false,
          },
          grantedBy: { name: "You", kind: "human" },
          grantedAt: "2026-10-02T00:00:00.000Z",
          expiresAt: saved?.expiresAt,
          createdBeforeGrant: true,
          approvedGoalsOnly: true,
        },
      };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(status),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(status),
    });
  });
  await page.route("**/api/orchestration", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.config.reviewerMode = "chat";
    data.config.reviewer.name = "Chat captain";
    await route.fulfill({ response, json: data });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  const panel = page.getByRole("region", { name: "Chat delegation" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Off by default.")).toBeVisible();
  await expect(panel.getByText("Chat captain", { exact: true })).toBeVisible();
  await expect(panel.getByLabel("Approve scope")).toBeDisabled();
  await panel
    .getByLabel("Let the named chat orchestrator record my chat decisions")
    .check();
  await panel.getByLabel("Approve scope").check();
  await panel.getByLabel("Manage the board").check();
  await panel.getByLabel("Accept or request changes").check();
  await panel.getByLabel("Resolve and retry runs").check();
  await panel.getByLabel("Only tickets created before this grant").check();
  await panel.getByLabel("Only under goals I approved").check();
  await panel.getByLabel("Expiry (optional)").fill("2026-10-03T17:30");
  await panel.getByRole("button", { name: "Save chat delegation" }).click();
  await expect.poll(() => saved).toBeDefined();
  expect(saved).toMatchObject({
    revision: "delegation-revision-1",
    enabled: true,
    scopes: {
      approveScope: true,
      manageBoard: true,
      reviewWork: true,
      manageRuns: true,
    },
    createdBeforeGrant: true,
    approvedGoalsOnly: true,
    expiresAt: "2026-10-04T00:30:00.000Z",
    actor: { name: "You", kind: "human" },
  });
  expect(JSON.stringify(saved)).not.toMatch(/reviewer|grantedBy/i);
  await expect(panel.getByLabel("Expiry (optional)")).toHaveValue(
    "2026-10-03T17:30",
  );
});

test("a host human can grant and revoke chat delegation through the real API", async ({
  page,
}) => {
  const actor = { name: "Delegation browser fixture", kind: "human" };
  await page.request.get("/");
  const before = await (await page.request.get("/api/orchestration")).json();
  const repository = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-delegation-browser-")),
  );
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repository, ...args], { stdio: "pipe" });
  git("init", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@localhost");
  fs.writeFileSync(path.join(repository, "README.md"), "Delegation fixture\n");
  git("add", ".");
  git("commit", "-m", "Initial");
  const config = {
    ...before.config,
    enabled: true,
    repository,
    baseRef: "main",
    verificationCommand: "test -f README.md",
    reviewerMode: "chat",
    reviewer: { ...before.config.reviewer, name: "Browser chat reviewer" },
  };
  const configured = await page.request.put("/api/orchestration/config", {
    data: { actor, config, revision: before.revision },
  });
  expect(configured.ok(), await configured.text()).toBe(true);
  try {
    await page.request.patch("/api/preferences", {
      data: { selected: null, page: "agents" },
    });
    await page.goto("/");
    const panel = page.getByRole("region", { name: "Chat delegation" });
    await expect(panel).toBeVisible();
    await panel
      .getByLabel("Let the named chat orchestrator record my chat decisions")
      .check();
    await panel.getByLabel("Approve scope").check();
    await panel.getByRole("button", { name: "Save chat delegation" }).click();
    await expect(page.getByRole("status")).toContainText("Chat delegation saved");
    const granted = await (
      await page.request.get("/api/orchestration/delegation")
    ).json();
    expect(granted.grant).toMatchObject({
      enabled: true,
      reviewer: "Browser chat reviewer",
      scopes: { approveScope: true, manageBoard: false, reviewWork: false, manageRuns: false },
      grantedBy: { name: "You", kind: "human" },
    });
    const created = await page.request.post("/api/records", {
      data: {
        actor,
        kind: "ticket",
        meta: { title: "Delegated approval browser fixture" },
        body: "This ticket exists only for the delegation browser workflow.",
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const ticket = await created.json();
    const quote = "Approve this fixture scope after review.";
    const delegated = await page.request.post(
      "/api/orchestration/delegation/actions",
      {
        data: {
          action: "approve",
          ticket: ticket.meta.id,
          revision: ticket.revision,
          basis: { quote, saidAt: new Date().toISOString() },
          actor: { name: "Browser chat reviewer", kind: "agent" },
        },
      },
    );
    expect(delegated.ok(), await delegated.text()).toBe(true);
    const receipt = (await delegated.json()).receipt;
    const approved = await (
      await page.request.get(`/api/records/${ticket.meta.id}`)
    ).json();
    expect(approved.meta.scopeApproved).toBe(true);
    expect(approved.meta.scopeApprovedDelegation).toMatchObject({
      receiptId: receipt.id,
      actor: { name: "Browser chat reviewer", kind: "agent" },
      grantingHuman: { name: "You", kind: "human" },
      basis: { quote },
    });
    await page.reload();
    await page.getByRole("button", { name: /^Needs you/ }).click();
    const digest = page.getByRole("region", { name: "Done on your behalf" });
    await expect(digest).toContainText("Approved scope");
    await expect(digest).toContainText(quote);
    await digest.getByRole("button", { name: /Open Delegated approval browser fixture/ }).click();
    await expect(page.getByText(`Approved by You through Browser chat reviewer (chat)`)).toBeVisible();
    await expect(page.locator(".delegation-attribution")).toContainText(quote);
    await page.getByRole("button", { name: "Close ticket" }).click();
    await page.getByRole("button", { name: /^Needs you/ }).click();
    await digest.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(digest.getByText("Undone", { exact: true })).toBeVisible();
    expect(
      (
        await (await page.request.get(`/api/records/${ticket.meta.id}`)).json()
      ).meta.scopeApproved,
    ).toBeFalsy();
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    await panel
      .getByLabel("Let the named chat orchestrator record my chat decisions")
      .uncheck();
    await panel.getByRole("button", { name: "Keep chat delegation off" }).click();
    await expect(page.getByRole("status")).toContainText("Chat delegation is off");
    expect(
      (await (await page.request.get("/api/orchestration/delegation")).json())
        .grant.enabled,
    ).toBe(false);
  } finally {
    const current = await (await page.request.get("/api/orchestration")).json();
    await page.request.put("/api/orchestration/config", {
      data: { actor, config: before.config, revision: current.revision },
    });
  }
});
