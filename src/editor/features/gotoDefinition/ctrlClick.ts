// Gesto Ctrl+Click a definición:
//  - Ctrl+hover subraya el símbolo (clase o método) con cursor pointer.
//  - Solo el click (pulsar Y soltar sobre el mismo símbolo) navega.
//  - Destino local: navega en el modelo; otro archivo: lo abre App y el
//    pendingReveal lo coloca al montar; dependencias: pestaña virtual con
//    progreso (openDecompiledPending -> resolveExternal -> fulfill).
import { resolveDefinitionForClick, navigableSymbolAt } from "../navigation/definition";
import { flashTarget } from "../navigation/reveal";
import { buildExternalQuery } from "../../../languages/java/externalQuery";
import { openDecompiledPending, fulfillDecompiled } from "../navigation/bridges";
import { contextDirOfFsPath } from "../../../services/files/paths";

/** Celda compartida del destello: el feature y el reveal pendiente usan la
 *  misma (saltar cancela el destello anterior, como antes con `disposeFlash`). */
export interface FlashCell {
  current: () => void;
}

export interface CtrlClickHandle {
  dispose: () => void;
}

export function createCtrlClickHandler(
  monaco: any,
  editor: any,
  container: HTMLElement | null,
  language: string,
  flash: FlashCell
): CtrlClickHandle {
  let ctrlDecor: string[] = [];
  // mousedown con Ctrl: { lineNumber, startColumn, endColumn }
  let downInfo: { lineNumber: number; startColumn: number; endColumn: number } | null = null;

  const clearCtrlDecor = () => {
    if (ctrlDecor.length > 0) {
      try {
        ctrlDecor = editor.deltaDecorations(ctrlDecor, []);
      } catch {
        ctrlDecor = [];
      }
    }
    if (container) container.classList.remove("ctrl-goto-active");
  };

  const mouseMoveDisp = editor.onMouseMove((e: any) => {
    const ev = e.event;
    if (!(ev.ctrlKey || ev.metaKey) || language !== "java") {
      clearCtrlDecor();
      return;
    }
    const pos = e.target?.position;
    const m = editor.getModel();
    if (!pos || !m) {
      clearCtrlDecor();
      return;
    }
    let name: any = null;
    try {
      name = navigableSymbolAt(monaco, m, pos);
    } catch {
      name = null;
    }
    if (!name) {
      clearCtrlDecor();
      return;
    }
    let word: any = null;
    try {
      word = m.getWordAtPosition(pos);
    } catch {
      word = null;
    }
    if (!word) {
      clearCtrlDecor();
      return;
    }
    try {
      ctrlDecor = editor.deltaDecorations(ctrlDecor, [
        {
          range: {
            startLineNumber: pos.lineNumber,
            startColumn: word.startColumn,
            endLineNumber: pos.lineNumber,
            endColumn: word.endColumn,
          },
          options: { inlineClassName: "ctrl-goto-hover" },
        },
      ]);
    } catch {
      // decoración best-effort
    }
    if (container) container.classList.add("ctrl-goto-active");
  });

  const mouseLeaveDisp = editor.onMouseLeave(() => {
    downInfo = null;
    clearCtrlDecor();
  });

  const mouseDownDisp = editor.onMouseDown((e: any) => {
    downInfo = null;
    const ev = e.event;
    if ((ev.ctrlKey || ev.metaKey) && (ev.button ?? 0) === 0 && e.target?.position && language === "java") {
      const pos = e.target.position;
      const m = editor.getModel();
      if (!m) return;
      let name: any = null;
      try {
        name = navigableSymbolAt(monaco, m, pos);
      } catch {
        name = null;
      }
      if (!name) return;
      let word: any = null;
      try {
        word = m.getWordAtPosition(pos);
      } catch {
        word = null;
      }
      if (!word) return;
      downInfo = { lineNumber: pos.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
    }
  });

  const mouseUpDisp = editor.onMouseUp((e: any) => {
    const info = downInfo;
    downInfo = null;
    if (!info) return;
    const ev = e.event;
    // Click completo: se suelta con Ctrl sobre el mismo símbolo donde se pulsó
    if (!(ev.ctrlKey || ev.metaKey) || (ev.button ?? 0) !== 0 || !e.target?.position) return;
    const pos = e.target.position;
    if (pos.lineNumber !== info.lineNumber || pos.column < info.startColumn || pos.column > info.endColumn + 1) return;
    const m = editor.getModel();
    if (!m || language !== "java") return;
    const clickPos = {
      lineNumber: pos.lineNumber,
      column: Math.min(Math.max(pos.column, info.startColumn), info.endColumn),
    };
    clearCtrlDecor();
    let clickedName: any = null;
    try {
      clickedName = navigableSymbolAt(monaco, m, clickPos);
    } catch {
      clickedName = null;
    }
    resolveDefinitionForClick(monaco, m, clickPos)
      .then(async (locs: any) => {
        if (locs && locs.length > 0) {
          const target = locs[0];
          // Solo navegar a mano si el destino está en ESTE modelo; si se
          // abrió otra pestaña, el pendingReveal la coloca al montar.
          try {
            if (target.uri.toString() !== m.uri.toString()) return;
          } catch {
            return;
          }
          editor.setPosition({
            lineNumber: target.range.startLineNumber,
            column: target.range.startColumn,
          });
          editor.revealPositionInCenter({
            lineNumber: target.range.startLineNumber,
            column: target.range.startColumn,
          });
          editor.focus();
          // Destello sobre el nombre declarado
          try {
            flash.current();
          } catch {
            // sin destello previo
          }
          flash.current = flashTarget(monaco, editor, {
            lineNumber: target.range.startLineNumber,
            column: target.range.startColumn,
            symbol: clickedName,
          });
          return;
        }
        // Sin definición local: dependencias (JDK/jars). El servidor no
        // las resuelve; el FQN se reconstruye con los imports. La pestaña
        // se abre DE INMEDIATO en estado de carga (con su progreso) y el
        // contenido llega después.
        let ext: any = null;
        try {
          ext = buildExternalQuery(m, clickPos);
        } catch {
          ext = null;
        }
        if (!ext || !ext.candidates || ext.candidates.length === 0) return;
        const token = ext.candidates[0];
        const simple = token.split(".").pop() ?? clickedName ?? "Clase";
        // Directorio del archivo actual: el main busca ahí el pom.xml o
        // build.gradle más cercano para usar SUS dependencias declaradas.
        let contextDir: string | null = null;
        try {
          if (m.uri.scheme === "file" && m.uri.fsPath) {
            contextDir = contextDirOfFsPath(m.uri.fsPath);
          }
        } catch {
          contextDir = null;
        }
        let pending: any = null;
        try {
          pending = openDecompiledPending({ token, name: simple + ".java" });
        } catch {
          pending = null;
        }
        if (!pending) return;
        let res: any = null;
        try {
          res = await window.electronAPI?.resolveExternal({ ...ext, token, contextDir });
        } catch {
          res = null;
        }
        let done: any = null;
        try {
          done = fulfillDecompiled(pending.id, res ?? { ok: false, error: "Error al resolver el símbolo" });
        } catch {
          return;
        }
        // Si el editor sigue montado sobre ese URI (pestaña ya lista),
        // navegar a mano; si hay (re)montaje, el pendiente lo coloca.
        if (!done || !done.uri || !res || !res.ok) return;
        try {
          const cur = editor.getModel();
          if (cur && cur.uri.toString() === done.uri) {
            editor.setPosition({ lineNumber: res.line, column: res.column });
            editor.revealPositionInCenter({ lineNumber: res.line, column: res.column });
            editor.focus();
            try {
              flash.current();
            } catch {
              // sin destello previo
            }
            flash.current = flashTarget(monaco, editor, {
              lineNumber: res.line,
              column: res.column,
              symbol: res.symbol,
            });
          }
        } catch {
          // editor ya liberado
        }
      })
      .catch(() => {
        // sin definición disponible
      });
  });

  const onKeyUpClear = (e: KeyboardEvent) => {
    if (e.key === "Control" || e.key === "Meta" || (!e.ctrlKey && !e.metaKey)) {
      clearCtrlDecor();
    }
  };
  const onBlurClear = () => {
    downInfo = null;
    clearCtrlDecor();
  };
  window.addEventListener("keyup", onKeyUpClear);
  window.addEventListener("blur", onBlurClear);

  return {
    dispose: () => {
      try {
        mouseMoveDisp.dispose();
      } catch {
        // ya liberado
      }
      try {
        mouseLeaveDisp.dispose();
      } catch {
        // ya liberado
      }
      try {
        mouseDownDisp.dispose();
      } catch {
        // ya liberado
      }
      try {
        mouseUpDisp.dispose();
      } catch {
        // ya liberado
      }
      window.removeEventListener("keyup", onKeyUpClear);
      window.removeEventListener("blur", onBlurClear);
      try {
        clearCtrlDecor();
      } catch {
        // editor ya liberado
      }
    },
  };
}
