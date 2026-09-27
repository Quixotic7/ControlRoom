export type Kind = "ticket" | "decision" | "rule";
export type Actor = { name: string; kind: "human" | "agent" };
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
  blocked?: string;
  dependencies?: string[];
  decisions?: string[];
  rules?: string[];
  attachments?: string[];
  handoff?: string;
  evidence?: string;
  reviewInstructions?: string;
  manualReviewRequired?: boolean;
  reviewVerificationAt?: string;
  question?: string;
  exceptions?: string;
  scope?: string[];
  strength?: "required" | "recommended";
  category?: string;
  supersedes?: string;
  references?: string[];
  worktree?: string;
  // Links from a ticket to the code that implements it.
  branch?: string;
  pr?: string;
  commits?: string[];
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
  revision: string;
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
  id: string;
  name: string;
  hash: string;
  width: number;
  height: number;
  mime: string;
  annotations: Annotation[];
  revision: string;
  missing?: boolean;
  createdAt: string;
};
export type ProjectState = {
  config: Config;
  configRevision: string;
  records: RecordFile[];
  comments: Comment[];
  attachments: Attachment[];
  claims: Claim[];
  errors: { path: string; message: string }[];
  branch: string;
  canonical: string;
  branchChanged: boolean;
  acknowledgedBranch: string;
  revision: string;
};
export const human: Actor = { name: "You", kind: "human" };
