import type { Meta } from "../src/types";
import { RecordMarkdown } from "./RecordMarkdown";
export function ReviewBrief({
  meta,
  openImage,
}: {
  meta: Meta;
  openImage: (id: string) => void;
}) {
  const v = meta.verification;
  const current =
    !!v && !!meta.reviewVerificationAt && meta.reviewVerificationAt === v.at;
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
