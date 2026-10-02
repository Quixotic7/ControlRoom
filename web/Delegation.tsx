import { useEffect, useState } from "react";
import type { DelegationScopes, DelegationStatus } from "../src/delegation";

export type { DelegationStatus } from "../src/delegation";

const emptyScopes: DelegationScopes = {
  approveScope: false,
  manageBoard: false,
  reviewWork: false,
  manageRuns: false,
};

const scopeLabels: Array<[keyof DelegationScopes, string, string]> = [
  [
    "approveScope",
    "Approve scope",
    "Record a chat-approved ticket or goal scope for agent work.",
  ],
  [
    "manageBoard",
    "Manage the board",
    "Move, prioritize, organize, archive, merge, and update managed assignments.",
  ],
  [
    "reviewWork",
    "Accept or request changes",
    "Record your reviewed-work decision when you conveyed it through chat.",
  ],
  [
    "manageRuns",
    "Resolve and retry runs",
    "Resolve a managed question or resume a stopped run after the chat decision.",
  ],
];

const pad = (value: number) => String(value).padStart(2, "0");
export const localDateTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const actionLabels: Record<string, string> = {
  approve_scope: "Approved scope",
  update: "Updated ticket",
  archive: "Archived ticket",
  unarchive: "Restored ticket",
  accept_review: "Accepted reviewed work",
  request_changes: "Requested changes",
  merge_duplicate: "Merged duplicate tickets",
  question_retry: "Resolved and retried run question",
  resume_run: "Resumed run",
  stop_run: "Stopped run",
  undo: "Undid delegated action",
};

export function DelegationSettings({
  status,
  reviewerMode,
  reviewer,
  busy,
  onSave,
}: {
  status?: DelegationStatus;
  reviewerMode?: "managed" | "chat";
  reviewer: string;
  busy: boolean;
  onSave: (input: {
    revision: string;
    enabled: boolean;
    scopes: DelegationScopes;
    expiresAt?: string | null;
    createdBeforeGrant?: boolean;
    approvedGoalsOnly?: boolean;
  }) => Promise<void>;
}) {
  const grant = status?.grant;
  const [enabled, setEnabled] = useState(!!grant?.enabled);
  const [scopes, setScopes] = useState<DelegationScopes>(
    grant?.scopes ?? emptyScopes,
  );
  const [expiresAt, setExpiresAt] = useState(localDateTime(grant?.expiresAt));
  const [createdBeforeGrant, setCreatedBeforeGrant] = useState(
    !!grant?.createdBeforeGrant,
  );
  const [approvedGoalsOnly, setApprovedGoalsOnly] = useState(
    !!grant?.approvedGoalsOnly,
  );

  useEffect(() => {
    setEnabled(!!grant?.enabled);
    setScopes(grant?.scopes ?? emptyScopes);
    setExpiresAt(localDateTime(grant?.expiresAt));
    setCreatedBeforeGrant(!!grant?.createdBeforeGrant);
    setApprovedGoalsOnly(!!grant?.approvedGoalsOnly);
  }, [status?.revision]);

  const chatMode = reviewerMode === "chat";
  return (
    <section
      className="agent-settings delegation-settings"
      aria-label="Chat delegation"
    >
      <h2>Chat delegation</h2>
      {!chatMode && !grant?.enabled ? (
        <p>
          Save <strong>Existing chat orchestrator</strong> above before you can
          grant chat delegation. Managed CLI agents never receive this grant.
        </p>
      ) : !chatMode ? (
        <>
          <p>
            This existing grant names <strong>{grant?.reviewer}</strong>, but
            the current saved reviewer is managed rather than a chat
            orchestrator. It cannot apply to the current reviewer.
          </p>
          <button
            className="button danger"
            disabled={busy || !status}
            onClick={() =>
              status &&
              grant &&
              void onSave({
                revision: status.revision,
                enabled: false,
                scopes: grant.scopes,
                expiresAt: null,
              })
            }
          >
            Revoke chat delegation
          </button>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!status) return;
            void onSave({
              revision: status.revision,
              enabled,
              scopes,
              expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
              ...(createdBeforeGrant ? { createdBeforeGrant: true } : {}),
              ...(approvedGoalsOnly ? { approvedGoalsOnly: true } : {}),
            });
          }}
        >
          <p>
            This grant applies only to the current saved chat reviewer:{" "}
            <strong>{reviewer || "the saved chat reviewer"}</strong>; this
            browser cannot choose a reviewer. Actions retain agent attribution.
          </p>
          {grant?.enabled && grant.reviewer !== reviewer && (
            <p className="banner">
              The existing grant names <strong>{grant.reviewer}</strong>. Saving
              replaces it for the current reviewer above.
            </p>
          )}
          <label className="agent-check">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy || !status}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Let the named chat orchestrator record my chat decisions
          </label>
          <p className="help">
            Off by default. Each action still needs the human’s quoted chat
            basis and time; Control Room records it as an agent acting through
            this delegation, never as a click by you.
          </p>
          <div className="delegation-scopes">
            {scopeLabels.map(([key, label, description]) => (
              <label className="check-row" key={key}>
                <input
                  type="checkbox"
                  checked={scopes[key]}
                  disabled={busy || !status || !enabled}
                  onChange={(event) =>
                    setScopes({ ...scopes, [key]: event.target.checked })
                  }
                />
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
              </label>
            ))}
          </div>
          <div className="agent-fields delegation-limits">
            <label>
              Expiry <span className="muted">(optional)</span>
              <input
                type="datetime-local"
                value={expiresAt}
                disabled={busy || !status || !enabled}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
              <small>Leave blank until you revoke it.</small>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={createdBeforeGrant}
                disabled={busy || !status || !enabled}
                onChange={(event) =>
                  setCreatedBeforeGrant(event.target.checked)
                }
              />
              <span>
                <strong>Only tickets created before this grant</strong>
                <small>Newer tickets still need your direct approval.</small>
              </span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={approvedGoalsOnly}
                disabled={busy || !status || !enabled}
                onChange={(event) => setApprovedGoalsOnly(event.target.checked)}
              />
              <span>
                <strong>Only under goals I approved</strong>
                <small>
                  Standalone tickets and unapproved goal trees stay human-only.
                </small>
              </span>
            </label>
          </div>
          <button className="button primary" disabled={busy || !status}>
            {enabled ? "Save chat delegation" : "Keep chat delegation off"}
          </button>
          {grant?.enabled && (
            <small className="muted">
              Granted by {grant.grantedBy.name}{" "}
              {grant.expiresAt
                ? `until ${new Date(grant.expiresAt).toLocaleString()}`
                : "until revoked"}
              .
            </small>
          )}
        </form>
      )}
    </section>
  );
}

export function DelegationDigest({
  status,
  onOpen,
  onUndo,
  isTicketTarget,
}: {
  status?: DelegationStatus;
  onOpen: (id: string) => void;
  onUndo: (id: string, revision: string) => Promise<void>;
  isTicketTarget: (id: string) => boolean;
}) {
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // A fresh receipt snapshot supersedes old optimistic or stale-revision errors.
  useEffect(() => setErrors({}), [status?.revision]);
  const receipts = status?.receipts.filter((receipt) => !receipt.undoOf) ?? [];
  if (!receipts.length) return null;
  return (
    <section className="delegation-digest" aria-label="Done on your behalf">
      <h2>Done on your behalf</h2>
      <p>
        These are actions your named chat orchestrator recorded using a grant
        you gave on this Mac. Check the quoted basis and undo any action that
        does not reflect your decision.
      </p>
      <div className="delegation-receipts">
        {receipts.map((receipt) => {
          const undone = !!receipt.undoneAt;
          return (
            <article key={receipt.id} className="delegation-receipt">
              <header>
                <strong>
                  {actionLabels[receipt.action] ?? receipt.action}
                </strong>
                <span className={`tag${undone ? "" : " green"}`}>
                  {undone ? "Undone" : "Recorded"}
                </span>
              </header>
              <p>
                {receipt.actor.name} recorded this through a chat decision by{" "}
                {receipt.grantingHuman.name} ·{" "}
                {new Date(receipt.at).toLocaleString()}
              </p>
              <blockquote>
                <strong>
                  Chat basis · {new Date(receipt.basis.saidAt).toLocaleString()}
                </strong>
                <br />
                {receipt.basis.quote}
              </blockquote>
              <div className="delegation-targets">
                {receipt.targets
                  .filter(
                    (target) =>
                      target.kind === "record" && isTicketTarget(target.id),
                  )
                  .map((target) => (
                    <button
                      className="text-button"
                      key={target.id}
                      onClick={() => onOpen(target.id)}
                    >
                      Open {target.title || target.id}
                    </button>
                  ))}
              </div>
              {undone ? (
                <small>
                  Undone by {receipt.undoneBy?.name || "a human"} at{" "}
                  {new Date(receipt.undoneAt!).toLocaleString()}.
                </small>
              ) : (
                <button
                  className="button subtle small"
                  disabled={!!busy}
                  onClick={() => {
                    setBusy(receipt.id);
                    setErrors((current) => {
                      const next = { ...current };
                      delete next[receipt.id];
                      return next;
                    });
                    void onUndo(receipt.id, receipt.revision)
                      .catch((error) =>
                        setErrors((current) => ({
                          ...current,
                          [receipt.id]:
                            error instanceof Error
                              ? error.message
                              : String(error),
                        })),
                      )
                      .finally(() => setBusy(""));
                  }}
                >
                  {busy === receipt.id ? "Undoing…" : "Undo"}
                </button>
              )}
              {errors[receipt.id] && (
                <p className="banner error" role="alert">
                  {errors[receipt.id]}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
