// Syncs a Java model with the server (didOpen + debounced didChange).
// The server is project-wide: documents stay open on the server after the
// tab unmounts (tab switch or close), so their diagnostics keep showing as
// badges. The server clears diagnostics on didClose, hence no didClose is
// sent here; explicit closes happen only when a file is deleted, moved or
// renamed (see didCloseServerDocs in App).
import { trackMonaco } from "./modelRegistry";
const openDocRefs = new Map(); // docUri -> count
function attachJavaDoc(monaco: any, editor: any, fileUri: any) {
  trackMonaco(monaco);
  const model = editor.getModel();
  if (!model || !fileUri || !window.electronAPI?.lspNotify) return () => {};
  let scheme = null;
  try {
    scheme = model.uri.scheme;
  } catch {
    scheme = null;
  }
  if (scheme && scheme !== "file") return () => {};
  const docUri = model.uri.toString();
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const refs = openDocRefs.get(docUri) ?? 0;
  if (refs === 0) {
    window.electronAPI?.lspNotify("textDocument/didOpen", {
      uri: docUri,
      languageId: "java",
      text: model.getValue(),
    }).catch?.(() => {});
  }
  openDocRefs.set(docUri, refs + 1);

  const subscription = model.onDidChangeContent(() => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (disposed) return;
      window.electronAPI?.lspNotify("textDocument/didChange", {
        uri: docUri,
        text: model.getValue(),
      }).catch?.(() => {});
    }, 400);
  });

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    subscription.dispose();
    // Bookkeeping only: the document stays open on the server (project-wide
    // diagnostics). Re-mounting re-opens (server maps it to didChange).
    const left = (openDocRefs.get(docUri) ?? 1) - 1;
    if (left <= 0) {
      openDocRefs.delete(docUri);
    } else {
      openDocRefs.set(docUri, left);
    }
  };
}

export { attachJavaDoc };
