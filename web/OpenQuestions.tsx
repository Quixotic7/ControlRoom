import { Questionnaire } from "./Questionnaire";
import { useRef, useState } from "react";
import type { Comment, ProjectState } from "../src/types";
import { ManagedQuestionReply } from "./ManagedQuestion";
import { actor, ago, api } from "./api";
import { RecordMarkdown } from "./RecordMarkdown";

function Question({
  question,
  projectId,
  ticket,
  disabled,
  reload,
  onThread,
  openImage,
  managedQuestions,
  comments,
}: {
  question: Comment;
  projectId: string;
  ticket: string;
  disabled: boolean;
  reload: () => Promise<void>;
  onThread: (id: string) => void;
  openImage: (id: string) => void;
  managedQuestions?: ProjectState["managedQuestions"];
  comments: Comment[];
}) {
  const key = `question-reply:${projectId}:${question.id}`;
  const [draft, setDraft] = useState(() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [posted, setPosted] = useState(false);
  const busy = useRef(false);
  function change(value: string) {
    setDraft(value);
    try {
      localStorage.setItem(key, value);
    } catch {
      /* The visible draft is retained. */
    }
  }
  async function act(resolve: boolean) {
    if (busy.current || disabled || (!resolve && !draft.trim())) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      if (resolve)
        await api(`/comments/${question.id}`, "PATCH", {
          revision: question.revision,
          resolved: true,
          actor,
        });
      else {
        await api(`/records/${ticket}/comments`, "POST", {
          kind: "comment",
          actor,
          body: `Reply to question ${question.id} from ${question.actor.name}\n\n${question.body
            .split("\n")
            .map((line) => "> " + line)
            .join("\n")}\n\n${draft.trim()}`,
        });
        change("");
        setPosted(true);
      }
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
      className="open-question"
      id={`question-${question.id}`}
      aria-label={`Question from ${question.actor.name}`}
    >
      <div className="comment-heading">
        <strong>{question.actor.name}</strong>
        <span className="tag">{question.actor.kind}</span>
        <span className="muted">{ago(question.at)}</span>
      </div>
      <div className="markdown question-prompt">
        <RecordMarkdown openImage={openImage}>{question.body}</RecordMarkdown>
      </div>
      {managedQuestions?.[question.id] ? (
        <>
          <ManagedQuestionReply
            question={question}
            run={managedQuestions[question.id]}
            comments={comments}
            projectId={projectId}
            disabled={disabled}
            reload={reload}
          />
          <button className="text-button" onClick={() => onThread(question.id)}>
            View in conversation
          </button>
        </>
      ) : (
        <>
          {error && (
            <p className="banner error" role="alert">
              {error}
            </p>
          )}
          {posted && (
            <p role="status">
              Answer posted to the conversation. Resolve this question when it
              is answered.
            </p>
          )}
          <label className="field">
            Answer this question
            <textarea
              rows={2}
              value={draft}
              onChange={(e) => change(e.target.value)}
              disabled={pending || disabled}
            />
          </label>
          <div className="inline-actions">
            <button
              className="button"
              disabled={pending || disabled || !draft.trim()}
              onClick={() => void act(false)}
            >
              Post answer
            </button>
            <button
              className="button subtle"
              disabled={pending || disabled}
              onClick={() => void act(true)}
            >
              Resolve question
            </button>
            <button
              className="text-button"
              onClick={() => onThread(question.id)}
            >
              View in conversation
            </button>
          </div>
        </>
      )}
    </article>
  );
}
export function OpenQuestions({
  questions,
  ...props
}: Omit<Parameters<typeof Question>[0], "question"> & {
  questions: Comment[];
}) {
  if (!questions.length) return null;
  return (
    <section className="open-questions" aria-label="Open questions">
      <h3>
        Open questions <span className="tag">{questions.length}</span>
      </h3>
      {questions.map((q) =>
        q.questions ? (
          <Questionnaire
            key={q.id}
            question={q}
            projectId={props.projectId}
            disabled={props.disabled}
            reload={props.reload}
          />
        ) : (
          <Question key={q.id} question={q} {...props} />
        ),
      )}
    </section>
  );
}
