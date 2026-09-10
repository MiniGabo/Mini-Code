// Análisis textual de Java (imports, FQN, variables, supertipos).
import { JAVA_KEYWORDS } from "./keywords";
import { escapeRegExp } from "../../services/text/regex";
// Nombre de símbolo (clase o método) bajo el cursor. null si no hay
// palabra navegable (keyword, número, vacío...).
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

// Candidatos FQN para un nombre (posiblemente punteado: Map.Entry).
// Orden Java: import exacto, mismo paquete, import *, java.lang.
function fqnCandidatesForName(text: any, dottedName: any) {
  const t = fqnTiersForName(text, dottedName);
  return [...t.exact, ...t.pkg, ...t.stars, ...t.lang];
}

// Misma lista separada por tiers (sin dedup entre tiers): sirve para saber
// de dónde sale la primera candidata (primaryKind) y no mostrar una clase
// homónima equivocada cuando el import es explícito.
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

// Tier de la primera candidata para un head: 'exact' | 'package' | 'star' |
// 'lang' | null. El main lo usa como primaryKind: con import exacto o FQN
// literal de la línea NO se prueba con homónimas de otros packages (sería
// mostrar la clase equivocada).
function tierOfHead(text: any, head: any) {
  const t = fqnTiersForName(text, head);
  if (t.exact.length > 0) return "exact";
  if (t.pkg.length > 0) return "package";
  if (t.stars.length > 0) return "star";
  if (t.lang.length > 0) return "lang";
  return null;
}

// Clase escrita cualificada en la propia línea (`com.foo.Bar` como type ref
// o como receptor `com.foo.Util.helper(`): el prefijo en minúsculas ES el
// package, no hay nada que adivinar por imports. parts = segmentos punteados
// ANTES de la palabra bajo el cursor (sin incluirla).
// Devuelve { fqn, hops } o null si no es un FQN literal.
function literalClassFromChain(parts: any) {
  if (!parts || parts.length === 0) return null;
  let clsIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^[A-Z]/.test(parts[i])) {
      clsIdx = i;
      break;
    }
  }
  // Sin mayúscula no hay clase (`foo.bar` suelto); sin prefijo (`Clase.campo`)
  // va por imports como siempre.
  if (clsIdx === -1) return null;
  const pkg = parts.slice(0, clsIdx);
  if (pkg.length === 0) return null;
  // Todo el prefijo debe ser package válido (minúsculas; nunca this/super).
  // Si hay mayúsculas antes (`Outer.Inner.campo`) no es FQN literal.
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

// Tipo declarado de una variable: la declaración más cercana ANTES del uso;
// si no hay, la primera posterior (campos declarados después del método).
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
    if (i + 1 < clickLineNumber) bestBefore = type; // pisar: la más cercana gana
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

// Supertipos directos declarados (extends + implements, primer nivel).
// Para que un método heredado sin receptor (`getLogger()`) también pruebe
// la superclase (main camina el resto de la jerarquía).
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

// Candidatas FQN para la clase propia + sus supertipos directos.
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

// Nº de argumentos en la llamada cuyo `(` abre en openIdx (misma línea).
// null si el paréntesis no se cierra en la línea.
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
