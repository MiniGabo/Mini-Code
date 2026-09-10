// Panel del editor Monaco.
// Tema en editor/MonacoSetup; gesto Ctrl en editor/features/gotoDefinition.
import { useEffect, useRef } from "react";
import type { MouseEventHandler } from "react";

// Importación: solo el núcleo del editor + tokenizadores.
// Importar "monaco-editor" a secas (o su editor.main.js) trae
// "../basic-languages/monaco.contribution", que registra TODOS los
// lenguajes por defecto (python, html, css, ts, etc), además de los
// servicios de lenguaje:
//   - editor.all.js  -> núcleo + UI standalone (find, folding, minimap...)
//   - editor.api.js  -> namespace `monaco` público
//   - basic-languages/java/java.contribution -> tokenizador Monarch de Java
//   - basic-languages/yaml/yaml.contribution -> tokenizador Monarch de YAML
//   - basic-languages/xml/xml.contribution -> tokenizador Monarch de XML
//   - basic-languages/markdown/markdown.contribution -> tokenizador de Markdown
import "monaco-editor/esm/vs/editor/editor.all.js";
import "monaco-editor/esm/vs/basic-languages/java/java.contribution";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { ensureMiniCodeTheme } from "../editor/MonacoSetup";
import { ensureJavaProviders, attachJavaDoc, consumePendingReveal, flashTarget, registerModelKey } from "../lsp.js";
import { createCtrlClickHandler } from "../editor/features/gotoDefinition/ctrlClick";
import type { FlashCell } from "../editor/features/gotoDefinition/ctrlClick";

// Tema + tokenizador: src/editor/MonacoSetup.ts.
function ensureTheme() {
  ensureMiniCodeTheme(monaco);
}

export interface EditorPaneProps {
  initialValue: string;
  language: string;
  fileUri: string | null;
  modelUri: string | null;
  readOnly?: boolean;
  viewStateKey: string;
  initialViewState?: any;
  onSaveViewState?: (key: string, state: unknown) => void;
  onChange: (value: string) => void;
  onFocusEditor?: MouseEventHandler<HTMLDivElement>;
}

export default function EditorPane({
  initialValue,
  language,
  fileUri,
  modelUri,
  readOnly,
  viewStateKey,
  initialViewState,
  onSaveViewState,
  onChange,
  onFocusEditor,
}: EditorPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  // Salto a definición aplicado en este archivo { key, lineNumber, column,
  // symbol }. Vive en ref: sobrevive a la re-ejecución.
  const revealRef = useRef<any>(null);
  // Re-aplicación pendiente para el próximo montaje inmediato del MISMO
  // archivo. Caduca en la próxima tarea: un remontaje real posterior
  // (volver a la pestaña días después) restaura normal.
  const skipRestoreRef = useRef<any>(null);

  useEffect(() => {
    ensureTheme();

    const editor = monaco.editor.create(containerRef.current!, {
      // Modelo con URI file:// real: necesario para que el LSP asocie
      // diagnósticos y navegación al archivo (sin URI abriría inmemory).
      // Si el URI ya existe (efecto abortado antes de limpiar), se reutiliza
      // en vez de romper con "already exists".
      model: (() => {
        // fileUri (archivo real) o modelUri (pestaña virtual de solo
        // lectura: fuente de dependencia o descompilado).
        const uriStr = modelUri ?? fileUri ?? null;
        if (!uriStr) {
          return monaco.editor.createModel(initialValue, language ?? "java");
        }
        const uri = monaco.Uri.parse(uriStr);
        const existing = monaco.editor
          .getModels()
          .find((m: any) => m.uri.toString() === uri.toString());
        if (existing) {
          if (existing.getValue() !== initialValue) existing.setValue(initialValue);
          return existing;
        }
        return monaco.editor.createModel(initialValue, language ?? "java", uri);
      })(),
      theme: "mini-code-dark",
      automaticLayout: true,
      // Pestañas virtuales (dependencias): lectura, sin edición
      readOnly: !!readOnly,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 14,
      lineHeight: 22,
      minimap: { enabled: false },
      tabSize: 4,
      insertSpaces: true,
      renderWhitespace: "selection",
      folding: true,
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: "smooth",
      // Sin puntos en la regla de overview (la franja junto al scroll):
      // se ocultan cursor, ocurrencias, selección y validaciones ahí.
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      overviewRulerLanes: 0,
      occurrencesHighlight: "off",
      // Al seleccionar un texto se resaltan sus coincidencias en el archivo
      selectionHighlight: true,
      wordBasedSuggestions: "off",
      // Sugerencias siempre visibles al escribir + panel de detalle (firma y
      // javadoc vía completionItem/resolve) al lado de cada método/clase.
      quickSuggestions: true,
      suggestOnTriggerCharacters: true,
      suggest: { preview: false, showStatusBar: true },
      // Bombilla de quick fixes (p. ej. "Import 'java.util.List'") con
      // Ctrl+. al estar sobre un error sin resolver.
      lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.On },
      // Ctrl+Click = ir a definición: Ctrl queda reservado
      // para el salto y el multicursor pasa a Alt+Click.
      multiCursorModifier: "alt",
      // Una definición salta directo; varias abren el peek.
      gotoLocation: {
        multiple: "peek",
        multipleDefinitions: "peek",
        multipleDeclarations: "peek",
        multipleImplementations: "peek",
        multipleReferences: "peek",
        multipleTypeDefinitions: "peek",
      },
      peekWidgetDefaultFocus: "editor",
      // Ctrl+Click salta directo a la definición (sin peek intermedio).
      // Junto con `multiCursorModifier: "alt".
      definitionLinkOpensInPeek: false,
    });

    editorRef.current = editor;

    // Registrar key -> uri para dispose al cerrar + LRU.
    try {
      const m = editor.getModel();
      if (m) registerModelKey(monaco, viewStateKey, m.uri.toString());
    } catch {
      // registro best-effort
    }

    // Ctrl+hover + Ctrl+Click a definición: editor/features/gotoDefinition.
    const flashCell: FlashCell = { current: () => {} };
    const ctrlClick = createCtrlClickHandler(monaco, editor, containerRef.current, language, flashCell);

    // Si acabamos de saltar a este archivo y el efecto se re-ejecuta
    // enseguida (StrictMode), el prop trae el cursor VIEJO: se omite la
    // restauración y se re-aplica el salto más abajo.
    const skip =
      skipRestoreRef.current && skipRestoreRef.current.key === viewStateKey
        ? skipRestoreRef.current
        : null;
    skipRestoreRef.current = null;

    // Restaura scroll/cursor de la visita anterior al archivo (salvo re-salto)
    if (initialViewState && !skip) {
      try {
        editor.restoreViewState(initialViewState);
      } catch {
        // estado incompatible: se arranca desde arriba
      }
    }

    const subscription = editor.onDidChangeModelContent(() => {
      onChange(editor.getValue());
    });

    // IntelliSense Java: proveedores (una vez) + sync del documento
    let disposeDoc = null;
    let appliedReveal = null; // { lineNumber, column, symbol } del salto aplicado
    if (language === "java") {
      ensureJavaProviders(monaco);
      if (fileUri) disposeDoc = attachJavaDoc(monaco, editor, fileUri);
      try {
        const consumed = consumePendingReveal(monaco, editor);
        if (consumed) {
          flashCell.current = consumed.dispose;
          appliedReveal = {
            lineNumber: consumed.target.lineNumber,
            column: consumed.target.column,
            symbol: consumed.symbol,
          };
        }
      } catch {
        // sin salto pendiente
      }
      if (!appliedReveal && skip) {
        // Remontaje inmediato tras un salto: re-aplicar destino + destello
        try {
          editor.setPosition({ lineNumber: skip.lineNumber, column: skip.column });
          editor.revealPositionInCenter({ lineNumber: skip.lineNumber, column: skip.column });
          flashCell.current = flashTarget(monaco, editor, {
            lineNumber: skip.lineNumber,
            column: skip.column,
            symbol: skip.symbol,
          });
          appliedReveal = { lineNumber: skip.lineNumber, column: skip.column, symbol: skip.symbol };
        } catch {
          // re-aplicación best-effort
        }
      }
    }
    revealRef.current = appliedReveal ? { key: viewStateKey, ...appliedReveal } : null;

    return () => {
      if (disposeDoc) disposeDoc();
      try {
        flashCell.current();
      } catch {
        // sin destello que limpiar
      }
      // Si el cursor sigue sobre el destino del salto (el usuario no lo
      // movió), el próximo montaje inmediato debe re-aplicarlo en vez de
      // restaurar el cursor viejo. Caduca en la próxima tarea.
      const rec = revealRef.current;
      revealRef.current = null;
      if (rec && rec.key === viewStateKey) {
        try {
          const p = editor.getPosition();
          if (p && p.lineNumber === rec.lineNumber && p.column === rec.column) {
            const key = rec.key;
            const pending = {
              key,
              lineNumber: rec.lineNumber,
              column: rec.column,
              symbol: rec.symbol,
            };
            skipRestoreRef.current = pending;
            setTimeout(() => {
              if (skipRestoreRef.current && skipRestoreRef.current.key === key) {
                skipRestoreRef.current = null;
              }
            }, 0);
          }
        } catch {
          // sin cursor que comparar
        }
      }
      ctrlClick.dispose();
      if (onSaveViewState) {
        try {
          onSaveViewState(viewStateKey, editor.saveViewState());
        } catch {
          // sin estado que guardar
        }
      }
      subscription.dispose();
      // El modelo se CONSERVA (no se dispone): los modelos viven por sesión
      // y se reutilizan al volver a la pestaña. Disponerlo aquí obligaba a
      // re-crear + didOpen/didClose en cada cambio de pestaña y rompía el
      // refcount de attachJavaDoc (doble didOpen y docs "no encontrados").
      editor.dispose();
    };
    // Solo se recrea cuando cambia el archivo (EditorPane se remonta por `key`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="h-full w-full" onMouseDown={onFocusEditor} />;
}
