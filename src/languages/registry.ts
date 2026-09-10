// Registro de lenguajes. Hoy solo describe lo ya soportado
// (java/yaml/xml/markdown)
import type { MonacoLangId } from "../services/files/fileTypes";

export interface LanguageSpec {
  id: MonacoLangId;
  extensions: string[];
  /** ¿Tiene IntelliSense LSP? (hoy solo java) */
  lsp: boolean;
  /** ¿Solo lectura virtual? (dependencias descompiladas: java) */
  virtualReadOnly: boolean;
}

const REGISTRY: LanguageSpec[] = [
  { id: "java", extensions: [".java"], lsp: true, virtualReadOnly: true },
  { id: "yaml", extensions: [".yml", ".yaml"], lsp: false, virtualReadOnly: false },
  { id: "xml", extensions: [".xml"], lsp: false, virtualReadOnly: false },
  { id: "markdown", extensions: [".md", ".markdown"], lsp: false, virtualReadOnly: false },
];

const byId = new Map(REGISTRY.map((l) => [l.id, l]));

export function getLanguage(id: MonacoLangId): LanguageSpec | undefined {
  return byId.get(id);
}

/** ¿Este lenguaje usa el pipeline LSP/definición? (puerta para multi-LSP) */
export function usesLsp(id: MonacoLangId): boolean {
  return byId.get(id)?.lsp === true;
}

export function listLanguages(): LanguageSpec[] {
  return [...REGISTRY];
}
