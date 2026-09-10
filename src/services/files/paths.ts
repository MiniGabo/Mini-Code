// Path utilities.
import type { OpenFile, FileKey } from "../../types";

export function fileKeyOf(file: OpenFile): FileKey {
  return file.path ?? file.id ?? file.name;
}

export function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

export function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i > 0 ? p.slice(0, i) : p;
}

/** true if p === dir or lives inside dir (both separators). */
export function isInside(p: string, dir: string): boolean {
  return p === dir || p.startsWith(dir + "\\") || p.startsWith(dir + "/");
}

/** Remaps a path after moving/renaming srcPath -> destPath. */
export function remapPath(p: string, srcPath: string, destPath: string): string {
  if (p === srcPath || p.startsWith(srcPath + "\\") || p.startsWith(srcPath + "/")) {
    return destPath + p.slice(srcPath.length);
  }
  return p;
}

/** Canonical file:// URI for a disk path (what Monaco/LSP expects). */
export function fileUriOf(diskPath: string): string {
  return "file:///" + encodeURI(diskPath.replace(/\\/g, "/").replace(/^\//, ""));
}

/** Containing directory of a file:// or disk path. */
export function contextDirOfFsPath(fsPath: string | null | undefined): string | null {
  if (!fsPath) return null;
  const idx = Math.max(fsPath.lastIndexOf("/"), fsPath.lastIndexOf("\\"));
  return idx > 0 ? fsPath.slice(0, idx) : null;
}

/** Normalizes for case-insensitive comparison (badges, reveals). */
export function normFs(p: string | null | undefined): string {
  return (p ?? "").toLowerCase();
}
