const path = require("path");
const os = require("os");
const { findJdkSource } = require("./jdk.cjs");
const { findDepArtifact } = require("./artifacts.cjs");
const { findJrtClass } = require("./jrt.cjs");
const { FF_HEADER, extractClassFile, decompileClassFile } = require("./decompiler.cjs");
const { cacheKey } = require("./javaTools.cjs");
const { hasProjectSource } = require("./projectSources.cjs");
const { resolveBuildClasspath } = require("./buildfiles.cjs");
const {
  findMethodInSource,
  findMemberInSource,
  findFieldType,
  cleanType,
  fqnCandidatesForType,
  simpleNameOf,
  isOwnFqn,
  findClassDecl,
  parseSuperTypes,
  extractJavadoc,
} = require("./memberSearch.cjs");
const resultCache = new Map(); // JSON(query) -> resultado (sin source? con source: pesa poco)
const resultInflight = new Map(); // cacheId -> Promise (dedup concurrente)
async function locateClassText(app, fqn, ctx, progress) {
  const rootPath = ctx?.rootPath ?? null;
  const build = ctx?.build ?? null;
  const say = (message) => {
    try {
      if (typeof progress === "function" && message) progress(message);
    } catch {
      // progreso best-effort
    }
  };
  // 1. Fuente real del JDK
  try {
    const jdk = await findJdkSource(fqn);
    if (jdk) {
      say("Fuente encontrada en el JDK…");
      return { kind: "sources", text: jdk.text, originLabel: jdk.label, fqn };
    }
  } catch (err) {
    console.log(`[external] src.zip falló para ${fqn}: ${err.message}`);
  }
  // 2/3. Dependencias: fuentes o bytecode+FernFlower (solo classpath declarado)
  let dep = null;
  try {
    dep = await findDepArtifact(fqn, build);
  } catch (err) {
    console.log(`[external] búsqueda en jars falló para ${fqn}: ${err.message}`);
  }
  if (dep && dep.kind === "sources") {
    say(`Fuente encontrada en ${path.basename(dep.label)}…`);
    return { kind: "sources", text: dep.text, originLabel: dep.label, fqn };
  }
  let classFile = dep && dep.classFile ? dep.classFile : null;
  let originLabel = dep ? dep.label : null;
  if (dep && dep.kind === "bytecode") {
    say(`Extrayendo de ${path.basename(dep.jarPath)}…`);
    const tag = cacheKey(dep.jarPath + "!" + dep.entry);
    const dest = path.join(os.tmpdir(), "mini-code-decompiled", tag, path.basename(dep.entry));
    try {
      await extractClassFile(dep.jarPath, dep.entry, dest);
      classFile = dest;
    } catch (err) {
      console.log(`[external] no se pudo extraer ${dep.entry}: ${err.message}`);
      classFile = null;
    }
  }
  // 4. Runtime del JDK (jrt) cuando no hay src.zip
  if (!classFile) {
    say("Buscando en el runtime del JDK…");
    try {
      const jrt = await findJrtClass(fqn);
      if (jrt) {
        classFile = jrt.classFile;
        originLabel = jrt.label;
      }
    } catch (err) {
      console.log(`[external] jrt falló para ${fqn}: ${err.message}`);
    }
  }
  if (!classFile) return null;
  say("Descompilando con FernFlower…");
  const tag = cacheKey("ff:" + classFile);
  const decompiled = await decompileClassFile(app, classFile, tag);
  const header = FF_HEADER(originLabel ?? path.basename(classFile));
  return { kind: "decompiled", text: header + decompiled, originLabel, fqn };
}
async function resolveExternal(app, query, rootPath, onProgress) {
  // Presupuesto global: ningún resolve cuelga eternamente. Al agotarse se
  // devuelve error (la vista lo muestra); lo ya resuelto queda en caché y
  // el trabajo en curso la completa para el siguiente intento.
  const timeout = new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          ok: false,
          error: "Tardó demasiado (límite de 5 minutos). Reintenta el Ctrl+Click.",
        }),
      300000
    )
  );
  return Promise.race([resolveExternalInner(app, query, rootPath, onProgress), timeout]);
}
async function resolveExternalInner(app, query, rootPath, onProgress) {
  const progress = (message) => {
    try {
      if (typeof onProgress === "function" && message) onProgress(message);
    } catch {
      // progreso best-effort
    }
  };
  const cacheId = JSON.stringify([query.candidates, query.fieldHops, query.member, rootPath, query.contextDir ?? null, query.primaryKind ?? null]);
  if (resultCache.has(cacheId)) return resultCache.get(cacheId);
  // Dedup en vuelo: clicks/hovers repetidos sobre el mismo símbolo
  // comparten un solo pipeline en vez de lanzar N mvn+FernFlower en
  // paralelo.
  if (resultInflight.has(cacheId)) return resultInflight.get(cacheId);
  const running = resolveExternalOnce(app, query, rootPath, progress, cacheId);
  resultInflight.set(cacheId, running);
  try {
    return await running;
  } finally {
    if (resultInflight.get(cacheId) === running) resultInflight.delete(cacheId);
  }
}
async function resolveExternalOnce(app, query, rootPath, progress, cacheId) {
  // Solo los éxitos se cachean de forma permanente. Los fallos ("no se
  // encontró", mvn caído, timeout parcial).
  const fail = (error) => ({ ok: false, error });
  if (!query || !Array.isArray(query.candidates) || query.candidates.length === 0) {
    return fail("Sin candidatos de clase");
  }
  const simple = simpleNameOf(query.candidates[0]);
  progress(`Buscando ${simple} en el JDK y las dependencias…`);
  const hops = [...(query.fieldHops ?? [])];
  // Classpath declarado UNA vez (pom/gradle o legacy): vale para todas
  // las candidatas y saltos de este resolve.
  const ctx = {
    rootPath,
    ownFqn: (query.ownFqn ?? "").toLowerCase() || null,
    build: await resolveBuildClasspath(query.contextDir ?? null, rootPath, progress),
  };
  // Nunca la propia clase (el renderer ya la filtra; esto cubre el hover y
  // cualquier IPC directo). Incluye sus internas (Own.Inner).
  const isOwn = (fqn) => isOwnFqn(query.ownFqn, fqn);
  // La ganadora según Java (import exacto, FQN literal de la línea o mismo
  // paquete) manda: si es una clase DEL PROYECTO, el símbolo es local y su
  // flujo es el LSP, jamás una homónima de dependencias.
  const primary = query.candidates[0];
  try {
    if (!isOwn(primary) && (await hasProjectSource(primary, rootPath))) {
      return fail(
        `${simpleNameOf(primary)} es una clase de tu proyecto, no una dependencia: ` +
          "ábrela desde el explorador o usa Ir a definición con el servidor Java."
      );
    }
  } catch {
    // ante la duda se intenta localizar igual
  }
  // Modo estricto (primaryKind qualified|exact): solo se prueba la ganadora.
  const strict = query.primaryKind === "qualified" || query.primaryKind === "exact";
  const todo = strict ? [primary] : query.candidates;
  // Respaldo si el miembro no aparece en ninguna candidata: la declaración
  // de la primera clase localizada (mejor mostrar la clase que nada).
  let fallback = null;
  for (const fqn of todo) {
    if (isOwn(fqn)) continue;
    // Las clases con fuente en el proyecto NUNCA van por cá (su flujo es
    // el LSP/local; si no, terminaríamos descompilando el propio código).
    try {
      if (await hasProjectSource(fqn, rootPath)) continue;
    } catch {
      // ante la duda se intenta localizar igual
    }
    let located = null;
    try {
      located = await locateClassText(app, fqn, ctx, progress);
    } catch (err) {
      console.log(`[external] ${fqn}: ${err.message}`);
      continue;
    }
    if (!located) continue;
    // Saltos intermedios `Clase.campo.metodo`: el tipo del campo se lee
    // del fuente localizado (que trae sus propios imports).
    let cur = located;
    let ok = true;
    for (const hop of hops) {
      progress(`Resolviendo ${hop}…`);
      const fieldType = findFieldType(cur.text, hop);
      if (!fieldType) {
        ok = false;
        break;
      }
      const nextFqns = fqnCandidatesForType(cur.text, fieldType);
      let next = null;
      for (const nf of nextFqns) {
        if (isOwn(nf)) continue;
        try {
          if (await hasProjectSource(nf, rootPath)) continue;
          const l = await locateClassText(app, nf, ctx, progress);
          if (l) {
            next = l;
            break;
          }
        } catch {
          // probar siguiente
        }
      }
      if (!next) {
        ok = false;
        break;
      }
      cur = next;
    }
    if (!ok) continue;
    const curSimple = simpleNameOf(cur.fqn);
    const member = query.member;
    if (!member || member.kind === "class") {
      const pos = findClassDecl(cur.text, curSimple) ?? { line: 1, column: 1 };
      return done(cacheId, cur, pos, member, progress);
    }
    // Método: primero en la propia clase; si es heredado, caminar la
    // jerarquía (extends/implements) hasta quien lo implementa.
    const here = findMethodInSource(cur.text, member);
    if (here) return done(cacheId, cur, here, member, progress);
    const inherited = await findInherited(app, cur, member, ctx, progress);
    if (inherited) return done(cacheId, inherited.located, inherited.pos, member, progress);
    if (!fallback) {
      const pos = findClassDecl(cur.text, curSimple) ?? { line: 1, column: 1 };
      fallback = { located: cur, pos };
    }
  }
  if (fallback) return done(cacheId, fallback.located, fallback.pos, query.member, progress);
  return fail("Símbolo no encontrado en JDK ni dependencias");
}

// Camina la jerarquía (superclase e interfaces, con sus propios imports)
// buscando la declaración del método. Profundidad acotada.
async function findInherited(app, located, member, ctx, progress, depth = 0, seen = null) {
  if (depth >= 5) return null;
  const rootPath = ctx?.rootPath ?? null;
  const ownFqn = ctx?.ownFqn ?? null;
  seen = seen ?? new Set([located.fqn]);
  const supers = parseSuperTypes(located.text, memberLineHint(located.text, member));
  for (const sup of supers) {
    for (const nf of fqnCandidatesForType(located.text, sup)) {
      if (seen.has(nf)) continue;
      seen.add(nf);
      if (isOwnFqn(ownFqn, nf)) continue;
      let next = null;
      try {
        if (await hasProjectSource(nf, rootPath)) continue;
        next = await locateClassText(app, nf, ctx, progress);
      } catch {
        continue;
      }
      if (!next) continue;
      const pos = findMethodInSource(next.text, member);
      if (pos) return { located: next, pos };
      const deeper = await findInherited(app, next, member, ctx, progress, depth + 1, seen);
      if (deeper) return deeper;
    }
  }
  return null;
}
// Línea aproximada del miembro para afinar parseSuperTypes (o 1).
function memberLineHint(text, member) {
  try {
    const pos = findMethodInSource(text, member);
    if (pos) return pos.line;
  } catch {
    // sin pista
  }
  return 1;
}

function done(cacheId, located, pos, member, progress) {
  void progress;
  const simple = simpleNameOf(located.fqn);
  const isDecompiled = located.kind === "decompiled";
  const lines = located.text.split("\n");
  const targetLine = (lines[pos.line - 1] ?? "").trim();
  const result = {
    ok: true,
    key: `${isDecompiled ? "dec" : "src"}:${located.fqn}`,
    name: simple + (isDecompiled ? ".class" : ".java"),
    source: located.text,
    line: pos.line,
    column: pos.column,
    symbol: (member && member.name) || simple,
    signature: targetLine || null,
    doc: extractJavadoc(located.text, pos.line),
    origin: isDecompiled ? "decompiled" : "sources",
    originLabel: located.originLabel,
  };
  resultCache.set(cacheId, result);
  return result;
}

module.exports = { resolveExternal, findMemberInSource, findMethodInSource, findFieldType, cleanType };
