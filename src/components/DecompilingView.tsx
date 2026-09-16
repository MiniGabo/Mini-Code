// External symbol loading view: the tab opens immediately and
// shows progress (search, extraction, decompilation) until the
// content arrives; on failure, it shows the error.
import { AlertTriangle, Loader2, FileCode2 } from "lucide-react";
import type { OpenFile } from "../types";
import { useT } from "../stores/settingsStore";

export default function DecompilingView({ file }: { file: OpenFile }) {
  const t = useT();
  if (file.loadError) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-graphite-950 px-8 text-center">
        <AlertTriangle size={28} className="text-red-400" />
        <p className="text-[14px] font-medium text-graphite-100">{file.name}</p>
        <p className="max-w-md text-[12.5px] leading-relaxed text-graphite-400">
          {file.loadError}
        </p>
        <p className="text-[11.5px] text-graphite-500">
          {t("decompiling.retryHint")}
        </p>
      </div>
    );
  }
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-graphite-950 px-8 text-center">
      <FileCode2 size={28} className="text-ember-400" />
      <p className="font-mono text-[14px] text-graphite-100">{file.name}</p>
      <div className="flex items-center gap-2 text-[12.5px] text-graphite-400">
        <Loader2 size={14} className="animate-spin text-ember-400" />
        <span>{file.progress ?? t("decompiling.resolving")}</span>
      </div>
      <div className="h-1 w-56 overflow-hidden rounded-full bg-graphite-800">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-ember-500" />
      </div>
    </div>
  );
}
