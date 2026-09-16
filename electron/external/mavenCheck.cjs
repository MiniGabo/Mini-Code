// Maven existence checks in main (Node): no CORS/CSP issues.
// Strategy per dep: local repo hit (~/.m2, ~/.gradle) -> exists;
// else artifact metadata from Central + declared <repositories> (disk cache, 24h TTL).
// SNAPSHOT versions resolve via version metadata in the declared repos
// (Central alone never hosts them -> skipped as before).
// Unknown on network error (no false positives).

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const https = require("https");
const { mavenRepo, gradleUserHome } = require("./jars.cjs");

const TTL_MS = 24 * 60 * 60 * 1000;
const CENTRAL = "https://repo1.maven.org/maven2";

/** Central first, then declared repos (deduped, capped). */
function normBases(repos) {
  const out = [CENTRAL];
  const seen = new Set([CENTRAL]);
  for (const r of repos ?? []) {
    let url = String((r && r.url) || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(url)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= 6) break;
  }
  return out;
}

function basesKey(bases) {
  return bases.join("|").toLowerCase();
}

function cacheDir() {
  return path.join(os.tmpdir(), "mini-code-mavencheck");
}

function cacheFileFor(group, artifact, bases) {
  const tag = crypto
    .createHash("sha1")
    .update(basesKey(bases) + "|" + `${group}:${artifact}`.toLowerCase())
    .digest("hex")
    .slice(0, 16);
  return path.join(cacheDir(), tag + ".json");
}

function isSnapshotVersion(version) {
  return /-SNAPSHOT$/i.test(String(version ?? "").trim());
}

function shouldSkipVersion(version) {
  const v = String(version ?? "").trim();
  return (
    v === "+" ||
    v.includes("+") ||
    /^(LATEST|RELEASE|latest\.release|latest\.integration)$/i.test(v) ||
    /[\[\]\(\)]/.test(v) ||
    v.includes("${") ||
    v.includes("$")
  );
}

function groupPath(group) {
  return String(group).trim().split(".").map(encodeURIComponent).join("/");
}

function localExists(group, artifact, version) {
  const v = String(version).trim();
  try {
    const repo = mavenRepo();
    if (repo) {
      const jar = path.join(repo, ...String(group).split("."), artifact, v, `${artifact}-${v}.jar`);
      const pom = path.join(repo, ...String(group).split("."), artifact, v, `${artifact}-${v}.pom`);
      if (fs.existsSync(jar) || fs.existsSync(pom)) return true;
      // Any version dir proves the artifact exists (used for existsArtifact fallback)
    }
  } catch {
    // ignore
  }
  try {
    const base = path.join(gradleUserHome(), "caches", "modules-2", "files-2.1", group, artifact, v);
    if (fs.statSync(base).isDirectory()) return true;
  } catch {
    // not cached
  }
  return false;
}

function localArtifactExists(group, artifact) {
  try {
    const repo = mavenRepo();
    if (repo) {
      const dir = path.join(repo, ...String(group).split("."), artifact);
      if (fs.statSync(dir).isDirectory()) return true;
    }
  } catch {
    // no
  }
  try {
    const dir = path.join(gradleUserHome(), "caches", "modules-2", "files-2.1", group, artifact);
    if (fs.statSync(dir).isDirectory()) return true;
  } catch {
    // no
  }
  return false;
}

function fetchText(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { timeout: timeoutMs, headers: { "User-Agent": "Mini-Code/0.0.1" } },
      (res) => {
        if (res.statusCode === 404) {
          res.resume();
          resolve({ status: 404, text: "" });
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`http-${res.statusCode}`));
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          data += c;
          if (data.length > 512 * 1024) {
            req.destroy();
            reject(new Error("metadata-too-large"));
          }
        });
        res.on("end", () => resolve({ status: res.statusCode, text: data }));
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", reject);
  });
}

function parseVersions(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<version>([^<]+)<\/version>/g)) {
    const v = m[1].trim();
    if (v) out.push(v);
  }
  return out;
}

async function readCache(group, artifact, bases) {
  try {
    const raw = await fsp.readFile(cacheFileFor(group, artifact, bases), "utf8");
    const data = JSON.parse(raw);
    if (data && Date.now() - data.time < TTL_MS && Array.isArray(data.versions)) return data;
  } catch {
    // miss
  }
  return null;
}

async function writeCache(group, artifact, bases, versions) {
  try {
    await fsp.mkdir(cacheDir(), { recursive: true });
    await fsp.writeFile(
      cacheFileFor(group, artifact, bases),
      JSON.stringify({ time: Date.now(), versions }),
      "utf8",
    );
  } catch {
    // best-effort
  }
}

/** Single metadata fetch with 1 retry (Central rate-limits bursts). Resolves 404, rejects otherwise. */
async function fetchMetaWithRetry(url) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fetchText(url, 10000);
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastErr;
}

/** Union of <version> lists across all repos that publish the artifact. */
async function fetchArtifactVersions(group, artifact, bases) {
  const gp = groupPath(group);
  const art = encodeURIComponent(String(artifact).trim());
  const settled = await Promise.allSettled(
    bases.map((b) => fetchMetaWithRetry(`${b}/${gp}/${art}/maven-metadata.xml`)),
  );
  const union = new Set();
  let sawArtifact = false;
  let lastErr = null;
  settled.forEach((s) => {
    if (s.status === "fulfilled") {
      if (s.value.status === 404) return; // not in this repo: try next
      sawArtifact = true;
      for (const v of parseVersions(s.value.text)) union.add(v);
    } else {
      lastErr = s.reason;
    }
  });
  return { versions: [...union], sawArtifact, lastErr };
}

/** SNAPSHOT: published iff version metadata exists in any declared (non-Central) repo. */
async function checkSnapshot(group, artifact, v, bases) {
  const customs = bases.filter((b) => b.toLowerCase() !== CENTRAL);
  if (customs.length === 0) return { existsArtifact: true, existsVersion: null };
  const hadLocal = localExists(group, artifact, v);
  const gp = groupPath(group);
  const art = encodeURIComponent(String(artifact).trim());
  const ver = encodeURIComponent(v);
  const settled = await Promise.allSettled(
    customs.map((b) => fetchMetaWithRetry(`${b}/${gp}/${art}/${ver}/maven-metadata.xml`)),
  );
  let lastErr = null;
  for (const s of settled) {
    if (s.status === "fulfilled") {
      if (s.value.status === 404) continue;
      return { existsArtifact: true, existsVersion: true }; // snapshot metadata published
    }
    lastErr = s.reason;
  }
  if (lastErr) {
    if (localArtifactExists(group, artifact)) {
      return { existsArtifact: true, existsVersion: null };
    }
    throw lastErr;
  }
  // Missing in every declared repo: local copy only -> warn (clean builds fail).
  if (hadLocal || localArtifactExists(group, artifact)) {
    return { existsArtifact: false, existsVersion: false, onlyLocal: true };
  }
  return { existsArtifact: false, existsVersion: false };
}

async function checkOne(group, artifact, version, repos) {
  if (shouldSkipVersion(version)) return { existsArtifact: true, existsVersion: null };
  const bases = normBases(repos);
  const v = String(version).trim();
  if (isSnapshotVersion(v)) return checkSnapshot(group, artifact, v, bases);
  const hadLocal = localExists(group, artifact, v);
  const cached = await readCache(group, artifact, bases);
  if (cached) {
    if (cached.versions.includes(v)) return { existsArtifact: true, existsVersion: true };
    // Definitive miss in the cached remote union: local copy only -> warn.
    if (hadLocal) return { existsArtifact: true, existsVersion: false, onlyLocal: true };
    return { existsArtifact: true, existsVersion: false };
  }
  const { versions, sawArtifact, lastErr } = await fetchArtifactVersions(group, artifact, bases);
  if (sawArtifact) {
    await writeCache(group, artifact, bases, versions);
    if (versions.includes(v)) return { existsArtifact: true, existsVersion: true };
    if (hadLocal) return { existsArtifact: true, existsVersion: false, onlyLocal: true };
    return { existsArtifact: true, existsVersion: false };
  }
  if (lastErr) {
    // Offline/rate-limit: local artifact dir still proves existence (version unknown -> omit).
    if (localArtifactExists(group, artifact)) {
      return { existsArtifact: true, existsVersion: null };
    }
    throw lastErr;
  }
  // Missing in Central and every declared repo: local copy only -> warn.
  if (hadLocal || localArtifactExists(group, artifact)) {
    return { existsArtifact: false, existsVersion: false, onlyLocal: true };
  }
  return { existsArtifact: false, existsVersion: false };
}

async function checkMany(deps, repos) {
  const uniq = new Map();
  for (const d of deps ?? []) {
    if (!d || !d.group || !d.artifact || !d.version) continue;
    const k = `${String(d.group)}:${String(d.artifact)}`.toLowerCase() + `@${String(d.version)}`;
    if (!uniq.has(k)) uniq.set(k, { group: String(d.group), artifact: String(d.artifact), version: String(d.version), key: k });
  }
  const entries = [...uniq.values()].slice(0, 60);
  const results = {};
  const concurrency = 4;
  let idx = 0;
  async function worker() {
    while (idx < entries.length) {
      const d = entries[idx++];
      try {
        const r = await checkOne(d.group, d.artifact, d.version, repos);
        if (r.existsVersion !== null) results[d.key] = r;
      } catch {
        // unknown: omitted (no false positives)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, entries.length)) }, worker));
  return results;
}

module.exports = { checkMany, checkOne };
