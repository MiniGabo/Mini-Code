// Barra de título propia (ventana frameless).
import { useEffect, useState } from "react";
import { Coffee, Minus, Square, Copy, X } from "lucide-react";
import type { LspStatus } from "../types";

const api = () => (typeof window !== "undefined" ? window.electronAPI : undefined);

export default function TitleBar({ lspStatus }: { lspStatus: LspStatus }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const electron = api();
    if (!electron?.isMaximized) return;
    electron.isMaximized().then(setMaximized).catch(() => {});
    const off = electron.onMaximizeChange?.(setMaximized);
    return () => off?.();
  }, []);

  const btn =
    "flex h-full w-11 items-center justify-center text-graphite-400 hover:bg-graphite-800 hover:text-graphite-100";

  return (
    <div
      className="titlebar-drag flex h-8 shrink-0 select-none items-center bg-graphite-950"
      onDoubleClick={() => api()?.toggleMaximize?.()}
    >
      <div className="flex items-center gap-1.5 px-2.5">
        <Coffee size={13} className="text-ember-500" />
        <span className="text-[12px] text-graphite-400">Mini Code</span>
      </div>

      <div className="flex-1" />

      {lspStatus && lspStatus !== "off" && (
        <div
          className="titlebar-no-drag mr-2 flex items-center gap-1.5 rounded-full border border-graphite-800 bg-graphite-900 px-2.5 py-1"
          title={
            lspStatus === "ready"
              ? "IntelliSense Java listo"
              : lspStatus === "error"
                ? "IntelliSense no disponible (¿java en el PATH?)"
                : lspStatus === "starting"
                  ? "Iniciando servidor Java…"
                  : "Indexando proyecto Java…"
          }
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              lspStatus === "ready"
                ? "bg-green-400"
                : lspStatus === "error"
                  ? "bg-red-400"
                  : "animate-pulse bg-ember-400"
            }`}
          />
          <span className="text-[11px] text-graphite-400">
            {lspStatus === "ready"
              ? "Java listo"
              : lspStatus === "error"
                ? "Java no disponible"
                : lspStatus === "starting"
                  ? "Iniciando Java…"
                  : "Indexando…"}
          </span>
        </div>
      )}

      <div className="titlebar-no-drag flex h-full items-stretch" onDoubleClick={(e) => e.stopPropagation()}>
        <button className={btn} title="Minimizar" onClick={() => api()?.minimizeWindow?.()}>
          <Minus size={14} />
        </button>
        <button
          className={btn}
          title={maximized ? "Restaurar" : "Maximizar"}
          onClick={() => api()?.toggleMaximize?.()}
        >
          {maximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button
          className={`${btn} hover:!bg-[#e81123] hover:!text-white`}
          title="Cerrar"
          onClick={() => api()?.closeWindow?.()}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
