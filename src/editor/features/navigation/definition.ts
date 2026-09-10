// Goto-definición: LSP primero, respaldo local después.
// Extraído de src/lsp.js sin cambios de lógica.
import { dedupedLspRequest } from "../../../services/lsp/request";
import { definitionToLocations } from "../../../languages/java/translate";
import { symbolAt } from "../../../languages/java/javaText";
import { findLocalDefinition } from "../../../languages/java/localDefinition";
import { getOpenFileByPath, setPendingReveal } from "./bridges";
// Resuelve la definición de clases Y métodos en `position`:
// 1) pregunta al LSP; 2) si el LSP no sabe nada, busca la declaración en
// los modelos abiertos. Siempre devuelve Location[] de Monaco (vacío si
// no hay). Las ubicaciones devueltas usan SIEMPRE el URI canónico del
// modelo abierto (no el del LSP, cuya normalización puede diferir): sin
// esto el preview de Ctrl+hover rompe con "Model not found".
//
// `allowOpenFile` solo lo usa el Ctrl+Click explícito: el proveedor que
// alimenta el hover/preview nativo NUNCA abre pestañas como efecto
// secundario (un hover no debe abrir archivos).
async function resolveDefinition(monaco: any, model: any, position: any, opts: any = {}) {
  const allowOpenFile = opts.allowOpenFile === true;
  // Pestañas virtuales: el servidor no conoce decompiled:// y cada request
  // colgaría hasta el timeout. Se va directo al respaldo local.
  let isVirtual = false;
  try {
    isVirtual = model.uri.scheme !== "file";
  } catch {
    isVirtual = false;
  }
  if (!isVirtual) {
  try {
    // Posición normalizada al inicio de la palabra: el Ctrl+Click dispara
    // DOS resoluciones del mismo símbolo (la nativa de Monaco vía el
    // provider para el peek/navegación, y la explícita del mouseUp para
    // abrir pestañas). Con la columna cruda del click diferían en 1-2
    // caracteres y el servidor las veía como 2 requests distintos; anclando
    // al inicio de la palabra ambas emiten parámetros idénticos y el dedup
    // global (dedupedLspRequest) las colapsa en un solo round-trip.
    // Pedir la definición en el primer carácter de la palabra es equivalente
    // (el servidor resuelve el token bajo el offset) y no cambia el resultado.
    let reqLine = position.lineNumber - 1;
    let reqChar = position.column - 1;
    try {
      const w = model.getWordAtPosition(position);
      if (w) reqChar = w.startColumn - 1;
    } catch {
      // posición cruda
    }
    const result = await dedupedLspRequest("textDocument/definition", {
      textDocument: { uri: model.uri.toString() },
      position: { line: reqLine, character: reqChar },
    });
    const lspLocs = result ? definitionToLocations(monaco, result) : [];
    const javaLocs = lspLocs.filter((loc: any) => {
      try {
        return (
          loc.uri.scheme === "file" &&
          loc.uri.fsPath.toLowerCase().endsWith(".java")
        );
      } catch {
        return false;
      }
    });
    if (javaLocs.length > 0) {
      // El LSP conoce el símbolo: manda su respuesta.
      const kept = [];
      for (const loc of javaLocs) {
        const openModel = modelForFs(monaco, loc.uri.fsPath);
        if (openModel) {
          // URI canónico del modelo abierto: imprescindible para que el
          // preview nativo encuentre el modelo.
          kept.push({ uri: openModel.uri, range: loc.range });
          continue;
        }
        // Otro archivo: solo abrir pestaña en Ctrl+Click explícito.
        const opener = getOpenFileByPath();
        if (allowOpenFile && opener) {
          // Se registra ANTES de abrir: la pestaña puede montarse (y leer
          // el pendiente) en cuanto el setState se procese, antes de que
          // el await termine. Si la apertura falla se limpia.
          setPendingReveal({
            fs: loc.uri.fsPath.toLowerCase(),
            lineNumber: loc.range.startLineNumber,
            column: loc.range.startColumn,
            symbol: symbolAt(model, position),
          });
          try {
            await opener(loc.uri.fsPath);
          } catch {
            setPendingReveal(null);
            continue;
          }
          kept.push(loc);
        }
      }
      return kept;
    }
  } catch {
    // sin servidor o timeout: se intenta el respaldo local
  }
  } // cierre del if (!isVirtual)
  const name = symbolAt(model, position);
  if (!name) return [];
  return findLocalDefinition(monaco, model, name, position);
}

// Resolución completa con apertura de archivos: la usa el Ctrl+Click
// explícito de EditorPane (el proveedor del hover nunca abre pestañas).
function resolveDefinitionForClick(monaco: any, model: any, position: any) {
  return resolveDefinition(monaco, model, position, { allowOpenFile: true });
}

// Símbolo navegable bajo una posición (clase o método; nunca keywords).
// Lo usa EditorPane para subrayar con Ctrl+hover.
function navigableSymbolAt(monaco: any, model: any, position: any) {
  void monaco;
  return symbolAt(model, position);
}
function modelForFs(monaco: any, fsPath: any) {
  const want = fsPath.toLowerCase();
  return (
    monaco.editor.getModels().find((m: any) => {
      try {
        return m.uri.fsPath.toLowerCase() === want;
      } catch {
        return false;
      }
    }) ?? null
  );
}

export { resolveDefinition, resolveDefinitionForClick, navigableSymbolAt };
