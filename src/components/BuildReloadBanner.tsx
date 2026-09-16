// Bottom banner: shown when saving pom.xml / build.gradle[.kts] to
// reload the project (restarts the Java LSP with the new dependencies).
import { RefreshCw, X, FileWarning } from "lucide-react";
import { useT } from "../stores/settingsStore";

interface BuildReloadBannerProps {
  fileName: string;
  reloading: boolean;
  onReload: () => void;
  onDismiss: () => void;
}

export default function BuildReloadBanner({
  fileName,
  reloading,
  onReload,
  onDismiss,
}: BuildReloadBannerProps) {
  const t = useT();
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-end pb-3 pr-3">
      <div className="banner-in pointer-events-auto flex max-w-[min(560px,90%)] items-center gap-3 rounded-lg border border-ember-500/40 bg-graphite-800/95 px-3.5 py-2.5 shadow-2xl backdrop-blur">
        <FileWarning size={16} className="shrink-0 text-ember-400" />
        <p className="flex-1 text-[12.5px] leading-snug text-graphite-100">
          <span className="font-medium">{fileName}</span>{" "}{t("build.bannerChanged")}
        </p>
        <button
          onClick={onReload}
          disabled={reloading}
          title={t("build.reloadTitle")}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-ember-500 px-3 py-1.5 text-[12.5px] font-medium text-graphite-950 hover:bg-ember-400 disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw size={13} className={reloading ? "animate-spin" : ""} />
          {reloading ? t("build.reloading") : t("build.reload")}
        </button>
        <button
          onClick={onDismiss}
          disabled={reloading}
          title={t("build.dismiss")}
          className="shrink-0 rounded p-1 text-graphite-500 hover:bg-graphite-700 hover:text-graphite-200 disabled:opacity-50"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
