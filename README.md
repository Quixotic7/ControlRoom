# Control Room

A project-local workspace for humans and coding agents: a shared task board, durable project decisions, a UI rulebook, and screenshot feedback that agents can read.

Each project owns its tool copy and Markdown records. Git worktrees connect to the main checkout's canonical records. No hosted service, AI API key, or agent execution platform is required.

## Run this checkout

The dependencies, local Node runtime, production web build, and macOS capture companion have been prepared in this workspace.

```sh
./workboard serve --open
```

Or double-click **Workboard.command**. The launcher prints the local URL. Close it with Control-C when finished. If a CLI command already started a background service, the launcher connects to that service. Use `./workboard stop` to shut down a background service.

For a fresh clone:

```sh
npm ci
npm run setup:runtime
PATH="$PWD/.runtime/node_modules/node/bin:$PATH" npm run build
npm run build:native       # macOS, requires Xcode command-line tools
./workboard serve --open
```

Node 24.21.0 is installed under `.runtime/`, without replacing global Node. The first setup requires internet access; ordinary use is local. The native app is ad-hoc signed for local development, not notarized for third-party distribution.

## Install inside another project

```sh
./workboard install /absolute/path/to/project
```

This copies a versioned, built installation and its dependencies into the destination's `.workboard/tool/`, writes a project command and `Workboard.command`, and creates its data folder if needed. It does not modify existing agent instructions or commit anything. The installed tool includes a private Node runtime. The native binary targets the architecture on which it was built.

```sh
cd /absolute/path/to/project
./.workboard/workboard serve --open
```

To refresh an installation, build this checkout and run `./workboard upgrade /absolute/path/to/project`. Project records and local images are preserved. Exit the running project service before upgrading it. The tool directory is Git-ignored; the command, metadata, and records remain portable. A fresh clone needs its tool installed again and an attachment backup restored if images are needed.

## Daily workflow

The interface follows Juice Lab's visual style: a dark dotted workspace, compact toolbar navigation, outlined module-like panels, and colored workflow indicators. Backlog uses warm white, selected work blue, active work teal, review orange, and completed work green. Labels accompany the colors. Shared appearance tokens live in `web/styles.css`; Comfortable and Compact density remain available.

- Create tickets and group related work beneath parent tickets. Use labels and priorities to organize them.
- For quick entry, type a short title in **Add a ticket…** under any workflow column and press Enter. It creates the ticket in that column and parent goal, keeps the box ready for another, and leaves the description optional.
- Tickets display sequential numbers starting at **#0**. Numbers are durable Markdown metadata; existing internal identifiers remain intact so links and history survive upgrades. CLI commands accept a number such as `show 0`.
- Ticket dialogs are centered. Save, Close, Escape, and clicking the backdrop save changes and close the dialog. Saves send only the fields you changed: if someone else edited different fields meanwhile, your changes are applied on top of theirs. Overlapping edits or validation failures keep the draft open and let you keep your edits on top, reload theirs, or discard. **Discard changes** closes without saving. Add comments directly below the description; owner and label fields suggest existing values as you type.
- Approve a parent's scope to let agents select and prioritize child work. Standalone tickets can also be explicitly approved.
- Columns default to **Backlog → Selected For Development → In Progress → Review → Done**. Edit names, order, and stage roles in Settings.
- Use **Needs you** for open questions, blocked tasks, reviews, and changed project knowledge.
- Submit work with a handoff and verification evidence; humans accept Done. Parent completion is explicit.
- Decisions preserve rationale and predecessors. Both humans and agents can accept guidance, with history.
- Rules carry scope labels, strength, category, rationale, references, and example images. Existing code tokens and components remain canonical.
- The interface remembers the last view and density locally in project runtime state. Press **N** for a new ticket and **⌘K** to focus search. Use ticket status controls instead of dragging when preferred.

## Agent interface

See [AGENT_GUIDE.md](AGENT_GUIDE.md) for the participation protocol. Add a short reference to that guide to your existing coding-agent instructions; setup deliberately does not overwrite them.

```sh
./workboard list --json
./workboard context WB-... --json
./workboard claim WB-... --agent --actor agent-session --worktree /path/to/worktree
./workboard move WB-... progress --revision HASH --agent --actor agent-session
./workboard comment WB-... --body "Found a dependency on the search component." --agent --actor agent-session
./workboard review WB-... --revision HASH --handoff "Implemented the change." --evidence "Relevant tests passed." --agent --actor agent-session
```

Use `show ID --json` for the current revision before updating. A stale edit returns a conflict instead of overwriting another contributor. Reread and reconcile; do not blindly retry. Claims last 30 minutes and can be renewed by repeating the claim with the same actor and worktree. Stale claims remain visible. A claim or task status is not proof that a process is running.

Agent updates rely on the agent following the protocol. Control Room does not monitor arbitrary LLM conversations or infer completion from source edits. The CLI starts a local service when necessary and supports readable or JSON output. Actor names are attribution, not a security boundary between programs under the same OS account.

## Files and worktrees

```text
.workboard/
  config.yml                 project identity, columns, capture shortcut
  records/
    tickets/*.md             title, metadata, Markdown brief
    comments/*.md            attributed conversations and questions
    decisions/*.md           durable project choices
    rules/*.md               UI guidance and references
    history/*.md             before/after revisions from coordinated edits
    attachments/*.json       normalized annotation geometry and image identity
    attachments/*.md         readable annotation instructions
  staging/*.json             proposed document imports
  assets/                    ignored base images and annotated previews
  .local/                    ignored service, preferences, claims, capture drafts
  tool/                      ignored versioned installation
```

Git tracks text and geometry; images stay local. Export a backup to transfer both. The application uses a disposable in-memory index rebuilt from files; there is no independent authoritative database.

Other worktrees resolve the main checkout using Git metadata. A Git submodule uses its superproject's board when the superproject already has one, so agents working inside a submodule update the same board; a submodule of a project without a board keeps its own. Their copied records are not the live board. Use the shared service/CLI or edit the canonical files. If the canonical checkout changes branches, application writes pause until you review and acknowledge that branch in Settings. Reconciliation accepts the current files; it does not merge divergent task history. Commit, merge, and push records explicitly with your normal Git workflow.

Direct Markdown edits are detected, and malformed or future-schema records are reported without rewriting them. Unknown frontmatter and unrelated body content survive coordinated edits. Direct editors cannot honor service locks automatically, so prefer the CLI for concurrent writes. File watchers have a periodic-refresh fallback. Images referenced by a fresh text-only clone display as missing while their written instructions remain available.

## Screenshot feedback

Paste or drop an image anywhere, attach it to a record, or capture through the native companion. The default global shortcut is **double-tap Option / Alt**: tap and release twice quickly without another key or mouse click. Configure shortcuts in Settings and use the **Shortcuts** button (or **?**) for in-app help. The menu-bar **CR** item also offers capture. The most recently focused project receives the screenshot.

macOS may ask for Input Monitoring permission for the double-Option shortcut and Screen Recording permission for Workboard Capture. The listener detects the shortcut without recording key contents. Select a desktop region, use Space for a window, or Escape to cancel. Native capture requires a running companion; paste/drop works without it.

The **Screenshots** tab keeps every image and its editable annotations, including screenshots with no ticket. **Save screenshot** saves to the library and closes the editor; attaching to a ticket is optional. Closing with unsaved marks (Escape or ×) asks whether to save, discard, or keep editing. Select a mark and press **Delete / Backspace** to remove it. **⌘Z** undoes annotation changes, while typing in a text field retains normal text editing behavior.

Draw, add text, pins, boxes, or arrows; use Select / move to reposition them. Add a written instruction for each mark. Save to one ticket or split a selected annotation (or all unresolved annotations) into linked tickets. Resolve annotations individually. Agent context includes base-image and preview paths, image hash/dimensions, normalized geometry, and stable written references.

If a destination disappears during capture, its PNG draft remains in the project's local capture-drafts folder. Recover it from Settings after restarting the project. Copying an image to another running project retains the original, so existing links do not break.

## Import existing knowledge

Select source documents, UI components, token files, and screenshots in Import project knowledge, copy the generated briefing to your existing agent, and have it return a JSON array. Screenshot briefings include local file paths for the agent to open; they do not embed image bytes:

```json
[{"kind":"decision","title":"Prefer inline validation","body":"## Why\nKeep corrections close to their fields.","references":["docs/design-notes.md"]}]
```

Load that JSON in the browser or run `./workboard import stage --file proposals.json --agent --actor agent-session`. Review and select proposals before applying them. Imports preserve original documents and link back to them. If source contents change after staging, regenerate the proposal. Imported decisions and rules start as proposals.

## Backup and recovery

Export through Settings or `./workboard export --output project-backup.json.gz`. Restore into an empty initialized project using Settings or `./workboard restore --file project-backup.json.gz`. Existing records are never overwritten. Backup paths, sizes, and checksums are validated; tokens, process IDs, and claims are excluded. Keep a separate copy of exports if they are intended as backups.

## Development and validation

```sh
PATH="$PWD/.runtime/node_modules/node/bin:$PATH" npm run typecheck
PATH="$PWD/.runtime/node_modules/node/bin:$PATH" npm test
PATH="$PWD/.runtime/node_modules/node/bin:$PATH" npm run build
PLAYWRIGHT_BROWSERS_PATH=.runtime/browsers ./node_modules/.bin/playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=.runtime/browsers ./node_modules/.bin/playwright test
dist/WorkboardCapture.app/Contents/MacOS/WorkboardCapture --self-test
```

The browser suite uses a sample project in an isolated temporary directory, separate from your actual project records. Its screenshots go to `test-results/`. `./workboard serve --dev` enables Vite for frontend development. The normal launcher serves the production build. See [VALIDATION.md](VALIDATION.md) for test results and the remaining interactive macOS checks.

Native shortcut registration is testable without taking a screenshot. End-to-end desktop region selection and macOS permission dialogs require an interactive check on the user's desktop. The tool is local single-user software; hosted access, agent execution, automatic commits, and Windows/Linux native capture are not included.
