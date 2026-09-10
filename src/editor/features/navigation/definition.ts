// Go-to-definition: LSP first, local fallback after.
// Extracted from src/lsp.js with no logic changes.
import { dedupedLspRequest } from "../../../services/lsp/request";
import { definitionToLocations } from "../../../languages/java/translate";
import { symbolAt } from "../../../languages/java/javaText";
import { findLocalDefinition } from "../../../languages/java/localDefinition";
import { getOpenFileByPath, setPendingReveal } from "./bridges";
// Resolves the definition of classes AND methods at `position`:
// 1) asks the LSP; 2) if the LSP knows nothing, searches the declaration in
// the open models. Always returns Monaco Location[] (empty if
// none). Returned locations ALWAYS use the canonical URI of the
// open model (not the LSP one, whose normalization may differ): without
// this the Ctrl+hover preview breaks with "Model not found".
//
// `allowOpenFile` is only used by explicit Ctrl+Click: the provider feeding
// the native hover/preview NEVER opens tabs as a
// side effect (a hover must not open files).
async function resolveDefinition(monaco: any, model: any, position: any, opts: any = {}) {
  const allowOpenFile = opts.allowOpenFile === true;
  // Virtual tabs: the server does not know decompiled:// and each request
  // would hang until timeout. Goes straight to the local fallback.
  let isVirtual = false;
  try {
    isVirtual = model.uri.scheme !== "file";
  } catch {
    isVirtual = false;
  }
  if (!isVirtual) {
  try {
    // Position normalized to the start of the word: Ctrl+Click triggers
    // TWO resolutions of the same symbol (Monaco's native one via the
    // provider for peek/navigation, and the explicit one from mouseUp to
    // open tabs). With the raw click column they differed by 1-2
    // characters and the server saw them as 2 different requests; anchoring
    // to the start of the word both emit identical params and the global dedup
    // (dedupedLspRequest) collapses them into a single round-trip.
    // Requesting the definition at the first character of the word is equivalent
    // (the server resolves the token under the offset) and does not change the result.
    let reqLine = position.lineNumber - 1;
    let reqChar = position.column - 1;
    try {
      const w = model.getWordAtPosition(position);
      if (w) reqChar = w.startColumn - 1;
    } catch {
      // raw position
    }
    const result = await dedupedLspRequest("textDocument/definition", {
      textDocument: { uri: model.uri.toString() },
      position: { line: reqLine, character: reqChar },
    });
    const lspLocs = result ? definitionToLocations(monaco, result) : [];
    const javaLocs = lspLocs.filter((loc: any) => {
      try {
        return (
          loc.uri.scheme === "file" &&
          loc.uri.fsPath.toLowerCase().endsWith(".java")
        );
      } catch {
        return false;
      }
    });
    if (javaLocs.length > 0) {
      // The LSP knows the symbol: forwards its answer.
      const kept = [];
      for (const loc of javaLocs) {
        const openModel = modelForFs(monaco, loc.uri.fsPath);
        if (openModel) {
          // Canonical URI of the open model: required for the
          // native preview to find the model.
          kept.push({ uri: openModel.uri, range: loc.range });
          continue;
        }
        // Other file: only open a tab on explicit Ctrl+Click.
        const opener = getOpenFileByPath();
        if (allowOpenFile && opener) {
          // Registered BEFORE opening: the tab may mount (and read
          // the pending jump) as soon as the setState is processed, before
          // the await finishes. If opening fails it is cleared.
          setPendingReveal({
            fs: loc.uri.fsPath.toLowerCase(),
            lineNumber: loc.range.startLineNumber,
            column: loc.range.startColumn,
            symbol: symbolAt(model, position),
          });
          try {
            await opener(loc.uri.fsPath);
          } catch {
            setPendingReveal(null);
            continue;
          }
          kept.push(loc);
        }
      }
      return kept;
    }
  } catch {
    // no server or timeout: the local fallback is tried
  }
  } // end of if (!isVirtual)
  const name = symbolAt(model, position);
  if (!name) return [];
  return findLocalDefinition(monaco, model, name, position);
}

// Full resolution with file opening: used by explicit Ctrl+Click
// from EditorPane (the hover provider never opens tabs).
function resolveDefinitionForClick(monaco: any, model: any, position: any) {
  return resolveDefinition(monaco, model, position, { allowOpenFile: true });
}

// Navigable symbol under a position (class or method; never keywords).
// Used by EditorPane to underline on Ctrl+hover.
function navigableSymbolAt(monaco: any, model: any, position: any) {
  void monaco;
  return symbolAt(model, position);
}
function modelForFs(monaco: any, fsPath: any) {
  const want = fsPath.toLowerCase();
  return (
    monaco.editor.getModels().find((m: any) => {
      try {
        return m.uri.fsPath.toLowerCase() === want;
      } catch {
        return false;
      }
    }) ?? null
  );
}

export { resolveDefinition, resolveDefinitionForClick, navigableSymbolAt };
