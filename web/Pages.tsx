import { ticketNavigation } from "./ticketNavigation";
import React, { useState } from "react";
import type { ProjectState, RecordFile } from "../src/types";
import { ago, recordId } from "./api";
import {
  BlockedIcon,
  BookIcon,
  CheckIcon,
  DecisionIcon,
  PlusIcon,
  QuestionIcon,
  SearchIcon,
} from "./Icons";
import type { AttentionReason } from "./model";

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="inline-actions">{children}</div>}
    </div>
  );
}

const reasons: Record<AttentionReason, [() => React.JSX.Element, string]> = {
  blocked: [BlockedIcon, "Blocked"],
  review: [CheckIcon, "Ready for your review"],
  question: [QuestionIcon, "Open question"],
  rules: [BookIcon, "Rule guidance changed"],
};

export function AttentionPage({
  items,
  changedDocs,
  onOpen,
  onMarkSeen,
  proposals = [],
  onOpenAgents,
}: {
  items: [RecordFile, AttentionReason][];
  changedDocs: RecordFile[];
  onOpen: (id: string) => void;
  onMarkSeen: () => void;
  proposals?: NonNullable<ProjectState["agentConfigProposals"]>;
  onOpenAgents?: () => void;
}) {
  return (
    <>
      <PageHeader
        title="Needs you"
        description="Questions, blockers, and work ready for your judgment."
      />
      <div className="list-panel">
        {proposals.map(proposal => <button key={proposal.id} className="list-row" onClick={onOpenAgents}><span className="row-main"><strong>Agent configuration proposal</strong><small>Proposed by {proposal.proposedBy.name} · review and apply in Agents</small></span></button>)}
        {items.map(([r, reason]) => {
          const Icon = reasons[reason][0];
          return (
            <button
              className="list-row"
              key={r.meta.id}
              data-reason={reason}
              {...ticketNavigation(r.meta.id, onOpen)}
            >
              <span className="row-icon" aria-hidden>
                <Icon />
              </span>
              <span className="row-main">
                <strong>{r.meta.title}</strong>
                <small>
                  {reason === "blocked" ? r.meta.blocked : reasons[reason][1]}
                </small>
              </span>
              <span className="record-id">{recordId(r)}</span>
            </button>
          );
        })}
        {!items.length && !proposals.length && (
          <p className="list-empty">✓ No tickets need you right now.</p>
        )}
      </div>
      {changedDocs.length > 0 && (
        <>
          <div className="section-heading">
            <h3>Changed project knowledge</h3>
            <button className="button subtle" onClick={onMarkSeen}>
              Mark seen
            </button>
          </div>
          <div className="list-panel">
            {changedDocs.map((r) => (
              <button
                className="list-row"
                key={r.meta.id}
                {...ticketNavigation(r.meta.id, onOpen)}
              >
                <span className="row-icon" aria-hidden>
                  <DecisionIcon />
                </span>
                <span className="row-main">
                  <strong>{r.meta.title}</strong>
                  <small>
                    {r.meta.kind} · {r.meta.status} · updated{" "}
                    {ago(r.meta.updatedAt)}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export function KnowledgePage({
  kind,
  state,
  onOpen,
  onCreate,
  onImport,
}: {
  kind: "decision" | "rule";
  state: ProjectState;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onImport: () => void;
}) {
  const [search, setSearch] = useState("");
  const all = state.records.filter((r) => r.meta.kind === kind);
  const shown = all.filter((r) =>
    `${r.meta.title} ${r.body} ${r.meta.category ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const decisions = kind === "decision";
  return (
    <>
      <PageHeader
        title={decisions ? "Project decisions" : "UI rulebook"}
        description={
          decisions
            ? "The choices that shape this project, and the reasons behind them."
            : "Shared principles for consistent interfaces."
        }
      >
        {!decisions && (
          <button className="button" onClick={onImport}>
            Set up from existing docs
          </button>
        )}
        <button className="button primary" onClick={onCreate}>
          <PlusIcon />
          {decisions ? "New decision" : "New rule"}
        </button>
      </PageHeader>
      {all.length > 0 && (
        <div className="filter-bar">
          <label className="filter-input">
            <span aria-hidden>
              <SearchIcon />
            </span>
            <input
              aria-label="Search knowledge"
              placeholder="Search titles, rationale, and guidance…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
      )}
      <div className="knowledge-grid">
        {shown.map((r) => {
          const broken = (state.referenceChecks?.[r.meta.id] ?? []).filter(
            (reference) => reference.status === "missing",
          );
          return (
            <button
              className="knowledge-card"
              key={r.meta.id}
              {...ticketNavigation(r.meta.id, onOpen)}
            >
              <span className="card-meta">
                <span className="tag">{r.meta.category ?? r.meta.kind}</span>
                <span
                  className={`tag ${["accepted", "active"].includes(r.meta.status) ? "green" : ""}`}
                >
                  {r.meta.status}
                </span>
                <span className="time">{ago(r.meta.updatedAt)}</span>
              </span>
              <h2>{r.meta.title}</h2>
              <p>
                {r.body.replace(/[#*`]/g, "").slice(0, 180) ||
                  "Add context, rationale, and examples."}
              </p>
              <span className="muted">
                {r.meta.strength ?? r.meta.author.name}
              </span>
              {!!broken.length && (
                <span className="tag danger">
                  {broken.length} broken reference
                  {broken.length === 1 ? "" : "s"}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {!all.length && (
        <div className="empty-state">
          <span className="empty-icon">
            {decisions ? <DecisionIcon /> : <BookIcon />}
          </span>
          <h2>
            {decisions
              ? "Keep the reasoning, not just the result"
              : "Give every interface a common language"}
          </h2>
          <p>
            {decisions
              ? "Record the choices that should outlive any single task or agent session."
              : "Add a rule with its rationale, scope, and a reference to the components you already use."}
          </p>
          <button className="button primary" onClick={onCreate}>
            {decisions ? "Record a decision" : "Create a design rule"}
          </button>
        </div>
      )}
    </>
  );
}
