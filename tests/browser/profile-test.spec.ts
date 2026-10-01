import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const actor = { name: "Profile test fixture human", kind: "human" };
test("native profile test is opt-in, uses saved settings, and reports validated success or sanitized failure", async ({
  page,
}) => {
  await page.request.get("/");
  const original = await (await page.request.get("/api/orchestration")).json();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cr-profile-browser-"),
  );
  const executable = path.join(directory, "claude-fixture");
  fs.writeFileSync(
    executable,
    `#!${process.execPath}\nprocess.stdin.resume(); process.stdin.on('end', () => {
    const args = process.argv.slice(2);
    if (!args.includes('--safe-mode') || args[args.indexOf('--tools')+1] !== '') process.exit(3);
    const schema = JSON.parse(args[args.indexOf('--json-schema')+1]);
    if (schema.$schema) { console.error('unsupported schema'); process.exit(1); }
    if (args[args.indexOf('--model')+1] === 'bad-model') { console.error('Provider startup failed api_key=private-not-for-browser'); process.exit(1); }
    console.log(JSON.stringify({type:'result',structured_output:{outcome:'ready',summary:'Profile check',criteria:'Valid schema',evidence:'Fixture',question:''}}));
  });\n`,
    { mode: 0o755 },
  );
  try {
    const config = {
      ...original.config,
      enabled: false,
      workers: [
        {
          name: "Native fixture",
          provider: "claude",
          executable,
          model: "fixture-model",
        },
      ],
    };
    const response = await page.request.put("/api/orchestration/config", {
      data: { actor, config, revision: original.revision },
    });
    expect(response.ok()).toBeTruthy();
    await page.request.patch("/api/preferences", {
      data: { selected: null, page: "agents" },
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Test this profile: Native fixture" })
      .click();
    const run = page.getByRole("button", {
      name: "Run profile test",
      exact: true,
    });
    await expect(run).toBeDisabled();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
      (await (await page.request.get("/api/orchestration")).json()).profileTest,
    ).toBeUndefined();
    await page
      .getByRole("button", { name: "Test this profile: Native fixture" })
      .click();
    await page
      .getByLabel(
        "I understand this test uses my provider quota and may incur a charge.",
      )
      .check();
    await run.click();
    await expect(page.getByLabel("Native profile check")).toContainText(
      "Passed: structured result received and validated.",
    );
    await page.getByText("Agent configuration", { exact: true }).click();
    await page.getByLabel("Worker 1 model", { exact: true }).fill("bad-model");
    await expect(
      page.getByRole("button", { name: "Test this profile: Native fixture" }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Save agent configuration" })
      .click();
    await expect(
      page.getByRole("button", { name: "Test this profile: Native fixture" }),
    ).toBeEnabled();
    await expect(page.getByLabel("Native profile check")).toContainText(
      "Saved settings changed since this test",
    );
    await page
      .getByRole("button", { name: "Test this profile: Native fixture" })
      .click();
    await expect(run).toBeDisabled();
    await page
      .getByLabel(
        "I understand this test uses my provider quota and may incur a charge.",
      )
      .check();
    await run.click();
    await expect(page.getByLabel("Native profile check")).toContainText(
      "Provider startup failed",
    );
    await expect(page.getByLabel("Native profile check")).not.toContainText(
      "private-not-for-browser",
    );
    const current = await (await page.request.get("/api/orchestration")).json();
    expect(current.config.enabled).toBe(false);
    expect(current.runs.map((r: { id: string }) => r.id)).toEqual(
      original.runs.map((r: { id: string }) => r.id),
    );
    const denied = await page.request.post("/api/orchestration/profile-test", {
      data: {
        actor: { name: "Agent", kind: "agent" },
        profile: "worker:0",
        kind: "work",
        revision: current.revision,
        confirmUsage: true,
      },
    });
    expect(denied.status()).toBe(403);
  } finally {
    const current = await (await page.request.get("/api/orchestration")).json();
    await page.request.put("/api/orchestration/config", {
      data: { actor, config: original.config, revision: current.revision },
    });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
