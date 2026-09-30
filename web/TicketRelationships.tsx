import { useMemo, useRef, useState } from "react";
import type {
  MergeConflictField,
  MergeResolution,
  ProjectState,
  RecordFile,
} from "../src/types";
import { actor, api, recordId } from "./api";
import { randomUUID } from "./browserUtils";

type MergePreview = {
  survivor: RecordFile;
  source: RecordFile;
  alreadyMerged: boolean;
  conflicts: Partial<
    Record<MergeConflictField, { survivor: unknown; source: unknown }>
  >;
  content: {
    description: boolean;
    comments: number;
    attachments: number;
    decisions: string[];
    rules: string[];
  };
  incoming: {
    id: string;
    number?: number;
    title: string;
    parent: boolean;
    dependency: boolean;
  }[];
  affected: Record<string, string>;
};

const conflictLabel: Record<MergeConflictField, string> = {
  parent: "Parent",
  status: "Status",
  owner: "Owner",
  priority: "Priority",
  acceptanceCriteria: "Acceptance criteria",
};

function ticketMatches(record: RecordFile, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  const number = /^#?\d+$/.test(needle)
    ? Number(needle.replace(/^#/, ""))
    : null;
  return (
    record.meta.number === number ||
    record.meta.title.toLowerCase().includes(needle)
  );
}

function describe(value: unknown) {
  if (value === null || value === undefined || value === "") return "None";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function TicketRelationships({
  record,
  state,
  disabled,
  openRecord,
  onChanged,
  onError,
}: {
  record: RecordFile;
  state: ProjectState;
  disabled: boolean;
  openRecord: (id: string) => void;
  onChanged: (record: RecordFile) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [relatedQuery, setRelatedQuery] = useState("");
  const [mergeQuery, setMergeQuery] = useState("");
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [resolutions, setResolutions] = useState<
    Partial<Record<MergeConflictField, MergeResolution>>
  >({});
  const [busy, setBusy] = useState(false);
  const requestId = useRef(randomUUID());
  const tickets = useMemo(
    () =>
      state.records.filter(
        (candidate) =>
          candidate.meta.kind === "ticket" &&
          candidate.meta.id !== record.meta.id,
      ),
    [state.records, record.meta.id],
  );
  const related = (record.meta.related ?? [])
    .map((id) => state.records.find((candidate) => candidate.meta.id === id))
    .filter((candidate): candidate is RecordFile => !!candidate);
  const relatedMatches = tickets
    .filter(
      (candidate) =>
        !(record.meta.related ?? []).includes(candidate.meta.id) &&
        ticketMatches(candidate, relatedQuery),
    )
    .slice(0, 6);
  const mergeMatches = tickets
    .filter(
      (candidate) =>
        !candidate.meta.duplicateOf && ticketMatches(candidate, mergeQuery),
    )
    .slice(0, 6);

  async function setRelated(other: RecordFile, action: "add" | "remove") {
    setBusy(true);
    try {
      const result = await api<{ ticket: RecordFile }>(
        `/records/${record.meta.id}/relationships`,
        "POST",
        {
          other: other.meta.id,
          revision: record.revision,
          otherRevision: other.revision,
          action,
          actor,
        },
      );
      setRelatedQuery("");
      await onChanged(result.ticket);
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadPreview(source: RecordFile) {
    setBusy(true);
    try {
      const next = await api<MergePreview>(
        `/records/${record.meta.id}/merge-preview`,
        "POST",
        { source: source.meta.id },
      );
      setPreview(next);
      setMergeQuery("");
      setResolutions(
        Object.fromEntries(
          (Object.keys(next.conflicts) as MergeConflictField[]).map((field) => [
            field,
            "survivor",
          ]),
        ) as Partial<Record<MergeConflictField, MergeResolution>>,
      );
      requestId.current = randomUUID();
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function merge() {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await api<{ survivor: RecordFile }>(
        `/records/${record.meta.id}/merge`,
        "POST",
        {
          source: preview.source.meta.id,
          requestId: requestId.current,
          revisions: preview.affected,
          resolutions,
          actor,
        },
      );
      setPreview(null);
      await onChanged(result.survivor);
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  }

  const missing = preview
    ? (Object.keys(preview.conflicts) as MergeConflictField[]).filter(
        (field) => !resolutions[field],
      )
    : [];
  return (
    <section className="ticket-relationships" aria-label="Ticket relationships">
      <h3>Related tickets</h3>
      <p className="help">Related links add context. They never block work.</p>
      {related.map((item) => (
        <div className="relationship-row" key={item.meta.id}>
          <button
            className="text-button"
            onClick={() => openRecord(item.meta.id)}
          >
            {recordId(item)} {item.meta.title}
          </button>
          <button
            className="text-button danger-text"
            disabled={disabled || busy}
            onClick={() => void setRelated(item, "remove")}
          >
            Remove
          </button>
        </div>
      ))}
      <label className="field relationship-search">
        Find by number or title
        <input
          value={relatedQuery}
          disabled={disabled || busy}
          placeholder="#42 or ticket title"
          onChange={(event) => setRelatedQuery(event.target.value)}
        />
      </label>
      {!!relatedQuery.trim() && (
        <div className="relationship-results">
          {relatedMatches.map((item) => (
            <button
              className="child-ticket"
              key={item.meta.id}
              disabled={disabled || busy}
              onClick={() => void setRelated(item, "add")}
            >
              <span>
                {recordId(item)} {item.meta.title}
              </span>
              <span className="tag">Relate</span>
            </button>
          ))}
          {!relatedMatches.length && (
            <p className="help">No matching tickets.</p>
          )}
        </div>
      )}

      {!!record.meta.mergedFrom?.length && (
        <div className="preserved-sources">
          <h3>Preserved duplicate sources</h3>
          {record.meta.mergedFrom.map((id) => {
            const source = state.records.find(
              (candidate) => candidate.meta.id === id,
            );
            return source ? (
              <button
                key={id}
                className="child-ticket"
                onClick={() => openRecord(id)}
              >
                <span>
                  {recordId(source)} {source.meta.title}
                </span>
                <span className="tag">Original record</span>
              </button>
            ) : null;
          })}
        </div>
      )}

      {!record.meta.duplicateOf && (
        <details className="disclosure merge-duplicate">
          <summary>Merge a duplicate into this ticket</summary>
          <p className="help">
            This ticket will survive. The selected source stays available as an
            archived duplicate; merging does not mark either ticket Done.
          </p>
          {!preview && (
            <>
              <label className="field relationship-search">
                Find duplicate by number or title
                <input
                  value={mergeQuery}
                  disabled={disabled || busy}
                  placeholder="#42 or ticket title"
                  onChange={(event) => setMergeQuery(event.target.value)}
                />
              </label>
              {!!mergeQuery.trim() && (
                <div className="relationship-results">
                  {mergeMatches.map((item) => (
                    <button
                      className="child-ticket"
                      key={item.meta.id}
                      disabled={disabled || busy}
                      onClick={() => void loadPreview(item)}
                    >
                      <span>
                        {recordId(item)} {item.meta.title}
                      </span>
                      <span className="tag">Preview</span>
                    </button>
                  ))}
                  {!mergeMatches.length && (
                    <p className="help">No matching tickets.</p>
                  )}
                </div>
              )}
            </>
          )}
          {preview && (
            <div className="merge-preview">
              <h4>Merge preview</h4>
              <p>
                <strong>Survivor:</strong> {recordId(preview.survivor)}{" "}
                {preview.survivor.meta.title}
                <br />
                <strong>Source:</strong> {recordId(preview.source)}{" "}
                {preview.source.meta.title}
              </p>
              <p className="help">
                Preserves the source description, {preview.content.comments}{" "}
                comment(s), {preview.content.attachments} attachment(s),{" "}
                {preview.content.decisions.length} decision reference(s), and{" "}
                {preview.content.rules.length} rule reference(s), with original
                provenance.
              </p>
              {(
                Object.entries(preview.conflicts) as [
                  MergeConflictField,
                  { survivor: unknown; source: unknown },
                ][]
              ).map(([field, values]) => (
                <label className="field merge-conflict" key={field}>
                  {conflictLabel[field]}
                  <small>Survivor: {describe(values.survivor)}</small>
                  <small>Source: {describe(values.source)}</small>
                  <select
                    value={resolutions[field] ?? ""}
                    onChange={(event) =>
                      setResolutions({
                        ...resolutions,
                        [field]: event.target.value as MergeResolution,
                      })
                    }
                  >
                    <option value="">Choose explicitly…</option>
                    <option value="survivor">Keep survivor</option>
                    <option value="source">Use source</option>
                    {field === "acceptanceCriteria" && (
                      <option value="both">Preserve both</option>
                    )}
                  </select>
                </label>
              ))}
              {!!preview.incoming.length && (
                <div className="merge-links">
                  <strong>Incoming links redirected to survivor</strong>
                  <ul>
                    {preview.incoming.map((item) => (
                      <li key={item.id}>
                        #{item.number ?? item.id} {item.title}:{" "}
                        {[
                          item.parent && "parent",
                          item.dependency && "dependency",
                        ]
                          .filter(Boolean)
                          .join(" and ")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="inline-actions">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => setPreview(null)}
                >
                  Cancel
                </button>
                <button
                  className="button primary"
                  disabled={disabled || busy || !!missing.length}
                  onClick={() => void merge()}
                >
                  Merge and archive source
                </button>
              </div>
              {!!missing.length && (
                <p className="help">
                  Resolve:{" "}
                  {missing.map((field) => conflictLabel[field]).join(", ")}.
                </p>
              )}
            </div>
          )}
        </details>
      )}
    </section>
  );
}
