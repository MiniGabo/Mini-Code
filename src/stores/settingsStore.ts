// Editor settings state: UI language (persisted) + loaded messages.
// Components translate via useT(): const t = useT(); t("settings.title").
// Non-component code can use t() directly (reads current state, no subscription).

import { create } from "zustand";
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  loadLocale,
  translate,
  type Messages,
} from "../i18n";

const LANGUAGE_KEY = "mini-code:language";

export interface FontOption {
  name: string;
  /** CSS font stack used by Monaco. */
  stack: string;
}

export const FONT_FAMILIES: FontOption[] = [
  { name: "JetBrains Mono", stack: "'JetBrains Mono', 'Fira Code', monospace" },
  { name: "Fira Code", stack: "'Fira Code', 'JetBrains Mono', monospace" },
  { name: "Consolas", stack: "Consolas, 'Courier New', monospace" },
  { name: "Cascadia Code", stack: "'Cascadia Code', Consolas, monospace" },
  { name: "Monospace", stack: "monospace" },
];

export const XMX_OPTIONS = ["512m", "768m", "1g", "2g"];

/** User settings persisted to settings.json (plus localStorage cache for language). */
export interface UserSettings {
  fontFamily: string;
  fontSize: number;
  tabSize: number;
  insertSpaces: boolean;
  minimap: boolean;
  /** JDK home directory; empty = auto-detect (JAVA_HOME or PATH). */
  jdkPath: string;
  /** Max heap for the Java server (e.g. "768m"). */
  javaXmx: string;
  reopenLastProject: boolean;
  lastProject: string | null;
}

const SETTINGS_DEFAULTS: UserSettings = {
  fontFamily: FONT_FAMILIES[0].stack,
  fontSize: 14,
  tabSize: 4,
  insertSpaces: true,
  minimap: false,
  jdkPath: "",
  javaXmx: "768m",
  reopenLastProject: false,
  lastProject: null,
};

function loadPersistedLanguage(): string {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved)) return saved;
  } catch {
    // no localStorage: default language
  }
  return DEFAULT_LANGUAGE;
}

function persistLanguage(code: string): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, code);
  } catch {
    // no localStorage: language only lives for the session
  }
}

function clampNumber(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function coerceSettings(raw: Record<string, unknown>): UserSettings {
  const fontFamily =
    typeof raw.fontFamily === "string" &&
    FONT_FAMILIES.some((f) => f.stack === raw.fontFamily)
      ? (raw.fontFamily as string)
      : SETTINGS_DEFAULTS.fontFamily;
  const javaXmx =
    typeof raw.javaXmx === "string" && /^\d+[mMgG]$/.test(raw.javaXmx.trim())
      ? raw.javaXmx.trim().toLowerCase()
      : SETTINGS_DEFAULTS.javaXmx;
  return {
    fontFamily,
    fontSize: clampNumber(raw.fontSize, SETTINGS_DEFAULTS.fontSize, 8, 32),
    tabSize: clampNumber(raw.tabSize, SETTINGS_DEFAULTS.tabSize, 1, 8),
    insertSpaces: typeof raw.insertSpaces === "boolean" ? raw.insertSpaces : SETTINGS_DEFAULTS.insertSpaces,
    minimap: typeof raw.minimap === "boolean" ? raw.minimap : SETTINGS_DEFAULTS.minimap,
    jdkPath: typeof raw.jdkPath === "string" ? raw.jdkPath : SETTINGS_DEFAULTS.jdkPath,
    javaXmx,
    reopenLastProject:
      typeof raw.reopenLastProject === "boolean" ? raw.reopenLastProject : SETTINGS_DEFAULTS.reopenLastProject,
    lastProject: typeof raw.lastProject === "string" && raw.lastProject ? raw.lastProject : null,
  };
}

interface SettingsState extends UserSettings {
  language: string;
  messages: Messages;
  /** True once the initial locale finished loading. */
  ready: boolean;
  setLanguage: (code: string) => Promise<void>;
  /** Merges a patch into state and persists every key to settings.json. */
  updateSettings: (patch: Partial<UserSettings>) => void;
  setLastProject: (path: string | null) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...SETTINGS_DEFAULTS,
  language: loadPersistedLanguage(),
  messages: {},
  ready: false,

  setLanguage: async (code) => {
    const normalized = SUPPORTED_LANGUAGES.some((l) => l.code === code) ? code : DEFAULT_LANGUAGE;
    persistLanguage(normalized);
    // Persist to settings.json (main) too; main also switches its locale.
    try {
      await window.electronAPI?.setSetting?.("language", normalized);
    } catch {
      // no bridge: localStorage only
    }
    try {
      const messages = await loadLocale(normalized);
      set({ language: normalized, messages, ready: true });
    } catch {
      // missing/broken locale file: keep previous messages, still switch code
      set({ language: normalized, ready: true });
    }
  },

  updateSettings: (patch) => {
    const s = useSettingsStore.getState();
    // Validate through the same coercion used at boot.
    const merged = coerceSettings({
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      tabSize: s.tabSize,
      insertSpaces: s.insertSpaces,
      minimap: s.minimap,
      jdkPath: s.jdkPath,
      javaXmx: s.javaXmx,
      reopenLastProject: s.reopenLastProject,
      lastProject: s.lastProject,
      ...patch,
    });
    set(merged);
    const record = merged as unknown as Record<string, unknown>;
    for (const key of Object.keys(patch)) {
      try {
        void window.electronAPI?.setSetting?.(key, record[key])?.catch?.(() => {});
      } catch {
        // no bridge: session only
      }
    }
  },

  setLastProject: (path) => {
    set({ lastProject: path });
    try {
      void window.electronAPI?.setSetting?.("lastProject", path)?.catch?.(() => {});
    } catch {
      // no bridge: session only
    }
  },
}));

/** Loads settings once at startup: settings.json (main) wins over the
 * localStorage cache; without a bridge, localStorage alone is used. */
export function ensureSettingsLoaded(): void {
  const { ready, language } = useSettingsStore.getState();
  if (ready) return;
  void (async () => {
    let file: Record<string, unknown> | undefined;
    try {
      file = (await window.electronAPI?.getSettings?.()) ?? undefined;
    } catch {
      file = undefined;
    }
    const supported = (c: unknown): c is string =>
      typeof c === "string" && SUPPORTED_LANGUAGES.some((l) => l.code === c);
    const st = useSettingsStore.getState();
    if (file) st.updateSettings(coerceSettings(file));
    await st.setLanguage(supported(file?.language) ? (file?.language as string) : language);
  })();
}

/** Standalone lookup (no subscription): for TitleBar tooltips, tab titles, etc. */
export function t(key: string, vars?: Record<string, string | number | undefined>): string {
  return translate(useSettingsStore.getState().messages, key, vars);
}

/** Subscribed lookup for components (re-renders on language switch). */
export function useT(): (key: string, vars?: Record<string, string | number | undefined>) => string {
  const messages = useSettingsStore((s) => s.messages);
  return (key: string, vars?: Record<string, string | number | undefined>) => translate(messages, key, vars);
}
