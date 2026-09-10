// Registro de providers Monaco para `java` (completion, hover, signature,
// definition, codeActions). Extraído de src/lsp.js sin cambios de lógica.
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
// Caché del suplemento externo del hover (firma+javadoc): evita repetir el
// resolve en cada movimiento del ratón sobre el mismo símbolo.
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
  // Exactamente un juego por sesión, aunque este módulo se re-ejecute
  // (HMR del dev recarga /src pero no node_modules). La marca vive en
  // window: el objeto monaco importado está congelado (no extensible).
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
        // Firma (detail) + javadoc (documentation vía resolve) + auto-import
        // (additionalTextEdits): suggestionFromLspItem/resolveCompletionItem.
        const suggestions = items.map((item: any) => suggestionFromLspItem(monaco, model, item, range));
        // Dedup por (kind,label): el mismo método puede venir con y sin
        // snippet según la ruta del servidor. Se queda el que inserta
        // paréntesis (el Tab acepta el resaltado y el clic el elegido, y sin
        // esto podían tomar variantes distintas). Sin duplicados no cambia
        // nada porque gana el primero.
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
    // Panel de detalle al lado de cada sugerencia: firma completa y javadoc.
    // El servidor lo sirve en completionItem/resolve (resolveProvider=true).
    // Best-effort: si falla, la sugerencia sigue válida sin docs.
    resolveCompletionItem(item: any) {
      return resolveSuggestionDocs(item);
    },
  });

  // Quick fixes (bombilla / Ctrl+. y enlace "Quick Fix..." del hover sobre
  // el error). El caso principal es "cannot resolve": escribir `List` a mano
  // (o aceptarlo sin import) deja un diagnóstico de error, y aquí el
  // servidor devuelve un "Import '...'" por cada clase candidata del
  // JDK/dependencias para elegir. Se conserva el orden del servidor.
  // NOTA: cada acción lleva `diagnostics` con el marker de Monaco: sin eso
  // el hover del error no muestra el enlace "Quick Fix...".
  monaco.languages.registerCodeActionProvider("java", {
    async provideCodeActions(model: any, range: any, context: any) {
      try {
        if (model.uri.scheme !== "file") return { actions: [], dispose() {} };
      } catch {
        return { actions: [], dispose() {} };
      }
      try {
        // Diagnósticos del propio archivo que solapan el rango pedido (es lo
        // que decide si el servidor responde quick fixes o acciones de cursor).
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
            // Monaco manda `only` como string ("quickfix") en el hover y
            // como undefined en la bombilla; el servidor lo exige como
            // array (List<String>) y revienta si llega string.
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
      // Pestañas virtuales: sin LSP y sin resolveExternal (evita colgar el
      // hover con descompilaciones y timeouts de 20s en decompiled://).
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
        // el servidor falla con algunos heredados (p. ej. "no method"):
        // se intenta el suplemento externo abajo
      }
      // Suplemento para dependencias: el servidor no documenta símbolos
      // externos/heredados; se muestra la firma (+ javadoc si hay fuente).
      // Con timeout para no colgar el hover si hay que descompilar, más
      // caché + dedup en vuelo: el hover se dispara en cada movimiento del
      // ratón y sin esto cada hover encolaba un resolveExternal completo
      // (mvn de minutos) que atascaba los Ctrl+Click posteriores.
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
          // Caché acotada: el hover genera muchas claves distintas
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
