// Project JDK selection: the JDK in use should match the Java version
// configured in the build file (pom.xml / build.gradle[.kts]); when the
// build declares nothing, the first detected JDK is used (legacy behavior).
// Priority for launching: explicit user setting (lsp.cjs) > build match > first found.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");
const { jdkHomes } = require("./jdk.cjs");
const { zipEntriesFast } = require("./zip.cjs");

/** "1.8.0_381" -> 8, "17.0.8" -> 17, "VERSION_17" -> 17, "21-ea" -> 21. */
function majorOf(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const vm = /VERSION_(\d+)/i.exec(s);
  if (vm) return parseInt(vm[1], 10);
  const old = /^1\.(\d+)/.exec(s);
  if (old) return parseInt(old[1], 10);
  const num = /^(\d+)/.exec(s);
  if (num) return parseInt(num[1], 10);
  return null;
}

function pickFrom(text, names) {
  for (const n of names) {
    const m = new RegExp(`<${n}>\\s*([^<]+?)\\s*<\\/${n}>`, "i").exec(text);
    if (!m) continue;
    const v = m[1].trim();
    if (!v || v.includes("$")) continue;
    const M = majorOf(v);
    if (M) return M;
  }
  return null;
}

/** Required major from a pom.xml (release > source > target, + compiler plugin). */
function mavenJavaMajor(text) {
  // One-level ${prop} resolution from local <properties>.
  const props = new Map();
  const pb = /<properties>([\s\S]*?)<\/properties>/i.exec(text);
  if (pb) {
    for (const m of pb[1].matchAll(/<([\w$.~-]+)>([^<]*)<\/([\w$.~-]+)>/g)) {
      if (m[1].trim() === m[3].trim()) props.set(m[1].trim(), m[2].trim());
    }
  }
  const resolveRef = (s) => s.replace(/\$\{([^}]+)\}/g, (_, n) => props.get(n.trim()) ?? "");
  for (const n of ["maven.compiler.release", "maven.compiler.source", "maven.compiler.target", "java.version"]) {
    const m = new RegExp(`<${n}>\\s*([^<]+?)\\s*<\\/${n}>`, "i").exec(text);
    if (!m) continue;
    const v = resolveRef(m[1].trim());
    if (!v || v.includes("$")) continue;
    const M = majorOf(v);
    if (M) return M;
  }
  // maven-compiler-plugin <configuration>: search right after its marker.
  const idx = text.indexOf("maven-compiler-plugin");
  if (idx !== -1) {
    const scope = text.slice(idx, idx + 4000);
    const M = pickFrom(scope, ["release", "source", "target"]);
    if (M) return M;
  }
  return null;
}

/** Required major from build.gradle / build.gradle.kts. */
function gradleJavaMajor(text) {
  // Toolchain wins: languageVersion = JavaLanguageVersion.of(17)
  let m = /languageVersion\s*=\s*JavaLanguageVersion\.of\(\s*["']?(\d+)["']?\s*\)/.exec(text);
  if (m) return parseInt(m[1], 10);
  // sourceCompatibility = '17' | 17 | JavaVersion.VERSION_17 (also targetCompatibility)
  for (const name of ["sourceCompatibility", "targetCompatibility"]) {
    const re = new RegExp(name + "\\s*=\\s*([^\\s,;\\)\\]]+)", "g");
    let hit = null;
    while ((hit = re.exec(text)) !== null) {
      const token = hit[1].replace(/^['"]|['"]$/g, "");
      const M = majorOf(token);
      if (M) return M;
    }
  }
  return null;
}

/** Required Java major for a project: explicit build file or root children. */
function requiredJavaMajor({ rootDir, buildFile } = {}) {
  let file = buildFile ?? null;
  if (!file && rootDir) {
    for (const name of ["pom.xml", "build.gradle.kts", "build.gradle"]) {
      const cand = path.join(rootDir, name);
      try {
        if (fs.statSync(cand).isFile()) {
          file = cand;
          break;
        }
      } catch {
        // not here
      }
    }
  }
  if (!file) return null;
  let text = null;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const n = file.toLowerCase();
  if (n.endsWith("pom.xml")) return mavenJavaMajor(text);
  if (n.endsWith(".gradle") || n.endsWith(".gradle.kts")) return gradleJavaMajor(text);
  return null;
}

const majorCache = new Map(); // homeLower -> major|null
/** Installed major of a JDK home: <home>/release, else `java -version`. */
function jdkMajorOf(home) {
  const key = String(home).toLowerCase();
  if (majorCache.has(key)) return majorCache.get(key);
  let major = null;
  try {
    const rel = fs.readFileSync(path.join(home, "release"), "utf8");
    const m = /JAVA_VERSION="([^"]+)"/.exec(rel);
    if (m) major = majorOf(m[1]);
  } catch {
    // pre-9 layout or unreadable: probe the binary
  }
  if (!major) {
    try {
      const exe = path.join(home, "bin", process.platform === "win32" ? "java.exe" : "java");
      const out = spawnSync(exe, ["-version"], { encoding: "utf8", timeout: 10000 });
      const text = `${out.stderr ?? ""}${out.stdout ?? ""}`;
      const m = /version "([^"]+)"/.exec(text);
      if (m) major = majorOf(m[1]);
    } catch {
      // not launchable: unknown major
    }
  }
  majorCache.set(key, major);
  return major;
}

/**
 * Selects the project JDK: first detected home matching the build-declared
 * major, else the first detected home (legacy behavior).
 */
function selectProjectJdk({ rootDir, buildFile } = {}) {
  const exe = process.platform === "win32" ? "java.exe" : "java";
  const homes = jdkHomes().filter((h) => {
    try {
      return fs.statSync(path.join(h, "bin", exe)).isFile();
    } catch {
      return false;
    }
  });
  const required = requiredJavaMajor({ rootDir, buildFile });
  let home = null;
  let reason = "none-found";
  if (homes.length > 0) {
    if (required) {
      home = homes.find((h) => jdkMajorOf(h) === required) ?? homes[0];
      reason = jdkMajorOf(home) === required ? "build-file" : "build-file-no-match";
    } else {
      home = homes[0];
      reason = "first-found";
    }
  }
  return { home, required, reason };
}

module.exports = { majorOf, mavenJavaMajor, gradleJavaMajor, requiredJavaMajor, jdkMajorOf, selectProjectJdk, serverRequiredMajor };

/** Major of a .class entry inside a jar (major - 44 = Java version). */
async function classMajorOf(jarPath, entry) {
  const { buf, parsed } = await zipEntriesFast(jarPath);
  const e = parsed.find((x) => x.name === entry);
  if (!e || e.hasDescriptor) return null;
  const lh = e.offset;
  if (buf.readUInt32LE(lh) !== 0x04034b50) return null;
  const dataStart = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
  let raw = buf.subarray(dataStart, dataStart + e.compSize);
  if (e.method === 8) raw = zlib.inflateRawSync(raw);
  if (raw.length < 8 || raw.readUInt32BE(0) !== 0xcafebabe) return null;
  return raw.readUInt16BE(6) - 44;
}

let serverMinCache = new Map(); // jarLower -> major|null
/** Minimum Java major needed to RUN the language server jar itself. */
async function serverRequiredMajor(jarPath) {
  if (!jarPath) return null;
  const key = String(jarPath).toLowerCase();
  if (serverMinCache.has(key)) return serverMinCache.get(key);
  let v = null;
  try {
    v = await classMajorOf(jarPath, "org/javacs/Main.class");
  } catch {
    v = null;
  }
  serverMinCache.set(key, v);
  return v;
}
