import test from "node:test";
import assert from "node:assert/strict";
import { microtasks, editMicrotask } from "../src/microtasks.js";
test("microtask edits preserve surrounding prose, acceptance criteria and direct edits", () => {
  const source =
    "Custom description\n## Acceptance criteria\n- [ ] Preserve me\n\n## Microtasks\nA note\n- [ ] First\n- [x] Second\n\n## Other\nUnrelated";
  let body = editMicrotask(source, "up", 1);
  assert.deepEqual(
    microtasks(body).items.map((i) => i.text),
    ["Second", "First"],
  );
  body = editMicrotask(body, "toggle", 1);
  body = editMicrotask(body, "rename", 1, "Renamed");
  body = editMicrotask(body, "remove", 0);
  body = editMicrotask(body, "add", 0, "Third");
  assert.deepEqual(
    microtasks(body).items.map((i) => [i.text, i.done]),
    [
      ["Renamed", true],
      ["Third", false],
    ],
  );
  assert.ok(
    body.startsWith(
      "Custom description\n## Acceptance criteria\n- [ ] Preserve me",
    ),
  );
  assert.ok(body.includes("A note"));
  assert.ok(body.endsWith("## Other\nUnrelated"));
  assert.equal(editMicrotask(body, "add", 0, "  "), body);
  assert.equal(
    microtasks(editMicrotask("Description", "add", 0, "One")).items.length,
    1,
  );
});

test("a documented checklist in a fenced example is not the editable checklist", () => {
  const example = "```md\n## Microtasks\n- [ ] Example only\n```";
  assert.equal(microtasks(example).items.length, 0);
  const added = editMicrotask(example, "add", 0, "Real task");
  assert.ok(added.startsWith(example));
  assert.equal(microtasks(added).items[0].text, "Real task");
});

test("fenced examples inside the Microtasks section stay untouched", () => {
  const source =
    "## Microtasks\n- [ ] Real item\n```md\n- [ ] Example only\n```\n";
  assert.equal(microtasks(source).items.length, 1);
  assert.ok(
    editMicrotask(source, "toggle", 0).includes(
      "```md\n- [ ] Example only\n```",
    ),
  );
});
