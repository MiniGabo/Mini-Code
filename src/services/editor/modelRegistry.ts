// Registro key -> URI de modelos Monaco + LRU + dispose.
// Sincroniza un modelo Java con el servidor: didOpen inicial, didChange
// con debounce y didClose al desmontar. Devuelve función de limpieza.
// El URI canónico es siempre model.uri.toString() (el que usan
// también los requests); el fileUri solo decide si hay documento que abrir.
let monacoRefForDispose: any = null;
const modelKeyToUri = new Map<string, string>(); // viewStateKey -> uriString
const modelLruKeys: string[] = []; // claves oldest-first
const MAX_MODELS = 12;

function trackMonaco(monaco: any) {
  if (monaco) monacoRefForDispose = monaco;
}

function findModelByUri(uriString: any) {
  try {
    const models = monacoRefForDispose?.editor?.getModels?.() ?? [];
    return models.find((m: any) => {
      try {
        return m.uri.toString() === uriString;
      } catch {
        return false;
      }
    }) ?? null;
  } catch {
    return null;
  }
}

function evictModelsIfNeeded() {
  while (modelLruKeys.length > MAX_MODELS) {
    const oldest = modelLruKeys.shift();
    if (oldest === undefined) continue;
    const uri = modelKeyToUri.get(oldest);
    modelKeyToUri.delete(oldest);
    if (!uri) continue;
    try {
      findModelByUri(uri)?.dispose?.();
    } catch {
      // dispose best-effort
    }
  }
}

function registerModelKey(monaco: any, key: any, uriString: any) {
  trackMonaco(monaco);
  if (key == null || !uriString) return;
  modelKeyToUri.set(key, uriString);
  const idx = modelLruKeys.indexOf(key);
  if (idx !== -1) modelLruKeys.splice(idx, 1);
  modelLruKeys.push(key);
  evictModelsIfNeeded();
}

function disposeModelForKey(key: any) {
  const uri = modelKeyToUri.get(key);
  modelKeyToUri.delete(key);
  const idx = modelLruKeys.indexOf(key);
  if (idx !== -1) modelLruKeys.splice(idx, 1);
  if (!uri) return;
  // Diferido: el EditorPane en desmontaje aún referencia el modelo.
  setTimeout(() => {
    try {
      findModelByUri(uri)?.dispose?.();
    } catch {
      // dispose best-effort
    }
  }, 0);
}

function disposeAllModels() {
  modelKeyToUri.clear();
  modelLruKeys.length = 0;
  try {
    const models = monacoRefForDispose?.editor?.getModels?.() ?? [];
    for (const m of models) {
      try {
        m.dispose?.();
      } catch {
        // best-effort por modelo
      }
    }
  } catch {
    // sin monaco registrado aún
  }
}

export { trackMonaco, registerModelKey, disposeModelForKey, disposeAllModels };
