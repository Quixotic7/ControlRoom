import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const actor = { name: "Fixture owner", kind: "human" };
async function fixture(page: Page, maxAttempts = 3) {
  await page.request.get("/");
  const previous = await (await page.request.get("/api/orchestration")).json();
  const repository = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cr-question-browser-")),
  );
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repository, ...args], { stdio: "pipe" });
  git("init", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@localhost");
  fs.writeFileSync(path.join(repository, "README.md"), "Question fixture\n");
  git("add", ".");
  git("commit", "-m", "Initial");
  const executable = path.join(repository, "question-agent");
  fs.writeFileSync(
    executable,
    `#!${process.execPath}\nconst fs=require('node:fs');let prompt='';process.stdin.on('data',c=>prompt+=c);process.stdin.on('end',()=>{
    console.log(JSON.stringify({type:'thread.started',thread_id:'question-fixture'}));
    const args=process.argv.slice(2);fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({outcome:'human',summary:'Needs product input',criteria:'Waiting for input',evidence:'No implementation attempted',question:'Should the control use teal?'}));
  });`,
    { mode: 0o755 },
  );
  const config = {
    ...previous.config,
    enabled: true,
    repository,
    baseRef: "main",
    reviewerMode: "chat",
    maxAttempts,
    verificationCommand: "test -f README.md",
    workers: [
      { name: "Question fixture", provider: "codex", executable, model: "" },
    ],
  };
  const saved = await page.request.put("/api/orchestration/config", {
    data: { actor, config, revision: previous.revision },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const created = await page.request.post("/api/records", {
    data: {
      actor,
      kind: "ticket",
      meta: {
        title: `Managed question ${path.basename(repository)}`,
        scopeApproved: true,
      },
      body: "Ask for input before implementing.",
    },
  });
  const ticket = await created.json();
  const queued = await page.request.post("/api/orchestration/queue", {
    data: {
      actor,
      ticket: ticket.meta.id,
      revision: ticket.revision,
      kind: "work",
      worker: "Question fixture",
    },
  });
  expect(queued.ok(), await queued.text()).toBe(true);
  const run = await queued.json();
  const status = async () =>
    await (await page.request.get("/api/orchestration")).json();
  await expect
    .poll(
      async () =>
        (await status()).runs.find((r: any) => r.id === run.id)?.state,
    )
    .toBe("waiting_input");
  const current = (await status()).runs.find((r: any) => r.id === run.id);
  const questionId = current.questionId;
  const context = async () =>
    await (
      await page.request.get(`/api/records/${ticket.meta.id}/context`)
    ).json();
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "board" },
  });
  await page.goto(`/#ticket=${ticket.meta.id}`);
  const card = page.locator(`#question-${questionId}`);
  await expect(
    card.getByRole("button", { name: "Answer and retry", exact: true }),
  ).toBeVisible();
  return {
    ticket,
    run: current,
    questionId,
    card,
    context,
    status,
    cleanup: async () => {
      for (const r of (await status()).runs.filter(
        (r: any) =>
          r.ticket === ticket.meta.id &&
          [
            "queued",
            "running",
            "launching",
            "verifying",
            "waiting_input",
            "recovery",
            "awaiting_review",
          ].includes(r.state),
      ))
        await page.request.post(`/api/orchestration/${r.id}/stop`, {
          data: { actor },
        });
      const latest = await status();
      await page.request.put("/api/orchestration/config", {
        data: { actor, config: previous.config, revision: latest.revision },
      });
      fs.rmSync(repository, { recursive: true, force: true });
    },
  };
}

test("default managed answer retries once and shows the successor state in the conversation", async ({
  page,
}) => {
  const f = await fixture(page);
  try {
    await f.card.getByLabel("Answer this question").fill("Use teal.");
    await f.card.screenshot({ path: "/private/tmp/cr85-question-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      f.card.getByRole("button", { name: "Answer and retry", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await f.card
      .getByRole("button", { name: "Answer and retry", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/private/tmp/cr85-question-mobile.png" });
    await f.card
      .getByRole("button", { name: "Answer and retry", exact: true })
      .click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect
      .poll(
        async () =>
          (await f.status()).runs.filter((r: any) => r.previous === f.run.id)
            .length,
      )
      .toBe(1);
    const q = (await f.context()).comments.find(
      (c: any) => c.id === f.questionId,
    );
    expect(q.resolved).toBe(true);
    expect(q.replies).toHaveLength(1);
    expect(q.replies[0].body).toBe("Use teal.");
    expect(q.replies[0].actor).toEqual({ name: "You", kind: "human" });
    await page
      .getByRole("navigation", { name: "Record sections" })
      .getByRole("button", { name: /Conversation/ })
      .click();
    const thread = page.locator(`#thread-${f.questionId}`);
    await expect(thread.getByRole("status")).toContainText(
      /Retry|Still waiting/,
    );
    await expect
      .poll(
        async () =>
          (await f.status()).runs.find((r: any) => r.previous === f.run.id)
            ?.state,
      )
      .toBe("waiting_input");
    await expect(thread.getByRole("status")).toContainText("Still waiting");
  } finally {
    await f.cleanup();
  }
});

test("answer only stays visibly open after reload and in Needs you; stop preserves the unsent draft", async ({
  page,
}) => {
  const f = await fixture(page);
  try {
    await f.card.getByLabel("Answer this question").fill("Use teal, but wait.");
    await f.card
      .getByRole("button", { name: "Answer only", exact: true })
      .click();
    await expect(f.card.getByRole("status")).toContainText(
      "Answer received; question still open",
    );
    await page.reload();
    await expect(f.card.getByRole("status")).toContainText("Still waiting");
    await expect(
      f.card.getByRole("button", { name: "Retry run", exact: true }),
    ).toBeEnabled();
    expect(
      (await f.status()).runs.filter((r: any) => r.previous === f.run.id),
    ).toHaveLength(0);
    await page.request.patch("/api/preferences", {
      data: { selected: null, page: "attention" },
    });
    await page.goto("/?page=attention");
    const row = page
      .locator(".list-row")
      .filter({ hasText: f.ticket.meta.title });
    await expect(row).toContainText(
      "Answer received; managed question still open",
    );
    await row.click();
    await f.card
      .getByLabel("Answer this question")
      .fill("Keep this unsent note.");
    await f.card.getByRole("button", { name: "Stop run", exact: true }).click();
    await expect(f.card.getByRole("status")).toContainText("Run stopped");
    expect(
      (await f.context()).comments.find((c: any) => c.id === f.questionId)
        .replies,
    ).toHaveLength(1);
    expect(
      await page.evaluate(
        (id) => localStorage.getItem(id),
        `question-reply:${(await (await page.request.get("/api/state")).json()).config.projectId}:${f.questionId}`,
      ),
    ).toBe("Keep this unsent note.");
    await f.card
      .getByRole("button", { name: "Dismiss stopped question" })
      .click();
    await expect(f.card).toHaveCount(0);
    expect(
      (await f.status()).runs.find((r: any) => r.id === f.run.id).state,
    ).toBe("interrupted");
  } finally {
    await f.cleanup();
  }
});

test("failed retry saves the answer and displays its recovery guard without claiming a restart", async ({
  page,
}) => {
  const f = await fixture(page, 1);
  try {
    await f.card
      .getByLabel("Answer this question")
      .fill("Proceed when allowed.");
    await f.card
      .getByRole("button", { name: "Answer and retry", exact: true })
      .click();
    await expect(f.card.getByRole("alert")).toContainText(
      "Answer saved. Retry did not start",
    );
    await expect(f.card.getByRole("alert")).toContainText(
      "Attempt limit reached",
    );
    await expect(f.card.getByRole("status")).toContainText(
      "question still open",
    );
    expect(
      (await f.context()).comments.find((c: any) => c.id === f.questionId)
        .resolved,
    ).toBe(false);
    expect(
      (await f.status()).runs.filter((r: any) => r.previous === f.run.id),
    ).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});

test("an answer from the older reply control can retry without another answer or Resolve", async ({
  page,
}) => {
  const f = await fixture(page);
  try {
    const legacyReply = await page.request.post(
      `/api/records/${f.ticket.meta.id}/comments`,
      {
        data: {
          actor,
          kind: "comment",
          body: `Reply to question ${f.questionId} from Question fixture\n\n> Should the control use teal?\n\nSeems good.`,
        },
      },
    );
    expect(legacyReply.ok()).toBe(true);
    await page.reload();
    await expect(f.card.getByRole("status")).toContainText(
      "Answer received; question still open",
    );
    await expect(f.card.getByLabel("Answer this question")).toHaveValue("");
    await f.card
      .getByRole("button", { name: "Retry run", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await f.status()).runs.filter((r: any) => r.previous === f.run.id)
            .length,
      )
      .toBe(1);
    const context = await f.context();
    const question = context.comments.find((c: any) => c.id === f.questionId);
    expect(question.resolved).toBe(true);
    expect(question.replies).toBeUndefined();
    expect(
      context.comments.filter(
        (c: any) => c.kind === "comment" && c.body.includes("Seems good."),
      ),
    ).toHaveLength(1);
  } finally {
    await f.cleanup();
  }
});
