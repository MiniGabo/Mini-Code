// Pending jump + target flash.
import { getPendingReveal, setPendingReveal } from "./bridges";
// Called by EditorPane on mount: if there is a pending jump for this
// model, it places the cursor over the name, centers it and shows the
// flash. Only consumes the pending jump if it is for this file (peek without
// consuming if another one mounted first). Returns { target, symbol, dispose }
// or null if there was no pending jump for this model.
function consumePendingReveal(monaco: any, editor: any) {
  const current = getPendingReveal();
  if (!current) return null;
  const model = editor.getModel();
  if (!model) return null;
  if (current.uri) {
    // Virtual tab: match by exact URI
    try {
      if (model.uri.toString() !== current.uri) return null;
    } catch {
      return null;
    }
  } else {
    let fs = null;
    try {
      fs = model.uri.fsPath.toLowerCase();
    } catch {
      return null;
    }
    if (fs !== current.fs) return null;
  }
  const pending = current;
  setPendingReveal(null);
  const target = { lineNumber: pending.lineNumber, column: pending.column };
  try {
    editor.setPosition(target);
    editor.revealPositionInCenter(target);
  } catch {
    return null;
  }
  const dispose = flashTarget(monaco, editor, { ...target, symbol: pending.symbol });
  return { target, symbol: pending.symbol, dispose };
}

// Jump target flash: highlights the line and
// shows a floating label with the name for a few moments.
// Returns a cleanup function (also used on unmount).
function flashTarget(monaco: any, editor: any, { lineNumber, column, symbol }: any) {
  const cleanups: Array<() => void> = [];
  try {
    let maxColumn = 1;
    try {
      maxColumn = editor.getModel()?.getLineMaxColumn(lineNumber) ?? 1;
    } catch {
      maxColumn = 1;
    }
    const ids = editor.deltaDecorations(
      [],
      [
        {
          range: {
            startLineNumber: lineNumber,
            startColumn: 1,
            endLineNumber: lineNumber,
            endColumn: maxColumn,
          },
          options: { className: "goto-flash-line", description: "goto-flash" },
        },
      ]
    );
    cleanups.push(() => {
      try {
        editor.deltaDecorations(ids, []);
      } catch {
        // editor already disposed
      }
    });
  } catch {
    // best-effort decoration
  }
  if (symbol) {
    try {
      const node = document.createElement("div");
      node.className = "goto-flash-widget";
      node.textContent = symbol;
      const widget = {
        getId: () => "mini-code.goto-flash",
        getDomNode: () => node,
        getPosition: () => ({
          position: { lineNumber, column },
          preference: [
            monaco.editor.ContentWidgetPositionPreference.ABOVE,
            monaco.editor.ContentWidgetPositionPreference.BELOW,
          ],
        }),
      };
      editor.addContentWidget(widget);
      cleanups.push(() => {
        try {
          editor.removeContentWidget(widget);
        } catch {
          // editor already disposed
        }
      });
    } catch {
      // best-effort widget
    }
  }
  const dispose = () => {
    clearTimeout(timer);
    for (const fn of cleanups) {
      try {
        fn();
      } catch {
        // best-effort cleanup
      }
    }
  };
  const timer = setTimeout(dispose, 1200);
  return dispose;
}

export { consumePendingReveal, flashTarget };
