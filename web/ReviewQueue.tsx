import type { RecordFile } from "../src/types";
import { ago, recordId } from "./api";
import { PageHeader } from "./Pages";
import { ticketNavigation } from "./ticketNavigation";

function verificationLabel(record: RecordFile) {
  const verification = record.meta.verification;
  const current =
    !!verification &&
    !!record.meta.reviewVerificationAt &&
    record.meta.reviewVerificationAt === verification.at;
  if (!verification) return "No recorded verification";
  if (!current) return "Earlier verification only";
  return verification.exitCode === 0
    ? "Current verification passed"
    : "Current verification failed";
}

function changeLabel(record: RecordFile) {
  if (record.meta.pr) return "Pull request supplied";
  if (record.meta.branch) return "Branch supplied; no PR diff";
  if (record.meta.commits?.length) return "Commits supplied; no diff";
  return "No PR or diff supplied";
}

export function ReviewQueue({
  records,
  open,
}: {
  records: RecordFile[];
  open: (id: string) => void;
}) {
  return (
    <>
      <PageHeader
        title="Review queue"
        description="Review submitted work in sequence. Each item keeps its feedback draft while you move through the queue."
      />
      <section className="review-queue" aria-label="Review queue">
        {records.map((record, index) => (
          <button
            className="review-queue-item"
            key={record.meta.id}
            {...ticketNavigation(record.meta.id, open)}
          >
            <span className="review-queue-position">{index + 1}</span>
            <span className="row-main">
              <strong>{record.meta.title}</strong>
              <small>
                {verificationLabel(record)} · {changeLabel(record)} · updated{" "}
                {ago(record.meta.updatedAt)}
              </small>
              {record.meta.handoff && <small>Handoff submitted</small>}
            </span>
            <span className="record-id">{recordId(record)}</span>
          </button>
        ))}
        {!records.length && (
          <p className="list-empty">✓ No tickets are waiting for review.</p>
        )}
      </section>
    </>
  );
}
