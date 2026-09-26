import type { Kind } from "../src/types";
import {
  BookIcon,
  ChartIcon,
  DecisionIcon,
  GitBranchIcon,
  ImageIcon,
  InboxIcon,
  KebabIcon,
  PlusIcon,
  ProjectIcon,
  Logo,
  QuestionIcon,
} from "./Icons";
import { Menu } from "./Menu";

export type Page =
  | "project"
  | "attention"
  | "decisions"
  | "rulebook"
  | "screenshots"
  | "insights"
  | "imports"
  | "settings";
export const pages: Page[] = [
  "project",
  "attention",
  "decisions",
  "rulebook",
  "screenshots",
  "insights",
  "imports",
  "settings",
];
export type Theme = "system" | "light" | "dark";
export const themes: Theme[] = ["system", "light", "dark"];
const tabs: [Page, string, () => React.JSX.Element][] = [
  ["project", "Project", ProjectIcon],
  ["attention", "Needs you", InboxIcon],
  ["decisions", "Decisions", DecisionIcon],
  ["rulebook", "Rulebook", BookIcon],
  ["screenshots", "Screenshots", ImageIcon],
  ["insights", "Insights", ChartIcon],
];

export function TopNav({
  name,
  branch,
  page,
  attentionCount,
  density,
  theme,
  setPage,
  setDensity,
  setTheme,
  onCreate,
  onUpload,
  onShortcuts,
}: {
  name: string;
  branch: string;
  page: Page;
  attentionCount: number;
  density: string;
  theme: Theme;
  setPage: (page: Page) => void;
  setDensity: (density: string) => void;
  setTheme: (theme: Theme) => void;
  onCreate: (kind: Kind) => void;
  onUpload: (file: File) => void;
  onShortcuts: () => void;
}) {
  const kind: Kind =
    page === "decisions" ? "decision" : page === "rulebook" ? "rule" : "ticket";
  return (
    <header className="topnav">
      <div className="topnav-row">
        <span className="brand" aria-label="Control Room">
          <span className="brandmark">
            <Logo />
          </span>
          <span className="brand-word">Control Room</span>
        </span>
        <span className="crumb-sep" aria-hidden>
          /
        </span>
        <strong className="project-name">{name}</strong>
        <span className="branch-chip" title="Canonical checkout branch">
          <GitBranchIcon />
          {branch}
        </span>
        <span className="spacer" />
        <button
          className="icon-button"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          onClick={onShortcuts}
        >
          <QuestionIcon />
        </button>
        <button className="button primary" onClick={() => onCreate(kind)}>
          <PlusIcon />
          New {kind}
        </button>
        <Menu
          label={<KebabIcon />}
          ariaLabel="More actions"
          className="icon-button"
          align="end"
        >
          {(close) => (
            <div className="menu-list">
              <label className="menu-file">
                Add screenshot…
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    close();
                    if (file) onUpload(file);
                  }}
                />
              </label>
              <button
                onClick={() => {
                  close();
                  setPage("imports");
                }}
              >
                Import project knowledge
              </button>
              <button
                onClick={() => {
                  close();
                  setPage("settings");
                }}
              >
                Settings & backups
              </button>
              <label className="menu-field">
                Theme
                <select
                  aria-label="Color theme"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as Theme)}
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <label className="menu-field">
                Density
                <select
                  aria-label="Interface density"
                  value={density}
                  onChange={(e) => setDensity(e.target.value)}
                >
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </select>
              </label>
            </div>
          )}
        </Menu>
      </div>
      <nav className="page-tabs" aria-label="Main navigation">
        {tabs.map(([p, title, Icon]) => (
          <button
            key={p}
            aria-current={page === p ? "page" : undefined}
            onClick={() => setPage(p)}
          >
            <Icon />
            {title}
            {p === "attention" && attentionCount > 0 && (
              <span className="count attention">{attentionCount}</span>
            )}
          </button>
        ))}
      </nav>
    </header>
  );
}
