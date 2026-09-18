// Theme service: the single owner of theme state.
//
// Replaces the old themeRegistry. Responsibilities:
//   - store ThemeSpec entries (built-ins + extension contributions)
//   - resolve `extends` chains (cycle-guarded) into effective themes
//   - define Monaco themes lazily (one pipeline, dynamic vs/vs-dark base)
//   - apply chrome CSS variables to :root in one batch (never half-applied)
//   - expose terminal (xterm) palettes derived from the active theme
//   - reactive version so the UI refreshes when late extensions arrive
//
// A broken theme must never break the app: unknown ids resolve to the
// built-in fallback, and applyTheme never throws.
import { useSyncExternalStore } from "react";
import {
  DEFAULT_MONACO_COLORS,
  DEFAULT_TERMINAL_COLORS,
  DEFAULT_UI,
  MANAGED_CSS_VARS,
  TERMINAL_TO_XTERM,
  UI_TO_CSS_VAR,
  type UiKey,
} from "./colorRegistry";
import { toMonacoRules, type MonacoTokenRule } from "./tokenScopes";
import type {
  ThemeBase,
  ValidatedBackground,
  ValidatedIconSet,
  ValidatedThemeFile,
  BackgroundFit,
  BackgroundWhere,
} from "./schema";

export interface ThemeIconSet {
  files: Record<string, string>;
  folders: Record<string, string>;
  defaultFile?: string;
  defaultFolder?: string;
}

export interface ThemeBackground {
  file: string;
  opacity: number;
  fit: BackgroundFit;
  where: BackgroundWhere[];
}

export interface ThemeSpec {
  id: string;
  label: string;
  /** "builtin" or the contributing extension id (for unload). */
  source: string;
  /** Absolute extension folder (set by the host; needed to read assets). */
  dir?: string;
  base: ThemeBase;
  extends?: string;
  /** Monaco/terminal colors (#rrggbb or #rrggbbaa). Partial: merged with defaults. */
  colors: Record<string, string>;
  /** Monaco-ready token rules (already normalized). */
  tokenRules: MonacoTokenRule[];
  /** Semantic ui keys (see colorRegistry.UI_TO_CSS_VAR). Partial. */
  ui: Record<string, string>;
  icons?: ThemeIconSet;
  background?: ThemeBackground;
}

/** A theme with its `extends` chain merged (what actually gets applied). */
export interface ResolvedTheme {
  id: string;
  label: string;
  base: ThemeBase;
  colors: Record<string, string>;
  tokenRules: MonacoTokenRule[];
  ui: Record<string, string>;
  icons?: ThemeIconSet;
  background?: ThemeBackground;
  dir?: string;
}

export const FALLBACK_THEME_ID = "mini-code-dark";

const themes = new Map<string, ThemeSpec>();
const defined = new Set<string>();

let version = 0;
const listeners = new Set<() => void>();

function bump(): void {
  version++;
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      // a broken listener must not break the service
    }
  }
}

export function subscribeRegistryChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getRegistryVersion(): number {
  return version;
}

/** Manual bump for related state (e.g. icons loaded async). */
export function notifyRegistryChanged(): void {
  bump();
}

/** Reactive theme list (re-renders when extensions register/unregister). */
export function useThemes(): ThemeSpec[] {
  useSyncExternalStore(subscribeRegistryChange, getRegistryVersion);
  return listThemes();
}

export function registerTheme(spec: ThemeSpec): () => void {
  themes.set(spec.id, spec);
  // Forget the Monaco definition so a re-registered theme re-defines lazily.
  defined.delete(spec.id);
  bump();
  return () => {
    if (themes.get(spec.id) === spec) {
      themes.delete(spec.id);
      defined.delete(spec.id);
      bump();
    }
  };
}

export function unregisterTheme(id: string): void {
  if (themes.delete(id)) {
    defined.delete(id);
    bump();
  }
}

export function getTheme(id: string): ThemeSpec | undefined {
  return themes.get(id);
}

export function listThemes(): ThemeSpec[] {
  return [...themes.values()];
}

/** Requested id, or the built-in fallback when unknown. */
export function resolveThemeId(id: string | null | undefined): string {
  if (id && themes.has(id)) return id;
  return FALLBACK_THEME_ID;
}

function mergeIconSets(base: ThemeIconSet | undefined, over: ThemeIconSet | undefined): ThemeIconSet | undefined {
  if (!base) return over;
  if (!over) return base;
  return {
    files: { ...base.files, ...over.files },
    folders: { ...base.folders, ...over.folders },
    defaultFile: over.defaultFile ?? base.defaultFile,
    defaultFolder: over.defaultFolder ?? base.defaultFolder,
  };
}

/**
 * Merges an `extends` chain into an effective theme. Missing parents and
 * cycles resolve gracefully (chain stops, child still applies). The child's
 * own fields always win; token rules merge per token (child wins).
 */
export function resolveTheme(id: string): ResolvedTheme {
  const fallback: ResolvedTheme = {
    id: FALLBACK_THEME_ID,
    label: FALLBACK_THEME_ID,
    base: "vs-dark",
    colors: { ...DEFAULT_MONACO_COLORS, ...DEFAULT_TERMINAL_COLORS },
    tokenRules: [],
    ui: { ...DEFAULT_UI },
  };
  const leaf = themes.get(id) ?? themes.get(FALLBACK_THEME_ID);
  if (!leaf) return fallback;

  // Walk extends chain from leaf up to the root, then fold root-first.
  const chain: ThemeSpec[] = [leaf];
  const seen = new Set<string>([leaf.id]);
  let cursor = leaf.extends;
  while (cursor && !seen.has(cursor)) {
    const parent = themes.get(cursor);
    if (!parent) break;
    seen.add(cursor);
    chain.push(parent);
    cursor = parent.extends;
  }

  const colors: Record<string, string> = { ...DEFAULT_MONACO_COLORS, ...DEFAULT_TERMINAL_COLORS };
  const ui: Record<string, string> = { ...DEFAULT_UI };
  const ruleMap = new Map<string, MonacoTokenRule>();
  let icons: ThemeIconSet | undefined;
  let background: ThemeBackground | undefined;
  let base: ThemeBase = "vs-dark";
  let dir: string | undefined;

  for (const spec of [...chain].reverse()) {
    Object.assign(colors, spec.colors);
    Object.assign(ui, spec.ui);
    for (const r of spec.tokenRules) {
      const prev = ruleMap.get(r.token) ?? { token: r.token };
      if (r.foreground !== undefined) prev.foreground = r.foreground;
      if (r.background !== undefined) prev.background = r.background;
      if (r.fontStyle !== undefined) prev.fontStyle = r.fontStyle;
      ruleMap.set(r.token, prev);
    }
    icons = mergeIconSets(icons, spec.icons);
    if (spec.background) background = spec.background;
    base = spec.base;
    if (spec.dir) dir = spec.dir;
  }
  // The leaf's base wins over inherited ones (a light theme extending a
  // dark one stays light). Recompute: leaf first.
  base = leaf.base;

  return {
    id: leaf.id,
    label: leaf.label,
    base,
    colors,
    tokenRules: [...ruleMap.values()],
    ui,
    ...(icons ? { icons } : {}),
    ...(background ? { background } : {}),
    ...(dir ? { dir } : {}),
  };
}

/**
 * Applies a theme's chrome variables to :root in one batch (all managed
 * vars are set from the resolved theme, which already includes defaults).
 * Returns the resolved id. Never throws.
 */
export function applyTheme(id: string): string {
  const resolved = resolveTheme(resolveThemeId(id));
  if (typeof document === "undefined") return resolved.id;
  try {
    const root = document.documentElement;
    for (const [uiKey, cssVar] of Object.entries(UI_TO_CSS_VAR) as Array<[UiKey, string]>) {
      const value = resolved.ui[uiKey];
      if (typeof value === "string") root.style.setProperty(cssVar, value);
      else root.style.removeProperty(cssVar);
    }
    // Forward-compat: drop managed vars no theme sets anymore.
    for (const v of MANAGED_CSS_VARS) {
      if (!Object.values(UI_TO_CSS_VAR).includes(v as (typeof UI_TO_CSS_VAR)[UiKey])) {
        root.style.removeProperty(v);
      }
    }
  } catch {
    // keep current variables
  }
  return resolved.id;
}

/**
 * xterm.js theme for the terminal panel, derived from the resolved theme:
 * theme `terminal.*` colors win, missing ones fall back to ui chrome, then
 * to built-in defaults. Always complete, never throws.
 */
export function getTerminalTheme(id: string): Record<string, string> {
  const resolved = resolveTheme(resolveThemeId(id));
  const uiOf = (uiKey: string, fallback: string): string =>
    typeof resolved.ui[uiKey] === "string" ? (resolved.ui[uiKey] as string) : fallback;
  const seed: Record<string, string> = {
    ...DEFAULT_TERMINAL_COLORS,
    "terminal.background": uiOf("panel", DEFAULT_TERMINAL_COLORS["terminal.background"]),
    "terminal.foreground": uiOf("text", DEFAULT_TERMINAL_COLORS["terminal.foreground"]),
    "terminalCursor.foreground": uiOf("accent", DEFAULT_TERMINAL_COLORS["terminalCursor.foreground"]),
    "terminal.selectionBackground": uiOf("border", DEFAULT_TERMINAL_COLORS["terminal.selectionBackground"]),
  };
  for (const [k, v] of Object.entries(resolved.colors)) {
    if (k in TERMINAL_TO_XTERM && typeof v === "string") seed[k] = v;
  }
  const out: Record<string, string> = {};
  for (const [colorKey, xtermKey] of Object.entries(TERMINAL_TO_XTERM)) {
    out[xtermKey] = seed[colorKey] ?? DEFAULT_TERMINAL_COLORS[colorKey];
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ensureThemeDefined(monaco: any, id: string): string {
  const resolved = resolveTheme(resolveThemeId(id));
  if (!defined.has(resolved.id)) {
    try {
      monaco.editor.defineTheme(resolved.id, {
        base: resolved.base,
        inherit: true,
        colors: resolved.colors,
        rules: resolved.tokenRules.map((r) => ({
          token: r.token,
          ...(r.foreground ? { foreground: r.foreground } : {}),
          ...(r.background ? { background: r.background } : {}),
          ...(r.fontStyle ? { fontStyle: r.fontStyle } : {}),
        })),
      });
    } catch {
      return FALLBACK_THEME_ID;
    }
    defined.add(resolved.id);
  }
  return resolved.id;
}

/** Test/host hook: forgets which themes were defined (does not unregister). */
export function resetDefinedForTests(): void {
  defined.clear();
}

// --- Building a ThemeSpec ----------------------------------------------------

/** Builds a static (built-in) ThemeSpec from hand-written parts. */
export function makeBuiltinSpec(parts: {
  id: string;
  label: string;
  base: ThemeBase;
  colors?: Record<string, string>;
  tokenRules?: MonacoTokenRule[];
  ui?: Record<string, string>;
  icons?: ThemeIconSet;
  background?: ThemeBackground;
}): ThemeSpec {
  return {
    id: parts.id,
    label: parts.label,
    source: "builtin",
    base: parts.base,
    colors: parts.colors ?? {},
    tokenRules: parts.tokenRules ?? [],
    ui: parts.ui ?? {},
    ...(parts.icons ? { icons: parts.icons } : {}),
    ...(parts.background ? { background: parts.background } : {}),
  };
}

/**
 * Builds a ThemeSpec from a validated theme file + its manifest entry.
 * Token entries are compiled to Monaco rules here, once, so every consumer
 * shares the same normalization. `defaultBase` (the manifest's uiTheme)
 * applies when the file declares no base.
 */
export function specFromValidatedFile(args: {
  id: string;
  label: string;
  source: string;
  dir: string;
  defaultBase: ThemeBase;
  file: ValidatedThemeFile;
}): ThemeSpec {
  const { id, label, source, dir, defaultBase, file } = args;
  const icons: ThemeIconSet | undefined = file.icons
    ? {
        files: { ...file.icons.files },
        folders: { ...file.icons.folders },
        ...(file.icons.defaultFile ? { defaultFile: file.icons.defaultFile } : {}),
        ...(file.icons.defaultFolder ? { defaultFolder: file.icons.defaultFolder } : {}),
      }
    : undefined;
  const background: ThemeBackground | undefined = file.background
    ? {
        file: file.background.file,
        opacity: file.background.opacity,
        fit: file.background.fit,
        where: [...file.background.where],
      }
    : undefined;
  return {
    id,
    label,
    source,
    dir,
    base: file.base ?? defaultBase,
    ...(file.extends ? { extends: file.extends } : {}),
    colors: { ...file.colors },
    tokenRules: toMonacoRules(
      file.tokenColors.map((t) => ({
        scopes: [...t.scopes],
        ...(t.foreground ? { foreground: t.foreground } : {}),
        ...(t.background ? { background: t.background } : {}),
        ...(t.fontStyle ? { fontStyle: t.fontStyle } : {}),
      })),
    ),
    ui: { ...file.ui },
    ...(icons ? { icons } : {}),
    ...(background ? { background } : {}),
  };
}

export type {
  ValidatedBackground,
  ValidatedIconSet,
  ValidatedThemeFile,
  BackgroundFit,
  BackgroundWhere,
};
