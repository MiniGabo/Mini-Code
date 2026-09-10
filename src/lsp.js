// Fachada de compatibilidad: la implementación vive en módulos por dominio.
//   languages/java/*      -> análisis Java + traducción LSP + completion + external query
//   editor/features/*     -> navegación, reveal, diagnósticos, providers Monaco
//   services/*            -> registry de modelos, doc-sync, dedup de requests
// Los consumidores (App, EditorPane) importan de aquí sin cambios.
export { dedupedLspRequest } from "./services/lsp/request";
export {
  trackMonaco,
  registerModelKey,
  disposeModelForKey,
  disposeAllModels,
} from "./services/editor/modelRegistry";
export { attachJavaDoc } from "./services/editor/docSync";
export {
  KIND_MAP,
  SEVERITY_MAP,
  docToMarkdown,
  lspRangeToMonaco,
  lspTextEditToMonaco,
  markerSeverityToLsp,
  markerCodeToString,
  hoverContents,
  definitionToLocations,
} from "./languages/java/translate";
export {
  suggestionFromLspItem,
  resolveSuggestionDocs,
} from "./languages/java/completion";
export { buildExternalQuery } from "./languages/java/externalQuery";
export {
  resolveDefinition,
  resolveDefinitionForClick,
  navigableSymbolAt,
} from "./editor/features/navigation/definition";
export {
  setOpenFileByPath,
  setDecompiledCtl,
  openDecompiledPending,
  fulfillDecompiled,
  setPendingReveal,
} from "./editor/features/navigation/bridges";
export {
  consumePendingReveal,
  flashTarget,
} from "./editor/features/navigation/reveal";
export {
  subscribeFileErrors,
  clearFileErrors,
  setupDiagnostics,
} from "./editor/features/diagnostics/diagnostics";
export { ensureJavaProviders } from "./editor/features/providers/javaProviders";
