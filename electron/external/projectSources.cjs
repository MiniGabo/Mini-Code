const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const SKIP_SRC_DIRS = new Set([
  "node_modules", ".git", "dist", "release", "target", "build", "out", "bin",
  ".gradle", ".idea", ".vscode",
]);

async function walkJavaSources(dir, depth, cap, into) {
  let level = [dir];
  for (let d = depth; d >= 0 && level.length > 0 && into.length < cap; d--) {
    const next = [];
    for (let i = 0; i < level.length && into.length < cap; i += 64) {
      const settled = await Promise.all(
        level.slice(i, i + 64).map(async (parent) => {
          let entries = [];
          try {
            entries = await fsp.readdir(parent, { withFileTypes: true });
          } catch {
            return null;
          }
          const subdirs = [];
          const files = [];
          for (const e of entries) {
            const full = path.join(parent, e.name);
            if (e.isDirectory()) {
              if (!SKIP_SRC_DIRS.has(e.name.toLowerCase())) subdirs.push(full);
            } else if (e.isFile() && e.name.toLowerCase().endsWith(".java")) {
              files.push(full);
            }
          }
          return { subdirs, files };
        })
      );
      for (const r of settled) {
        if (!r) continue;
        for (const f of r.files) {
          if (into.length < cap) into.push(f);
        }
        next.push(...r.subdirs);
      }
    }
    level = next;
  }
}

function javaSrcIndexPath(rootPath) {
  const tag = crypto.createHash("sha1").update((rootPath ?? "").toLowerCase()).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), "mini-code-javasrc", tag + ".json");
}

let javaSrcCache = { key: null, rels: null }; // rels: Set of "com/foo/Bar.java"
async function projectSourceRels(rootPath) {
  const key = (rootPath ?? "").toLowerCase();
  if (javaSrcCache.key === key && javaSrcCache.rels) return javaSrcCache.rels;
  let rels = null;
  try {
    const raw = await fsp.readFile(javaSrcIndexPath(rootPath), "utf8");
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.rels) && Date.now() - (data.time ?? 0) < 6 * 3600 * 1000) {
      rels = new Set(data.rels);
    }
  } catch {
    // missing or expired index: walk
  }
  if (!rels && rootPath) {
    try {
      if ((await fsp.stat(rootPath)).isDirectory()) {
        const files = [];
        await walkJavaSources(rootPath, 8, 6000, files);
        const root = path.resolve(rootPath);
        rels = new Set(
          files.map((f) => path.relative(root, f).split(path.sep).join("/"))
        );
        try {
          const idxFile = javaSrcIndexPath(rootPath);
          await fsp.mkdir(path.dirname(idxFile), { recursive: true });
          await fsp.writeFile(idxFile, JSON.stringify({ time: Date.now(), rels: [...rels] }), "utf8");
        } catch {
          // best-effort cache
        }
      }
    } catch {
      // unreadable root
    }
  }
  if (!rels) rels = new Set();
  javaSrcCache = { key, rels };
  return rels;
}

// Does the project have the source for this FQN? (any source root:
// src/main/java, src, ...: it just needs to end with the FQN path)
async function hasProjectSource(fqn, rootPath) {
  if (!rootPath) return false;
  const rels = await projectSourceRels(rootPath);
  if (rels.size === 0) return false;
  const want = fqn.replace(/\./g, "/") + ".java";
  for (const r of rels) {
    if (r === want || r.endsWith("/" + want)) return true;
  }
  return false;
}

module.exports = { hasProjectSource };
