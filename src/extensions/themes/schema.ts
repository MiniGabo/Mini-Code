// Theme file schema (v1): single validator for every `themes/*.json` file
// contributed by an extension. Design rules:
//
// - Structural problems (not an object, bad `base`, bad `extends`) are
//   FATAL: the theme is skipped, the error is reported, other themes live on.
// - Single-entry problems (one bad color, one bad scope) are WARNINGS: the
//   entry is skipped and the theme still loads. A typo must never kill a theme.
// - Unknown `colors` / `ui` keys are warnings (forward-compatible), never errors.
// - All color values accept #rgb, #rrggbb or #rrggbbaa and are normalized to
//   lowercase #rrggbb(aa). Token foregrounds/backgrounds only accept opaque
//   colors (#rgb / #rrggbb) and are stored without "#" for Monaco.
import {
  isKnownColorKey,
  isUiKey,
  type UiKey,
} from "./colorRegistry";
import {
  normalizeScopes,
  normalizeFontStyle,
} from "./tokenScopes";

export const THEME_SCHEMA_VERSION = 1;

export type ThemeBase = "vs" | "vs-dark";
export type BackgroundFit = "cover" | "contain" | "center" | "tile";
export type BackgroundWhere = "editor" | "sidebar" | "welcome";

export interface ValidatedTokenColor {
  scopes: string[];
  /** rrggbb, no "#". */
  foreground?: string;
  /** rrggbb, no "#". */
  background?: string;
  fontStyle?: string;
}

export interface ValidatedIconSet {
  files: Record<string, string>;
  folders: Record<string, string>;
  defaultFile?: string;
  defaultFolder?: string;
}

export interface ValidatedBackground {
  file: string;
  opacity: number;
  fit: BackgroundFit;
  where: BackgroundWhere[];
}

export interface ValidatedThemeFile {
  /** File-declared base; undefined = use the manifest's uiTheme. */
  base?: ThemeBase;
  extends?: string;
  /** #rrggbb or #rrggbbaa (lowercase, with "#"). */
  colors: Record<string, string>;
  tokenColors: ValidatedTokenColor[];
  /** Semantic ui keys (see colorRegistry.UI_TO_CSS_VAR). */
  ui: Record<UiKey, string> & Record<string, string>;
  icons?: ValidatedIconSet;
  background?: ValidatedBackground;
}

export type ThemeFileResult =
  | { ok: true; theme: ValidatedThemeFile; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

const HEX3_RE = /^#[0-9a-fA-F]{3}$/;
const HEX6_RE = /^#[0-9a-fA-F]{6}$/;
const HEX8_RE = /^#[0-9a-fA-F]{8}$/;

const BASES: readonly string[] = ["vs", "vs-dark"];
const FITS: readonly string[] = ["cover", "contain", "center", "tile"];
const WHERES: readonly string[] = ["editor", "sidebar", "welcome"];

/** Max background asset size (re-checked in main on read). */
export const BACKGROUND_MAX_BYTES = 5 * 1024 * 1024;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Expands #rgb -> #rrggbb; returns null when `allowAlpha` forbids the shape. */
export function normalizeHexColor(value: unknown, allowAlpha: boolean): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (HEX3_RE.test(v)) {
    const expanded = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
    return expanded;
  }
  if (HEX6_RE.test(v)) return v.toLowerCase();
  if (allowAlpha && HEX8_RE.test(v)) return v.toLowerCase();
  return null;
}

export function isRelativeAssetPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !!value.trim() &&
    !value.includes("..") &&
    !value.startsWith("/") &&
    !/^[a-zA-Z]:/.test(value)
  );
}

function validateColors(raw: unknown, warnings: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw === undefined) return out;
  if (!isRecord(raw)) {
    warnings.push("colors: debe ser un objeto, se ignora");
    return out;
  }
  for (const [k, v] of Object.entries(raw)) {
    if (!isKnownColorKey(k)) {
      warnings.push(`colors.${k}: clave desconocida, se ignora`);
      continue;
    }
    const hex = normalizeHexColor(v, true);
    if (!hex) {
      warnings.push(`colors.${k}: debe ser hex "#rgb", "#rrggbb" o "#rrggbbaa", se ignora`);
      continue;
    }
    out[k] = hex;
  }
  return out;
}

function validateUi(raw: unknown, warnings: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw === undefined) return out;
  if (!isRecord(raw)) {
    warnings.push("ui: debe ser un objeto, se ignora");
    return out;
  }
  for (const [k, v] of Object.entries(raw)) {
    if (!isUiKey(k)) {
      warnings.push(`ui.${k}: clave desconocida, se ignora`);
      continue;
    }
    const hex = normalizeHexColor(v, true);
    if (!hex) {
      warnings.push(`ui.${k}: debe ser hex "#rgb", "#rrggbb" o "#rrggbbaa", se ignora`);
      continue;
    }
    out[k] = hex;
  }
  return out;
}

function validateTokenColors(raw: unknown, warnings: string[]): ValidatedTokenColor[] {
  const out: ValidatedTokenColor[] = [];
  if (raw === undefined) return out;
  if (!Array.isArray(raw)) {
    warnings.push("tokenColors: debe ser una lista, se ignora");
    return out;
  }
  raw.forEach((entry, i) => {
    const p = `tokenColors[${i}]`;
    if (!isRecord(entry)) {
      warnings.push(`${p}: debe ser un objeto, se ignora`);
      return;
    }
    const rejectedScopes: string[] = [];
    const scopes = normalizeScopes(entry.scope, rejectedScopes);
    for (const r of rejectedScopes) warnings.push(`${p}.scope: "${r}" no es un scope válido, se ignora`);
    if (scopes.length === 0) {
      warnings.push(`${p}.scope: requerido (texto o lista de scopes), se ignora la entrada`);
      return;
    }
    const settings = entry.settings;
    if (!isRecord(settings)) {
      warnings.push(`${p}.settings: requerido, se ignora la entrada`);
      return;
    }
    const out_entry: ValidatedTokenColor = { scopes };
    if (settings.foreground !== undefined) {
      const hex = normalizeHexColor(settings.foreground, false);
      if (!hex) {
        warnings.push(`${p}.settings.foreground: debe ser hex "#rgb" o "#rrggbb", se ignora`);
      } else {
        out_entry.foreground = hex.slice(1);
      }
    }
    if (settings.background !== undefined) {
      const hex = normalizeHexColor(settings.background, false);
      if (!hex) {
        warnings.push(`${p}.settings.background: debe ser hex "#rgb" o "#rrggbb", se ignora`);
      } else {
        out_entry.background = hex.slice(1);
      }
    }
    if (settings.fontStyle !== undefined) {
      const rejected: string[] = [];
      const style = normalizeFontStyle(settings.fontStyle, rejected);
      for (const r of rejected) warnings.push(`${p}.settings.fontStyle: "${r}" no es un estilo válido, se ignora`);
      if (style) out_entry.fontStyle = style;
    }
    if (out_entry.foreground === undefined && out_entry.background === undefined && out_entry.fontStyle === undefined) {
      warnings.push(`${p}: sin estilos válidos (foreground/background/fontStyle), se ignora la entrada`);
      return;
    }
    out.push(out_entry);
  });
  return out;
}

function validateIconPath(value: unknown, path: string, warnings: string[]): string | null {
  if (!isRelativeAssetPath(value)) {
    warnings.push(`${path}: ruta relativa dentro de la extensión (sin .. ni absolutas), se ignora`);
    return null;
  }
  if (!(value as string).toLowerCase().endsWith(".svg")) {
    warnings.push(`${path}: solo archivos .svg, se ignora`);
    return null;
  }
  return (value as string).trim();
}

function validateIcons(raw: unknown, warnings: string[]): ValidatedIconSet | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    warnings.push("icons: debe ser un objeto, se ignora");
    return undefined;
  }
  const out: ValidatedIconSet = { files: {}, folders: {} };
  for (const section of ["files", "folders"] as const) {
    const map = raw[section];
    if (map === undefined) continue;
    if (!isRecord(map)) {
      warnings.push(`icons.${section}: debe ser un objeto, se ignora`);
      continue;
    }
    for (const [k, v] of Object.entries(map)) {
      if (!k.trim()) {
        warnings.push(`icons.${section}: clave vacía, se ignora`);
        continue;
      }
      const rel = validateIconPath(v, `icons.${section}.${k}`, warnings);
      if (rel) out[section][k.toLowerCase()] = rel;
    }
  }
  for (const d of ["defaultFile", "defaultFolder"] as const) {
    if (raw[d] === undefined) continue;
    const rel = validateIconPath(raw[d], `icons.${d}`, warnings);
    if (rel) out[d] = rel;
  }
  return out;
}

function validateBackground(raw: unknown, warnings: string[]): ValidatedBackground | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    warnings.push("background: debe ser un objeto, se ignora");
    return undefined;
  }
  if (!isRelativeAssetPath(raw.file)) {
    warnings.push("background.file: ruta relativa dentro de la extensión (sin .. ni absolutas), se ignora el fondo");
    return undefined;
  }
  const ext = (raw.file as string).toLowerCase().split(".").pop() ?? "";
  if (!["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
    warnings.push("background.file: formato no permitido (png, jpg, gif, webp, svg), se ignora el fondo");
    return undefined;
  }
  const opacity = typeof raw.opacity === "number" ? raw.opacity : NaN;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    warnings.push("background.opacity: debe ser un número entre 0 y 1, se ignora el fondo");
    return undefined;
  }
  if (opacity > 0.5) {
    warnings.push("background.opacity: mayor de 0.5, puede dañar la legibilidad");
  }
  const fit = raw.fit === undefined ? "cover" : raw.fit;
  if (typeof fit !== "string" || !FITS.includes(fit)) {
    warnings.push(`background.fit: debe ser uno de: ${FITS.join(", ")}, se ignora el fondo`);
    return undefined;
  }
  const whereRaw = raw.where === undefined ? ["editor"] : raw.where;
  if (!Array.isArray(whereRaw) || whereRaw.length === 0 || !whereRaw.every((w) => WHERES.includes(w as string))) {
    warnings.push(`background.where: debe ser una lista no vacía de: ${WHERES.join(", ")}, se ignora el fondo`);
    return undefined;
  }
  return {
    file: (raw.file as string).trim(),
    opacity,
    fit: fit as BackgroundFit,
    where: [...new Set(whereRaw)] as BackgroundWhere[],
  };
}

/**
 * Validates a `themes/*.json` file. Fatal problems return ok:false (skip the
 * theme); entry-level problems become warnings and the theme still loads.
 */
export function validateThemeFile(raw: unknown): ThemeFileResult {
  const warnings: string[] = [];
  if (!isRecord(raw)) {
    return { ok: false, errors: ["theme: debe ser un objeto JSON"], warnings };
  }
  const errors: string[] = [];
  // No default here: the host applies the manifest's uiTheme when the file
  // declares no base (themeService falls back to vs-dark regardless).
  let base: ThemeBase | undefined;
  if (raw.base !== undefined) {
    if (typeof raw.base !== "string" || !BASES.includes(raw.base)) {
      errors.push(`base: debe ser uno de: ${BASES.join(", ")}`);
    } else {
      base = raw.base as ThemeBase;
    }
  } else if (raw.uiTheme !== undefined) {
    // VSCode manifest-style alias, accepted at file level too.
    if (typeof raw.uiTheme !== "string" || !BASES.includes(raw.uiTheme)) {
      errors.push(`uiTheme: debe ser uno de: ${BASES.join(", ")}`);
    } else {
      base = raw.uiTheme as ThemeBase;
    }
  }
  let extendsId: string | undefined;
  if (raw.extends !== undefined) {
    if (typeof raw.extends !== "string" || !raw.extends.trim()) {
      errors.push("extends: debe ser el id de otro tema (texto no vacío)");
    } else {
      extendsId = raw.extends.trim();
    }
  }
  if (errors.length > 0) return { ok: false, errors, warnings };

  const colors = validateColors(raw.colors, warnings);
  const ui = validateUi(raw.ui, warnings);
  const tokenColors = validateTokenColors(raw.tokenColors, warnings);
  // Legacy alias from the previous schema: still read, warn once.
  const backgroundRaw = raw.background ?? raw.wallpaper;
  if (raw.wallpaper !== undefined && raw.background === undefined) {
    warnings.push("wallpaper: renombrado a background, se lee igual pero actualiza el tema");
  }
  // Legacy `position` alias for `fit`: normalize before validating.
  const normalizedBackgroundRaw =
    isRecord(backgroundRaw) && backgroundRaw.fit === undefined && typeof backgroundRaw.position === "string"
      ? { ...backgroundRaw, fit: backgroundRaw.position }
      : backgroundRaw;
  const background = validateBackground(normalizedBackgroundRaw, warnings);
  const icons = validateIcons(raw.icons, warnings);

  return {
    ok: true,
    theme: {
      ...(base ? { base } : {}),
      ...(extendsId ? { extends: extendsId } : {}),
      colors,
      tokenColors,
      ui: ui as ValidatedThemeFile["ui"],
      ...(icons ? { icons } : {}),
      ...(background ? { background } : {}),
    },
    warnings,
  };
}
