// Clasificación de archivos por extensión.
// Añadir un lenguaje = añadir una entrada aquí + registrarla en
// languages/registry

export type MonacoLangId = "java" | "yaml" | "xml" | "markdown" | "plaintext";

export interface FileKind {
  lang: MonacoLangId;
  /** Familia de color para iconos (acoplado a tailwind del proyecto). */
  iconTone: "ember" | "sky" | "green" | "purple" | "gray";
}

const EXT_MAP: Array<[string[], MonacoLangId, FileKind["iconTone"]]> = [
  [[".java"], "java", "ember"],
  [[".yml", ".yaml"], "yaml", "sky"],
  [[".xml"], "xml", "green"],
  [[".md", ".markdown"], "markdown", "purple"],
];

export function kindForFileName(name: string): FileKind {
  const n = (name ?? "").toLowerCase();
  for (const [exts, lang, tone] of EXT_MAP) {
    if (exts.some((e) => n.endsWith(e))) return { lang, iconTone: tone };
  }
  return { lang: "java", iconTone: "gray" };
}

/** Lenguaje Monaco según extensión (compat con el langFor actual). */
export function langForFileName(name: string): MonacoLangId {
  return kindForFileName(name).lang;
}

/** Limpia caracteres ilegales en nombres (mover/renombrar/crear). */
export function sanitizeFileName(name: string): string {
  return name.trim().replace(/[<>:"/\\|?*]/g, "-");
}
