// Utilidades de rutas.
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

/** true si p === dir o vive dentro de dir (ambos separadores). */
export function isInside(p: string, dir: string): boolean {
  return p === dir || p.startsWith(dir + "\\") || p.startsWith(dir + "/");
}

/** Remapea una ruta tras mover/renombrar srcPath -> destPath. */
export function remapPath(p: string, srcPath: string, destPath: string): string {
  if (p === srcPath || p.startsWith(srcPath + "\\") || p.startsWith(srcPath + "/")) {
    return destPath + p.slice(srcPath.length);
  }
  return p;
}

/** file:// URI canónico para un path de disco (lo que espera Monaco/LSP). */
export function fileUriOf(diskPath: string): string {
  return "file:///" + encodeURI(diskPath.replace(/\\/g, "/").replace(/^\//, ""));
}

/** Directorio contenedor de un file:// o path de disco. */
export function contextDirOfFsPath(fsPath: string | null | undefined): string | null {
  if (!fsPath) return null;
  const idx = Math.max(fsPath.lastIndexOf("/"), fsPath.lastIndexOf("\\"));
  return idx > 0 ? fsPath.slice(0, idx) : null;
}

/** Normaliza para comparar sin distinguir mayúsculas (badges, reveals). */
export function normFs(p: string | null | undefined): string {
  return (p ?? "").toLowerCase();
}
