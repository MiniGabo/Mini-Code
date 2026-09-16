// Local (sync, offline) validation for pom.xml.
// No network here: existence checks live in build/mavenCentral.ts.

import { rangeFromOffsets, lineRange, type BuildRange, type RepoDef } from "../build/positions";
import { t } from "../../stores/settingsStore";

export interface PomIssue {
  message: string;
  /** 8 = Error, 4 = Warning (Monaco severities). */
  severity: 8 | 4;
  source: string;
  code?: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface PomDep {
  group: string;
  artifact: string;
  version: string;
  range: BuildRange;
}

export interface PomValidation {
  issues: PomIssue[];
  deps: PomDep[];
  /** Repositories declared in <repositories> / <pluginRepositories> (first match wins). */
  repos: RepoDef[];
}

/** Extracts <repository> (and <pluginRepository>) {id, url} pairs. */
export function parsePomRepos(text: string, props: Map<string, string>): RepoDef[] {
  const repos: RepoDef[] = [];
  const seen = new Set<string>();
  const blocks = [
    ...text.matchAll(/<repositories>([\s\S]*?)<\/repositories>/gi),
    ...text.matchAll(/<pluginRepositories>([\s\S]*?)<\/pluginRepositories>/gi),
  ];
  for (const b of blocks) {
    for (const r of b[1].matchAll(/<repository>([\s\S]*?)<\/repository>/gi)) {
      const body = r[1];
      const id = /<id>\s*([^<]+?)\s*<\/id>/i.exec(body)?.[1]?.trim();
      let url = /<url>\s*([^<]+?)\s*<\/url>/i.exec(body)?.[1]?.trim() ?? "";
      if (!url) continue;
      url = url.replace(/\$\{([^}]+)\}/g, (_, n) => props.get(n.trim()) ?? "");
      if (!/^https?:\/\//i.test(url) || url.includes("${") || url.includes("$")) continue;
      url = url.replace(/\/+$/, "");
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      repos.push({ id, url });
      if (repos.length >= 8) return repos;
    }
  }
  return repos;
}

function mkIssue(
  message: string,
  severity: 8 | 4,
  range: BuildRange,
  code?: string,
): PomIssue {
  return {
    message,
    severity,
    source: "pom-xml",
    code,
    startLineNumber: range.startLineNumber,
    startColumn: range.startColumn,
    endLineNumber: range.endLineNumber,
    endColumn: range.endColumn,
  };
}

function isConcreteCoord(s: string): boolean {
  return s.length > 0 && !s.includes("${") && !s.includes("$");
}

function isDynamicVersion(v: string): boolean {
  const t = v.trim();
  return (
    t === "+" ||
    t === "LATEST" ||
    t === "RELEASE" ||
    t === "latest.release" ||
    t === "latest.integration" ||
    t.includes("+") ||
    /[\[\]\(\)]/.test(t) ||
    t === "*"
  );
}

/** Well-formedness via DOMParser. Returns an issue or null. */
function checkWellFormed(text: string): PomIssue | null {
  if (!text.trim()) return null;
  try {
    const doc = new DOMParser().parseFromString(text, "text/xml");
    const err = doc.querySelector("parsererror");
    if (!err) return null;
    const msg = (err.textContent ?? t("pom.malformedFallback")).replace(/\s+/g, " ").trim().slice(0, 300);
    // DOMParser errors sometimes include a line number ("line 12").
    const m = /line\s+(\d+)/i.exec(msg);
    const line = m ? Math.max(1, parseInt(m[1], 10)) : 1;
    return mkIssue(t("pom.malformed", { msg }), 8, lineRange(text, line), "xml-syntax");
  } catch (e) {
    return mkIssue(
      t("pom.malformed", { msg: String((e as Error)?.message ?? e) }),
      8,
      lineRange(text, 1),
      "xml-syntax",
    );
  }
}

export function validatePomText(text: string): PomValidation {
  const issues: PomIssue[] = [];
  const deps: PomDep[] = [];
  const malformed = checkWellFormed(text);
  if (malformed) issues.push(malformed);

  // Properties for ${...} resolution (local only).
  const props = new Map<string, string>();
  const propBlock = /<properties>([\s\S]*?)<\/properties>/i.exec(text);
  if (propBlock) {
    const blockStart = (propBlock.index ?? 0) + propBlock[0].indexOf(propBlock[1]);
    for (const m of propBlock[1].matchAll(/<([\w$.~-]+)>([^<]*)<\/([\w$.~-]+)>/g)) {
      const open = m[1].trim();
      const close = m[3].trim();
      if (open && open === close) props.set(open, m[2].trim());
    }
    void blockStart;
  }

  const repos = parsePomRepos(text, props);

  const depRe = /<dependency>([\s\S]*?)<\/dependency>/g;
  let dm: RegExpExecArray | null;
  while ((dm = depRe.exec(text)) !== null) {
    const body = dm[1];
    const blockStart = dm.index;
    const blockEnd = dm.index + dm[0].length;
    const blockRange = rangeFromOffsets(text, blockStart, blockEnd);

    const g = /<groupId>\s*([^<]+?)\s*<\/groupId>/.exec(body);
    const a = /<artifactId>\s*([^<]+?)\s*<\/artifactId>/.exec(body);
    const v = /<version>\s*([^<]+?)\s*<\/version>/.exec(body);
    const scope = /<scope>\s*([^<]+?)\s*<\/scope>/.exec(body);
    void scope;

    if (!g || !g[1].trim()) {
      issues.push(mkIssue(t("pom.noGroupId"), 8, blockRange, "pom-coords"));
      continue;
    }
    if (!a || !a[1].trim()) {
      issues.push(mkIssue(t("pom.noArtifactId"), 8, blockRange, "pom-coords"));
      continue;
    }
    const group = g[1].trim();
    const artifact = a[1].trim();
    if (!isConcreteCoord(group) || !isConcreteCoord(artifact)) {
      // Unresolvable locally (e.g. ${...} from parent): skip quietly.
      continue;
    }

    if (!v || !v[1].trim()) {
      // Managed by dependencyManagement/parent is common: warning, not error.
      const depLabel = `${group}:${artifact}`;
      issues.push(
        mkIssue(
          t("pom.noVersion", { label: depLabel }),
          4,
          blockRange,
          "pom-version-missing",
        ),
      );
      continue;
    }
    const rawVersion = v[1].trim();
    const vStartInBody = body.indexOf(v[0]);
    const absStart = blockStart + dm[0].indexOf("<dependency>") + "<dependency>".length + vStartInBody;
    const vRange = rangeFromOffsets(text, absStart, absStart + v[0].length);
    const unresolved = [...rawVersion.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1].trim());
    // Predefined Maven properties resolve outside <properties>: don't flag them.
    const isPredefined = (n: string) =>
      /^(project|maven|env|settings|basedir|file)(\.|$)/.test(n) ||
      ["basedir", "file.separator", "line.separator", "path.separator"].includes(n);
    const unknownProp = unresolved.find((n) => !props.has(n) && !isPredefined(n));
    if (unknownProp) {
      issues.push(
        mkIssue(
          t("pom.unknownProp", { prop: "${" + unknownProp + "}" }),
          8,
          vRange,
          "pom-property",
        ),
      );
      continue;
    }
    // Resolve defined properties so property-driven versions are also checked remotely.
    // Unresolvable predefined props (project.version, env.X...) are skipped quietly.
    const version = rawVersion.replace(/\$\{([^}]+)\}/g, (_, n) =>
      props.has(n.trim()) ? (props.get(n.trim()) as string) : `\${${n}}`,
    );
    if (!isConcreteCoord(version)) {
      continue;
    }
    if (isDynamicVersion(version)) {
      issues.push(
        mkIssue(
          t("pom.dynamicVersion", { version }),
          4,
          vRange,
          "pom-version-dynamic",
        ),
      );
      continue;
    }
    deps.push({ group, artifact, version, range: vRange });
  }

  return { issues, deps, repos };
}
