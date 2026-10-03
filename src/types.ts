import type { Assignment, AgentReviewReceipt } from "./orchestration-types.js";
import type { DelegatedAttribution, DelegationStatus } from "./delegation.js";
export type Kind = "ticket" | "decision" | "rule";
export type Actor = { name: string; kind: "human" | "agent" };
export type ReviewBuild = {
  path: string;
  label?: string;
  sha?: string;
  at: string;
  actor: Actor;
};
export type ReviewBuildInput =
  | string
  | null
  | { path: string; label?: string; sha?: string };
export type RuleException = {
  rationale: string;
  actor: Actor;
  at: string;
};
export type ReferenceCheck = {
  reference: string;
  kind: "record" | "path" | "url";
  status: "available" | "missing" | "external";
  target?: string;
  archived?: boolean;
};
export type RuleApplicability = {
  rule: string;
  reasons: string[];
  references: ReferenceCheck[];
};
export type MergeConflictField =
  | "parent"
  | "status"
  | "owner"
  | "priority"
  | "acceptanceCriteria";
export type MergeResolution = "survivor" | "source" | "both";
export type DuplicateMerge = {
  requestId: string;
  fingerprint: string;
  survivor: string;
  source: string;
  at: string;
  actor: Actor;
  resolutions: Partial<Record<MergeConflictField, MergeResolution>>;
  affected: string[];
};
export type Meta = {
  schema: number;
  id: string;
  kind: Kind;
  number?: number;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  author: Actor;
  labels?: string[];
  parent?: string | null;
  priority?: number;
  order?: number;
  owner?: string;
  scopeApproved?: boolean;
  scopeApprovedAt?: string;
  scopeApprovedBy?: Actor;
  scopeApprovedDelegation?: DelegatedAttribution;
  blocked?: string;
  dependencies?: string[];
  related?: string[];
  duplicateOf?: string;
  mergedFrom?: string[];
  duplicateMerge?: DuplicateMerge;
  decisions?: string[];
  rules?: string[];
  attachments?: string[];
  handoff?: string;
  evidence?: string;
  reviewInstructions?: string;
  manualReviewRequired?: boolean;
  humanReviewRequired?: boolean;
  assignment?: Assignment;
  agentReview?: AgentReviewReceipt;
  reviewVerificationAt?: string;
  acceptedDelegation?: DelegatedAttribution;
  question?: string;
  progress?: { note: string; percent?: number; at: string; actor: Actor };
  progressStartedAt?: string;
  exceptions?: string;
  exceptionHistory?: RuleException[];
  scope?: string[];
  strength?: "required" | "recommended";
  category?: string;
  supersedes?: string;
  references?: string[];
  worktree?: string;
  repositories?: string[];
  // Links from a ticket to the code that implements it.
  branch?: string;
  pr?: string;
  commits?: string[];
  build?: ReviewBuild;
  // Structured evidence captured by `review --run`: what ran and how it ended.
  verification?: Verification;
  reviewedRules?: Record<string, string>;
  archived?: boolean;
  [key: string]: unknown;
};
export type Verification = {
  command: string;
  exitCode: number;
  output: string;
  at: string;
  cwd?: string;
};
export type RecordFile = {
  meta: Meta;
  body: string;
  revision: string;
  path: string;
};
export type Comment = {
  id: string;
  ticket: string;
  actor: Actor;
  at: string;
  kind: "comment" | "question" | "handoff" | "review";
  body: string;
  resolved?: boolean;
  resolvedBy?: Actor;
  replies?: {
    actor: Actor;
    at: string;
    body: string;
    runId: string;
  }[];
  questions?: import("./questionnaire.js").QuestionSpec;
  answers?: {
    actor: Actor;
    at: string;
    questions: import("./questionnaire.js").QuestionSpec;
    values: Record<string, string>;
    choiceAnswers?: import("./questionnaire.js").ChoiceAnswers;
  }[];
  revision: string;
};
export type FeedEventType =
  | "created"
  | "transition"
  | "edit"
  | "comment"
  | "question"
  | "review"
  | "handoff"
  | "decision"
  | "rule"
  | "archive";
export type FeedRecordReference = {
  id: string;
  kind: Kind;
  number?: number;
  title: string;
  archived?: boolean;
  missing?: boolean;
};
export type FeedEntry = {
  id: string;
  sourceIds: string[];
  at: string;
  actor: Actor;
  eventType: FeedEventType;
  record: FeedRecordReference;
  summary: string;
  commentId?: string;
  groupedCount?: number;
};
export type FeedFacetTicket = FeedRecordReference;
export type FeedPage = {
  entries: FeedEntry[];
  nextCursor?: string;
  hasMore: boolean;
  facets: {
    actors: Actor[];
    eventTypes: FeedEventType[];
    tickets: FeedFacetTicket[];
  };
};
export type Column = {
  id: string;
  name: string;
  role: "backlog" | "selected" | "progress" | "review" | "done";
};
export type ViewLayout = "board" | "table";
export type GroupBy =
  | "none"
  | "parent"
  | "status"
  | "priority"
  | "owner"
  | "label";
export type SortBy = "manual" | "priority" | "number" | "updated" | "title";
// A saved project view, like a GitHub Projects view tab.
export type ProjectView = {
  id: string;
  name: string;
  layout: ViewLayout;
  filter: string;
  groupBy: GroupBy;
  sort: SortBy;
};
export type Config = {
  schema: number;
  projectId: string;
  name: string;
  columns: Column[];
  views?: ProjectView[];
  shortcut: {
    mode?: "double-alt" | "hotkey";
    key: number;
    modifiers: number;
    label: string;
  };
  [key: string]: unknown;
};
export type Claim = {
  ticket: string;
  actor: Actor;
  worktree: string;
  branch?: string;
  expiresAt: string;
  reportedAt: string;
};
export type Annotation = {
  id: string;
  type: "pin" | "box" | "arrow" | "draw" | "text";
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  points?: number[][];
  text: string;
  resolved: boolean;
  actor?: Actor;
  color?: string;
};
export type Attachment = {
  trashedAt?: string;
  trashedBy?: Actor;
  permanentlyDeletedAt?: string;
  permanentlyDeletedBy?: Actor;
  id: string;
  name: string;
  hash: string;
  width: number;
  height: number;
  mime: string;
  annotations: Annotation[];
  revision: string;
  missing?: boolean;
  referenceMissing?: boolean;
  createdAt: string;
};
export type ProjectState = {
  agentConfigProposals?: import("./agent-config-proposals.js").AgentConfigProposalSummary[];
  config: Config;
  configRevision: string;
  records: RecordFile[];
  comments: Comment[];
  attachments: Attachment[];
  claims: Claim[];
  errors: { path: string; message: string }[];
  referenceChecks?: Record<string, ReferenceCheck[]>;
  managedQuestions?: Record<
    string,
    {
      runId: string;
      state: string;
      error?: string;
      retryRunId?: string;
      canAct: boolean;
    }
  >;
  delegation?: DelegationStatus;
  branch: string;
  canonical: string;
  branchChanged: boolean;
  acknowledgedBranch: string;
  revision: string;
};
export const human: Actor = { name: "You", kind: "human" };
