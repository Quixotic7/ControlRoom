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

const shortCommandList = `Codex: $crrefresh — refresh the board
Claude Code: /crrefresh — refresh the board
Codex: $crnext — inspect the next eligible approved ticket
Claude Code: /crnext — inspect the next eligible approved ticket
Codex: $ccrefresh — crrefresh compatibility alias
Claude Code: /ccrefresh — crrefresh compatibility alias`;

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
  const [copyFallbackId, setCopyFallbackId] = useState("");
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
    setCopyFallbackId("");
    try {
      await copyText(prompt);
      setCopied(recipeId);
    } catch {
      const field = prompts.current.get(recipeId);
      field?.focus();
      field?.select();
      setCopied("");
      setCopyFallbackId(recipeId);
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
      <section
        className="playbook-short-commands"
        aria-labelledby="playbook-short-commands"
      >
        <div>
          <h2 id="playbook-short-commands">Short command skills</h2>
          <p>
            Install the bundled skills in the checkout where the agent runs
            first. The <strong>Install short command skills</strong> recipe
            below has the setup command.
          </p>
        </div>
        <dl>
          <div>
            <dt>Refresh board</dt>
            <dd>
              <code>Codex: $crrefresh</code>
              <code>Claude Code: /crrefresh</code>
            </dd>
          </div>
          <div>
            <dt>Next approved ticket</dt>
            <dd>
              <code>Codex: $crnext</code>
              <code>Claude Code: /crnext</code>
            </dd>
          </div>
          <div>
            <dt>Refresh compatibility alias</dt>
            <dd>
              <code>Codex: $ccrefresh</code>
              <code>Claude Code: /ccrefresh</code>
            </dd>
          </div>
        </dl>
        <p className="playbook-command-note">
          In Codex, select a skill or type <code>$name</code>; these are not
          slash commands. In Claude Code, type <code>/name</code>.
        </p>
        <label className="sr-only" htmlFor="playbook-short-command-list">
          Short command list
        </label>
        <textarea
          ref={(element) => {
            if (element) prompts.current.set("short-command-list", element);
            else prompts.current.delete("short-command-list");
          }}
          className={`playbook-command-copy${
            copyFallbackId === "short-command-list" ? " is-visible" : ""
          }`}
          id="playbook-short-command-list"
          readOnly
          value={shortCommandList}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          className="button playbook-command-copy-button"
          onClick={() => void copy("short-command-list", shortCommandList)}
        >
          {copied === "short-command-list" ? (
            <>
              <CheckIcon /> Copied
            </>
          ) : (
            "Copy command list"
          )}
        </button>
      </section>
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
