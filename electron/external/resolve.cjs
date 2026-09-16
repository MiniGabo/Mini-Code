const path = require("path");
const os = require("os");
const { t } = require("../i18n.cjs");
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
const resultCache = new Map(); // JSON(query) -> result (without source? with source: it's lightweight)
const resultInflight = new Map(); // cacheId -> Promise (concurrent dedup)
async function locateClassText(app, fqn, ctx, progress) {
  const rootPath = ctx?.rootPath ?? null;
  const build = ctx?.build ?? null;
  const say = (message) => {
    try {
      if (typeof progress === "function" && message) progress(message);
    } catch {
      // best-effort progress
    }
  };
  // 1. Real JDK source
  try {
    const jdk = await findJdkSource(fqn, ctx?.jdkHome ?? null);
    if (jdk) {
      say(t("main.resolveJdkSource"));
      return { kind: "sources", text: jdk.text, originLabel: jdk.label, fqn };
    }
  } catch (err) {
    console.log(`[external] src.zip falló para ${fqn}: ${err.message}`);
  }
  // 2/3. Dependencies: sources or bytecode+FernFlower (declared classpath only)
  let dep = null;
  try {
    dep = await findDepArtifact(fqn, build);
  } catch (err) {
    console.log(`[external] búsqueda en jars falló para ${fqn}: ${err.message}`);
  }
  if (dep && dep.kind === "sources") {
    say(t("main.resolveDepSource", { file: path.basename(dep.label) }));
    return { kind: "sources", text: dep.text, originLabel: dep.label, fqn };
  }
  let classFile = dep && dep.classFile ? dep.classFile : null;
  let originLabel = dep ? dep.label : null;
  if (dep && dep.kind === "bytecode") {
    say(t("main.resolveExtracting", { file: path.basename(dep.jarPath) }));
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
  // 4. JDK runtime (jrt) when there is no src.zip
  if (!classFile) {
    say(t("main.resolveJdkRuntime"));
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
  say(t("main.resolveDecompiling"));
  const tag = cacheKey("ff:" + classFile);
  const decompiled = await decompileClassFile(app, classFile, tag);
  const header = FF_HEADER(originLabel ?? path.basename(classFile));
  return { kind: "decompiled", text: header + decompiled, originLabel, fqn };
}
async function resolveExternal(app, query, rootPath, onProgress) {
  // Global budget: no resolve hangs forever. When exhausted an
  // error is returned (the view shows it); what is already resolved stays cached and
  // the in-flight work completes it for the next attempt.
  const timeout = new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          ok: false,
          error: t("main.resolveTimeout"),
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
      // best-effort progress
    }
  };
  const cacheId = JSON.stringify([query.candidates, query.fieldHops, query.member, rootPath, query.contextDir ?? null, query.primaryKind ?? null]);
  if (resultCache.has(cacheId)) return resultCache.get(cacheId);
  // In-flight dedup: repeated clicks/hovers over the same symbol
  // share a single pipeline instead of launching N mvn+FernFlower in
  // parallel.
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
  // Only successes are cached permanently. Failures ("not
  // found", mvn down, partial timeout).
  const fail = (error) => ({ ok: false, error });
  if (!query || !Array.isArray(query.candidates) || query.candidates.length === 0) {
    return fail(t("main.resolveNoCandidates"));
  }
  const simple = simpleNameOf(query.candidates[0]);
  progress(t("main.resolveSearching", { symbol: simple }));
  const hops = [...(query.fieldHops ?? [])];
  // Declared classpath ONCE (pom/gradle or legacy): valid for every
  // candidate and hop in this resolve.
  const ctx = {
    rootPath,
    ownFqn: (query.ownFqn ?? "").toLowerCase() || null,
    build: await resolveBuildClasspath(query.contextDir ?? null, rootPath, progress),
  };
  // Project JDK (build-declared version, else first found): JDK sources come
  // from it instead of the first detected home. Computed once per resolve.
  try {
    const { selectProjectJdk } = require("./projectJdk.cjs");
    ctx.jdkHome = selectProjectJdk({
      buildFile: ctx.build?.buildFile ?? null,
      rootDir: rootPath,
    }).home;
  } catch {
    ctx.jdkHome = null;
  }
  // Never the class itself (the renderer already filters it; this covers hover and
  // any direct IPC). Includes its inner classes (Own.Inner).
  const isOwn = (fqn) => isOwnFqn(query.ownFqn, fqn);
  // The winner according to Java (exact import, literal FQN on the line, or same
  // package) rules: if it is a class FROM THE PROJECT, the symbol is local and its
  // flow is the LSP, never a same-named dependency.
  const primary = query.candidates[0];
  try {
    if (!isOwn(primary) && (await hasProjectSource(primary, rootPath))) {
      return fail(t("main.resolveOwnProject", { name: simpleNameOf(primary) }));
    }
  } catch {
    // When in doubt it is still attempted
  }
  // Strict mode (primaryKind qualified|exact): only the winner is tried.
  const strict = query.primaryKind === "qualified" || query.primaryKind === "exact";
  const todo = strict ? [primary] : query.candidates;
  // Fallback if the member appears in no candidate: the declaration
  // of the first located class (better to show the class than nothing).
  let fallback = null;
  for (const fqn of todo) {
    if (isOwn(fqn)) continue;
    // Classes with source in the project NEVER go through here (their flow is
    // the LSP/local; otherwise we would end up decompiling our own code).
    try {
      if (await hasProjectSource(fqn, rootPath)) continue;
    } catch {
      // When in doubt it is still attempted
    }
    let located = null;
    try {
      located = await locateClassText(app, fqn, ctx, progress);
    } catch (err) {
      console.log(`[external] ${fqn}: ${err.message}`);
      continue;
    }
    if (!located) continue;
    // Intermediate hops `Class.field.method`: the field's type is read
    // from the located source (which brings its own imports).
    let cur = located;
    let ok = true;
    for (const hop of hops) {
      progress(t("main.resolveHop", { hop }));
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
          // try next one
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
    // Method: first in the class itself; if inherited, walk the
    // hierarchy (extends/implements) up to whoever implements it.
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
  return fail(t("main.symbolNotFound"));
}

// Walk the hierarchy (superclass and interfaces, with their own imports)
// looking for the method declaration. Bounded depth.
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
// Approximate member line to refine parseSuperTypes (or 1).
function memberLineHint(text, member) {
  try {
    const pos = findMethodInSource(text, member);
    if (pos) return pos.line;
  } catch {
    // no hint
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
