// Diagnostics: Monaco markers + per-file error count (badges).
import { SEVERITY_MAP } from "../../../languages/java/translate";
// Per-file errors for badges (sidebar/tabs). Map fsPathLower -> count.
// Only Error severity counts. Counts are aggregated per owner (java-lsp,
// pom-xml, gradle) so build validators don't overwrite Java diagnostics.
const fileErrorCounts = new Map<string, number>();
const fileOwnerCounts = new Map<string, Map<string, number>>();
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

function recomputeFileTotal(fsKey: string) {
  const owners = fileOwnerCounts.get(fsKey);
  const total = owners ? [...owners.values()].reduce((a, b) => a + b, 0) : 0;
  if (total > 0) fileErrorCounts.set(fsKey, total);
  else fileErrorCounts.delete(fsKey);
}

/** Set error count for one owner of a file (badges sum across owners). */
function setOwnerErrors(fsKey: string | null, owner: string, errorCount: number) {
  if (!fsKey) return;
  let owners = fileOwnerCounts.get(fsKey);
  if (!owners) {
    owners = new Map();
    fileOwnerCounts.set(fsKey, owners);
  }
  if (errorCount > 0) owners.set(owner, errorCount);
  else owners.delete(owner);
  if (owners.size === 0) fileOwnerCounts.delete(fsKey);
  recomputeFileTotal(fsKey);
  emitFileErrors();
}

/** Remove all markers/counts of an owner for a file (e.g. on tab close). */
function clearOwnerForFile(fsKey: string | null, owner: string) {
  if (!fsKey) return;
  setOwnerErrors(fsKey, owner, 0);
}

function fsKeyOfModel(monaco: any, model: any): string | null {
  try {
    return (model.uri.fsPath as string).toLowerCase();
  } catch {
    try {
      return monaco.Uri.parse(model.uri.toString()).fsPath.toLowerCase();
    } catch {
      return null;
    }
  }
}

function clearFileErrors() {
  if (fileErrorCounts.size === 0 && fileOwnerCounts.size === 0) return;
  fileErrorCounts.clear();
  fileOwnerCounts.clear();
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
    // Error badge (even with no open model for the file), aggregated per owner.
    const errors = (diagnostics ?? []).filter((d: any) => (d.severity ?? 1) === 1).length;
    setOwnerErrors(targetFs, "java-lsp", errors);
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

export { subscribeFileErrors, clearFileErrors, setupDiagnostics, setOwnerErrors, clearOwnerForFile, fsKeyOfUri, fsKeyOfModel };
