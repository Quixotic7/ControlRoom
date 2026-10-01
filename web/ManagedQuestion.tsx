import { useRef, useState } from "react";
import type { Comment, ProjectState } from "../src/types";
import { actor, api } from "./api";

export type ManagedQuestion = NonNullable<
  ProjectState["managedQuestions"]
>[string];

export function hasHumanReply(question: Comment, comments: Comment[] = []) {
  return (
    !!question.replies?.some((reply) => reply.actor.kind === "human") ||
    comments.some(
      (reply) =>
        reply.actor.kind === "human" &&
        reply.ticket === question.ticket &&
        reply.body.startsWith(`Reply to question ${question.id} from `),
    )
  );
}

export function ManagedQuestionStatus({
  question,
  run,
  comments = [],
}: {
  question: Comment;
  run: ManagedQuestion;
  comments?: Comment[];
}) {
  const answered = hasHumanReply(question, comments);
  const labels: Record<string, string> = {
    waiting_input: "Still waiting for your action",
    recovery: "Still waiting for recovery",
    queued: "Retry queued",
    launching: "Retrying — starting agent",
    running: "Retrying — agent working",
    verifying: "Checking the retry",
    awaiting_review: "Waiting for orchestrator review",
    interrupted: "Run stopped",
    completed: "Run completed",
    accepted: "Run accepted",
    taken_over: "Work taken over",
    failed: "Run failed",
  };
  return (
    <div className="managed-question-status" role="status">
      <strong>{labels[run.state] ?? `Run: ${run.state}`}</strong>
      {answered && (!question.resolved || run.canAct) && (
        <span> · Answer received; question still open.</span>
      )}
      <small className="muted"> Run: {run.retryRunId ?? run.runId}</small>
      {run.error && ["waiting_input", "recovery"].includes(run.state) && (
        <p className="muted">{run.error}</p>
      )}
    </div>
  );
}

export function ManagedQuestionReply({
  question,
  run,
  projectId,
  comments,
  disabled,
  reload,
}: {
  question: Comment;
  run: ManagedQuestion;
  projectId: string;
  comments: Comment[];
  disabled: boolean;
  reload: () => Promise<void>;
}) {
  const key = `question-reply:${projectId}:${question.id}`;
  const [draft, setDraft] = useState(() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const canAct = run.canAct;
  const answered = hasHumanReply(question, comments);
  function change(value: string) {
    setDraft(value);
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Keep the visible draft. */
    }
  }
  async function act(action: "answer_retry" | "answer_only" | "stop") {
    if (busy.current || disabled || !canAct) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const result = await api(
        `/orchestration/${run.runId}/question-action`,
        "POST",
        {
          questionId: question.id,
          revision: question.revision,
          action,
          ...(action !== "stop" ? { answer: draft.trim() } : {}),
          actor,
        },
      );
      if (action !== "stop") change("");
      if (result.retryError)
        setError(`Answer saved. Retry did not start: ${result.retryError}`);
      await reload();
    } catch (e) {
      setError(String(e));
      // A stale question or an uncertain response must show current state while
      // retaining the draft. Writes are never retried automatically.
      await reload();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function dismiss() {
    if (busy.current || disabled) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await api(`/comments/${question.id}`, "PATCH", {
        revision: question.revision,
        resolved: true,
        actor,
      });
      await reload();
    } catch (e) {
      setError(String(e));
      await reload();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <>
      <ManagedQuestionStatus
        question={question}
        run={run}
        comments={comments}
      />
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {canAct ? (
        <>
          <label className="field">
            Answer this question
            <textarea
              rows={2}
              value={draft}
              onChange={(e) => change(e.target.value)}
              disabled={pending || disabled}
            />
          </label>
          <p className="muted">
            Answer and retry resumes this managed run. Answer only keeps it
            paused.
          </p>
          <div className="inline-actions">
            <button
              className="button"
              disabled={pending || disabled || (!draft.trim() && !answered)}
              onClick={() => void act("answer_retry")}
            >
              {answered && !draft.trim() ? "Retry run" : "Answer and retry"}
            </button>
            <button
              className="button subtle"
              disabled={
                pending || disabled || question.resolved || !draft.trim()
              }
              onClick={() => void act("answer_only")}
            >
              Answer only
            </button>
            <button
              className="button subtle"
              disabled={pending || disabled}
              onClick={() => void act("stop")}
            >
              Stop run
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            {run.state === "interrupted" || run.state === "taken_over"
              ? "This run is stopped. Review its retained work in Agents before starting further work."
              : "This question belongs to an earlier run. Its current status is shown above."}
          </p>
          {!question.resolved &&
            ["interrupted", "taken_over"].includes(run.state) && (
              <button
                className="button subtle"
                disabled={pending || disabled}
                onClick={() => void dismiss()}
              >
                Dismiss stopped question
              </button>
            )}
        </>
      )}
    </>
  );
}
