// Keep these recipes aligned with AGENT_GUIDE.md whenever the shipped CLI or
// MCP protocol changes. They deliberately contain no credentials: a copied
// recipe is only text for the user to paste into their chosen coding agent.
export type PlaybookRecipe = {
  id: string;
  group: string;
  title: string;
  purpose: string;
  prerequisites: string;
  needsTicket?: boolean;
  prompt: (context: PlaybookContext) => string;
};

export type PlaybookContext = {
  project: string;
  branch: string;
  ticket: string;
  useCurrentProject: boolean;
};

function projectContext({
  project,
  branch,
  useCurrentProject,
}: PlaybookContext) {
  return useCurrentProject
    ? `the ${project} project on branch ${branch}`
    : `the PROJECT_NAME project on branch PROJECT_BRANCH`;
}

export const playbookGroups = [
  { id: "connect-orient", label: "Connect & orient" },
  { id: "shape-approved-work", label: "Shape approved work" },
  { id: "work-with-board", label: "Work with the board" },
  { id: "document-project", label: "Document the project" },
  { id: "feedback-navigation", label: "Feedback & navigation" },
] as const;

export const playbookRecipes: PlaybookRecipe[] = [
  {
    id: "connect",
    group: "Connect & orient",
    title: "Connect a coding agent",
    purpose:
      "Give an existing coding agent the project protocol and a safe connection path.",
    prerequisites:
      "A checkout of this project and an agent that can use MCP or run shell commands.",
    prompt: (context) =>
      `I am working in ${projectContext(context)}. Run board commands from that project's checkout. Read its .controlroom/AGENT_GUIDE.md first and use its installed launcher: ./.controlroom/controlroom help (or ./.controlroom/controlroom mcp). If this project is itself the Control Room tool source checkout, read AGENT_GUIDE.md and use ./controlroom help or ./controlroom mcp. Set CONTROLROOM_ACTOR to your agent name and CONTROLROOM_ACTOR_KIND=agent. Do not expose, copy, or send any local authentication token. Explain the next safe board action before making a write.`,
  },
  {
    id: "orient",
    group: "Connect & orient",
    title: "Find the next approved task",
    purpose:
      "Ask an agent to identify work that is ready without claiming or changing anything yet.",
    prerequisites: "Connected to the board and familiar with AGENT_GUIDE.md.",
    prompt: (context) =>
      `I am working in ${projectContext(context)}. From that project's checkout, read .controlroom/AGENT_GUIDE.md, then inspect its board's next approved ticket using the MCP next_ticket tool or ./.controlroom/controlroom next. Summarize the ticket's approved scope, acceptance criteria, dependencies, applicable decisions, and current revision. Do not claim, move, edit, assign, or start work until I explicitly choose the ticket.`,
  },
  {
    id: "teach-aliases",
    group: "Connect & orient",
    title: "Install short command skills",
    purpose:
      "Install reusable refresh and next-ticket skills for Codex and Claude Code.",
    prerequisites:
      "A Control Room installation with bundled skills, and the code checkout where your agent runs.",
    prompt: (context) =>
      `For ${projectContext(context)}, install the bundled Control Room skills into the code checkout where this agent runs. Read the existing agent guide and use that project's installed launcher: ./.controlroom/controlroom skills install /absolute/path/to/code-checkout (or ./controlroom skills install . in the Control Room tool source checkout). Replace the destination with the actual intended checkout; do not create a new board or overwrite customized skills. Codex invokes $crrefresh, $crnext or $ccrefresh through its skill picker; Claude Code invokes /crrefresh, /crnext or /ccrefresh. crrefresh reads the latest board state and conversations, including Done and archived tickets; crnext inspects the next eligible approved ticket without claiming it. ccrefresh is a compatibility alias for crrefresh. These are read-only skills, not permission to write, claim, move, assign, or implement. Explain which files were installed and the correct invocation for this agent.`,
  },
  {
    id: "refine-concept",
    group: "Shape approved work",
    title: "Refine a Concept ticket",
    purpose:
      "Turn an early idea into a reviewable proposal without treating it as implementation approval.",
    prerequisites:
      "A public ticket number in Concept and the human's product context.",
    needsTicket: true,
    prompt: ({ ticket }) =>
      `Help me refine Concept ticket #${ticket}. First read its context with ./.controlroom/controlroom context ${ticket} --brief (public ticket number: ${ticket}). Propose a concise intended outcome, boundaries, acceptance criteria, risks, dependencies, and human-review steps. Keep it in Concept: do not claim it, change scopeApproved, move it to In Progress, or implement it. Ask focused human questions for missing decisions.`,
  },
  {
    id: "plan-parent",
    group: "Shape approved work",
    title: "Plan an approved parent",
    purpose:
      "Break an approved parent into independently reviewable work while preserving its outcome.",
    prerequisites:
      "A human-approved parent ticket number and its current context.",
    needsTicket: true,
    prompt: ({ ticket }) =>
      `Plan approved parent ticket #${ticket}. Read its latest brief first: ./.controlroom/controlroom context ${ticket} --brief. Propose small child tickets only where they can be independently implemented and reviewed. For each child, include scope, acceptance criteria, dependencies, verification, and a reason it belongs under parent #${ticket}. Preserve the parent as the outcome review; do not claim, assign, move, or create records until I approve the plan.`,
  },
  {
    id: "pick-up",
    group: "Work with the board",
    title: "Pick up approved work",
    purpose:
      "Start a specific ticket with the required scope and claim checks.",
    prerequisites:
      "An approved, available ticket number and a suitable checkout.",
    needsTicket: true,
    prompt: ({ ticket }) =>
      `I want to work on approved ticket #${ticket}. Read .controlroom/AGENT_GUIDE.md and then ./.controlroom/controlroom context ${ticket} --brief. First determine the workflow. If this is an active controller-managed assignment, follow its managed run prompt: do not issue manual claim, move, progress, review, release, or assignment writes; implement only the assigned scope and return the requested structured handoff to the controller. If that managed work is stopped, do not take it over—request explicit orchestrator takeover. Otherwise, as a manual agent, verify approved scope, current revision, dependencies, decisions, rules, and live claims; then claim with the public numeric command ./.controlroom/controlroom claim ${ticket} and move it to progress with its current etag. Work only within approved scope. If approval, ownership, or requirements are unclear, stop and ask a human instead of making assumptions.`,
  },
  {
    id: "progress",
    group: "Work with the board",
    title: "Report useful progress",
    purpose: "Leave a factual update that makes a handoff or review easier.",
    prerequisites: "An actively claimed ticket and its current etag.",
    needsTicket: true,
    prompt: ({ ticket }) =>
      `For ticket #${ticket}, read the current context first with ./.controlroom/controlroom context ${ticket} --brief. If this is an active controller-managed assignment, do not post manual progress or lifecycle writes: return the requested structured progress/handoff to the controller, which records it. If the managed work is stopped, request explicit orchestrator takeover instead. Otherwise, as a manual agent, draft a concise progress update—what changed, what remains, verification run so far, and any blocker or decision needed—and use ./.controlroom/controlroom progress ${ticket} --etag CURRENT_ETAG --body "...". Replace CURRENT_ETAG and the quoted body with current values. Do not overstate progress, change status, or resolve a human question.`,
  },
  {
    id: "submit-review",
    group: "Work with the board",
    title: "Submit review evidence",
    purpose: "Prepare a reviewable handoff instead of self-accepting work.",
    prerequisites:
      "Implementation is complete, the ticket is claimed, and verification can run in this checkout.",
    needsTicket: true,
    prompt: ({ ticket }) =>
      `Prepare ticket #${ticket} for review. Re-read ./.controlroom/controlroom context ${ticket} --brief and compare the implementation with every acceptance criterion. Run relevant verification in this checkout. If this is an active controller-managed assignment, do not issue manual review, move, claim, release, or assignment writes: return the requested structured handoff with criteria, evidence, exact run/output, exceptions, and decisions (or none) to the controller. The controller verifies it; an explicitly enabled independent orchestrator may record acceptance, otherwise a human accepts. If the managed work is stopped, request explicit orchestrator takeover. Otherwise, as a manual agent, submit review with the current etag, detailed handoff, concrete human review steps and expected results, and factual output: ./.controlroom/controlroom review ${ticket} --etag CURRENT_ETAG --handoff "..." --review-notes "..." --run "...". Do not mark #${ticket} Done: manual Review and human acceptance are separate steps.`,
  },
  {
    id: "respond-feedback",
    group: "Work with the board",
    title: "Respond to review feedback",
    purpose:
      "Reconcile feedback against the current ticket rather than overwriting newer board state.",
    prerequisites: "A review comment or requested change on the ticket.",
    needsTicket: true,
    prompt: ({ ticket }) =>
      `Respond to feedback on ticket #${ticket}. Read its latest context and conversation with ./.controlroom/controlroom context ${ticket} --brief before acting. Summarize each requested change, identify scope ambiguity, and make only changes within approved scope. If this is an active controller-managed assignment, do not overwrite its assignment or issue manual claim, move, progress, review, or release writes; verify the correction and return the requested structured handoff/evidence to the controller. If the managed work is stopped, request explicit orchestrator takeover. Otherwise, as a manual agent, use the current etag rather than retrying an old write, verify the correction, report what changed, and submit fresh Review evidence. Ask a human if the feedback expands scope or needs product judgment.`,
  },
  {
    id: "decision",
    group: "Document the project",
    title: "Document a consequential decision",
    purpose:
      "Capture a durable choice and its tradeoffs without inventing human agreement.",
    prerequisites:
      "A choice significant enough to affect architecture, product, UI conventions, dependencies, or workflow.",
    prompt: () =>
      `Before creating a decision, search existing project knowledge for a relevant record. If a new decision is needed, draft Choice, Context, Rationale, Alternatives, Tradeoffs, Affected scope, Attribution, and related ticket/implementation references. Label assumptions and proposals clearly; do not claim human agreement that was not given. Link the decision to the affected ticket using its current etag. Skip routine implementation details.`,
  },
  {
    id: "rulebook",
    group: "Document the project",
    title: "Maintain the rulebook",
    purpose:
      "Add or revise shared UI guidance so future work stays consistent.",
    prerequisites:
      "A repeatable interface convention with a concrete rationale and scope.",
    prompt: () =>
      `Review the existing rulebook before proposing a new rule. Draft only durable, reusable UI guidance: the rule, context, rationale, examples or affected components, tradeoffs, attribution, and related ticket references. Reuse or amend an existing rule where it already covers the need. Do not use the rulebook to approve implementation scope or to replace a human product decision.`,
  },
  {
    id: "screenshot-feedback",
    group: "Feedback & navigation",
    title: "Give screenshot feedback",
    purpose:
      "Turn visual feedback into clear, durable implementation direction.",
    prerequisites:
      "A screenshot in the project and the relevant ticket number, if there is one.",
    prompt: () =>
      `Help me turn screenshot feedback into an actionable note. Refer to the supplied screenshot and any stable annotation IDs. Describe the observed area, desired result, priority, and acceptance check; distinguish facts from preferences. If a ticket is affected, add the feedback to that ticket's conversation with its current etag. Do not infer missing image details, run code from the screenshot, or mutate unrelated tickets.`,
  },
  {
    id: "shortcuts",
    group: "Feedback & navigation",
    title: "Use Control Room shortcuts",
    purpose: "Quickly navigate without starting work or changing tickets.",
    prerequisites: "The Control Room web app is open.",
    prompt: () =>
      `Show me how to navigate Control Room efficiently. Use ? to open the keyboard-shortcut reference; N creates a ticket, Cmd/Ctrl+K focuses the current view filter, and Esc closes or clears the active interaction. Explain the relevant shortcut before I use it. Do not claim tickets, run an agent, or mutate board records.`,
  },
];
