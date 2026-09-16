// Live validation for pom.xml / build.gradle / build.gradle.kts.
// Sync local checks run immediately + on typing (debounced); Maven Central
// existence runs async with cache and never produces false errors offline.
// Output: Monaco markers (squiggle + hover) + sidebar/tab badges via owner counts.

import { validatePomText } from "../../../languages/maven/pomValidator";
import { validateGradleText } from "../../../languages/gradle/gradleValidator";
import { checkDeps, depKeyOf, type DepCheck } from "../../../languages/build/mavenCentral";
import { t } from "../../../stores/settingsStore";
import type { RepoDef } from "../../../languages/build/positions";
import {
  setOwnerErrors,
  clearOwnerForFile,
  fsKeyOfModel,
} from "./diagnostics";

export function isBuildFileName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return n === "pom.xml" || n === "build.gradle" || n === "build.gradle.kts";
}

function ownerFor(name: string): string {
  const n = name.toLowerCase();
  if (n === "pom.xml") return "pom-xml";
  return "gradle";
}

function baseNameOf(model: any, fallback: string): string {
  try {
    const p: string = model.uri.fsPath ?? model.uri.toString() ?? fallback;
    return p.split(/[\\/]/).pop() ?? fallback;
  } catch {
    return fallback;
  }
}

export function attachBuildDiagnostics(
  monaco: any,
  editor: any,
  fileNameHint: string,
): (() => void) | null {
  const model = editor?.getModel?.();
  if (!model || !monaco) return null;
  const fileName = baseNameOf(model, fileNameHint);
  if (!isBuildFileName(fileName)) return null;
  const owner = ownerFor(fileName);
  const isPom = fileName.toLowerCase() === "pom.xml";

  let disposed = false;
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let remoteTimer: ReturnType<typeof setTimeout> | null = null;
  let remoteCtl: AbortController | null = null;
  let runId = 0;

  const applyMarkers = (issues: Array<{ message: string; severity: 8 | 4; source: string; code?: string; startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }>) => {
    if (disposed) return;
    try {
      monaco.editor.setModelMarkers(model, owner, issues);
    } catch {
      // model disposed
    }
    const errors = issues.filter((i) => i.severity === 8).length;
    try {
      setOwnerErrors(fsKeyOfModel(monaco, model), owner, errors);
    } catch {
      // badges best-effort
    }
  };

  const runSync = () => {
    let text = "";
    try {
      text = model.getValue();
    } catch {
      return { issues: [], deps: [], repos: [] as RepoDef[] };
    }
    if (isPom) {
      const r = validatePomText(text);
      applyMarkers(r.issues);
      return r;
    }
    const r = validateGradleText(text);
    applyMarkers(r.issues);
    return r;
  };

  const runRemote = async (
    myId: number,
    deps: Array<{ group: string; artifact: string; version: string; range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } }>,
    repos: RepoDef[],
  ) => {
    if (deps.length === 0) return;
    remoteCtl?.abort();
    remoteCtl = new AbortController();
    const signal = remoteCtl.signal;
    let results: Map<string, DepCheck>;
    try {
      results = await checkDeps(deps, { signal, repos });
    } catch {
      return;
    }
    if (disposed || myId !== runId || signal.aborted) return;
    if (results.size === 0) return; // offline: keep sync markers, no false errors
    let text = "";
    try {
      text = model.getValue();
    } catch {
      return;
    }
    const local = isPom ? validatePomText(text) : validateGradleText(text);
    if (myId !== runId) return;
    const remoteIssues = [];
    const where = repos.length > 0 ? t("build.whereDeclared") : t("build.whereCentral");
    for (const d of deps) {
      const r = results.get(depKeyOf(d.group, d.artifact, d.version));
      if (!r) continue;
      const label = `${d.group}:${d.artifact}:${d.version}`;
      if (r.onlyLocal) {
        remoteIssues.push({
          message: t("build.depLocalOnly", { label, where }),
          severity: 4 as const,
          source: owner,
          code: "dep-local-only",
          ...d.range,
        });
      } else if (!r.existsArtifact) {
        remoteIssues.push({
          message: t("build.depNotFound", { label, where }),
          severity: 8 as const,
          source: owner,
          code: "dep-not-found",
          ...d.range,
        });
      } else if (r.existsVersion === false) {
        remoteIssues.push({
          message: t("build.versionNotFound", { version: d.version, group: d.group, artifact: d.artifact, where }),
          severity: 8 as const,
          source: owner,
          code: "dep-version-not-found",
          ...d.range,
        });
      }
    }
    applyMarkers([...local.issues, ...remoteIssues]);
  };

  const scheduleAll = (syncDelay: number, remoteDelay: number) => {
    if (syncTimer) clearTimeout(syncTimer);
    if (remoteTimer) clearTimeout(remoteTimer);
    syncTimer = setTimeout(() => {
      if (disposed) return;
      const myId = ++runId;
      const { deps, repos } = runSync();
      if (remoteTimer) clearTimeout(remoteTimer);
      remoteTimer = setTimeout(() => {
        if (disposed) return;
        void runRemote(myId, deps, repos);
      }, remoteDelay);
    }, syncDelay);
  };

  // Initial: sync now, remote shortly after (lets the editor paint first).
  const initial = runSync();
  const initialId = ++runId;
  remoteTimer = setTimeout(() => {
    if (!disposed) void runRemote(initialId, initial.deps, initial.repos);
  }, 900);

  const sub = editor.onDidChangeModelContent(() => {
    scheduleAll(400, 900);
  });

  return () => {
    disposed = true;
    if (syncTimer) clearTimeout(syncTimer);
    if (remoteTimer) clearTimeout(remoteTimer);
    remoteCtl?.abort();
    try {
      sub?.dispose?.();
    } catch {
      // best-effort
    }
    try {
      monaco.editor.setModelMarkers(model, owner, []);
    } catch {
      // model gone
    }
    try {
      clearOwnerForFile(fsKeyOfModel(monaco, model), owner);
    } catch {
      // badges best-effort
    }
  };
}
