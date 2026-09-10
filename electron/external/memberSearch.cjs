function lineColOf(text, index) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function charBeforeIsDotOrRef(text, idx) {
  let i = idx - 1;
  while (i >= 0 && /\s/.test(text[i])) i--;
  if (i < 0) return false;
  if (text[i] === "." || text[i] === ":") return true;
  const tail = text.slice(Math.max(0, i - 3), i + 1);
  return /(^|[^\w$])new$/.test(tail);
}
function isMethodDeclBefore(before) {
  const beforeT = before.trim();
  // Tail typical of usages: assignment, nested call, return/throw, `new`,
  // `this`/`super`, lambda, ternary, access, braces or multiple statements.
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
  return { hasModifier, endsType, badTail, beforeT };
}
function braceAfterParen(text, openIdx) {
  let depth = 0;
  let state = null;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (state === '"') {
      if (c === "\\") i++;
      else if (c === '"') state = null;
      continue;
    }
    if (state === "'") {
      if (c === "\\") i++;
      else if (c === "'") state = null;
      continue;
    }
    if (state === "//") {
      if (c === "\n") return false; // end of line without `{`: not a block
      continue;
    }
    if (state === "/*") {
      if (c === "*" && next === "/") {
        state = null;
        i++;
      }
      continue;
    }
    if (c === '"') state = '"';
    else if (c === "'") state = "'";
    else if (c === "/" && next === "/") state = "//";
    else if (c === "/" && next === "*") state = "/*";
    else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        const rest = text.slice(i + 1).split("\n", 1)[0];
        return /^\s*\{/.test(rest) || /^\s*throws\b[^\n;{]*\{/.test(rest);
      }
    } else if (c === ";" && depth === 1) {
      return false; // `;` before closing: not a block declaration
    }
  }
  return false;
}
function findClassDecl(text, classSimpleName) {
  const re = new RegExp(
    `(?:^|[^\\w$])(?:class|interface|enum|record|@interface)\\s+(${escapeRegExp(classSimpleName)})\\b`
  );
  const m = re.exec(text);
  if (!m) return null;
  const idx = m.index + m[0].lastIndexOf(classSimpleName);
  return lineColOf(text, idx);
}
function formalParamInfo(text, openIdx) {
  let depth = 0;
  let commas = 0;
  let state = null;
  let body = "";
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (state === '"') {
      if (c === "\\") i++;
      else if (c === '"') state = null;
      body += c;
      continue;
    }
    if (state === "'") {
      if (c === "\\") i++;
      else if (c === "'") state = null;
      body += c;
      continue;
    }
    if (state === "//" || state === "/*") {
      if ((state === "//" && c === "\n") || (state === "/*" && c === "*" && next === "/")) {
        if (state === "/*") i++;
        state = null;
      }
      continue;
    }
    if (c === '"') { state = '"'; body += c; continue; }
    if (c === "'") { state = "'"; body += c; continue; }
    if (c === "/" && next === "/") { state = "//"; continue; }
    if (c === "/" && next === "*") { state = "/*"; continue; }
    if (c === "(") { depth++; if (depth > 1) body += c; continue; }
    if (c === ")") {
      depth--;
      if (depth === 0) {
        const trimmed = body.trim();
        return { count: trimmed === "" ? 0 : commas + 1, varargs: /\.\.\./.test(trimmed) };
      }
      body += c;
      continue;
    }
    if (c === "," && depth === 1) commas++;
    if (depth >= 1) body += c;
  }
  return null;
}
function findMethodInSource(text, member) {
  if (!member || member.kind !== "method") return null;
  const name = member.name;
  const re = new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`, "g");
  const decls = []; // { nameIdx, arityOk }
  const fallbacks = []; // looks like a declaration but with a different arity
  let m = null;
  while ((m = re.exec(text)) !== null) {
    const nameIdx = m.index + m[0].indexOf(name);
    if (charBeforeIsDotOrRef(text, nameIdx)) continue;
    const openIdx = m.index + m[0].length - 1;
    const lineStart = text.lastIndexOf("\n", nameIdx - 1) + 1;
    const before = text.slice(lineStart, nameIdx);
    const { hasModifier, endsType, badTail, beforeT } = isMethodDeclBefore(before);
    let looksDecl = hasModifier || endsType;
    // With nothing before (package-private ctor `Foo() {`): only `{` on the SAME line counts
    if (!looksDecl && beforeT === "" && !badTail && braceAfterParen(text, openIdx)) {
      looksDecl = true;
    }
    if (!looksDecl) continue;
    let arityOk = true;
    if (member.arity != null) {
      const info = formalParamInfo(text, openIdx);
      if (info) {
        arityOk = info.count === member.arity || (info.varargs && member.arity >= info.count - 1);
      }
    }
    (arityOk ? decls : fallbacks).push({ nameIdx });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  const best = decls[0] ?? fallbacks[0];
  if (best) return lineColOf(text, best.nameIdx);
  return null;
}
function findMemberInSource(text, member, classSimpleName) {
  const classDecl = findClassDecl(text, classSimpleName);
  if (!member || member.kind === "class") {
    return classDecl ?? { line: 1, column: 1 };
  }
  return findMethodInSource(text, member) ?? classDecl ?? { line: 1, column: 1 };
}
function parseSuperTypes(text, memberLine) {
  const lines = text.split("\n");
  const TYPE_RE = /(?:class|interface|enum|record)\s+[\w$]+(?:\s*<[^;{}]*>)?\s*(?:extends\s+([^\{;]+?))?\s*(?:implements\s+([^\{;]+?))?\s*(?:\{|permits\b|;)/;
  let declText = null;
  // Walk up from the member: the first line that CLOSES a scope going
  // up (an unmatched {) is the start of the owning type (or its header).
  let depth = 0;
  const top = Math.min(memberLine - 1, lines.length - 1);
  for (let i = top; i >= 0; i--) {
    for (const c of lines[i]) {
      if (c === "}") depth++;
      else if (c === "{") depth--;
    }
    if (depth < 0) {
      const joined = lines.slice(Math.max(0, i - 5), i + 1).join(" ");
      const m = TYPE_RE.exec(joined);
      if (m) declText = m;
      break;
    }
  }
  if (!declText) {
    // Fallback: first declaration in the file
    const m = TYPE_RE.exec(text);
    if (!m) return [];
    declText = m;
  }
  const splitTypes = (s) => {
    if (!s) return [];
    // strip <...> generics (nested) before splitting on commas
    let out = "";
    let dg = 0;
    for (const c of s) {
      if (c === "<") dg++;
      else if (c === ">") dg = Math.max(0, dg - 1);
      else if (dg === 0) out += c;
    }
    return out
      .split(",")
      .map((x) => x.trim().split(/\s+/).pop())
      .filter((x) => /^[A-Za-z_$][\w$.]*$/.test(x ?? ""));
  };
  return [...splitTypes(declText[1]), ...splitTypes(declText[2])];
}
function extractJavadoc(text, lineNumber) {
  const lines = text.split("\n");
  let i = lineNumber - 2;
  while (i >= 0 && (lines[i].trim() === "" || /^\s*@/.test(lines[i]))) i--;
  if (i < 0 || !lines[i].includes("*/")) return null;
  let j = i;
  while (j >= 0 && !lines[j].includes("/**")) {
    if (lines[j].includes("/*")) return null; // plain block, not javadoc
    j--;
  }
  if (j < 0) return null;
  const block = lines.slice(j, i + 1).join("\n");
  const cleaned = block
    .replace(/\/\*\*+/, "")
    .replace(/\*+\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").replace(/\s+$/, ""))
    .join("\n")
    .trim();
  return cleaned || null;
}
function findFieldType(sourceText, fieldName) {
  // `... Type name;` or `... Type name = ...` (javadoc/annotations and
  // optional modifiers before)
  const re = new RegExp(
    `(?:^|[;{}]|\\*/)\\s*(?:@[\\w$.]+(?:\\([^)]*\\))?\\s*)*(?:(?:public|protected|private|static|final|transient|volatile|synchronized|native|strictfp)\\s+)*` +
      `([A-Za-z_$][\\w$.]*(?:\\s*<[^;{}=]*>)?(?:\\s*\\[\\s*\\])*)\\s+${escapeRegExp(fieldName)}\\s*(?:[=;,])`
  );
  const m = re.exec(sourceText);
  if (!m) return null;
  return cleanType(m[1]);
}
function cleanType(t) {
  let s = (t ?? "").trim();
  s = s.replace(/^(?:final|volatile|transient)\s+/, "");
  // strip <...> generics (nested) and arrays
  let out = "";
  let depth = 0;
  for (const c of s) {
    if (c === "<") depth++;
    else if (c === ">") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += c;
  }
  s = out.replace(/\[\s*\]/g, "").trim();
  // `private List` -> last token; `java.util.List` untouched
  const parts = s.split(/\s+/);
  s = parts[parts.length - 1] ?? "";
  if (/^(byte|short|int|long|float|double|boolean|char|void)$/.test(s)) return null;
  return s || null;
}
// FQN candidates for a type name inside a source file (for the
// intermediate hops of `System.field.method`: the located source does
// bring its imports and its package).
function fqnCandidatesForType(sourceText, typeName) {
  const out = [];
  const push = (fqn) => {
    if (fqn && !out.includes(fqn)) out.push(fqn);
  };
  const dotted = typeName.split(".");
  const head = dotted[0];
  const rest = dotted.slice(1).join(".");
  const withRest = (h) => (rest ? h + "." + rest : h);
  const imps = [...sourceText.matchAll(/^import\s+(?!static\s)([\w.]+(?:\.\*)?)\s*;/gm)].map((x) => x[1]);
  for (const imp of imps) {
    if (imp === head || imp.endsWith("." + head)) push(withRest(imp));
    else if (imp.endsWith(".*")) push(withRest(imp.slice(0, -2) + "." + head));
  }
  const pkg = /^package\s+([\w.]+)\s*;/m.exec(sourceText);
  if (pkg) push(withRest(pkg[1] + "." + head));
  push(withRest("java.lang." + head));
  return out;
}
function simpleNameOf(fqn) {
  const parts = (fqn ?? "").split(".");
  return parts[parts.length - 1] ?? fqn;
}
function isOwnFqn(ownFqn, fqn) {
  const own = (ownFqn ?? "").toLowerCase();
  if (!own) return false;
  const lc = (fqn ?? "").toLowerCase();
  return lc === own || lc.startsWith(own + ".");
}

module.exports = {
  findClassDecl,
  findMethodInSource,
  findMemberInSource,
  parseSuperTypes,
  extractJavadoc,
  findFieldType,
  cleanType,
  fqnCandidatesForType,
  simpleNameOf,
  isOwnFqn,
};
