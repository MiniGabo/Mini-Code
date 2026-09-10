// Java textual analysis (imports, FQN, variables, supertypes).
import { JAVA_KEYWORDS } from "./keywords";
import { escapeRegExp } from "../../services/text/regex";
// Symbol name (class or method) under the cursor. null if there is no
// navigable word (keyword, number, empty...).
function symbolAt(model: any, position: any) {
  let word = null;
  try {
    word = model.getWordAtPosition(position);
  } catch {
    return null;
  }
  if (!word || !word.word) return null;
  if (JAVA_KEYWORDS.has(word.word)) return null;
  if (!/^[A-Za-z_$][\w$]*$/.test(word.word)) return null;
  return word.word;
}
function packageOfText(text: any) {
  const m = /^\s*package\s+([\w.]+)\s*;/m.exec(text);
  return m ? m[1] : null;
}

function importsOfText(text: any) {
  const exact = [];
  const stars = [];
  const staticExact = []; // { cls, member }
  const staticStars = []; // cls
  for (const m of text.matchAll(/^import\s+static\s+([\w.]+)\.([\w$*]+)\s*;/gm)) {
    if (m[2] === "*") staticStars.push(m[1]);
    else staticExact.push({ cls: m[1], member: m[2] });
  }
  for (const m of text.matchAll(/^import\s+(?!static\s)([\w.]+(?:\.\*)?)\s*;/gm)) {
    const fqn = m[1];
    if (fqn.endsWith(".*")) stars.push(fqn.slice(0, -2));
    else exact.push(fqn);
  }
  return { exact, stars, staticExact, staticStars };
}

// FQN candidates for a name (possibly dotted: Map.Entry).
// Java order: exact import, same package, import *, java.lang.
function fqnCandidatesForName(text: any, dottedName: any) {
  const t = fqnTiersForName(text, dottedName);
  return [...t.exact, ...t.pkg, ...t.stars, ...t.lang];
}

// Same list split by tiers (no dedup across tiers): used to know
// where the first candidate comes from (primaryKind) and to avoid showing a wrong
// homonymous class when the import is explicit.
function fqnTiersForName(text: any, dottedName: any) {
  const tiers: { exact: string[]; pkg: string[]; stars: string[]; lang: string[] } = { exact: [], pkg: [], stars: [], lang: [] };
  const push = (arr: any, fqn: any) => {
    if (fqn && !tiers.exact.includes(fqn) && !tiers.pkg.includes(fqn) && !tiers.stars.includes(fqn) && !tiers.lang.includes(fqn)) arr.push(fqn);
  };
  const [head, ...restArr] = dottedName.split(".");
  const rest = restArr.join(".");
  const withRest = (h: any) => (rest ? h + "." + rest : h);
  if (!head) return tiers;
  const { exact, stars } = importsOfText(text);
  for (const imp of exact) {
    if (imp === head || imp.endsWith("." + head)) push(tiers.exact, withRest(imp));
  }
  const pkg = packageOfText(text);
  if (pkg) push(tiers.pkg, withRest(pkg + "." + head));
  for (const s of stars) push(tiers.stars, withRest(s + "." + head));
  push(tiers.lang, withRest("java.lang." + head));
  return tiers;
}

// Tier of the first candidate for a head: 'exact' | 'package' | 'star' |
// 'lang' | null. Main uses it as primaryKind: with an exact import or literal FQN
// from the line, homonyms from other packages are NOT tried (it would
// show the wrong class).
function tierOfHead(text: any, head: any) {
  const t = fqnTiersForName(text, head);
  if (t.exact.length > 0) return "exact";
  if (t.pkg.length > 0) return "package";
  if (t.stars.length > 0) return "star";
  if (t.lang.length > 0) return "lang";
  return null;
}

// Qualified class written on the line itself (`com.foo.Bar` as a type ref
// or as receiver `com.foo.Util.helper(`): the lowercase prefix IS the
// package, there is nothing to guess from imports. parts = dotted segments
// BEFORE the word under the cursor (excluding it).
// Returns { fqn, hops } or null if it is not a literal FQN.
function literalClassFromChain(parts: any) {
  if (!parts || parts.length === 0) return null;
  let clsIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^[A-Z]/.test(parts[i])) {
      clsIdx = i;
      break;
    }
  }
  // Without an uppercase letter there is no class (bare `foo.bar`); without a prefix (`Class.field`)
  // it goes through imports as usual.
  if (clsIdx === -1) return null;
  const pkg = parts.slice(0, clsIdx);
  if (pkg.length === 0) return null;
  // The whole prefix must be a valid package (lowercase; never this/super).
  // If there are uppercase letters before (`Outer.Inner.field`) it is not a literal FQN.
  if (!pkg.every((s: any) => /^[a-z_$][\w$]*$/.test(s))) return null;
  if (pkg.includes("this") || pkg.includes("super")) return null;
  return { fqn: [...pkg, parts[clsIdx]].join("."), hops: parts.slice(clsIdx + 1) };
}

function ownFqnOfText(text: any) {
  try {
    const cls = currentClassName(text);
    const pkg = packageOfText(text);
    if (!cls) return null;
    return pkg ? pkg + "." + cls : cls;
  } catch {
    return null;
  }
}

function cleanVarType(t: any) {
  let s = (t ?? "").trim();
  s = s.replace(/^(?:final|volatile|transient)\s+/, "");
  let out = "";
  let depth = 0;
  for (const c of s) {
    if (c === "<") depth++;
    else if (c === ">") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += c;
  }
  s = out.replace(/\[\s*\]/g, "").trim();
  const parts = s.split(/\s+/);
  s = parts[parts.length - 1] ?? "";
  if (/^(byte|short|int|long|float|double|boolean|char|void|var)$/.test(s)) return null;
  if (JAVA_KEYWORDS.has(s)) return null;
  if (!/^[A-Za-z_$][\w$.]*$/.test(s)) return null;
  return s;
}

// Declared type of a variable: the closest declaration BEFORE the use;
// if none, the first one after (fields declared after the method).
function findVarType(text: any, varName: any, clickLineNumber: any) {
  const lines = text.split("\n");
  const re = new RegExp(
    `(?:^|[^\\w$.])([A-Za-z_$][\\w$.]*(?:\\s*<[^;{}]*>)?(?:\\s*\\[\\s*\\])*)\\s+${escapeRegExp(varName)}\\s*(?=[=;,)\\{:])`
  );
  let bestBefore = null;
  let bestAfter = null;
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    const type = cleanVarType(m[1]);
    if (!type) continue;
    if (i + 1 < clickLineNumber) bestBefore = type; // overwrite: the closest one wins
    else if (bestAfter == null) bestAfter = type;
  }
  return bestBefore ?? bestAfter ?? null;
}

function currentClassName(text: any) {
  const m = /^\s*(?:public|protected|private|abstract|final|sealed|static|\s)*(?:class|interface|enum|record)\s+([\w$]+)/m.exec(text);
  return m ? m[1] : null;
}

function superClassName(text: any) {
  const m = /class\s+[\w$]+\s+extends\s+([\w$.]+)/.exec(text);
  return m ? m[1] : null;
}

// Direct declared supertypes (extends + implements, first level).
// So that an inherited method without receiver (`getLogger()`) also tries
// the superclass (main walks the rest of the hierarchy).
function directSupers(text: any) {
  const m = /(?:class|interface|enum|record)\s+[\w$]+(?:\s*<[^;{}]*>)?\s*(?:extends\s+([^\{;]+?))?\s*(?:implements\s+([^\{;]+?))?\s*(?:\{|permits\b|;)/.exec(text);
  if (!m) return [];
  const split = (s: any) => {
    if (!s) return [];
    let out = "";
    let depth = 0;
    for (const c of s) {
      if (c === "<") depth++;
      else if (c === ">") depth = Math.max(0, depth - 1);
      else if (depth === 0) out += c;
    }
    return out
      .split(",")
      .map((x: any) => x.trim().split(/\s+/).pop())
      .filter((x: any) => /^[A-Za-z_$][\w$.]*$/.test(x ?? ""));
  };
  return [...split(m[1]), ...split(m[2])];
}

// FQN candidates for the own class + its direct supertypes.
function ownAndSuperCandidates(text: any) {
  const out = [];
  const cls = currentClassName(text);
  const pkg = packageOfText(text);
  if (cls) out.push(pkg ? pkg + "." + cls : cls);
  for (const sup of directSupers(text)) {
    out.push(...fqnCandidatesForName(text, sup));
  }
  return [...new Set(out)];
}

// Number of arguments in the call whose `(` opens at openIdx (same line).
// null if the parenthesis does not close on the line.
function countCallArity(lineText: any, openIdx: any) {
  let depth = 0;
  let commas = 0;
  let state = null;
  for (let i = openIdx; i < lineText.length; i++) {
    const c = lineText[i];
    const next = lineText[i + 1];
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
    if (state === "//") break;
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
        return lineText.slice(openIdx + 1, i).trim() === "" ? 0 : commas + 1;
      }
    } else if (c === "," && depth === 1) commas++;
  }
  return null;
}


export {
  symbolAt,
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
};
