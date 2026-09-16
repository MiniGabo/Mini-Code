// Auto-updater state (latest.yml from GitHub Releases).
// The main process notifies via "updater:status" (automatic check on startup);
// manual checks and downloads are triggered from the banner or Settings.
import { create } from "zustand";
import type { UpdateCheckResult, UpdateProgress } from "../platform/electronAPI";

interface UpdaterState {
  status: UpdateCheckResult | null;
  checking: boolean;
  downloading: boolean;
  progress: UpdateProgress | null;
  dismissedVersion: string | null;
  subscribed: boolean;
  ensureSubscription: () => void;
  check: (manual?: boolean) => Promise<void>;
  download: () => Promise<void>;
  dismiss: () => void;
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: null,
  checking: false,
  downloading: false,
  progress: null,
  dismissedVersion: null,
  subscribed: false,

  ensureSubscription: () => {
    if (get().subscribed) return;
    const api = window.electronAPI;
    if (!api?.onUpdaterStatus) return;
    set({ subscribed: true });
    api.onUpdaterStatus?.((s) => {
      set({ status: s, checking: false });
      // A new version is available -> reset any previous download state.
      if (s.updateAvailable) set({ progress: null });
    });
    api.onUpdaterProgress?.((p) => {
      if (p.status === "started") set({ downloading: true, progress: p });
      else if (p.status === "downloading") set({ downloading: true, progress: p });
      else set({ downloading: false, progress: p });
    });
    // Silent initial check (main already schedules its own; this covers
    // the web/dev case and surfaces the notice earlier when a bridge exists).
    void get().check(false);
  },

  check: async (manual = false) => {
    const api = window.electronAPI;
    if (!api?.checkForUpdates) return;
    set({ checking: true });
    try {
      const res = await api.checkForUpdates(manual);
      set({ status: res, checking: false });
      if (res.updateAvailable) set({ progress: null });
    } catch (err) {
      set({
        checking: false,
        status: {
          ok: false,
          updateAvailable: false,
          error: String((err as Error)?.message ?? err),
        },
      });
    }
  },

  download: async () => {
    const api = window.electronAPI;
    if (!api?.downloadUpdate || get().downloading) return;
    set({ downloading: true, progress: { status: "started" } });
    try {
      const res = await api.downloadUpdate();
      if (!res.ok) set({ downloading: false, progress: { status: "error", error: res.error } });
      // On success, the "downloaded" event arrives via onUpdaterProgress.
    } catch (err) {
      set({
        downloading: false,
        progress: { status: "error", error: String((err as Error)?.message ?? err) },
      });
    }
  },

  dismiss: () => {
    const latest = get().status?.latestVersion ?? null;
    set({ dismissedVersion: latest });
  },
}));

/** Is there a pending update the user has not dismissed? */
export function shouldShowUpdateBanner(s: UpdaterState): boolean {
  if (!s.status?.updateAvailable || !s.status?.latestVersion) return false;
  return s.dismissedVersion !== s.status.latestVersion;
}
