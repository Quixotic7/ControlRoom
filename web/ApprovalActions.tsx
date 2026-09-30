import { useState } from "react";
import type { Column, RecordFile } from "../src/types";
import { actor, api, recordId } from "./api";
import { randomUUID } from "./browserUtils";
import type { Context } from "./model";

export type ApprovalAction = "approve-scope" | "accept-review";
export type ApprovalResult = {
  id: string;
  outcome: "succeeded" | "ineligible" | "failed";
  status?: number;
  error?: string;
  record?: RecordFile;
};

export function approvedScope(
  record: RecordFile,
  byId: Map<string, RecordFile>,
) {
  const seen = new Set<string>();
  let current: RecordFile | undefined = record;
  while (current && !seen.has(current.meta.id)) {
    seen.add(current.meta.id);
    if (current.meta.scopeApproved) return current;
    current = current.meta.parent ? byId.get(current.meta.parent) : undefined;
  }
  return undefined;
}

export function ScopeState({
  record,
  ctx,
}: {
  record: RecordFile;
  ctx: Context;
}) {
  const scope = approvedScope(record, ctx.byId);
  if (!scope) return null;
  if (scope.meta.id === record.meta.id)
    return (
      <span
        className="tag green"
        title={
          record.meta.scopeApprovedBy
            ? `Approved by ${record.meta.scopeApprovedBy.name}`
            : "This ticket's scope is explicitly approved"
        }
      >
        Approved scope
      </span>
    );
  return (
    <span
      className="tag inherited-scope"
      title={`Scope inherited from ${recordId(scope)} ${scope.meta.title}`}
    >
      Inherited scope · {recordId(scope)}
    </span>
  );
}

export async function applyApprovalAction(
  records: RecordFile[],
  action: ApprovalAction,
  target?: string,
) {
  return api<{ action: ApprovalAction; results: ApprovalResult[] }>(
    "/approval-actions",
    "POST",
    {
      action,
      target,
      items: records.map((record) => ({
        id: record.meta.id,
        revision: record.revision,
        ...(action === "accept-review" ? { requestId: randomUUID() } : {}),
      })),
      actor,
    },
  );
}

export function QuickApprovalActions({
  record,
  ctx,
  columns,
  disabled,
  reload,
  showScopeState = true,
}: {
  record: RecordFile;
  ctx: Context;
  columns: Column[];
  disabled: boolean;
  reload: () => Promise<void>;
  showScopeState?: boolean;
}) {
  const role = columns.find((column) => column.id === record.meta.status)?.role;
  const scope = approvedScope(record, ctx.byId);
  const done = columns.filter((column) => column.role === "done");
  const [doneId, setDoneId] = useState(done.length === 1 ? done[0].id : "");
  const [busy, setBusy] = useState<ApprovalAction | null>(null);
  const [result, setResult] = useState<ApprovalResult | null>(null);

  async function run(action: ApprovalAction) {
    if (busy) return;
    setBusy(action);
    setResult(null);
    try {
      const response = await applyApprovalAction(
        [record],
        action,
        action === "accept-review" ? doneId : undefined,
      );
      setResult(response.results[0]);
      await reload();
    } catch (error) {
      setResult({
        id: record.meta.id,
        outcome: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  }

  if (!showScopeState && scope && role !== "review" && !result) return null;

  return (
    <div
      className="quick-approval-actions"
      aria-label={`Actions for ${record.meta.title}`}
    >
      {showScopeState && <ScopeState record={record} ctx={ctx} />}
      {!scope && (
        <button
          className="button small"
          disabled={disabled || !!busy}
          onClick={() => void run("approve-scope")}
        >
          {busy === "approve-scope" ? "Approving…" : "Approve scope"}
        </button>
      )}
      {role === "review" && (
        <details className="quick-review">
          <summary className="button small">Review &amp; accept…</summary>
          <div className="quick-review-panel">
            <strong>Summary</strong>
            <p>
              {record.meta.handoff?.trim() || "No handoff summary submitted."}
            </p>
            <strong>Evidence</strong>
            <p>{record.meta.evidence?.trim() || "No evidence submitted."}</p>
            {done.length > 1 && (
              <label className="field">
                Done destination
                <select
                  value={doneId}
                  onChange={(event) => setDoneId(event.target.value)}
                  disabled={disabled || !!busy}
                >
                  <option value="">Choose Done column</option>
                  {done.map((column) => (
                    <option value={column.id} key={column.id}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="button primary small"
              disabled={disabled || !!busy || !doneId}
              onClick={() => void run("accept-review")}
            >
              {busy === "accept-review" ? "Accepting…" : "Accept into Done"}
            </button>
          </div>
        </details>
      )}
      {result && (
        <span
          className={`quick-action-result ${result.outcome}`}
          role={result.outcome === "succeeded" ? "status" : "alert"}
        >
          {result.outcome === "succeeded"
            ? "Saved"
            : `${result.outcome}: ${result.error}`}
        </span>
      )}
    </div>
  );
}
