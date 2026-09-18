// Extension host: discovers, validates and registers theme extensions.
//
// Local folders with extension.json (see manifest.ts), found through the
// main-process bridge. Every failure is a *diagnostic*, never a throw:
//   - a bad manifest skips the extension,
//   - a bad theme file skips that theme (siblings still load),
//   - entry-level problems inside a theme file become warnings and the
//     theme loads without those entries (see themes/schema).
//
// Diagnostics are kept in memory for Settings ("Extensiones" section) and
// the registry version is bumped so the UI refreshes when late extensions
// arrive. No third-party code ever runs: themes are pure data.
import {
  notifyRegistryChanged,
  registerTheme,
  specFromValidatedFile,
  unregisterTheme,
  getTheme,
} from "./themes/themeService";
import { validateThemeFile } from "./themes/schema";
import { validateManifest, type ExtensionManifest } from "./manifest";

export interface LoadedExtension {
  id: string;
  name: string;
  version: string;
  themes: string[];
  unload: () => void;
}

export interface ExtensionDiagnostic {
  /** Extension id when known, otherwise the folder path. */
  source: string;
  level: "error" | "warning";
  message: string;
}

export interface DiscoverResult {
  loaded: LoadedExtension[];
  diagnostics: ExtensionDiagnostic[];
}

let lastDiagnostics: ExtensionDiagnostic[] = [];
let loadedExtensions: LoadedExtension[] = [];
let extensionsRoot: string | null = null;

export function getExtensionDiagnostics(): ExtensionDiagnostic[] {
  return lastDiagnostics;
}

/** Currently loaded (active) extensions. */
export function getLoadedExtensions(): LoadedExtension[] {
  return [...loadedExtensions];
}

/** Filesystem root the extensions were scanned from (null before first scan). */
export function getExtensionsRoot(): string | null {
  return extensionsRoot;
}

function unloadAll(): void {
  for (const ext of loadedExtensions.splice(0)) {
    try {
      ext.unload();
    } catch {
      // best-effort
    }
  }
}

async function loadOne(
  dir: string,
  rawManifest: unknown,
  diagnostics: ExtensionDiagnostic[],
): Promise<LoadedExtension | null> {
  const validated = validateManifest(rawManifest);
  if (!validated.ok) {
    diagnostics.push({
      source: dir,
      level: "error",
      message: `manifest inválido: ${validated.errors.join("; ")}`,
    });
    return null;
  }
  const manifest: ExtensionManifest = validated.manifest;
  const bridge = window.electronAPI;
  const cleanups: Array<() => void> = [];
  const themes: string[] = [];
  const pushDiag = (level: "error" | "warning", message: string): void => {
    diagnostics.push({ source: manifest.id, level, message });
  };

  for (const th of manifest.contributes.themes) {
    if (getTheme(th.id)) {
      pushDiag("error", `tema "${th.id}" duplicado (ya registrado), se omite`);
      continue;
    }
    if (!bridge) {
      pushDiag("error", `sin puente Electron, no se pudo leer ${th.path}`);
      continue;
    }
    let file: unknown;
    try {
      const res = await bridge.extensionsReadJson(dir, th.path);
      if (!res.ok) {
        pushDiag("error", `${th.path}: ${res.error}`);
        continue;
      }
      file = res.json;
    } catch (err) {
      pushDiag("error", `${th.path}: ${String((err as Error)?.message ?? err)}`);
      continue;
    }
    const checked = validateThemeFile(file);
    if (!checked.ok) {
      pushDiag("error", `${th.path}: ${checked.errors.join("; ")}`);
      for (const w of checked.warnings) pushDiag("warning", `${th.path}: ${w}`);
      continue;
    }
    for (const w of checked.warnings) pushDiag("warning", `${th.path}: ${w}`);
    cleanups.push(
      registerTheme(
        specFromValidatedFile({
          id: th.id,
          label: th.label,
          source: manifest.id,
          dir,
          // The manifest's uiTheme is the default base; the file's own
          // base/uiTheme wins when present.
          defaultBase: th.uiTheme,
          file: checked.theme,
        }),
      ),
    );
    themes.push(th.id);
  }

  if (themes.length === 0) {
    pushDiag("error", "sin temas válidos, la extensión no se carga");
    return null;
  }
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    themes,
    unload: () => {
      for (const off of cleanups.splice(0).reverse()) {
        try {
          off();
        } catch {
          // best-effort
        }
      }
      for (const th of themes) unregisterTheme(th);
    },
  };
}

/** Scans, validates and registers every extension folder. Call once at startup. */
export async function discoverExtensions(): Promise<DiscoverResult> {
  const loaded: LoadedExtension[] = [];
  const diagnostics: ExtensionDiagnostic[] = [];
  const bridge = window.electronAPI;
  if (!bridge) {
    diagnostics.push({ source: "extensions", level: "error", message: "sin puente Electron" });
    lastDiagnostics = diagnostics;
    return { loaded, diagnostics };
  }
  let scan;
  try {
    scan = await bridge.extensionsScan();
  } catch (err) {
    diagnostics.push({
      source: "extensions",
      level: "error",
      message: `scan falló: ${String((err as Error)?.message ?? err)}`,
    });
    lastDiagnostics = diagnostics;
    return { loaded, diagnostics };
  }
  if (!scan.ok) {
    diagnostics.push({ source: "extensions", level: "error", message: `scan falló: ${scan.error}` });
    lastDiagnostics = diagnostics;
    return { loaded, diagnostics };
  }
  const seen = new Set<string>();
  for (const entry of scan.entries ?? []) {
    if (entry.error || entry.manifest === undefined) {
      diagnostics.push({ source: entry.dir, level: "error", message: entry.error ?? "sin extension.json" });
      continue;
    }
    const ext = await loadOne(entry.dir, entry.manifest, diagnostics);
    if (!ext) continue;
    if (seen.has(ext.id)) {
      diagnostics.push({ source: entry.dir, level: "error", message: `id duplicado "${ext.id}", se omite` });
      ext.unload();
      continue;
    }
    seen.add(ext.id);
    loaded.push(ext);
  }
  if (loaded.length > 0) {
    console.info(`[extensions] cargadas: ${loaded.map((e) => `${e.id}@${e.version}`).join(", ")}`);
  }
  for (const d of diagnostics) {
    if (d.level === "error") console.warn(`[extensions] ${d.source}: ${d.message}`);
  }
  loadedExtensions = loaded;
  extensionsRoot = scan.root ?? null;
  lastDiagnostics = diagnostics;
  notifyRegistryChanged();
  return { loaded, diagnostics };
}

/**
 * Unloads everything and scans again (used after install/uninstall).
 * A theme that disappears while active falls back to the built-in theme
 * automatically (themeService.resolveThemeId).
 */
export async function reloadExtensions(): Promise<DiscoverResult> {
  unloadAll();
  notifyRegistryChanged();
  return discoverExtensions();
}

/** Installs a theme pack (native folder picker in main) and reloads. */
export async function installExtension(): Promise<{ ok: boolean; id?: string; cancelled?: boolean; error?: string }> {
  const bridge = window.electronAPI;
  if (!bridge?.extensionsInstall) return { ok: false, error: "sin puente Electron" };
  let res;
  try {
    res = await bridge.extensionsInstall();
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
  if (!res.ok) return res;
  await reloadExtensions();
  return res;
}

/** Uninstalls a theme pack by id and reloads. Built-ins cannot be removed. */
export async function uninstallExtension(id: string): Promise<{ ok: boolean; error?: string }> {
  const bridge = window.electronAPI;
  if (!bridge?.extensionsUninstall) return { ok: false, error: "sin puente Electron" };
  try {
    const res = await bridge.extensionsUninstall(id);
    if (!res.ok) return res;
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
  await reloadExtensions();
  return { ok: true };
}

/** Reveals the extensions folder in the OS file explorer. */
export async function openExtensionsFolder(): Promise<{ ok: boolean; error?: string }> {
  const bridge = window.electronAPI;
  if (!bridge?.extensionsOpenFolder) return { ok: false, error: "sin puente Electron" };
  try {
    return await bridge.extensionsOpenFolder();
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}
