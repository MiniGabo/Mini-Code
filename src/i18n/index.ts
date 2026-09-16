// Locale loading: messages live in ./locales/<code>.json (e.g. es_ES.json)
// and are loaded on startup and on every language switch, so no UI string
// for a supported language is hardcoded in the components.
// To add a language: drop its JSON file in ./locales and add one line below.

export interface SupportedLanguage {
  code: string;
  /** Native display name shown in the language picker. */
  nativeName: string;
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: "en_EN", nativeName: "English" },
  { code: "es_ES", nativeName: "Español" },
];

export const DEFAULT_LANGUAGE = "en_EN";

export type Messages = Record<string, string>;

/** Dynamically imports ./locales/<code>.json (Vite bundles every match). */
export async function loadLocale(code: string): Promise<Messages> {
  const normalized = SUPPORTED_LANGUAGES.some((l) => l.code === code) ? code : DEFAULT_LANGUAGE;
  const mod = (await import(`./locales/${normalized}.json`)) as { default: Messages };
  return mod.default ?? {};
}

/** Flat-key lookup with optional {var} interpolation; returns the key when missing. */
export function translate(dict: Messages, key: string, vars?: Record<string, string | number | undefined>): string {
  let text = dict[key];
  if (typeof text !== "string") return key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value ?? ""));
    }
  }
  return text;
}
