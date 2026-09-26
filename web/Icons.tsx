import type { Column } from "../src/types";

// Small 16px line icons in the style of GitHub's Octicons. They inherit
// `currentColor`, so buttons and tabs color them with their text.
const Svg = ({
  children,
  className = "icon",
  size = 16,
}: {
  children: React.ReactNode;
  className?: string;
  size?: number;
}) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const SearchIcon = () => (
  <Svg>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </Svg>
);
export const PlusIcon = () => (
  <Svg>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);
export const CloseIcon = () => (
  <Svg>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Svg>
);
export const KebabIcon = () => (
  <Svg>
    <circle cx="3" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="13" cy="8" r="1" fill="currentColor" stroke="none" />
  </Svg>
);
export const ChevronDownIcon = () => (
  <Svg>
    <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
  </Svg>
);
export const ChevronRightIcon = () => (
  <Svg>
    <path d="m6.5 4.5 3.5 3.5-3.5 3.5" />
  </Svg>
);
export const ArrowUpIcon = () => (
  <Svg>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Svg>
);
export const TableIcon = () => (
  <Svg>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M2 7h12M6 7v6" />
  </Svg>
);
export const BoardIcon = () => (
  <Svg>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M6 2.5v11M10 2.5v11" />
  </Svg>
);
export const ProjectIcon = () => (
  <Svg>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M5.5 5.5v5M8 5.5v3M10.5 5.5v6" />
  </Svg>
);
export const InboxIcon = () => (
  <Svg>
    <path d="M2.5 9.5 4 3.5h8l1.5 6v3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
    <path d="M2.5 9.5H6l.8 1.5h2.4l.8-1.5h3.5" />
  </Svg>
);
export const DecisionIcon = () => (
  <Svg>
    <path d="M8 2 14 8l-6 6-6-6z" />
    <path d="m6 8 1.5 1.5L10 6.5" />
  </Svg>
);
export const BookIcon = () => (
  <Svg>
    <path d="M2.5 3.5A1 1 0 0 1 3.5 2.5H7a1 1 0 0 1 1 1v10a1 1 0 0 0-1-1H3.5a1 1 0 0 1-1-1zM13.5 3.5a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v10a1 1 0 0 1 1-1h3.5a1 1 0 0 0 1-1z" />
  </Svg>
);
export const ImageIcon = () => (
  <Svg>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="m2.5 11 3.5-3.5 3 3 2-2 2.5 2.5" />
    <circle cx="10.5" cy="6" r="1" fill="currentColor" stroke="none" />
  </Svg>
);
export const GitBranchIcon = () => (
  <Svg>
    <circle cx="4" cy="3.5" r="1.5" />
    <circle cx="4" cy="12.5" r="1.5" />
    <circle cx="12" cy="5" r="1.5" />
    <path d="M4 5v6M12 6.5c0 2.5-3 2.5-8 4" />
  </Svg>
);
export const SlidersIcon = () => (
  <Svg>
    <path d="M2 4.5h6M11 4.5h3M2 11.5h3M8 11.5h6" />
    <circle cx="9.5" cy="4.5" r="1.5" />
    <circle cx="6.5" cy="11.5" r="1.5" />
  </Svg>
);
export const QuestionIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="6" />
    <path d="M6 6.3a2 2 0 1 1 2.8 1.9c-.5.2-.8.6-.8 1.1v.2" />
    <circle cx="8" cy="11.5" r=".6" fill="currentColor" stroke="none" />
  </Svg>
);
export const BlockedIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="6" />
    <path d="m3.8 3.8 8.4 8.4" />
  </Svg>
);
export const CommentIcon = () => (
  <Svg>
    <path d="M2.5 3.5A1 1 0 0 1 3.5 2.5h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5V10.5h-.5a1 1 0 0 1-1-1z" />
  </Svg>
);
export const CheckIcon = () => (
  <Svg>
    <path d="m3 8.5 3 3 7-7" />
  </Svg>
);
export const ChartIcon = () => (
  <Svg>
    <path d="M2.5 13.5h11" />
    <path d="M4 11V7M7.5 11V3.5M11 11V8.5" strokeWidth="2" />
  </Svg>
);

// Status icon in the spirit of GitHub's issue states: an open circle for
// queued work, a half disc while in progress, a dot ring for review, and a
// filled check when done. Colored by the surrounding `data-stage`.
export function StageIcon({
  role,
  size = 14,
}: {
  role?: Column["role"];
  size?: number;
}) {
  return (
    <svg
      className="stage-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      {role === "done" ? (
        <>
          <circle cx="8" cy="8" r="7" fill="var(--signal)" />
          <path
            d="m4.8 8.4 2.2 2.2 4.2-4.6"
            fill="none"
            stroke="#fff"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <circle
            cx="8"
            cy="8"
            r="6.25"
            fill="var(--signal-soft, transparent)"
            stroke="var(--signal)"
            strokeWidth="1.5"
          />
          {role === "progress" && (
            <path d="M8 1.75a6.25 6.25 0 0 0 0 12.5z" fill="var(--signal)" />
          )}
          {role === "review" && (
            <circle cx="8" cy="8" r="2.5" fill="var(--signal)" />
          )}
        </>
      )}
    </svg>
  );
}

// A stable hue per label so the same label looks the same everywhere.
export function labelHue(label: string) {
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}
export const Label = ({ name }: { name: string }) => (
  <span
    className="tag"
    style={{ "--hue": labelHue(name) } as React.CSSProperties}
  >
    {name}
  </span>
);

// Brand mark: a sector map, after the circular reactor scheme of a control
// room. Rings and radial divisions, with one sector live.
export const Logo = ({ size = 26 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    aria-hidden="true"
  >
    <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="2" />
    <circle
      cx="16"
      cy="16"
      r="7"
      stroke="currentColor"
      strokeWidth="1.5"
      opacity=".6"
    />
    <path
      d="M23.00 16.00L29.00 16.00 M20.95 11.05L25.19 6.81 M16.00 9.00L16.00 3.00 M11.05 11.05L6.81 6.81 M9.00 16.00L3.00 16.00 M11.05 20.95L6.81 25.19 M16.00 23.00L16.00 29.00 M20.95 20.95L25.19 25.19"
      stroke="currentColor"
      strokeWidth="1.5"
      opacity=".5"
    />
    <path
      d="M16 3A13 13 0 0 1 25.19 6.81L20.95 11.05A7 7 0 0 0 16 9Z"
      fill="var(--cyan)"
    />
    <circle cx="16" cy="16" r="2" fill="currentColor" />
  </svg>
);
