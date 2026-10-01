import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { hash, Problem, read, walk } from "./files.js";
import type { Store } from "./store.js";
import type { Actor } from "./types.js";
import type { OrchestrationConfig } from "./orchestration-types.js";

export type AgentConfigProposal = {
  schema: 1;
  id: string;
  status: "pending" | "applied" | "discarded";
  proposedBy: Actor;
  createdAt: string;
  baseRevision: string;
  baseConfig: OrchestrationConfig;
  config: OrchestrationConfig;
  workerBrief?: string;
  baseWorkerBrief?: string;
  decidedBy?: Actor;
  decidedAt?: string;
  revision: string;
};
export type AgentConfigProposalSummary = Pick<
  AgentConfigProposal,
  "id" | "proposedBy" | "createdAt" | "revision"
>;
const actor = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(["human", "agent"]),
});
const schema = z
  .object({
    schema: z.literal(1),
    id: z.string().regex(/^agent-proposal-[a-f0-9]+$/),
    status: z.enum(["pending", "applied", "discarded"]),
    proposedBy: actor,
    createdAt: z.string().datetime(),
    baseRevision: z.string().min(1),
    baseConfig: z.record(z.string(), z.unknown()),
    config: z.record(z.string(), z.unknown()),
    workerBrief: z.string().max(40000).optional(),
    baseWorkerBrief: z.string().max(40000).optional(),
    decidedBy: actor.optional(),
    decidedAt: z.string().datetime().optional(),
  })
  .strict();
export function proposalPath(id: string) {
  if (!/^agent-proposal-[a-f0-9]+$/.test(id))
    throw new Problem(400, "Invalid agent configuration proposal ID");
  return `records/agent-proposals/${id}.json`;
}
export function readAgentConfigProposal(
  store: Store,
  id: string,
): AgentConfigProposal {
  const file = store.file(proposalPath(id));
  if (!fs.existsSync(file))
    throw new Problem(404, "Agent configuration proposal not found");
  const content = read(file),
    value = schema.parse(JSON.parse(content));
  if (value.id !== id)
    throw new Problem(422, "Proposal ID must match its filename");
  return { ...value, revision: hash(content) } as AgentConfigProposal;
}
export function readAgentConfigProposals(store: Store) {
  const proposals: AgentConfigProposal[] = [],
    errors: { path: string; message: string }[] = [];
  for (const file of walk(store.file("records/agent-proposals"), ".json")) {
    try {
      proposals.push(
        readAgentConfigProposal(store, path.basename(file, ".json")),
      );
    } catch (error) {
      errors.push({
        path: path.relative(store.dir, file),
        message: String(error),
      });
    }
  }
  return {
    proposals: proposals.sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    ),
    errors,
  };
}
