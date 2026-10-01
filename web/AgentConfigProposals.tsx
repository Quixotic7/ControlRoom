import type { AgentConfigProposal } from "../src/agent-config-proposals";
import type { OrchestrationConfig } from "../src/orchestration-types";

export function AgentConfigProposals({
  proposals,
  errors,
  config,
  workerBrief,
  revision,
  busy,
  onApply,
  onDiscard,
}: {
  proposals: AgentConfigProposal[];
  errors: { path: string; message: string }[];
  config: OrchestrationConfig;
  workerBrief: string;
  revision: string;
  busy: boolean;
  onApply: (proposal: AgentConfigProposal) => void;
  onDiscard: (proposal: AgentConfigProposal) => void;
}) {
  const pending = proposals.filter((p) => p.status === "pending");
  if (!pending.length && !errors.length) return null;
  return (
    <section
      className="agent-config-proposals"
      aria-label="Proposed agent configurations"
    >
      <h2>Proposed agent configurations</h2>
      <p>
        Proposals do not change permissions or start agents. Review every change
        before applying. Applying replaces the saved configuration and the
        configuration form below.
      </p>
      {errors.map((error) => (
        <p role="alert" className="banner error" key={error.path}>
          {error.path}: {error.message}
        </p>
      ))}
      {pending.map((proposal) => {
        const stale = proposal.baseRevision !== revision;
        const before = config as unknown as Record<string, unknown>,
          after = proposal.config as unknown as Record<string, unknown>;
        const fields = [
          ...new Set([...Object.keys(before), ...Object.keys(after)]),
        ]
          .filter(
            (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
          )
          .sort();
        return (
          <article className="agent-config-proposal" key={proposal.id}>
            <h3>Proposal by {proposal.proposedBy.name}</h3>
            <p>
              {proposal.proposedBy.kind} ·{" "}
              {new Date(proposal.createdAt).toLocaleString()} ·{" "}
              <code>{proposal.id}</code>
            </p>
            {stale && (
              <p role="status" className="banner error">
                This proposal is stale because the configuration changed.
                Request a fresh proposal before applying.
              </p>
            )}
            {fields.length ? (
              <div className="agent-proposal-diff">
                <table>
                  <caption>
                    Changes compared with the current configuration
                  </caption>
                  <thead>
                    <tr>
                      <th>Setting</th>
                      <th>Current</th>
                      <th>Proposed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((key) => (
                      <tr key={key}>
                        <th scope="row">{key}</th>
                        <td>
                          <pre>
                            {JSON.stringify(before[key], null, 2) ?? "Not set"}
                          </pre>
                        </td>
                        <td>
                          <pre>
                            {JSON.stringify(after[key], null, 2) ?? "Not set"}
                          </pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No configuration differences.</p>
            )}
            {proposal.workerBrief !== undefined && proposal.workerBrief !== workerBrief && <div className="agent-proposal-diff"><table><caption>Worker brief changes</caption><thead><tr><th>Current</th><th>Proposed</th></tr></thead><tbody><tr><td><pre>{workerBrief || "(empty)"}</pre></td><td><pre>{proposal.workerBrief || "(empty)"}</pre></td></tr></tbody></table></div>}
            <div className="inline-actions">
              <button
                className="button primary"
                disabled={busy || stale}
                onClick={() => onApply(proposal)}
              >
                Apply proposal
              </button>
              <button
                className="button subtle"
                disabled={busy}
                onClick={() => onDiscard(proposal)}
              >
                Discard proposal
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
