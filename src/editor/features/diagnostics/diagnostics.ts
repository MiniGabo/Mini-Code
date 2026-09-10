// Diagnostics: Monaco markers + per-file error count (badges).
import { SEVERITY_MAP } from "../../../languages/java/translate";
// Per-file errors for badges (sidebar/tabs). Map fsPathLower -> count.
// Only Error severity (LSP 1); warnings do not count.
const fileErrorCounts = new Map<string, number>();
const fileErrorListeners = new Set<(errors: Record<string, number>) => void>();

function fsKeyOfUri(monaco: any, uri: any) {
  try {
    return monaco.Uri.parse(uri).fsPath.toLowerCase();
  } catch {
    return null;
  }
}

function emitFileErrors() {
  const snapshot = Object.fromEntries(fileErrorCounts);
  for (const fn of fileErrorListeners) {
    try {
      fn(snapshot);
    } catch {
      // broken listener: does not break the rest
    }
  }
}

function subscribeFileErrors(fn: any) {
  fileErrorListeners.add(fn);
  fn(Object.fromEntries(fileErrorCounts));
  return () => fileErrorListeners.delete(fn);
}

function clearFileErrors() {
  if (fileErrorCounts.size === 0) return;
  fileErrorCounts.clear();
  emitFileErrors();
}
let diagnosticsUnsub = null;

function setupDiagnostics(monaco: any) {
  // Clean re-subscription even across module re-executions (HMR):
  // the unsub lives on window, not in module state.
  if ((window as any).__miniCodeDiagUnsub) {
    try {
      (window as any).__miniCodeDiagUnsub();
    } catch {
      // keep going anyway
    }
    (window as any).__miniCodeDiagUnsub = null;
  }
  if (!window.electronAPI?.onDiagnostics) return;
  diagnosticsUnsub = window.electronAPI.onDiagnostics(({ uri, diagnostics }: any) => {
    // Matching by fsPath (insensitive to %20/case): the server may
    // return the URI with different normalization than Monaco's.
    const targetFs = fsKeyOfUri(monaco, uri);
    if (!targetFs) return;
    // Error badge (even with no open model for the file)
    const errors = (diagnostics ?? []).filter((d: any) => (d.severity ?? 1) === 1).length;
    if (errors > 0) fileErrorCounts.set(targetFs, errors);
    else fileErrorCounts.delete(targetFs);
    emitFileErrors();
    const model = monaco.editor
      .getModels()
      .find((m: any) => {
        try {
          return (
            m.getLanguageId() === "java" &&
            m.uri.fsPath.toLowerCase() === targetFs
          );
        } catch {
          return false;
        }
      });
    if (!model) return;
    const markers = (diagnostics ?? []).map((d: any) => ({
      severity: SEVERITY_MAP[d.severity] ?? 8,
      message: d.message ?? "",
      source: d.source ?? "java",
      code: typeof d.code === "string" || typeof d.code === "number" ? String(d.code) : undefined,
      startLineNumber: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLineNumber: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
    }));
    monaco.editor.setModelMarkers(model, "java-lsp", markers);
  });
  (window as any).__miniCodeDiagUnsub = diagnosticsUnsub;
}

export { subscribeFileErrors, clearFileErrors, setupDiagnostics };
