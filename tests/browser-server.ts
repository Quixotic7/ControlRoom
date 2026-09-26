import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Store } from "../src/store";
import { buildServer } from "../src/server";
const root = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "workboard-browser-")),
);
const store = new Store(root).initialize("Meridian");
if (!store.list().length) {
  const actor = { name: "Morgan", kind: "human" as const };
  const parent = await store.create(
    "ticket",
    {
      title: "A calmer customer experience",
      scopeApproved: true,
      labels: ["customer-portal"],
      priority: 1,
    },
    "## Outcome\nMake everyday customer workflows feel clear and consistent.\n",
    actor,
  );
  await store.create(
    "ticket",
    {
      title: "Preserve search between views",
      status: "selected",
      parent: parent.meta.id,
      labels: ["navigation"],
      priority: 1,
    },
    "## Outcome\nKeep the search query when switching views.\n\n## Acceptance\n- [ ] The same customers stay visible.\n",
    actor,
  );
  await store.create(
    "ticket",
    {
      title: "Simplify narrow-screen navigation",
      status: "progress",
      parent: parent.meta.id,
      labels: ["interface"],
      owner: "Agent A",
      handoff: "Layout changes underway. Reviewing mobile labels.",
      priority: 1,
    },
    "Keep essential actions visible on a phone.",
    actor,
  );
  await store.create(
    "ticket",
    {
      title: "Align the search action",
      status: "review",
      parent: parent.meta.id,
      labels: ["visual-feedback"],
      owner: "Agent B",
      handoff: "Updated spacing and button label.",
      evidence: "Layout assertions passed at 390 and 1280 pixels.",
      priority: 2,
    },
    "Align the search action with its field.",
    actor,
  );
  const blocked = await store.create(
    "ticket",
    {
      title: "Choose empty-state wording",
      status: "progress",
      parent: parent.meta.id,
      blocked: "Needs product wording",
      labels: ["content"],
      owner: "Agent C",
    },
    "Explain what the user can do next.",
    actor,
  );
  await store.comment(
    blocked.meta.id,
    "Should an empty search offer to create a customer?",
    { name: "Agent C", kind: "agent" },
    "question",
  );
  await store.create(
    "ticket",
    {
      title: "Show who wrote each comment",
      status: "done",
      parent: parent.meta.id,
      labels: ["collaboration"],
      owner: "Morgan",
    },
    "Attribution is consistent across views.",
    actor,
  );
  await store.create(
    "ticket",
    {
      title: "Export a project handoff",
      labels: ["agent-workflow"],
      priority: 3,
    },
    "Package the essential context for a fresh session.",
    actor,
  );
  await store.create(
    "decision",
    {
      title: "Keep the main action below the search field",
      status: "accepted",
    },
    "## Why\nPreserve the full field width on narrow screens.\n\n## Alternatives\nAn inline button makes the field too short.",
    actor,
  );
  await store.create(
    "rule",
    {
      title: "One primary action per form",
      status: "active",
      strength: "required",
      category: "components",
      scope: ["interface"],
    },
    "## Rule\nUse the existing PrimaryButton for the main action.\n\n## Why\nMake the next step easy to identify.",
    actor,
  );
}
const app = await buildServer(store);
await app.listen({ host: "127.0.0.1", port: 4178 });
console.log("Browser test project ready");
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
