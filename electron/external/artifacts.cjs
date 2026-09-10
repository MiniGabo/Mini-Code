const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { listZip, readZipEntry, entryCandidates } = require("./zip.cjs");
async function jarHasEntry(jarPath, entry) {
  try {
    const entries = await listZip(jarPath);
    return entries.includes(entry);
  } catch {
    return false;
  }
}

function sourcesJarFor(jarPath) {
  const sib = jarPath.replace(/\.jar$/i, "-sources.jar");
  if (sib === jarPath) return null;
  try {
    return fs.statSync(sib).isFile() ? sib : null;
  } catch {
    return null;
  }
}
async function findDepArtifact(fqn, build) {
  const jars = build?.jars ?? [];
  const dirs = build?.dirs ?? [];
  // Loose class directories: source impossible, direct bytecode
  for (const d of dirs) {
    for (const rel of entryCandidates(fqn, ".class")) {
      const full = path.join(d, ...rel.split("/"));
      try {
        if ((await fsp.stat(full)).isFile()) {
          return { kind: "bytecode-loose", classFile: full, label: path.basename(d) };
        }
      } catch {
        // not here
      }
    }
  }
  // Pass 1: real source (direct .java or -sources.jar sibling)
  for (const jar of jars) {
    for (const rel of entryCandidates(fqn, ".java")) {
      if (await jarHasEntry(jar, rel)) {
        try {
          const text = await readZipEntry(jar, rel);
          return { kind: "sources", text, label: `${path.basename(jar)}` };
        } catch {
          // keep searching
        }
      }
    }
    const srcJar = sourcesJarFor(jar);
    if (srcJar) {
      for (const rel of entryCandidates(fqn, ".java")) {
        if (await jarHasEntry(srcJar, rel)) {
          try {
            const text = await readZipEntry(srcJar, rel);
            return { kind: "sources", text, label: `${path.basename(srcJar)}` };
          } catch {
            // continue with the binary
          }
        }
      }
    }
  }
  // Pass 2: bytecode (.class, with $ for inner classes, or the outer one)
  for (const jar of jars) {
    const classRels = [];
    const parts = fqn.split(".");
    classRels.push(parts.join("/") + ".class");
    if (parts.length >= 2) {
      classRels.push(parts.slice(0, -1).join("/") + "$" + parts[parts.length - 1] + ".class");
    }
    for (const rel of classRels) {
      if (await jarHasEntry(jar, rel)) {
        return { kind: "bytecode", jarPath: jar, entry: rel, label: `${path.basename(jar)}!/${rel}` };
      }
    }
    // Without $ but inside the outer .java (e.g. Map.Entry lives in Map)
    for (const rel of entryCandidates(fqn, ".class").slice(1)) {
      if (await jarHasEntry(jar, rel)) {
        return { kind: "bytecode", jarPath: jar, entry: rel, label: `${path.basename(jar)}!/${rel}` };
      }
    }
  }
  return null;
}

module.exports = { findDepArtifact };
