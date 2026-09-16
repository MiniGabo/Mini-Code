// Local (sync, offline) validation for build.gradle / build.gradle.kts.
// Supports common notations only; anything exotic is ignored to avoid false positives.

import { rangeFromOffsets, type BuildRange, type RepoDef } from "../build/positions";
import { t } from "../../stores/settingsStore";

export interface GradleIssue {
  message: string;
  severity: 8 | 4;
  source: string;
  code?: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface GradleDep {
  group: string;
  artifact: string;
  version: string;
  range: BuildRange;
}

export interface GradleValidation {
  issues: GradleIssue[];
  deps: GradleDep[];
  /** Repositories declared in repositories {} (first match wins). */
  repos: RepoDef[];
}

const WELL_KNOWN_REPOS: Array<[RegExp, RepoDef]> = [
  [/\bmavenCentral\s*\(\s*\)/, { id: "mavenCentral", url: "https://repo1.maven.org/maven2" }],
  [/\bgoogle\s*\(\s*\)/, { id: "google", url: "https://maven.google.com" }],
  [/\bgradlePluginPortal\s*\(\s*\)/, { id: "gradlePluginPortal", url: "https://plugins.gradle.org/m2" }],
];

/** Extracts repositories from repositories { ... }: well-known + maven(url). */
export function parseGradleRepos(text: string): RepoDef[] {
  const repos: RepoDef[] = [];
  const seen = new Set<string>();
  const push = (r: RepoDef) => {
    const key = r.url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    repos.push(r);
  };
  for (const [re, def] of WELL_KNOWN_REPOS) {
    if (re.test(text)) push(def);
    if (repos.length >= 8) return repos;
  }
  // maven("https://...") / maven { url = uri("https://...") } / maven { url "https://..." }
  const urlRe = /maven\s*(?:\(\s*["']([^"']+)["']\s*\)|\{\s*[^}]*?url\s*(?:=\s*)?(?:uri\s*\(\s*)?["']([^"']+)["'])/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(text)) !== null) {
    let url = (m[1] ?? m[2] ?? "").trim();
    if (!url || !/^https?:\/\//i.test(url) || url.includes("$")) continue;
    url = url.replace(/\/+$/, "");
    push({ id: "maven", url });
    if (repos.length >= 8) break;
  }
  return repos;
}

function mkIssue(message: string, severity: 8 | 4, range: BuildRange, code?: string): GradleIssue {
  return {
    message,
    severity,
    source: "gradle",
    code,
    startLineNumber: range.startLineNumber,
    startColumn: range.startColumn,
    endLineNumber: range.endLineNumber,
    endColumn: range.endColumn,
  };
}

const CONFIGS =
  "(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testApi|testCompileOnly|testRuntimeOnly|compile|runtime|provided|annotationProcessor|testAnnotationProcessor|kapt|ksp|enforcedPlatform|platform)";

function isDynamicVersion(v: string): boolean {
  const t = v.trim();
  return (
    t === "+" ||
    t === "latest.release" ||
    t === "latest.integration" ||
    t.includes("+") ||
    t === "*" ||
    /[\[\]\(\)]/.test(t) ||
    /^[^\d]/.test(t) && /^(latest|newest)/i.test(t)
  );
}

function isSnapshot(v: string): boolean {
  return /-SNAPSHOT$/i.test(v.trim());
}

function pushDep(deps: GradleDep[], group: string, artifact: string, version: string, range: BuildRange): void {
  if (!group || !artifact || !version) return;
  if (version.includes("$")) return;
  if (/[()'"`]/.test(group + artifact + version)) return;
  deps.push({ group, artifact, version, range });
}

export function validateGradleText(text: string): GradleValidation {
  const issues: GradleIssue[] = [];
  const deps: GradleDep[] = [];
  if (!text.trim()) return { issues, deps, repos: [] };

  // Local constants (def x = "...", val x = "..." in kts, ext.x = "...")
  // to resolve interpolated versions like "g:a:$myVersion".
  const defs = new Map<string, string>();
  for (const dm of text.matchAll(/^\s*(?:def\s+|val\s+|ext\.)?([\w$]+)\s*=\s*["']([^"']+)["']/gm)) {
    defs.set(dm[1], dm[2]);
  }
  const subst = (s: string): string =>
    s.replace(/\$\{([\w$.]+)\}|\$([\w$]+)/g, (mm, a, b) => {
      const k: string = a ?? b ?? "";
      const short = k.includes(".") ? k.split(".").pop() ?? k : k;
      return defs.get(k) ?? defs.get(short) ?? mm;
    });

  // 1) String notation: implementation("g:a:v") / implementation('g:a:v') / implementation "g:a"
  const strRe = new RegExp(CONFIGS + "\\s*\\(?\\s*['\"]([^'\"]+)['\"]", "g");
  let m: RegExpExecArray | null;
  while ((m = strRe.exec(text)) !== null) {
    const raw = m[1];
    const absStart = m.index + m[0].indexOf(raw);
    const range = rangeFromOffsets(text, absStart, absStart + raw.length);
    // Resolve local constants first; truly dynamic refs (libs.*, unresolved $) are skipped.
    const expanded = subst(raw);
    if (expanded.includes("$")) continue; // interpolated / catalog-backed: skip
    const parts = expanded.split(":");
    if (parts.length < 2 || parts.length > 3 || parts.some((p) => !p.trim())) {
      issues.push(
        mkIssue(
          t("gradle.badCoords", { raw }),
          8,
          range,
          "gradle-coords",
        ),
      );
      continue;
    }
    if (parts.length === 2) {
      issues.push(
        mkIssue(
          t("gradle.noVersion", { raw }),
          4,
          range,
          "gradle-version-missing",
        ),
      );
      continue;
    }
    const [group, artifact, version] = parts.map((p) => p.trim());
    if (isDynamicVersion(version)) {
      issues.push(
        mkIssue(
          t("gradle.dynamicVersion", { version, coords: `${group}:${artifact}` }),
          4,
          range,
          "gradle-version-dynamic",
        ),
      );
      continue;
    }
    if (isSnapshot(version)) {
      issues.push(
        mkIssue(
          t("gradle.snapshot", { version }),
          4,
          range,
          "gradle-snapshot",
        ),
      );
      continue;
    }
    pushDep(deps, group, artifact, version, range);
  }

  // 2) Map notation: group: 'g', name: 'a', version: 'v' (any order, one line)
  const mapRe =
    /(?:group\s*[:=]\s*['"]([^'"]+)['"]\s*[,;]?\s*name\s*[:=]\s*['"]([^'"]+)['"]\s*[,;]?\s*version\s*[:=]\s*['"]([^'"]+)['"]|name\s*[:=]\s*['"]([^'"]+)['"]\s*[,;]?\s*group\s*[:=]\s*['"]([^'"]+)['"]\s*[,;]?\s*version\s*[:=]\s*['"]([^'"]+)['"])/g;
  while ((m = mapRe.exec(text)) !== null) {
    const full = m[0];
    const absStart = m.index;
    const range = rangeFromOffsets(text, absStart, absStart + full.length);
    const group = (m[1] ?? m[5] ?? "").trim();
    const artifact = (m[2] ?? m[4] ?? "").trim();
    const version = (m[3] ?? m[6] ?? "").trim();
    if (!group || !artifact || !version || version.includes("$")) continue;
    if (isDynamicVersion(version)) {
      issues.push(
        mkIssue(t("gradle.dynamicVersionShort", { version, coords: `${group}:${artifact}` }), 4, range, "gradle-version-dynamic"),
      );
      continue;
    }
    pushDep(deps, group, artifact, version, range);
  }

  // 3) Kotlin DSL: implementation("g", "a", "v")
  const ktsRe = new RegExp(CONFIGS + '\\s*\\(\\s*"([^"]+)"\\s*,\\s*"([^"]+)"\\s*,\\s*"([^"]+)"\\s*\\)', "g");
  while ((m = ktsRe.exec(text)) !== null) {
    const group = m[1].trim();
    const artifact = m[2].trim();
    const version = m[3].trim();
    const absStart = m.index;
    const range = rangeFromOffsets(text, absStart, absStart + m[0].length);
    if (!group || !artifact || !version || version.includes("$")) continue;
    if (isDynamicVersion(version)) {
      issues.push(
        mkIssue(t("gradle.dynamicVersionShort", { version, coords: `${group}:${artifact}` }), 4, range, "gradle-version-dynamic"),
      );
      continue;
    }
    pushDep(deps, group, artifact, version, range);
  }

  // 4) libs.* catalog accessors: can't resolve without TOML here -> ignore (no false positives).
  // 5) plugins { id("x") version "y" }: version check only if literal and malformed.
  const pluginRe = /id\s*\(\s*['"]([^'"]+)['"]\s*\)\s*version\s*['"]([^'"]+)['"]/g;
  while ((m = pluginRe.exec(text)) !== null) {
    const pluginId = m[1].trim();
    const version = m[2].trim();
    if (!pluginId) {
      const range = rangeFromOffsets(text, m.index, m.index + m[0].length);
      issues.push(mkIssue(t("gradle.pluginNoId"), 8, range, "gradle-plugin"));
    }
    if (version.includes("$")) continue;
    if (version && isDynamicVersion(version)) {
      const range = rangeFromOffsets(text, m.index, m.index + m[0].length);
      issues.push(mkIssue(t("gradle.pluginDynamic", { version }), 4, range, "gradle-version-dynamic"));
    }
  }

  return { issues, deps, repos: parseGradleRepos(text) };
}
