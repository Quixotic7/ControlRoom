import { useRef, useState } from "react";
import type { Comment } from "../src/types";
import { actor, api } from "./api";
export function Questionnaire({
  question,
  projectId,
  disabled,
  reload,
}: {
  question: Comment;
  projectId: string;
  disabled: boolean;
  reload: () => Promise<void>;
}) {
  const key = `questionnaire:${projectId}:${question.id}`;
  const [draft, setDraft] = useState<{
    revision: string;
    values: Record<string, string>;
  }>(() => {
    // A submitted answer is the natural starting point for an amendment. A
    // browser draft still wins field-by-field, including an intentionally
    // cleared field, so reopening the ticket never discards in-progress work.
    const submitted = question.answers?.at(-1)?.values ?? {};
    const initial = { revision: question.revision, values: { ...submitted } };
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (
        saved &&
        typeof saved.revision === "string" &&
        saved.values &&
        typeof saved.values === "object" &&
        !Array.isArray(saved.values) &&
        Object.values(saved.values).every((v) => typeof v === "string")
      )
        return {
          revision: saved.revision,
          values:
            saved.revision === question.revision
              ? { ...initial.values, ...saved.values }
              : saved.values,
        };
    } catch {}
    return initial;
  });
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [posted, setPosted] = useState(false);
  const busy = useRef(false);
  const changed = draft.revision !== question.revision;
  function change(next: typeof draft) {
    setDraft(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      setError(
        "Draft is retained here, but browser storage is unavailable. Keep this window open until you submit.",
      );
    }
  }
  async function submit() {
    if (busy.current || changed || disabled) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const saved = await api<Comment>(
        `/comments/${question.id}/answers`,
        "POST",
        { actor, revision: draft.revision, answers: draft.values },
      );
      // Retain the submitted values locally as well as in the comment. This
      // covers both reopening this ticket and returning after a refresh.
      change({
        revision: saved.revision,
        values: { ...(saved.answers?.at(-1)?.values ?? draft.values) },
      });
      setPosted(true);
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function reopen() {
    if (busy.current || disabled) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      // Reopening itself changes the comment revision.  Acknowledge the exact
      // revision returned by that deliberate action, while retaining every
      // draft field (including fields intentionally cleared by the human).
      // Other edits still leave the draft stale and require reconciliation.
      const result = await api<{ comment: Comment }>(
        `/comments/${question.id}`,
        "PATCH",
        { actor, revision: question.revision, resolved: false },
      );
      change({ revision: result.comment.revision, values: draft.values });
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <article
      className="open-question questionnaire"
      aria-label={`Questionnaire from ${question.actor.name}`}
    >
      <div className="comment-heading">
        <strong>{question.actor.name}</strong>
        <span className="tag">
          {question.resolved
            ? "Answered · amendments welcome"
            : "Needs your answers"}
        </span>
      </div>
      {question.questions!.map((q) => (
        <fieldset key={q.id} disabled={disabled || pending}>
          <legend>
            {q.prompt} {q.required ? "(required)" : "(optional)"}
          </legend>
          {q.type === "choice" && (
            <div className="question-choices">
              {q.choices!.map((choice) => (
                <button
                  type="button"
                  className="button"
                  aria-pressed={draft.values[q.id] === choice}
                  key={choice}
                  onClick={() =>
                    change({
                      ...draft,
                      values: { ...draft.values, [q.id]: choice },
                    })
                  }
                >
                  {choice}
                  {q.recommended === choice ? " (recommended)" : ""}
                </button>
              ))}
            </div>
          )}
          <label className="field">
            {q.type === "choice" ? "Your answer or custom text" : "Your answer"}
            <textarea
              aria-label={`Answer: ${q.prompt}`}
              value={draft.values[q.id] ?? ""}
              rows={2}
              onChange={(e) =>
                change({
                  ...draft,
                  values: { ...draft.values, [q.id]: e.target.value },
                })
              }
            />
          </label>
        </fieldset>
      ))}
      {changed && (
        <div className="banner" role="alert">
          This questionnaire or its answers changed. Your draft is retained.
          Review the current questions above before continuing.{" "}
          <button
            className="button"
            onClick={() =>
              change({
                revision: question.revision,
                values: Object.fromEntries(
                  Object.entries(draft.values).filter(([id]) =>
                    question.questions!.some((q) => q.id === id),
                  ),
                ),
              })
            }
          >
            I reviewed the updated questions
          </button>
        </div>
      )}
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {question.answers?.length ? (
        <section
          className="questionnaire-history"
          aria-label="Submitted answers"
        >
          <h4>Submitted answers</h4>
          {question.answers.map((answer, index) => (
            <article key={`${answer.at}:${index}`} className="submitted-answer">
              <div className="comment-heading">
                <strong>{answer.actor.name}</strong>
                <span className="tag">{answer.actor.kind}</span>
                <time className="muted" dateTime={answer.at} title={answer.at}>
                  {new Date(answer.at).toLocaleString()}
                </time>
              </div>
              {answer.questions.map((q) => (
                <div key={q.id} className="submitted-answer-value">
                  <strong>{q.prompt}</strong>
                  <p>{answer.values[q.id]?.trim() || "(No answer supplied)"}</p>
                </div>
              ))}
            </article>
          ))}
        </section>
      ) : null}
      {posted && (
        <p role="status">
          Answers saved with your attribution and question wording.
        </p>
      )}
      <button
        type="button"
        className="button primary"
        disabled={
          disabled ||
          pending ||
          changed ||
          question.questions!.some(
            (q) => q.required && !draft.values[q.id]?.trim(),
          ) ||
          !Object.values(draft.values).some((v) => v.trim())
        }
        onClick={() => void submit()}
      >
        {question.answers?.length ? "Submit amended answers" : "Submit answers"}
      </button>
      {question.resolved && (
        <button
          type="button"
          className="button subtle"
          disabled={disabled || pending}
          onClick={() => void reopen()}
        >
          Reopen questionnaire
        </button>
      )}
      <p className="muted">
        Nothing is submitted until you press this button. Drafts have no time
        limit.
      </p>
    </article>
  );
}
