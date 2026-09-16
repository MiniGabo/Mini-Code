// Compatibility facade: the implementation lives in domain modules.
//   languages/java/*      -> Java analysis + LSP translation + completion + external query
//   editor/features/*     -> navigation, reveal, diagnostics, Monaco providers
//   services/*            -> model registry, doc-sync, request dedup
// Consumers (App, EditorPane) import from here unchanged.
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
  setOwnerErrors,
  clearOwnerForFile,
} from "./editor/features/diagnostics/diagnostics";
export { attachBuildDiagnostics, isBuildFileName } from "./editor/features/diagnostics/buildDiagnostics";
export { ensureJavaProviders } from "./editor/features/providers/javaProviders";
