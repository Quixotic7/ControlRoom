import { useEffect, useMemo, useState } from "react";
import type { Column, RecordFile } from "../src/types";
import { actor, api, recordId } from "./api";
import { bulkPatch, commonValue, type BulkChanges } from "./bulkEdit";
import { priorities, priorityOf } from "./model";
import { ParentInput } from "./ParentInput";
import { TagInput } from "./TagInput";

type Result = {
  id: string;
  displayId: string;
  title: string;
  outcome: "succeeded" | "failed" | "unchanged";
  error?: string;
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function BulkEditBar({
  selected,
  visibleCount,
  records,
  columns,
  disabled,
  onSelectAll,
  onClear,
  onKeepSelected,
  reload,
}: {
  selected: RecordFile[];
  visibleCount: number;
  records: RecordFile[];
  columns: Column[];
  disabled: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onKeepSelected: (ids: Set<string>) => void;
  reload: () => Promise<void>;
}) {
  const [statusEnabled, setStatusEnabled] = useState(false);
  const [priorityEnabled, setPriorityEnabled] = useState(false);
  const [ownerEnabled, setOwnerEnabled] = useState(false);
  const [parentEnabled, setParentEnabled] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [priority, setPriority] = useState<number | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null | undefined>(undefined);
  const [addLabels, setAddLabels] = useState<string[]>([]);
  const [removeLabels, setRemoveLabels] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  const sharedStatus = commonValue(selected.map((r) => r.meta.status));
  const sharedPriority = commonValue(selected.map(priorityOf));
  const sharedOwner = commonValue(selected.map((r) => r.meta.owner ?? ""));
  const sharedParent = commonValue(selected.map((r) => r.meta.parent ?? null));
  const sharedLabels = commonValue(
    selected.map((r) => JSON.stringify(r.meta.labels ?? [])),
  );
  const selectionKey = selected.map((r) => r.meta.id).join("|");
  const labelChoices = useMemo(
    () => [...new Set(records.flatMap((r) => r.meta.labels ?? []))],
    [records],
  );
  const ownerChoices = useMemo(
    () => [...new Set(records.map((r) => r.meta.owner ?? "").filter(Boolean))],
    [records],
  );

  // A cleared/completed selection starts a fresh draft next time. Failed-only
  // selections deliberately keep the draft so the user can correct and retry.
  useEffect(() => {
    if (selected.length) return;
    setStatusEnabled(false);
    setPriorityEnabled(false);
    setOwnerEnabled(false);
    setParentEnabled(false);
    setStatus(null);
    setPriority(null);
    setOwner(null);
    setParent(undefined);
    setAddLabels([]);
    setRemoveLabels([]);
  }, [selected.length]);

  const summary = (value: string | number | null | undefined, label: string) =>
    value === undefined
      ? "Mixed"
      : value === null || value === ""
        ? `No ${label}`
        : String(value);
  const statusValue = status ?? sharedStatus ?? columns[0]?.id ?? "";
  const priorityValue = priority ?? sharedPriority ?? 2;
  const ownerValue = owner ?? sharedOwner ?? "";
  const parentValue = parent !== undefined ? parent : (sharedParent ?? null);
  const statusName =
    columns.find((column) => column.id === sharedStatus)?.name ?? "Mixed";
  const sharedParentRecord = records.find(
    (record) => record.meta.id === sharedParent,
  );
  const parentSummary =
    sharedParent === undefined
      ? "Mixed"
      : sharedParent === null
        ? "No parent"
        : sharedParentRecord
          ? `${recordId(sharedParentRecord)} ${sharedParentRecord.meta.title}`
          : "Unavailable parent";

  async function apply() {
    if (!selected.length || applying) return;
    const changes: BulkChanges = {
      ...(statusEnabled ? { status: statusValue } : {}),
      ...(priorityEnabled ? { priority: priorityValue } : {}),
      ...(ownerEnabled ? { owner: ownerValue.trim() } : {}),
      ...(parentEnabled ? { parent: parentValue } : {}),
      addLabels,
      removeLabels,
    };
    const snapshot = [...selected];
    setApplying(true);
    setResults([]);
    const next = await Promise.all(
      snapshot.map(async (record): Promise<Result> => {
        const patch = bulkPatch(record, changes);
        if (!Object.keys(patch).length)
          return {
            id: record.meta.id,
            displayId: recordId(record),
            title: record.meta.title,
            outcome: "unchanged",
          };
        try {
          await api(`/records/${record.meta.id}`, "PATCH", {
            revision: record.revision,
            patch,
            actor,
          });
          return {
            id: record.meta.id,
            displayId: recordId(record),
            title: record.meta.title,
            outcome: "succeeded",
          };
        } catch (error) {
          return {
            id: record.meta.id,
            displayId: recordId(record),
            title: record.meta.title,
            outcome: "failed",
            error: messageOf(error),
          };
        }
      }),
    );
    const failed = new Set(
      next.filter((item) => item.outcome === "failed").map((item) => item.id),
    );
    setResults(next);
    onKeepSelected(failed);
    try {
      await reload();
    } finally {
      setApplying(false);
    }
  }

  const counts = {
    succeeded: results.filter((r) => r.outcome === "succeeded").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    unchanged: results.filter((r) => r.outcome === "unchanged").length,
  };
  return (
    <section className="bulk-editor" aria-label="Bulk edit tickets">
      <div className="bulk-bar" role="toolbar" aria-label="Ticket selection">
        <span className="count" role="status" aria-live="polite">
          {selected.length} selected
        </span>
        <button
          className="button subtle small"
          disabled={!visibleCount || selected.length === visibleCount}
          onClick={onSelectAll}
        >
          Select visible ({visibleCount})
        </button>
        <button
          className="button subtle small"
          disabled={!selected.length}
          onClick={onClear}
        >
          Clear selection
        </button>
      </div>
      {!!selected.length && (
        <div className="bulk-panel">
          <div className="bulk-fields">
            <div className="bulk-field">
              <label className="bulk-enable">
                <input
                  type="checkbox"
                  checked={statusEnabled}
                  onChange={(e) => setStatusEnabled(e.target.checked)}
                />
                Change status
                <span>{sharedStatus === undefined ? "Mixed" : statusName}</span>
              </label>
              <select
                aria-label="New status"
                disabled={!statusEnabled}
                value={statusValue}
                onChange={(e) => {
                  setStatusEnabled(true);
                  setStatus(e.target.value);
                }}
              >
                {columns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="bulk-field">
              <label className="bulk-enable">
                <input
                  type="checkbox"
                  checked={priorityEnabled}
                  onChange={(e) => setPriorityEnabled(e.target.checked)}
                />
                Change priority
                <span>
                  {sharedPriority === undefined
                    ? "Mixed"
                    : priorities[sharedPriority]}
                </span>
              </label>
              <select
                aria-label="New priority"
                disabled={!priorityEnabled}
                value={priorityValue}
                onChange={(e) => {
                  setPriorityEnabled(true);
                  setPriority(Number(e.target.value));
                }}
              >
                {priorities.map((name, index) => (
                  <option key={name} value={index}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="bulk-field">
              <label className="bulk-enable">
                <input
                  type="checkbox"
                  checked={ownerEnabled}
                  onChange={(e) => setOwnerEnabled(e.target.checked)}
                />
                Change owner
                <span>{summary(sharedOwner, "owner")}</span>
              </label>
              <input
                aria-label="New owner"
                disabled={!ownerEnabled}
                list="bulk-owner-choices"
                value={ownerValue}
                placeholder="Leave empty to clear"
                onChange={(e) => {
                  setOwnerEnabled(true);
                  setOwner(e.target.value);
                }}
              />
              <datalist id="bulk-owner-choices">
                {ownerChoices.map((name) => (
                  <option value={name} key={name} />
                ))}
              </datalist>
            </div>
            <div className="bulk-field">
              <label className="bulk-enable">
                <input
                  type="checkbox"
                  checked={parentEnabled}
                  onChange={(e) => setParentEnabled(e.target.checked)}
                />
                Change parent
                <span>{parentSummary}</span>
              </label>
              <ParentInput
                key={`bulk-parent-${selectionKey}`}
                records={records}
                columns={columns}
                ticketId={
                  selected.length === 1 ? selected[0].meta.id : undefined
                }
                value={parentValue}
                disabled={!parentEnabled}
                label="New parent"
                emptyLabel="No parent"
                clearLabel="Clear parent"
                above
                onChange={(value) => {
                  setParentEnabled(true);
                  setParent(value);
                }}
              />
            </div>
            <div className="bulk-field bulk-label-field">
              <span className="bulk-field-title">
                Labels{" "}
                <span>{sharedLabels === undefined ? "Mixed" : "Same"}</span>
              </span>
              <TagInput
                key={`bulk-add-${selectionKey}`}
                label="Add labels"
                multiple
                value={addLabels}
                choices={labelChoices.filter(
                  (label) => !removeLabels.includes(label),
                )}
                onChange={(value: string[]) => {
                  setAddLabels(value);
                  setRemoveLabels((current) =>
                    current.filter((label) => !value.includes(label)),
                  );
                }}
              />
              <TagInput
                key={`bulk-remove-${selectionKey}`}
                label="Remove labels"
                multiple
                value={removeLabels}
                choices={labelChoices.filter(
                  (label) => !addLabels.includes(label),
                )}
                onChange={(value: string[]) => {
                  setRemoveLabels(value);
                  setAddLabels((current) =>
                    current.filter((label) => !value.includes(label)),
                  );
                }}
              />
            </div>
          </div>
          <div className="bulk-actions">
            <button
              className="button primary"
              disabled={disabled || applying}
              onClick={() => void apply()}
            >
              {applying ? "Applying…" : `Apply to ${selected.length}`}
            </button>
            {disabled && (
              <span className="help">
                Writes are disabled while the branch changed.
              </span>
            )}
          </div>
        </div>
      )}
      {!!results.length && (
        <div className="bulk-results" role="status" aria-live="polite">
          <strong>Bulk edit result</strong>
          <span className="tag green">{counts.succeeded} succeeded</span>
          <span className={counts.failed ? "tag danger" : "tag"}>
            {counts.failed} failed
          </span>
          <span className="tag">{counts.unchanged} unchanged</span>
          <ul>
            {results.map((result) => (
              <li key={result.id} data-outcome={result.outcome}>
                <strong>{result.outcome}</strong>{" "}
                <span>
                  {result.displayId} {result.title}
                </span>
                {result.error && <small>{result.error}</small>}
              </li>
            ))}
          </ul>
          {counts.failed > 0 && (
            <p className="help">
              Failed tickets remain selected. Correct the fields and apply again
              to retry only those tickets.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
