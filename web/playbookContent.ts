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
};

export const playbookGroups = [
  "Connect & orient",
  "Shape approved work",
  "Work with the board",
  "Document the project",
  "Feedback & navigation",
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
    prompt: ({ project, branch }) =>
      `I am working in the ${project} project on branch ${branch}. Read AGENT_GUIDE.md first and follow it exactly. Connect to this board through the project's Control Room MCP server if available; otherwise use ./controlroom help from the tool source checkout. Set CONTROLROOM_ACTOR to your agent name and CONTROLROOM_ACTOR_KIND=agent. Do not expose, copy, or send any local authentication token. Explain the next safe board action before making a write.`,
  },
  {
    id: "orient",
    group: "Connect & orient",
    title: "Find the next approved task",
    purpose:
      "Ask an agent to identify work that is ready without claiming or changing anything yet.",
    prerequisites: "Connected to the board and familiar with AGENT_GUIDE.md.",
    prompt: ({ project, branch }) =>
      `I am working in ${project} on ${branch}. Read AGENT_GUIDE.md, then inspect the board's next approved ticket using the MCP next_ticket tool or controlroom next. Summarize the ticket's approved scope, acceptance criteria, dependencies, applicable decisions, and current revision. Do not claim, move, edit, assign, or start work until I explicitly choose the ticket.`,
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
      `Help me refine Concept ticket #${ticket}. First read its context with controlroom context ${ticket} --brief (public ticket number: ${ticket}). Propose a concise intended outcome, boundaries, acceptance criteria, risks, dependencies, and human-review steps. Keep it in Concept: do not claim it, change scopeApproved, move it to In Progress, or implement it. Ask focused human questions for missing decisions.`,
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
      `Plan approved parent ticket #${ticket}. Read its latest brief first: controlroom context ${ticket} --brief. Propose small child tickets only where they can be independently implemented and reviewed. For each child, include scope, acceptance criteria, dependencies, verification, and a reason it belongs under parent #${ticket}. Preserve the parent as the outcome review; do not claim, assign, move, or create records until I approve the plan.`,
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
      `I want to work on approved ticket #${ticket}. Read AGENT_GUIDE.md and then controlroom context ${ticket} --brief. Verify its approved scope, current revision, dependencies, decisions, rules, and whether another live claim exists. If it is safe, claim it with the public numeric command controlroom claim ${ticket}, then move it to progress using its current etag. Work only within the approved scope. If approval, ownership, or requirements are unclear, stop and ask a human instead of making assumptions.`,
  },
  {
    id: "progress",
    group: "Work with the board",
    title: "Report useful progress",
    purpose: "Leave a factual update that makes a handoff or review easier.",
    prerequisites: "An actively claimed ticket and its current etag.",
    needsTicket: true,
    prompt: ({ ticket }) =>
      `For ticket #${ticket}, read the current context first with controlroom context ${ticket} --brief. Draft a concise progress update: what changed, what remains, verification run so far, and any blocker or decision needed. Use controlroom progress ${ticket} --etag CURRENT_ETAG --body "..."; replace CURRENT_ETAG and the quoted body with current values. Do not overstate progress, change status, or resolve a human question.`,
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
      `Prepare ticket #${ticket} for review. Re-read controlroom context ${ticket} --brief and compare the implementation with every acceptance criterion. Run the relevant verification in this checkout. Then submit review using the current etag, a detailed handoff, concrete human review steps and expected results, the exact command, and factual output: controlroom review ${ticket} --etag CURRENT_ETAG --handoff "..." --review-notes "..." --run "...". Include any exceptions and decisions made (or say none). Do not mark #${ticket} Done: Review and human acceptance are separate steps.`,
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
      `Respond to feedback on ticket #${ticket}. Read its latest context and conversation with controlroom context ${ticket} --brief before acting. Summarize each requested change, identify any scope ambiguity, and make only changes that remain within the approved scope. If the revision changed, use the new etag rather than retrying an old write. Verify the correction, report what changed, and return the ticket to Review with fresh evidence. Ask a human if the feedback expands scope or needs product judgment.`,
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
