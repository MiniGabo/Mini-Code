// IntelliSense state: status + per-file errors (badges).
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

// Single module <-> diagnostics engine subscription: badges
// update without going through App. (Anti-double-subscription guard for HMR.)
let subscribed = false;
export function ensureFileErrorSubscription(): void {
  if (subscribed) return;
  subscribed = true;
  subscribeFileErrors((snapshot: Record<string, number>) => {
    useLspStore.setState({ fileErrors: snapshot });
  });
}
