const fs = require("fs");
const path = require("path");
const { listZip, readZipEntry, entryCandidates } = require("./zip.cjs");
function dedupeDirs(dirs) {
  const seen = new Set();
  const out = [];
  for (const d of dirs) {
    try {
      const real = fs.realpathSync(d);
      const key = real.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(real);
    } catch {
      // no existe: se ignora
    }
  }
  return out;
}

function pathJavaHomes() {
  const homes = [];
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const arg = process.platform === "win32" ? ["java.exe"] : ["-a", "java"];
    const { stdout } = require("child_process").spawnSync(cmd, arg, { encoding: "utf8" });
    for (const line of (stdout ?? "").split(/\r?\n/)) {
      const exe = line.trim().replace(/^"(.*)"$/, "$1");
      if (!exe) continue;
      // <home>/bin/java[.exe] -> <home>
      homes.push(path.dirname(path.dirname(exe)));
    }
  } catch {
    // sin java en PATH (el LSP ya habría fallado antes)
  }
  return homes;
}

function scannedJavaHomes() {
  const roots = [];
  if (process.platform === "win32") {
    roots.push("C:\\Program Files\\Java", "C:\\Program Files\\Microsoft");
  } else if (process.platform === "darwin") {
    roots.push("/Library/Java/JavaVirtualMachines");
  } else {
    roots.push("/usr/lib/jvm");
  }
  const homes = [];
  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const cand = path.join(root, e.name);
      if (process.platform === "darwin") {
        const macHome = path.join(cand, "Contents", "Home");
        try {
          if (fs.statSync(macHome).isDirectory()) homes.push(macHome);
        } catch {
          // no es un JDK con layout macOS
        }
        continue;
      }
      homes.push(cand);
    }
  }
  return homes;
}

let jdkHomesCache = null;
function jdkHomes() {
  if (jdkHomesCache) return jdkHomesCache;
  const homes = [];
  if (process.env.JAVA_HOME) homes.push(process.env.JAVA_HOME);
  homes.push(...pathJavaHomes());
  homes.push(...scannedJavaHomes());
  jdkHomesCache = dedupeDirs(homes).filter((h) => {
    try {
      return fs.statSync(h).isDirectory();
    } catch {
      return false;
    }
  });
  if (jdkHomesCache.length > 0) {
    console.log("[external] JDKs detectados:", jdkHomesCache.join(" | "));
  }
  return jdkHomesCache;
}

function srcZipOf(home) {
  for (const cand of [path.join(home, "lib", "src.zip"), path.join(home, "src.zip")]) {
    try {
      if (fs.statSync(cand).isFile()) return cand;
    } catch {
      // probar siguiente layout
    }
  }
  return null;
}

function modulesImageOf(home) {
  const cand = path.join(home, "lib", "modules");
  try {
    if (fs.statSync(cand).isFile()) return cand;
  } catch {
    // sin runtime empaquetado
  }
  return null;
}
async function findJdkSource(fqn) {
  const rels = entryCandidates(fqn, ".java");
  for (const home of jdkHomes()) {
    const srczip = srcZipOf(home);
    if (!srczip) continue;
    let entries = [];
    try {
      entries = await listZip(srczip);
    } catch (err) {
      console.log(`[external] no se pudo listar ${srczip}: ${err.message}`);
      continue;
    }
    for (const rel of rels) {
      const hit = entries.find((e) => e.endsWith("/" + rel));
      if (!hit) continue;
      try {
        const text = await readZipEntry(srczip, hit);
        return { text, label: `${path.basename(home)} · src.zip` };
      } catch (err) {
        console.log(`[external] no se pudo leer ${hit}: ${err.message}`);
      }
    }
  }
  return null;
}

module.exports = { jdkHomes, findJdkSource };
