// Update banner: shown when latest.yml announces a newer version.
// Lets the user download the installer with progress, install it, or open the release.
import { Download, ExternalLink, X, RefreshCw, CheckCircle2 } from "lucide-react";
import { useUpdaterStore } from "../stores/updaterStore";
import { useT } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";

function formatBytes(n: number | null | undefined): string {
  if (!n || !Number.isFinite(n) || n <= 0) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UpdateBanner() {
  const t = useT();
  const status = useUpdaterStore((s) => s.status);
  const downloading = useUpdaterStore((s) => s.downloading);
  const progress = useUpdaterStore((s) => s.progress);
  const dismiss = useUpdaterStore((s) => s.dismiss);
  const download = useUpdaterStore((s) => s.download);
  const notifyError = useUiStore((s) => s.notifyError);

  if (!status?.updateAvailable || !status.latestVersion) return null;

  const downloaded = progress?.status === "downloaded";
  const failed = progress?.status === "error";
  const pct = typeof progress?.percent === "number" ? Math.round(progress.percent) : null;

  const openRelease = async () => {
    try {
      const res = await window.electronAPI?.openReleasePage?.();
      if (res && !res.ok) notifyError(res.error ?? t("update.openFailed"));
    } catch {
      notifyError(t("update.openFailed"));
    }
  };

  const install = async () => {
    try {
      const res = await window.electronAPI?.quitAndInstall?.();
      if (res && !res.ok) notifyError(res.error ?? t("update.installFailed"));
    } catch {
      notifyError(t("update.installFailed"));
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-ember-500/30 bg-ember-500/10 px-3 py-2">
      <Download size={14} className="shrink-0 text-ember-400" />
      <p className="min-w-0 flex-1 truncate text-[12.5px] text-graphite-100">
        {t("update.available", { version: status.latestVersion })}
        {status.size ? (
          <span className="ml-1.5 text-graphite-400">({formatBytes(status.size)})</span>
        ) : null}
        {failed && progress?.error ? (
          <span className="ml-1.5 text-red-400">{progress.error}</span>
        ) : null}
      </p>

      {downloading ? (
        <div className="flex shrink-0 items-center gap-2">
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-graphite-700">
            {pct !== null ? (
              <div className="h-full rounded-full bg-ember-400 transition-all" style={{ width: `${pct}%` }} />
            ) : (
              <div className="h-full w-1/2 animate-pulse rounded-full bg-ember-400" />
            )}
          </div>
          <span className="text-[11.5px] text-graphite-300">
            {pct !== null ? `${pct}%` : t("update.downloading")}
          </span>
        </div>
      ) : downloaded ? (
        <button
          onClick={() => void install()}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-ember-500 px-2.5 py-1 text-[12px] font-medium text-graphite-950 hover:bg-ember-400"
        >
          <CheckCircle2 size={13} />
          {t("update.installAndRestart")}
        </button>
      ) : (
        <button
          onClick={() => void download()}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-ember-500 px-2.5 py-1 text-[12px] font-medium text-graphite-950 hover:bg-ember-400"
        >
          <RefreshCw size={13} />
          {t("update.download")}
        </button>
      )}

      {!downloading && !downloaded ? (
        <button
          onClick={() => void openRelease()}
          title={t("update.viewRelease")}
          className="flex shrink-0 items-center gap-1 rounded-md border border-graphite-600 px-2 py-1 text-[12px] text-graphite-200 hover:bg-graphite-700"
        >
          <ExternalLink size={12} />
        </button>
      ) : null}

      <button
        onClick={dismiss}
        title={t("update.dismiss")}
        className="shrink-0 rounded p-1 text-graphite-500 hover:bg-graphite-700 hover:text-graphite-200"
      >
        <X size={13} />
      </button>
    </div>
  );
}
