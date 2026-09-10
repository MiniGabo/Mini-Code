// File explorer.
import { useEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import {
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  RotateCcw,
  RefreshCcw,
  ChevronRight,
  ChevronDown,
  PanelLeftClose,
  Pencil,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import FileIcon from "./FileIcon";
import type { FileTreeNode } from "../types";

function fileIcon(name: string) {
  return <FileIcon name={name} size={14} />;
}

function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i > 0 ? p.slice(0, i) : p;
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function MenuItem({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[12.5px] ${
        danger ? "text-red-400 hover:bg-red-500/10" : "text-graphite-200 hover:bg-graphite-700"
      }`}
    >
      <Icon size={14} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function MenuDivider() {
  return <div className="mx-2 my-1 border-t border-graphite-700" />;
}

// Row label: inline input while renaming
function RowLabel({
  node,
  renamingPath,
  renameDraft,
  onRenameDraft,
  onConfirmRename,
  onCancelRename,
}: {
  node: FileTreeNode;
  renamingPath: string | null;
  renameDraft: string;
  onRenameDraft: (v: string) => void;
  onConfirmRename: () => void;
  onCancelRename: () => void;
}) {
  if (renamingPath === node.path) {
    return (
      <input
        autoFocus
        value={renameDraft}
        onChange={(e) => onRenameDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirmRename();
          if (e.key === "Escape") onCancelRename();
        }}
        onBlur={onCancelRename}
        onFocus={(e) => e.target.select()}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        className="min-w-0 flex-1 rounded border border-ember-500/60 bg-graphite-800 px-1 py-0.5 text-[13px] text-graphite-100 outline-none"
      />
    );
  }
  return <span className="truncate">{node.name}</span>;
}

interface TreeNodeProps {
  node: FileTreeNode;
  depth: number;
  activePath?: string;
  expanded: Set<string>;
  selectedPath: string | null;
  dragOverPath: string | null;
  renamingPath: string | null;
  renameDraft: string;
  onRenameDraft: (v: string) => void;
  onConfirmRename: () => void;
  onCancelRename: () => void;
  onToggle: (path: string) => void;
  onSelectFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
  onDragStart: (e: ReactDragEvent, path: string) => void;
  onDragEnd: () => void;
  onDropOnRow: (e: ReactDragEvent, destDir: string) => void;
  onRowContextMenu: (e: ReactMouseEvent, kind: string, path: string) => void;
  fileErrors?: Record<string, number>;
}

function TreeNode({
  node,
  depth,
  activePath,
  expanded,
  selectedPath,
  dragOverPath,
  renamingPath,
  renameDraft,
  onRenameDraft,
  onConfirmRename,
  onCancelRename,
  onToggle,
  onSelectFolder,
  onOpenFile,
  onDragStart,
  onDragEnd,
  onDropOnRow,
  onRowContextMenu,
  fileErrors,
}: TreeNodeProps) {
  const isFolder = node.type === "folder";
  const isOpen = expanded.has(node.path);
  const errCount = !isFolder ? (fileErrors?.[node.path.toLowerCase()] ?? 0) : 0;

  const rowClass = (extra = "") =>
    `tree-row${extra ? ` ${extra}` : ""}${
      selectedPath === node.path ? " selected" : ""
    }${dragOverPath === node.path ? " drop-target" : ""}${
      errCount > 0 ? " has-errors" : ""
    }`;

  if (isFolder) {
    return (
      <div>
        <div
          className={rowClass()}
          data-tpath={node.path}
          data-tfolder
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable={renamingPath !== node.path}
          onDragStart={(e) => onDragStart(e, node.path)}
          onDragEnd={onDragEnd}
          onDrop={(e) => onDropOnRow(e, node.path)}
          onContextMenu={(e) => onRowContextMenu(e, "folder", node.path)}
          onClick={() => {
            onToggle(node.path);
            onSelectFolder(node.path);
          }}
        >
          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {isOpen ? (
            <FolderOpen size={14} className="text-ember-400" />
          ) : (
            <Folder size={14} className="text-ember-400" />
          )}
          <RowLabel
            node={node}
            renamingPath={renamingPath}
            renameDraft={renameDraft}
            onRenameDraft={onRenameDraft}
            onConfirmRename={onConfirmRename}
            onCancelRename={onCancelRename}
          />
        </div>
        {isOpen &&
          node.children?.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              expanded={expanded}
              selectedPath={selectedPath}
              dragOverPath={dragOverPath}
              onToggle={onToggle}
              onSelectFolder={onSelectFolder}
              onOpenFile={onOpenFile}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropOnRow={onDropOnRow}
              onRowContextMenu={onRowContextMenu}
              renamingPath={renamingPath}
              renameDraft={renameDraft}
              onRenameDraft={onRenameDraft}
              onConfirmRename={onConfirmRename}
              onCancelRename={onCancelRename}
              fileErrors={fileErrors}
            />
          ))}
      </div>
    );
  }

  return (
    <div
      className={rowClass(activePath === node.path ? "active" : "")}
      data-tpath={node.path}
      style={{ paddingLeft: 8 + depth * 14 + 17 }}
      draggable={renamingPath !== node.path}
      onDragStart={(e) => onDragStart(e, node.path)}
      onDragEnd={onDragEnd}
      onDrop={(e) => onDropOnRow(e, parentDir(node.path))}
      onContextMenu={(e) => onRowContextMenu(e, "file", node.path)}
      onClick={() => onOpenFile(node.path)}
    >
      {fileIcon(node.name)}
      <RowLabel
        node={node}
        renamingPath={renamingPath}
        renameDraft={renameDraft}
        onRenameDraft={onRenameDraft}
        onConfirmRename={onConfirmRename}
        onCancelRename={onCancelRename}
      />
      {errCount > 0 && (
        <span
          className="ml-auto shrink-0 rounded-full bg-red-500/20 px-1.5 text-[11px] font-medium text-red-400"
          title={`${errCount} error${errCount === 1 ? "" : "es"}`}
        >
          {errCount}
        </span>
      )}
    </div>
  );
}

export interface SidebarProps {
  tree: FileTreeNode;
  activePath?: string;
  expanded: Set<string>;
  onToggleFolder: (path: string) => void;
  onExpandFolder: (path: string) => void;
  selectedPath: string | null;
  onSelectFolder: (path: string | null) => void;
  onMoveEntry: (srcPath: string, destDirPath: string) => void;
  onRenameEntry: (srcPath: string, newName: string) => void;
  onDeleteEntry: (path: string) => void;
  width: number;
  onOpenFile: (path: string) => void;
  onRestart: () => void;
  onError: (message: string) => void;
  onDidCreate: (path: string) => void;
  onRefresh: () => void;
  onToggleSidebar: () => void;
  fileErrors?: Record<string, number>;
}

export default function Sidebar({
  tree,
  activePath,
  expanded,
  onToggleFolder,
  onExpandFolder,
  selectedPath,
  onSelectFolder,
  onMoveEntry,
  onRenameEntry,
  onDeleteEntry,
  width,
  onOpenFile,
  onRestart,
  onError,
  onDidCreate,
  onRefresh,
  onToggleSidebar,
  fileErrors,
}: SidebarProps) {
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [draftName, setDraftName] = useState("");
  const [renaming, setRenaming] = useState<{ path: string; name: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; kind: string; path: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragOverRoot, setDragOverRoot] = useState(false);
  // Creation target: selected folder, or root if nothing is selected
  const targetDir = selectedPath ?? tree.path;
  const targetLabel = selectedPath ? baseName(selectedPath) : `${tree.name} (raíz)`;

  const toggle = (path: string) => {
    onToggleFolder(path);
  };

  const onDragStart = (e: ReactDragEvent, path: string) => {
    e.dataTransfer.setData("text/mini-code-path", path);
    e.dataTransfer.effectAllowed = "move";
  };

  // Last applied highlight (ref to avoid re-rendering on every dragover:
  // that moved the DOM under the cursor and froze hover).
  const hlRef = useRef<{ row: string | null; root: boolean }>({ row: null, root: false });

  const setHL = (row: string | null, root: boolean) => {
    const prev = hlRef.current;
    if (prev.row === row && prev.root === root) return;
    hlRef.current = { row, root };
    setDragOver(row);
    setDragOverRoot(root);
  };

  const clearHL = () => setHL(null, false);

  const onDragEnd = () => {
    clearHL();
  };

  // Single panel-level dragover: derives the destination from the row
  // under the cursor (folder->itself, file->its parent, rest->root).
  const onTreeDragOver = (e: ReactDragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const t = e.target as HTMLElement | null;
    const row = t && t.closest ? t.closest("[data-tpath]") : null;
    if (!row) {
      setHL(null, true);
      return;
    }
    const dest = row.hasAttribute("data-tfolder")
      ? row.getAttribute("data-tpath")
      : parentDir(row.getAttribute("data-tpath") ?? "");
    if (dest === tree.path) setHL(null, true);
    else setHL(dest, false);
  };

  const onTreeDragLeave = (e: ReactDragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    clearHL();
  };

  const onDropOnRow = (e: ReactDragEvent, destDir: string) => {
    e.preventDefault();
    e.stopPropagation();
    clearHL();
    const src = e.dataTransfer.getData("text/mini-code-path");
    if (src) onMoveEntry(src, destDir);
  };

  // Dropping on the panel background or header moves to the root
  const onRootDrop = (e: ReactDragEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && t.closest && t.closest("[data-tpath]")) return;
    e.preventDefault();
    clearHL();
    const src = e.dataTransfer.getData("text/mini-code-path");
    if (src) onMoveEntry(src, tree.path);
  };

  const startCreate = (kind: "file" | "folder") => {
    setRenaming(null);
    setCreating(kind);
    setDraftName(kind === "file" ? "NuevoArchivo.java" : "nueva-carpeta");
  };

  // Inline rename: only Enter confirms, everything else cancels
  const startRename = (path: string) => {
    setMenu(null);
    setCreating(null);
    setDraftName("");
    setRenaming({ path, name: baseName(path) });
  };

  const confirmRename = () => {
    if (!renaming) return;
    const { path, name } = renaming;
    setRenaming(null);
    onRenameEntry(path, name);
  };

  const cancelRename = () => setRenaming(null);

  // Context menu: closes on outside click, scroll, or Escape
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    const onClick = () => setMenu(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
    };
  }, [menu]);

  const openRowMenu = (e: ReactMouseEvent, kind: string, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, kind, path });
  };

  const openRootMenu = (e: ReactMouseEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && t.closest && t.closest("[data-tpath]")) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, kind: "root", path: tree.path });
  };

  const createHere = (kind: "file" | "folder", dirPath: string) => {
    onSelectFolder(dirPath === tree.path ? null : dirPath);
    startCreate(kind);
  };

  // Only Enter confirms. Any other action (outside click, Escape...)
  // cancels without creating anything.
  const cancelCreate = () => {
    setCreating(null);
    setDraftName("");
  };

  const confirmCreate = async () => {
    const name = draftName.trim();
    if (!name) {
      setCreating(null);
      return;
    }
    try {
      if (creating === "file") {
        await window.electronAPI!.createFile(targetDir, name);
      } else if (creating === "folder") {
        await window.electronAPI!.createFolder(targetDir, name);
      }
      await onRefresh();
      onExpandFolder(targetDir);
      const sep = targetDir.includes("\\") ? "\\" : "/";
      onDidCreate(targetDir + sep + name);
    } catch (err) {
      console.error("No se pudo crear:", err);
      const msg = err instanceof Error ? err.message : String(err);
      const what = creating === "file" ? "archivo" : "carpeta";
      onError(
        /EEXIST/i.test(msg)
          ? `Ya existe un ${what} con el nombre "${name}" en ${targetLabel}.`
          : `No se pudo crear el ${what} "${name}". Que raro.`
      );
    } finally {
      setCreating(null);
      setDraftName("");
    }
  };

  return (
    <aside
      data-explorer
      style={{ width }}
      className="flex shrink-0 flex-col border-r border-graphite-800 bg-graphite-900"
      onDragOver={onTreeDragOver}
      onDragLeave={onTreeDragLeave}
    >
      <div
        className={`flex items-center justify-between rounded px-2 py-2 text-[11px] tracking-wide text-graphite-500${
          dragOverRoot ? " drop-target" : ""
        }`}
        onDrop={onRootDrop}
        onContextMenu={openRootMenu}
      >
        <span className="truncate">{tree.name.toUpperCase()}</span>
        <div className="flex items-center gap-0.5 text-graphite-400">
          <button
            title="Nuevo archivo"
            onClick={() => startCreate("file")}
            className="rounded p-1 hover:bg-graphite-800 hover:text-ember-400"
          >
            <FilePlus size={14} />
          </button>
          <button
            title="Nueva carpeta"
            onClick={() => startCreate("folder")}
            className="rounded p-1 hover:bg-graphite-800 hover:text-ember-400"
          >
            <FolderPlus size={14} />
          </button>
          <button
            title="Actualizar"
            onClick={onRefresh}
            className="rounded p-1 hover:bg-graphite-800 hover:text-ember-400"
          >
            <RefreshCcw size={13} />
          </button>
          <button
            title="Nueva pestaña: cerrar todo y reiniciar el editor"
            onClick={onRestart}
            className="rounded p-1 hover:bg-graphite-800 hover:text-ember-400"
          >
            <RotateCcw size={14} />
          </button>
          <button
            title="Ocultar explorador (Ctrl+Shift+E)"
            onClick={onToggleSidebar}
            className="rounded p-1 hover:bg-graphite-800 hover:text-ember-400"
          >
            <PanelLeftClose size={14} />
          </button>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto pb-4"
        onDrop={onRootDrop}
        onContextMenu={openRootMenu}
        onScroll={() => setMenu(null)}
      >
        {creating && (
          <div className="px-2 pb-1" style={{ paddingLeft: 8 }}>
            <p className="pb-1 text-[11px] text-graphite-500">
              Crear en: <span className="text-ember-400">{targetLabel}</span>
            </p>
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmCreate();
                if (e.key === "Escape") cancelCreate();
              }}
              onBlur={cancelCreate}
              placeholder={creating === "file" ? "Nombre del archivo" : "Nombre de la carpeta"}
              className="w-full rounded border border-ember-500/60 bg-graphite-800 px-2 py-1 text-[13px] text-graphite-100 outline-none"
            />
            <p className="pt-1 text-[11px] text-graphite-400">
              Enter para crear · clic fuera o Esc para cancelar
            </p>
          </div>
        )}
        {tree.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={0}
            activePath={activePath}
            expanded={expanded}
            selectedPath={selectedPath}
            dragOverPath={dragOver}
            onToggle={toggle}
            onSelectFolder={onSelectFolder}
            onOpenFile={onOpenFile}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDropOnRow={onDropOnRow}
            onRowContextMenu={openRowMenu}
            renamingPath={renaming?.path ?? null}
            renameDraft={renaming?.name ?? ""}
            onRenameDraft={(name) => setRenaming((prev) => (prev ? { ...prev, name } : prev))}
            onConfirmRename={confirmRename}
            onCancelRename={cancelRename}
            fileErrors={fileErrors}
          />
        ))}
        {tree.children?.length === 0 && !creating && (
          <p className="px-3 py-2 text-[12px] text-graphite-600">Carpeta vacía.</p>
        )}
      </div>

      {menu && (
        <div
          className="fixed z-50 w-52 rounded-md border border-graphite-700 bg-graphite-800 p-1 shadow-xl"
          style={{
            left: Math.max(8, Math.min(menu.x, window.innerWidth - 220)),
            top: Math.max(8, Math.min(menu.y, window.innerHeight - 200)),
          }}
        >
          {menu.kind === "file" && (
            <>
              <MenuItem
                icon={FolderOpen}
                label="Abrir"
                onClick={() => onOpenFile(menu.path)}
              />
              <MenuDivider />
              <MenuItem
                icon={Pencil}
                label="Renombrar"
                onClick={() => startRename(menu.path)}
              />
              <MenuItem
                icon={Trash2}
                label="Eliminar"
                danger
                onClick={() => onDeleteEntry(menu.path)}
              />
            </>
          )}
          {menu.kind === "folder" && (
            <>
              <MenuItem
                icon={FilePlus}
                label="Nuevo archivo"
                onClick={() => createHere("file", menu.path)}
              />
              <MenuItem
                icon={FolderPlus}
                label="Nueva carpeta"
                onClick={() => createHere("folder", menu.path)}
              />
              <MenuDivider />
              <MenuItem
                icon={Pencil}
                label="Renombrar"
                onClick={() => startRename(menu.path)}
              />
              <MenuItem
                icon={Trash2}
                label="Eliminar"
                danger
                onClick={() => onDeleteEntry(menu.path)}
              />
            </>
          )}
          {menu.kind === "root" && (
            <>
              <MenuItem
                icon={FilePlus}
                label="Nuevo archivo"
                onClick={() => createHere("file", tree.path)}
              />
              <MenuItem
                icon={FolderPlus}
                label="Nueva carpeta"
                onClick={() => createHere("folder", tree.path)}
              />
            </>
          )}
        </div>
      )}
    </aside>
  );
}
