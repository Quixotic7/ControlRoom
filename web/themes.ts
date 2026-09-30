export const themeNames = {
  system: "System",
  light: "Light",
  dark: "Dark",
  win95: "Windows 95",
  win31: "Windows 3.1",
  c64: "Commodore 64",
  mac7: "Classic Mac System 7",
  amiga: "AmigaOS",
  nes: "NES",
  snes: "SNES",
  synthwave: "Synthwave",
  elektron: "Elektron",
  gameboy: "Game Boy",
} as const;
export type Theme = keyof typeof themeNames;
type PresetTheme = Exclude<Theme, "system" | "light" | "dark">;
type Preset = {
  bg: string;
  surface: string;
  inset: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  cyan: string;
  success: string;
  attention: string;
  danger: string;
  purple: string;
  light: boolean;
  radius: string;
  font: string;
  displayFont?: string;
  edge?: string;
  description: string;
};
const pixel = '"Pixelify Sans", monospace',
  chunky = '"Silkscreen", "Pixelify Sans", monospace';
export const presets: Record<PresetTheme, Preset> = {
  win95: {
    bg: "#008080",
    surface: "#c0c0c0",
    inset: "#dfdfdf",
    ink: "#101010",
    muted: "#444444",
    line: "#606060",
    accent: "#000080",
    cyan: "#005858",
    success: "#075918",
    attention: "#6b4100",
    danger: "#9c001b",
    purple: "#660066",
    light: true,
    radius: "0px",
    font: pixel,
    edge: "inset 1px 1px #fff, inset -1px -1px #555",
    description: "Teal desktop, navy focus and raised silver controls.",
  },
  win31: {
    bg: "#777777",
    surface: "#eeeeee",
    inset: "#cccccc",
    ink: "#080808",
    muted: "#444444",
    line: "#080808",
    accent: "#0000a0",
    cyan: "#006060",
    success: "#005000",
    attention: "#704000",
    danger: "#aa0020",
    purple: "#710071",
    light: true,
    radius: "0px",
    font: pixel,
    edge: "1px 1px 0 #000",
    description: "Crisp window frames and early desktop typography.",
  },
  c64: {
    bg: "#191443",
    surface: "#514693",
    inset: "#40367c",
    ink: "#fffdeb",
    muted: "#e1dbff",
    line: "#ada4db",
    accent: "#f2ed9c",
    cyan: "#aff1ff",
    success: "#b8eea6",
    attention: "#f2ed9c",
    danger: "#ffc4cc",
    purple: "#ecc5ff",
    light: false,
    radius: "0px",
    font: pixel,
    displayFont: chunky,
    edge: "inset 2px 2px #aba0ed, inset -2px -2px #241d60",
    description:
      "Lavender tracker panels, ivory pixel type, silver rails and yellow readouts.",
  },
  mac7: {
    bg: "#aaaaaa",
    surface: "#eeeeee",
    inset: "#dddddd",
    ink: "#111111",
    muted: "#444444",
    line: "#222222",
    accent: "#292929",
    cyan: "#006464",
    success: "#165e23",
    attention: "#744300",
    danger: "#a41928",
    purple: "#673494",
    light: true,
    radius: "3px",
    font: pixel,
    edge: "2px 2px 0 #222",
    description: "Monochrome windows, compact type and crisp outlines.",
  },
  amiga: {
    bg: "#204980",
    surface: "#e0e3e6",
    inset: "#c0c8d1",
    ink: "#102038",
    muted: "#35485c",
    line: "#3c4c68",
    accent: "#174a96",
    cyan: "#00645d",
    success: "#125c24",
    attention: "#8b3c00",
    danger: "#a4172c",
    purple: "#643299",
    light: true,
    radius: "0px",
    font: pixel,
    edge: "inset 1px 1px #fff, inset -1px -1px #526070",
    description: "Workbench blue with orange signals and beveled panels.",
  },
  nes: {
    bg: "#17191c",
    surface: "#30343a",
    inset: "#42464f",
    ink: "#f4f0e9",
    muted: "#c3c4c9",
    line: "#8b9098",
    accent: "#ffadb4",
    cyan: "#8ae3e0",
    success: "#abe59d",
    attention: "#ffcf8e",
    danger: "#ffadb4",
    purple: "#d8b9ff",
    light: false,
    radius: "0px",
    font: pixel,
    displayFont: chunky,
    description: "Graphite cartridges, blocky edges and red controls.",
  },
  snes: {
    bg: "#163d86",
    surface: "#e7e4cd",
    inset: "#d0d0b9",
    ink: "#182319",
    muted: "#424f3c",
    line: "#465464",
    accent: "#235619",
    cyan: "#205070",
    success: "#235619",
    attention: "#714412",
    danger: "#902d24",
    purple: "#583e7d",
    light: true,
    radius: "0px",
    font: pixel,
    displayFont: chunky,
    description:
      "16-bit city-builder: ocean-blue grid, stone tool panels, green menus and cream message boxes.",
    edge: "inset 2px 2px #ffffe8, inset -2px -2px #656d70, 2px 2px 0 #101b33",
  },
  synthwave: {
    bg: "#150422",
    surface: "#220832",
    inset: "#320d45",
    ink: "#fff0fc",
    muted: "#d9b0e4",
    line: "#924092",
    accent: "#ff79ea",
    cyan: "#75e7ff",
    success: "#9af2c5",
    attention: "#ffc486",
    danger: "#ffb4cd",
    purple: "#d3acff",
    light: false,
    radius: "10px",
    font: '"Rajdhani", sans-serif',
    edge: "inset 0 0 0 1px #bc27876b, 0 0 16px #ec22dc26",
    description:
      "Neon-magenta controls, midnight-purple panels and a cyan horizon grid.",
  },
  elektron: {
    bg: "#111210",
    surface: "#1c2014",
    inset: "#10140b",
    ink: "#edf786",
    muted: "#bdcd71",
    line: "#697630",
    accent: "#e4f329",
    cyan: "#a5b8ff",
    success: "#a9ed85",
    attention: "#e4f329",
    danger: "#ffb58f",
    purple: "#c2b8f1",
    light: false,
    radius: "2px",
    font: pixel,
    displayFont: chunky,
    description:
      "Digitakt-inspired charcoal hardware, acid-yellow LCD lettering and blue-gray keys.",
    edge: "inset 0 1px #667034, 0 3px 0 #080b05",
  },
  gameboy: {
    bg: "#65964a",
    surface: "#d7dda4",
    inset: "#b9cf88",
    ink: "#303517",
    muted: "#4e5129",
    line: "#556329",
    accent: "#3c5924",
    cyan: "#30523d",
    success: "#3c5924",
    attention: "#645018",
    danger: "#734125",
    purple: "#564323",
    light: true,
    radius: "0px",
    font: pixel,
    displayFont: chunky,
    edge: "inset 2px 2px #edf1be, inset -2px -2px #7c9845, 3px 3px 0 #4a421f",
    description:
      "Four-tone adventure palette: pale grass, moss green, brown pixel outlines and stepped frames.",
  },
};

type ThemePreview = Pick<
  Preset,
  | "bg"
  | "surface"
  | "ink"
  | "line"
  | "accent"
  | "cyan"
  | "success"
  | "radius"
  | "font"
  | "description"
>;

// This is the single source for the theme picker. `presets` only contains
// themes that override the shared CSS tokens, while these entries make the
// three built-in CSS themes equally visible and selectable in the picker.
const builtInPreviews: Record<"system" | "light" | "dark", ThemePreview> = {
  system: {
    bg: "#0a0b0d",
    surface: "linear-gradient(135deg, #ffffff 0 50%, #131518 50%)",
    ink: "#d9dcdd",
    line: "#8b9197",
    accent: "#4c9aff",
    cyan: "#35cfc6",
    success: "#6fd08a",
    radius: "4px",
    font: '"Rajdhani", sans-serif',
    description: "Follows your operating system's light or dark appearance.",
  },
  light: {
    bg: "#f4f4f2",
    surface: "#ffffff",
    ink: "#1b1d1f",
    line: "#cfd2d1",
    accent: "#2b6fd6",
    cyan: "#178f87",
    success: "#1f8a3c",
    radius: "4px",
    font: '"Rajdhani", sans-serif',
    description: "Bright neutral surfaces with blue, cyan and green signals.",
  },
  dark: {
    bg: "#0a0b0d",
    surface: "#131518",
    ink: "#d9dcdd",
    line: "#2a2e33",
    accent: "#4c9aff",
    cyan: "#35cfc6",
    success: "#6fd08a",
    radius: "4px",
    font: '"Rajdhani", sans-serif',
    description: "Near-black surfaces with blue, cyan and green signals.",
  },
};

export const themePreviews: Record<Theme, ThemePreview> = {
  ...builtInPreviews,
  ...presets,
};

// Both the select and preview buttons derive their options from this registry.
export const themes = Object.keys(themePreviews) as Theme[];

export function tokens(p: Preset): Record<string, string> {
  const soft = (c: string) => c + "20";
  return {
    "--bg": p.bg,
    "--surface": p.surface,
    "--subtle": p.inset,
    "--lane": p.surface,
    "--inset": p.inset,
    "--hover": p.inset,
    "--ink": p.ink,
    "--muted": p.muted,
    "--faint": p.muted,
    "--line": p.line,
    "--line-soft": p.line,
    "--accent": p.accent,
    "--accent-ink": p.accent,
    "--accent-soft": soft(p.accent),
    "--accent-ring": p.accent + "80",
    "--cyan": p.cyan,
    "--cyan-soft": soft(p.cyan),
    "--success": p.success,
    "--success-soft": soft(p.success),
    "--attention": p.attention,
    "--attention-soft": soft(p.attention),
    "--danger": p.danger,
    "--danger-soft": soft(p.danger),
    "--purple": p.purple,
    "--purple-soft": soft(p.purple),
    "--neutral-soft": soft(p.ink),
    "--btn-bg": p.surface,
    "--btn-hover": p.inset,
    "--btn-primary": p.accent,
    "--btn-primary-hover": p.accent,
    "--btn-primary-ink": p.light ? "#ffffff" : "#111111",
    "--grid": `radial-gradient(${p.ink}20 1px, transparent 1px)`,
    "--grid-size": p.light ? "8px" : "20px",
    "--shadow-sm": p.edge ?? "0 1px 3px #0005",
    "--shadow-md": "0 8px 24px #0005",
    "--shadow-lg": "0 24px 64px #0008",
    "--glow": `0 0 0 2px ${p.accent}`,
    "--backdrop": "#101018b3",
    "--radius": p.radius,
    "--body": p.font,
    "--display": p.displayFont ?? p.font,
    "--theme-edge": p.edge ?? "none",
    "color-scheme": p.light ? "light" : "dark",
  };
}
let applied: string[] = [];
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const key of applied) root.style.removeProperty(key);
  applied = [];
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  const p = theme in presets ? presets[theme as PresetTheme] : undefined;
  if (p) root.dataset.preset = "true";
  else delete root.dataset.preset;
  if (p && theme !== "synthwave") root.dataset.pixel = "true";
  else delete root.dataset.pixel;
  if (["win95", "win31", "c64", "mac7", "amiga"].includes(theme))
    root.dataset.windowChrome = theme;
  else delete root.dataset.windowChrome;
  if (p)
    for (const [key, value] of Object.entries(tokens(p))) {
      root.style.setProperty(key, value);
      applied.push(key);
    }
}
