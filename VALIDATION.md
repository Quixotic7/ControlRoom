# Release validation — Control Room 0.1.0

Validated locally on macOS with the project's private Node 24.21.0 runtime.

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
