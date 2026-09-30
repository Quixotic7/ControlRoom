import { randomUUID, copyText } from "./browserUtils";
import { WindowMenu } from "./WindowMenu";
import { Questionnaire } from "./Questionnaire";
import { ProgressReport } from "./ProgressReport";
import { Microtasks } from "./Microtasks";
import { TicketProgress } from "./TicketProgress";
import { context as projectContext } from "./model";
import { ArrowUpIcon, CloseIcon, StageIcon, Logo } from "./Icons";
import { ParentInput } from "./ParentInput";
import { ScreenshotPicker } from "./ScreenshotPicker";
import { ImageThumbnail } from "./ImageThumbnail";
import { ReviewActions } from "./ReviewActions";
import { OpenQuestions } from "./OpenQuestions";
import { ReviewBrief } from "./ReviewBrief";
import { QuickTicket } from "./QuickTicket";
import { ExistingChild } from "./ExistingChild";
import { ticketNavigation } from "./ticketNavigation";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TagInput } from "./TagInput";
import { imageMarkdown, pasteImage, RecordMarkdown } from "./RecordMarkdown";
import type {
  Kind,
  Meta,
  ProjectState,
  RecordFile,
  Verification,
} from "../src/types";
import { actor, api, ApiError, ago, recordId, split, uploadImage } from "./api";

// Keep hot text-entry state close to the input. The record detail contains
// project-wide derived data and (often) a long Markdown conversation; making
// its parent own every keystroke needlessly rerenders all of that work. Drafts
// are mirrored synchronously to refs by onDraft, then committed to the parent
// on blur so save/close can always use the newest value without input lag.
function DraftInput({
  value,
  reset,
  onDraft,
  onCommit,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  reset: string;
  onDraft: (value: string) => void;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  useEffect(() => {
    if (value === draftRef.current) return;
    draftRef.current = value;
    setDraft(value);
  }, [value, reset]);
  return (
    <input
      {...props}
      value={draft}
      onChange={(e) => {
        draftRef.current = e.target.value;
        setDraft(e.target.value);
        onDraft(e.target.value);
      }}
      onBlur={(e) => {
        props.onBlur?.(e);
        onCommit(e.currentTarget.value);
      }}
    />
  );
}

function DraftTextarea({
  value,
  reset,
  onDraft,
  onCommit,
  onImage,
  onError,
  ...props
}: Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "onPaste"
> & {
  value: string;
  reset: string;
  onDraft: (value: string) => void;
  onCommit: (value: string) => void;
  onImage: (id: string) => void;
  onError: (error: unknown) => void;
}) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  useEffect(() => {
    if (value === draftRef.current) return;
    draftRef.current = value;
    setDraft(value);
  }, [value, reset]);
  const update = (transform: (text: string) => string) => {
    const next = transform(draftRef.current);
    draftRef.current = next;
    setDraft(next);
    onDraft(next);
    // Image upload completion and failure happen after the paste event, and
    // must also update previews/microtasks even if the editor has blurred.
    onCommit(next);
  };
  return (
    <textarea
      {...props}
      value={draft}
      onChange={(e) => {
        draftRef.current = e.target.value;
        setDraft(e.target.value);
        onDraft(e.target.value);
      }}
      onBlur={(e) => {
        props.onBlur?.(e);
        onCommit(e.currentTarget.value);
      }}
      onPaste={(e) =>
        pasteImage(e, update)
          .then((id) => id && onImage(id))
          .catch(onError)
      }
    />
  );
}

// Absent, null, "" and [] all mean "no value" in a record form.
const normalized = (v: unknown) =>
  JSON.stringify(
    v === undefined || v === "" || (Array.isArray(v) && !v.length) ? null : v,
  );
// Fields that differ between two metadata objects, with the values from `to`.
function changedFields(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
) {
  const out: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)]))
    if (key !== "updatedAt" && normalized(from[key]) !== normalized(to[key]))
      out[key] = to[key];
  return out;
}

const isHttp = (s: unknown): s is string =>
  typeof s === "string" && /^https?:\/\/\S+$/i.test(s.trim());
const shortHash = (hash: string) =>
  /^[0-9a-f]{7,64}$/i.test(hash) ? hash.slice(0, 7) : hash;

// What `review --run` captured: the command, how it ended, and its output.
const previewLines = 12;
function VerificationPanel({ v }: { v: Verification }) {
  const [all, setAll] = useState(false);
  const lines = v.output.replace(/\n$/, "").split("\n");
  const long = lines.length > previewLines;
  const ok = v.exitCode === 0;
  return (
    <section
      className="verification"
      data-status={ok ? "pass" : "fail"}
      aria-label="Verification"
    >
      <div className="verification-head">
        <span className="eyebrow">Verification</span>
        <span className={`tag ${ok ? "green" : "danger"}`}>
          Exit {v.exitCode}
        </span>
        <span className="muted" title={new Date(v.at).toLocaleString()}>
          {ago(v.at)}
        </span>
      </div>
      <code className="verification-command">{v.command}</code>
      {v.cwd && <span className="help">in {v.cwd}</span>}
      <pre className="verification-output">
        {(all || !long ? lines : lines.slice(0, previewLines)).join("\n")}
        {long && !all ? "\n…" : ""}
      </pre>
      {long && (
        <button className="text-button" onClick={() => setAll(!all)}>
          {all ? "Show less" : `Show all (${lines.length} lines)`}
        </button>
      )}
    </section>
  );
}

export function RecordDetail({
  record,
  kind,
  state,
  onClose,
  onSaved,
  onError,
  openRecord,
  openImage,
  conversationOrder,
  onConversationOrder,
  standalone = false,
}: {
  record?: RecordFile;
  kind: Kind;
  state: ProjectState;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
  onError: (s: string) => void;
  openRecord: (s: string) => void;
  openImage: (s: string) => void;
  conversationOrder: "oldest" | "newest";
  onConversationOrder: (order: "oldest" | "newest") => void;
  standalone?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const detailBody = useRef<HTMLDivElement>(null);
  const readingAnchor = useRef<{
    id: string;
    top: number;
    order: string;
    tab: string;
  } | null>(null);
  const [baseline, setBaseline] = useState(record),
    [m, setMState] = useState<any>(
      record?.meta ?? {
        title: "",
        status:
          kind === "ticket"
            ? state.config.columns.find((c) => c.role === "backlog")!.id
            : "proposed",
        priority: 2,
        parent: null,
        labels: [],
        scope: [],
        strength: "required",
        category: "components",
      },
    );
  const template =
    kind === "ticket"
      ? ""
      : kind === "decision"
        ? "## Context\n\n\n## Decision\n\n\n## Why\n\n\n## Alternatives and tradeoffs\n\n"
        : "## Rule\n\n\n## Why\n\n\n## Examples and implementation references\n\n";
  const [body, setBodyState] = useState(record?.body ?? template),
    [tab, setTab] = useState("details"),
    [preview, setPreview] = useState(
      kind === "ticket" && !!record?.body.trim(),
    ),
    [pickingScreenshot, setPickingScreenshot] = useState(false),
    [pickingCommentScreenshot, setPickingCommentScreenshot] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [comment, setComment] = useState(""),
    [commentKind, setCommentKind] = useState("comment"),
    [context, setContext] = useState<any>(null),
    [history, setHistory] = useState<any[]>([]),
    [conflict, setConflict] = useState<{
      current: RecordFile;
      fields: string[];
    } | null>(null),
    [closeFailed, setCloseFailed] = useState(false),
    [titlePresent, setTitlePresent] = useState(() => !!m.title.trim());
  const mRef = useRef<any>(m);
  const bodyRef = useRef(body);
  const draftReset = baseline?.revision ?? "new";
  function isDraftDirty(draft = mRef.current, text = bodyRef.current) {
    return baseline
      ? Object.keys(changedFields(baseline.meta, draft)).length > 0 ||
          text !== baseline.body
      : !!draft.title.trim() || text !== template;
  }
  function replaceMeta(next: any) {
    mRef.current = next;
    setMState(next);
    setTitlePresent(!!next.title.trim());
  }
  function replaceBody(next: string | ((body: string) => string)) {
    const value = typeof next === "function" ? next(bodyRef.current) : next;
    bodyRef.current = value;
    setBodyState(value);
  }
  function draftMeta(key: string, value: any) {
    const next = { ...mRef.current, [key]: value };
    mRef.current = next;
    if (key === "title") setTitlePresent(!!value.trim());
  }
  function draftBody(value: string) {
    bodyRef.current = value;
  }
  function rememberReadingPosition() {
    const scroller = detailBody.current;
    if (!scroller || (tab !== "conversation" && tab !== "details")) {
      readingAnchor.current = null;
      return;
    }
    const viewport = scroller.getBoundingClientRect();
    const visible = Array.from(
      scroller.querySelectorAll<HTMLElement>(".comment"),
    ).find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > viewport.top && rect.top < viewport.bottom;
    });
    readingAnchor.current = visible
      ? {
          id: visible.id,
          top: visible.getBoundingClientRect().top - viewport.top,
          order: conversationOrder,
          tab,
        }
      : null;
  }
  // Preserve the visible comment when a live update prepends/reflows entries.
  // A deliberate sort change starts a new anchor instead of preserving the old order.
  useLayoutEffect(() => {
    const scroller = detailBody.current;
    const anchor = readingAnchor.current;
    if (
      scroller &&
      anchor?.tab === tab &&
      anchor?.order === conversationOrder
    ) {
      const node = document.getElementById(anchor.id);
      if (node)
        scroller.scrollTop +=
          node.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          anchor.top;
    }
    rememberReadingPosition();
  }, [state.comments, tab, conversationOrder]);
  const dirty = isDraftDirty();
  useEffect(() => {
    if (standalone) dialog.current?.show();
    else dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  useEffect(() => {
    if (!record) return;
    if (tab === "history")
      api(`/records/${record.meta.id}/history`)
        .then(setHistory)
        .catch((e) => setError(String(e)));
    if (tab === "context")
      api(`/records/${record.meta.id}/context`)
        .then(setContext)
        .catch((e) => setError(String(e)));
  }, [tab, record?.revision]);
  const set = (key: string, value: any) =>
    replaceMeta({ ...mRef.current, [key]: value });
  const pending = useRef(false);
  const reviewAttempt = useRef<{ signature: string; requestId: string } | null>(
    null,
  );
  async function decide(
    outcome: "accept" | "changes",
    target: string,
    feedback: string,
  ) {
    if (!baseline || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    const draft = {
      revision: baseline.revision,
      outcome,
      target,
      feedback,
      patch: changedFields(baseline.meta, mRef.current),
      body: bodyRef.current !== baseline.body ? bodyRef.current : undefined,
      actor,
    };
    const signature = JSON.stringify(draft);
    if (reviewAttempt.current?.signature !== signature)
      reviewAttempt.current = { signature, requestId: randomUUID() };
    try {
      const r: RecordFile = await api(
        `/records/${baseline.meta.id}/review-outcome`,
        "POST",
        {
          ...draft,
          requestId: reviewAttempt.current.requestId,
        },
      );
      setBaseline(r);
      replaceMeta(r.meta);
      replaceBody(r.body);
      setConflict(null);
      await onSaved(r.meta.id);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.detail?.current)
        setConflict({ current: e.detail.current, fields: ["review outcome"] });
      setError(String(e));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  // `draft` lets a one-click change (archive) save without waiting for state.
  async function save(review = false, closeAfter = true, draft?: Meta) {
    if (pending.current) return false;
    const currentDraft = draft ?? mRef.current;
    const currentBody = bodyRef.current;
    if (!currentDraft.title.trim()) {
      setError("Give the ticket a short title before closing.");
      return false;
    }
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      let r: RecordFile;
      const changed = baseline
        ? Object.keys(changedFields(baseline.meta, currentDraft)).length > 0 ||
          currentBody !== baseline.body
        : true;
      if (!baseline)
        r = await api("/records", "POST", {
          kind,
          meta: currentDraft,
          body: currentBody,
          actor,
        });
      else if (!changed) r = baseline;
      else r = await patchRecord(baseline, currentDraft, currentBody);
      setBaseline(r);
      setConflict(null);
      setCloseFailed(false);
      if (review)
        r = await api(`/records/${r.meta.id}/review`, "POST", {
          revision: r.revision,
          handoff: currentDraft.handoff,
          evidence: currentDraft.evidence,
          reviewInstructions: currentDraft.reviewInstructions,
          exceptions: currentDraft.exceptions,
          actor,
        });
      setBaseline(r);
      replaceMeta(r.meta);
      replaceBody(r.body);
      await onSaved(r.meta.id);
      if (closeAfter) onClose();
      return r;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  // Sends only the fields this draft changed. If someone else saved in the
  // meantime and touched different fields, the draft is applied on top of
  // their version; overlapping edits stop for the user to choose.
  async function patchRecord(
    base: RecordFile,
    draft: Meta,
    draftBody: string,
  ): Promise<RecordFile> {
    const patch = changedFields(base.meta, draft),
      bodyChanged = draftBody !== base.body;
    const send = (revision: string) =>
      api<RecordFile>(`/records/${base.meta.id}`, "PATCH", {
        revision,
        patch,
        body: bodyChanged ? draftBody : undefined,
        actor,
      });
    try {
      return await send(base.revision);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 409) throw e;
      const current: RecordFile =
        e.detail?.current ?? (await api(`/records/${base.meta.id}`));
      // Same revision means the 409 was not an edit conflict (e.g. a branch pause).
      if (current.revision === base.revision) throw e;
      const theirs = changedFields(base.meta, current.meta);
      const fields = Object.keys(patch).filter((k) => k in theirs);
      if (bodyChanged && current.body !== base.body) fields.push("description");
      if (fields.length) {
        setConflict({ current, fields });
        throw new Error(
          `Someone else also changed ${fields.join(", ")}. Your draft is preserved; choose which version to keep.`,
        );
      }
      return await send(current.revision);
    }
  }
  function rebase(current: RecordFile, keepMine: boolean) {
    if (keepMine && baseline) {
      const nextMeta = {
        ...current.meta,
        ...changedFields(baseline.meta, mRef.current),
      };
      const nextBody =
        bodyRef.current === baseline.body ? current.body : bodyRef.current;
      mRef.current = nextMeta;
      bodyRef.current = nextBody;
      setMState(nextMeta);
      setBodyState(nextBody);
      setTitlePresent(!!nextMeta.title.trim());
    } else {
      mRef.current = current.meta;
      bodyRef.current = current.body;
      setMState(current.meta);
      setBodyState(current.body);
      setTitlePresent(!!current.meta.title.trim());
    }
    setBaseline(current);
    setConflict(null);
    setError("");
  }
  async function close() {
    if (pending.current) return;
    if (!isDraftDirty()) {
      onClose();
      return;
    }
    if (!(await save())) setCloseFailed(true);
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "s" &&
        !document.querySelector(".annotation-dialog[open]")
      ) {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const [posting, setPosting] = useState(false);
  const [postedComment, setPostedComment] = useState<string | null>(null);
  const draftKey = `comment:${state.config.projectId}:${baseline?.meta.id ?? "new"}`;
  useEffect(() => {
    setComment(localStorage.getItem(draftKey) ?? "");
  }, [draftKey]);
  useEffect(() => {
    localStorage.setItem(draftKey, comment);
  }, [comment, draftKey]);
  async function post() {
    if (!baseline || posting || !comment.trim()) return;
    setPosting(true);
    try {
      const posted = await api(
        `/records/${baseline.meta.id}/comments`,
        "POST",
        {
          body: comment,
          kind: commentKind,
          actor,
        },
      );
      setComment("");
      localStorage.removeItem(draftKey);
      await onSaved(baseline.meta.id);
      setPostedComment(posted.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setPosting(false);
    }
  }
  // Functional update: concurrent uploads must not overwrite each other.
  const attachId = (id: string) =>
    replaceMeta(
      mRef.current.attachments?.includes(id)
        ? mRef.current
        : {
            ...mRef.current,
            attachments: [...(mRef.current.attachments ?? []), id],
          },
    );
  async function attach(file: File) {
    try {
      const a = await uploadImage(file);
      attachId(a.id);
      // Attached from the images section: also reference it in the text.
      replaceBody(
        (b: string) => `${b.trimEnd()}\n\n${imageMarkdown(a.id, a.name)}\n`,
      );
      openImage(a.id);
    } catch (e) {
      setError(String(e));
    }
  }
  const field = (key: string, label: string, placeholder = "") => (
    <label className="field">
      {label}
      <input
        value={m[key] ?? ""}
        placeholder={placeholder}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );
  const array = (key: string, label: string, placeholder = "") => (
    <label className="field">
      {label}
      <input
        key={baseline?.revision ?? "new"}
        defaultValue={(m[key] ?? []).join(", ")}
        placeholder={placeholder}
        onChange={(e) => set(key, split(e.target.value))}
      />
    </label>
  );
  const linked = (key: string, label: string, type: Kind) => (
    <label className="field">
      {label}
      <select
        multiple
        value={m[key] ?? []}
        onChange={(e) =>
          set(
            key,
            Array.from(e.target.selectedOptions).map((o) => o.value),
          )
        }
      >
        {state.records
          .filter(
            (r) => r.meta.kind === type && r.meta.id !== baseline?.meta.id,
          )
          .map((r) => (
            <option key={r.meta.id} value={r.meta.id}>
              {r.meta.title}
            </option>
          ))}
      </select>
    </label>
  );
  const statuses =
    kind === "ticket"
      ? state.config.columns.map((c) => ({ id: c.id, name: c.name }))
      : (kind === "decision"
          ? ["proposed", "accepted", "rejected", "superseded"]
          : ["proposed", "active", "deprecated"]
        ).map((id) => ({ id, name: id }));
  const conversation = baseline ? (
    <section className="ticket-thread">
      <div className="conversation-toolbar">
        <h3>Conversation</h3>
        <button
          className="button subtle small"
          aria-label={`Comments: ${conversationOrder === "oldest" ? "oldest" : "newest"} first. Switch to ${conversationOrder === "oldest" ? "newest" : "oldest"} first`}
          title={`Switch to ${conversationOrder === "oldest" ? "newest" : "oldest"} first`}
          onClick={() =>
            onConversationOrder(
              conversationOrder === "oldest" ? "newest" : "oldest",
            )
          }
        >
          <span className={conversationOrder === "oldest" ? "sort-oldest" : ""}>
            <ArrowUpIcon />
          </span>
          {conversationOrder === "oldest" ? "Oldest first" : "Newest first"}
        </button>
      </div>
      <div className="conversation">
        {state.comments
          .filter((c) => c.ticket === baseline?.meta.id)
          .sort(
            (a, b) =>
              (a.at.localeCompare(b.at) || a.id.localeCompare(b.id)) *
              (conversationOrder === "oldest" ? 1 : -1),
          )
          .map((c) => (
            <article
              className="comment"
              key={c.id}
              id={`thread-${c.id}`}
              data-kind={c.kind}
            >
              <div className="comment-type">
                <strong>
                  {c.kind === "review"
                    ? c.actor.kind === "agent"
                      ? "Review requested"
                      : "Review feedback"
                    : c.kind === "handoff"
                      ? "Handoff note"
                      : c.kind === "question"
                        ? "Question"
                        : "Comment"}
                </strong>
                {c.kind === "question" && (
                  <span className="tag">
                    {c.resolved ? "Resolved" : "Needs an answer"}
                  </span>
                )}
              </div>
              <div className="comment-heading">
                <span className="avatar">{c.actor.name.slice(0, 1)}</span>
                <strong>{c.actor.name}</strong>
                <span className="tag">{c.actor.kind}</span>
                <span className="muted">{ago(c.at)}</span>
              </div>
              <div className="markdown">
                <RecordMarkdown openImage={openImage}>{c.body}</RecordMarkdown>
              </div>
              {c.questions && c.resolved && baseline && (
                <Questionnaire
                  question={c}
                  projectId={state.config.projectId}
                  disabled={saving || state.branchChanged}
                  reload={() => onSaved(baseline.meta.id)}
                />
              )}
              {c.kind === "question" && !c.questions && (
                <button
                  className="button subtle"
                  onClick={async () => {
                    try {
                      await api(`/comments/${c.id}`, "PATCH", {
                        revision: c.revision,
                        resolved: !c.resolved,
                        actor,
                      });
                      await onSaved(baseline!.meta.id);
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  {c.resolved ? "Reopen question" : "Resolve question"}
                </button>
              )}
            </article>
          ))}
      </div>
      {postedComment && (
        <button
          className="text-button"
          onClick={() =>
            document
              .getElementById(`thread-${postedComment}`)
              ?.scrollIntoView({ block: "nearest" })
          }
        >
          View your new comment
        </button>
      )}
      <label className="field">
        Add to the conversation
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onPaste={(e) =>
            pasteImage(e, (t) => setComment((c: string) => t(c)))
              .then((id) => id && attachId(id))
              .catch((err) => setError(String(err)))
          }
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void post();
            }
          }}
          placeholder="Share context, ask a question, or reference an annotation ID."
        />
      </label>
      <div className="inline-actions">
        <button
          className="button subtle"
          aria-expanded={pickingCommentScreenshot}
          onClick={() => setPickingCommentScreenshot((v) => !v)}
        >
          Attach screenshot to comment
        </button>
        <select
          aria-label="Comment type"
          value={commentKind}
          onChange={(e) => setCommentKind(e.target.value)}
        >
          <option value="comment">Comment</option>
          <option value="question">Question</option>
          <option value="handoff">Handoff note</option>
          <option value="review">Review feedback</option>
        </select>
        <button
          className="button primary"
          disabled={!comment.trim() || posting}
          onClick={post}
        >
          Post comment
        </button>
      </div>
      {pickingCommentScreenshot && (
        <ScreenshotPicker
          images={state.attachments}
          attached={[...comment.matchAll(/#image=([\w-]+)/g)].map((m) => m[1])}
          helpText="Choose a screenshot to insert into your comment. Post comment to send it."
          onAttach={(id) => {
            setComment(
              (c) =>
                c +
                (c.trim() ? "\n\n" : "") +
                imageMarkdown(
                  id,
                  state.attachments.find((a) => a.id === id)?.name,
                ),
            );
            setPickingCommentScreenshot(false);
          }}
          onClose={() => setPickingCommentScreenshot(false)}
        />
      )}
    </section>
  ) : null;
  return (
    <dialog
      ref={dialog}
      className={`record-dialog${standalone ? " standalone-record" : ""}`}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const box = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < box.left ||
          e.clientX > box.right ||
          e.clientY < box.top ||
          e.clientY > box.bottom
        )
          void close();
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (!saving) void close();
      }}
    >
      <div className="dialog-top">
        {standalone && (
          <button
            className="button"
            onClick={() => void close()}
            disabled={saving}
            aria-label="Control Room: back to board"
          >
            <Logo /> Control Room
          </button>
        )}
        <span className="eyebrow">
          {baseline ? recordId(baseline) : "New"} ·{" "}
          {kind.charAt(0).toUpperCase() + kind.slice(1)}
        </span>
        <button
          className="icon-button"
          aria-label="Close ticket"
          disabled={saving}
          onClick={() => void close()}
        >
          <CloseIcon />
        </button>
      </div>
      <WindowMenu
        file={[
          {
            label: "Save",
            run: () => void save(false, false),
            disabled: saving,
          },
          { label: "Save and close", run: () => void save(), disabled: saving },
          { label: "Close window", run: () => void close(), disabled: saving },
        ]}
        view={
          baseline
            ? [
                { label: "Details", run: () => setTab("details") },
                { label: "Conversation", run: () => setTab("conversation") },
                { label: "History", run: () => setTab("history") },
              ]
            : undefined
        }
      />
      <div className="record-title">
        <DraftInput
          aria-label="Title"
          autoFocus
          placeholder={
            kind === "ticket"
              ? "What needs to happen?"
              : kind === "rule"
                ? "Name this design rule"
                : "What was decided?"
          }
          value={m.title}
          reset={draftReset}
          onDraft={(value) => draftMeta("title", value)}
          onCommit={(value) => set("title", value)}
        />
        <div className="record-subtitle">
          {kind === "ticket" &&
            (() => {
              const column = state.config.columns.find(
                (c) => c.id === m.status,
              );
              return column ? (
                <span className="stage-pill" data-stage={column.role}>
                  <StageIcon role={column.role} />
                  {column.name}
                </span>
              ) : null;
            })()}
          {m.archived && <span className="tag">Archived</span>}
          {baseline ? (
            <>
              Created by {baseline.meta.author.name} ·{" "}
              {ago(baseline.meta.createdAt)} ·{" "}
              <span title={baseline.path}>Markdown record</span>
            </>
          ) : (
            "Capture the intent. Add detail as it becomes useful."
          )}
        </div>
      </div>
      {kind === "ticket" &&
        m.parent &&
        (() => {
          const parent = state.records.find((r) => r.meta.id === m.parent);
          return (
            <div className="parent-navigation">
              {parent ? (
                <button
                  className="text-button"
                  disabled={saving}
                  {...ticketNavigation(parent.meta.id, async (id) => {
                    if (await save(false, false)) openRecord(id);
                  })}
                >
                  Parent: {recordId(parent)} {parent.meta.title}
                  {parent.meta.archived ? " (Archived)" : ""}
                </button>
              ) : (
                <span className="muted">Parent unavailable: {m.parent}</span>
              )}
            </div>
          );
        })()}
      <nav className="detail-tabs" aria-label="Record sections">
        {[
          "details",
          ...(baseline
            ? [
                "conversation",
                "history",
                ...(kind === "ticket" ? ["context"] : []),
              ]
            : []),
        ].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t === "context"
              ? "Agent context"
              : t.charAt(0).toUpperCase() + t.slice(1)}
            {t === "conversation" && (
              <span>
                {
                  state.comments.filter((c) => c.ticket === baseline?.meta.id)
                    .length
                }
              </span>
            )}
          </button>
        ))}
      </nav>
      <div
        className="detail-body"
        ref={detailBody}
        onScroll={rememberReadingPosition}
        style={{
          overflowAnchor:
            tab === "conversation" || tab === "details" ? "none" : undefined,
        }}
        inert={saving}
      >
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
        {closeFailed && (
          <div className="banner" role="alert">
            Your changes were not saved.
            <span className="inline-actions">
              <button className="button" onClick={onClose}>
                Discard changes and close
              </button>
              <button className="button" onClick={() => setCloseFailed(false)}>
                Keep editing
              </button>
            </span>
          </div>
        )}
        {(() => {
          const latest =
            conflict?.current ??
            (baseline && record && baseline.revision !== record.revision
              ? record
              : null);
          if (!latest) return null;
          return (
            <div className="banner">
              This record changed elsewhere
              {conflict ? ` (${conflict.fields.join(", ")})` : ""}. Your draft
              is preserved.
              <span className="inline-actions">
                {dirty && (
                  <button
                    className="button"
                    onClick={() => rebase(latest, true)}
                  >
                    Keep my edits on top
                  </button>
                )}
                <button
                  className="button"
                  onClick={() => rebase(latest, false)}
                >
                  {dirty
                    ? "Discard my edits and reload"
                    : "Reload current version"}
                </button>
              </span>
            </div>
          );
        })()}
        {kind === "ticket" &&
          baseline &&
          (tab === "details" || tab === "conversation") && (
            <OpenQuestions
              projectId={state.config.projectId}
              ticket={baseline.meta.id}
              questions={state.comments.filter(
                (c) =>
                  c.ticket === baseline.meta.id &&
                  c.kind === "question" &&
                  !c.resolved,
              )}
              disabled={saving || state.branchChanged}
              openImage={openImage}
              reload={() => onSaved(baseline.meta.id)}
              onThread={(id) =>
                document
                  .getElementById(`thread-${id}`)
                  ?.scrollIntoView({ block: "start" })
              }
            />
          )}
        {kind === "ticket" &&
          baseline &&
          state.config.columns.find((c) => c.id === baseline.meta.status)
            ?.role === "review" && (
            <>
              {(tab === "details" || tab === "conversation") && (
                <ReviewBrief meta={baseline.meta} openImage={openImage} />
              )}
              <ReviewActions
                hidden={tab !== "details" && tab !== "conversation"}
                columns={state.config.columns}
                disabled={saving || state.branchChanged}
                onDecide={(outcome, target, feedback) =>
                  void decide(outcome, target, feedback)
                }
              />
            </>
          )}
        {tab === "details" && (
          <div className="record-layout">
            <aside className="record-properties">
              <div className="fields two">
                <label className="field">
                  Status
                  <select
                    aria-label="Status"
                    value={m.status}
                    onChange={(e) => set("status", e.target.value)}
                  >
                    {statuses.map((s) => (
                      <option value={s.id} key={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                {kind === "ticket" ? (
                  <label className="field">
                    Priority
                    <select
                      value={m.priority ?? 2}
                      onChange={(e) => set("priority", Number(e.target.value))}
                    >
                      {["Urgent", "High", "Normal", "Low"].map((v, i) => (
                        <option value={i} key={i}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  array("scope", "Scope labels", "Empty means project-wide")
                )}
                {kind === "ticket" && (
                  <>
                    <TagInput
                      key={`owner-${baseline?.revision ?? "new"}`}
                      label="Owner"
                      value={m.owner ?? ""}
                      choices={state.records
                        .map((r) => r.meta.owner ?? "")
                        .filter(Boolean)}
                      onChange={(v) => set("owner", v)}
                    />
                    <ParentInput
                      records={state.records}
                      columns={state.config.columns}
                      ticketId={baseline?.meta.id}
                      value={m.parent ?? null}
                      onChange={(id) => set("parent", id)}
                    />
                    <TagInput
                      key={`labels-${baseline?.revision ?? "new"}`}
                      label="Labels"
                      multiple
                      value={m.labels ?? []}
                      choices={state.records.flatMap(
                        (r) => r.meta.labels ?? [],
                      )}
                      onChange={(v) => set("labels", v)}
                    />
                    {field(
                      "worktree",
                      "Code worktree / branch",
                      "Path or branch reference",
                    )}
                  </>
                )}
                {kind === "rule" && (
                  <>
                    <label className="field">
                      Strength
                      <select
                        value={m.strength ?? "required"}
                        onChange={(e) => set("strength", e.target.value)}
                      >
                        <option>required</option>
                        <option>recommended</option>
                      </select>
                    </label>
                    <label className="field">
                      Category
                      <select
                        value={m.category ?? "components"}
                        onChange={(e) => set("category", e.target.value)}
                      >
                        {[
                          "foundations",
                          "components",
                          "interactions",
                          "responsive",
                          "accessibility",
                          "language",
                        ].map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </div>
              {kind === "ticket" && (
                <label className="check-row approved">
                  <input
                    type="checkbox"
                    checked={!!m.scopeApproved}
                    onChange={(e) => set("scopeApproved", e.target.checked)}
                  />
                  <span>
                    <strong>Approve this scope for agent work</strong>
                    <small>
                      Agents may select and prioritize work on this ticket and
                      its children.
                    </small>
                  </span>
                </label>
              )}
              {kind === "ticket" && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={!!m.humanReviewRequired}
                    onChange={(e) =>
                      set("humanReviewRequired", e.target.checked)
                    }
                  />
                  <span>
                    <strong>Require human acceptance</strong>
                    <small>
                      The orchestrator may review, but only you can accept this
                      ticket.
                    </small>
                  </span>
                </label>
              )}
              {record?.meta.assignment && (
                <p className="muted">
                  Assigned to {record.meta.assignment.worker} ·{" "}
                  {record.meta.assignment.state}
                </p>
              )}
              {record?.meta.agentReview && (
                <p className="muted">
                  Review by {record.meta.agentReview.reviewer}:{" "}
                  {record.meta.agentReview.outcome}. Integration not performed.
                  See the conversation for criteria and evidence.
                </p>
              )}
            </aside>
            <section className="record-content">
              {record && (
                <ProgressReport
                  record={record}
                  claim={state.claims.find((c) => c.ticket === record.meta.id)}
                  role={
                    state.config.columns.find(
                      (c) => c.id === record.meta.status,
                    )?.role
                  }
                />
              )}
              {kind === "ticket" && record && (
                <TicketProgress
                  record={{ ...record, body }}
                  ctx={projectContext(state)}
                />
              )}
              {kind === "ticket" && (
                <Microtasks body={body} onChange={replaceBody} />
              )}
              <div className="section-heading">
                <h3>
                  {kind === "ticket"
                    ? "Description"
                    : kind === "decision"
                      ? "Decision & rationale"
                      : "Guidance & examples"}
                </h3>
                <button
                  className="text-button"
                  onClick={() => setPreview(!preview)}
                >
                  {preview ? "Edit Markdown" : "Preview"}
                </button>
              </div>
              {preview ? (
                <div className="markdown prose">
                  <RecordMarkdown openImage={openImage}>{body}</RecordMarkdown>
                </div>
              ) : (
                <DraftTextarea
                  className="markdown-editor"
                  aria-label="Markdown body"
                  placeholder={
                    kind === "ticket"
                      ? "Add a longer description, context, or acceptance criteria…"
                      : undefined
                  }
                  value={body}
                  reset={draftReset}
                  onDraft={draftBody}
                  onCommit={replaceBody}
                  onImage={attachId}
                  onError={(err) => setError(String(err))}
                  spellCheck
                />
              )}
              {preview && !!m.attachments?.length && (
                <div
                  className="description-images"
                  aria-label="Description screenshots"
                >
                  {(m.attachments as string[])
                    .filter(
                      (id) =>
                        !body.includes(`#image=${id}`) &&
                        !body.includes(`/api/images/${id}/`),
                    )
                    .map((id) => {
                      const a = state.attachments.find((a) => a.id === id);
                      return (
                        <button
                          className="screenshot-card"
                          key={id}
                          onClick={() => openImage(id)}
                        >
                          {a ? (
                            <ImageThumbnail image={a} />
                          ) : (
                            <span>Image unavailable</span>
                          )}
                          <span>{a?.name ?? "Screenshot"}</span>
                        </button>
                      );
                    })}
                </div>
              )}
              {kind === "ticket" && (
                <section aria-label="Child tickets">
                  <h3>Child tickets</h3>
                  {baseline &&
                    state.records
                      .filter(
                        (r) =>
                          r.meta.kind === "ticket" &&
                          r.meta.parent === baseline.meta.id,
                      )
                      .map((r) => (
                        <button
                          key={r.meta.id}
                          className="child-ticket"
                          {...ticketNavigation(r.meta.id, async (id) => {
                            if (await save(false, false)) openRecord(id);
                          })}
                        >
                          <span>
                            <span className="muted">{recordId(r)} </span>
                            {r.meta.title}
                          </span>
                          <span className="tag">
                            {state.config.columns.find(
                              (c) => c.id === r.meta.status,
                            )?.name ?? r.meta.status}
                          </span>
                        </button>
                      ))}
                  <p className="help">
                    New children go to{" "}
                    {
                      state.config.columns.find((c) => c.role === "backlog")!
                        .name
                    }
                    .{!baseline && " The parent will be saved first."}
                  </p>
                  <QuickTicket
                    lane="child tickets"
                    alwaysOpen
                    status={
                      state.config.columns.find((c) => c.role === "backlog")!.id
                    }
                    defaults={{}}
                    createTicket={async (title) => {
                      const parent =
                        !baseline || dirty
                          ? await save(false, false)
                          : baseline;
                      if (!parent)
                        throw new Error(
                          "Save the parent successfully before adding a child. Your child title is preserved.",
                        );
                      await api("/records", "POST", {
                        kind: "ticket",
                        meta: {
                          title,
                          parent: parent.meta.id,
                          status: state.config.columns.find(
                            (c) => c.role === "backlog",
                          )!.id,
                        },
                        body: "",
                        actor,
                      });
                    }}
                    onCreated={async () => {
                      await onSaved(baseline?.meta.id ?? "");
                    }}
                  />
                  <p className="help">
                    Parent acceptance remains explicit, even when every child is
                    Done.
                  </p>
                  <ExistingChild
                    state={state}
                    parentId={baseline?.meta.id}
                    draftParent={m.parent}
                    saveParent={() => save(false, false)}
                    onSaved={async () => {
                      await onSaved(baseline?.meta.id ?? "");
                    }}
                  />
                </section>
              )}
              {kind === "ticket" && conversation}
              {kind === "ticket" ? (
                <details className="disclosure">
                  <summary>Agent handoff, review & dependencies</summary>
                  <div className="fields">
                    <label className="field">
                      Current handoff
                      <textarea
                        value={m.handoff ?? ""}
                        onChange={(e) => set("handoff", e.target.value)}
                        placeholder="What changed, where things stand, and the next concrete step."
                      />
                    </label>
                    <label className="field">
                      Verification evidence
                      <textarea
                        value={m.evidence ?? ""}
                        onChange={(e) => set("evidence", e.target.value)}
                        placeholder="Checks performed, results, commit references, and limitations."
                      />
                    </label>
                    {field(
                      "blocked",
                      "Blocked because",
                      "Leave empty when work can proceed",
                    )}
                    <label className="field">
                      What the human should review
                      <textarea
                        value={m.reviewInstructions ?? ""}
                        onChange={(e) =>
                          set("reviewInstructions", e.target.value)
                        }
                        placeholder="Specific things to inspect or try, and the expected result."
                      />
                    </label>
                    <label className="field">
                      Rule deviations / approved exceptions
                      <textarea
                        value={m.exceptions ?? ""}
                        onChange={(e) => set("exceptions", e.target.value)}
                        placeholder="Rule ID, reason, affected scope, and who approved the exception."
                      />
                    </label>
                  </div>
                  <div className="fields two code-links">
                    {field("branch", "Branch", "feature/short-name")}
                    <label className="field">
                      Pull request
                      <input
                        value={m.pr ?? ""}
                        placeholder="https://…/pull/123"
                        onChange={(e) => set("pr", e.target.value)}
                      />
                      {isHttp(m.pr) && (
                        <a
                          className="pr-link"
                          href={m.pr.trim()}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open pull request ↗
                        </a>
                      )}
                    </label>
                  </div>
                  {!!m.commits?.length && (
                    <div className="field">
                      Commits
                      <ul className="commit-list">
                        {(m.commits as string[]).map((c) => (
                          <li key={c}>
                            <code title={c}>{shortHash(c)}</code>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {m.verification && <VerificationPanel v={m.verification} />}
                  <details className="disclosure">
                    <summary>Dependencies and relevant knowledge</summary>
                    <div className="fields">
                      {linked("dependencies", "Depends on tickets", "ticket")}
                      {linked("decisions", "Linked decisions", "decision")}
                      {linked("rules", "Explicit design rules", "rule")}
                    </div>
                  </details>
                </details>
              ) : (
                <>
                  <div className="fields">
                    {array(
                      "references",
                      "Implementation / document references",
                      "src/components/Button.tsx, docs/design.md",
                    )}
                    <label className="field">
                      Replaces a previous {kind}
                      <select
                        value={m.supersedes ?? ""}
                        onChange={(e) => set("supersedes", e.target.value)}
                      >
                        <option value="">No predecessor</option>
                        {state.records
                          .filter(
                            (r) =>
                              r.meta.kind === kind &&
                              r.meta.id !== baseline?.meta.id,
                          )
                          .map((r) => (
                            <option key={r.meta.id} value={r.meta.id}>
                              {r.meta.title}
                            </option>
                          ))}
                      </select>
                    </label>
                    {kind === "rule" &&
                      linked("decisions", "Rationale decisions", "decision")}
                  </div>
                  <p className="help">
                    Both humans and agents may update guidance. Changes retain
                    attribution and revision history.
                  </p>
                </>
              )}
              <section>
                <div className="section-heading">
                  <h3>Images & visual feedback</h3>
                  <button
                    className="button subtle"
                    aria-expanded={pickingScreenshot}
                    onClick={() => setPickingScreenshot((v) => !v)}
                  >
                    Attach recent screenshot
                  </button>
                  <label className="button subtle file-button">
                    + Attach image
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        if (e.target.files?.[0]) attach(e.target.files[0]);
                      }}
                    />
                  </label>
                </div>
                {pickingScreenshot && (
                  <ScreenshotPicker
                    images={state.attachments}
                    attached={m.attachments ?? []}
                    onClose={() => setPickingScreenshot(false)}
                    onAttach={(id) => {
                      attachId(id);
                      setPickingScreenshot(false);
                    }}
                  />
                )}
                <div className="attachment-grid">
                  {(m.attachments ?? []).map((id: string) => {
                    const a = state.attachments.find((a) => a.id === id);
                    return (
                      <button
                        key={id}
                        className="attachment"
                        onClick={() => openImage(id)}
                      >
                        {!a ? (
                          <span>Image unavailable locally</span>
                        ) : (
                          <ImageThumbnail
                            key={`${id}-${a.revision}`}
                            image={a}
                          />
                        )}
                        <span>
                          {a?.name ?? "New screenshot"} ·{" "}
                          {a?.annotations.length ?? 0} notes
                          {a?.trashedAt ? " · In Trash" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {!m.attachments?.length && (
                  <p className="help">
                    Paste a screenshot into the description or a comment to add
                    it inline, or attach one here. Save this record to keep new
                    attachment links.
                  </p>
                )}
              </section>
              <details className="disclosure">
                <summary>Additional metadata</summary>
                <pre>
                  {JSON.stringify(
                    Object.fromEntries(
                      Object.entries(m).filter(
                        ([k]) => !["title", "body"].includes(k),
                      ),
                    ),
                    null,
                    2,
                  )}
                </pre>
              </details>
            </section>
          </div>
        )}
        {tab === "conversation" && conversation}
        {tab === "history" && (
          <div className="history-list">
            {history.map((e) => (
              <details key={e.id} className="history-entry">
                <summary>
                  <strong>{e.actor.name}</strong> {e.action}{" "}
                  <span className="muted">
                    {new Date(e.at).toLocaleString()}
                  </span>
                </summary>
                <div className="markdown">
                  <RecordMarkdown gfm={false}>{e.body}</RecordMarkdown>
                </div>
              </details>
            ))}
          </div>
        )}
        {tab === "context" && (
          <>
            <p className="help">
              A compact task packet for any coding agent. Includes scoped
              guidance, dependencies, handoff, and local image references.
            </p>
            <button
              className="button"
              onClick={() =>
                copyText(JSON.stringify(context, null, 2)).catch((e) =>
                  setError(String(e)),
                )
              }
            >
              Copy agent context
            </button>
            <pre className="context-preview">
              {context ? JSON.stringify(context, null, 2) : "Loading context…"}
            </pre>
          </>
        )}
      </div>
      <footer className="dialog-footer">
        <div className="inline-actions">
          <button
            className="button subtle"
            onClick={() => void close()}
            disabled={saving}
          >
            Close
          </button>
          {dirty && (
            <button
              className="text-button danger"
              onClick={onClose}
              disabled={saving}
            >
              Discard changes
            </button>
          )}
          {kind === "ticket" && baseline && (
            <button
              className="button subtle"
              disabled={saving || state.branchChanged}
              onClick={() => {
                const next = {
                  ...mRef.current,
                  archived: !mRef.current.archived,
                };
                replaceMeta(next);
                void save(false, true, next);
              }}
            >
              {m.archived ? "Unarchive" : "Archive"}
            </button>
          )}
        </div>
        <div className="inline-actions">
          {kind === "ticket" && baseline && (
            <button
              className="button"
              disabled={saving || !m.handoff?.trim() || !m.evidence?.trim()}
              onClick={() => save(true)}
            >
              Submit for review
            </button>
          )}
          <button
            className="button primary"
            disabled={saving || !titlePresent || state.branchChanged}
            onClick={() => save()}
          >
            {saving ? "Saving…" : baseline ? "Save changes" : `Create ${kind}`}
          </button>
        </div>
      </footer>
    </dialog>
  );
}
