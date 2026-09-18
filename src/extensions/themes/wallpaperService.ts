// Background asset service: loads a theme's background image through the
// extensions bridge, cached per theme+file with per-key in-flight dedupe.
// Rendering stays in components/Wallpaper (pure presentation); this module
// only fetches and caches data URLs. Failures resolve to null so the UI
// simply renders no background.
const assetCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

/** Loads a background asset. Null when missing/failed (no background). */
export function loadBackgroundAsset(dir: string, file: string): Promise<string | null> {
  const key = `${dir}::${file}`;
  const cached = assetCache.get(key);
  if (cached) return Promise.resolve(cached);
  const existing = inflight.get(key);
  if (existing) return existing;
  const job = (async (): Promise<string | null> => {
    try {
      const bridge = window.electronAPI;
      if (!bridge?.extensionsReadAsset) return null;
      const res = await bridge.extensionsReadAsset(dir, file);
      if (!res.ok || !res.dataUrl) {
        console.warn(`[extensions] fondo "${file}": ${res?.error ?? "sin data"}`);
        return null;
      }
      assetCache.set(key, res.dataUrl);
      console.info(`[extensions] fondo "${file}" cargado`);
      return res.dataUrl;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

/** Test hook: drops all cached background URLs. */
export function resetBackgroundCacheForTests(): void {
  assetCache.clear();
  inflight.clear();
}
