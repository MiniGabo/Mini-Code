// Salto pendiente + destello del destino.
import { getPendingReveal, setPendingReveal } from "./bridges";
// Lo llama EditorPane al montar: si hay un salto pendiente para este
// modelo, coloca el cursor sobre el nombre, lo centra y muestra el
// destello. Solo consume el pendiente si es para este archivo (mirar sin
// consumir si otro se montó antes). Devuelve { target, symbol, dispose }
// o null si no había pendiente para este modelo.
function consumePendingReveal(monaco: any, editor: any) {
  const current = getPendingReveal();
  if (!current) return null;
  const model = editor.getModel();
  if (!model) return null;
  if (current.uri) {
    // Pestaña virtual: match por URI exacta
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

// Destello del destino de un salto: resalta la línea y
// muestra una etiqueta flotante con el nombre unos instantes.
// Devuelve función de limpieza (también la usa el desmontaje).
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
        // editor ya liberado
      }
    });
  } catch {
    // decoración best-effort
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
          // editor ya liberado
        }
      });
    } catch {
      // widget best-effort
    }
  }
  const dispose = () => {
    clearTimeout(timer);
    for (const fn of cleanups) {
      try {
        fn();
      } catch {
        // limpieza best-effort
      }
    }
  };
  const timer = setTimeout(dispose, 1200);
  return dispose;
}

export { consumePendingReveal, flashTarget };
