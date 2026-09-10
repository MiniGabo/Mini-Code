// Autocompletado: sugerencias + auto-import + resolve de docs.
import { KIND_MAP, docToMarkdown, lspRangeToMonaco, lspTextEditToMonaco } from "./translate";
import { dedupedLspRequest } from "../../services/lsp/request";
import { escapeRegExp } from "../../services/text/regex";
// Item crudo del servidor por sugerencia (para completionItem/resolve).
// WeakMap: Monaco devuelve el mismo objeto a resolveCompletionItem.
const completionRawBySuggestion = new WeakMap();

// Auto-import al aceptar una clase del autocompletado.
function importEditForClass(model: any, fqn: any) {
  if (typeof fqn !== "string") return null;
  const dot = fqn.lastIndexOf(".");
  if (dot <= 0 || fqn.includes("/") || /\s/.test(fqn)) return null;
  const simple = fqn.slice(dot + 1);
  if (!/^[A-Z]/.test(simple)) return null; // solo clases
  let text = "";
  try {
    text = model.getValue();
  } catch {
    return null;
  }
  const esc = escapeRegExp(fqn);
  // Ya importada explícitamente
  if (new RegExp(`^\\s*import\\s+(?:static\\s+)?${esc}\\s*;`, "m").test(text)) return null;
  const filePkgMatch = /^\s*package\s+([\w.]+)\s*;/m.exec(text);
  const filePkg = filePkgMatch ? filePkgMatch[1] : null;
  const classPkg = fqn.slice(0, dot);
  if (filePkg && classPkg === filePkg) return null; // mismo paquete
  if (classPkg === "java.lang") return null; // implícito
  // Cubierta por import con wildcard del mismo paquete
  if (new RegExp(`^\\s*import\\s+${escapeRegExp(classPkg)}\\.\\*\\s*;`, "m").test(text)) {
    return null;
  }
  const lines = text.split("\n");
  let packageLine = -1;
  let lastImportLine = -1;
  let insertLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (packageLine === -1 && /^\s*package\s+[\w.]+\s*;\s*$/.test(lines[i])) {
      packageLine = i;
    }
    const m = /^\s*import\s+(static\s+)?([\w.]+(?:\.\*)?)\s*;\s*$/.exec(lines[i]);
    if (!m) continue;
    lastImportLine = i;
    if (insertLine === -1 && !m[1] && fqn < m[2]) insertLine = i;
  }
  if (insertLine === -1) {
    if (lastImportLine !== -1) insertLine = lastImportLine + 1;
    else if (packageLine !== -1) insertLine = packageLine + 1;
    else insertLine = 0;
  }
  return {
    range: {
      startLineNumber: insertLine + 1,
      startColumn: 1,
      endLineNumber: insertLine + 1,
      endColumn: 1,
    },
    text: `import ${fqn};\n`,
  };
}

function suggestionFromLspItem(monaco: any, model: any, item: any, range: any) {
  const label = typeof item.label === "string" ? item.label : item.label?.label ?? "";
  // El servidor manda métodos como snippet ("nombre($0)"): sin esta
  // regla Monaco inserta el "$0" como texto literal.
  const isSnippet = item.insertTextFormat === 2;
  // textEdit del servidor (si viene) manda sobre el rango de la palabra.
  let useRange = range;
  let insertText = item.insertText ?? label;
  if (item.textEdit?.newText != null) {
    insertText = item.textEdit.newText;
    const r = item.textEdit.range ? lspRangeToMonaco(item.textEdit.range) : null;
    if (r) useRange = r;
  } else if (item.textEdit?.newText === undefined && typeof item.textEdit === "string") {
    insertText = item.textEdit;
  }
  const suggestion = {
    label: { label, detail: item.detail ?? "", description: item.kind === 7 ? item.detail ?? "" : undefined },
    kind: KIND_MAP[item.kind] ?? 13,
    detail: item.detail ?? "",
    documentation: docToMarkdown(item.documentation),
    insertText,
    insertTextRules: isSnippet
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : undefined,
    // Auto-import: el servidor puede traer additionalTextEdits (p. ej. el
    // import de la clase aceptada) y Monaco los aplica al aceptar. Como este
    // servidor no los manda, se sintetizan aquí para clases con FQN conocido.
    additionalTextEdits: (() => {
      if (Array.isArray(item.additionalTextEdits)) {
        const edits = item.additionalTextEdits.map(lspTextEditToMonaco).filter(Boolean);
        if (edits.length > 0) return edits;
      }
      // LSP CompletionItemKind.Class = 7: la sugerencia trae el FQN en
      // data.className (o en detail como respaldo).
      if (item.kind === 7) {
        const fqn =
          (item.data && typeof item.data.className === "string" && item.data.className) ||
          (typeof item.detail === "string" && item.detail.includes(".") ? item.detail : null);
        const edit = fqn ? importEditForClass(model, fqn) : null;
        if (edit) return [edit];
      }
      return undefined;
    })(),
    // Ej. "editor.action.triggerParameterHints" tras completar métodos
    command:
      item.command?.command != null
        ? {
            id: item.command.command,
            title: item.command.title ?? item.command.command,
          }
        : undefined,
    filterText: item.filterText ?? label,
    sortText: item.sortText ?? label,
    range: useRange,
  };
  try {
    completionRawBySuggestion.set(suggestion, item);
  } catch {
    // best-effort
  }
  return suggestion;
}

async function resolveSuggestionDocs(suggestion: any) {
  let raw = null;
  try {
    raw = completionRawBySuggestion.get(suggestion);
  } catch {
    raw = null;
  }
  // Sin data del servidor no hay nada que resolver (keywords, snippets...).
  // Si ya trae documentación inline tampoco se pide nada.
  if (!raw || raw.data == null || suggestion.documentation) return suggestion;
  try {
    const resolved = await dedupedLspRequest("completionItem/resolve", raw);
    if (!resolved) return suggestion;
    // Firma completa + javadoc (+ overloads): es lo que alimenta el panel
    // de detalle al lado de cada método en el widget de sugerencias.
    if (resolved.detail && !suggestion.documentation) {
      suggestion.detail = resolved.detail;
      if (suggestion.label && typeof suggestion.label === "object") {
        suggestion.label = { ...suggestion.label, detail: resolved.detail };
      }
    }
    const doc = docToMarkdown(resolved.documentation);
    if (doc) suggestion.documentation = doc;
    if (Array.isArray(resolved.additionalTextEdits)) {
      const edits = resolved.additionalTextEdits.map(lspTextEditToMonaco).filter(Boolean);
      if (edits.length > 0) suggestion.additionalTextEdits = edits;
    }
  } catch {
    // resolve best-effort: la sugerencia sigue válida sin docs
  }
  return suggestion;
}

export { suggestionFromLspItem, resolveSuggestionDocs };
