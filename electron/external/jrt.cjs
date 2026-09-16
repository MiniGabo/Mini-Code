const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const { execFileAsync } = require("./proc.cjs");
const { toolNextToJava } = require("./javaTools.cjs");
const { entryCandidates } = require("./zip.cjs");
const { jdkHomes, modulesImageOf } = require("./jdk.cjs");
let jrtDirCache = new Map(); // homeLower -> dir
async function jrtExtractedDir(home) {
  const key = home.toLowerCase();
  if (jrtDirCache.has(key)) return jrtDirCache.get(key);
  const image = modulesImageOf(home);
  if (!image) return null;
  const tag = path.basename(home).replace(/[^a-z0-9]+/gi, "-");
  const dir = path.join(os.tmpdir(), "mini-code-jrt", tag);
  const marker = path.join(dir, ".mini-code-ok");
  const p = (async () => {
    try {
      await fsp.stat(marker);
      return dir;
    } catch {
      // first time: full extraction (may take ~1 min)
    }
    console.log(`[external] extrayendo runtime de ${home} (una sola vez)...`);
    await fsp.mkdir(dir, { recursive: true });
    await execFileAsync(toolNextToJava("jimage"), ["extract", "--dir", dir, image], { timeoutMs: 300000 });
    await fsp.writeFile(marker, String(Date.now()), "utf8");
    return dir;
  })();
  jrtDirCache.set(key, p);
  return p;
}

let jrtFilesCache = new Map(); // dirLower -> string[] (absolute paths)
// Only platform packages (java/jdk/javax): the rest never lives in the
// runtime. And only the FIRST JDK is extracted (the others solely if already
// extracted before): avoids cascading extractions of hundreds of MB.
async function findJrtClass(fqn) {
  if (!/^(java|jdk|javax)\./.test(fqn)) return null;
  const rels = entryCandidates(fqn, ".class");
  const homes = jdkHomes();
  for (let i = 0; i < homes.length; i++) {
    const home = homes[i];
    if (i > 0) {
      const tag = path.basename(home).replace(/[^a-z0-9]+/gi, "-");
      try {
        await fsp.stat(path.join(os.tmpdir(), "mini-code-jrt", tag, ".mini-code-ok"));
      } catch {
        continue; // don't extract more JDKs on a miss
      }
    }
    let dir = null;
    try {
      dir = await jrtExtractedDir(home);
    } catch (err) {
      console.log(`[external] jimage falló para ${home}: ${err.message}`);
      continue;
    }
    if (!dir) continue;
    const dkey = dir.toLowerCase();
    if (!jrtFilesCache.has(dkey)) {
      const found = [];
      const walk = async (d, depth) => {
        if (depth < 0 || found.length >= 60000) return;
        let entries = [];
        try {
          entries = await fsp.readdir(d, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) await walk(full, depth - 1);
          else if (e.isFile() && e.name.endsWith(".class")) found.push(full);
        }
      };
      await walk(dir, 8);
      jrtFilesCache.set(dkey, found);
    }
    const files = jrtFilesCache.get(dkey);
    for (const rel of rels) {
      const suffix = rel.replace(/\//g, path.sep).toLowerCase();
      const hit = files.find((f) => f.toLowerCase().endsWith(path.sep + suffix));
      if (hit) return { kind: "bytecode-loose", classFile: hit, label: `${path.basename(home)} · runtime` };
    }
  }
  return null;
}

module.exports = { findJrtClass };
