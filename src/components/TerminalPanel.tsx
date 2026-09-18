// Integrated terminal panel (Option B: real interactive PTY).
// Hidden unless terminalVisible (Alt+T). Bottom overlay inside the editor
// area so it never disturbs the layout. The frontend is xterm.js; the shell
// itself is a single persistent session in the main process (see
// electron/ipc/terminalIpc.cjs): showing/hiding only attaches/detaches, so
// toggling never spawns processes and never leaks them.
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { RotateCcw, Skull, Terminal as TerminalIcon, X } from "lucide-react";
import { useSettingsStore, useT } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import { getRegistryVersion, getTerminalTheme, subscribeRegistryChange } from "../extensions/themes/themeService";
import { useSyncExternalStore } from "react";

/** Full xterm palette for the active theme (terminal.* colors, ui fallback). */
function xtermThemeFor(themeId: string): Record<string, string> {
  try {
    return getTerminalTheme(themeId);
  } catch {
    return getTerminalTheme("mini-code-dark");
  }
}

export default function TerminalPanel({ rootPath }: { rootPath: string | null }) {
  const t = useT();
  const setTerminalVisible = useUiStore((s) => s.setTerminalVisible);
  const restartNonce = useUiStore((s) => s.terminalRestartNonce);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const aliveRef = useRef(true);
  const restartingRef = useRef(false);
  const lastRestartSeenRef = useRef(restartNonce);
  const cwdRef = useRef<string | null>(rootPath);
  cwdRef.current = rootPath;
  const [dead, setDead] = useState(false);
  const [spawnError, setSpawnError] = useState<string | null>(null);
  // Bumping this re-attaches the frontend (restart button). The effect below
  // only depends on it so opening another project never kills a running shell.
  const [nonce, setNonce] = useState(0);

  const close = () => setTerminalVisible(false);

  const activeTheme = useSettingsStore((s) => s.theme);
  const themeRegistryVersion = useSyncExternalStore(subscribeRegistryChange, getRegistryVersion);

  // Terminal palette follows the active theme live. Deferred to rAF so App's
  // :root injection (parent effect, same commit) lands first.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const term = termRef.current;
      if (!term || !aliveRef.current) return;
      try {
        term.options.theme = xtermThemeFor(activeTheme);
      } catch {
        // best-effort
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTheme, themeRegistryVersion]);

  // Kill the persistent shell and re-attach to a fresh one. Closing the panel
  // (X / Alt+T / Esc) only hides it and never calls this.
  const doRestart = useCallback(() => {
    if (restartingRef.current) return;
    restartingRef.current = true;
    void (async () => {
      try {
        await window.electronAPI?.terminalCloseAll().catch(() => {});
      } catch {
        // no bridge: re-attach below will report it
      }
      if (!aliveRef.current) {
        restartingRef.current = false;
        return;
      }
      setDead(false);
      setSpawnError(null);
      useUiStore.getState().setTerminalVisible(true);
      setNonce((n) => n + 1);
      restartingRef.current = false;
    })();
  }, []);

  // Alt+R from anywhere (command) arrives as a store signal.
  useEffect(() => {
    if (restartNonce === lastRestartSeenRef.current) return;
    lastRestartSeenRef.current = restartNonce;
    doRestart();
  }, [restartNonce, doRestart]);

  const doKill = useCallback(() => {
    void window.electronAPI?.terminalCloseAll().catch(() => {});
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    const container = containerRef.current;
    if (!container) return;
    const bridge = window.electronAPI;
    if (!bridge) {
      setSpawnError("terminal.noBridge");
      return;
    }

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 12.5,
      // Bounded scrollback: an unbounded buffer grows the DOM (and memory)
      // without limit on long-running output.
      scrollback: 500,
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
      theme: xtermThemeFor(useSettingsStore.getState().theme),
    });
    // The terminal owns Alt+T/R/K as UI shortcuts: xterm would otherwise
    // swallow them as meta keys (sending ESC+letter to the shell), so the
    // global window shortcuts never fire while the terminal has focus.
    // Intercept them here and act directly; stopPropagation keeps the global
    // handlers from firing a second time. Repeats (e.repeat) of the keystroke
    // that opened the panel are swallowed without acting: without this,
    // holding Alt+T half a second closes the just-opened panel via the OS
    // key auto-repeat (~500ms delay on Windows). Rapid re-toggles are further
    // throttled inside toggleTerminal itself.
    term.attachCustomKeyEventHandler((e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "t" || k === "r" || k === "k") {
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) {
            const ui = useUiStore.getState();
            if (k === "t") ui.toggleTerminal();
            else if (k === "r") doRestart();
            else void window.electronAPI?.terminalCloseAll().catch(() => {});
          }
          return false;
        }
      }
      return true;
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;

    let sessionId: number | null = null;
    let dataDisposable: { dispose(): void } | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const fitAndResize = () => {
      if (!aliveRef.current || sessionId === null) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      const dims = fit.proposeDimensions();
      if (dims && dims.cols > 0 && dims.rows > 0) {
        void bridge.terminalResize(sessionId, dims.cols, dims.rows).catch(() => {});
      }
    };

    const offData = bridge.onTerminalData?.(({ id, data }) => {
      if (id !== sessionId || !aliveRef.current) return;
      term.write(data);
    });
    const offExit = bridge.onTerminalExit?.(({ id, exitCode }) => {
      if (id !== sessionId || !aliveRef.current) return;
      sessionId = null;
      setDead(true);
      term.write(`\r\n\x1b[90m${t("terminal.exited", { code: exitCode })}\x1b[m\r\n`);
    });

    // Attach after first layout so proposeDimensions() has a real size.
    requestAnimationFrame(() => {
      if (!aliveRef.current) return;
      let dims: { cols: number; rows: number } | undefined;
      try {
        fit.fit();
        dims = fit.proposeDimensions() ?? undefined;
      } catch {
        dims = undefined;
      }
      bridge
        .terminalOpen({ cwd: cwdRef.current, cols: dims?.cols ?? 80, rows: dims?.rows ?? 24 })
        .then((res) => {
          if (!aliveRef.current) {
            // Unmounted while opening: detach again so a hidden session
            // doesn't stream output to nobody.
            if (res.ok && res.id != null) void bridge.terminalPause(res.id).catch(() => {});
            return;
          }
          if (!res.ok || res.id == null) {
            setSpawnError(res.error ?? "terminal.spawnFailed");
            return;
          }
          sessionId = res.id;
          dataDisposable = term.onData((data) => {
            void bridge.terminalWrite(res.id!, data).catch(() => {});
          });
          term.focus();
          fitAndResize();
          if (res.reused) {
            // Fresh screen for the re-attached frontend; Ctrl+L repaints
            // without touching the current input line (PSReadLine/readline).
            void bridge.terminalWrite(res.id, "\x0c").catch(() => {});
          }
        })
        .catch((err) => {
          if (aliveRef.current) setSpawnError(String((err as Error)?.message ?? err));
        });
    });

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => fitAndResize());
      resizeObserver.observe(container);
    }

    return () => {
      aliveRef.current = false;
      offData?.();
      offExit?.();
      resizeObserver?.disconnect();
      dataDisposable?.dispose();
      // Detach only: pause the session so background output doesn't burn
      // IPC/CPU while hidden. The shell stays alive for the next open.
      const id = sessionId;
      sessionId = null;
      if (id !== null) void bridge.terminalPause(id).catch(() => {});
      try {
        term.dispose();
      } catch {
        // best-effort
      }
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const onWrapperKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-30 flex h-64 flex-col border-t border-[var(--mc-border)] bg-[var(--mc-panel)] shadow-2xl">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--mc-border)] px-3 select-none">
        <TerminalIcon size={14} className="text-[var(--mc-accent)]" />
        <span className="text-[12px] font-medium text-graphite-200">{t("terminal.title")}</span>
        <span className="ml-auto text-[11px] text-graphite-500">Alt+T</span>
        <button
          onClick={doRestart}
          title={t("terminal.restart")}
          className="rounded p-1 text-graphite-400 hover:bg-graphite-700 hover:text-graphite-100"
        >
          <RotateCcw size={13} />
        </button>
        <button
          onClick={doKill}
          title={t("terminal.kill")}
          className="rounded p-1 text-graphite-400 hover:bg-graphite-700 hover:text-red-400"
        >
          <Skull size={13} />
        </button>
        <button
          onClick={close}
          title={t("terminal.close")}
          className="rounded p-1 text-graphite-400 hover:bg-graphite-700 hover:text-graphite-100"
        >
          <X size={13} />
        </button>
      </div>
      <div
        ref={containerRef}
        onKeyDown={onWrapperKeyDown}
        onClick={() => termRef.current?.focus()}
        className="min-h-0 flex-1 overflow-hidden px-2 py-1"
      />
      {(dead || spawnError) && (
        <div className="flex shrink-0 items-center gap-2 border-t border-[var(--mc-border)] px-3 py-1.5 text-[12px]">
          <span className={spawnError ? "text-red-400" : "text-graphite-400"}>
            {spawnError ?? t("terminal.exitedHint")}
          </span>
          <button
            onClick={doRestart}
            className="ml-auto rounded-md border border-graphite-600 px-2 py-0.5 text-[12px] text-graphite-200 hover:bg-graphite-700"
          >
            {t("terminal.restart")}
          </button>
        </div>
      )}
    </div>
  );
}
