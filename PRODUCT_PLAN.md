# Workboard — approved product plan

This replaces the initial brainstorming draft. The implementation request and interview established the decisions below. See README.md for running the delivered application and VALIDATION.md for verification results.

## Product and audience

A macOS-first tool embedded inside each project, for one human collaborating with multiple coding agents. The primary goal is a clear project picture: current work, finished work, rationale, and items needing attention.

Every project owns its installation, Markdown records, and local images. Separate Git worktrees share one live board whose canonical files live in the main project checkout. A command and a clickable launcher open the local web interface. The application supports multiple coding tools equally; it prepares task context and records agent updates rather than launching agents.

## Tasks and authority

- Default columns: Backlog → Selected For Development → In Progress → Review → Done; editable per project.
- Ordinary tickets, labels, priority, and parent-child relationships represent tasks and larger goals/epics. Horizontal swimlanes group by parent goal.
- Humans and agents may create tickets. Human approval of a parent scope lets agents select and reprioritize work within that scope.
- Agents provide progress updates, concrete handoffs, and verification evidence. Implemented work moves to Review; humans accept Done. Parent completion is explicit.
- Blockers are separate from workflow status. Questions, blocked work, reviews, and changed guidance appear in an attention view.
- Board and list views support search, filters, adjustable density, keyboard controls, and restoration of the last-used view.
- A claim coordinates ownership; it does not prove that an agent process is running. Show last-reported activity and stale claims explicitly.

## Project decisions and UI rulebook

- Decisions preserve the choice, context, rationale, alternatives, tradeoffs, affected work, and predecessor links.
- Both humans and agents may accept decisions and update active rules, with attributed revision history.
- The UI rulebook begins through guided setup and import of existing documents, components, and screenshots.
- Rules describe foundations, components, behavior, responsive design, accessibility, and language. Each includes scope and requirement strength.
- Reference canonical implementation components and tokens instead of copying values into a competing design system.
- Include applicable decisions and rules in agent context. Review deviations and explicit exceptions. Changes flag affected open work without retroactively invalidating completed tickets.

## Storage and consistency

- Markdown with small metadata headers stores tickets, discussions, decisions, and rules. Git tracks text and annotation geometry.
- Images and generated previews remain local and Git-ignored. Backups bundle both text and attachments; missing local images retain visible written context.
- Browser and CLI writes share one local service and use revisions to reject stale updates. Preserve unknown frontmatter and unrelated Markdown.
- Detect direct file edits and report malformed or unsupported records. Direct editors cannot participate in application locking automatically.
- Resolve worktree requests to the canonical main checkout. Pause application writes on a canonical branch change until the user reviews and reconciles the current records.
- Runtime credentials, claims, preferences, drafts, and generated indexes are local, not shared project knowledge. No automatic commits or pushes.
- The local API binds to loopback, checks origins, authenticates mutation requests, and confines file access to project data. Markdown is rendered without executing embedded HTML or commands.

## Visual feedback

- Accept pasted images, dropped files, and a global macOS region/window capture shortcut while the tool is running.
- Capture targets the most recently active project; allow transfer afterward. A small native companion coordinates project instances.
- Handle cancellation, unavailable destinations, shortcut conflicts, and macOS permissions. Retain a draft if delivery fails.
- Provide freehand drawing, movable text, numbered pins, boxes, arrows, written comments, selection/movement, undo/redo, deletion, and resolution.
- Save feedback to one ticket or split selected/unresolved annotations into linked tickets.
- Preserve the base image and editable annotation geometry. Supply agents with a numbered preview, normalized regions, image dimensions/hash, stable IDs, and readable instructions.

## Import and delivery

Selected existing documents become an agent briefing. The agent proposes tickets, decisions, and rules in a staging area. A human previews and applies selected proposals. Source links remain attached; original documents are untouched, and changed sources require a fresh proposal.

Delivery includes shared records and CLI, project overview, project knowledge, and visual feedback. Hosted access, agent execution, required embedded AI providers, and non-macOS native capture are outside this release.

Implementation uses TypeScript, React/Vite, a Fastify service on a project-local Node 24 LTS runtime, and a Swift capture companion. Dependencies and runtime are pinned; the user's global Node installation remains unchanged.

## Acceptance

- Shared worktrees, stale-write rejection, scope approval, claims, review transitions, preserved Markdown, and durable knowledge history.
- Rule changes identify affected work; archived task records do not remove project decisions.
- Annotations retain geometry through scaling, persistence, export, and reopening.
- Backup/restore preserves records and image links, while a text-only clone displays missing-image placeholders.
- Imports remain proposals until reviewed and preserve source documents.
- Last view, density, accessible controls, and responsive layouts work in the browser.
- The copied project installation starts independently, and upgrades preserve data.
- Native compilation and shortcut registration are checked automatically; actual desktop selection and OS permission dialogs require an interactive macOS check.
