import { useRef, useState } from "react";
import type { ChoiceAnswers } from "../src/questionnaire";
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
  function hydrate(values: Record<string, string>, choices?: ChoiceAnswers) {
    const next = {
      values: { ...values },
      selected: {} as Record<string, string[]>,
    };
    for (const q of question.questions ?? []) {
      if (q.type !== "choice") continue;
      const structured = choices?.[q.id];
      const legacy = values[q.id] ?? "";
      next.selected[q.id] = structured
        ? [...structured.selected]
        : q.choices?.includes(legacy)
          ? [legacy]
          : [];
      next.values[q.id] = structured
        ? structured.custom
        : q.choices?.includes(legacy)
          ? ""
          : legacy;
    }
    return next;
  }
  const [draft, setDraft] = useState<{
    version: 2;
    revision: string;
    values: Record<string, string>;
    selected: Record<string, string[]>;
  }>(() => {
    const answer = question.answers?.at(-1);
    const initial = {
      version: 2 as const,
      revision: question.revision,
      ...hydrate(answer?.values ?? {}, answer?.choiceAnswers),
    };
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (
        saved &&
        typeof saved.revision === "string" &&
        saved.values &&
        typeof saved.values === "object" &&
        !Array.isArray(saved.values) &&
        Object.values(saved.values).every((v) => typeof v === "string")
      ) {
        const parts =
          saved.version === 2 &&
          saved.selected &&
          typeof saved.selected === "object" &&
          !Array.isArray(saved.selected) &&
          Object.values(saved.selected).every(
            (v) => Array.isArray(v) && v.every((c) => typeof c === "string"),
          )
            ? { values: saved.values, selected: saved.selected }
            : hydrate(saved.values);
        return {
          version: 2,
          revision: saved.revision,
          values:
            saved.revision === question.revision
              ? { ...initial.values, ...parts.values }
              : parts.values,
          selected:
            saved.revision === question.revision
              ? { ...initial.selected, ...parts.selected }
              : parts.selected,
        };
      }
    } catch {}
    return initial;
  });
  const answered = (q: NonNullable<Comment["questions"]>[number]) =>
    !!draft.values[q.id]?.trim() ||
    (q.type === "choice" && !!draft.selected[q.id]?.length);
  const invalidChoices = question.questions!.some(
    (q) =>
      q.type === "choice" &&
      (draft.selected[q.id]?.some((value) => !q.choices!.includes(value)) ||
        (!q.multiple && (draft.selected[q.id]?.length ?? 0) > 1)),
  );
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
    if (busy.current || changed || disabled || invalidChoices) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const saved = await api<Comment>(
        `/comments/${question.id}/answers`,
        "POST",
        {
          actor,
          revision: draft.revision,
          answers: draft.values,
          choiceAnswers: Object.fromEntries(
            question
              .questions!.filter((q) => q.type === "choice")
              .map((q) => [
                q.id,
                {
                  selected: draft.selected[q.id] ?? [],
                  custom: draft.values[q.id] ?? "",
                },
              ]),
          ),
        },
      );
      // Retain the submitted values locally as well as in the comment. This
      // covers both reopening this ticket and returning after a refresh.
      const answer = saved.answers!.at(-1)!;
      change({
        version: 2,
        revision: saved.revision,
        ...hydrate(answer.values, answer.choiceAnswers),
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
      change({ ...draft, revision: result.comment.revision });
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
            <>
              <p className="muted">
                {q.multiple ? "Select all that apply" : "Select one option"}.
                Custom notes below are kept separately.
              </p>
              <div className="question-choices">
                {[
                  ...new Set([...q.choices!, ...(draft.selected[q.id] ?? [])]),
                ].map((choice) => (
                  <label className="question-choice" key={choice}>
                    <input
                      type={q.multiple ? "checkbox" : "radio"}
                      name={`${question.id}:${q.id}`}
                      checked={draft.selected[q.id]?.includes(choice) ?? false}
                      onChange={() =>
                        change({
                          ...draft,
                          selected: {
                            ...draft.selected,
                            [q.id]: q.multiple
                              ? draft.selected[q.id]?.includes(choice)
                                ? draft.selected[q.id].filter(
                                    (c) => c !== choice,
                                  )
                                : [...(draft.selected[q.id] ?? []), choice]
                              : [choice],
                          },
                        })
                      }
                    />
                    <span>
                      {choice}
                      {q.recommended === choice ? " (recommended)" : ""}
                      {!q.choices!.includes(choice)
                        ? " (no longer offered)"
                        : ""}
                    </span>
                  </label>
                ))}
              </div>
              {!!draft.selected[q.id]?.length && (
                <button
                  type="button"
                  className="button subtle"
                  onClick={() =>
                    change({
                      ...draft,
                      selected: { ...draft.selected, [q.id]: [] },
                    })
                  }
                >
                  Clear selection for {q.prompt}
                </button>
              )}
            </>
          )}
          <label className="field">
            {q.type === "choice" ? "Custom notes (optional)" : "Your answer"}
            <textarea
              aria-label={`Answer: ${q.prompt}`}
              value={draft.values[q.id] ?? ""}
              rows={Math.min(
                6,
                Math.max(
                  1,
                  (draft.values[q.id] ?? "").split("\n").length,
                  Math.ceil((draft.values[q.id]?.length ?? 0) / 90),
                ),
              )}
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
                ...draft,
                selected: Object.fromEntries(
                  Object.entries(draft.selected).filter(([id]) =>
                    question.questions!.some(
                      (q) => q.id === id && q.type === "choice",
                    ),
                  ),
                ),
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
      {invalidChoices && (
        <p role="alert" className="banner">
          Some selected options are no longer offered, or this question now
          allows only one choice. Clear the selection and choose again; your
          notes are retained.
        </p>
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
          invalidChoices ||
          question.questions!.some((q) => q.required && !answered(q)) ||
          !question.questions!.some(answered)
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
