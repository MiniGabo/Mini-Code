// Pantalla de bienvenida.
import { FolderPlus, FolderOpen, FileCode2, Coffee } from "lucide-react";

const isMac =
  typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

function StartAction({
  icon: Icon,
  label,
  shortcut,
  onClick,
}: {
  icon: typeof FolderPlus;
  label: string;
  shortcut?: string[];
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-graphite-850"
    >
      <Icon size={17} className="shrink-0 text-graphite-500 group-hover:text-ember-400" />
      <span className="flex-1 text-[14px] text-graphite-300 group-hover:text-graphite-100">{label}</span>
      {shortcut && (
        <span className="flex gap-1">
          {shortcut.map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}
        </span>
      )}
    </button>
  );
}

export interface WelcomeScreenProps {
  pendingParent?: string | null;
  newFolderName?: string;
  onNewFolderNameChange?: (v: string) => void;
  onConfirmNewFolder?: () => void;
  onCancelNewFolder?: () => void;
  onNewFolder: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  // Recibidos por compat (hoy no se renderizan: sin lista de recientes)
  recentFiles?: string[];
  folderName?: string | null;
  folderPath?: string | null;
  onOpenRecent?: (path: string) => void;
}

export default function WelcomeScreen({
  pendingParent = null,
  newFolderName = "",
  onNewFolderNameChange = () => {},
  onConfirmNewFolder = () => {},
  onCancelNewFolder = () => {},
  onNewFolder,
  onOpenFile,
  onOpenFolder,
}: WelcomeScreenProps) {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden bg-graphite-950">
      <div className="flex w-full max-w-[320px] flex-col items-center px-6 text-center">
        {/* Logo grande, sin fondo */}
        <Coffee size={56} strokeWidth={1.4} className="text-ember-500" />
        <h1 className="mt-4 text-4xl font-semibold text-graphite-100">Mini Code</h1>

        {/* 3 acciones principales con shortcut al lado */}
        <div className="mt-10 w-full">
          <StartAction
            icon={FolderPlus}
            label="Nueva carpeta..."
            shortcut={isMac ? ["⌘", "N"] : ["Ctrl", "N"]}
            onClick={onNewFolder}
          />
          <StartAction
            icon={FileCode2}
            label="Abrir archivo..."
            shortcut={isMac ? ["⌘", "O"] : ["Ctrl", "O"]}
            onClick={onOpenFile}
          />
          <StartAction
            icon={FolderOpen}
            label="Abrir carpeta..."
            shortcut={isMac ? ["⌘", "⇧", "O"] : ["Ctrl", "Shift", "O"]}
            onClick={onOpenFolder}
          />
        </div>

        {/* Nombre de la nueva carpeta (solo cuando se eligió ubicación) */}
        {pendingParent && (
          <div className="mt-4 w-full rounded-lg border border-ember-500/40 bg-graphite-850 p-3 text-left">
            <p className="truncate text-[11px] text-graphite-500" title={pendingParent}>
              Crear en: {pendingParent}
            </p>
            <div className="mt-2 flex gap-2">
              <input
                autoFocus
                value={newFolderName}
                onChange={(e) => onNewFolderNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onConfirmNewFolder();
                  if (e.key === "Escape") onCancelNewFolder();
                }}
                placeholder="nombre-de-carpeta"
                className="min-w-0 flex-1 rounded border border-graphite-600 bg-graphite-800 px-2 py-1.5 text-[13px] text-graphite-100 outline-none focus:border-ember-500/60"
              />
              <button
                onClick={onConfirmNewFolder}
                className="shrink-0 rounded bg-ember-500/15 px-3 py-1.5 text-[13px] text-ember-400 hover:bg-ember-500/25"
              >
                Crear
              </button>
            </div>
            <button
              onClick={onCancelNewFolder}
              className="mt-1.5 text-[11px] text-graphite-500 hover:text-graphite-300"
            >
              Cancelar (Esc)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
