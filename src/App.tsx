// App shell: composes stores + services. Domain logic lives in
// stores/* and services/*; orchestration only here (effects, shortcuts, layout).
import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import WelcomeScreen from "./components/WelcomeScreen";
import Sidebar from "./components/Sidebar";
import EditorPane from "./components/EditorPane";
import TabBar from "./components/TabBar";
import TitleBar from "./components/TitleBar";
import DecompilingView from "./components/DecompilingView";
import { PanelLeft, AlertTriangle, X } from "lucide-react";
import {
  setOpenFileByPath,
  clearFileErrors,
  setDecompiledCtl,
  setPendingReveal,
  disposeModelForKey,
  disposeAllModels,
} from "./lsp.js";
import { fileKeyOf, baseName, isInside, normFs } from "./services/files/paths";
import { langForFileName, sanitizeFileName } from "./services/files/fileTypes";
import { useWorkspaceStore } from "./stores/workspaceStore";
import {
  useEditorStore,
  scheduleLiveFlush,
  cancelLiveFlush,
} from "./stores/editorStore";
import { useUiStore, SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_DEFAULT } from "./stores/uiStore";
import { useLspStore, ensureFileErrorSubscription } from "./stores/lspStore";
import { registerCommand, handleShortcutEvent } from "./extensions/commandRegistry";
import type { OpenFile, FileKey } from "./types";

const isMac =
  typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

export default function App() {
  const folderTree = useWorkspaceStore((s) => s.folderTree);
  const expandedPaths = useWorkspaceStore((s) => s.expandedPaths);
  const selectedPath = useWorkspaceStore((s) => s.selectedPath);
  const openFiles = useEditorStore((s) => s.openFiles);
  const activeKey = useEditorStore((s) => s.activeKey);
  const recentFiles = useEditorStore((s) => s.recentFiles);
  const sidebarVisible = useUiStore((s) => s.sidebarVisible);
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const toasts = useUiStore((s) => s.toasts);
  const pendingClose = useUiStore((s) => s.pendingClose);
  const pendingParent = useUiStore((s) => s.pendingParent);
  const newFolderName = useUiStore((s) => s.newFolderName);
  const lspStatus = useLspStore((s) => s.lspStatus);
  const fileErrors = useLspStore((s) => s.fileErrors);

  const lspReadyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  const activeFile = openFiles.find((f) => fileKeyOf(f) === activeKey) ?? null;

  const clearLspTimer = useCallback(() => {
    if (lspReadyTimer.current) {
      clearTimeout(lspReadyTimer.current);
      lspReadyTimer.current = null;
    }
  }, []);

  const dismissToast = useUiStore((s) => s.dismissToast);
  const notifyError = useUiStore((s) => s.notifyError);

  const loadFileByPath = useCallback(async (filePath: string) => {
    const { openFiles: current, openOrActivate, pushRecent } = useEditorStore.getState();
    const alreadyOpen = current.find((f) => f.path && normFs(f.path) === normFs(filePath));
    if (alreadyOpen) {
      useEditorStore.getState().setActive(fileKeyOf(alreadyOpen));
      return;
    }
    const content = await window.electronAPI!.readFile(filePath);
    const name = baseName(filePath);
    openOrActivate({ path: filePath, name, content, savedContent: content });
    pushRecent(filePath);
  }, []);

  const handleOpenFile = useCallback(async () => {
    const { openOrActivate, pushRecent } = useEditorStore.getState();
    const result = await window.electronAPI!.openFile();
    if (!result) return;
    const name = baseName(result.path);
    openOrActivate({
      path: result.path,
      name,
      content: result.content,
      savedContent: result.content,
    });
    pushRecent(result.path);
  }, []);

  const startLsp = useCallback(
    async (rootPath: string) => {
      const { setLspStatus } = useLspStore.getState();
      const { notifyError: notify } = useUiStore.getState();
      if (lspReadyTimer.current) {
        clearTimeout(lspReadyTimer.current);
        lspReadyTimer.current = null;
      }
      setLspStatus("starting");
      try {
        const res = await window.electronAPI?.lspStart?.(rootPath);
        if (res && !res.ok) {
          setLspStatus("error");
          notify(`IntelliSense no disponible: ${res.error}`);
          return;
        }
      } catch (err) {
        setLspStatus("error");
        notify(`IntelliSense no disponible: ${String((err as Error)?.message ?? err)}`);
        return;
      }
      setLspStatus("indexing");
      lspReadyTimer.current = setTimeout(() => {
        const st = useLspStore.getState();
        if (st.lspStatus === "indexing") st.setLspStatus("ready");
      }, 45000);
    },
    []
  );

  // LSP opens tabs on cross-file goto-definition
  useEffect(() => {
    setOpenFileByPath((fsPath: string) => loadFileByPath(fsPath));
  }, [loadFileByPath]);

  const openDecompiledPending = useCallback(({ token, name }: { token: string; name: string }) => {
    const { openFiles: current, openOrActivate } = useEditorStore.getState();
    const id = `decompiled:${token}`;
    const uri = `decompiled://mini-code/${encodeURIComponent(token)}`;
    if (!current.some((f) => fileKeyOf(f) === id)) {
      openOrActivate({
        id,
        name,
        content: "",
        savedContent: "",
        readOnly: true,
        modelUri: uri,
        loading: true,
        progress: "Iniciando…",
      });
    }
    return { id, uri };
  }, []);

  const fulfillDecompiled = useCallback((id: string, res: any) => {
    const { openFiles: current, patchFile, setLiveContent } = useEditorStore.getState();
    const entry = current.find((f) => fileKeyOf(f) === id);
    if (!entry) return { uri: null }; // closed while loading
    const uri = entry.modelUri;
    if (res && res.ok) {
      setPendingReveal({
        uri: uri ?? undefined,
        lineNumber: res.line,
        column: res.column,
        symbol: res.symbol,
      });
      setLiveContent(id, res.source);
      patchFile(id, {
        name: res.name,
        content: res.source,
        savedContent: res.source,
        loading: false,
        loadError: null,
        progress: null,
        origin: res.origin,
        originLabel: res.originLabel,
      });
    } else {
      patchFile(id, {
        loading: false,
        progress: null,
        loadError: (res && res.error) || "No se pudo resolver el símbolo",
      });
    }
    return { uri };
  }, []);

  useEffect(() => {
    setDecompiledCtl({ openPending: openDecompiledPending, fulfill: fulfillDecompiled });
  }, [openDecompiledPending, fulfillDecompiled]);

  // Decompilation progress (main -> loading virtual tab)
  useEffect(() => {
    const off = window.electronAPI?.onExternalProgress?.(({ token, message }) => {
      const id = `decompiled:${token}`;
      useEditorStore.getState().patchAll((prev) =>
        prev.some((f) => fileKeyOf(f) === id && f.loading)
          ? prev.map((f) => (fileKeyOf(f) === id ? { ...f, progress: message } : f))
          : prev
      );
    });
    return () => off?.();
  }, []);

  // Per-file error badges (single subscription in the store)
  useEffect(() => {
    ensureFileErrorSubscription();
  }, []);

  // First diagnostics confirm the server compiled the project
  useEffect(() => {
    const offDiag = window.electronAPI?.onDiagnostics?.(() => {
      const { lspStatus: prev, setLspStatus } = useLspStore.getState();
      if (prev === "indexing") setLspStatus("ready");
    });
    const offStatus = window.electronAPI?.onLspStatus?.(({ state, message }) => {
      if (state === "error") {
        if (lspReadyTimer.current) {
          clearTimeout(lspReadyTimer.current);
          lspReadyTimer.current = null;
        }
        useLspStore.getState().setLspStatus("error");
        useUiStore.getState().notifyError(message ?? "El servidor Java se detuvo inesperadamente.");
      }
    });
    return () => {
      offDiag?.();
      offStatus?.();
    };
  }, []);

  const refreshTree = useCallback(async () => {
    const { folderTree: tree } = useWorkspaceStore.getState();
    if (!tree) return;
    const next = await window.electronAPI!.readDirTree(tree.path);
    useWorkspaceStore.getState().setFolderTree(next);
  }, []);

  const handleOpenFolder = useCallback(async () => {
    const tree = await window.electronAPI!.openFolder();
    if (!tree) return;
    const ws = useWorkspaceStore.getState();
    ws.setFolderTree(tree);
    ws.setExpanded(new Set([tree.path]));
    ws.selectFolder(null);
    ws.clearUndo();
    useUiStore.getState().setSidebarVisible(true);
    startLsp(tree.path);
  }, [startLsp]);

  // Shared move/rename engine (undo included)
  const moveAndRemap = useCallback(
    async (srcPath: string, destPath: string, actionLabel: string) => {
      const { notifyError: notify } = useUiStore.getState();
      const ed = useEditorStore.getState();
      const ws = useWorkspaceStore.getState();
      const remap = (p: string) =>
        p === srcPath || p.startsWith(srcPath + "\\") || p.startsWith(srcPath + "/")
          ? destPath + p.slice(srcPath.length)
          : p;
      try {
        await window.electronAPI!.moveEntry(srcPath, destPath);
      } catch (err) {
        console.error(`No se pudo ${actionLabel}:`, err);
        notify(
          /EEXIST|EPERM/i.test(String((err as Error)?.message ?? err))
            ? `No se pudo ${actionLabel}: ya existe un elemento con ese nombre en el destino.`
            : `No se pudo ${actionLabel} el elemento. Inténtalo de nuevo.`
        );
        return false;
      }
      for (const [k, v] of [...ed.liveContents.entries()]) {
        const nk = remap(k);
        if (nk !== k) {
          ed.liveContents.delete(k);
          ed.liveContents.set(nk, v);
        }
      }
      ws.setExpanded(new Set([...ws.expandedPaths].map(remap)));
      ed.patchAll((prev) => prev.map((f) => (f.path ? { ...f, path: remap(f.path) } : f)));
      if (ed.activeKey) ed.setActive(remap(ed.activeKey));
      if (ws.selectedPath) ws.selectFolder(remap(ws.selectedPath));
      ws.pushUndo({ type: "move", src: srcPath, dest: destPath });
      refreshTree();
      return true;
    },
    [refreshTree]
  );

  const handleMoveEntry = useCallback(
    async (srcPath: string, destDirPath: string) => {
      const sep = destDirPath.includes("\\") ? "\\" : "/";
      const base = baseName(srcPath);
      if (!base) return;
      if (
        destDirPath === srcPath ||
        destDirPath.startsWith(srcPath + "\\") ||
        destDirPath.startsWith(srcPath + "/")
      ) {
        return;
      }
      const destPath = destDirPath + sep + base;
      if (destPath === srcPath) return;
      await moveAndRemap(srcPath, destPath, "mover");
    },
    [moveAndRemap]
  );

  const handleRenameEntry = useCallback(
    async (srcPath: string, newName: string) => {
      const clean = sanitizeFileName(newName);
      const base = baseName(srcPath);
      if (!clean || clean === base) return;
      const dirEnd = Math.max(srcPath.lastIndexOf("\\"), srcPath.lastIndexOf("/"));
      if (dirEnd <= 0) return;
      const destPath = srcPath.slice(0, dirEnd + 1) + clean;
      if (destPath === srcPath) return;
      await moveAndRemap(srcPath, destPath, "renombrar");
    },
    [moveAndRemap]
  );

  const closeFilesInside = useCallback((dirPath: string) => {
    const ed = useEditorStore.getState();
    const next = ed.openFiles.filter((f) => !(f.path && isInside(f.path, dirPath)));
    for (const f of ed.openFiles) {
      if (f.path && isInside(f.path, dirPath)) {
        ed.liveContents.delete(fileKeyOf(f));
        try {
          disposeModelForKey(fileKeyOf(f));
        } catch {
          // best-effort
        }
      }
    }
    ed.patchAll(() => next);
    if (ed.activeKey && !next.some((f) => fileKeyOf(f) === ed.activeKey)) {
      ed.setActive(next.length > 0 ? fileKeyOf(next[next.length - 1]) : null);
    }
  }, []);

  const handleDeleteEntry = useCallback(
    async (path: string) => {
      const { notifyError: notify } = useUiStore.getState();
      const ws = useWorkspaceStore.getState();
      try {
        await window.electronAPI!.trashEntry(path);
      } catch (err) {
        console.error("No se pudo eliminar:", err);
        notify("No se pudo eliminar el elemento. Que raro.");
        return;
      }
      closeFilesInside(path);
      if (ws.selectedPath && isInside(ws.selectedPath, path)) ws.selectFolder(null);
      ws.setExpanded(new Set([...ws.expandedPaths].filter((p) => !isInside(p, path))));
      refreshTree();
    },
    [refreshTree, closeFilesInside]
  );

  const handleUndo = useCallback(async () => {
    const ws = useWorkspaceStore.getState();
    const { notifyError: notify } = useUiStore.getState();
    const action = ws.popUndo();
    if (!action) return;
    if (action.type === "create") {
      try {
        await window.electronAPI!.deleteEntry(action.path);
      } catch (err) {
        console.error("No se pudo deshacer:", err);
        notify("No se pudo deshacer la creación. Que raro.");
        return;
      }
      closeFilesInside(action.path);
      const ws2 = useWorkspaceStore.getState();
      if (ws2.selectedPath && isInside(ws2.selectedPath, action.path)) ws2.selectFolder(null);
      refreshTree();
    } else if (action.type === "move") {
      try {
        await window.electronAPI!.moveEntry(action.dest, action.src);
      } catch (err) {
        console.error("No se pudo deshacer:", err);
        notify("No se pudo deshacer el movimiento. Que raro.");
        return;
      }
      const ed = useEditorStore.getState();
      const ws2 = useWorkspaceStore.getState();
      const remap = (p: string) =>
        p === action.dest || p.startsWith(action.dest + "\\") || p.startsWith(action.dest + "/")
          ? action.src + p.slice(action.dest.length)
          : p;
      for (const [k, v] of [...ed.liveContents.entries()]) {
        const nk = remap(k);
        if (nk !== k) {
          ed.liveContents.delete(k);
          ed.liveContents.set(nk, v);
        }
      }
      ws2.setExpanded(new Set([...ws2.expandedPaths].map(remap)));
      ed.patchAll((prev) => prev.map((f) => (f.path ? { ...f, path: remap(f.path) } : f)));
      if (ed.activeKey) ed.setActive(remap(ed.activeKey));
      if (ws2.selectedPath) ws2.selectFolder(remap(ws2.selectedPath));
      refreshTree();
    }
  }, [refreshTree, closeFilesInside]);

  // Sidebar resizing by dragging the side handle
  const startSidebarResize = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = useUiStore.getState().sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + ev.clientX - startX));
      useUiStore.getState().setSidebarWidth(next);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const resetSidebarWidth = useCallback(() => {
    useUiStore.getState().setSidebarWidth(SIDEBAR_DEFAULT);
  }, []);

  const handleNewFolder = useCallback(async () => {
    const parent = await window.electronAPI!.pickParentFolder();
    if (!parent) return;
    const ui = useUiStore.getState();
    ui.setPendingParent(parent);
    ui.setNewFolderName("nueva-carpeta");
  }, []);

  const handleConfirmNewFolder = useCallback(async () => {
    const ui = useUiStore.getState();
    const ws = useWorkspaceStore.getState();
    const ed = useEditorStore.getState();
    const name = ui.newFolderName.trim();
    if (!ui.pendingParent || !name) {
      ui.setPendingParent(null);
      return;
    }
    try {
      const clean = sanitizeFileName(name);
      const createdPath = await window.electronAPI!.createFolder(ui.pendingParent, clean);
      ws.pushUndo({ type: "create", path: createdPath });
      const tree = await window.electronAPI!.readDirTree(createdPath);
      ws.setFolderTree(tree);
      ws.setExpanded(new Set([tree.path]));
      ws.selectFolder(null);
      ws.clearUndo();
      ui.setSidebarVisible(true);
      ed.clearLiveContents();
      try {
        disposeAllModels();
      } catch {
        // best-effort
      }
      ed.closeAll();
      startLsp(tree.path);
    } catch (err) {
      console.error("No se pudo crear la carpeta:", err);
      ui.notifyError(
        /EEXIST/i.test(String((err as Error)?.message ?? err))
          ? `Ya existe una carpeta con ese nombre en "${ui.pendingParent}".`
          : "No se pudo crear la carpeta. Que raro."
      );
    } finally {
      useUiStore.getState().setPendingParent(null);
      useUiStore.getState().setNewFolderName("");
    }
  }, [startLsp]);

  const handleCancelNewFolder = useCallback(() => {
    const ui = useUiStore.getState();
    ui.setPendingParent(null);
    ui.setNewFolderName("");
  }, []);

  // Keystroke writes without re-render (text to live store + throttled flush)
  const handleContentChange = useCallback((value: string) => {
    const ed = useEditorStore.getState();
    if (!ed.activeKey) return;
    ed.setLiveContent(ed.activeKey, value);
    scheduleLiveFlush();
  }, []);

  const handleSelectFile = useCallback((key: FileKey) => {
    useEditorStore.getState().setActive(key);
  }, []);

  const closeFileByKey = useCallback((key: FileKey) => {
    const ed = useEditorStore.getState();
    ed.dropLiveContent(key);
    try {
      disposeModelForKey(key);
    } catch {
      // dispose best-effort
    }
    ed.closeFile(key);
  }, []);

  const handleCloseFileRequest = useCallback(
    (key: FileKey) => {
      const ed = useEditorStore.getState();
      const f = ed.openFiles.find((f) => fileKeyOf(f) === key);
      if (!f) return;
      const live = ed.liveContents.get(key) ?? f.content;
      if (live !== f.savedContent) {
        useUiStore.getState().setPendingClose({ key, name: f.name });
      } else {
        closeFileByKey(key);
      }
    },
    [closeFileByKey]
  );

  const saveFile = useCallback(async (file: OpenFile) => {
    const ed = useEditorStore.getState();
    const ui = useUiStore.getState();
    const key = fileKeyOf(file);
    const live = ed.liveContents.get(key) ?? file.content ?? "";
    if (file.path) {
      try {
        await window.electronAPI!.writeFile(file.path, live);
      } catch (err) {
        console.error("No se pudo guardar:", err);
        ui.notifyError("No se pudo guardar el archivo. Que raro.");
        return false;
      }
      ed.patchFile(key, { content: live, savedContent: live });
      ed.pushRecent(file.path);
      return true;
    }
    let savedPath: string | null;
    try {
      savedPath = await window.electronAPI!.saveFileAs(live, file.name);
    } catch (err) {
      console.error("No se pudo guardar:", err);
      ui.notifyError("No se pudo guardar el archivo. Que raro.");
      return false;
    }
    if (!savedPath) return false;
    const name = baseName(savedPath);
    ed.dropLiveContent(key);
    ed.setLiveContent(savedPath, live);
    try {
      disposeModelForKey(key);
    } catch {
      // best-effort
    }
    ed.patchFile(key, {
      path: savedPath,
      name,
      content: live,
      savedContent: live,
      id: undefined,
      readOnly: false,
      modelUri: null,
    });
    ed.setActive(savedPath);
    ed.pushRecent(savedPath);
    refreshTree();
    return true;
  }, [refreshTree]);

  const handleSaveAndClose = useCallback(async () => {
    const ui = useUiStore.getState();
    const ed = useEditorStore.getState();
    if (!ui.pendingClose) return;
    const f = ed.openFiles.find((f) => fileKeyOf(f) === ui.pendingClose!.key);
    if (f) {
      const ok = await saveFile(f);
      if (!ok) return;
    }
    closeFileByKey(ui.pendingClose.key);
    useUiStore.getState().setPendingClose(null);
  }, [saveFile, closeFileByKey]);

  const handleDiscardAndClose = useCallback(() => {
    const ui = useUiStore.getState();
    if (!ui.pendingClose) return;
    closeFileByKey(ui.pendingClose.key);
    useUiStore.getState().setPendingClose(null);
  }, [closeFileByKey]);

  const handleSave = useCallback(async () => {
    const ed = useEditorStore.getState();
    const file = ed.openFiles.find((f) => fileKeyOf(f) === ed.activeKey) ?? null;
    if (!file) return;
    await saveFile(file);
  }, [saveFile]);

  const handleSaveAs = useCallback(async () => {
    const ed = useEditorStore.getState();
    const file = ed.openFiles.find((f) => fileKeyOf(f) === ed.activeKey) ?? null;
    if (!file) return;
    const key = fileKeyOf(file);
    const live = ed.liveContents.get(key) ?? file.content ?? "";
    const savedPath = await window.electronAPI!.saveFileAs(live, file.name);
    if (!savedPath) return;
    const name = baseName(savedPath);
    ed.dropLiveContent(key);
    ed.setLiveContent(savedPath, live);
    try {
      disposeModelForKey(key);
    } catch {
      // best-effort
    }
    ed.patchFile(key, {
      path: savedPath,
      name,
      content: live,
      savedContent: live,
      id: undefined,
      readOnly: false,
      modelUri: null,
    });
    ed.setActive(savedPath);
    ed.pushRecent(savedPath);
    refreshTree();
  }, [refreshTree]);

  const handleRestart = useCallback(() => {
    cancelLiveFlush();
    const ed = useEditorStore.getState();
    ed.clearLiveContents();
    try {
      disposeAllModels();
    } catch {
      // best-effort
    }
    ed.closeAll();
    ed.clearViewStates();
    useWorkspaceStore.getState().resetWorkspace();
    useUiStore.getState().resetForRestart();
    clearLspTimer();
    useLspStore.getState().setLspStatus("off");
    clearFileErrors();
    window.electronAPI?.lspStop?.().catch(() => {});
  }, [clearLspTimer]);

  // Global shortcuts via command registry (extensions/commandRegistry)
  useEffect(() => {
    const undoGuarded = () => {
      const ae = document.activeElement;
      const inField =
        ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || (ae as HTMLElement).isContentEditable);
      const inEditor = ae && (ae as HTMLElement).closest && (ae as HTMLElement).closest(".monaco-editor");
      if (!inField && !inEditor && useWorkspaceStore.getState().undoStack.length > 0) {
        void handleUndo();
      }
    };
    const closeActive = () => {
      const key = useEditorStore.getState().activeKey;
      if (key) handleCloseFileRequest(key);
    };
    const unsubs = [
      registerCommand({ id: "file.save", title: "Guardar", shortcut: "ctrl+s", run: () => void handleSave() }),
      registerCommand({ id: "file.saveAs", title: "Guardar como", shortcut: "ctrl+shift+s", run: () => void handleSaveAs() }),
      registerCommand({ id: "file.open", title: "Abrir archivo", shortcut: "ctrl+o", run: () => void handleOpenFile() }),
      registerCommand({ id: "folder.open", title: "Abrir carpeta", shortcut: "ctrl+shift+o", run: () => void handleOpenFolder() }),
      registerCommand({ id: "folder.new", title: "Nueva carpeta", shortcut: "ctrl+n", run: () => void handleNewFolder() }),
      registerCommand({ id: "file.closeActive", title: "Cerrar pestaña", shortcut: "ctrl+w", run: closeActive }),
      registerCommand({
        id: "sidebar.toggle",
        title: "Mostrar/ocultar explorador",
        shortcut: "ctrl+shift+e",
        run: () => useUiStore.getState().toggleSidebar(),
      }),
      registerCommand({ id: "explorer.undo", title: "Deshacer (explorador)", shortcut: "ctrl+z", run: undoGuarded }),
    ];
    const bindings: Record<string, string> = {
      "ctrl+s": "file.save",
      "ctrl+shift+s": "file.saveAs",
      "ctrl+o": "file.open",
      "ctrl+shift+o": "folder.open",
      "ctrl+n": "folder.new",
      "ctrl+w": "file.closeActive",
      "ctrl+shift+e": "sidebar.toggle",
      "ctrl+z": "explorer.undo",
    };
    const handler = (e: KeyboardEvent) => handleShortcutEvent(e, bindings, isMac);
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      for (const off of unsubs) off();
    };
  }, [handleSave, handleSaveAs, handleOpenFile, handleOpenFolder, handleNewFolder, handleCloseFileRequest, handleUndo]);

  const showWelcome = !activeFile;

  return (
    <div className="flex h-screen w-screen flex-col bg-graphite-950 text-graphite-300 font-ui">
      <TitleBar lspStatus={lspStatus} />

      <div className="flex flex-1 min-h-0">
        {sidebarVisible && folderTree && (
          <>
            <Sidebar
              tree={folderTree}
              activePath={activeFile?.path}
              expanded={expandedPaths}
              onToggleFolder={(p: string) => useWorkspaceStore.getState().toggleFolder(p)}
              onExpandFolder={(p: string) => useWorkspaceStore.getState().expandFolder(p)}
              selectedPath={selectedPath}
              onSelectFolder={(p: string | null) => useWorkspaceStore.getState().selectFolder(p)}
              onMoveEntry={handleMoveEntry}
              onRenameEntry={handleRenameEntry}
              onDeleteEntry={handleDeleteEntry}
              width={sidebarWidth}
              onOpenFile={loadFileByPath}
              onRestart={handleRestart}
              onError={notifyError}
              onDidCreate={(path: string) => useWorkspaceStore.getState().pushUndo({ type: "create", path })}
              onRefresh={refreshTree}
              onToggleSidebar={() => useUiStore.getState().toggleSidebar()}
              fileErrors={fileErrors}
            />
            <div
              onMouseDown={startSidebarResize}
              onDoubleClick={resetSidebarWidth}
              title="Arrastrar para redimensionar (doble clic para restablecer)"
              className="relative z-10 -ml-1 w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-ember-500/60 active:bg-ember-500/80 transition-colors"
            />
          </>
        )}

        <div className="flex-1 min-w-0 flex flex-col relative">
          {!showWelcome && (
            <div className="flex h-9 shrink-0 items-stretch border-b border-graphite-800 bg-graphite-900 select-none">
              {!sidebarVisible && folderTree && (
                <button
                  onClick={() => useUiStore.getState().setSidebarVisible(true)}
                  title="Mostrar explorador (Ctrl+Shift+E)"
                  className="flex shrink-0 items-center border-r border-graphite-800 px-2.5 text-graphite-400 hover:text-ember-400"
                >
                  <PanelLeft size={14} />
                </button>
              )}
              <TabBar
                files={openFiles}
                activeKey={activeKey}
                onSelect={handleSelectFile}
                onClose={handleCloseFileRequest}
                fileErrors={fileErrors}
              />
            </div>
          )}
          {showWelcome && folderTree && !sidebarVisible && (
            <button
              onClick={() => useUiStore.getState().setSidebarVisible(true)}
              title="Mostrar explorador (Ctrl+Shift+E)"
              className="absolute left-2 top-2 z-10 rounded-md bg-graphite-800/90 p-1.5 text-graphite-300 hover:text-ember-400 hover:bg-graphite-700 border border-graphite-700"
            >
              <PanelLeft size={16} />
            </button>
          )}

          {showWelcome ? (
            <WelcomeScreen
              recentFiles={recentFiles}
              folderName={folderTree?.name ?? null}
              folderPath={folderTree?.path ?? null}
              pendingParent={pendingParent}
              newFolderName={newFolderName}
              onNewFolderNameChange={(v: string) => useUiStore.getState().setNewFolderName(v)}
              onConfirmNewFolder={handleConfirmNewFolder}
              onCancelNewFolder={handleCancelNewFolder}
              onNewFolder={handleNewFolder}
              onOpenFile={handleOpenFile}
              onOpenFolder={handleOpenFolder}
              onOpenRecent={loadFileByPath}
            />
          ) : activeFile!.loading || activeFile!.loadError ? (
            <DecompilingView file={activeFile!} />
          ) : (
            <EditorPane
              key={fileKeyOf(activeFile!)}
              initialValue={
                useEditorStore.getState().getLiveContent(activeFile!) ?? activeFile!.content ?? ""
              }
              language={langForFileName(activeFile!.name)}
              fileUri={activeFile!.path ? "file:///" + encodeURI(activeFile!.path.replace(/\\/g, "/").replace(/^\//, "")) : null}
              modelUri={activeFile!.modelUri ?? null}
              readOnly={!!activeFile!.readOnly}
              viewStateKey={fileKeyOf(activeFile!)}
              initialViewState={useEditorStore.getState().viewStates.get(fileKeyOf(activeFile!))}
              onSaveViewState={(k: FileKey, s: unknown) => useEditorStore.getState().saveViewState(k, s)}
              onChange={handleContentChange}
              onFocusEditor={() => useWorkspaceStore.getState().selectFolder(null)}
            />
          )}
        </div>
      </div>

      {pendingClose && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) useUiStore.getState().setPendingClose(null);
          }}
        >
          <div className="w-96 rounded-lg border border-graphite-700 bg-graphite-800 p-4 shadow-2xl">
            <h3 className="text-[14px] font-semibold text-graphite-100">¿Cerrar sin guardar?</h3>
            <p className="mt-1.5 text-[12.5px] leading-snug text-graphite-300">
              "{pendingClose.name}" tiene cambios sin guardar. Si lo cierras ahora, perderás lo
              editado.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => useUiStore.getState().setPendingClose(null)}
                className="rounded-md border border-graphite-600 px-3 py-1.5 text-[12.5px] text-graphite-200 hover:bg-graphite-700"
              >
                Cancelar
              </button>
              <button
                onClick={handleDiscardAndClose}
                className="rounded-md border border-red-500/50 px-3 py-1.5 text-[12.5px] text-red-400 hover:bg-red-500/10"
              >
                Cerrar sin guardar
              </button>
              <button
                onClick={handleSaveAndClose}
                className="rounded-md bg-ember-500 px-3 py-1.5 text-[12.5px] font-medium text-graphite-950 hover:bg-ember-400"
              >
                Guardar y cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="toast-in pointer-events-auto flex items-start gap-2 rounded-md border border-red-500/40 bg-graphite-800 px-3 py-2.5 shadow-xl"
            >
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-400" />
              <p className="flex-1 text-[12.5px] leading-snug text-graphite-100">{t.message}</p>
              <button
                onClick={() => dismissToast(t.id)}
                title="Cerrar aviso"
                className="rounded p-0.5 text-graphite-500 hover:bg-graphite-700 hover:text-graphite-200"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
