export type Harness = "codex" | "claude";
export type AgentProfile = {
  name: string;
  provider: Harness;
  executable: string;
  model: string;
};
export type OrchestrationConfig = {
  enabled: boolean;
  reviewerMode?: "managed" | "chat";
  repository: string;
  baseRef: string;
  reviewer: AgentProfile;
  workers: AgentProfile[];
  concurrency: number;
  timeoutMinutes: number;
  maxAttempts: number;
  maxTurns: number;
  verificationCommand: string;
  humanPolicy: "flagged" | "parents" | "all";
};
export type RunState =
  | "queued"
  | "awaiting_review"
  | "launching"
  | "running"
  | "verifying"
  | "waiting_input"
  | "completed"
  | "failed"
  | "interrupted"
  | "taken_over"
  | "recovery";
export type ManagedRun = {
  id: string;
  ticket: string;
  kind: "plan" | "work" | "review";
  agent: AgentProfile;
  state: RunState;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  lastEvent?: string;
  pid?: number;
  processStartedAt?: string;
  sessionId?: string;
  lastProcess?: { pid: number; startedAt?: string };
  worktree?: string;
  branch?: string;
  baseCommit?: string;
  revision: string;
  contextHash?: string;
  configHash: string;
  previous?: string;
  submission?: string;
  snapshot?: string;
  changedFiles?: string[];
  error?: string;
  failureKind?: "verification";
  questionId?: string;
  result?: {
    outcome: string;
    summary: string;
    criteria: string;
    evidence: string;
    question: string;
  };
};
export type Assignment = {
  runId: string;
  worker: string;
  assignedBy: string;
  assignedAt: string;
  state: "assigned" | "acknowledged" | "submitted" | "released";
  mode?: "managed" | "takeover";
};
export type AgentReviewReceipt = {
  runId: string;
  submission: string;
  reviewer: string;
  worker: string;
  at: string;
  revision: string;
  code: string;
  contextHash: string;
  outcome: "accept" | "changes" | "human";
  rationale: string;
  criteria: string;
  evidence: string;
  integration: "not-integrated";
};
