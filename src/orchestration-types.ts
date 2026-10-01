export type Harness = "codex" | "claude";
export type AgentProfile = {
  name: string;
  provider: Harness;
  executable: string;
  model: string;
  roleNote?: string;
  maxTurns?: number;
  timeoutMinutes?: number;
};
export type WorkerEnvironmentVariable = {
  name: string;
  source: "literal" | "host";
  value: string;
};
export type WorkerPermissions = {
  claudeAllowedTools: string[];
  additionalDirectories: string[];
  environment: WorkerEnvironmentVariable[];
};
export type CompanionRepository = {
  name: string;
  repository: string;
  baseRef: string;
  relativePath: string;
  mode: "writable" | "read-only";
};
export type ManagedRepository = CompanionRepository & {
  worktree: string;
  baseCommit: string;
  branch?: string;
};
export type OrchestrationConfig = {
  enabled: boolean;
  reviewerMode?: "managed" | "chat";
  repository: string;
  baseRef: string;
  companionRepositories?: CompanionRepository[];
  reviewer: AgentProfile;
  workers: AgentProfile[];
  concurrency: number;
  timeoutMinutes: number;
  maxAttempts: number;
  maxTurns: number;
  verificationTimeoutMinutes?: number;
  verificationCommand: string;
  humanPolicy: "flagged" | "parents" | "all";
  workerPermissions?: WorkerPermissions;
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
  resumeCount?: number;
  lastProcess?: { pid: number; startedAt?: string };
  worktree?: string;
  branch?: string;
  baseCommit?: string;
  repositories?: ManagedRepository[];
  revision: string;
  contextHash?: string;
  configHash: string;
  previous?: string;
  submission?: string;
  snapshot?: string;
  changedFiles?: string[];
  error?: string;
  failureKind?: "verification" | "limit";
  limitReason?: "turns" | "timeout";
  questionId?: string;
  result?: {
    outcome: string;
    summary: string;
    criteria: string;
    evidence: string;
    question: string;
  };
  launch?: {
    command: string;
    args: string[];
    environment: string[];
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
  repositories?: Array<{
    name: string;
    branch?: string;
    baseCommit: string;
    head: string;
    mode: "writable" | "read-only";
    code: string;
  }>;
};
