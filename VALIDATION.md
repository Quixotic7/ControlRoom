# Release validation — Control Room 0.1.0

Validated locally on macOS with the project's private Node 24.21.0 runtime.

## Automated checks

- **Production build and TypeScript:** passed (`npm run build`).
- **22 core and integration tests:** passed (`npm test`). Includes sequential ticket numbering, legacy numbering migration with links preserved, backup/restore, Markdown preservation, conflicts, agent scope, history, imports, real Git worktrees, a real Git submodule sharing its superproject's board, branch reconciliation, authentication (including percent-encoded API paths), and preferences.
- **13 Chromium browser workflows:** passed (`npm run test:browser`). Includes entry in every column, parent/child grouping, centered dialogs, save-on-close, merging of concurrent edits to different fields, overlapping-edit conflict choice, discarding an unsavable draft, confirmation before discarding unsaved annotations, owner/label suggestions, inline comment threads, standalone screenshot save/reopen, Delete/undo, shortcut help, imports, remembered views, and mobile layout. The Juice Lab visual refresh was checked on desktop and mobile.
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
