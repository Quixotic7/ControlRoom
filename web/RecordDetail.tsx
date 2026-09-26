import React, { useEffect, useRef, useState } from "react";
import { TagInput } from "./TagInput";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Kind, Meta, ProjectState, RecordFile } from "../src/types";
import { actor, api, ApiError, ago, recordId, split, uploadImage } from "./api";

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

export function RecordDetail({
  record,
  kind,
  state,
  onClose,
  onSaved,
  onError,
  openRecord,
  openImage,
}: {
  record?: RecordFile;
  kind: Kind;
  state: ProjectState;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
  onError: (s: string) => void;
  openRecord: (s: string) => void;
  openImage: (s: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [baseline, setBaseline] = useState(record),
    [m, setM] = useState<any>(
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
  const [body, setBody] = useState(record?.body ?? template),
    [tab, setTab] = useState("details"),
    [preview, setPreview] = useState(false),
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
    [closeFailed, setCloseFailed] = useState(false);
  const dirty = baseline
    ? Object.keys(changedFields(baseline.meta, m)).length > 0 ||
      body !== baseline.body
    : !!m.title.trim() || body !== template;
  useEffect(() => {
    dialog.current?.showModal();
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
    setM((v: any) => ({ ...v, [key]: value }));
  const pending = useRef(false);
  async function save(review = false, closeAfter = true) {
    if (pending.current) return false;
    if (!m.title.trim()) {
      setError("Give the ticket a short title before closing.");
      return false;
    }
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      let r: RecordFile;
      if (!baseline)
        r = await api("/records", "POST", { kind, meta: m, body, actor });
      else if (!dirty) r = baseline;
      else r = await patchRecord(baseline);
      setBaseline(r);
      setConflict(null);
      setCloseFailed(false);
      if (review)
        r = await api(`/records/${r.meta.id}/review`, "POST", {
          revision: r.revision,
          handoff: m.handoff,
          evidence: m.evidence,
          exceptions: m.exceptions,
          actor,
        });
      setBaseline(r);
      setM(r.meta);
      setBody(r.body);
      await onSaved(r.meta.id);
      if (closeAfter) onClose();
      return true;
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
  async function patchRecord(base: RecordFile): Promise<RecordFile> {
    const patch = changedFields(base.meta, m),
      bodyChanged = body !== base.body;
    const send = (revision: string) =>
      api<RecordFile>(`/records/${base.meta.id}`, "PATCH", {
        revision,
        patch,
        body: bodyChanged ? body : undefined,
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
      setM({ ...current.meta, ...changedFields(baseline.meta, m) });
      if (body === baseline.body) setBody(current.body);
    } else {
      setM(current.meta);
      setBody(current.body);
    }
    setBaseline(current);
    setConflict(null);
    setError("");
  }
  async function close() {
    if (pending.current) return;
    if (!dirty) {
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
      await api(`/records/${baseline.meta.id}/comments`, "POST", {
        body: comment,
        kind: commentKind,
        actor,
      });
      setComment("");
      localStorage.removeItem(draftKey);
      await onSaved(baseline.meta.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setPosting(false);
    }
  }
  async function attach(file: File) {
    try {
      const a = await uploadImage(file);
      // Functional update: concurrent uploads must not overwrite each other.
      setM((v: any) => ({
        ...v,
        attachments: [...(v.attachments ?? []), a.id],
      }));
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
      <h3>Conversation</h3>
      <div className="conversation">
        {state.comments
          .filter((c) => c.ticket === baseline?.meta.id)
          .map((c) => (
            <article className="comment" key={c.id}>
              <div className="comment-heading">
                <span className="avatar">{c.actor.name.slice(0, 1)}</span>
                <strong>{c.actor.name}</strong>
                <span className="tag">{c.actor.kind}</span>
                <span className="muted">{ago(c.at)}</span>
              </div>
              <div className="markdown">
                <Markdown remarkPlugins={[remarkGfm]} skipHtml>
                  {c.body}
                </Markdown>
              </div>
              {c.kind === "question" && (
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
      <label className="field">
        Add to the conversation
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
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
    </section>
  ) : null;
  return (
    <dialog
      ref={dialog}
      className="record-dialog"
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
        <span className="eyebrow">
          {baseline ? recordId(baseline) : "NEW"} / {kind}
        </span>
        <button
          className="icon-button"
          aria-label="Close ticket"
          disabled={saving}
          onClick={() => void close()}
        >
          ×
        </button>
      </div>
      <div className="record-title">
        <input
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
          onChange={(e) => set("title", e.target.value)}
        />
        <div className="record-subtitle">
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
      <div className="detail-body" inert={saving}>
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
                    <label className="field">
                      Parent ticket
                      <select
                        value={m.parent ?? ""}
                        onChange={(e) => set("parent", e.target.value || null)}
                      >
                        <option value="">No parent</option>
                        {state.records
                          .filter(
                            (r) =>
                              r.meta.kind === "ticket" &&
                              r.meta.id !== baseline?.meta.id,
                          )
                          .map((r) => (
                            <option value={r.meta.id} key={r.meta.id}>
                              {r.meta.title}
                            </option>
                          ))}
                      </select>
                    </label>
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
            </aside>
            <section className="record-content">
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
                  <Markdown remarkPlugins={[remarkGfm]} skipHtml>
                    {body}
                  </Markdown>
                </div>
              ) : (
                <textarea
                  className="markdown-editor"
                  aria-label="Markdown body"
                  placeholder={
                    kind === "ticket"
                      ? "Add a longer description, context, or acceptance criteria…"
                      : undefined
                  }
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  spellCheck
                />
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
                      Rule deviations / approved exceptions
                      <textarea
                        value={m.exceptions ?? ""}
                        onChange={(e) => set("exceptions", e.target.value)}
                        placeholder="Rule ID, reason, affected scope, and who approved the exception."
                      />
                    </label>
                  </div>
                  <details className="disclosure">
                    <summary>Dependencies and relevant knowledge</summary>
                    <div className="fields">
                      {linked("dependencies", "Depends on tickets", "ticket")}
                      {linked("decisions", "Linked decisions", "decision")}
                      {linked("rules", "Explicit design rules", "rule")}
                    </div>
                  </details>
                  {state.records.some(
                    (r) => r.meta.parent === baseline?.meta.id,
                  ) && (
                    <section>
                      <h3>Child tickets</h3>
                      {state.records
                        .filter((r) => r.meta.parent === baseline?.meta.id)
                        .map((r) => (
                          <button
                            key={r.meta.id}
                            className="child-ticket"
                            onClick={async () => {
                              if (await save(false, false))
                                openRecord(r.meta.id);
                            }}
                          >
                            <span>{r.meta.title}</span>
                            <span className="tag">{r.meta.status}</span>
                          </button>
                        ))}
                      <p className="help">
                        Parent acceptance remains explicit, even when every
                        child is Done.
                      </p>
                    </section>
                  )}
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
                  <label className="button subtle file-button">
                    ＋ Attach image
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        if (e.target.files?.[0]) attach(e.target.files[0]);
                      }}
                    />
                  </label>
                </div>
                <div className="attachment-grid">
                  {(m.attachments ?? []).map((id: string) => {
                    const a = state.attachments.find((a) => a.id === id);
                    return (
                      <button
                        key={id}
                        className="attachment"
                        onClick={() => openImage(id)}
                      >
                        {a?.missing ? (
                          <span>Image unavailable locally</span>
                        ) : (
                          <img
                            src={`/api/images/${id}/base`}
                            alt={a?.name ?? "Attached screenshot"}
                          />
                        )}
                        <span>
                          {a?.name ?? "New screenshot"} ·{" "}
                          {a?.annotations.length ?? 0} notes
                        </span>
                      </button>
                    );
                  })}
                </div>
                {!m.attachments?.length && (
                  <p className="help">
                    Paste a screenshot anywhere, or attach one here. Save this
                    record to keep new attachment links.
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
                  <Markdown skipHtml>{e.body}</Markdown>
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
                navigator.clipboard
                  .writeText(JSON.stringify(context, null, 2))
                  .catch((e) => setError(String(e)))
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
            disabled={saving || !m.title.trim() || state.branchChanged}
            onClick={() => save()}
          >
            {saving ? "Saving…" : baseline ? "Save changes" : `Create ${kind}`}
          </button>
        </div>
      </footer>
    </dialog>
  );
}
