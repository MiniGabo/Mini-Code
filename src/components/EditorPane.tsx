// Monaco editor pane.
// Theme in editor/MonacoSetup; Ctrl gesture in editor/features/gotoDefinition.
import { useEffect, useRef } from "react";
import type { MouseEventHandler } from "react";

// Import: editor core + tokenizers only.
// Importing plain "monaco-editor" (or its editor.main.js) pulls
// "../basic-languages/monaco.contribution", which registers ALL
// default languages (python, html, css, ts, etc.), plus the
// language services:
//   - editor.all.js  -> core + standalone UI (find, folding, minimap...)
//   - editor.api.js  -> public `monaco` namespace
//   - basic-languages/java/java.contribution -> Java Monarch tokenizer
//   - basic-languages/yaml/yaml.contribution -> YAML Monarch tokenizer
//   - basic-languages/xml/xml.contribution -> XML Monarch tokenizer
//   - basic-languages/markdown/markdown.contribution -> Markdown tokenizer
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

// Theme + tokenizer: src/editor/MonacoSetup.ts.
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
  // Go-to-definition jump applied in this file { key, lineNumber, column,
  // symbol }. Lives in a ref: survives re-execution.
  const revealRef = useRef<any>(null);
  // Pending re-application for the next immediate mount of the SAME
  // file. Expires on the next task: a later real remount
  // (returning to the tab days later) restores normally.
  const skipRestoreRef = useRef<any>(null);

  useEffect(() => {
    ensureTheme();

    const editor = monaco.editor.create(containerRef.current!, {
      // Model with a real file:// URI: required so the LSP associates
      // diagnostics and navigation with the file (without a URI it would open in-memory).
      // If the URI already exists (effect aborted before cleanup), it is reused
      // instead of throwing "already exists".
      model: (() => {
        // fileUri (real file) or modelUri (read-only virtual tab:
        // dependency source or decompiled).
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
      // Virtual tabs (dependencies): read-only, no editing
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
      // No dots in the overview ruler (the strip next to the scrollbar):
      // cursor, occurrences, selection, and validations are hidden there.
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      overviewRulerLanes: 0,
      occurrencesHighlight: "off",
      // Selecting text highlights its matches in the file
      selectionHighlight: true,
      wordBasedSuggestions: "off",
      // Suggestions always visible while typing + detail panel (signature and
      // javadoc via completionItem/resolve) next to each method/class.
      quickSuggestions: true,
      suggestOnTriggerCharacters: true,
      suggest: { preview: false, showStatusBar: true },
      // Quick-fix lightbulb (e.g. "Import 'java.util.List'") with
      // Ctrl+. when over an unresolved error.
      lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.On },
      // Ctrl+Click = go to definition: Ctrl stays reserved
      // for jumping and multicursor moves to Alt+Click.
      multiCursorModifier: "alt",
      // One definition jumps directly; several open peek.
      gotoLocation: {
        multiple: "peek",
        multipleDefinitions: "peek",
        multipleDeclarations: "peek",
        multipleImplementations: "peek",
        multipleReferences: "peek",
        multipleTypeDefinitions: "peek",
      },
      peekWidgetDefaultFocus: "editor",
      // Ctrl+Click jumps straight to the definition (no intermediate peek).
      // Together with `multiCursorModifier: "alt".
      definitionLinkOpensInPeek: false,
    });

    editorRef.current = editor;

    // Register key -> uri for dispose on close + LRU.
    try {
      const m = editor.getModel();
      if (m) registerModelKey(monaco, viewStateKey, m.uri.toString());
    } catch {
      // best-effort registration
    }

    // Ctrl+hover + Ctrl+Click to definition: editor/features/gotoDefinition.
    const flashCell: FlashCell = { current: () => {} };
    const ctrlClick = createCtrlClickHandler(monaco, editor, containerRef.current, language, flashCell);

    // If we just jumped to this file and the effect re-runs
    // immediately (StrictMode), the prop carries the OLD cursor:
    // restoration is skipped and the jump is re-applied below.
    const skip =
      skipRestoreRef.current && skipRestoreRef.current.key === viewStateKey
        ? skipRestoreRef.current
        : null;
    skipRestoreRef.current = null;

    // Restores scroll/cursor from the previous visit to the file (unless re-jumping)
    if (initialViewState && !skip) {
      try {
        editor.restoreViewState(initialViewState);
      } catch {
        // incompatible state: start from the top
      }
    }

    const subscription = editor.onDidChangeModelContent(() => {
      onChange(editor.getValue());
    });

    // Java IntelliSense: providers (once) + document sync
    let disposeDoc = null;
    let appliedReveal = null; // { lineNumber, column, symbol } of the applied jump
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
        // no pending jump
      }
      if (!appliedReveal && skip) {
        // Immediate remount after a jump: re-apply target + flash
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
          // best-effort re-application
        }
      }
    }
    revealRef.current = appliedReveal ? { key: viewStateKey, ...appliedReveal } : null;

    return () => {
      if (disposeDoc) disposeDoc();
      try {
        flashCell.current();
      } catch {
        // no flash to clean up
      }
      // If the cursor is still on the jump target (the user did not
      // move it), the next immediate mount must re-apply it instead of
      // restoring the old cursor. Expires on the next task.
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
          // no cursor to compare
        }
      }
      ctrlClick.dispose();
      if (onSaveViewState) {
        try {
          onSaveViewState(viewStateKey, editor.saveViewState());
        } catch {
          // no state to save
        }
      }
      subscription.dispose();
      // The model is KEPT (not disposed): models live per session
      // and are reused when returning to the tab. Disposing it here forced
      // re-create + didOpen/didClose on every tab switch and broke the
      // attachJavaDoc refcount (double didOpen and "not found" docs).
      editor.dispose();
    };
    // Only recreated when the file changes (EditorPane remounts via `key`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="h-full w-full" onMouseDown={onFocusEditor} />;
}
