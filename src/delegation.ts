import { z } from "zod";
import type { Actor } from "./types.js";

export const delegationScopeSchema = z.enum([
  "approveScope",
  "manageBoard",
  "reviewWork",
  "manageRuns",
]);
export type DelegationScope = z.infer<typeof delegationScopeSchema>;

export const delegationScopesSchema = z
  .object({
    approveScope: z.boolean(),
    manageBoard: z.boolean(),
    reviewWork: z.boolean(),
    manageRuns: z.boolean(),
  })
  .strict();
export type DelegationScopes = z.infer<typeof delegationScopesSchema>;

export const delegationBasisSchema = z
  .object({
    quote: z.string().trim().min(1).max(10_000),
    saidAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type DelegationBasis = z.infer<typeof delegationBasisSchema>;

export const configureDelegationSchema = z
  .object({
    enabled: z.boolean(),
    scopes: delegationScopesSchema,
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
    createdBeforeGrant: z.boolean().default(false),
    approvedGoalsOnly: z.boolean().default(false),
  })
  .strict();
export type ConfigureDelegationInput = z.input<
  typeof configureDelegationSchema
>;

export type DelegationGrant = {
  schema: 1;
  enabled: boolean;
  reviewer: string;
  scopes: DelegationScopes;
  grantedBy: Actor & { kind: "human" };
  grantedAt: string;
  expiresAt?: string;
  createdBeforeGrant: boolean;
  approvedGoalsOnly: boolean;
};

const delegationActorSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    kind: z.enum(["human", "agent"]),
  })
  .strict();

export const delegationGrantSchema = z
  .object({
    schema: z.literal(1),
    enabled: z.boolean(),
    reviewer: z.string().trim().max(100),
    scopes: delegationScopesSchema,
    grantedBy: delegationActorSchema.extend({ kind: z.literal("human") }),
    grantedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    createdBeforeGrant: z.boolean(),
    approvedGoalsOnly: z.boolean(),
  })
  .strict();

export type DelegatedAttribution = {
  receiptId: string;
  actor: Actor & { kind: "agent" };
  grantingHuman: Actor & { kind: "human" };
  basis: DelegationBasis;
  at: string;
};

export type DelegationAuthority = {
  scope: DelegationScope;
  actor: Actor & { kind: "agent" };
  grantingHuman: Actor & { kind: "human" };
  basis: DelegationBasis;
  grantRevision: string;
  authorizedAt: string;
};

export type DelegatedSnapshot = {
  revision: string;
  existed: boolean;
  content?: string;
};

export type DelegatedActionTarget = {
  kind: "record" | "external";
  id: string;
  title?: string;
  path?: string;
  before: DelegatedSnapshot;
  after: DelegatedSnapshot;
};

export type ManagedRunDelegationUndo = {
  kind: "managed-run";
  action: "question_retry" | "resume" | "stop";
  runId: string;
  questionId?: string;
  beforeRunSnapshot: Record<string, unknown>;
  beforeTicketState?: {
    revision: string;
    status: string;
    owner?: string;
    assignment?: {
      runId: string;
      worker: string;
      assignedBy: string;
      assignedAt: string;
      state: "assigned" | "acknowledged" | "submitted" | "released";
      mode?: "managed" | "takeover";
    };
  };
  beforeQuestionRevision?: string;
  afterQuestionRevision?: string;
  successorId?: string;
  afterRunRevision?: string;
  afterRunState?: string;
};

export type DelegatedActionName =
  | "approve_scope"
  | "update"
  | "archive"
  | "unarchive"
  | "accept_review"
  | "request_changes"
  | "merge_duplicate"
  | "question_retry"
  | "resume_run"
  | "stop_run"
  | "undo";

export type DelegatedActionReceipt = {
  schema: 1;
  id: string;
  action: DelegatedActionName;
  scope: DelegationScope;
  targets: DelegatedActionTarget[];
  actor: Actor;
  grantingHuman: Actor & { kind: "human" };
  basis: DelegationBasis;
  grantRevision: string;
  at: string;
  externalUndo?: ManagedRunDelegationUndo;
  undoOf?: string;
  note?: string;
  revision: string;
};

const delegatedSnapshotSchema = z
  .object({
    revision: z.string(),
    existed: z.boolean(),
    content: z.string().max(2_000_000).optional(),
  })
  .strict();
const delegatedTargetSchema = z
  .object({
    kind: z.enum(["record", "external"]),
    id: z.string().min(1).max(300),
    title: z.string().max(300).optional(),
    path: z.string().max(1000).optional(),
    before: delegatedSnapshotSchema,
    after: delegatedSnapshotSchema,
  })
  .strict();
const managedRunUndoSchema = z
  .object({
    kind: z.literal("managed-run"),
    action: z.enum(["question_retry", "resume", "stop"]),
    runId: z.string().min(1).max(300),
    questionId: z.string().max(300).optional(),
    beforeRunSnapshot: z.record(z.string(), z.unknown()),
    beforeTicketState: z
      .object({
        revision: z.string().min(1),
        status: z.string().min(1),
        owner: z.string().optional(),
        assignment: z
          .object({
            runId: z.string().min(1),
            worker: z.string().min(1),
            assignedBy: z.string().min(1),
            assignedAt: z.string().datetime({ offset: true }),
            state: z.enum([
              "assigned",
              "acknowledged",
              "submitted",
              "released",
            ]),
            mode: z.enum(["managed", "takeover"]).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    beforeQuestionRevision: z.string().optional(),
    afterQuestionRevision: z.string().optional(),
    successorId: z.string().max(300).optional(),
    afterRunRevision: z.string().optional(),
    afterRunState: z.string().max(100).optional(),
  })
  .strict();
export const delegatedActionFileSchema = z
  .object({
    schema: z.literal(1),
    id: z.string().regex(/^delegated-action-[a-f0-9]+$/),
    action: z.enum([
      "approve_scope",
      "update",
      "archive",
      "unarchive",
      "accept_review",
      "request_changes",
      "merge_duplicate",
      "question_retry",
      "resume_run",
      "stop_run",
      "undo",
    ]),
    scope: delegationScopeSchema,
    targets: z.array(delegatedTargetSchema).min(1).max(1000),
    actor: delegationActorSchema,
    grantingHuman: delegationActorSchema.extend({ kind: z.literal("human") }),
    basis: delegationBasisSchema,
    grantRevision: z.string(),
    at: z.string().datetime(),
    externalUndo: managedRunUndoSchema.optional(),
    undoOf: z
      .string()
      .regex(/^delegated-action-[a-f0-9]+$/)
      .optional(),
    note: z.string().max(10_000).optional(),
  })
  .strict();

export type DelegatedActionSummary = Omit<
  DelegatedActionReceipt,
  "targets" | "externalUndo"
> & {
  targets: {
    kind: DelegatedActionTarget["kind"];
    id: string;
    title?: string;
    beforeRevision: string;
    afterRevision: string;
  }[];
  undoneAt?: string;
  undoneBy?: Actor;
  undoReceiptId?: string;
};

export type DelegationStatus = {
  revision: string;
  grant: DelegationGrant | null;
  receipts: DelegatedActionSummary[];
};

export const delegatedBoardActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("approve"),
      ticket: z.string().min(1),
      revision: z.string().min(1),
      basis: delegationBasisSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("update"),
      ticket: z.string().min(1),
      revision: z.string().min(1),
      patch: z.record(z.string(), z.unknown()),
      body: z.string().optional(),
      basis: delegationBasisSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("archive"),
      ticket: z.string().min(1),
      revision: z.string().min(1),
      archived: z.boolean().default(true),
      basis: delegationBasisSchema,
    })
    .strict(),
  z
    .object({
      action: z.enum(["accept", "request_changes"]),
      ticket: z.string().min(1),
      revision: z.string().min(1),
      requestId: z.string().uuid(),
      target: z.string().min(1).optional(),
      feedback: z.string().trim().max(10_000).default(""),
      patch: z.record(z.string(), z.unknown()).default({}),
      body: z.string().optional(),
      basis: delegationBasisSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("merge"),
      ticket: z.string().min(1),
      source: z.union([z.string(), z.number().int().nonnegative()]),
      requestId: z.string().min(8).max(200),
      revisions: z.record(z.string(), z.string()),
      resolutions: z
        .partialRecord(
          z.enum([
            "parent",
            "status",
            "owner",
            "priority",
            "acceptanceCriteria",
          ]),
          z.enum(["survivor", "source", "both"]),
        )
        .default({}),
      basis: delegationBasisSchema,
    })
    .strict(),
]);
export type DelegatedBoardActionInput = z.input<
  typeof delegatedBoardActionSchema
>;
