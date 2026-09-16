// Open file tabs.
import { X, Lock, Loader2, Settings } from "lucide-react";
import FileIcon from "./FileIcon";
import { fileKeyOf } from "../services/files/paths";
import type { OpenFile, FileKey } from "../types";
import { useT } from "../stores/settingsStore";

export interface TabBarProps {
  files: OpenFile[];
  activeKey: FileKey | null;
  onSelect: (key: FileKey) => void;
  onClose: (key: FileKey) => void;
  fileErrors?: Record<string, number>;
}

export default function TabBar({ files, activeKey, onSelect, onClose, fileErrors }: TabBarProps) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-1 items-stretch gap-px overflow-x-auto">
      {files.map((f) => {
        const key = fileKeyOf(f);
        const isActive = key === activeKey;
        const dirty = f.content !== f.savedContent;
        const errCount = f.path ? (fileErrors?.[f.path.toLowerCase()] ?? 0) : 0;
        return (
          <div
            key={key}
            onClick={() => onSelect(key)}
            className={`group flex min-w-0 max-w-48 cursor-pointer items-center gap-1.5 border-r border-graphite-800 px-3 text-[12px] ${
              isActive
                ? "bg-graphite-950 text-graphite-100"
                : "text-graphite-400 hover:bg-graphite-850 hover:text-graphite-200"
            }${errCount > 0 ? " !bg-red-500/10" : ""}`}
            title={
              f.readOnly
                ? `${f.name} (${t("tabbar.readOnly")}${f.originLabel ? ` · ${f.originLabel}` : ""})`
                : (f.path ?? f.name)
            }
          >
            {f.id === "settings" ? (
              <Settings size={13} className="shrink-0 text-graphite-400" />
            ) : (
              <FileIcon name={f.name} size={13} className="shrink-0" />
            )}
            <span className="truncate">{f.name}</span>
            {f.readOnly && !f.loading && f.id !== "settings" && (
              <span title={t("tabbar.readOnly")} className="contents">
                <Lock size={11} className="shrink-0 text-graphite-500" />
              </span>
            )}
            {f.loading && (
              <span title={t("tabbar.loading")} className="contents">
                <Loader2 size={11} className="shrink-0 animate-spin text-ember-400" />
              </span>
            )}
            {errCount > 0 && (
              <span
                className="shrink-0 rounded-full bg-red-500/20 px-1.5 text-[11px] font-medium text-red-400"
                title={t(errCount === 1 ? "tabbar.error_one" : "tabbar.error_other", { count: errCount })}
              >
                {errCount}
              </span>
            )}
            <span className="flex w-4 shrink-0 items-center justify-center">
              {dirty ? (
                <>
                  <span
                    className="h-2 w-2 rounded-full bg-ember-400 group-hover:hidden"
                    title={t("tabbar.unsaved")}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose(key);
                    }}
                    className="hidden rounded p-0.5 hover:bg-graphite-700 hover:text-graphite-100 group-hover:block"
                    title={t("tabbar.close")}
                  >
                    <X size={12} />
                  </button>
                </>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(key);
                  }}
                    className={`rounded p-0.5 hover:bg-graphite-700 hover:text-graphite-100 ${
                      isActive ? "" : "hidden group-hover:block"
                    }`}
                    title={t("tabbar.close")}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
