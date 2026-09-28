import { Menu } from "./Menu";
type Command = { label: string; run: () => void; disabled?: boolean };
// These use the same handlers as the ordinary controls. CSS reveals this
// optional menu strip only in desktop-OS presets; other themes keep their UI.
export function WindowMenu({
  file,
  view,
}: {
  file: Command[];
  view?: Command[];
}) {
  return (
    <nav className="retro-window-menu" aria-label="Window menu">
      {[
        { label: "File", commands: file },
        { label: "View", commands: view },
      ]
        .filter((group) => group.commands?.length)
        .map((group) => (
          <Menu
            key={group.label}
            label={group.label}
            ariaLabel={`Window ${group.label.toLowerCase()} menu`}
            escapeClipping
          >
            {(close) =>
              group.commands!.map((command) => (
                <button
                  key={command.label}
                  disabled={command.disabled}
                  onClick={() => {
                    close();
                    command.run();
                  }}
                >
                  {command.label}
                </button>
              ))
            }
          </Menu>
        ))}
    </nav>
  );
}
