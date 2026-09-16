// Registry key -> Monaco model URI + LRU + dispose.
// Doc sync (didOpen/didChange) lives in docSync; models are KEPT across tab
// switches and the server keeps their documents open project-wide.
// The canonical URI is always model.uri.toString() (the one also used by
// requests); fileUri only decides whether there is a document to open.
let monacoRefForDispose: any = null;
const modelKeyToUri = new Map<string, string>(); // viewStateKey -> uriString
const modelLruKeys: string[] = []; // oldest-first keys
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
      // best-effort dispose
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
  // Deferred: EditorPane on unmount still references the model.
  setTimeout(() => {
    try {
      findModelByUri(uri)?.dispose?.();
    } catch {
      // best-effort dispose
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
        // best-effort per model
      }
    }
  } catch {
    // no monaco registered yet
  }
}

export { trackMonaco, registerModelKey, disposeModelForKey, disposeAllModels };
