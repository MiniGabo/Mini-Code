// Core contracts.

export type FileKey = string;

export interface OpenFile {
  /** On-disk path. Absent in virtual / unsaved tabs. */
  path?: string;
  /** Stable id for pathless tabs (e.g. `decompiled:<token>`). */
  id?: string;
  name: string;
  content: string;
  savedContent: string;
  readOnly?: boolean;
  /** Monaco model URI (decompiled:// virtual tabs). */
  modelUri?: string | null;
  loading?: boolean;
  progress?: string | null;
  loadError?: string | null;
  origin?: string | null;
  originLabel?: string | null;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileTreeNode[];
}

export type LspStatus = "off" | "starting" | "indexing" | "ready" | "error";

export interface Toast {
  id: number;
  message: string;
  /** Visual style: errors are red, info is neutral. Defaults to "error". */
  kind?: "error" | "info";
}

export interface PendingClose {
  key: FileKey;
  name: string;
}

export type ExplorerUndoAction =
  | { type: "create"; path: string }
  | { type: "move"; src: string; dest: string };

export type ExternalMember =
  | { kind: "class"; name: string }
  | { kind: "method"; name: string; arity: number | null };

export interface ExternalQuery {
  candidates: string[];
  fieldHops: string[];
  member: ExternalMember | null;
  primaryKind?: string | null;
  ownFqn?: string | null;
  token?: string;
  contextDir?: string | null;
}

export interface PendingReveal {
  fs?: string;
  uri?: string;
  lineNumber: number;
  column: number;
  symbol?: string | null;
}
