// Typed access to the Electron bridge (preload.cjs -> window.electronAPI).
import { t } from "../stores/settingsStore";

export interface TerminalOpenOptions {
  cwd?: string | null;
  cols?: number;
  rows?: number;
}

export interface TerminalOpenResult {
  ok: boolean;
  id?: number;
  /** True when attaching to the already-running shell (no new process). */
  reused?: boolean;
  error?: string;
}

export interface ExtensionsScanResult {
  ok: boolean;
  root?: string;
  entries?: Array<{ dir: string; manifest?: unknown; error?: string }>;
  error?: string;
}

export interface ExtensionsReadResult {
  ok: boolean;
  json?: unknown;
  error?: string;
}

export interface ExtensionsAssetResult {
  ok: boolean;
  mime?: string;
  dataUrl?: string;
  error?: string;
}

export interface ExtensionsInstallResult {
  ok: boolean;
  id?: string;
  cancelled?: boolean;
  error?: string;
}

export interface ExtensionsUninstallResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export interface ExtensionsOpenFolderResult {
  ok: boolean;
  root?: string;
  error?: string;
}

export interface ElectronAPI {
  openFolder(): Promise<import("../types").FileTreeNode | null>;
  pickParentFolder(): Promise<string | null>;
  pickJdk(): Promise<string | null>;
  validateJdk(home: string): Promise<{ ok: boolean; error?: string }>;
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
  lspStart(rootPath: string): Promise<{ ok: boolean; error?: string; capabilities?: unknown; jdkWarning?: string | null }>;
  lspStop(): Promise<boolean>;
  getSettings(): Promise<Record<string, unknown>>;
  setSetting(key: string, value: unknown): Promise<unknown>;
  lspRequest(method: string, params: unknown): Promise<unknown>;
  lspNotify(method: string, params: unknown): Promise<unknown>;
  resolveExternal(query: unknown): Promise<unknown>;
  checkMavenDeps(deps: Array<{ group: string; artifact: string; version: string }>, repos?: Array<{ id?: string; url: string }>): Promise<{ ok: boolean; results?: Record<string, { existsArtifact: boolean; existsVersion: boolean | null; onlyLocal?: boolean }>; error?: string }>;
  onExternalProgress(cb: (v: { token: string; message: string }) => void): (() => void) | undefined;
  onDiagnostics(cb: (v: { uri: string; diagnostics: unknown[] }) => void): (() => void) | undefined;
  onLspStatus(cb: (v: { state: string; message?: string }) => void): (() => void) | undefined;
  minimizeWindow(): void;
  terminalOpen(opts?: TerminalOpenOptions): Promise<TerminalOpenResult>;
  terminalWrite(id: number, data: string): Promise<{ ok: boolean }>;
  terminalResize(id: number, cols: number, rows: number): Promise<{ ok: boolean }>;
  terminalPause(id: number): Promise<{ ok: boolean }>;
  terminalCloseAll(): Promise<{ ok: boolean; killed?: boolean }>;
  onTerminalData(cb: (v: { id: number; data: string }) => void): (() => void) | undefined;
  onTerminalExit(cb: (v: { id: number; exitCode: number }) => void): (() => void) | undefined;
  extensionsScan(): Promise<ExtensionsScanResult>;
  extensionsReadJson(dir: string, rel: string): Promise<ExtensionsReadResult>;
  extensionsReadAsset(dir: string, rel: string): Promise<ExtensionsAssetResult>;
  extensionsInstall(): Promise<ExtensionsInstallResult>;
  extensionsUninstall(id: string): Promise<ExtensionsUninstallResult>;
  extensionsOpenFolder(): Promise<ExtensionsOpenFolderResult>;
  toggleMaximize(): void;
  closeWindow(): void;
  isMaximized(): Promise<boolean>;
  onMaximizeChange(cb: (v: boolean) => void): (() => void) | undefined;
  getAppVersion(): Promise<{ ok: boolean; version?: string; error?: string }>;
  checkForUpdates(manual?: boolean): Promise<UpdateCheckResult>;
  downloadUpdate(): Promise<{ ok: boolean; path?: string; error?: string }>;
  cancelUpdateDownload(): Promise<{ ok: boolean; error?: string }>;
  openReleasePage(): Promise<{ ok: boolean; error?: string }>;
  quitAndInstall(): Promise<{ ok: boolean; error?: string }>;
  onUpdaterStatus(cb: (v: UpdateCheckResult) => void): (() => void) | undefined;
  onUpdaterProgress(cb: (v: UpdateProgress) => void): (() => void) | undefined;
}

export interface UpdateCheckResult {
  ok: boolean;
  currentVersion?: string;
  latestVersion?: string | null;
  updateAvailable?: boolean;
  fileName?: string;
  size?: number | null;
  downloadUrl?: string;
  releasePage?: string;
  checkedAt?: number;
  error?: string;
}

export interface UpdateProgress {
  status: "started" | "downloading" | "downloaded" | "error";
  received?: number;
  total?: number | null;
  percent?: number | null;
  path?: string;
  error?: string;
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

/** Accessor that throws if there is no bridge (better than failing silently). */
export function requireElectronAPI(): ElectronAPI {
  const api = getElectronAPI();
  if (!api) throw new Error(t("app.noBridge"));
  return api;
}
