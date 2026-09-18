// Theme color registry: the single catalog of color keys a theme may set.
//
// VSCode-style: themes assign values in their `colors` map; anything not in
// this catalog is ignored with a warning (a typo must never break a theme).
// Defaults come from the built-in dark theme so a partial theme still
// produces a complete, usable `colors` map for Monaco.

// --- Editor + Monaco workbench colors ---------------------------------------

/** Every `editor.*` / chrome color key Mini Code understands. */
export const MONACO_COLOR_KEYS = [
  "editor.background",
  "editor.foreground",
  "editorLineNumber.foreground",
  "editorLineNumber.activeForeground",
  "editorCursor.foreground",
  "editor.selectionBackground",
  "editor.selectionHighlightBackground",
  "editor.lineHighlightBackground",
  "editorGutter.background",
  "editorIndentGuide.background",
  "editorIndentGuide.activeBackground",
  "editorBracketMatch.background",
  "editorBracketMatch.border",
  "editorWidget.background",
  "editorWidget.border",
  "editorSuggestWidget.selectedBackground",
  "editorHoverWidget.background",
  "editorHoverWidget.border",
] as const;

export type MonacoColorKey = (typeof MONACO_COLOR_KEYS)[number];

// --- Terminal (xterm) colors -------------------------------------------------

export const TERMINAL_COLOR_KEYS = [
  "terminal.background",
  "terminal.foreground",
  "terminalCursor.foreground",
  "terminal.selectionBackground",
  "terminal.ansiBlack",
  "terminal.ansiRed",
  "terminal.ansiGreen",
  "terminal.ansiYellow",
  "terminal.ansiBlue",
  "terminal.ansiMagenta",
  "terminal.ansiCyan",
  "terminal.ansiWhite",
  "terminal.ansiBrightBlack",
  "terminal.ansiBrightRed",
  "terminal.ansiBrightGreen",
  "terminal.ansiBrightYellow",
  "terminal.ansiBrightBlue",
  "terminal.ansiBrightMagenta",
  "terminal.ansiBrightCyan",
  "terminal.ansiBrightWhite",
] as const;

export type TerminalColorKey = (typeof TERMINAL_COLOR_KEYS)[number];

/** All known `colors` keys (editor + terminal). */
export const KNOWN_COLOR_KEYS: ReadonlySet<string> = new Set<string>([
  ...MONACO_COLOR_KEYS,
  ...TERMINAL_COLOR_KEYS,
]);

export function isKnownColorKey(key: string): boolean {
  return KNOWN_COLOR_KEYS.has(key);
}

/** Defaults taken from the built-in dark theme (complete map, no gaps). */
export const DEFAULT_MONACO_COLORS: Record<string, string> = {
  "editor.background": "#1a1b1c",
  "editor.foreground": "#d4d4d4",
  "editorLineNumber.foreground": "#54585b",
  "editorLineNumber.activeForeground": "#eda05a",
  "editorCursor.foreground": "#eda05a",
  "editor.selectionBackground": "#3a3d3f",
  "editor.selectionHighlightBackground": "#2c2f31",
  "editor.lineHighlightBackground": "#202223",
  "editorGutter.background": "#1a1b1c",
  "editorIndentGuide.background": "#2c2f31",
  "editorIndentGuide.activeBackground": "#3a3d3f",
  "editorBracketMatch.background": "#3a3d3f",
  "editorBracketMatch.border": "#eda05a",
  "editorWidget.background": "#1a1b1c",
  "editorWidget.border": "#3a3d3f",
  "editorSuggestWidget.selectedBackground": "#2c2f31",
  "editorHoverWidget.background": "#1a1b1c",
  "editorHoverWidget.border": "#3a3d3f",
};

export const DEFAULT_TERMINAL_COLORS: Record<string, string> = {
  "terminal.background": "#191a1b",
  "terminal.foreground": "#a7acaf",
  "terminalCursor.foreground": "#eda05a",
  "terminal.selectionBackground": "#3a3d3f",
  "terminal.ansiBlack": "#191a1b",
  "terminal.ansiRed": "#e06c5a",
  "terminal.ansiGreen": "#8fbf6a",
  "terminal.ansiYellow": "#e0b45a",
  "terminal.ansiBlue": "#6a9fbf",
  "terminal.ansiMagenta": "#b48ac7",
  "terminal.ansiCyan": "#6abf9f",
  "terminal.ansiWhite": "#a7acaf",
  "terminal.ansiBrightBlack": "#54585b",
  "terminal.ansiBrightRed": "#e06c5a",
  "terminal.ansiBrightGreen": "#8fbf6a",
  "terminal.ansiBrightYellow": "#e0b45a",
  "terminal.ansiBrightBlue": "#6a9fbf",
  "terminal.ansiBrightMagenta": "#b48ac7",
  "terminal.ansiBrightCyan": "#6abf9f",
  "terminal.ansiBrightWhite": "#e8eaeb",
};

/** xterm.js option names for each terminal color key. */
export const TERMINAL_TO_XTERM: Record<string, string> = {
  "terminal.background": "background",
  "terminal.foreground": "foreground",
  "terminalCursor.foreground": "cursor",
  "terminal.selectionBackground": "selectionBackground",
  "terminal.ansiBlack": "black",
  "terminal.ansiRed": "red",
  "terminal.ansiGreen": "green",
  "terminal.ansiYellow": "yellow",
  "terminal.ansiBlue": "blue",
  "terminal.ansiMagenta": "magenta",
  "terminal.ansiCyan": "cyan",
  "terminal.ansiWhite": "white",
  "terminal.ansiBrightBlack": "brightBlack",
  "terminal.ansiBrightRed": "brightRed",
  "terminal.ansiBrightGreen": "brightGreen",
  "terminal.ansiBrightYellow": "brightYellow",
  "terminal.ansiBrightBlue": "brightBlue",
  "terminal.ansiBrightMagenta": "brightMagenta",
  "terminal.ansiBrightCyan": "brightCyan",
  "terminal.ansiBrightWhite": "brightWhite",
};

// --- UI chrome (CSS variables) ----------------------------------------------

/**
 * Semantic UI keys a theme sets in its `ui` map, and the CSS variable each
 * one drives. Every surface in the app must read one of these variables
 * (with a hard fallback) so a theme restyles "everything".
 */
export const UI_TO_CSS_VAR = {
  bg: "--mc-bg",
  panel: "--mc-panel",
  border: "--mc-border",
  text: "--mc-text",
  textMuted: "--mc-text-muted",
  accent: "--mc-accent",
  accentStrong: "--mc-accent-strong",
  error: "--mc-error",
  scrollbar: "--mc-scrollbar",
  rowHover: "--mc-row-hover",
  rowActive: "--mc-row-active",
} as const;

export type UiKey = keyof typeof UI_TO_CSS_VAR;

/** CSS variables managed by themeService.applyTheme (in :root). */
export const MANAGED_CSS_VARS: readonly string[] = Object.values(UI_TO_CSS_VAR);

/** Defaults mirroring index.css so code and CSS never disagree. */
export const DEFAULT_UI: Record<UiKey, string> = {
  bg: "#131313",
  panel: "#191a1b",
  border: "#232526",
  text: "#a7acaf",
  textMuted: "#6a7075",
  accent: "#eda05a",
  accentStrong: "#e08a3c",
  error: "#ff5370",
  scrollbar: "#3a3d3f",
  rowHover: "#232526",
  rowActive: "#2c2f31",
};

export function isUiKey(key: string): key is UiKey {
  return key in UI_TO_CSS_VAR;
}

export function cssVarForUi(key: UiKey): string {
  return UI_TO_CSS_VAR[key];
}
