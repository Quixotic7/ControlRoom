import { useEffect, useRef, useState } from "react";
import type { RecordFile } from "../src/types";
import { actor, api, recordId } from "./api";
import { ticketNavigation, ticketPageUrl } from "./ticketNavigation";

export type ArchiveScope = {
  column: string;
  filter: string;
  view: string;
  records: RecordFile[];
};

export function ArchiveTickets({
  scope,
  onClose,
  reload,
}: {
  scope: ArchiveScope;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    cancel = useRef<HTMLButtonElement>(null),
    busy = useRef(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    count: number;
    failures: { record: RecordFile; error: string }[];
  } | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    cancel.current?.focus();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  async function archive() {
    if (busy.current || result) return;
    busy.current = true;
    setRunning(true);
    let count = 0;
    const failures: { record: RecordFile; error: string }[] = [];
    for (const record of scope.records) {
      try {
        await api(`/records/${record.meta.id}`, "PATCH", {
          revision: record.revision,
          patch: { archived: true },
          actor,
        });
        count++;
      } catch (e) {
        failures.push({ record, error: String(e) });
      }
    }
    setResult({ count, failures });
    await reload();
    busy.current = false;
    setRunning(false);
  }
  return (
    <dialog
      ref={dialog}
      className="archive-dialog"
      aria-labelledby="archive-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy.current) onClose();
      }}
    >
      <h2 id="archive-title">Archive completed tickets</h2>
      <p>
        <strong>
          {scope.records.length}{" "}
          {scope.records.length === 1 ? "ticket" : "tickets"}
        </strong>{" "}
        in <strong>{scope.column}</strong> · {scope.view}
      </p>
      <p>
        Filter: <code>{scope.filter || "All active tickets"}</code>
      </p>
      <p className="help">
        Only the tickets listed below will be archived. Hidden columns,
        collapsed groups and tickets outside the filter are excluded. Children
        are included only if listed. Workflow stages and linked records stay
        intact.
      </p>
      <details open>
        <summary>Inspect affected tickets ({scope.records.length})</summary>
        <ul className="archive-ticket-list">
          {scope.records.map((r) => (
            <li key={r.meta.id}>
              <a
                href={ticketPageUrl(r.meta.id)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {recordId(r)} {r.meta.title}
              </a>
              <span className="muted"> Opens in a new tab</span>
            </li>
          ))}
        </ul>
      </details>
      {!scope.records.length && (
        <p>No matching completed tickets to archive.</p>
      )}
      {result && (
        <section role="status">
          <p>
            <strong>
              {result.count} confirmed archived; {result.failures.length} need
              review.
            </strong>
          </p>
          {!!result.failures.length && (
            <>
              <p>
                Review these tickets, then close this preview and start a fresh
                one. An interrupted connection may have completed a write; check
                the current ticket before retrying. No failed write has been
                retried.
              </p>
              <ul>
                {result.failures.map(({ record, error }) => (
                  <li key={record.meta.id}>
                    <a
                      href={ticketPageUrl(record.meta.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {recordId(record)} {record.meta.title}
                    </a>
                    : {error}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      <div className="inline-actions">
        <button
          ref={cancel}
          className="button"
          autoFocus
          disabled={running}
          onClick={onClose}
        >
          {result ? "Close" : "Cancel"}
        </button>
        {!result && (
          <button
            className="button primary"
            disabled={running || !scope.records.length}
            onClick={() => void archive()}
          >
            {running ? "Archiving…" : `Archive ${scope.records.length} tickets`}
          </button>
        )}
      </div>
    </dialog>
  );
}

export function ArchivedTickets({
  records,
  onOpen,
  reload,
  onBack,
}: {
  records: RecordFile[];
  onOpen: (id: string) => void;
  reload: () => Promise<void>;
  onBack: () => void;
}) {
  const [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState<string | null>(null);
  const busy = useRef(false);
  const tickets = records.filter(
    (r) => r.meta.kind === "ticket" && r.meta.archived,
  );
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const shown = tickets.filter((r) =>
    words.every((word) =>
      `${recordId(r)} ${r.meta.title} ${r.body} ${r.meta.labels?.join(" ") ?? ""}`
        .toLowerCase()
        .includes(word),
    ),
  );
  async function restore(r: RecordFile) {
    if (busy.current) return;
    busy.current = true;
    setPending(r.meta.id);
    setError("");
    try {
      await api(`/records/${r.meta.id}`, "PATCH", {
        revision: r.revision,
        patch: { archived: false },
        actor,
      });
      await reload();
    } catch (e) {
      setError(String(e));
      await reload();
    } finally {
      busy.current = false;
      setPending(null);
    }
  }
  return (
    <section className="archived-tickets" aria-label="Archived tickets">
      <div className="section-heading">
        <h2>Archived tickets</h2>
        <button className="button" onClick={onBack}>
          Back to project view
        </button>
      </div>
      <p className="help">
        Unarchive restores a ticket in its existing workflow stage. Move it into
        development separately when needed.
      </p>
      <label className="field">
        Search archived tickets
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Title, #number, description or label"
        />
      </label>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      <p>
        {shown.length} of {tickets.length} archived tickets
      </p>
      <ul className="archive-results">
        {shown.map((r) => (
          <li key={r.meta.id}>
            <button
              className="text-button"
              {...ticketNavigation(r.meta.id, onOpen)}
            >
              {recordId(r)} {r.meta.title}
            </button>
            <button
              className="button small"
              disabled={pending !== null}
              aria-label={`Unarchive ${recordId(r)} ${r.meta.title}`}
              onClick={() => void restore(r)}
            >
              {pending === r.meta.id ? "Restoring…" : "Unarchive"}
            </button>
          </li>
        ))}
      </ul>
      {!shown.length && (
        <p className="empty-inline">No archived tickets match this search.</p>
      )}
    </section>
  );
}
