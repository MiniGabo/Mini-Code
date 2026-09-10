// Monaco provider registration for `java` (completion, hover, signature,
// definition, codeActions). Extracted from src/lsp.js with no logic changes.
import { trackMonaco } from "../../../services/editor/modelRegistry";
import { setupDiagnostics } from "../diagnostics/diagnostics";
import { dedupedLspRequest } from "../../../services/lsp/request";
import {
  docToMarkdown,
  hoverContents,
  lspTextEditToMonaco,
  markerSeverityToLsp,
  markerCodeToString,
} from "../../../languages/java/translate";
import { suggestionFromLspItem, resolveSuggestionDocs } from "../../../languages/java/completion";
import { resolveDefinition } from "../navigation/definition";
import { buildExternalQuery } from "../../../languages/java/externalQuery";
const JAVA_PROVIDERS_KEY = "__miniCodeJavaProviders";
// Cache for the external hover supplement (signature+javadoc): avoids repeating
// the resolve on every mouse movement over the same symbol.
const hoverExtCache: Map<string, { time: number; res: any }> = new Map(); // key -> { time, res }
const hoverExtInflight: Map<string, Promise<any>> = new Map(); // key -> Promise

function hoverResToValue(model: any, position: any, res: any) {
  const sig = (res.signature ?? "").trim();
  if (!sig && !res.doc) return null;
  const contents = [];
  if (sig) contents.push({ language: "java", value: sig });
  else contents.push({ value: `\`${res.symbol ?? ""}\`` });
  if (res.doc) contents.push({ value: res.doc });
  let word = null;
  try {
    word = model.getWordAtPosition(position);
  } catch {
    word = null;
  }
  return {
    range: word
      ? {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn,
        }
      : undefined,
    contents,
  };
}
function ensureJavaProviders(monaco: any) {
  trackMonaco(monaco);
  setupDiagnostics(monaco);
  // Exactly one set per session, even if this module re-executes
  // (dev HMR reloads /src but not node_modules). The flag lives on
  // window: the imported monaco object is frozen (non-extensible).
  if ((window as any)[JAVA_PROVIDERS_KEY]) return;
  (window as any)[JAVA_PROVIDERS_KEY] = true;

  monaco.languages.registerCompletionItemProvider("java", {
    triggerCharacters: ["."],
    async provideCompletionItems(model: any, position: any, context: any) {
      try {
        if (model.uri.scheme !== "file") return { suggestions: [] };
        const result = await dedupedLspRequest("textDocument/completion", {
          textDocument: { uri: model.uri.toString() },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
          context: {
            triggerKind: context.triggerKind,
            triggerCharacter: context.triggerCharacter,
          },
        });
        const items = result?.items ?? result ?? [];
        if (!Array.isArray(items) || items.length === 0) return { suggestions: [] };
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        // Signature (detail) + javadoc (documentation via resolve) + auto-import
        // (additionalTextEdits): suggestionFromLspItem/resolveCompletionItem.
        const suggestions = items.map((item: any) => suggestionFromLspItem(monaco, model, item, range));
        // Dedup by (kind,label): the same method may arrive with and without
        // snippet depending on the server path. Keep the one that inserts
        // parentheses (Tab accepts the highlighted one and click accepts the chosen one, and without
        // this they could pick different variants). With no duplicates nothing changes
        // because the first one wins.
        const byKey = new Map();
        for (const s of suggestions) {
          const labelStr = typeof s.label === "string" ? s.label : s.label?.label ?? "";
          const k = s.kind + "|" + labelStr;
          const prev = byKey.get(k);
          if (!prev) {
            byKey.set(k, s);
            continue;
          }
          const score = (x: any) =>
            (x.insertTextRules ? 2 : 0) + (/\(/.test(x.insertText ?? "") ? 1 : 0);
          if (score(s) > score(prev)) byKey.set(k, s);
        }
        return { suggestions: [...byKey.values()] };
      } catch {
        return { suggestions: [] };
      }
    },
    // Detail panel next to each suggestion: full signature and javadoc.
    // Served by the server via completionItem/resolve (resolveProvider=true).
    // Best-effort: if it fails, the suggestion is still valid without docs.
    resolveCompletionItem(item: any) {
      return resolveSuggestionDocs(item);
    },
  });

  // Quick fixes (lightbulb / Ctrl+. and "Quick Fix..." link in the hover over
  // the error). The main case is "cannot resolve": typing `List` by hand
  // (or accepting it without import) leaves an error diagnostic, and here the
  // server returns an "Import '...'" for each candidate class from the
  // JDK/dependencies to choose from. The server order is preserved.
  // NOTE: each action carries `diagnostics` with the Monaco marker: without it
  // the error hover does not show the "Quick Fix..." link.
  monaco.languages.registerCodeActionProvider("java", {
    async provideCodeActions(model: any, range: any, context: any) {
      try {
        if (model.uri.scheme !== "file") return { actions: [], dispose() {} };
      } catch {
        return { actions: [], dispose() {} };
      }
      try {
        // Diagnostics from the file itself overlapping the requested range (this is what
        // decides whether the server answers quick fixes or cursor actions).
        let markers = [];
        try {
          markers = monaco.editor.getModelMarkers({ resource: model.uri });
        } catch {
          markers = [];
        }
        const lspRange = {
          start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
          end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
        };
        const overlaps = (m: any) =>
          m.startLineNumber <= lspRange.end.line + 1 &&
          m.endLineNumber >= lspRange.start.line + 1;
        const ownMarkers = markers.filter(
          (m: any) => m.owner === "java-lsp" && m.severity === 8 && overlaps(m)
        );
        const diagnostics = ownMarkers.map((m: any) => ({
          range: {
            start: { line: m.startLineNumber - 1, character: m.startColumn - 1 },
            end: { line: m.endLineNumber - 1, character: m.endColumn - 1 },
          },
          severity: markerSeverityToLsp(m.severity),
          code: markerCodeToString(m.code),
          source: "java",
          message: m.message ?? "",
        }));
        const result = await dedupedLspRequest("textDocument/codeAction", {
          textDocument: { uri: model.uri.toString() },
          range: lspRange,
          context: {
            diagnostics,
            // Monaco sends `only` as a string ("quickfix") in the hover and
            // as undefined in the lightbulb; the server requires it as an
            // array (List<String>) and crashes if a string arrives.
            only: Array.isArray(context.only) ? context.only : ["quickfix"],
          },
        });
        if (!Array.isArray(result) || result.length === 0) {
          return { actions: [], dispose() {} };
        }
        const actions = [];
        for (const a of result) {
          if (!a || !a.title) continue;
          const edits = [];
          const changes = a.edit?.changes;
          if (changes && typeof changes === "object") {
            for (const uriStr of Object.keys(changes)) {
              let resource = null;
              try {
                resource = monaco.Uri.parse(uriStr);
              } catch {
                continue;
              }
              for (const t of changes[uriStr] ?? []) {
                const textEdit = lspTextEditToMonaco(t);
                if (textEdit) edits.push({ resource, textEdit, versionId: undefined });
              }
            }
          }
          if (edits.length === 0) continue;
          actions.push({
            title: a.title,
            kind: a.kind ?? "quickfix",
            diagnostics: ownMarkers,
            edit: { edits },
          });
        }
        return { actions, dispose() {} };
      } catch {
        return { actions: [], dispose() {} };
      }
    },
  });

  monaco.languages.registerHoverProvider("java", {
    async provideHover(model: any, position: any) {
      // Virtual tabs: no LSP and no resolveExternal (avoids hanging the
      // hover with decompilations and 20s timeouts on decompiled://).
      try {
        if (model.uri.scheme !== "file") return null;
      } catch {
        return null;
      }
      try {
        const result = await dedupedLspRequest("textDocument/hover", {
          textDocument: { uri: model.uri.toString() },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        });
        if (result?.contents) {
          const contents = hoverContents(result.contents);
          if (contents.length > 0) {
            return {
              range: result.range
                ? {
                    startLineNumber: result.range.start.line + 1,
                    startColumn: result.range.start.character + 1,
                    endLineNumber: result.range.end.line + 1,
                    endColumn: result.range.end.character + 1,
                  }
                : undefined,
              contents,
            };
          }
        }
      } catch {
        // the server fails with some inherited ones (e.g. "no method"):
        // the external supplement below is tried
      }
      // Supplement for dependencies: the server does not document
      // external/inherited symbols; the signature is shown (+ javadoc if source is available).
      // With a timeout to avoid hanging the hover when decompiling, plus
      // cache + in-flight dedup: hover fires on every mouse movement and without
      // this each hover would queue a full resolveExternal
      // (minutes-long mvn) that blocked subsequent Ctrl+Clicks.
      try {
        const ext = buildExternalQuery(model, position);
        if (!ext) return null;
        const cacheKey = JSON.stringify([ext.candidates, ext.member]);
        const now = Date.now();
        const cached = hoverExtCache.get(cacheKey);
        if (cached && now - cached.time < 30000) {
          if (!cached.res?.ok) return null;
          return hoverResToValue(model, position, cached.res);
        }
        const inflight = hoverExtInflight.get(cacheKey);
        if (inflight) {
          const res = await inflight;
          if (!res?.ok) return null;
          return hoverResToValue(model, position, res);
        }
        let contextDir = null;
        try {
          if (model.uri.scheme === "file" && model.uri.fsPath) {
            const p = model.uri.fsPath;
            const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
            contextDir = idx > 0 ? p.slice(0, idx) : null;
          }
        } catch {
          contextDir = null;
        }
        const promise = (async () => {
          const res = await Promise.race([
            window.electronAPI?.resolveExternal({ ...ext, token: ext.candidates[0], contextDir }),
            new Promise((resolve) => setTimeout(() => resolve(null), 2500)),
          ]);
          hoverExtCache.set(cacheKey, { time: Date.now(), res });
          // Bounded cache: hover generates many distinct keys
          if (hoverExtCache.size > 200) {
            const first = hoverExtCache.keys().next().value;
            if (first) hoverExtCache.delete(first);
          }
          return res;
        })();
        hoverExtInflight.set(cacheKey, promise);
        let res: any = null;
        try {
          res = await promise;
        } finally {
          hoverExtInflight.delete(cacheKey);
        }
        if (!res?.ok) return null;
        return hoverResToValue(model, position, res);
      } catch {
        return null;
      }
    },
  });

  monaco.languages.registerSignatureHelpProvider("java", {
    signatureHelpTriggerCharacters: ["(", ","],
    async provideSignatureHelp(model: any, position: any) {
      try {
        if (model.uri.scheme !== "file") return null;
        const result = await dedupedLspRequest("textDocument/signatureHelp", {
          textDocument: { uri: model.uri.toString() },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        });
        if (!result?.signatures?.length) return null;
        return {
          value: {
            signatures: result.signatures.map((s: any) => ({
              label: s.label ?? "",
              documentation: docToMarkdown(s.documentation),
              parameters: (s.parameters ?? []).map((p: any) => ({
                label: p.label ?? "",
                documentation: docToMarkdown(p.documentation),
              })),
            })),
            activeSignature: result.activeSignature ?? 0,
            activeParameter: result.activeParameter ?? 0,
          },
          dispose: () => {},
        };
      } catch {
        return null;
      }
    },
  });

  monaco.languages.registerDefinitionProvider("java", {
    async provideDefinition(model: any, position: any) {
      try {
        if (model.uri.scheme !== "file") return [];
      } catch {
        return [];
      }
      return resolveDefinition(monaco, model, position);
    },
  });
}

export { ensureJavaProviders };
