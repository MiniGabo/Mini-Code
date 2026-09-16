// Maven Central existence checks: preferred path is main via IPC
// (window.electronAPI.checkMavenDeps: no CORS/CSP, plus local ~/.m2 and disk cache).
// Renderer fetch (search.maven.org) is only a fallback for non-Electron contexts.
// Failures degrade to "unknown" (no false errors).

export interface DepCheck {
  existsArtifact: boolean;
  existsVersion: boolean | null; // null = skipped (snapshot/dynamic/offline)
  onlyLocal?: boolean; // true = missing remotely, local ~/.m2 copy only (warn, clean builds fail)
}

interface CacheEntry {
  time: number;
  value: DepCheck;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const LS_KEY = "mini-code-maven-cache-v1";
const mem = new Map<string, CacheEntry>();
let lsLoaded = false;

function loadLs(): void {
  if (lsLoaded) return;
  lsLoaded = true;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, CacheEntry>;
    const now = Date.now();
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v.time === "number" && now - v.time < TTL_MS) mem.set(k, v);
    }
    if (mem.size > 500) {
      for (const k of [...mem.keys()].slice(0, mem.size - 500)) mem.delete(k);
    }
  } catch {
    // corrupted cache: ignore
  }
}

function saveLs(): void {
  try {
    const obj: Record<string, CacheEntry> = {};
    for (const [k, v] of mem) obj[k] = v;
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  } catch {
    // quota exceeded: ignore
  }
}

function keyOf(group: string, artifact: string): string {
  return `${group}:${artifact}`.toLowerCase();
}

function shouldSkipVersion(version: string): boolean {
  const v = version.trim();
  return (
    /-SNAPSHOT$/i.test(v) ||
    v === "+" ||
    v.includes("+") ||
    /^(LATEST|RELEASE|latest\.release|latest\.integration)$/i.test(v) ||
    /[\[\]\(\)]/.test(v) ||
    v.includes("${") ||
    v.includes("$")
  );
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function searchNumFound(query: string, ms: number): Promise<number> {
  const url = `https://search.maven.org/solrsearch/select?q=${encodeURIComponent(query)}&rows=1&wt=json`;
  const res = await fetchWithTimeout(url, ms);
  if (!res.ok) throw new Error(`http-${res.status}`);
  const json = (await res.json()) as { response?: { numFound?: number } };
  return json?.response?.numFound ?? 0;
}

async function checkArtifactUncached(group: string, artifact: string): Promise<{ exists: boolean; versions: string[] }> {
  // Renderer fallback (only when Electron IPC is unavailable): search.maven.org
  // sends CORS headers, unlike repo1.maven.org. Version membership is resolved
  // per-version by checkDep below; here we only report artifact existence.
  const g = group.trim();
  const a = artifact.trim();
  let found = 0;
  try {
    found = await searchNumFound(`g:"${g}" AND a:"${a}"`, 7000);
  } catch {
    throw new Error("offline");
  }
  if (found === 0) return { exists: false, versions: [] };
  return { exists: true, versions: [] };
}

/** Checks one dep; cached. Throws only on offline/http errors (caller treats as unknown). */
export async function checkDep(group: string, artifact: string, version: string): Promise<DepCheck> {
  loadLs();
  const k = `${keyOf(group, artifact)}@${version}`;
  const now = Date.now();
  const hit = mem.get(k);
  if (hit && now - hit.time < TTL_MS) return hit.value;
  if (shouldSkipVersion(version)) {
    return { existsArtifact: true, existsVersion: null };
  }
  const { exists } = await checkArtifactUncached(group, artifact);
  if (!exists) {
    const value: DepCheck = { existsArtifact: false, existsVersion: false };
    mem.set(k, { time: now, value });
    try {
      saveLs();
    } catch {
      // ignore
    }
    return value;
  }
  // Artifact exists: verify the exact version via search API (CORS-enabled).
  let versionFound = 0;
  try {
    versionFound = await searchNumFound(
      `g:"${group.trim()}" AND a:"${artifact.trim()}" AND v:"${version.trim()}"`,
      7000,
    );
  } catch {
    throw new Error("offline");
  }
  const value: DepCheck = { existsArtifact: true, existsVersion: versionFound > 0 };
  mem.set(k, { time: now, value });
  if (mem.size > 500) {
    const first = mem.keys().next().value;
    if (first) mem.delete(first);
  }
  // Persist throttled: every write is fine at this volume (few deps per file).
  try {
    saveLs();
  } catch {
    // ignore
  }
  return value;
}

/** Batch with dedup + concurrency limit. Unknown (offline) deps are omitted from the result. */
export async function checkDeps(
  deps: Array<{ group: string; artifact: string; version: string }>,
  opts?: { concurrency?: number; signal?: AbortSignal; repos?: Array<{ id?: string; url: string }> },
): Promise<Map<string, DepCheck>> {
  const repos = (opts?.repos ?? []).filter((r) => r && /^https?:\/\//i.test(r.url)).slice(0, 8);
  // Preferred path: main process via IPC (no CORS/CSP, plus local ~/.m2 + disk cache).
  try {
    const api = window.electronAPI as unknown as {
      checkMavenDeps?: (
        deps: Array<{ group: string; artifact: string; version: string }>,
        repos?: Array<{ id?: string; url: string }>,
      ) => Promise<{
        ok: boolean;
        results?: Record<string, DepCheck>;
      }>;
    };
    if (api?.checkMavenDeps) {
      const uniqIpc = new Map<string, { group: string; artifact: string; version: string }>();
      for (const d of deps) {
        const k = `${keyOf(d.group, d.artifact)}@${d.version}`;
        if (!uniqIpc.has(k)) uniqIpc.set(k, d);
      }
      const sliced = [...uniqIpc.entries()].slice(0, 60);
      if (sliced.length === 0) return new Map();
      try {
        const res = await api.checkMavenDeps(
          sliced.map(([, d]) => d),
          repos,
        );
        const out = new Map<string, DepCheck>();
        if (res?.ok && res.results) {
          for (const [k, v] of Object.entries(res.results)) {
            if (!v || v.existsVersion === null) continue;
            out.set(k, v);
          }
        }
        return out;
      } catch {
        // IPC error (e.g. stale main without handler): renderer fallback below.
      }
    }
  } catch {
    // fall through to renderer fetch (dev web without Electron)
  }
  const out = new Map<string, DepCheck>();
  const uniq = new Map<string, { group: string; artifact: string; version: string }>();
  for (const d of deps) {
    const k = `${keyOf(d.group, d.artifact)}@${d.version}`;
    if (!uniq.has(k)) uniq.set(k, d);
  }
  const entries = [...uniq.entries()].slice(0, 60); // cap per file
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 4, 6));
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < entries.length) {
      if (opts?.signal?.aborted) return;
      const [k, d] = entries[idx++];
      try {
        const r = await checkDep(d.group, d.artifact, d.version);
        if (r.existsVersion === null) continue; // skipped: no marker
        out.set(k, r);
      } catch {
        // offline or http error: omit (no false positives)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return out;
}

export function depKeyOf(group: string, artifact: string, version: string): string {
  return `${keyOf(group, artifact)}@${version}`;
}
