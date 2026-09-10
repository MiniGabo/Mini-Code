const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const SKIP_JAR_DIRS = new Set(["node_modules", ".git", "dist", "release"]);
async function walkJars(dir, depth, cap, into) {
  let level = [dir];
  for (let d = depth; d >= 0 && level.length > 0 && into.length < cap; d--) {
    const next = [];
    for (let i = 0; i < level.length && into.length < cap; i += 64) {
      const batch = level.slice(i, i + 64);
      const settled = await Promise.all(
        batch.map(async (parent) => {
          let entries = [];
          try {
            entries = await fsp.readdir(parent, { withFileTypes: true });
          } catch {
            return null;
          }
          const subdirs = [];
          const jars = [];
          for (const e of entries) {
            const full = path.join(parent, e.name);
            if (e.isDirectory()) {
              if (!SKIP_JAR_DIRS.has(e.name.toLowerCase())) subdirs.push(full);
            } else if (e.isFile() && e.name.toLowerCase().endsWith(".jar")) {
              jars.push(full);
            }
          }
          return { subdirs, jars };
        })
      );
      for (const r of settled) {
        if (!r) continue;
        for (const j of r.jars) {
          if (into.length < cap) into.push(j);
        }
        next.push(...r.subdirs);
      }
    }
    level = next;
  }
}

function gradleUserHome() {
  return process.env.GRADLE_USER_HOME || path.join(os.homedir(), ".gradle");
}

function mavenRepo() {
  const d = path.join(os.homedir(), ".m2", "repository");
  try {
    return fs.statSync(d).isDirectory() ? d : null;
  } catch {
    return null;
  }
}

async function filterExisting(paths) {
  const out = [];
  for (const p of paths) {
    try {
      if ((await fsp.stat(p)).isFile()) out.push(p);
    } catch {
      // inexistente: se descarta
    }
  }
  return [...new Set(out)];
}

module.exports = { walkJars, gradleUserHome, mavenRepo, filterExisting };
