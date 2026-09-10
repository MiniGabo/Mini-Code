// External symbols (JDK / dependencies): the server does not resolve them
// (definition -> null), so the FQN is rebuilt here from the file imports
// and resolved in the main process (src.zip, -sources.jar or
// FernFlower). Only used when the normal flow found nothing.
// Returns { candidates: [fqn], fieldHops: [field], member } or null.
import { JAVA_KEYWORDS } from "./keywords";
import {
  packageOfText,
  importsOfText,
  fqnCandidatesForName,
  fqnTiersForName,
  tierOfHead,
  literalClassFromChain,
  ownFqnOfText,
  cleanVarType,
  findVarType,
  currentClassName,
  superClassName,
  directSupers,
  ownAndSuperCandidates,
  countCallArity,
} from "./javaText";
function buildExternalQuery(model: any, position: any) {
  let q: any = null;
  try {
    q = buildExternalQueryInner(model, position);
  } catch {
    return null;
  }
  if (!q) return null;
  // Never the current file's own class (avoids self-decompiling even if
  // the source index is outdated). Only real files: in
  // virtual tabs the "own" one is the dependency itself.
  let ownFqn = null;
  try {
    if (model.uri.scheme === "file") {
      const text = model.getValue();
      const cls = currentClassName(text);
      const pkg = packageOfText(text);
      if (cls) ownFqn = (pkg ? pkg + "." + cls : cls).toLowerCase();
    }
  } catch {
    ownFqn = null;
  }
  q.ownFqn = ownFqn;
  if (!ownFqn) return q;
  const kept = (q.candidates ?? []).filter((c: any) => {
    const lc = (c ?? "").toLowerCase();
    return lc !== ownFqn && !lc.startsWith(ownFqn + ".");
  });
  if (kept.length === 0) return null;
  q.candidates = kept;
  return q;
}

function buildExternalQueryInner(model: any, position: any) {
  let word = null;
  try {
    word = model.getWordAtPosition(position);
  } catch {
    return null;
  }
  if (!word || !word.word || JAVA_KEYWORDS.has(word.word)) return null;
  const name = word.word;
  let text = "";
  let lineText = "";
  try {
    text = model.getValue();
    lineText = model.getLineContent(position.lineNumber);
  } catch {
    return null;
  }
  const after = lineText.slice(word.endColumn - 1);
  const beforeRaw = lineText.slice(0, word.startColumn - 1);
  // `Collections.<String>emptyList(`: the explicit type is not a receiver
  const before = beforeRaw.replace(/\.\s*<[^<>]*>\s*$/, ".");
  const isCall = /^\s*\(/.test(after);

  // Click on an `import ...` line: the line ALREADY names the class, no need
  // to guess from imports (and avoids homonyms from other packages).
  const importStmt = /^\s*import\s+(static\s+)?([\w$.]+?)(\.\*)?\s*;\s*$/.exec(lineText);
  if (importStmt) {
    const isStatic = !!importStmt[1];
    const fqn = importStmt[2];
    const isStar = !!importStmt[3];
    const segs = fqn.split(".");
    if (segs.length < 2) return null;
    if (isStar) {
      // `import com.foo.*;` names no class: nothing to resolve.
      // `import static com.foo.Util.*;` does: the class is Util.
      if (!isStatic) return null;
      return { candidates: [fqn], fieldHops: [], member: { kind: "class", name: segs[segs.length - 1] }, primaryKind: "qualified" };
    }
    if (isStatic) {
      // `import static com.foo.Util.helper;`: the class is Util; if the click
      // is on `helper` the method is searched, otherwise the class.
      const clsFqn = segs.slice(0, -1).join(".");
      const last = segs[segs.length - 1];
      const member = name === last
        ? { kind: "method", name: last, arity: null }
        : { kind: "class", name: segs[segs.length - 2] };
      return { candidates: [clsFqn], fieldHops: [], member, primaryKind: "qualified" };
    }
    return { candidates: [fqn], fieldHops: [], member: { kind: "class", name: segs[segs.length - 1] }, primaryKind: "qualified" };
  }

  if (!isCall) {
    // Class (type ref, new X, extends...): by convention they start uppercase
    if (!/^[A-Z]/.test(name)) return null;
    // `new Name<>(` / `new Name(` / `new com.foo.Bar<>`: the diamond
    // hides that it is a call
    let member: any = { kind: "class", name };
    if (/(^|[^\w$.])new(?:\s+[\w$.]*)?\s*$/.test(before) && /^\s*(<[^<>]*>\s*)?\(/.test(after)) {
      const openIdx = lineText.indexOf("(", word.endColumn - 1);
      member = { kind: "method", name, arity: openIdx === -1 ? null : countCallArity(lineText, openIdx) };
    }
    // `com.foo.Bar` written as-is (the click is on Bar): literal FQN,
    // takes precedence over any import. Includes the name itself because it may
    // be an inner one (`a.b.C.D` lives in the source of `a.b.C`: main
    // trims alone).
    const chainMatchCls = beforeRaw.match(/([\w$]+(?:\.[\w$]+)*)\.\s*$/);
    if (chainMatchCls) {
      const prefix = chainMatchCls[1].split(".");
      if (prefix.length >= 1 && prefix.every((s: any) => /^[a-z_$][\w$]*$/.test(s)) && !prefix.includes("this") && !prefix.includes("super")) {
        return { candidates: [prefix.join(".") + "." + name], fieldHops: [], member, primaryKind: "qualified" };
      }
    }
    const candidates = [];
    // `Outer.Name` with the click on Name: also resolve the outer one
    const outerMatch = beforeRaw.match(/([\w$]+)\.\s*$/);
    let primaryKind = tierOfHead(text, name);
    if (outerMatch) {
      for (const ofqn of fqnCandidatesForName(text, outerMatch[1])) {
        candidates.push(ofqn + "." + name);
      }
      primaryKind = tierOfHead(text, outerMatch[1]);
    }
    candidates.push(...fqnCandidatesForName(text, name));
    const uniq = [...new Set(candidates)];
    if (uniq.length === 0) return null;
    // Self-reference (`Foo` inside its own `Foo.java`): local by
    // definition, never a homonymous dependency.
    const own = ownFqnOfText(text);
    if (own && uniq[0].toLowerCase() === own.toLowerCase()) return null;
    return { candidates: uniq, fieldHops: [], member, primaryKind };
  }

  // Method or constructor call
  const openIdx = lineText.indexOf("(", word.endColumn - 1);
  const arity = openIdx === -1 ? null : countCallArity(lineText, openIdx);
  const member = { kind: "method", name, arity };
  // `new com.foo.Bar(`: constructor with literal FQN (the plain `new` below
  // does not catch it because `before` ends in a dot, not in `new`).
  const newChain = before.match(/(^|[^\w$.])new\s+([\w$]+(?:\.[\w$]+)*)\.\s*$/);
  if (newChain) {
    const prefix = newChain[2].split(".");
    if (
      prefix.length >= 1 &&
      prefix.every((s: any) => /^[a-z_$][\w$]*$/.test(s)) &&
      !prefix.includes("this") &&
      !prefix.includes("super")
    ) {
      return { candidates: [prefix.join(".") + "." + name], fieldHops: [], member, primaryKind: "qualified" };
    }
    // Non-literal prefix (`new Outer.Inner(`): follows the normal flow.
  }
  // `new Name(` (plain, via import or same package)
  if (/(^|[^\w$.])new\s*$/.test(before)) {
    if (!/^[A-Z]/.test(name)) return null;
    const uniq = [...new Set(fqnCandidatesForName(text, name))];
    if (uniq.length === 0) return null;
    const own = ownFqnOfText(text);
    if (own && uniq[0].toLowerCase() === own.toLowerCase()) return null;
    return { candidates: uniq, fieldHops: [], member, primaryKind: tierOfHead(text, name) };
  }
  // `receiver.method(` (dotted chain)
  const chainMatch = before.match(/([\w$]+(?:\.[\w$]+)*)\.\s*$/);
  if (chainMatch) {
    const parts = chainMatch[1].split(".");
    const first = parts[0];
    const hops = parts.slice(1);
    if (first === "this") {
      // Own + supertypes (the method may be inherited): main walks
      // the hierarchy up to who implements it.
      const uniq = ownAndSuperCandidates(text);
      if (uniq.length === 0) return null;
      return { candidates: uniq, fieldHops: hops, member, primaryKind: "lenient" };
    }
    if (first === "super") {
      const sup = superClassName(text);
      if (!sup) return null;
      const uniq = [...new Set(fqnCandidatesForName(text, sup))];
      if (uniq.length === 0) return null;
      return { candidates: uniq, fieldHops: hops, member, primaryKind: "lenient" };
    }
    // `com.foo.Util.helper(`: literal qualified receiver, takes precedence over imports.
    const lit = literalClassFromChain(parts);
    if (lit) {
      return { candidates: [lit.fqn], fieldHops: lit.hops, member, primaryKind: "qualified" };
    }
    if (/^[A-Z]/.test(first)) {
      // Class (or `Class.field.method`: main resolves the intermediate hop
      // with the located source). Candidates of the FIRST part; the
      // rest are field hops.
      const uniq = [...new Set(fqnCandidatesForName(text, first))];
      if (uniq.length === 0) return null;
      return { candidates: uniq, fieldHops: parts.slice(1), member, primaryKind: tierOfHead(text, first) };
    }
    // Variable: its declared type
    const type = findVarType(text, first, position.lineNumber);
    if (!type) return null;
    const uniq = [...new Set(fqnCandidatesForName(text, type))];
    if (uniq.length === 0) return null;
    return { candidates: uniq, fieldHops: hops, member, primaryKind: tierOfHead(text, type) };
  }
  // No receiver: own, inherited or static-import method
  const candidates = ownAndSuperCandidates(text);
  const { staticExact, staticStars } = importsOfText(text);
  for (const s of staticExact) {
    if (s.member === name) candidates.push(s.cls);
  }
  for (const s of staticStars) candidates.push(s.cls);
  const uniq = [...new Set(candidates)];
  if (uniq.length === 0) return null;
  return { candidates: uniq, fieldHops: [], member, primaryKind: "lenient" };
}

export { buildExternalQuery };
