const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileAsync, spawn } = require("./proc.cjs");
const { mavenRepo, filterExisting, walkJars, gradleUserHome } = require("./jars.cjs");
const { t } = require("../i18n.cjs");
function mvnBinary() {
  for (const v of [process.env.MAVEN_HOME, process.env.M2_HOME]) {
    if (!v) continue;
    const cand = path.join(v, "bin", process.platform === "win32" ? "mvn.cmd" : "mvn");
    try {
      if (fs.statSync(cand).isFile()) return cand;
    } catch {
      // next one
    }
  }
  if (process.platform === "win32") {
    try {
      for (const entry of fs.readdirSync("C:\\", { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^apache-maven/i.test(entry.name)) continue;
        const cand = path.join("C:\\", entry.name, "bin", "mvn.cmd");
        try {
          if (fs.statSync(cand).isFile()) return cand;
        } catch {
          // next one
        }
      }
    } catch {
      // no access to the root
    }
  }
  return process.platform === "win32" ? "mvn.cmd" : "mvn";
}

function mvnCachePath(pomPath) {
  const tag = crypto.createHash("sha1").update(pomPath.toLowerCase()).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), "mini-code-mvncp", tag + ".json");
}
const mvnFailAt = new Map(); // pomLower -> timestamp
async function mavenResolvedJars(pomPath, progress) {
  let mtimeMs = 0;
  try {
    mtimeMs = (await fsp.stat(pomPath)).mtimeMs;
  } catch {
    return null;
  }
  const cacheFile = mvnCachePath(pomPath);
  try {
    const data = JSON.parse(await fsp.readFile(cacheFile, "utf8"));
    if (data && data.mtimeMs === mtimeMs && Array.isArray(data.jars)) return data.jars;
  } catch {
    // re-resolve
  }
  const failedAt = mvnFailAt.get(pomPath.toLowerCase()) ?? 0;
  if (Date.now() - failedAt < 5 * 60 * 1000) {
    throw new Error("mvn omitido (falló hace poco)");
  }
  if (typeof progress === "function") {
    try {
      progress(t("main.resolvingMaven"));
    } catch {
      // best-effort
    }
  }
  const outFile = path.join(os.tmpdir(), "mini-code-mvncp", "cp-" + process.pid + ".txt");
  await fsp.mkdir(path.dirname(outFile), { recursive: true }).catch(() => {});
  const bin = mvnBinary();
  const mvnArgs = ["-B", "-q", "-f", pomPath, "dependency:build-classpath", `-Dmdep.outputFile=${outFile}`, "-Dmdep.includeScope=test"];
  try {
    if (/\.cmd$/i.test(bin) || /\.bat$/i.test(bin)) {
      // .cmd/.bat only run via shell (direct spawn fails with EINVAL)
      await new Promise((resolve, reject) => {
      const cmdline = [`"${bin}"`, ...mvnArgs.map((a) => `"${a}"`)].join(" ");
      const child = spawn(cmdline, { shell: true, windowsHide: true });
      let stderr = "";
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // already finished
        }
        reject(new Error("timeout en mvn"));
      }, 240000);
      child.stderr.on("data", (d) => {
        stderr += d.toString();
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`mvn exit ${code}: ${stderr.slice(-500)}`));
      });
    });
    } else {
      await execFileAsync(bin, mvnArgs, { timeoutMs: 240000 });
    }
  } catch (err) {
    mvnFailAt.set(pomPath.toLowerCase(), Date.now());
    throw err;
  }
  const raw = await fsp.readFile(outFile, "utf8");
  await fsp.rm(outFile, { force: true }).catch(() => {});
  const jars = raw
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter((s) => s.toLowerCase().endsWith(".jar"));
  const existing = await filterExisting(jars);
  try {
    await fsp.writeFile(cacheFile, JSON.stringify({ mtimeMs, jars: existing }), "utf8");
  } catch {
    // best-effort cache
  }
  return existing;
}
function parsePomDeps(pomText) {
  const props = {};
  const propBlock = /<properties>([\s\S]*?)<\/properties>/.exec(pomText);
  if (propBlock) {
    for (const m of propBlock[1].matchAll(/<([\w$.~-]+)>([^<]*)<\/([\w$.~-]+)>/g)) {
      if (m[1].trim() === m[3].trim()) props[m[1].trim()] = m[2].trim();
    }
  }
  const subst = (s) => (s ?? "").replace(/\$\{([^}]+)\}/g, (_, n) => props[n.trim()] ?? `\${${n}}`);
  const deps = [];
  for (const m of pomText.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const body = m[1];
    const g = /<groupId>\s*([^<]+?)\s*<\/groupId>/.exec(body);
    const a = /<artifactId>\s*([^<]+?)\s*<\/artifactId>/.exec(body);
    if (!g || !a) continue;
    const v = /<version>\s*([^<]+?)\s*<\/version>/.exec(body);
    const t = /<type>\s*([^<]+?)\s*<\/type>/.exec(body);
    if (t && t[1].trim() !== "jar") continue;
    const version = subst((v?.[1] ?? "").trim());
    if (!version || version.includes("${")) continue; // inherited from the parent: covered by mvn
    deps.push({ group: subst(g[1].trim()), artifact: a[1].trim(), version });
  }
  return deps;
}

// Fallback without mvn: direct pom dependencies mapped to the local repo.
async function fallbackPomJars(pomPath) {
  let text = "";
  try {
    text = await fsp.readFile(pomPath, "utf8");
  } catch {
    return null;
  }
  const repo = mavenRepo();
  if (!repo) return null;
  const jars = [];
  for (const d of parsePomDeps(text)) {
    jars.push(path.join(repo, ...d.group.split("."), d.artifact, d.version, `${d.artifact}-${d.version}.jar`));
  }
  return filterExisting(jars);
}
function parseVersionCatalog(gradleDir) {
  let text = "";
  try {
    text = fs.readFileSync(path.join(gradleDir, "gradle", "libs.versions.toml"), "utf8");
  } catch {
    return null;
  }
  const versions = {};
  const libraries = {};
  let section = null;
  for (let line of text.split(/\r?\n/)) {
    line = line.split("#")[0].trim();
    if (!line) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      section = sec[1].trim();
      continue;
    }
    const kv = /^([\w$.~-]+?)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].trim();
    const val = kv[2].trim();
    if (section === "versions") {
      const sv = /^"([^"]*)"$/.exec(val);
      versions[key] = sv ? sv[1] : val;
    } else if (section === "libraries") {
      const sm = /^"([^"]+)"$/.exec(val);
      if (sm) {
        const parts = sm[1].split(":");
        if (parts.length === 3) libraries[key] = { group: parts[0], name: parts[1], version: parts[2] };
      } else if (val.startsWith("{")) {
        const g = /group\s*=\s*"([^"]+)"/.exec(val);
        const n = /(?:module\s*=\s*"([^"]+)"|name\s*=\s*"([^"]+)")/.exec(val);
        const v = /version\s*=\s*"([^"]+)"/.exec(val);
        const vr = /version\s*\.\s*ref\s*=\s*"([^"]+)"/.exec(val);
        let group = g?.[1] ?? null;
        let name = null;
        const mod = n?.[1] ?? n?.[2] ?? null;
        if (mod && mod.includes(":")) [group, name] = mod.split(":");
        else if (mod) name = mod;
        const version = v?.[1] ?? (vr ? versions[vr[1]] : null) ?? null;
        if (group && name && version) libraries[key] = { group, name, version };
      }
    }
  }
  return { versions, libraries };
}

// Dependencies declared in build.gradle / build.gradle.kts:
// 'g:a:v' notation, libs.* catalog, one-line map and ${constants}.
function parseGradleDeps(buildText, gradleDir) {
  const catalog = parseVersionCatalog(gradleDir);
  const defs = {};
  for (const m of buildText.matchAll(/^\s*(?:def\s+|ext\.)?([\w$]+)\s*=\s*["']([^"']+)["']/gm)) {
    defs[m[1]] = m[2];
  }
  const subst = (s) =>
    (s ?? "").replace(/\$\{([\w$.]+)\}|\$([\w$]+)/g, (mm, a, b) => {
      const k = a ?? b ?? "";
      const short = k.includes(".") ? k.split(".").pop() : k;
      return defs[k] ?? defs[short] ?? mm;
    });
  const deps = [];
  const push = (g, a, v) => {
    if (g && a && v && !v.includes("$") && !/[()'"`]/.test(g + a + v)) {
      deps.push({ group: g, artifact: a, version: v });
    }
  };
  const CONFIGS =
    "(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testApi|testCompileOnly|testRuntimeOnly|compile|runtime|provided|annotationProcessor|testAnnotationProcessor|kapt|ksp)";
  for (const m of buildText.matchAll(new RegExp(CONFIGS + "\\s*\\(?\\s*['\"]([^'\"]+)['\"]", "g"))) {
    const parts = subst(m[1]).split(":");
    if (parts.length === 3) push(parts[0], parts[1], parts[2]);
  }
  for (const m of buildText.matchAll(new RegExp(CONFIGS + "\\s*\\(?\\s*(libs(?:\\.[\\w$]+)+)", "g"))) {
    if (!catalog) continue;
    const lib = catalog.libraries[m[1].replace(/^libs\./, "")];
    if (lib) push(lib.group, lib.name, lib.version);
  }
  for (const m of buildText.matchAll(/group\s*:\s*['"]([^'"]+)['"]\s*,\s*name\s*:\s*['"]([^'"]+)['"]\s*,\s*version\s*:\s*['"]([^'"]+)['"]/g)) {
    push(subst(m[1]), subst(m[2]), subst(m[3]));
  }
  for (const m of buildText.matchAll(/name\s*:\s*['"]([^'"]+)['"]\s*,\s*group\s*:\s*['"]([^'"]+)['"]\s*,\s*version\s*:\s*['"]([^'"]+)['"]/g)) {
    push(subst(m[2]), subst(m[1]), subst(m[3]));
  }
  const seen = new Set();
  return deps.filter((d) => {
    const k = `${d.group}:${d.artifact}:${d.version}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function findGradleArtifacts(group, artifact, version) {
  const base = path.join(gradleUserHome(), "caches", "modules-2", "files-2.1", group, artifact, version);
  let hashDirs = [];
  try {
    hashDirs = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(base, e.name));
  } catch {
    return { binary: null, sources: null };
  }
  let binary = null;
  let sources = null;
  const wantedBin = `${artifact}-${version}.jar`;
  const wantedSrc = `${artifact}-${version}-sources.jar`;
  for (const h of hashDirs) {
    let files = [];
    try {
      files = fs.readdirSync(h);
    } catch {
      continue;
    }
    for (const f of files) {
      // The -sources.jar lives in ANOTHER hash folder: collected separately
      if (f === wantedSrc) sources = path.join(h, f);
      else if (f === wantedBin) binary = path.join(h, f);
      else if (!binary && f.endsWith(".jar") && !/-sources\.jar$/i.test(f) && !/-javadoc\.jar$/i.test(f)) {
        binary = path.join(h, f);
      }
    }
    if (binary && sources) break;
  }
  return { binary, sources };
}
function findBuildFile(startDir, rootPath) {
  let dir = startDir;
  const stop = rootPath ? path.resolve(rootPath) : null;
  for (let i = 0; i < 12 && dir; i++) {
    for (const name of ["pom.xml", "build.gradle.kts", "build.gradle"]) {
      const cand = path.join(dir, name);
      try {
        if (fs.statSync(cand).isFile()) return cand;
      } catch {
        // not here
      }
    }
    if (stop && dir.toLowerCase() === stop.toLowerCase()) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    if (stop && !dir.toLowerCase().startsWith(stop.toLowerCase())) break;
    dir = parent;
  }
  return null;
}

let buildCpCache = { key: null, value: null }; // in-memory per session
let buildCpInflight = { key: null, promise: null }; // shared in-flight mvn
async function resolveBuildClasspath(contextDir, rootPath, progress) {
  const say = (message) => {
    try {
      if (typeof progress === "function" && message) progress(message);
    } catch {
      // best-effort
    }
  };
  const start =
    contextDir && (() => { try { return fs.statSync(contextDir).isDirectory(); } catch { return false; } })()
      ? contextDir
      : rootPath;
  const buildFile = start ? findBuildFile(start, rootPath) : null;
  const cacheKey = (buildFile ?? ("legacy:" + (rootPath ?? ""))).toLowerCase();
  if (buildCpCache.key === cacheKey && buildCpCache.value) return buildCpCache.value;
  // In-flight dedup: several concurrent hovers/clicks share the same mvn
  // instead of launching one per click (chained minutes of waiting).
  if (buildCpInflight.key === cacheKey && buildCpInflight.promise) {
    return buildCpInflight.promise;
  }
  const promise = (async () => {
  let value = null;
  if (buildFile && buildFile.toLowerCase().endsWith("pom.xml")) {
    let jars = null;
    try {
      jars = await mavenResolvedJars(buildFile, say);
    } catch (err) {
      console.log(`[external] mvn falló (${err.message}); parseo directo del pom`);
      jars = null;
    }
    if (!jars) {
      say(t("main.readingPomDeps"));
      try {
        jars = await fallbackPomJars(buildFile);
      } catch {
        jars = null;
      }
    }
    value = { jars: jars ?? [], dirs: [], via: "maven", buildFile };
  } else if (buildFile) {
    say(t("main.readingGradleDeps"));
    let jars = [];
    try {
      const text = await fsp.readFile(buildFile, "utf8");
      const deps = parseGradleDeps(text, path.dirname(buildFile));
      console.log(`[external] gradle declara ${deps.length} dependencias`);
      for (const d of deps) {
        const found = findGradleArtifacts(d.group, d.artifact, d.version);
        // Binary first and sources after: the sources pass
        // prefers them wherever they are.
        if (found.binary) jars.push(found.binary);
        if (found.sources) jars.push(found.sources);
      }
      jars = await filterExisting(jars);
    } catch (err) {
      console.log(`[external] gradle falló: ${err.message}`);
    }
    value = { jars, dirs: [], via: "gradle", buildFile };
  } else {
    const jars = [];
    const dirs = [];
    if (rootPath) {
      try {
        if ((await fsp.stat(rootPath)).isDirectory()) {
          const local = [];
          await walkJars(rootPath, 4, 200, local);
          jars.push(...local);
        }
      } catch {
        // unreadable root
      }
    }
    const cp = process.env.CLASSPATH;
    if (cp) {
      for (const entry of cp.split(path.delimiter)) {
        const e = (entry ?? "").trim();
        if (!e) continue;
        try {
          const st = await fsp.stat(e);
          if (st.isFile() && e.toLowerCase().endsWith(".jar")) jars.push(e);
          else if (st.isDirectory()) dirs.push(e);
        } catch {
          // missing entry
        }
      }
    }
    value = { jars: [...new Set(jars)], dirs: [...new Set(dirs)], via: "legacy", buildFile: null };
  }
  buildCpCache = { key: cacheKey, value };
  console.log(`[external] classpath (${value.via})${buildFile ? " " + path.basename(buildFile) : ""}: ${value.jars.length} jars`);
  return value;
  })();
  buildCpInflight = { key: cacheKey, promise };
  try {
    return await promise;
  } finally {
    if (buildCpInflight.promise === promise) buildCpInflight = { key: null, promise: null };
  }
}

module.exports = { resolveBuildClasspath };
