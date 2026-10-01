import { test, expect } from "@playwright/test";
const actor = { name: "Human", kind: "human" };
test("Agents exposes disabled-by-default setup, preserves draft during refresh, and saves human review gates", async ({
  page,
}) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "agents", theme: "dark" },
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Agents", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Human review only", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Queue assignment" }),
  ).toBeDisabled();
  const before = await (await page.request.get("/api/orchestration")).json();
  const denied = await page.request.put("/api/orchestration/config", {
    data: {
      config: before.config,
      revision: before.revision,
      workerBrief: "Agent-authored authority",
      actor: { name: "Browser agent", kind: "agent" },
    },
  });
  expect(denied.status()).toBe(403);
  await page.getByText("Agent configuration", { exact: true }).click();
  await page
    .getByLabel("Orchestrator name", { exact: true })
    .fill("Review captain");
  await page.getByLabel("Worker 1 model", { exact: true }).fill("custom-model");
  await page
    .getByLabel("Worker 1 role note", { exact: true })
    .fill("Focused implementation worker");
  await page
    .getByLabel("Claude allowed tool patterns", { exact: true })
    .fill("Bash(npm test *)\nBash(git commit *)");
  await page
    .getByLabel("Additional writable directories", { exact: true })
    .fill("/tmp");
  await page
    .getByLabel("Project worker brief", { exact: true })
    .fill("# Project build guidance");
  await page.getByRole("button", { name: "Add environment variable" }).click();
  await page
    .getByLabel("Variable name", { exact: true })
    .fill("MODULE_CACHE_PATH");
  await page.getByLabel("Value", { exact: true }).fill("/tmp/module-cache");
  // A periodic process refresh must not overwrite human configuration edits.
  await page.waitForTimeout(3200);
  await expect(
    page.getByLabel("Orchestrator name", { exact: true }),
  ).toHaveValue("Review captain");
  await page.getByRole("button", { name: "Save agent configuration" }).click();
  await expect(page.getByRole("status")).toContainText("Configuration saved");
  await page.reload();
  await expect(page.getByLabel("Agent roster")).toContainText("Review captain");
  const config = await (await page.request.get("/api/orchestration")).json();
  expect(config.config.enabled).toBe(false);
  expect(config.config.workers[0].model).toBe("custom-model");
  expect(config.config.workers[0].roleNote).toBe(
    "Focused implementation worker",
  );
  expect(config.config.workerPermissions.claudeAllowedTools).toEqual([
    "Bash(npm test *)",
    "Bash(git commit *)",
  ]);
  expect(config.config.workerPermissions.environment[0]).toEqual({
    name: "MODULE_CACHE_PATH",
    source: "literal",
    value: "/tmp/module-cache",
  });
  expect(config.workerBrief.content).toBe("# Project build guidance");
  const response = await page.request.post("/api/records", {
    data: {
      kind: "ticket",
      meta: { title: "Human gated orchestration ticket", scopeApproved: true },
      actor,
    },
  });
  const ticket = await response.json();
  await page.goto("/#ticket=" + ticket.meta.id);
  await page.getByLabel("Require human acceptance").check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  expect(
    (await (await page.request.get("/api/records/" + ticket.meta.id)).json())
      .meta.humanReviewRequired,
  ).toBe(true);
});

test("dashboard runs an approved fixture worker through review and exposes an accessible log", async ({
  page,
}, testInfo) => {
  const fs = await import("node:fs"),
    os = await import("node:os"),
    path = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const repository = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-browser-agent-")),
  );
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repository, ...args], { stdio: "pipe" });
  git("init", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@localhost");
  fs.writeFileSync(path.join(repository, "README.md"), "Fixture\n");
  git("add", ".");
  git("commit", "-m", "Initial");
  const executable = path.join(repository, "fixture-agent");
  fs.writeFileSync(
    executable,
    `#!${process.execPath}\nconst fs=require('node:fs');let prompt='';process.stdin.on('data', c=>prompt+=c);process.stdin.on('end',()=>{const review=prompt.startsWith('Independently');if(!review)fs.writeFileSync('feature.txt','Implemented');console.log(JSON.stringify({type:'thread.started',thread_id:'browser-fixture'}));const args=process.argv.slice(2);fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({outcome:review?'accept':'ready',summary:'Feature implemented and independently reviewed',criteria:'Verified the required file and behavior',evidence:'Inspected diff and independent test',question:''}));});`,
    { mode: 0o755 },
  );
  await page.request.get("/");
  const prior = await (await page.request.get("/api/orchestration")).json();
  try {
    const config = {
      ...prior.config,
      enabled: true,
      repository,
      baseRef: "main",
      verificationCommand: "test -f feature.txt",
      reviewer: {
        ...prior.config.reviewer,
        name: "Review captain",
        provider: "codex",
        executable,
      },
      workers: [
        { name: "Fixture worker", provider: "codex", executable, model: "" },
      ],
    };
    expect(
      (
        await page.request.put("/api/orchestration/config", {
          data: { config, revision: prior.revision, actor },
        })
      ).ok(),
    ).toBeTruthy();
    const response = await page.request.post("/api/records", {
      data: {
        kind: "ticket",
        meta: { title: "Managed browser trial", scopeApproved: true },
        body: "Create feature.txt containing Implemented",
        actor,
      },
    });
    const ticket = await response.json();
    await page.request.patch("/api/preferences", {
      data: { selected: null, page: "agents" },
    });
    await page.goto("/");
    await page
      .getByRole("combobox", { name: "Approved ticket", exact: true })
      .selectOption(ticket.meta.id);
    await expect(
      page.getByRole("button", { name: "Queue assignment" }),
    ).toBeDisabled();
    await page
      .getByRole("combobox", { name: "Worker", exact: true })
      .selectOption("Fixture worker");
    await page.getByRole("button", { name: "Queue assignment" }).click();
    await expect(
      page.getByText("Accepted by Review captain", { exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.locator(".agent-run")).toHaveCount(2);
    await page.screenshot({
      path: testInfo.outputPath("agents-desktop.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "View log", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: "Agent run log" });
    await expect(dialog).toContainText("thread.started");
    await expect(
      dialog.getByRole("button", { name: "Close log" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("main").evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(
      page.getByRole("heading", { name: "Agents", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Queue assignment" }),
    ).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath("agents-mobile.png"),
      fullPage: true,
    });
  } finally {
    const current = await (await page.request.get("/api/orchestration")).json();
    await page.request.put("/api/orchestration/config", {
      data: { config: prior.config, revision: current.revision, actor },
    });
    fs.rmSync(repository, { recursive: true, force: true });
  }
});
