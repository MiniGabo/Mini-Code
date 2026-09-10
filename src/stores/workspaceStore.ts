// Estado del workspace/explorador.
import { create } from "zustand";
import type { FileTreeNode, ExplorerUndoAction } from "../types";

interface WorkspaceState {
  folderTree: FileTreeNode | null;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  undoStack: ExplorerUndoAction[];
  setFolderTree: (tree: FileTreeNode | null) => void;
  setExpanded: (paths: Set<string>) => void;
  toggleFolder: (path: string) => void;
  expandFolder: (path: string) => void;
  selectFolder: (path: string | null) => void;
  pushUndo: (action: ExplorerUndoAction) => void;
  popUndo: () => ExplorerUndoAction | undefined;
  clearUndo: () => void;
  resetWorkspace: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  folderTree: null,
  expandedPaths: new Set<string>(),
  selectedPath: null,
  undoStack: [],

  setFolderTree: (tree) => set({ folderTree: tree }),

  setExpanded: (paths) => set({ expandedPaths: paths }),

  toggleFolder: (path) =>
    set((s) => {
      const next = new Set(s.expandedPaths);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { expandedPaths: next };
    }),

  expandFolder: (path) =>
    set((s) => {
      if (s.expandedPaths.has(path)) return s;
      const next = new Set(s.expandedPaths);
      next.add(path);
      return { expandedPaths: next };
    }),

  selectFolder: (path) => set({ selectedPath: path }),

  pushUndo: (action) =>
    set((s) => ({ undoStack: [...s.undoStack.slice(-49), action] })),

  popUndo: () => {
    let top: ExplorerUndoAction | undefined;
    set((s) => {
      top = s.undoStack[s.undoStack.length - 1];
      return { undoStack: s.undoStack.slice(0, -1) };
    });
    return top;
  },

  clearUndo: () => set({ undoStack: [] }),

  resetWorkspace: () =>
    set({ folderTree: null, expandedPaths: new Set(), selectedPath: null, undoStack: [] }),
}));
