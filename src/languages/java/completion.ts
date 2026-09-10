// Autocompletion: suggestions + auto-import + docs resolve.
import { KIND_MAP, docToMarkdown, lspRangeToMonaco, lspTextEditToMonaco } from "./translate";
import { dedupedLspRequest } from "../../services/lsp/request";
import { escapeRegExp } from "../../services/text/regex";
// Raw server item per suggestion (for completionItem/resolve).
// WeakMap: Monaco returns the same object to resolveCompletionItem.
const completionRawBySuggestion = new WeakMap();

// Auto-import when accepting a class from autocompletion.
function importEditForClass(model: any, fqn: any) {
  if (typeof fqn !== "string") return null;
  const dot = fqn.lastIndexOf(".");
  if (dot <= 0 || fqn.includes("/") || /\s/.test(fqn)) return null;
  const simple = fqn.slice(dot + 1);
  if (!/^[A-Z]/.test(simple)) return null; // only classes
  let text = "";
  try {
    text = model.getValue();
  } catch {
    return null;
  }
  const esc = escapeRegExp(fqn);
  // Already explicitly imported
  if (new RegExp(`^\\s*import\\s+(?:static\\s+)?${esc}\\s*;`, "m").test(text)) return null;
  const filePkgMatch = /^\s*package\s+([\w.]+)\s*;/m.exec(text);
  const filePkg = filePkgMatch ? filePkgMatch[1] : null;
  const classPkg = fqn.slice(0, dot);
  if (filePkg && classPkg === filePkg) return null; // same package
  if (classPkg === "java.lang") return null; // implicit
  // Covered by a wildcard import from the same package
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
  // The server sends methods as snippets ("name($0)"): without this
  // rule Monaco inserts "$0" as literal text.
  const isSnippet = item.insertTextFormat === 2;
  // Server textEdit (if present) takes precedence over the word range.
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
    // Auto-import: the server may bring additionalTextEdits (e.g. the
    // import of the accepted class) and Monaco applies them on accept. Since this
    // server does not send them, they are synthesized here for classes with a known FQN.
    additionalTextEdits: (() => {
      if (Array.isArray(item.additionalTextEdits)) {
        const edits = item.additionalTextEdits.map(lspTextEditToMonaco).filter(Boolean);
        if (edits.length > 0) return edits;
      }
      // LSP CompletionItemKind.Class = 7: the suggestion carries the FQN in
      // data.className (or in detail as a fallback).
      if (item.kind === 7) {
        const fqn =
          (item.data && typeof item.data.className === "string" && item.data.className) ||
          (typeof item.detail === "string" && item.detail.includes(".") ? item.detail : null);
        const edit = fqn ? importEditForClass(model, fqn) : null;
        if (edit) return [edit];
      }
      return undefined;
    })(),
    // E.g. "editor.action.triggerParameterHints" after completing methods
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
  // Without server data there is nothing to resolve (keywords, snippets...).
  // If it already carries inline documentation nothing is requested either.
  if (!raw || raw.data == null || suggestion.documentation) return suggestion;
  try {
    const resolved = await dedupedLspRequest("completionItem/resolve", raw);
    if (!resolved) return suggestion;
    // Full signature + javadoc (+ overloads): this feeds the detail panel
    // next to each method in the suggestion widget.
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
    // best-effort resolve: the suggestion is still valid without docs
  }
  return suggestion;
}

export { suggestionFromLspItem, resolveSuggestionDocs };
