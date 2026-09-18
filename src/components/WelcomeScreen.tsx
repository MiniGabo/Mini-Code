// Welcome screen.
import { FolderPlus, FolderOpen, FileCode2, Coffee } from "lucide-react";
import { useT } from "../stores/settingsStore";

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
  // Received for compat (not rendered today: no recents list)
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
  const t = useT();
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden bg-[var(--mc-bg)]">
      <div className="flex w-full max-w-[320px] flex-col items-center px-6 text-center">
        {/* Large logo, no background */}
        <Coffee size={56} strokeWidth={1.4} className="text-[var(--mc-accent-strong)]" />
        <h1 className="mt-4 text-4xl font-semibold text-graphite-100">Mini Code</h1>

        {/* 3 main actions with shortcut on the side */}
        <div className="mt-10 w-full">
          <StartAction
            icon={FolderPlus}
            label={t("welcome.newFolder")}
            shortcut={isMac ? ["⌘", "N"] : ["Ctrl", "N"]}
            onClick={onNewFolder}
          />
          <StartAction
            icon={FileCode2}
            label={t("welcome.openFile")}
            shortcut={isMac ? ["⌘", "O"] : ["Ctrl", "O"]}
            onClick={onOpenFile}
          />
          <StartAction
            icon={FolderOpen}
            label={t("welcome.openFolder")}
            shortcut={isMac ? ["⌘", "⇧", "O"] : ["Ctrl", "Shift", "O"]}
            onClick={onOpenFolder}
          />
        </div>

        {/* New folder name (only when a location was picked) */}
        {pendingParent && (
          <div className="mt-4 w-full rounded-lg border border-ember-500/40 bg-graphite-850 p-3 text-left">
            <p className="truncate text-[11px] text-graphite-500" title={pendingParent}>
              {t("welcome.createIn")} {pendingParent}
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
                placeholder={t("welcome.folderPlaceholder")}
                className="min-w-0 flex-1 rounded border border-graphite-600 bg-graphite-800 px-2 py-1.5 text-[13px] text-graphite-100 outline-none focus:border-ember-500/60"
              />
              <button
                onClick={onConfirmNewFolder}
                className="shrink-0 rounded bg-ember-500/15 px-3 py-1.5 text-[13px] text-ember-400 hover:bg-ember-500/25"
              >
                {t("welcome.create")}
              </button>
            </div>
            <button
              onClick={onCancelNewFolder}
              className="mt-1.5 text-[11px] text-graphite-500 hover:text-graphite-300"
            >
              {t("welcome.cancelEsc")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
