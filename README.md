# Control Room

A project-local workspace for humans and coding agents: a shared task board, durable project decisions, a UI rulebook, and screenshot feedback that agents can read.

Each project owns its tool copy and Markdown records. Git worktrees connect to the main checkout's canonical records. No hosted service, AI API key, or agent execution platform is required.

## Moving an existing project to ControlRoom names

New installations use `.controlroom/`, `controlroom`, and `ControlRoom.command`. Existing `.workboard/` projects continue to open in place until explicitly migrated. The legacy `workboard` command and `WORKBOARD_ACTOR` / `WORKBOARD_ACTOR_KIND` environment variables remain compatibility aliases. Prefer `CONTROLROOM_ACTOR` / `CONTROLROOM_ACTOR_KIND` in new agent setups. MCP reports its name as `controlroom`; tool names and record IDs remain stable.

1. Export a backup with the current installation, including local screenshots: `./.workboard/workboard export --output controlroom-backup.json.gz`.
2. Stop the service: `./.workboard/workboard stop`. Wait for it to exit, and pause agents/direct Markdown editors.
3. Build this source checkout, then run `./controlroom upgrade /absolute/path/to/project` from it. This updates the runtime in the existing folder without moving records. It also installs `./.workboard/controlroom`.
4. From the project run `./.workboard/controlroom migrate`. This atomically renames `.workboard` to `.controlroom`, retaining project identity, records, history, images and preferences. It refuses a running service or ambiguous dual directories. Source-checkout users can run `./controlroom migrate --project /absolute/path/to/project` from the tool checkout instead.
5. Update custom root wrappers, external scripts, agent instructions and MCP configuration to the new path: `claude mcp add controlroom --env CONTROLROOM_ACTOR=my-session -- /absolute/path/to/project/.controlroom/controlroom mcp`. Custom launchers are not overwritten automatically. Start with `./.controlroom/controlroom serve --open` or the generated `ControlRoom.command`.
6. Review the directory rename in Git and commit it when ready. The tool never commits or pushes automatically. Keep your export until you have checked tickets and screenshots.

Do not manually copy both folders into one project: ControlRoom refuses to pick between them. To roll back the folder name, stop the service and move `.controlroom` back to `.workboard` only when the destination does not exist, then adjust external paths. The upgraded runtime reads either name; a fresh clone must reinstall its ignored tool runtime as before. Source checkouts without an installed project wrapper continue to use the source `controlroom --project ...` command.

The native capture companion retains its legacy bundle identifier and shared runtime rendezvous directory for cross-version coordination. These internal compatibility identifiers are not a second project data store.

## Run this checkout

The dependencies, local Node runtime, production web build, and macOS capture companion have been prepared in this workspace.

```sh
./controlroom serve --open
```

Or double-click **ControlRoom.command**. The launcher prints the local URL. Close it with Control-C when finished. If a CLI command already started a background service, the launcher connects to that service. Use `./controlroom stop` to shut down a background service.

For a fresh clone:

```sh
npm ci
npm run setup:runtime
PATH="$PWD/.runtime/node_modules/node/bin:$PATH" npm run build
npm run build:native       # macOS, requires Xcode command-line tools
./controlroom serve --open
```

Node 24.21.0 is installed under `.runtime/`, without replacing global Node. The first setup requires internet access; ordinary use is local. The native app is ad-hoc signed for local development, not notarized for third-party distribution.

## Install inside another project

```sh
./controlroom install /absolute/path/to/project
```

This copies a versioned, built installation and its dependencies into the destination's `.controlroom/tool/`, writes a project command and `ControlRoom.command`, and creates its data folder if needed. It does not modify existing agent instructions or commit anything. The installed tool includes a private Node runtime. The native binary targets the architecture on which it was built.

```sh
cd /absolute/path/to/project
./.controlroom/controlroom serve --open
```

To refresh an installation, build this checkout and run `./controlroom upgrade /absolute/path/to/project`. Project records and local images are preserved. Exit the running project service before upgrading it. The tool directory is Git-ignored; the command, metadata, and records remain portable. A fresh clone needs its tool installed again and an attachment backup restored if images are needed.

## Access from another device on your LAN

Local-only access is the default. To enable this project's trusted-LAN mode, stop its service and restart using its usual port:

```sh
./.controlroom/controlroom stop
./.controlroom/controlroom serve --lan --port 4173
```

In the tool source checkout, use `./controlroom`; in a legacy installation, use `.workboard/controlroom`. **Settings & backups → Network access** also saves the mode and explains any required restart. The choice persists across normal launches. Local agents and native capture continue to connect through `127.0.0.1`.

By default, open Settings on the host and generate a pairing code. Open the displayed LAN address on the other device and enter that code. Codes are single-use and expire after ten minutes; generating another replaces the previous code. **Paired access duration (hours)** sets how long new pairings last, from 0.25 (15 minutes) to 8760 (365 days), with an eight-hour default. Existing sessions keep their original expiry. **Revoke all remote sessions** disconnects them without changing local agent credentials.

To open the board directly without a code, turn off **Require pairing code** in Network access. Devices on the permitted LAN can then read and edit the project without a session timer. Changing this option clears existing sessions and unused codes; turning it back on immediately requires fresh pairing. Disabling LAN blocks remote requests in either mode; restart with `--local` to return the listener to loopback only. Authentication settings persist across restarts and CLI mode changes.

This mode uses **unencrypted HTTP on a trusted LAN**. It is not public hosting: there is no TLS, port forwarding, or automatic firewall change. Only current private IPv4 interface addresses are accepted; hostnames, public addresses, and IPv6 LAN access are not supported. If another device cannot connect, check the address in Settings, host firewall access, and Wi-Fi guest/client isolation. Reopen Settings after an interface address changes.

Remote browsers can edit records, comments and screenshot annotations, upload images, and download backups after pairing, or directly when pairing is disabled. Network administration, native Mac capture, host-document imports, shared configuration, branch reconciliation, shutdown and backup restore remain available only on the host in both modes. Remote access permits project-wide editing; identity labels are attribution, not separate user permissions. Pairing after a session expires retains open ticket drafts. Do not share the local project token or put pairing credentials in URLs.

LAN preferences and hashed sessions live in ignored `.local/` state. They are excluded from exports and Git; restoring or cloning a project starts with local-only defaults and requires fresh pairing.

## Daily workflow

The interface is laid out like GitHub Projects and styled after Juice Machine Lab: a near-black dotted workspace (a light counterpart follows your system, or the **Theme** choice in the **⋯** menu), node-like cards with a thin border and a colored edge, small uppercase captions set in Rajdhani (bundled, no network needed), and a blue selection glow. Workflow stages carry status icons and colors: Backlog gray, Selected blue, In Progress cyan (half disc), Review orange (dot ring), and Done green (check). Labels take a stable color from their name. Shared appearance tokens live in `web/styles.css`, the project layout in `web/project.css`, and the icons and logo in `web/Icons.tsx`; Comfortable and Compact density sit beside Theme in the **⋯** menu, with screenshot upload, imports, and Settings.

- **Saved views.** The Project page shows view tabs, like GitHub Projects. Each view has a layout (**Board** or **Table**), a filter, a grouping (parent goal, status, priority, owner, or label), and a sort. Changing any of them marks the view as edited; **Save view** stores it in `config.yml` so every worktree and collaborator sees it, and **Discard** reverts. Use **＋ New view** and each tab's **⋯** menu to rename, duplicate, reorder, or delete views. Drag a tab before or after another to reorder it; the insertion line shows the destination. The selected view and unsaved edits stay intact. **Move left/right** remain available in the menu for keyboard use. A configuration change during a drag rejects that drop so newer views are preserved.
- **Filters** use GitHub-style syntax: `label:ui`, `owner:"Agent A"`, `status:review`, `priority:high`, `parent:#0`, `is:blocked`, `is:claimed`, `is:open`, `no:owner`, `has:attachments`. Separate alternatives with commas (`label:ui,forms`) and prefix `-` to exclude (`-status:done`); other words match titles, descriptions, and numbers.
- Create tickets and group related work beneath parent tickets. Grouped by parent goal, each goal heads its swimlane; click its header to open it. Use labels and priorities to organize tickets.
- For quick entry, choose **＋ Add item** under any column (or at the end of a table group), type a title, and press Enter. The ticket lands in that column and group (parent, priority, owner, or label), the box stays open for another, and Escape closes it.
- Ticket **Microtasks** are a Markdown checklist, separate from acceptance criteria and child tickets. Enter adds an item; arrow buttons reorder it. Save/close uses the ticket's revision protection. Completing the checklist never completes the ticket.
- Agents can attach persistent **questionnaires** with choices and text answers. Single-choice radios and explicit multi-choice checkboxes keep selections separate from custom notes. Compact answer fields grow with their content. Drafts stay in this browser without a timeout. Only **Submit answers** records them; recommendations are not automatic answers. Replaced questions require explicit reconciliation, and previous answers remain in the conversation/history.
- Cards, table rows and ticket details show attributed **progress estimates**, last reports and claim expiry. Elapsed time means the current In Progress session's wall-clock duration, not running-agent time. Moving back into In Progress begins a new session; old records without a start show **Start unknown**. Reports older than 30 minutes are marked stale.
- Under **More actions → Theme**, choose System, Light, Dark, or ten retro/hardware presets with previews. Themes share the same controls, saved views and screenshot geometry.
- Retro presets use locally bundled pixel typography. Elektron and Game Boy use chunkier display lettering. Windows 95, Windows 3.1, Commodore 64, Classic Mac System 7 and AmigaOS add period-inspired title bars and functional **File / View** menus to ticket, screenshot and shortcut windows. File actions use the existing save/close behavior; Escape closes an open menu before its window. These are inspired treatments rather than exact OS replicas. [Pixelify Sans](https://fontsource.org/fonts/pixelify-sans) and [Silkscreen](https://fontsource.org/fonts/silkscreen) are distributed with their original OFL notices in `web/public/licenses/` and the installed web assets.
- Screenshot-guided presets include lavender tracker panels and silver rails (Commodore 64), acid-yellow LCD lettering on charcoal hardware (Elektron), ocean-blue map grids and green toolbars (SNES), neon-magenta frames and cyan grids (Synthwave), and moss/grass colors with stepped frames (Game Boy). These use original CSS and locally bundled fonts; reference screenshots, game sprites and hardware artwork are not shipped.
- Drag the upper/lower half of a card or table row to preview insertion before/after it. The preview makes no writes; Escape cancels. Alt/Option + Up/Down moves a focused ticket with Manual or Priority sorting. Concurrent changes cancel stale moves.
- Use a column's **eye button** to hide or show its tickets. The normal column width and header remain, and **Show all columns** restores every column. Visibility is remembered in this browser per project and saved view, separately from filters and group collapse; table views are unaffected.
- A Done column's **⋯ → Archive completed tickets** previews the exact filtered set across expanded groups. Hidden columns and collapsed groups are excluded. Each ticket uses its previewed revision, with partial successes and conflicts reported. **Archived tickets** opens a searchable library with ticket details and Unarchive; restoring preserves its existing workflow stage. Children are never implicitly archived with a parent.
- Inside a ticket, **Child tickets** has an always-ready title box. Enter creates a numbered child in the first configured Backlog/intake column, shown beside the input, and keeps the parent open for repeated entry. A new or edited parent saves first. Failed saves preserve the child title for retry; finishing children never automatically finishes their parent. **Attach existing ticket** searches by title or number, excludes ancestors and existing direct children, and shows when a ticket will move from another parent. Stale revisions are rejected.
- Tickets display sequential numbers starting at **#0**. Numbers are durable Markdown metadata; existing internal identifiers remain intact so links and history survive upgrades. CLI commands accept a number such as `show 0`.
- Ticket dialogs are centered and use 95% of the viewport height, with up to 1800px of width (clamped on smaller screens). Middle-click a ticket, or use Command/Ctrl-click, to open it in its own tab; its ticket URL survives refresh. Save, Close, Escape, and clicking the backdrop save changes and close the dialog. Saves send only the fields you changed: if someone else edited different fields meanwhile, your changes are applied on top of theirs. Overlapping edits or validation failures keep the draft open and let you keep your edits on top, reload theirs, or discard. **Discard changes** closes without saving. Add comments directly below the description; owner and label fields suggest existing values as you type.
- In the conversation, **Attach screenshot to comment** opens the recent-screenshot picker and inserts a thumbnail into the draft. **Post comment** saves it into the thread; agents receive its image references in context. Screenshot-created tickets also show their image in description preview.
- Approve a parent's scope to let agents select and prioritize child work. Standalone tickets can also be explicitly approved.
- Columns default to **Backlog → Selected For Development → In Progress → Review → Done**. Edit names, order, and stage roles in Settings.
- Use **Needs you** for open questions, blocked tasks, reviews, and changed project knowledge.
- Submit work with a handoff and verification evidence; humans accept Done. Parent completion is explicit.
- Review tickets show **Accept into Done** and **Request changes** in Details and Conversation. Both open a focused optional feedback box; confirm to save pending ticket edits and the outcome. Request changes lets you add feedback and defaults to a uniquely named **Failed Review** development column; otherwise choose a development destination. Multiple Done columns require a choice. Stale reviews preserve the draft for reconciliation. Retrying the same review after a lost response does not duplicate feedback.
- Decisions preserve rationale and predecessors. Both humans and agents can accept guidance, with history.
- Agents search existing decisions before recording consequential choices, link the decision to their ticket, preserve superseded rationale, and identify decisions in the review handoff. The [agent protocol](AGENT_GUIDE.md#record-meaningful-decisions), generated ticket briefs, and MCP onboarding share this guidance. MCP provides searchable `list_knowledge` (including inactive history) and `create_decision`; the CLI supports `list --kind decision` and `create decision`.
- Rules carry scope labels, strength, category, rationale, references, and example images. Existing code tokens and components remain canonical.
- The interface remembers the last page, view, and density locally in project runtime state. Press **N** for a new ticket and **⌘K** to filter the current view. Ungrouped board views show each column as a full-height lane that scrolls on its own, with **Add item** pinned at the bottom; grouped views show swimlanes under a shared column header. Drag cards to change status (the target column highlights) or, when a view is sorted manually or by priority, to reorder; the table's status and priority controls and **↑** button do the same without dragging.

## Agent interface

See [AGENT_GUIDE.md](AGENT_GUIDE.md) for the participation protocol. Add a short reference to that guide to your existing coding-agent instructions; setup deliberately does not overwrite them.

### Short command skills

Install the bundled skills explicitly into the code checkout where your agent runs:

```sh
./.controlroom/controlroom skills install /absolute/path/to/code-checkout
# In the Control Room source checkout: ./controlroom skills install .
```

With no destination, installation targets the current execution directory (or `--worktree`), not the canonical board selected by `--project`. It does not initialize a board. The command copies portable skills to `.agents/skills/` for Codex and `.claude/skills/` for Claude Code; these can be committed with the project. Run it in another checkout if that checkout does not contain the skills. Application upgrades package the latest skills but do not overwrite installed project skills. Repeating the skill installation is safe when files match; differing existing files are refused so you can review and reconcile customizations first. Agent instruction files are not changed.

| Action | Codex skill | Claude Code command |
| --- | --- | --- |
| Refresh tickets and conversations | `$crrefresh` | `/crrefresh` |
| Inspect the next eligible approved ticket | `$crnext` | `/crnext` |
| Refresh compatibility alias | `$ccrefresh` | `/ccrefresh` |

Select the skill in Codex's skill picker or type its `$name`; these are not custom Codex slash commands. If the host has not discovered new skills, reopen the project session. In Claude Code, use `/name`. The same instructions run through the project's existing CLI or matching MCP connection, with your agent identity. Both commands are read-only: they do not claim, move, assign, accept or implement tickets.

Refresh compares record and conversation revisions, including edited comments and Done/archived tickets. On first use it reports a baseline, not invented changes. `snapshot --json --no-start` supplies a compact read-only receipt for this comparison; full `context ID --json --no-start` contains feedback and scope details. A service failure is reported rather than treated as an empty board. Skills use `--no-start` for CLI reads, or a matching MCP connection launched with `mcp --no-start`. This mode reports missing/stopped services without launching them or initializing a missing board. Existing command behavior is unchanged without that flag; `snapshot` always avoids startup.

**MCP.** `./controlroom mcp` serves the board as Model Context Protocol tools over stdio, so agents call it natively with typed arguments. For Claude Code:

```sh
claude mcp add controlroom --env CONTROLROOM_ACTOR=my-session -- ./controlroom mcp
```

Tools: `next_ticket`, `get_context`, `list_tickets`, `get_ticket`, `claim_ticket`, `release_ticket`, `create_ticket`, `update_ticket`, `move_ticket`, `comment`, `ask_question`, `submit_review`, `wait_for_update`, and `list_knowledge`. Their descriptions carry the protocol.

**CLI.** The same operations, for any harness:

```sh
./controlroom next                                   # the ticket to pick up, with its brief
./controlroom context 3 --brief                      # a prompt-ready Markdown brief with a token estimate
./controlroom list --open --mine
./controlroom claim 3
./controlroom move 3 progress --etag HASH
./controlroom comment 3 --body "Found a dependency on the search component."
./controlroom ask 3 --body "Should empty search offer to create a customer?"
./controlroom wait 3 --for comment                   # block until the human answers
./controlroom update 3 --etag HASH --set labels=ui,forms --set priority=1
./controlroom review 3 --etag HASH --handoff "Implemented the change." --run "npm test" --commits-since main
```

Identity comes from the environment: set `CONTROLROOM_ACTOR` and `CONTROLROOM_ACTOR_KIND` in the agent's launch configuration. Without them, a known agent harness or a non-interactive terminal counts as an agent, so a forgotten flag can never turn an agent into a human. Every write takes the record's etag (its content hash) from `show` or `context`; a stale etag returns a conflict with the current record instead of overwriting another contributor. `--latest` opts into writing over the current version for fields nobody else edits. `review --run` executes the verification command and records its exit code and output on the ticket, refusing a failing run unless `--allow-failure` is given; the branch is recorded automatically and `--pr` and `--commits-since` link the code. Claims last 30 minutes and are renewed by repeating the claim. A claim or task status is not proof that a process is running.

Control Room does not monitor LLM conversations or infer completion from source edits; updates rely on the agent following the protocol. The CLI starts the local service when necessary. Actor names are attribution, not a security boundary between programs under the same OS account.

## Files and worktrees

The board location and code checkout are separate. Launch the CLI/MCP from the code checkout, or pass `--worktree /absolute/code/checkout`; use `--project` to select the board. Verification commands, default claims, branches, and commit links use that execution directory. This also applies when the board belongs to a superproject and the code is a submodule.

Commands accept plain numbers (`show 0`) and quoted hash numbers (`show '#0'`). Parent/dependency inputs accept the same forms, for example `create ticket --title 'Child' --parent 0` or `update 1 --etag HASH --set dependencies=#0`. Numeric links are stored as stable internal IDs. Generated agent commands use plain numbers so they can be pasted into a shell.

```text
.controlroom/
  config.yml                 project identity, columns, capture shortcut
  records/
    tickets/*.md             title, metadata, Markdown brief
    comments/*.md            attributed conversations and questions
    decisions/*.md           durable project choices
    rules/*.md               UI guidance and references
    history.jsonl            before/after revisions from coordinated edits, one line per event
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

macOS may ask for Input Monitoring permission for the double-Option shortcut and Screen Recording permission for ControlRoom Capture. The listener detects the shortcut without recording key contents. Select a desktop region, use Space for a window, or Escape to cancel. Native capture requires a running companion; paste/drop works without it.

Native captures save silently to the active project's screenshot library, keeping focus in the source application. Open **Screenshots** later to annotate; an already open board updates automatically. Capture no longer opens a browser window or an annotation editor.

A temporary connection failure during a status or screenshot metadata read retries up to twice. If status remains unavailable after requesting capture, **Check capture status** reconnects without requesting another screenshot. An unconfirmed capture command or save is never automatically replayed, because it may already have completed. Permission warnings are reported separately from connection failures.

The **Screenshots** tab keeps every image and its editable annotations, including screenshots with no ticket. **Save screenshot** saves to the library and closes the editor; attaching to a ticket is optional. Closing with unsaved marks (Escape or ×) asks whether to save, discard, or keep editing. Select a mark and press **Delete / Backspace** to remove it. **⌘Z** undoes annotation changes, while typing in a text field retains normal text editing behavior.

Draw, add text, pins, boxes, or arrows; use Select / move to reposition them. Add a written instruction for each mark. Save to one ticket or split a selected annotation (or all unresolved annotations) into linked tickets. Resolve annotations individually. Agent context includes base-image and preview paths, image hash/dimensions, normalized geometry, and stable written references.

Use **Fit image** or **0** to see the whole screenshot, **100%** or **1** for actual pixels, and **+ / −** to zoom. Scrolling over the image zooms around the pointer. Pan with the **Pan** tool, **Space + drag**, or a middle-button drag. View changes never alter saved annotation coordinates or preview dimensions.

**Delete screenshot**, inside the screenshot editor, moves an image to **Trash**. In the library, use **Select screenshots** and **Delete selected** to remove several images; filtering drops hidden selections. Trash supports restoration inside the editor or through **Restore selected**. Deletion preserves images, annotations, backups, and existing ticket links; it does not free disk space. Trashed screenshots must be restored before editing. Concurrent deletion, restoration, and annotation saves reject stale revisions; bulk results identify failed items for review and reselection.

Inside a ticket, **Attach recent screenshot** offers searchable recent images, excluding Trash and images already attached. Picking one preserves the description draft; saving the ticket keeps its link. Attached screenshots appear as thumbnails on board cards and in ticket details. In the screenshot editor, **Attach to ticket** searches titles and ticket numbers with keyboard or pointer selection; typing alone does not change the chosen destination.

Tickets with an existing description open in Markdown preview. Choose **Edit Markdown** to change it; new or empty descriptions open ready to type.

If a destination disappears during capture, its PNG draft remains in the project's local capture-drafts folder. Recover it from Settings after restarting the project. Copying an image to another running project retains the original, so existing links do not break.

## macOS permission recovery for development builds

In Settings, **Show current capture app** reveals the exact helper for this installation. If macOS shows permission enabled but the helper reports it unconfirmed, remove the old ControlRoom Capture entry from the affected privacy pane, add this exact app, enable access, and relaunch. The app does not reset or grant privacy permissions automatically. Screen Recording preflight is diagnostic; a user-requested interactive capture still reaches the system authorization check.

By default the helper is ad-hoc signed. Its identity can change when rebuilt, so an old permission entry may no longer apply. Apple explains this behavior in [TN3127: Code signing requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements). Unchanged native builds are now reused. To preserve identity across changed builds, use an existing signing certificate consistently:

```sh
CONTROLROOM_SIGNING_IDENTITY='Apple Development: Your Name (TEAMID)' npm run build:native
```

This does not create a certificate or notarize the app. Live permission state and capture/cancellation still require testing on the user's Mac.

## Import existing knowledge

Select source documents, UI components, token files, and screenshots in Import project knowledge, copy the generated briefing to your existing agent, and have it return a JSON array. Screenshot briefings include local file paths for the agent to open; they do not embed image bytes:

```json
[{"kind":"decision","title":"Prefer inline validation","body":"## Why\nKeep corrections close to their fields.","references":["docs/design-notes.md"]}]
```

Load that JSON in the browser or run `./controlroom import stage --file proposals.json --agent --actor agent-session`. Review and select proposals before applying them. Imports preserve original documents and link back to them. If source contents change after staging, regenerate the proposal. Imported decisions and rules start as proposals.

## Backup and recovery

Export through Settings or `./controlroom export --output project-backup.json.gz`. Restore into an empty initialized project using Settings or `./controlroom restore --file project-backup.json.gz`. Existing records are never overwritten. Backup paths, sizes, and checksums are validated; tokens, process IDs, and claims are excluded. Keep a separate copy of exports if they are intended as backups.

## Development and validation

```sh
PATH="$PWD/.runtime/node_modules/node/bin:$PATH" npm run typecheck
PATH="$PWD/.runtime/node_modules/node/bin:$PATH" npm test
PATH="$PWD/.runtime/node_modules/node/bin:$PATH" npm run build
PLAYWRIGHT_BROWSERS_PATH=.runtime/browsers ./node_modules/.bin/playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=.runtime/browsers ./node_modules/.bin/playwright test
dist/ControlRoomCapture.app/Contents/MacOS/ControlRoomCapture --self-test
```

The browser suite uses a sample project in an isolated temporary directory, separate from your actual project records. Its screenshots go to `test-results/`. `./controlroom serve --dev` enables Vite for frontend development. The normal launcher serves the production build. See [VALIDATION.md](VALIDATION.md) for test results and the remaining interactive macOS checks.

Native shortcut registration is testable without taking a screenshot. End-to-end desktop region selection and macOS permission dialogs require an interactive check on the user's desktop. The tool is local single-user software; hosted access, agent execution, automatic commits, and Windows/Linux native capture are not included.

Local project sessions use separate authentication cookies so opening a second project on another loopback port does not invalidate the first. State refreshes coalesce concurrent triggers, retry read failures, and retain displayed work through an outage. **Reconnect now** retries explicitly; returning to the tab also refreshes. Writes are never automatically replayed.

## Managed agents and orchestrator review

Open **Agents** on the host (`127.0.0.1`). Orchestration is disabled on existing and new projects until a human enables it. Choose the code repository (which can differ from the board repository), a committed base branch/ref, a named reviewer, named workers, and an independent verification command. Unsaved changes in the main checkout are not copied into worker worktrees. Each profile supports Codex CLI or Claude Code, an executable path, and an optional model; leaving model blank uses that CLI's configured default. Install and authenticate the chosen CLI yourself first. Control Room does not install a global runtime, purchase a subscription, or store provider credentials.

Delegate an approved ticket to a worker, or send an approved goal to the orchestrator for decomposition. Plans create child tickets with acceptance criteria and dependencies within that approved goal, then assign workers. A goal with existing children must have those children delegated explicitly; rerunning a plan never silently duplicates them. The parent stays open for a separate outcome review.

Workers run in retained `.controlroom/.local/orchestration/worktrees/` Git worktrees, renew their execution claims, and produce structured handoffs. The controller runs the configured verification command independently and commits remaining implementation changes **in that worker checkout**. A separate, read-only reviewer examines the diff, criteria, decisions, rules and evidence. The controller verifies the reviewed code again before admitting an accept/changes/human outcome. A worker exit or green command alone never completes a ticket. Ordinary CLI/API writes cannot create review receipts, approve scope, or self-accept Done.

Use **Require human acceptance** on a ticket for a mandatory human gate. The project policy can also require every parent goal or every ticket to be accepted by a human. Uncertainty, missing results, failed checks, revoked authority, changed context/code, overlap with another unmerged submission, and resource limits become explicit questions in **Needs you**. Questions have no expiry. Answer and resolve the question to resume with current context; for mandatory acceptance, accept or request changes on the ticket. A human can always override or reopen a ticket.

Acceptance records the reviewer, worker, ticket revision, code identity, checked criteria, evidence and integration state in Markdown. It does **not** merge, push or deploy. In the authorized chat-orchestrator workflow, the orchestrator integrates accepted branches into the configured base, preserves local edits, verifies the combined source and records the merge before reporting completion. Dependent managed work checks commit ancestry and waits until that integration occurs. The service itself does not run Git integration: its acceptance receipt and current UI integration label describe the review-time state and do not detect later merges. Record actual integration in the ticket conversation; a review acceptance alone is not evidence that code reached the base branch.

The concurrency limit bounds all worker/planner/reviewer processes; a named profile runs at most one process at once. The time limit applies separately to the model and verification step, output is bounded, Claude also has a configurable turn limit, and corrective retries have a configured attempt cap. Codex uses noninteractive sandbox permissions; Claude uses `acceptEdits` for workers and `plan` mode for readers. Permission denials or unavailable credentials/tools require human attention; no unsafe permission-bypass flags are used. Profile names provide attribution, not a security boundary against other processes sharing your local account.

The dashboard separates assignments, verified processes, last reported events, reviews and recovery states. Logs, prompts/results and process journals are local and excluded from backups/Git; logs may contain project content. Cancellation stops the owned process group and retains its checkout and branch. A service restart holds queued/in-flight runs for explicit recovery instead of launching duplicates. It never blindly kills a recovered PID. Inspect any surviving process, stop it in its original terminal, then resume. Configuration changes interrupt active runs and require an explicit retry. Worktrees are retained until you remove them with normal Git tools after reviewing/integrating the work.

CLI examples (readable by default; add `--json`):

```sh
controlroom agents status
controlroom agents configure --file agent-config.json --etag CONFIG_REVISION
controlroom agents propose --file agent-config.json --agent --actor "Project orchestrator"
# assignment.json: {"ticket":"65","revision":"CURRENT_TICKET_ETAG","kind":"work","worker":"Worker 1"}
controlroom agents queue --file assignment.json
controlroom agents log RUN_ID
controlroom agents stop RUN_ID
controlroom agents resume RUN_ID
controlroom agents takeover RUN_ID --etag CURRENT_TICKET_ETAG
```

Agents can stage a complete configuration with `agents propose --file CONFIG_JSON` or MCP `propose_agent_config`. Proposals appear in **Needs you** and **Agents**, with a current-versus-proposed diff and human-only **Apply proposal** / **Discard proposal** actions. Staging never changes live configuration or enables execution. A changed configuration makes old proposals stale; create a fresh proposal before applying. Proposal files in `.controlroom/records/agent-proposals/` retain proposer, decision and approver history. Applying commits configuration, proposal status and audit together.

Configuration and recovery require a human actor. The designated orchestrator can delegate, stop runs, and explicitly take over a stopped worker ticket through CLI or MCP `agent_runs`, `delegate_ticket`, `stop_agent_run`, and `take_over_stopped_agent_run`. Takeover requires the current ticket etag and matching run assignment, and is refused while an owned process is active or its exit is uncertain. It retains the original run, checkout, logs, attempts, and assignment history; releases only the matching obsolete execution claim; and puts the new actor into the ordinary claim, progress, and human-review workflow under their own identity. It does not approve scope, reset attempts, accept work, merge, push, or deploy. Managed acceptance is admitted only from the service's verified review pipeline, not from a tool caller's claimed reviewer name. The same host-only authentication and write serialization apply to the HTTP surface.

Failed verification automatically returns the retained worktree and diagnostic evidence to the same worker within the configured attempt limit; it does not require renewed scope approval. A reviewer requesting changes also triggers correction. Successful orchestrator review moves the ticket to Done unless mandatory human review or reviewer uncertainty requires human judgment.

Adapter references: [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive) and [Claude Code programmatic use](https://code.claude.com/docs/en/headless). The regression trial uses executable fixture harnesses for both structured output formats; it does not spend provider usage. Validate your installed CLI/model with a small approved ticket before assigning substantial work.

### Orchestrating from an existing chat

Choose **Orchestration location → Existing chat orchestrator** and name that chat's agent identity. Worker profiles still use their configured CLI/model. Completed submissions wait in `awaiting_review`; no separate planner/reviewer model is launched. Decompose goals in the chat, create children within approved scope, and delegate each through the board. The chat is not automatically awakened or monitored by this setting.

The named chat reviewer retrieves `agents review-context RUN` (MCP `agent_review_context`), inspects the returned worktree/base diff and ticket context, then sends `agents review RUN --file review.json` (MCP `review_agent_submission`). The JSON contains the returned `token` and `result: {outcome, summary, criteria, evidence, question}`. Outcome is accept, changes or human; use an empty question when none is needed. The service reruns verification, enforces mandatory human review and scope, and rejects stale context/code/configuration. Review tokens confer no scope or role authority. Reviewer identity is workflow attribution on the shared local account.

Worker selection is deliberate: every work assignment requires an explicit configured worker. The orchestrator chooses based on task complexity, uncertainty, risk and observed model performance, recording the reason in the ticket. The UI shows each worker's model and leaves delegation disabled until one is selected. Managed planners receive the model roster and include their selection reasons in child descriptions. There is no round-robin or automatic substitute when a profile is removed; retries retain the selected worker.
