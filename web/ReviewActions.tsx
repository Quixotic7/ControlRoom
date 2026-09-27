import { useEffect, useRef, useState } from "react";
import type { Column } from "../src/types";

export function ReviewActions({
  columns,
  disabled,
  hidden,
  onDecide,
}: {
  columns: Column[];
  disabled: boolean;
  hidden: boolean;
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
  const [doneId, setDoneId] = useState(done.length === 1 ? done[0].id : "");
  const [target, setTarget] = useState(failed.length === 1 ? failed[0].id : "");
  const [outcome, setOutcome] = useState<"accept" | "changes" | null>(null);
  const feedbackInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (outcome && !hidden) feedbackInput.current?.focus();
  }, [outcome, hidden]);
  const [feedback, setFeedback] = useState("");
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
                onChange={(e) => setDoneId(e.target.value)}
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
            onClick={() => setOutcome("accept")}
          >
            Accept into Done
          </button>
          <button
            className="button"
            disabled={disabled}
            aria-expanded={outcome === "changes"}
            onClick={() => setOutcome("changes")}
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
              onChange={(e) => setFeedback(e.target.value)}
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
                  onChange={(e) => setTarget(e.target.value)}
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
