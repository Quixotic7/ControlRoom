import { useEffect, useRef } from "react";
import type { Column } from "../src/types";

export type ReviewActionDraft = {
  outcome: "accept" | "changes" | null;
  feedback: string;
  doneId?: string;
  target?: string;
};

export function ReviewActions({
  columns,
  disabled,
  hidden,
  draft,
  onDraft,
  onDecide,
}: {
  columns: Column[];
  disabled: boolean;
  hidden: boolean;
  draft?: ReviewActionDraft;
  onDraft: (draft: ReviewActionDraft) => void;
  onDecide: (
    outcome: "accept" | "changes",
    target: string,
    feedback: string,
  ) => void;
}) {
  const done = columns.filter((c) => c.role === "done");
  const progress = columns.filter((c) => c.role === "progress");
  const failed = progress.filter(
    (c) => c.name.trim().toLowerCase() === "failed review",
  );
  const doneId = draft?.doneId ?? (done.length === 1 ? done[0].id : "");
  const target = draft?.target ?? (failed.length === 1 ? failed[0].id : "");
  const outcome = draft?.outcome ?? null;
  const feedback = draft?.feedback ?? "";
  const update = (patch: Partial<ReviewActionDraft>) =>
    onDraft({ outcome, feedback, doneId, target, ...patch });
  const feedbackInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (outcome && !hidden) feedbackInput.current?.focus();
  }, [outcome, hidden]);
  const validDone = done.some((c) => c.id === doneId);
  const validTarget = progress.some((c) => c.id === target);
  return (
    <section
      className="review-actions"
      aria-label="Review outcome"
      hidden={hidden}
    >
      <div className="section-heading">
        <h3>Ready for your review</h3>
        <div className="inline-actions">
          {done.length > 1 && (
            <label className="field">
              Done destination
              <select
                value={validDone ? doneId : ""}
                onChange={(e) => update({ doneId: e.target.value })}
                disabled={disabled}
              >
                <option value="">Choose Done column</option>
                {done.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="button primary"
            disabled={disabled}
            aria-expanded={outcome === "accept"}
            onClick={() => update({ outcome: "accept" })}
          >
            Accept into Done
          </button>
          <button
            className="button"
            disabled={disabled}
            aria-expanded={outcome === "changes"}
            onClick={() => update({ outcome: "changes" })}
          >
            Request changes
          </button>
        </div>
      </div>
      {outcome && (
        <form
          className="fields"
          onSubmit={(e) => {
            e.preventDefault();
            if (!disabled && (outcome === "accept" ? validDone : validTarget))
              onDecide(
                outcome,
                outcome === "accept" ? doneId : target,
                feedback,
              );
          }}
        >
          <label className="field">
            Review feedback (optional)
            <textarea
              aria-label="Review feedback"
              ref={feedbackInput}
              rows={2}
              value={feedback}
              onChange={(e) => update({ feedback: e.target.value })}
              placeholder={
                outcome === "accept"
                  ? "Why does this pass review? (optional)"
                  : "What needs to change? (optional)"
              }
              disabled={disabled}
            />
          </label>
          <div className="inline-actions">
            {outcome === "changes" && (
              <label className="field">
                Return to
                <select
                  value={validTarget ? target : ""}
                  onChange={(e) => update({ target: e.target.value })}
                  disabled={disabled}
                >
                  <option value="">Choose a development column</option>
                  {progress.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="button"
              type="submit"
              disabled={
                disabled || !(outcome === "accept" ? validDone : validTarget)
              }
            >
              {outcome === "accept"
                ? "Confirm acceptance"
                : "Save feedback & return"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
