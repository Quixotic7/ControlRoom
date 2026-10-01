import { useState } from "react";
import type { OrchestrationConfig } from "../src/orchestration-types";
import type { ProfileTest } from "../src/orchestration";
import { actor, api } from "./api";

export function ProfileSmokeTest({
  config,
  revision,
  latest,
  disabled,
  refresh,
}: {
  config: OrchestrationConfig;
  revision: string;
  latest?: ProfileTest;
  disabled: boolean;
  refresh: () => Promise<void>;
}) {
  const [selection, setSelection] = useState<{
    key: string;
    name: string;
    revision: string;
  }>();
  const [kind, setKind] = useState<"work" | "plan" | "review">("work");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const profiles = [
    ...(config.reviewerMode !== "chat"
      ? [{ key: "reviewer", profile: config.reviewer }]
      : []),
    ...config.workers.map((profile, i) => ({ key: `worker:${i}`, profile })),
  ].filter(({ profile }) => profile.provider === "claude");
  if (!profiles.length) return null;
  const running = busy || latest?.state === "running";
  return (
    <section className="agent-settings" aria-label="Native profile check">
      <h2>Test a Claude profile</h2>
      <p>
        Check CLI startup and structured output before delegating. Uses the
        saved executable and model in an empty workspace with tools, project
        instructions and customizations disabled. This does not test build
        permissions or complete a ticket.
      </p>
      {profiles.map(({ key, profile }) => (
        <div key={key} className="inline-actions">
          <span>
            {profile.name} · {profile.model || "CLI default model"}
          </span>
          <button
            className="button"
            disabled={disabled || running}
            aria-label={`Test this profile: ${profile.name}`}
            onClick={() => {
              setSelection({ key, name: profile.name, revision });
              setKind(key === "reviewer" ? "review" : "work");
              setConsent(false);
              setError("");
            }}
          >
            Test this profile
          </button>
        </div>
      ))}
      {disabled && (
        <p className="help">
          Save or discard configuration edits before testing a saved profile.
        </p>
      )}
      {selection && (
        <form
          aria-label="Confirm profile test"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!consent || running || disabled) return;
            setBusy(true);
            setError("");
            try {
              await api("/orchestration/profile-test", "POST", {
                actor,
                profile: selection.key,
                kind,
                revision: selection.revision,
                confirmUsage: true,
              });
              setSelection(undefined);
            } catch (e) {
              setError(
                `${String(e)} The request was not replayed. Check the latest result before starting another test.`,
              );
            } finally {
              setBusy(false);
              await refresh().catch((e) => setError(String(e)));
            }
          }}
        >
          <p>
            Test <strong>{selection.name}</strong> with the real managed
            response schema. Limited to five turns and two minutes.
          </p>
          <label className="field">
            Response schema
            <select
              aria-label="Profile test response schema"
              value={kind}
              disabled={running}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="work">Worker</option>
              <option value="plan">Planner</option>
              <option value="review">Reviewer</option>
            </select>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={consent}
              disabled={running}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I understand this test uses my provider quota and may incur a
            charge.
          </label>
          <div className="inline-actions">
            <button
              className="button primary"
              disabled={!consent || running || disabled}
            >
              Run profile test
            </button>
            <button
              className="button"
              type="button"
              disabled={running}
              onClick={() => setSelection(undefined)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {latest && (
        <p role="status">
          {latest.profile} · {latest.model || "CLI default model"} ·{" "}
          {latest.kind} ·{" "}
          {latest.state === "running"
            ? "Testing…"
            : latest.state === "passed"
              ? "Passed: structured result received and validated."
              : `Failed: ${latest.error}`}
          <small>
            {latest.revision !== revision
              ? " Saved settings changed since this test; test again to check the current profile."
              : " Last test in this service session."}
          </small>
        </p>
      )}
    </section>
  );
}
