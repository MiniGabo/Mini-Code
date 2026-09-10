// Editor state: tabs, live text, view-states, and recents.
import { create } from "zustand";
import type { OpenFile, FileKey } from "../types";
import { fileKeyOf } from "../services/files/paths";

const RECENT_KEY = "mini-code:recent-files";

function loadRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") || [];
  } catch {
    return [];
  }
}

interface EditorState {
  openFiles: OpenFile[];
  activeKey: FileKey | null;
  recentFiles: string[];
  /** Live text by key (source of truth while typing; does not trigger render). */
  liveContents: Map<FileKey, string>;
  /** Monaco view-states by key (scroll/cursor across tabs). */
  viewStates: Map<FileKey, unknown>;

  openOrActivate: (file: OpenFile) => void;
  setActive: (key: FileKey | null) => void;
  patchFile: (key: FileKey, patch: Partial<OpenFile>) => void;
  patchAll: (fn: (files: OpenFile[]) => OpenFile[]) => void;
  closeFile: (key: FileKey) => void;
  closeAll: () => void;
  setLiveContent: (key: FileKey, value: string) => void;
  dropLiveContent: (key: FileKey) => void;
  clearLiveContents: () => void;
  getLiveContent: (file: OpenFile) => string;
  saveViewState: (key: FileKey, state: unknown) => void;
  clearViewStates: () => void;
  pushRecent: (filePath: string) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  openFiles: [],
  activeKey: null,
  recentFiles: loadRecents(),
  liveContents: new Map(),
  viewStates: new Map(),

  openOrActivate: (file) =>
    set((s) => {
      const key = fileKeyOf(file);
      if (file.content !== undefined) s.liveContents.set(key, file.content);
      const exists = s.openFiles.some((f) => fileKeyOf(f) === key);
      return {
        openFiles: exists
          ? s.openFiles.map((f) => (fileKeyOf(f) === key ? { ...f, ...file } : f))
          : [...s.openFiles, file],
        activeKey: key,
      };
    }),

  setActive: (key) => set({ activeKey: key }),

  patchFile: (key, patch) =>
    set((s) => ({
      openFiles: s.openFiles.map((f) => (fileKeyOf(f) === key ? { ...f, ...patch } : f)),
    })),

  patchAll: (fn) => set((s) => ({ openFiles: fn(s.openFiles) })),

  closeFile: (key) =>
    set((s) => {
      const idx = s.openFiles.findIndex((f) => fileKeyOf(f) === key);
      if (idx === -1) return s;
      const next = s.openFiles.filter((f) => fileKeyOf(f) !== key);
      let activeKey = s.activeKey;
      if (key === s.activeKey) {
        const fallback = next[idx] ?? next[idx - 1] ?? null;
        activeKey = fallback ? fileKeyOf(fallback) : null;
      }
      return { openFiles: next, activeKey };
    }),

  closeAll: () => set({ openFiles: [], activeKey: null }),

  setLiveContent: (key, value) => {
    get().liveContents.set(key, value);
  },

  dropLiveContent: (key) => {
    get().liveContents.delete(key);
  },

  clearLiveContents: () => {
    get().liveContents.clear();
  },

  getLiveContent: (file) => {
    const v = get().liveContents.get(fileKeyOf(file));
    return v !== undefined ? v : (file.content ?? "");
  },

  saveViewState: (key, state) => {
    if (state) get().viewStates.set(key, state);
  },

  clearViewStates: () => {
    get().viewStates.clear();
  },

  pushRecent: (filePath) =>
    set((s) => {
      const updated = [filePath, ...s.recentFiles.filter((p) => p !== filePath)].slice(0, 8);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
      } catch {
        // no localStorage: session only
      }
      return { recentFiles: updated };
    }),
}));

// Live-text -> React state sync throttle (500ms).
let flushTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleLiveFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushLiveToState();
  }, 500);
}

export function flushLiveToState(): void {
  const { openFiles, liveContents } = useEditorStore.getState();
  let changed = false;
  const next = openFiles.map((f) => {
    const v = liveContents.get(fileKeyOf(f));
    if (v !== undefined && v !== f.content) {
      changed = true;
      return { ...f, content: v };
    }
    return f;
  });
  if (changed) useEditorStore.setState({ openFiles: next });
}

export function cancelLiveFlush(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}
