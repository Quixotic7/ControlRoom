// Shared by context packets and MCP onboarding. The agent guide expands this
// same protocol with CLI examples; keep its core paragraphs in sync.
export const decisionProtocol = `Search existing decisions before creating one. Record consequential architecture, product, UI convention, dependency, or workflow choices when made; skip routine implementation details and trivia. Reuse a relevant decision instead of duplicating it.

Each decision records the choice, context, rationale, alternatives, tradeoffs, affected scope, attribution, and related ticket and implementation references. Link its ID from the ticket's decisions field. Label proposals and assumptions explicitly; use proposed until a choice is actually made. Agents may accept decisions within their remit, but must never invent human agreement.

When changing a choice, create a successor with supersedes pointing to the predecessor and explain why it changed. Preserve the predecessor and its rationale/history. Include decisions made or changed (IDs and a short explanation, or none) in the review handoff. Keep durable decisions in project knowledge so they remain discoverable after the originating ticket is archived. Recording or accepting a decision grants no implementation scope approval and no authority to mark a ticket Done.`;
