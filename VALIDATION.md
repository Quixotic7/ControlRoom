# Release validation — Control Room 0.1.0

Validated locally on macOS with the project's private Node 24.21.0 runtime.

## Selected UI batch: #45, #47, #48, #49 (2026-09-27)

Production build/typecheck and all **63 core/model/integration tests** passed. All **60 browser workflows** passed across the full run (57 passed) and focused rerun (9 passed, including one additional failure-recovery workflow). The two full-run failures were an older parent-picker test reopening before save-and-close completed, and an unscoped question selector matching both the new prominent controls and the original thread. Tests now await close and select the intended thread; assertions remain intact.

Coverage includes archived-parent navigation, middle-click and draft save failures; prominent questions, persisted answer drafts, independent resolution and failed posts; current versus historical review verification; desktop alignment and narrow-screen wrapping; screenshot title focus, blank validation, Escape cancellation, exact created-ticket navigation, annotation/creation errors, double-submit prevention, and recovery after a lost creation response without another POST. Existing standalone screenshot, annotation geometry, existing-ticket attachment, conversation, review outcomes, and Markdown preservation workflows passed. Desktop and narrow-screen review controls and the question/review action area were visually inspected. Native capture behavior was not changed by this batch.

## Latest review feedback and new tickets: #14, #30, #35, #39, #40, #42 (2026-09-26)

Production build/typecheck and **56 core/model/integration tests** passed. All **50 browser workflows** passed across the full run and focused reruns. Test fixes wait for live autocomplete results and loaded fonts, scope Conversation selectors to the dialog, and use the new ticket URL after waiting for Save to close. The expanded desktop dialog was visually inspected; mobile bounds and footer visibility passed.

New coverage verifies optional acceptance feedback (including accepting without a note), stale existing-child reparenting and cycle exclusions, screenshot comments and agent context, independent middle-click tabs and refresh, expanded dialog dimensions, retained drafts during connection failure, and recovery. Two separate project cookies coexist in a shared cookie jar, while one project's cookie cannot authenticate to the other. Screenshot-created records now embed their image in Markdown; existing attachment-only descriptions show thumbnails without rewriting prose.

Both Control Room Dev (4173) and the installed JuiceLab tool (4280) were refreshed. The JuiceLab upgrade preserved record hashes and its custom launcher. A live read-only check authenticated both boards with both cookies present. The shared-cookie collision is reproduced and fixed; the historical network transport error in the screenshot cannot be attributed conclusively from that image alone. No native helper rebuild or permission changes were needed. Changes remain uncommitted.

## Review outcomes, rapid children, and decision protocol: #30, #14, #31 (2026-09-26)

Production build/typecheck, **54 core/model/integration tests**, and all **44 Chromium workflows** passed. After preserving review feedback across History/Conversation tab switches, the build and all five new browser workflows passed again. `git diff --check` passed. Review controls and child entry were visually inspected; the service at port 4173 was restarted with the new code. Changes remain local and uncommitted.

Review coverage includes draft prose/evidence preservation, explicit parent acceptance without completing children, custom review/Done/progress columns, Failed Review preference, stale revision rejection, human-only outcomes, invalid destinations, feedback surviving tab switches, and lost-response retries without duplicate comments (including receipt recovery after a Store restart). Child-entry coverage includes repeated keyboard entry, numbered parent links, blank/double submission guards, input focus, retained titles on create failure, and saving a new parent before its child. Existing board/grouping and ticket editing regressions also pass.

Decision checks cover shared guidance in the agent guide, JSON/Markdown context and MCP onboarding; CLI creation and MCP search/create/link workflows; successor decisions retaining predecessors and rationale; discovery after originating tickets are archived; and decisions conferring no scope approval. These tests use disposable projects. Agent compliance with the documentation protocol still depends on agents following the instructions.

## Screenshot connection recovery #38 and draggable tabs #24 (2026-09-26)

Production build/typecheck, **51 core/model/integration tests**, and all **39 Chromium workflows** passed. Fault-injection tests cover a dropped status read after an accepted capture request, bounded recovery after multiple read failures, a lost capture-command response without command replay, separate permission messaging, screenshot metadata recovery without page refresh, interrupted response bodies, and preservation of HTTP/validation errors. The persistent-failure recovery banner was visually inspected. The screenshot identifies a connection failure, but cannot establish what caused the original connection to drop; these checks reproduce and fix the UI recovery path rather than claim a verified historical transport cause. No native helper rebuild or permission changes were needed.

Tab tests cover dragging left and right, persistence, retaining the active view and unsaved filter, stable widths, continued Move left/right menu support, no-op drops, and rejecting a configuration revision changed during the drag. #35 remains in Failed Review awaiting the user's missing review details; a question was recorded on that ticket.

## Screenshot workflow and review revisions: #35, #36, #37, #24, #34 (2026-09-26)

Production build/typecheck, **47 core/model/integration tests**, and all **32 Chromium workflows** passed. New browser checks cover recent screenshot selection with draft preservation and duplicate/Trash exclusion, board and detail thumbnails, annotation destination autocomplete by title/number with keyboard/pointer selection and cancellation, actual hit-testing of view menus outside the scrolling tab strip, delete confirmation inside the editor, filtered multi-selection and stale-item partial failures, bulk restore, and incoming capture uploads appearing live without opening an editor or changing the page. The menu, autocomplete, and ticket images were visually inspected.

The macOS companion compiled and its double-Option detector/shortcut-registration self-test passed. Its successful upload path no longer opens a browser. After restarting the rebuilt helper, runtime status reported **input-monitoring-required** (`inputMonitoring: false`); Screen Recording preflight also reported false, which remains advisory. Re-enable Workboard Capture in macOS Input Monitoring before interactive review. **A real double-Option capture from another app, preserving its focus, remains to be verified by the user.** No real screenshots were deleted by tests. Application changes are local and uncommitted.

## Approved screenshot and description batch: #33, #34, #5 (2026-09-26)

Production build/typecheck and **47 core/model/integration tests** passed. All **27 Chromium workflows** passed across the full run (26 passing) and a focused rerun after correcting an older ambiguous screenshot-title selector. The focused rerun also passed expanded coverage for marks created while zoomed, Space-drag, middle-button drag, and the Pan tool. Checks cover populated-description preview defaults, editing/reopening and empty descriptions; delete cancellation, Trash/restore, retained ticket links, stale revisions and backup/restore; cursor-centered zoom, source-coordinate stability, native preview dimensions, reopening, and fit on resize. Fit and enlarged editor screenshots were visually inspected. Tests used disposable projects, and no real screenshots were deleted. The local service was rebuilt for human review. Screenshot deletion is reversible and intentionally retains disk assets and existing links.

## Approved backlog batch: #32, #24, #15 (2026-09-26)

Production build/typecheck, **46 core/model/integration tests**, and all **24 Chromium workflows** passed. The new checks cover stable tab widths/positions in both themes and densities, unsaved indicators and renaming; parent autocomplete with ticket zero, duplicate titles, archived parents, keyboard/mouse selection, cancellation, clearing, unchanged prose, and descendant/cycle exclusions (including a 350-ticket search fixture); and chronological/newest-first conversations with deterministic ties, persistent preferences, new-comment navigation, and stable reading position during incoming updates in both Details and Conversation. Parent-picker and conversation screenshots were visually inspected. Application changes remain local pending human ticket review.

## Review conversation feedback (2026-09-26)

Production build/typecheck and **45 core/model/integration tests** passed. All **21 Chromium workflows** passed (20 in the full run, the new conversation workflow after narrowing its dialog selector). Agent transitions into Review append an attributed Markdown summary with human review steps, verification, and exceptions. Regression coverage checks stale/rejected writes, repeated review cycles, ordinary edits without duplicate summaries, CLI/MCP review instructions, and reopening the conversation. Questions, handoffs, human feedback, and review requests have visible text labels; resolved questions retain their type. The review conversation was also visually inspected.

## Approved review fixes (2026-09-26)

The build, all **44 core/model/integration tests**, all **20 Chromium workflows**, and the separate installation/upgrade smoke check passed. New regression coverage exercises startup from outside the tool directory; numeric parent/dependency links and hash-prefixed CLI arguments; signal, timeout, and spawn failures during verification; full parent approval boundaries in briefs; MCP execution-directory branch/commit evidence; concurrent reads and pings during cancellable waits; connection-close cleanup; and searches that match a parent but not its children.

The capture helper now reports its exact bundle path and signing mode, treats screen-capture preflight as advisory, and offers guidance for replacing stale macOS permission entries. The build supports an explicit signing identity and reuses unchanged binaries. **Successful live capture after the user's reported permission failure is still unverified**; compilation and detector self-tests do not close that acceptance gap.

## Earlier release checks

- **Production build and TypeScript:** passed (`npm run build`).
- **38 core and integration tests:** passed (`npm test`). Includes sequential ticket numbering, legacy numbering migration with links preserved, backup/restore, Markdown preservation, conflicts, agent scope, history (append-only JSON Lines plus legacy per-event files), the cached record index and direct-edit detection, imports, real Git worktrees, a real Git submodule sharing its superproject's board, branch reconciliation, authentication (including percent-encoded API paths), preferences, saved-view validation, the view model (GitHub-style filter parsing and matching, `is:archived`, grouping, sorting, Needs you reasons), and the agent surface: next-ticket selection, prompt-ready Markdown context with token estimates, structured review verification and code links, `--set` parsing, list filters, environment-based identity, and an end-to-end run of the CLI (`next`, `context --brief`, `--latest`, `review --run`, `wait`) and the MCP server over stdio against a temporary project.
- **19 Chromium browser workflows:** passed (`npm run test:browser`). Includes saved views (create, rename, layout, grouping, save, reload, delete), filters saved to a view, "Add item" entry in every column, goal swimlanes, centered dialogs, save-on-close, merging of concurrent edits to different fields, overlapping-edit conflict choice, discarding an unsavable draft, confirmation before discarding unsaved annotations, owner/label suggestions, inline comment threads, standalone screenshot save/reopen, Delete/undo, shortcut help, imports, remembered views, mobile layout, keyboard navigation between board cards, bulk status changes from the table, archiving, the Insights page, and code links with a recorded verification run. The Juice Machine Lab visual refresh was checked on desktop and mobile, in dark and light themes.
- **Separate project installation:** passed (`node --import tsx tests/install-check.ts`). Exercises a copied runtime and launcher, service autostart, CLI create/list/context, capture registration owned by the service process, shutdown, and upgrade with records retained.
- **Swift companion:** compiled and ad-hoc signed. Double-Option detector self-tests cover a valid tap pair, an intervening key, and a long hold. The optional key-combination registration self-test returned status 0; macOS's capture executable is available.

Desktop board, rulebook, screenshot editor, and mobile screenshots were inspected. Browser fixtures and installation checks use temporary projects, separate from the real project records.

## Interactive macOS acceptance still required

These require real desktop interaction and OS permission state; a successful native build or shortcut registration does not establish that they work end to end:

1. Grant Input Monitoring permission to Workboard Capture if requested. Open two project boards and focus the intended destination. Switch to another application, double-tap Option, and select a region or window. Verify that the correct project's annotation editor opens with its destination visible.
2. Repeat with Escape. Verify that no completed attachment appears.
3. Deny Screen Recording permission and verify the visible failure; grant permission in macOS Settings, restart the companion if necessary, and retry.
4. Stop the destination service while selecting a region. Verify that its draft is retained and recoverable after restarting the project.
5. Choose an occupied global shortcut and verify the conflict message and ability to select another shortcut.

The native companion is a local development build, not a notarized distributable. Capture is macOS-only; paste/drop and the record format are portable. Direct Markdown editors do not participate in service locks. Branch reconciliation acknowledges the current checkout and does not merge divergent Git history.

## Review follow-ups and ControlRoom naming (2026-09-27)

Tickets #14, #42, #43, #50 and #51:

- Production build/typecheck passed. All 62 core/model/integration tests passed, including migration byte preservation, live-service/dual-directory refusal, legacy export import, identity aliases, capture routing and completed-ticket attention semantics.
- All 53 browser workflows passed across the full regression run (49 passed) and focused reruns (4 passed). Initial failures were two fixture paths still pointing at `.workboard`, geometry measured before fonts settled, and selection before incoming screenshots became visible. Fixtures now use current paths and explicit readiness checks; assertions were not weakened.
- Ticket-only tab rendering, reload, logo navigation with save, review instructions and interaction-based capture activation passed focused browser checks. The standalone ticket screenshot was visually inspected.
- Disposable installed-project trial passed: upgrade a legacy folder, explicit migration, bundled runtime startup/read/write, old command alias, asset and custom launcher preservation.
- Renamed Swift capture companion compiled. Double-Option detector and temporary hotkey registration self-tests passed in the macOS session (registration status 0). This does not prove real capture routing or macOS permission recovery; test those interactively across the two project windows.
- Existing live project folders remain `.workboard` until explicit migration. New installations use `.controlroom`. README includes backup, stop, upgrade, migrate, external-path changes and rollback instructions. No Git commits or pushes were made.
