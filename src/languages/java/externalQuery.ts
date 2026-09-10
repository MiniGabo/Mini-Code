// Símbolos externos (JDK / dependencias): el servidor no los resuelve
// (definition -> null), así que el FQN se reconstruye aquí con los imports
// del archivo y se resuelve en el proceso main (src.zip, -sources.jar o
// FernFlower). Solo se usa cuando el flujo normal no encontró nada.
// Devuelve { candidates: [fqn], fieldHops: [campo], member } o null.
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
  // Nunca la propia clase del archivo actual (evita autodescompilar aunque
  // el índice de fuentes esté desactualizado). Solo archivos reales: en
  // pestañas virtuales la "propia" es la dependencia misma.
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
  // `Collections.<String>emptyList(`: el tipo explícito no es receptor
  const before = beforeRaw.replace(/\.\s*<[^<>]*>\s*$/, ".");
  const isCall = /^\s*\(/.test(after);

  // Click sobre una línea `import ...`: la línea YA dice la clase, no hay
  // que adivinar por imports (y evita homónimas de otros packages).
  const importStmt = /^\s*import\s+(static\s+)?([\w$.]+?)(\.\*)?\s*;\s*$/.exec(lineText);
  if (importStmt) {
    const isStatic = !!importStmt[1];
    const fqn = importStmt[2];
    const isStar = !!importStmt[3];
    const segs = fqn.split(".");
    if (segs.length < 2) return null;
    if (isStar) {
      // `import com.foo.*;` no nombra clase: nada que resolver.
      // `import static com.foo.Util.*;` sí: la clase es Util.
      if (!isStatic) return null;
      return { candidates: [fqn], fieldHops: [], member: { kind: "class", name: segs[segs.length - 1] }, primaryKind: "qualified" };
    }
    if (isStatic) {
      // `import static com.foo.Util.helper;`: la clase es Util; si el click
      // está en `helper` se busca el método, si no, la clase.
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
    // Clase (type ref, new X, extends...): por convención empiezan en mayúscula
    if (!/^[A-Z]/.test(name)) return null;
    // `new Nombre<>(` / `new Nombre(` / `new com.foo.Bar<>`: el diamante
    // esconde que es llamada
    let member: any = { kind: "class", name };
    if (/(^|[^\w$.])new(?:\s+[\w$.]*)?\s*$/.test(before) && /^\s*(<[^<>]*>\s*)?\(/.test(after)) {
      const openIdx = lineText.indexOf("(", word.endColumn - 1);
      member = { kind: "method", name, arity: openIdx === -1 ? null : countCallArity(lineText, openIdx) };
    }
    // `com.foo.Bar` escrito tal cual (el click está en Bar): FQN literal,
    // manda sobre cualquier import. Incluye el propio nombre porque puede
    // ser una interna (`a.b.C.D` vive en el fuente de `a.b.C`: el main
    // recorta solo).
    const chainMatchCls = beforeRaw.match(/([\w$]+(?:\.[\w$]+)*)\.\s*$/);
    if (chainMatchCls) {
      const prefix = chainMatchCls[1].split(".");
      if (prefix.length >= 1 && prefix.every((s: any) => /^[a-z_$][\w$]*$/.test(s)) && !prefix.includes("this") && !prefix.includes("super")) {
        return { candidates: [prefix.join(".") + "." + name], fieldHops: [], member, primaryKind: "qualified" };
      }
    }
    const candidates = [];
    // `Outer.Nombre` con el click en Nombre: resolver la externa también
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
    // Autorreferencia (`Foo` dentro de su propio `Foo.java`): es local por
    // definición, nunca una dependencia homónima.
    const own = ownFqnOfText(text);
    if (own && uniq[0].toLowerCase() === own.toLowerCase()) return null;
    return { candidates: uniq, fieldHops: [], member, primaryKind };
  }

  // Llamada a método o constructor
  const openIdx = lineText.indexOf("(", word.endColumn - 1);
  const arity = openIdx === -1 ? null : countCallArity(lineText, openIdx);
  const member = { kind: "method", name, arity };
  // `new com.foo.Bar(`: constructor con FQN literal (el `new` simple de
  // abajo no lo caza porque `before` termina en punto, no en `new`).
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
    // Prefijo no-literal (`new Outer.Inner(`): sigue el flujo normal.
  }
  // `new Nombre(` (simple, por import o mismo paquete)
  if (/(^|[^\w$.])new\s*$/.test(before)) {
    if (!/^[A-Z]/.test(name)) return null;
    const uniq = [...new Set(fqnCandidatesForName(text, name))];
    if (uniq.length === 0) return null;
    const own = ownFqnOfText(text);
    if (own && uniq[0].toLowerCase() === own.toLowerCase()) return null;
    return { candidates: uniq, fieldHops: [], member, primaryKind: tierOfHead(text, name) };
  }
  // `receptor.metodo(` (cadena con puntos)
  const chainMatch = before.match(/([\w$]+(?:\.[\w$]+)*)\.\s*$/);
  if (chainMatch) {
    const parts = chainMatch[1].split(".");
    const first = parts[0];
    const hops = parts.slice(1);
    if (first === "this") {
      // Propia + supertipos (el método puede ser heredado): main camina
      // la jerarquía hasta quien lo implementa.
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
    // `com.foo.Util.helper(`: receptor cualificado literal, manda sobre imports.
    const lit = literalClassFromChain(parts);
    if (lit) {
      return { candidates: [lit.fqn], fieldHops: lit.hops, member, primaryKind: "qualified" };
    }
    if (/^[A-Z]/.test(first)) {
      // Clase (o `Clase.campo.metodo`: main resuelve el salto intermedio
      // con el fuente localizado). Candidatos de la PRIMERA parte; el
      // resto son saltos de campo.
      const uniq = [...new Set(fqnCandidatesForName(text, first))];
      if (uniq.length === 0) return null;
      return { candidates: uniq, fieldHops: parts.slice(1), member, primaryKind: tierOfHead(text, first) };
    }
    // Variable: su tipo declarado
    const type = findVarType(text, first, position.lineNumber);
    if (!type) return null;
    const uniq = [...new Set(fqnCandidatesForName(text, type))];
    if (uniq.length === 0) return null;
    return { candidates: uniq, fieldHops: hops, member, primaryKind: tierOfHead(text, type) };
  }
  // Sin receptor: método propio, heredado o static import
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
