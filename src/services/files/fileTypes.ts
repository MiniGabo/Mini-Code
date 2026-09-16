// File classification by extension.
// Adding a language = adding an entry here + registering it in
// languages/registry

export type MonacoLangId = "java" | "yaml" | "xml" | "markdown" | "plaintext" | "kotlin" | "groovy";

export interface FileKind {
  lang: MonacoLangId;
  /** Color family for icons (coupled to the project's tailwind). */
  iconTone: "ember" | "sky" | "green" | "purple" | "gray";
}

const EXT_MAP: Array<[string[], MonacoLangId, FileKind["iconTone"]]> = [
  [[".java"], "java", "ember"],
  [[".gradle.kts", ".kts"], "kotlin", "purple"],
  [[".gradle"], "groovy", "green"],
  [[".yml", ".yaml"], "yaml", "sky"],
  [[".xml"], "xml", "green"],
  [[".md", ".markdown"], "markdown", "purple"],
];

export function kindForFileName(name: string): FileKind {
  const n = (name ?? "").toLowerCase();
  for (const [exts, lang, tone] of EXT_MAP) {
    if (exts.some((e) => n.endsWith(e))) return { lang, iconTone: tone };
  }
  return { lang: "plaintext", iconTone: "gray" };
}

/** Monaco language by extension (compat with the current langFor). */
export function langForFileName(name: string): MonacoLangId {
  return kindForFileName(name).lang;
}

/** Strips illegal characters in names (move/rename/create). */
export function sanitizeFileName(name: string): string {
  return name.trim().replace(/[<>:"/\\|?*]/g, "-");
}
