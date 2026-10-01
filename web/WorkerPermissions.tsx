import type {
  WorkerEnvironmentVariable,
  WorkerPermissions,
} from "../src/orchestration-types";

const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export function WorkerPermissionsEditor({
  value,
  workerBrief,
  onChange,
  onBriefChange,
}: {
  value: WorkerPermissions;
  workerBrief: string;
  onChange: (value: WorkerPermissions) => void;
  onBriefChange: (value: string) => void;
}) {
  const patchEnvironment = (
    index: number,
    patch: Partial<WorkerEnvironmentVariable>,
  ) =>
    onChange({
      ...value,
      environment: value.environment.map((entry, current) =>
        current === index ? { ...entry, ...patch } : entry,
      ),
    });
  return (
    <fieldset className="worker-permissions">
      <legend>Worker permissions and context</legend>
      <p>
        These project settings apply to managed workers and independent
        verification. Control Room does not install tools or edit provider
        configuration.
      </p>
      <label>
        Claude allowed tool patterns
        <textarea
          aria-label="Claude allowed tool patterns"
          rows={6}
          value={value.claudeAllowedTools.join("\n")}
          placeholder={
            "Bash(swift build:*)\nBash(git add:*)\nBash(git commit:*)"
          }
          onChange={(event) =>
            onChange({
              ...value,
              claudeAllowedTools: lines(event.target.value),
            })
          }
        />
        <small>
          One Claude <code>--allowedTools</code> pattern per line. These are
          passed only to Claude work runs and add grants; existing Claude
          settings and ambient permissions still apply, so this is not a
          complete restrictive allow-list. Codex has no equivalent per-run
          command allow-list flag: it keeps its workspace sandbox and any
          trusted ambient Codex rules. Control Room does not create or broaden
          those rules.
        </small>
        <small>
          For Bash, a trailing <code>:*</code> is the command-prefix form:{" "}
          <code>Bash(node:*)</code> matches <code>node</code> with or without
          arguments at a word boundary, while <code>Bash(node*)</code> can also
          match names such as <code>nodejs</code>. File rules use separate
          gitignore-style path patterns such as <code>Read(/path/**)</code>.
          Every part of a compound command such as <code>a &amp;&amp; b</code>{" "}
          must match independently. Invocation forms are distinct, so{" "}
          <code>Bash(git status:*)</code> does not cover{" "}
          <code>git -C /path status</code>; add the specific required form
          instead of a broad Git grant.
        </small>
      </label>
      <label>
        Additional writable directories
        <textarea
          aria-label="Additional writable directories"
          rows={4}
          value={value.additionalDirectories.join("\n")}
          placeholder="/absolute/path/to/evidence"
          onChange={(event) =>
            onChange({
              ...value,
              additionalDirectories: lines(event.target.value),
            })
          }
        />
        <small>
          One existing absolute directory per line. Provider{" "}
          <code>--add-dir</code>
          grants tool access there; these paths are writable for Codex
          workspace-write runs and are not a read-only boundary.
        </small>
      </label>
      <div className="environment-editor">
        <strong>Worker and verification environment</strong>
        <p>
          Use a host environment reference for secrets. Literal values are
          stored in project configuration and are best suited to paths and cache
          settings. Run details show names only.
        </p>
        {value.environment.map((entry, index) => (
          <div className="environment-row" key={index}>
            <label>
              Variable name
              <input
                value={entry.name}
                placeholder="SWIFT_MODULE_CACHE_PATH"
                onChange={(event) =>
                  patchEnvironment(index, { name: event.target.value })
                }
              />
            </label>
            <label>
              Value source
              <select
                value={entry.source}
                onChange={(event) =>
                  patchEnvironment(index, {
                    source: event.target.value as "literal" | "host",
                  })
                }
              >
                <option value="literal">Literal project value</option>
                <option value="host">Host environment reference</option>
              </select>
            </label>
            <label>
              {entry.source === "host" ? "Host variable name" : "Value"}
              <input
                value={entry.value}
                placeholder={
                  entry.source === "host" ? "ANTHROPIC_API_KEY" : "/tmp/cache"
                }
                onChange={(event) =>
                  patchEnvironment(index, { value: event.target.value })
                }
              />
            </label>
            <button
              className="button"
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  environment: value.environment.filter(
                    (_, current) => current !== index,
                  ),
                })
              }
            >
              Remove variable
            </button>
          </div>
        ))}
        <button
          className="button"
          type="button"
          onClick={() =>
            onChange({
              ...value,
              environment: [
                ...value.environment,
                { name: "", source: "literal", value: "" },
              ],
            })
          }
        >
          Add environment variable
        </button>
      </div>
      <label>
        Project worker brief
        <textarea
          aria-label="Project worker brief"
          rows={10}
          value={workerBrief}
          placeholder="Markdown guidance shared with every managed worker"
          onChange={(event) => onBriefChange(event.target.value)}
        />
        <small>
          Saved at <code>.controlroom/agents/worker-brief.md</code> and included
          in work-run freshness checks. It supplies working guidance and cannot
          expand ticket scope or process permissions.
        </small>
      </label>
    </fieldset>
  );
}
