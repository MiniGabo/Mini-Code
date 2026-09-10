// Acceso tipado al puente Electron (preload.cjs -> window.electronAPI).

export interface ElectronAPI {
  openFolder(): Promise<import("../types").FileTreeNode | null>;
  pickParentFolder(): Promise<string | null>;
  openFile(): Promise<{ path: string; content: string } | null>;
  saveFileAs(content: string, defaultName?: string): Promise<string | null>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<boolean>;
  readDirTree(dirPath: string): Promise<import("../types").FileTreeNode>;
  createFile(dirPath: string, fileName: string): Promise<string>;
  createFolder(dirPath: string, folderName: string): Promise<string>;
  moveEntry(srcPath: string, destPath: string): Promise<string>;
  deleteEntry(filePath: string): Promise<boolean>;
  trashEntry(filePath: string): Promise<boolean>;
  lspStart(rootPath: string): Promise<{ ok: boolean; error?: string; capabilities?: unknown }>;
  lspStop(): Promise<boolean>;
  lspRequest(method: string, params: unknown): Promise<unknown>;
  lspNotify(method: string, params: unknown): Promise<unknown>;
  resolveExternal(query: unknown): Promise<unknown>;
  onExternalProgress(cb: (v: { token: string; message: string }) => void): (() => void) | undefined;
  onDiagnostics(cb: (v: { uri: string; diagnostics: unknown[] }) => void): (() => void) | undefined;
  onLspStatus(cb: (v: { state: string; message?: string }) => void): (() => void) | undefined;
  minimizeWindow(): void;
  toggleMaximize(): void;
  closeWindow(): void;
  isMaximized(): Promise<boolean>;
  onMaximizeChange(cb: (v: boolean) => void): (() => void) | undefined;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export function getElectronAPI(): ElectronAPI | undefined {
  if (typeof window === "undefined") return undefined;
  return window.electronAPI;
}

/** Acceso que lanza si no hay puente (mejor que fallar en silencio). */
export function requireElectronAPI(): ElectronAPI {
  const api = getElectronAPI();
  if (!api) throw new Error("Sin puente Electron. Que raro");
  return api;
}
