// Token scopes: TextMate-style scopes (`tokenColors`) normalized to the
// Monaco `ThemeRule[]` that `defineTheme` consumes.
//
// A theme entry looks like (VSCode-style):
//   { "scope": ["comment", "comment.doc"], "settings": { "foreground": "#6a7075", "fontStyle": "italic" } }
// `scope` also accepts a single string, comma-separated or not.
// Entries merge by token: later entries win per-field, so a theme can first
// style "string" broadly and then refine "string.escape".

export interface TokenColorEntry {
  scopes: string[];
  foreground?: string;
  background?: string;
  fontStyle?: string;
}

export interface MonacoTokenRule {
  token: string;
  foreground?: string;
  background?: string;
  fontStyle?: string;
}

const SCOPE_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

const FONT_STYLES = ["bold", "italic", "underline", "strikethrough"] as const;

export function isValidScope(scope: string): boolean {
  return SCOPE_RE.test(scope);
}

/**
 * Normalizes a `scope` value (string or list) into clean scope names.
 * Returns the valid ones; `rejected` collects the invalid entries for
 * warnings. Never throws.
 */
export function normalizeScopes(scope: unknown, rejected: string[]): string[] {
  const raw: unknown[] = Array.isArray(scope) ? scope : [scope];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      rejected.push(String(item));
      continue;
    }
    // Split comma-separated lists ("comment, comment.doc") but keep
    // dotted scopes intact.
    for (const part of item.split(",")) {
      const s = part.trim();
      if (!s) continue;
      if (!isValidScope(s)) {
        rejected.push(s);
        continue;
      }
      if (!out.includes(s)) out.push(s);
    }
  }
  return out;
}

/**
 * Normalizes a `fontStyle` value ("bold italic" in any order/case) into
 * Monaco's canonical space-separated form. Returns null when empty.
 * Unknown words are collected into `rejected` and ignored.
 */
export function normalizeFontStyle(style: unknown, rejected: string[]): string | null {
  if (style === undefined || style === null) return null;
  if (typeof style !== "string") {
    rejected.push(String(style));
    return null;
  }
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const word of style.split(/\s+/)) {
    const w = word.trim().toLowerCase();
    if (!w) continue;
    if (!(FONT_STYLES as readonly string[]).includes(w)) {
      rejected.push(word);
      continue;
    }
    if (!seen.has(w)) {
      seen.add(w);
      ordered.push(w);
    }
  }
  // Canonical order (Monaco/VSCode convention).
  ordered.sort((a, b) => FONT_STYLES.indexOf(a as (typeof FONT_STYLES)[number]) - FONT_STYLES.indexOf(b as (typeof FONT_STYLES)[number]));
  return ordered.length > 0 ? ordered.join(" ") : null;
}

/**
 * Merges normalized entries into Monaco rules. One rule per token; when
 * several entries target the same token, later fields win (per-field merge).
 */
export function toMonacoRules(entries: TokenColorEntry[]): MonacoTokenRule[] {
  const merged = new Map<string, MonacoTokenRule>();
  for (const e of entries) {
    for (const scope of e.scopes) {
      const prev = merged.get(scope) ?? { token: scope };
      if (e.foreground !== undefined) prev.foreground = e.foreground;
      if (e.background !== undefined) prev.background = e.background;
      if (e.fontStyle !== undefined) prev.fontStyle = e.fontStyle;
      merged.set(scope, prev);
    }
  }
  return [...merged.values()];
}
