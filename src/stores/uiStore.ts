// Estado de UI global: sidebar, toasts, modales.
import { create } from "zustand";
import type { Toast, PendingClose } from "../types";

const SIDEBAR_WIDTH_KEY = "mini-code:sidebar-width";
export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 520;
export const SIDEBAR_DEFAULT = 256;

function loadSidebarWidth(): number {
  try {
    const v = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) ?? "", 10);
    if (Number.isFinite(v)) return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, v));
  } catch {
    // sin localStorage: ancho por defecto
  }
  return SIDEBAR_DEFAULT;
}

function persistWidth(width: number): void {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    // sin localStorage: el ancho solo vive en la sesión
  }
}

interface UiState {
  sidebarVisible: boolean;
  sidebarWidth: number;
  toasts: Toast[];
  pendingClose: PendingClose | null;
  pendingParent: string | null;
  newFolderName: string;
  toggleSidebar: () => void;
  setSidebarVisible: (v: boolean) => void;
  setSidebarWidth: (w: number) => void;
  resetSidebarWidth: () => void;
  notifyError: (message: string) => void;
  dismissToast: (id: number) => void;
  setPendingClose: (p: PendingClose | null) => void;
  setPendingParent: (p: string | null) => void;
  setNewFolderName: (n: string) => void;
  resetForRestart: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarVisible: true,
  sidebarWidth: loadSidebarWidth(),
  toasts: [],
  pendingClose: null,
  pendingParent: null,
  newFolderName: "",

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  setSidebarVisible: (v) => set({ sidebarVisible: v }),

  setSidebarWidth: (w) => {
    const width = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w));
    persistWidth(width);
    set({ sidebarWidth: width });
  },

  resetSidebarWidth: () => {
    persistWidth(SIDEBAR_DEFAULT);
    set({ sidebarWidth: SIDEBAR_DEFAULT });
  },

  notifyError: (message) => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4500);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setPendingClose: (p) => set({ pendingClose: p }),
  setPendingParent: (p) => set({ pendingParent: p }),
  setNewFolderName: (n) => set({ newFolderName: n }),

  resetForRestart: () =>
    set({ pendingClose: null, pendingParent: null, newFolderName: "", sidebarVisible: true }),
}));
