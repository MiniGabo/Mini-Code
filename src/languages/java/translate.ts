// LSP CompletionItemKind (1-25) -> monaco.languages.CompletionItemKind
const KIND_MAP: Record<number, number> = {
  1: 18, // Text
  2: 0, // Method
  3: 1, // Function
  4: 2, // Constructor
  5: 3, // Field
  6: 4, // Variable
  7: 5, // Class
  8: 7, // Interface
  9: 8, // Module
  10: 9, // Property
  11: 12, // Unit
  12: 13, // Value
  13: 15, // Enum
  14: 17, // Keyword
  15: 27, // Snippet
  16: 19, // Color
  17: 20, // File
  18: 21, // Reference
  19: 23, // Folder
  20: 16, // EnumMember
  21: 14, // Constant
  22: 6, // Struct
  23: 10, // Event
  24: 11, // Operator
  25: 24, // TypeParameter
};

// LSP DiagnosticSeverity (1-4) -> monaco.MarkerSeverity (8/4/2/1)
const SEVERITY_MAP: Record<number, number> = { 1: 8, 2: 4, 3: 2, 4: 1 };

function docToMarkdown(doc: any) {
  if (doc == null) return undefined;
  if (typeof doc === "string") return { value: doc };
  if (typeof doc.value === "string") return { value: doc.value };
  return undefined;
}

// LSP Range (0-based) -> Monaco Range (1-based)
function lspRangeToMonaco(r: any) {
  if (!r) return null;
  return {
    startLineNumber: r.start.line + 1,
    startColumn: r.start.character + 1,
    endLineNumber: r.end.line + 1,
    endColumn: r.end.character + 1,
  };
}

// LSP TextEdit -> Monaco textEdit ({ range, text })
function lspTextEditToMonaco(t: any) {
  if (!t) return null;
  const range = lspRangeToMonaco(t.range);
  if (!range) return null;
  return { range, text: t.newText ?? "" };
}

// Monaco MarkerSeverity -> LSP DiagnosticSeverity (1-4)
function markerSeverityToLsp(s: any) {
  if (s === 8) return 1; // Error
  if (s === 4) return 2; // Warning
  if (s === 2) return 3; // Info
  return 4; // Hint
}

function markerCodeToString(code: any) {
  if (code == null) return undefined;
  if (typeof code === "string" || typeof code === "number") return String(code);
  if (typeof code.value === "string" || typeof code.value === "number") {
    return String(code.value);
  }
  return undefined;
}
function hoverContents(contents: any) {
  const list = Array.isArray(contents) ? contents : [contents];
  return list
    .map((c: any) => {
      if (typeof c === "string") return { value: c };
      if (c && typeof c.value === "string") {
        // MarkedString { language, value } -> code block
        if (c.language) return { value: "```" + c.language + "\n" + c.value + "\n```" };
        return { value: c.value };
      }
      return null;
    })
    .filter(Boolean);
}

function definitionToLocations(monaco: any, def: any): any {
  const list = Array.isArray(def) ? def : [def];
  return list
    .map((d: any) => {
      if (!d) return null;
      // LocationLink (targetUri) or Location (uri)
      const uri = d.targetUri ?? d.uri;
      const range = d.targetSelectionRange ?? d.targetRange ?? d.range;
      if (!uri || !range) return null;
      return {
        uri: monaco.Uri.parse(uri),
        range: {
          startLineNumber: range.start.line + 1,
          startColumn: range.start.character + 1,
          endLineNumber: range.end.line + 1,
          endColumn: range.end.character + 1,
        },
      };
    })
    .filter(Boolean);
}

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
};
