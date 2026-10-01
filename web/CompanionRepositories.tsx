import type { CompanionRepository } from "../src/orchestration-types";

export function CompanionRepositories({
  value,
  onChange,
}: {
  value: CompanionRepository[];
  onChange: (value: CompanionRepository[]) => void;
}) {
  const patch = (index: number, change: Partial<CompanionRepository>) =>
    onChange(
      value.map((repo, i) => (i === index ? { ...repo, ...change } : repo)),
    );
  return (
    <fieldset className="agent-companions">
      <legend>Companion repositories</legend>
      <p>
        Each run lays these out relative to its main checkout. Tickets
        explicitly list repository names to make writable; omitted companions
        stay read-only.
      </p>
      {value.map((repo, index) => (
        <div className="agent-fields" key={index}>
          <label>
            Name
            <input
              value={repo.name}
              onChange={(e) => patch(index, { name: e.target.value })}
            />
          </label>
          <label>
            Repository root
            <input
              value={repo.repository}
              onChange={(e) => patch(index, { repository: e.target.value })}
            />
          </label>
          <label>
            Base ref
            <input
              value={repo.baseRef}
              onChange={(e) => patch(index, { baseRef: e.target.value })}
            />
          </label>
          <label>
            Relative to main
            <input
              value={repo.relativePath}
              placeholder="../juicebox"
              onChange={(e) => patch(index, { relativePath: e.target.value })}
            />
          </label>
          <label>
            Maximum access
            <select
              value={repo.mode}
              onChange={(e) =>
                patch(index, {
                  mode: e.target.value as CompanionRepository["mode"],
                })
              }
            >
              <option value="writable">Writable when selected</option>
              <option value="read-only">Always read-only</option>
            </select>
          </label>
          <button
            className="button"
            type="button"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            Remove companion
          </button>
        </div>
      ))}
      <button
        className="button"
        type="button"
        onClick={() =>
          onChange([
            ...value,
            {
              name: "",
              repository: "",
              baseRef: "HEAD",
              relativePath: "../companion",
              mode: "read-only",
            },
          ])
        }
      >
        Add companion repository
      </button>
    </fieldset>
  );
}
