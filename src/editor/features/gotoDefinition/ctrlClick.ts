// Ctrl+Click to definition gesture:
//  - Ctrl+hover underlines the symbol (class or method) with a pointer cursor.
//  - Only the click (press AND release over the same symbol) navigates.
//  - Local target: navigates in the model; other file: App opens it and
//    pendingReveal positions it on mount; dependencies: virtual tab with
//    progress (openDecompiledPending -> resolveExternal -> fulfill).
import { resolveDefinitionForClick, navigableSymbolAt } from "../navigation/definition";
import { flashTarget } from "../navigation/reveal";
import { buildExternalQuery } from "../../../languages/java/externalQuery";
import { openDecompiledPending, fulfillDecompiled } from "../navigation/bridges";
import { contextDirOfFsPath } from "../../../services/files/paths";
import { t } from "../../../stores/settingsStore";

/** Shared flash cell: the feature and the pending reveal use the
 *  same one (jumping cancels the previous flash, as before with `disposeFlash`). */
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
  // Ctrl mousedown: { lineNumber, startColumn, endColumn }
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
      // best-effort decoration
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
    // Complete click: released with Ctrl over the same symbol where it was pressed
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
          // Only navigate manually if the target is in THIS model; if
          // another tab was opened, pendingReveal positions it on mount.
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
          // Flash over the declared name
          try {
            flash.current();
          } catch {
            // no previous flash
          }
          flash.current = flashTarget(monaco, editor, {
            lineNumber: target.range.startLineNumber,
            column: target.range.startColumn,
            symbol: clickedName,
          });
          return;
        }
        // No local definition: dependencies (JDK/jars). The server does not
        // resolve them; the FQN is rebuilt from the imports. The tab
        // opens IMMEDIATELY in a loading state (with its progress) and the
        // content arrives later.
        let ext: any = null;
        try {
          ext = buildExternalQuery(m, clickPos);
        } catch {
          ext = null;
        }
        if (!ext || !ext.candidates || ext.candidates.length === 0) return;
        const token = ext.candidates[0];
        const simple = token.split(".").pop() ?? clickedName ?? t("external.unknownClass");
        // Directory of the current file: main looks there for the closest pom.xml or
        // build.gradle to use ITS declared dependencies.
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
          done = fulfillDecompiled(pending.id, res ?? { ok: false, error: t("external.resolveFailed") });
        } catch {
          return;
        }
        // If the editor is still mounted over that URI (tab already ready),
        // navigate manually; on (re)mount, the pending one positions it.
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
              // no previous flash
            }
            flash.current = flashTarget(monaco, editor, {
              lineNumber: res.line,
              column: res.column,
              symbol: res.symbol,
            });
          }
        } catch {
          // editor already disposed
        }
      })
      .catch(() => {
        // no definition available
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
        // already disposed
      }
      try {
        mouseLeaveDisp.dispose();
      } catch {
        // already disposed
      }
      try {
        mouseDownDisp.dispose();
      } catch {
        // already disposed
      }
      try {
        mouseUpDisp.dispose();
      } catch {
        // already disposed
      }
      window.removeEventListener("keyup", onKeyUpClear);
      window.removeEventListener("blur", onBlurClear);
      try {
        clearCtrlDecor();
      } catch {
        // editor already disposed
      }
    },
  };
}
