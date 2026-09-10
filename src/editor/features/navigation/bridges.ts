// Puentes mutables entre App y la capa de navegación.
import type { PendingReveal } from "../../../types";

type OpenFileFn = (fsPath: string) => Promise<unknown>;

let openFileByPath: OpenFileFn | null = null;
export function setOpenFileByPath(fn: OpenFileFn): void {
  openFileByPath = fn;
}
export function getOpenFileByPath(): OpenFileFn | null {
  return openFileByPath;
}

interface DecompiledCtl {
  openPending: (entry: any) => any;
  fulfill: (id: any, res: any) => any;
}

let decompiledCtl: DecompiledCtl | null = null;
export function setDecompiledCtl(ctl: DecompiledCtl): void {
  decompiledCtl = ctl;
}
export function openDecompiledPending(entry: any): any {
  if (!decompiledCtl) return null;
  return decompiledCtl.openPending(entry);
}
export function fulfillDecompiled(id: any, res: any): any {
  if (!decompiledCtl) return { mounted: false, uri: null };
  return decompiledCtl.fulfill(id, res);
}

// Salto pendiente tras abrir pestaña por goto-definición
// { fs?, uri?, lineNumber, column, symbol }
let pendingReveal: PendingReveal | null = null;
export function setPendingReveal(reveal: PendingReveal | null): void {
  pendingReveal = reveal;
}
export function getPendingReveal(): PendingReveal | null {
  return pendingReveal;
}
