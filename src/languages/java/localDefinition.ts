// Respaldo local: busca la declaración en los modelos Java abiertos.
// Extraído de src/lsp.js sin cambios de lógica.
import { escapeRegExp } from "../../services/text/regex";
// Búsqueda local de la declaración de `name` en los modelos Java abiertos.
// Respaldo cuando el LSP no responde o no conoce el símbolo (p. ej. métodos
// del propio proyecto): devuelve Location[] de Monaco con el rango sobre el
// NOMBRE declarado, para que el cursor caiga sobre él.
function findLocalDefinition(monaco: any, model: any, name: any, usagePosition: any) {
  const esc = escapeRegExp(name);
  const models = [
    model,
    ...monaco.editor
      .getModels()
      .filter((m: any) => m !== model && m.getLanguageId() === "java"),
  ];
  // 1. Declaraciones de tipo: `class|interface|enum|record Nombre`
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
      // No es la propia línea de uso si coincide
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
// Solo vale: modificador/tipo antes, o `{` tras el paréntesis sin nada antes
// (constructor paquete `Foo() {`). Un `foo(x);` o `getLogger().info(`
// NUNCA califica, aunque haya otro uso en otra línea.
function isMethodDecl(before: any, after: any) {
  const beforeT = before.trim();
  // Cola propia de usos: asignación, llamada anidada, return/throw, `new`,
  // lambda, ternario, `this`/`super`, acceso, llaves o varias sentencias.
  const badTail =
    /(=|\(|,|;|\{|\}|\breturn\b|\bnew\b|\bsuper\b|\bthis\b|\bassert\b|\bthrow\b|\byield\b|\belse\b|->|:|\?|\.|!)\s*$/.test(
      before
    );
  const hasModifier =
    /(^|[^\w$])(public|protected|private|static|final|abstract|synchronized|native|default|transient|volatile)\b/.test(
      before
    );
  // Termina en tipo (no en cola de uso): `int foo(`, `boolean add(`
  const endsType = /[\w<>\[\].?]+\s*$/.test(beforeT) && !badTail;
  if (hasModifier || endsType) return true;
  // `{` tras el `)` en la misma línea con nada antes (ctor paquete)
  if (beforeT === "" && !badTail && /\)\s*(throws\b[^\n{]*\{|\{)/.test(after)) return true;
  return false;
}
  // Declaraciones de método/constructor: `Nombre(` con pinta de
  // declaración (nunca otro uso: ver isMethodDecl).
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
      // Llamada `obj.metodo(` o referencia `Clase::metodo`: no es declaración
      if (before.endsWith(".") || before.endsWith("::")) continue;
      // `new Foo(` es uso del constructor, no su declaración
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
