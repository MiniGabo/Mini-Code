// Estado del IntelliSense: status + errores por archivo (badges).
import { create } from "zustand";
import type { LspStatus } from "../types";
import { subscribeFileErrors } from "../lsp.js";

interface LspState {
  lspStatus: LspStatus;
  fileErrors: Record<string, number>;
  setLspStatus: (s: LspStatus) => void;
  clearErrors: () => void;
}

export const useLspStore = create<LspState>((set) => ({
  lspStatus: "off",
  fileErrors: {},
  setLspStatus: (s) => set({ lspStatus: s }),
  clearErrors: () => set({ fileErrors: {} }),
}));

// Suscripción única módulo <-> motor de diagnósticos: los badges se
// actualizan sin pasar por App. (Guard anti-doble-suscripción por HMR.)
let subscribed = false;
export function ensureFileErrorSubscription(): void {
  if (subscribed) return;
  subscribed = true;
  subscribeFileErrors((snapshot: Record<string, number>) => {
    useLspStore.setState({ fileErrors: snapshot });
  });
}
