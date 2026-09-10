// Local fallback: searches the declaration in the open Java models.
// Extracted from src/lsp.js with no logic changes.
import { escapeRegExp } from "../../services/text/regex";
// Local search for the declaration of `name` in the open Java models.
// Fallback when the LSP does not answer or does not know the symbol (e.g. methods
// of the project itself): returns Monaco Location[] with the range over the
// declared NAME, so the cursor lands on it.
function findLocalDefinition(monaco: any, model: any, name: any, usagePosition: any) {
  const esc = escapeRegExp(name);
  const models = [
    model,
    ...monaco.editor
      .getModels()
      .filter((m: any) => m !== model && m.getLanguageId() === "java"),
  ];
  // 1. Type declarations: `class|interface|enum|record Name`
  for (const m of models) {
    let matches = [];
    try {
      matches = m.findMatches(
        `(class|interface|enum|record)\\s+${esc}\\b`,
        false,
        true,
        false,
        null,
        true
      );
    } catch {
      matches = [];
    }
    const hit = matches.find((mt: any) => {
      const r = mt.range;
      // Not the usage line itself if it matches
      return !(
        m === model &&
        usagePosition &&
        r.startLineNumber === usagePosition.lineNumber &&
        usagePosition.column >= r.startColumn &&
        usagePosition.column <= r.endColumn
      );
    });
    if (hit) {
      const full = hit.matches?.[0] ?? "";
      const idx = full.lastIndexOf(name);
      const startColumn = hit.range.startColumn + (idx >= 0 ? idx : 0);
      return [
        {
          uri: m.uri,
          range: {
            startLineNumber: hit.range.startLineNumber,
            startColumn,
            endLineNumber: hit.range.startLineNumber,
            endColumn: startColumn + name.length,
          },
        },
      ];
    }
  }
// Only valid: modifier/type before, or `{` after the parenthesis with nothing before
// (package-private constructor `Foo() {`). A `foo(x);` or `getLogger().info(`
// NEVER qualifies, even if there is another usage on another line.
function isMethodDecl(before: any, after: any) {
  const beforeT = before.trim();
  // Typical usage tail: assignment, nested call, return/throw, `new`,
  // lambda, ternary, `this`/`super`, access, braces or multiple statements.
  const badTail =
    /(=|\(|,|;|\{|\}|\breturn\b|\bnew\b|\bsuper\b|\bthis\b|\bassert\b|\bthrow\b|\byield\b|\belse\b|->|:|\?|\.|!)\s*$/.test(
      before
    );
  const hasModifier =
    /(^|[^\w$])(public|protected|private|static|final|abstract|synchronized|native|default|transient|volatile)\b/.test(
      before
    );
  // Ends in a type (not in a usage tail): `int foo(`, `boolean add(`
  const endsType = /[\w<>\[\].?]+\s*$/.test(beforeT) && !badTail;
  if (hasModifier || endsType) return true;
  // `{` after `)` on the same line with nothing before (package ctor)
  if (beforeT === "" && !badTail && /\)\s*(throws\b[^\n{]*\{|\{)/.test(after)) return true;
  return false;
}
  // Method/constructor declarations: `Name(` looking like a
  // declaration (never another usage: see isMethodDecl).
  for (const m of models) {
    let matches = [];
    try {
      matches = m.findMatches(`\\b${esc}\\s*\\(`, false, true, false, null, true);
    } catch {
      matches = [];
    }
    if (matches.length === 0) continue;
    const isUsageLine = (r: any) =>
      m === model &&
      usagePosition &&
      r.startLineNumber === usagePosition.lineNumber &&
      usagePosition.column >= r.startColumn &&
      usagePosition.column <= r.endColumn + 1;
    for (const mt of matches) {
      const r = mt.range;
      if (isUsageLine(r)) continue;
      let line = "";
      try {
        line = m.getLineContent(r.startLineNumber);
      } catch {
        line = "";
      }
      const before = line.slice(0, r.startColumn - 1).replace(/\s+$/, "");
      // Call `obj.method(` or reference `Class::method`: not a declaration
      if (before.endsWith(".") || before.endsWith("::")) continue;
      // `new Foo(` is a constructor usage, not its declaration
      if (/(^|[^\w$])new$/.test(before)) continue;
      const after = line.slice(r.endColumn - 1);
      if (!isMethodDecl(before, after)) continue;
      return [
        {
          uri: m.uri,
          range: {
            startLineNumber: r.startLineNumber,
            startColumn: r.startColumn,
            endLineNumber: r.startLineNumber,
            endColumn: r.startColumn + name.length,
          },
        },
      ];
    }
  }
  return [];
}

export { findLocalDefinition };
