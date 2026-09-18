// Theme icon service: SVG file/folder icons contributed by the active
// theme, matched statically (exact filename, then extension).
// SVGs load async via the extensions bridge and are cached as data URLs
// per theme; rendering through <img> means embedded scripts can never
// execute, and a light sanitize strips <script>/event handlers anyway.
// No match (or no theme icons) falls back to the built-in lucide icons
// in FileIcon. Failures resolve silently: icons just stay built-in.
import {
  getTheme,
  notifyRegistryChanged,
  resolveThemeId,
  type ThemeIconSet,
} from "./themeService";

const urlCache = new Map<string, Map<string, string>>();
const inflight = new Map<string, Promise<void>>();

function base64ToText(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Light SVG hygiene (defense in depth; <img> already blocks execution). */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|xlink:href)\s*=\s*("|\')\s*javascript:[^"']*("|\')/gi, '$1=$2#$3');
}

function matchKey(map: Record<string, string>, lower: string): string | null {
  // Exact filename first ("Dockerfile"), then dotted extension (".java").
  if (typeof map[lower] === "string") return map[lower];
  const dot = lower.lastIndexOf(".");
  if (dot > 0) {
    const ext = lower.slice(dot);
    if (typeof map[ext] === "string") return map[ext];
  }
  return null;
}

function cachedUrl(themeId: string, rel: string): string | null {
  return urlCache.get(themeId)?.get(rel) ?? null;
}

/** Sync lookup for files (TabBar, explorer rows). Null = built-in fallback. */
export function getFileIconUrl(themeId: string, name: string): string | null {
  const spec = getTheme(resolveThemeId(themeId));
  const icons: ThemeIconSet | undefined = spec?.icons;
  if (!icons || !spec) return null;
  const lower = (name ?? "").toLowerCase();
  const rel = matchKey(icons.files, lower) ?? icons.defaultFile ?? null;
  if (!rel) return null;
  return cachedUrl(spec.id, rel);
}

/** Sync lookup for folders (explorer rows). Null = built-in fallback. */
export function getFolderIconUrl(themeId: string, name: string): string | null {
  const spec = getTheme(resolveThemeId(themeId));
  const icons: ThemeIconSet | undefined = spec?.icons;
  if (!icons || !spec) return null;
  const lower = (name ?? "").toLowerCase();
  const rel = (typeof icons.folders[lower] === "string" ? icons.folders[lower] : null) ?? icons.defaultFolder ?? null;
  if (!rel) return null;
  return cachedUrl(spec.id, rel);
}

/**
 * Loads every SVG of the active theme into the cache (dedupes concurrent
 * calls per theme, so fast theme switches can't mix icon sets). Notifies
 * the registry when done so icon consumers re-render. Missing bridge /
 * failures resolve silently: icons just stay built-in.
 */
export function ensureThemeIcons(themeId: string): Promise<void> {
  const resolvedId = resolveThemeId(themeId);
  const existing = inflight.get(resolvedId);
  if (existing) return existing;
  const job = (async () => {
    try {
      const spec = getTheme(resolvedId);
      if (!spec) {
        console.warn(`[extensions] iconos: tema "${themeId}" no registrado`);
        return;
      }
      if (!spec.dir) return; // built-in: sin carpeta, sin iconos
      const icons: ThemeIconSet | undefined = spec.icons;
      if (!icons) return; // el tema no contribuye iconos: built-ins
      let cache = urlCache.get(spec.id);
      if (!cache) {
        cache = new Map<string, string>();
        urlCache.set(spec.id, cache);
      }
      const rels = new Set<string>([
        ...Object.values(icons.files),
        ...Object.values(icons.folders),
        ...(icons.defaultFile ? [icons.defaultFile] : []),
        ...(icons.defaultFolder ? [icons.defaultFolder] : []),
      ]);
      const bridge = window.electronAPI;
      if (!bridge) {
        console.warn(`[extensions] iconos de "${spec.id}": sin puente Electron`);
        return;
      }
      let changed = false;
      let failed = 0;
      for (const rel of rels) {
        if (cache.has(rel)) continue;
        try {
          const res = await bridge.extensionsReadAsset(spec.dir, rel);
          if (!res.ok || !res.dataUrl) {
            failed++;
            console.warn(`[extensions] icono "${rel}" (${spec.id}): ${res.error ?? "sin data"}`);
            continue;
          }
          const svgText = base64ToText(res.dataUrl.split(",")[1] ?? "");
          const clean = sanitizeSvg(svgText);
          cache.set(rel, `data:image/svg+xml;base64,${textToBase64(clean)}`);
          changed = true;
        } catch (err) {
          failed++;
          console.warn(`[extensions] icono "${rel}" (${spec.id}): ${String((err as Error)?.message ?? err)}`);
        }
      }
      console.info(`[extensions] iconos de "${spec.id}": ${rels.size - failed}/${rels.size} cargados`);
      if (changed) notifyRegistryChanged();
    } finally {
      inflight.delete(resolvedId);
    }
  })();
  inflight.set(resolvedId, job);
  return job;
}

/** Test hook: drops all cached icon URLs. */
export function resetIconCacheForTests(): void {
  urlCache.clear();
  inflight.clear();
}
