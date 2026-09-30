import { test, expect, type Page } from "@playwright/test";

const fixtureActor = { name: "Quick approval reviewer", kind: "human" };
const webActor = { name: "You", kind: "human" };

async function create(page: Page, title: string, meta = {}) {
  const response = await page.request.post("/api/records", {
    data: {
      kind: "ticket",
      meta: { title, ...meta },
      body: "Acceptance criteria and unrelated body stay intact.",
      actor: fixtureActor,
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function record(page: Page, id: string) {
  return (await page.request.get(`/api/records/${id}`)).json();
}

test.beforeEach(async ({ page }) => {
  await page.request.get("/");
  await page.request.patch("/api/preferences", {
    data: { selected: null, page: "project", viewId: "board", theme: "dark" },
  });
});

for (const layout of ["Board", "Table"] as const) {
  test(`${layout.toLowerCase()} quick actions approve scope and accept review from the keyboard`, async ({
    page,
  }) => {
    const suffix = `${layout}-${Date.now()}`;
    const label = `quick-approval-${suffix}`;
    const planned = await create(page, `Planned ${suffix}`, {
      labels: [label],
      owner: "Keep this owner",
      customField: "Keep this field",
    });
    const review = await create(page, `Review ${suffix}`, {
      labels: [label],
      status: "review",
      handoff: `Summary ${suffix}`,
      evidence: `Evidence ${suffix}`,
      customField: "Review field stays",
    });

    await page.goto("/");
    await page.getByLabel("Filter tickets").fill(`label:${label}`);
    if (layout === "Table")
      await page.getByRole("button", { name: "Table", exact: true }).click();

    const plannedActions = page.getByLabel(`Actions for ${planned.meta.title}`);
    const approve = plannedActions.getByRole("button", {
      name: "Approve scope",
      exact: true,
    });
    await approve.focus();
    await approve.press("Enter");
    if (layout === "Table")
      await expect(plannedActions.getByText("Approved scope")).toBeVisible();
    else
      await expect(
        page
          .locator(".board-ticket")
          .filter({ hasText: planned.meta.title })
          .getByText("Approved scope"),
      ).toBeVisible();

    const reviewActions = page.getByLabel(`Actions for ${review.meta.title}`);
    const disclosure = reviewActions.locator("summary");
    await disclosure.focus();
    await disclosure.press("Enter");
    await expect(reviewActions.getByText(`Summary ${suffix}`)).toBeVisible();
    await expect(reviewActions.getByText(`Evidence ${suffix}`)).toBeVisible();

    // Insecure LAN origins do not expose crypto.randomUUID. The shared helper
    // must fall back to crypto.getRandomValues and still send the acceptance.
    await page.evaluate(() => {
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        configurable: true,
        value: undefined,
      });
    });
    const accept = reviewActions.getByRole("button", {
      name: "Accept into Done",
      exact: true,
    });
    await accept.focus();
    await accept.press("Enter");
    if (layout === "Table")
      await expect(
        reviewActions.getByText("Saved", { exact: true }),
      ).toBeVisible();
    await expect
      .poll(async () => (await record(page, review.meta.id)).meta.status)
      .toBe("done");

    const approved = await record(page, planned.meta.id);
    expect(approved.meta.status).toBe(planned.meta.status);
    expect(approved.meta.scopeApprovedBy).toEqual(webActor);
    expect(approved.meta.owner).toBe("Keep this owner");
    expect(approved.meta.customField).toBe("Keep this field");

    const accepted = await record(page, review.meta.id);
    expect(accepted.meta.status).toBe("done");
    expect(accepted.meta.acceptedBy).toEqual(webActor);
    expect(accepted.meta.handoff).toBe(`Summary ${suffix}`);
    expect(accepted.meta.evidence).toBe(`Evidence ${suffix}`);
    expect(accepted.meta.customField).toBe("Review field stays");
    expect(accepted.body).toBe(
      "Acceptance criteria and unrelated body stay intact.",
    );
  });
}

test("grouped parent headers expose scope approval and Review acceptance", async ({
  page,
}) => {
  for (const layout of ["Board", "Table"] as const) {
    const suffix = `${layout}-parent-${Date.now()}`;
    const label = `group-approval-${suffix}`;
    const planned = await create(page, `Planned parent ${suffix}`, {
      labels: [label],
      owner: "Parent owner stays",
    });
    await create(page, `Planned child ${suffix}`, {
      labels: [label],
      parent: planned.meta.id,
    });
    const review = await create(page, `Review parent ${suffix}`, {
      labels: [label],
      status: "review",
      handoff: `Parent summary ${suffix}`,
      evidence: `Parent evidence ${suffix}`,
    });
    await create(page, `Review child ${suffix}`, {
      labels: [label],
      parent: review.meta.id,
    });
    const archived = await create(page, `Archived parent ${suffix}`, {
      archived: true,
      labels: [label],
      status: "review",
      handoff: `Archived summary ${suffix}`,
      evidence: `Archived evidence ${suffix}`,
    });
    await create(page, `Archived child ${suffix}`, {
      labels: [label],
      parent: archived.meta.id,
    });

    await page.goto("/");
    await page.getByLabel("Filter tickets").fill(`label:${label}`);
    if (layout === "Table")
      await page.getByRole("button", { name: "Table", exact: true }).click();

    const plannedHeader = page
      .locator(".group-header")
      .filter({ hasText: planned.meta.title });
    const plannedActions = plannedHeader.getByLabel(
      `Actions for ${planned.meta.title}`,
    );
    await plannedActions.getByRole("button", { name: "Approve scope" }).click();
    await expect(plannedActions.getByText("Approved scope")).toBeVisible();

    const reviewHeader = page
      .locator(".group-header")
      .filter({ hasText: review.meta.title });
    const reviewActions = reviewHeader.getByLabel(
      `Actions for ${review.meta.title}`,
    );
    await reviewActions.locator("summary").click();
    await expect(
      reviewActions.getByText(`Parent summary ${suffix}`),
    ).toBeVisible();
    await expect(
      reviewActions.getByText(`Parent evidence ${suffix}`),
    ).toBeVisible();
    await reviewActions
      .getByRole("button", { name: "Accept into Done" })
      .click();
    await expect
      .poll(async () => (await record(page, review.meta.id)).meta.status)
      .toBe("done");

    const archivedHeader = page
      .locator(".group-header")
      .filter({ hasText: archived.meta.title });
    await expect(
      archivedHeader.getByText("Archived parent", { exact: true }),
    ).toBeVisible();
    const archivedActions = archivedHeader.getByLabel(
      `Actions for ${archived.meta.title}`,
    );
    await expect(
      archivedActions.getByRole("button", { name: "Approve scope" }),
    ).toBeDisabled();
    await archivedActions.locator("summary").click();
    await expect(
      archivedActions.getByText(`Archived summary ${suffix}`),
    ).toBeVisible();
    await expect(
      archivedActions.getByRole("button", { name: "Accept into Done" }),
    ).toBeDisabled();

    const approved = await record(page, planned.meta.id);
    expect(approved.meta.status).toBe(planned.meta.status);
    expect(approved.meta.scopeApprovedBy).toEqual(webActor);
    expect(approved.meta.owner).toBe("Parent owner stays");
    expect((await record(page, review.meta.id)).meta.acceptedBy).toEqual(
      webActor,
    );
    expect((await record(page, archived.meta.id)).meta.status).toBe("review");
  }
});

test("approved and inherited scope are distinct in board and table views", async ({
  page,
}) => {
  const suffix = Date.now();
  const label = `scope-state-${suffix}`;
  const parent = await create(page, `Approved parent ${suffix}`, {
    labels: [label],
    scopeApproved: true,
  });
  const child = await create(page, `Inherited child ${suffix}`, {
    labels: [label],
    parent: parent.meta.id,
  });

  await page.goto("/");
  await page.getByLabel("Filter tickets").fill(`label:${label}`);
  for (const layout of ["Board", "Table"] as const) {
    if (layout === "Table")
      await page.getByRole("button", { name: "Table", exact: true }).click();
    const parentActions = page.getByLabel(`Actions for ${parent.meta.title}`);
    await expect(parentActions.getByText("Approved scope")).toBeVisible();
    if (layout === "Table") {
      const childActions = page.getByLabel(`Actions for ${child.meta.title}`);
      await expect(childActions.getByText(/Inherited scope/)).toBeVisible();
      await expect(
        childActions.getByRole("button", { name: "Approve scope" }),
      ).toHaveCount(0);
    } else {
      const childCard = page
        .locator(".board-ticket")
        .filter({ hasText: child.meta.title });
      await expect(childCard.getByText(/Inherited scope/)).toBeVisible();
    }
    await expect(
      parentActions.getByRole("button", { name: "Approve scope" }),
    ).toHaveCount(0);
  }
});

test("selected scope approval reports success, ineligible items, and a stale failure per ticket", async ({
  page,
}) => {
  const suffix = Date.now();
  const label = `selected-approval-${suffix}`;
  const good = await create(page, `Scope good ${suffix}`, { labels: [label] });
  const stale = await create(page, `Scope stale ${suffix}`, {
    labels: [label],
  });
  const explicit = await create(page, `Scope explicit ${suffix}`, {
    labels: [label],
    scopeApproved: true,
  });
  const parent = await create(page, `Scope ancestor ${suffix}`, {
    labels: [label],
    scopeApproved: true,
  });
  const inherited = await create(page, `Scope inherited ${suffix}`, {
    labels: [label],
    parent: parent.meta.id,
  });

  await page.goto("/");
  await page.getByLabel("Filter tickets").fill(`label:${label}`);
  await page.getByRole("button", { name: "Table", exact: true }).click();
  for (const ticket of [good, stale, explicit, inherited])
    await page.getByLabel(`Select ${ticket.meta.title}`).check();
  await expect(page.getByText("4 selected", { exact: true })).toBeVisible();
  const action = page.getByRole("button", {
    name: "Approve scope (2 eligible)",
    exact: true,
  });

  let changed = false;
  await page.route("**/api/approval-actions", async (route) => {
    if (changed) return route.continue();
    changed = true;
    const latest = await record(page, stale.meta.id);
    const response = await page.request.patch(`/api/records/${stale.meta.id}`, {
      data: {
        revision: latest.revision,
        patch: { owner: "Concurrent editor" },
        actor: fixtureActor,
      },
    });
    expect(response.ok()).toBeTruthy();
    await route.continue();
  });
  await action.click();

  const results = page.locator(".approval-results");
  await expect(results).toContainText("1 succeeded");
  await expect(results).toContainText("2 ineligible");
  await expect(results).toContainText("1 failed");
  await expect(results).toContainText(good.meta.title);
  await expect(results).toContainText(explicit.meta.title);
  await expect(results).toContainText(inherited.meta.title);
  await expect(results).toContainText(stale.meta.title);
  await expect(results).toContainText("already explicitly approved");
  await expect(results).toContainText("inherited from");
  await expect(results).toContainText("This record changed");
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();

  expect((await record(page, good.meta.id)).meta.scopeApprovedBy).toEqual(
    webActor,
  );
  expect(
    (await record(page, stale.meta.id)).meta.scopeApproved,
  ).toBeUndefined();
  expect((await record(page, stale.meta.id)).meta.owner).toBe(
    "Concurrent editor",
  );
  expect(
    (await record(page, inherited.meta.id)).meta.scopeApproved,
  ).toBeUndefined();
});
