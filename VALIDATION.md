# Release validation — Control Room 0.1.0

Validated locally on macOS with the project's private Node 24.21.0 runtime.

## Typing stability and screenshot-guided themes: #64, #19 (2026-09-28)

**#64:** Reproduced the reported flicker in both modal and standalone tickets: typing into the comment composer remounted inline Markdown link/image components, unloaded lazy images and moved the composer out of view. Stable module-level renderers now consume the current annotation callback through React context. Markdown updates, annotation links, original-image fallback and sanitization remain intact. Two regression workflows failed on the old implementation and passed after the fix. They exercise Details and Conversation, actual typing, image-node identity, absence of replacement image requests, scroll/focus retention, preview success and base fallback, posting and opening the annotation editor.

**#19:** Inspected all five human-supplied screenshots. C64 now follows the lavender tracker reference rather than the earlier C64 OS File Manager treatment. Elektron uses acid-yellow LCD text/headers with charcoal panels and blue-gray keys. SNES uses the city-builder’s blue map grid, green toolbars and cream/stone panels. Synthwave uses neon-magenta frames on purple, a cyan grid and restrained glow. Game Boy uses pale grass, moss and brown pixel edges. Original CSS only; no screenshots, sprites or hardware artwork are bundled. Palette values and inverted-header text are adjusted for readability. Decision DEC-17e468e6128cf597 records this direction and retains DEC-e0b54d147304992b’s shared typography/menu approach.

Production build/typecheck and nine focused Chromium workflows passed. Desktop boards, ticket windows and 390px layouts were visually inspected for all five references. Browser screenshots now wait for the existing lane-color transition to finish before capturing the theme. All **82 Chromium workflows** passed across the full suite (**80 passed**) and final focused rerun (**11 passed**). The two full-run failures were test-selector collisions: the broad Pin selector also matched the new Typing regression image cards. Both selectors now scope the annotation editor, retaining all behavior assertions. The final rerun also covers the last theme/header refinements. No core/storage/native capture code changed in this follow-up. Human appearance acceptance is still required. Changes remain uncommitted.

## C64 OS appearance review: #19 (2026-09-27)

Following the human's C64 OS reference, Commodore 64 now uses gray desktop/window frames, white work areas, cyan menu strips, purple tabs, green menu selection, pixel lettering and flat controls. Ticket, screenshot and shortcut windows gain functional File/View menus with a striped gray caption and left close control. The original CSS draws from the official C64 OS File Manager and App Launcher screenshots; no reference artwork is shipped. Existing theme IDs/preferences and all other presets remain intact. No consequential decision changed; this refines DEC-e0b54d147304992b.

Production build/typecheck and `git diff --check` passed. **6 focused Chromium workflows passed**, covering five desktop window styles, C64 OS reload persistence, mobile bounds and keyboard focus, menu save/navigation/close, screenshot save recovery, hardware fonts, all ten presets' text contrast/persistence, switching back to default themes, and major pages. Board, ticket and mobile screenshots were visually inspected. C64 status badges now use white text/icons against their dark signal colors. Core/storage/native capture code is unchanged; the broader suites were not rerun for this visual follow-up.

## Retro typography and window chrome review: #19 (2026-09-27)

Retro presets now use locally bundled Pixelify Sans; Elektron and Game Boy add chunky Silkscreen display lettering. Windows 95, Windows 3.1, System 7 and AmigaOS have distinct title bars and labeled close controls, plus functional File/View menus sharing the existing ticket/screenshot/shortcut handlers. Menu Escape prevents the native dialog's cancel action so it closes only the menu. Font packages are pinned at 5.3.0 and their unmodified OFL notices ship in the web assets.

Production build/typecheck and `git diff --check` passed. All **78 Chromium workflows** passed across the full suite (**76 passed**) and focused retro/standalone rerun (**6 passed**). The new screenshot-error assertion initially matched its visible banner and the hidden nested title dialog; it now scopes the visible editor banner. The standalone save/close test exceeded its five-second check during the full run and passed unchanged in 518ms on rerun. Initial targeted checks also caught and fixed title-bar specificity, the System 7 close-box position, and native Escape closing a parent dialog.

Coverage includes bundled-font loading, all-preset contrast and persistence, title-bar variants, close-button positions, File Save retaining the window, View navigation, keyboard menus, mobile bounds/focus, screenshot marks surviving failed saves and successful save/reopen, and the existing board, review, LAN and capture-recovery workflows. Windows 95, System 7, Elektron, Game Boy, narrow System 7 and screenshot-editor captures were visually inspected. Core/storage/native-capture implementation was unchanged; core tests were not repeated for this UI follow-up. Decision: DEC-e0b54d147304992b. Changes remain uncommitted pending human visual review.

## LAN review feedback: optional pairing and duration, #63 (2026-09-27)

The human confirmed that a separate device connected successfully, then requested optional pairing codes and configurable access duration. Network access now offers **Require pairing code** and **Paired access duration (hours)** (15 minutes to 365 days; default eight hours). Open mode has no session timer. Changing the pairing requirement invalidates old sessions/codes; requiring pairing again immediately closes unauthenticated streams. Duration changes affect new sessions only. Preferences survive CLI restarts/mode changes; host-only controls and origin/Host restrictions apply in both modes.

Production build/typecheck, all **80 core/model/integration tests**, and all **3 targeted LAN Chromium workflows** passed. Tests cover legacy preference defaults, invalid input leaving settings unchanged, open-mode reads/writes, retained host controls, policy transitions, real configured cookie expiry and server expiration, existing sessions retaining their duration, persistence, immediate SSE closure, no-code browser entry, and retaining an open draft when codes become required. The initial browser check was adjusted to await the controlled checkbox's server-confirmed state. Open-mode and duration Settings screenshots were visually inspected. The broader browser suite was not repeated for this focused follow-up; its previous 74-workflow result is recorded below.

Decision DEC-0424c8f99e4f4a31 supersedes the mandatory-code/fixed-duration policy in DEC-a50e4388f1a92fca. Changes remain uncommitted; human review is requested for the new settings.

## Trusted-LAN access: #63 (2026-09-27)

Production build/typecheck and all **77 core/model/integration tests** passed. All **74 Chromium workflows** passed across the full run (73 passed) and focused LAN rerun (2 passed). The new annotation test initially clicked a saved mark while Draw was active; it now explicitly selects Select / move before verifying the reopened instruction. No product assertion was removed. `git diff --check` passed.

New coverage checks opt-in binding, loopback CLI discovery, persisted mode and restart, separate hashed remote sessions, single-use/expiring pairing codes, rate limiting, session expiry/revocation, immediate SSE closure, host/origin/peer rejection, local token isolation, protected records/images/events/exports, host-only controls, and local access after disabling LAN. Chromium used this Mac's actual private IPv4 address with separate browser contexts: unauthenticated requests were rejected, pairing enabled ticket edits, an open ticket draft survived revocation/re-pairing, and screenshot marks saved/reopened over HTTP without secure-context-only UUID APIs. Pairing and host Network access screens were visually inspected.

The automated LAN-origin tests ran on the host Mac, not on a second physical device. Human acceptance must still check the displayed LAN URL from another device on the same trusted network, including firewall/client-isolation behavior. HTTP is explicitly unencrypted; IPv6 LAN access and public hosting are outside scope. Native capture remains host-only and was not re-exercised. Decision: DEC-a50e4388f1a92fca (opt-in trusted LAN with separate paired browser sessions). Changes remain uncommitted.

## Selected ticket completion: #19, #20, #22, #27, #28, #46; theme children #61–#62 (2026-09-27)

Production build/typecheck passed. All **69 core/model/integration tests** passed on the final source. All **72 Chromium browser workflows** passed in the full regression run; all **8 selected-work browser workflows** passed again against the final compiled build after the last questionnaire input guards. Six focused storage/checklist tests also passed. The build emits Vite's advisory about the main JavaScript chunk exceeding 500 kB; no build or test failed in the final checks.

Coverage includes Markdown checklists and unrelated prose/code examples; add/edit/reorder/remove, Enter focus, save/close and reopen; structured questionnaire validation, persistent drafts, explicit submission, custom answers, stale edits, replacements/amendments, independent resolution, attribution and history; CLI/MCP questionnaire and progress commands and waits waking on answers; current-session progress timestamps, bounded estimates, expired claims, stale reports and reduced motion; all ten theme presets, readable text/muted-text contrast, persistence, System color scheme, major pages and mobile layout; board/table before/after insertion, no hover writes, Escape cancellation, keyboard ordering, invalid parent moves and revision-protected stale targets. Hidden columns now retain their normal width and empty-lane appearance, per #46 feedback. Existing screenshot geometry, capture recovery, review and Markdown conflict workflows remain covered by the full suite.

Windows 95, Commodore 64, Synthwave, Game Boy and narrow Classic Mac layouts were captured; Windows 95, Synthwave and narrow Classic Mac screenshots were visually inspected. Neutral chrome and group-header surfaces were adjusted for readability. Native capture code was unchanged, so the global macOS shortcut was not re-exercised for this batch.

ControlRoomDev and JuiceLab project installations were refreshed with this build. Upgrade checks verified identical record, asset and configuration hashes and preserved custom launchers. Changes remain uncommitted. Human visual/workflow review is requested on the completed tickets. Decisions: DEC-82978f3191a878c7 (Markdown checklists and revisioned question comments) and DEC-20d616745286605a (reported estimates/current-session wall-clock progress).

## Board visibility and quick archive: #46, #44 (2026-09-27)

Production build/typecheck and all **64 Chromium browser workflows** passed in the full regression run. Four new workflows cover project/view-scoped column visibility, refresh, filter composition, table isolation, keyboard navigation, renamed/reordered/deleted column IDs, the all-hidden state, custom Done columns, cancellation and empty archive previews, exact filtered/expanded-group scope, stale-write partial results, tickets arriving after preview, searchable restoration and preserved parent links, stage, number, prose and conversation. The initial focused check caught archive-preview focus falling on its first link; it now explicitly focuses Cancel and returns focus to the column menu on close. Compact headers and the archive conflict summary were visually inspected. Tests used disposable projects; no real tickets were archived by validation.

Visibility is stored in personal browser storage keyed by project and saved-view IDs. Archive writes reuse the existing revision-checked API and report confirmed successes separately from tickets requiring review. Core storage and native capture implementations were unchanged. Changes remain uncommitted pending human review.

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

## #65 — managed orchestration (2026-09-28)

- Production TypeScript/Vite/CLI build passes. The existing Vite large-chunk advisory remains non-blocking.
- Full core regression suite: **95 passed**. New executable-harness tests cover a planner creating two child assignments, distinct Codex/Claude output adapters, isolated worktrees, independent verification and review, durable receipts, explicit parent completion, mandatory human review, worker authority/receipt forgery, claim expiry, changed code/discussion, revoked configuration, bounded corrective retries, human-answer continuation, restart recovery, dependency merge ancestry, and process-group/child cancellation.
- Full Chromium regression suite: **83 passed**. Final focused Agents suite: **2 passed**, including the additional managed-run dashboard trial. Configuration drafts survive refresh, disabled-by-default state and saved models persist, ticket human gates save, a fixture worker reaches independent acceptance, logs use a focus-trapped dialog and Escape dismissal, and the 390px layout has no horizontal document overflow. Delegation is disabled when the previously selected ticket has completed.
- Desktop and narrow Agents screenshots were visually inspected. Existing ticket, board, screenshot, theme, LAN, and review workflows passed the full browser run.
- The harnesses are deterministic fixture executables, not live model evaluations. Codex CLI help was checked on this host. Claude Code is not installed here; actual provider authentication/model behavior remains a first-run setup check. No paid model runs were launched.
- Authority changes are attributed in project history. Assignment/review data are Markdown-backed; raw process output and journals remain local. Automatic merge/push/deployment remain off. Successful worker snapshots are committed only in their isolated branches.
- Implemented decision: `DEC-0b5c2fc51bf9cbe2`. Earlier unanswered interview questions were not treated as human answers.

### Chat orchestration follow-up (2026-09-28)

- Production build/typecheck passed; **97 core tests** and **2 focused Agents browser tests** passed. Chat reviews launch no reviewer CLI, require the configured agent identity and a current context token, survive service restarts while awaiting review, reject stale reviews, and retain mandatory human acceptance gates.
- Control Room Dev was configured through its Agents form with `Codex chat orchestrator`, chat review mode, and three Codex CLI workers: Sol (`gpt-5.6-sol`), Terra (`gpt-5.6-terra`), and Luna (`gpt-5.6-luna`). Saved roster and enabled state were verified in the UI. No assignments or live model runs were started.
- Both installed applications match the built server/browser artifacts and return healthy. Juice Lab's agent configuration remains disabled. Claude Code is now installed (2.1.284); the selected model family uses Codex CLI (0.155.1). Provider authentication/model execution remains unverified by a live run.
- This conversation must actively retrieve and review worker submissions; chat mode does not wake or continuously monitor this conversation in the background. Accepted branches still require separate integration.

### Deliberate worker selection (2026-09-28)

- Removed automatic round-robin delegation. Work requests without a configured worker are rejected before any run or ticket mutation; repeated explicit selections retain that worker. The dashboard requires selection and displays model names.
- Managed planners receive provider/model details and instructions to choose by task requirements and explain their choice in each child description. Agent guidance describes provisional Sol/Terra/Luna selection heuristics, with reassessment based on observed results.
- Recovery refuses a removed worker instead of substituting the first configured profile. Corrective recovery uses the explicitly retained worker's current configuration.
- Build/typecheck and diff checks passed. **99 core tests** and **2 Agents browser tests** passed, including missing/unknown selections, repeated selection, removed-profile recovery, and disabled delegation until a worker is chosen. No live model assignments were started.
