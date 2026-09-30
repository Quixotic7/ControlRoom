import { useMemo, useRef, useState } from "react";
import { copyText } from "./browserUtils";
import { CheckIcon, SearchIcon } from "./Icons";
import { PageHeader } from "./Pages";
import {
  playbookGroups,
  playbookRecipes,
  type PlaybookContext,
} from "./playbookContent";

function publicTicketNumber(value: string) {
  return /^\d+$/.test(value.trim()) ? value.trim() : "TICKET_NUMBER";
}

export function Playbook({
  project,
  branch,
}: {
  project: string;
  branch: string;
}) {
  const [search, setSearch] = useState("");
  const [ticketNumber, setTicketNumber] = useState("");
  const [useCurrentProject, setUseCurrentProject] = useState(true);
  const [copied, setCopied] = useState("");
  const [copyError, setCopyError] = useState("");
  const prompts = useRef(new Map<string, HTMLTextAreaElement>());
  const ticket = publicTicketNumber(ticketNumber);
  const context: PlaybookContext = {
    project,
    branch,
    ticket,
    useCurrentProject,
  };
  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return playbookRecipes.filter(
      (recipe) =>
        !query ||
        `${recipe.group} ${recipe.title} ${recipe.purpose} ${recipe.prerequisites} ${recipe.prompt(context)}`
          .toLowerCase()
          .includes(query),
    );
  }, [search, project, branch, ticket, useCurrentProject]);

  async function copy(recipeId: string, prompt: string) {
    setCopyError("");
    try {
      await copyText(prompt);
      setCopied(recipeId);
    } catch {
      const field = prompts.current.get(recipeId);
      field?.focus();
      field?.select();
      setCopied("");
      setCopyError(
        "Copy is unavailable here. The prompt is selected; copy it manually.",
      );
    }
  }

  return (
    <>
      <PageHeader
        title="Help & playbook"
        description="Short, safe prompts for your existing coding agent. Copying only copies text—you choose where to paste or run it."
      />
      <section className="playbook-intro" aria-label="Playbook context">
        <div>
          <strong>Current context</strong>
          <span>
            {useCurrentProject
              ? `${project} · ${branch}`
              : "Reusable template · PROJECT_NAME / PROJECT_BRANCH"}
          </span>
        </div>
        <label className="playbook-ticket">
          Project context
          <select
            aria-label="Project context"
            value={useCurrentProject ? "current" : "template"}
            onChange={(event) =>
              setUseCurrentProject(event.target.value === "current")
            }
          >
            <option value="current">Use this project</option>
            <option value="template">Reusable project template</option>
          </select>
        </label>
        <label className="playbook-ticket">
          Ticket number <span className="muted">(optional)</span>
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            aria-describedby="ticket-number-help"
            placeholder="e.g. 26"
            value={ticketNumber}
            onChange={(event) =>
              setTicketNumber(event.target.value.replace(/\D/g, ""))
            }
          />
        </label>
        <small id="ticket-number-help">
          Ticket recipes use public numeric commands; without a number they show
          the <code>TICKET_NUMBER</code> placeholder.
        </small>
      </section>
      <div className="filter-bar">
        <label className="filter-input">
          <span aria-hidden>
            <SearchIcon />
          </span>
          <input
            aria-label="Search playbook recipes"
            placeholder="Search prompts, tasks, or guidance…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <p className="playbook-safety">
        Recipes are available offline and never include local tokens or hidden
        secrets. They do not claim work, start an agent, or change a ticket on
        copy. Short commands are conventions you teach an agent; arbitrary chat
        tools do not recognize them automatically.
      </p>
      <p className="sr-only" aria-live="polite">
        {copied ? "Prompt copied successfully." : copyError}
      </p>
      {playbookGroups.map((group) => {
        const recipes = shown.filter((recipe) => recipe.group === group.label);
        if (!recipes.length) return null;
        return (
          <section
            className="playbook-group"
            key={group.id}
            aria-labelledby={`playbook-${group.id}`}
          >
            <h2 id={`playbook-${group.id}`}>{group.label}</h2>
            <div className="playbook-grid">
              {recipes.map((recipe) => {
                const prompt = recipe.prompt(context);
                return (
                  <article className="playbook-card" key={recipe.id}>
                    <h3>{recipe.title}</h3>
                    <dl>
                      <div>
                        <dt>Purpose</dt>
                        <dd>{recipe.purpose}</dd>
                      </div>
                      <div>
                        <dt>Before you copy</dt>
                        <dd>{recipe.prerequisites}</dd>
                      </div>
                    </dl>
                    {recipe.needsTicket && ticket === "TICKET_NUMBER" && (
                      <p className="playbook-placeholder">
                        Add a ticket number above to personalize this prompt.
                      </p>
                    )}
                    <label className="playbook-prompt">
                      <span>Prompt to copy</span>
                      <textarea
                        ref={(element) => {
                          if (element) prompts.current.set(recipe.id, element);
                          else prompts.current.delete(recipe.id);
                        }}
                        readOnly
                        value={prompt}
                        aria-label={`${recipe.title} prompt`}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                    </label>
                    <button
                      className="button"
                      onClick={() => void copy(recipe.id, prompt)}
                    >
                      {copied === recipe.id ? (
                        <>
                          <CheckIcon /> Copied
                        </>
                      ) : (
                        "Copy prompt"
                      )}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      {!shown.length && (
        <div className="empty-state">
          <h2>No matching recipes</h2>
          <p>
            Try a broader search, such as “review”, “ticket”, or “screenshot”.
          </p>
        </div>
      )}
      {copyError && (
        <div className="playbook-copy-fallback" role="status">
          {copyError}
        </div>
      )}
    </>
  );
}
