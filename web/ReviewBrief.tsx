import type { Meta, RecordFile } from "../src/types";
import { RecordMarkdown } from "./RecordMarkdown";
import { BuildRow } from "./BuildArtifact";
export function ReviewBrief({
  record,
  openImage,
}: {
  record: RecordFile;
  openImage: (id: string) => void;
}) {
  const meta: Meta = record.meta;
  const v = meta.verification;
  const current =
    !!v && !!meta.reviewVerificationAt && meta.reviewVerificationAt === v.at;
  const reviewablePr = !!meta.pr && /^https?:\/\/\S+$/i.test(meta.pr.trim());
  return (
    <section className="review-brief" aria-label="What to review">
      <h3>What to review</h3>
      {meta.handoff && (
        <div className="markdown">
          <RecordMarkdown openImage={openImage}>{meta.handoff}</RecordMarkdown>
        </div>
      )}
      {meta.manualReviewRequired === false && (
        <p>
          {current && v.exitCode === 0
            ? "Automated checks passed. No manual checks requested."
            : "No manual checks requested; current verification is missing or failed."}
        </p>
      )}
      <div className="markdown">
        <RecordMarkdown openImage={openImage}>
          {meta.reviewInstructions ||
            (meta.manualReviewRequired === false
              ? "Inspect the evidence below before accepting."
              : "No manual review instructions were provided.")}
        </RecordMarkdown>
      </div>
      <p className={current && v.exitCode !== 0 ? "danger" : "muted"}>
        {current
          ? `Recorded verification ${v.exitCode === 0 ? "passed" : "failed"} (exit ${v.exitCode}).`
          : v
            ? "The last recorded run is not linked to this review submission; it does not establish a current pass."
            : "No recorded verification for this submission."}
      </p>
      {v && (
        <details>
          <summary>
            {current ? "Verification details" : "Earlier verification details"}
          </summary>
          <code>{v.command}</code>
          <p>{new Date(v.at).toLocaleString()}</p>
          <pre className="verification-output">
            {v.output || "No command output recorded."}
          </pre>
        </details>
      )}
      {meta.evidence && (
        <details>
          <summary>Submitted evidence</summary>
          <div className="markdown">
            <RecordMarkdown openImage={openImage}>
              {meta.evidence}
            </RecordMarkdown>
          </div>
        </details>
      )}
      <section className="review-change-source" aria-label="Change source">
        <h4>Changes to inspect</h4>
        {reviewablePr ? (
          <p>
            A pull request was supplied. Open it to inspect its diff; this queue
            does not claim the diff has already been inspected.
          </p>
        ) : meta.pr ? (
          <p>
            A pull request reference was supplied but cannot be opened here.
            Change and diff information is unavailable.
          </p>
        ) : meta.branch ? (
          <p>
            Submitted branch: <code>{meta.branch}</code>. No pull request was
            supplied, so a reviewable diff is not available here.
          </p>
        ) : meta.commits?.length ? (
          <p>
            {meta.commits.length} submitted commit
            {meta.commits.length === 1 ? "" : "s"} recorded. No pull request or
            diff is available here.
          </p>
        ) : (
          <p>
            No pull request, branch, or commit range was supplied. Change and
            diff information is unavailable.
          </p>
        )}
        {reviewablePr && (
          <a href={meta.pr!.trim()} target="_blank" rel="noreferrer">
            Open submitted pull request ↗
          </a>
        )}
      </section>
      <BuildRow record={record} />
      {meta.exceptions && (
        <div className="banner">
          <div>
            <strong>Exceptions and limitations</strong>
            <div className="markdown">
              <RecordMarkdown openImage={openImage}>
                {meta.exceptions}
              </RecordMarkdown>
            </div>
            {meta.exceptionHistory?.at(-1) && (
              <small>
                Recorded by {meta.exceptionHistory.at(-1)!.actor.name} (
                {meta.exceptionHistory.at(-1)!.actor.kind}) on{" "}
                {new Date(meta.exceptionHistory.at(-1)!.at).toLocaleString()}.
              </small>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
