// Diagnósticos: markers Monaco + conteo de errores por archivo (badges).
import { SEVERITY_MAP } from "../../../languages/java/translate";
// Errores por archivo para badges (sidebar/tabs). Map fsPathLower -> count.
// Solo severidad Error (LSP 1); los warnings no cuentan.
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
      // listener roto: no rompe el resto
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
  // Re-suscripción limpia incluso entre re-ejecuciones del módulo (HMR):
  // el unsub vive en window, no en estado del módulo.
  if ((window as any).__miniCodeDiagUnsub) {
    try {
      (window as any).__miniCodeDiagUnsub();
    } catch {
      // seguir igual
    }
    (window as any).__miniCodeDiagUnsub = null;
  }
  if (!window.electronAPI?.onDiagnostics) return;
  diagnosticsUnsub = window.electronAPI.onDiagnostics(({ uri, diagnostics }: any) => {
    // Matcheo por fsPath (insensible a %20/mayúsculas): el servidor puede
    // devolver el URI con normalización distinta a la de Monaco.
    const targetFs = fsKeyOfUri(monaco, uri);
    if (!targetFs) return;
    // Badge de errores (aunque no haya modelo abierto del archivo)
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
