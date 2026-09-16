const { t } = require("../i18n.cjs");
function register({ ipcMain, javaLsp }) {
  function lspReadyGuard() {
    if (!javaLsp.isRunning() || !javaLsp.ready) {
      throw new Error(t("main.lspNotRunning"));
    }
  }

  ipcMain.handle("lsp:start", async (_event, rootPath) => {
    try {
      const capabilities = await javaLsp.start(rootPath);
      return { ok: true, capabilities, jdkWarning: javaLsp.jdkWarning ?? null };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("lsp:stop", async () => {
    await javaLsp.stop();
    return true;
  });

  ipcMain.handle("lsp:request", async (event, { method, params }) => {
    lspReadyGuard();
    const allow = new Set([
      "textDocument/completion",
      "completionItem/resolve",
      "textDocument/hover",
      "textDocument/signatureHelp",
      "textDocument/definition",
      "textDocument/documentSymbol",
      "textDocument/codeAction",
    ]);
    if (!allow.has(method)) throw new Error(t("main.methodNotAllowed", { method }));
    const result = await javaLsp.request(method, params, 20000);
    return result;
  });

  ipcMain.handle("lsp:notify", async (event, { method, params }) => {
    const allow = new Set([
      "textDocument/didOpen",
      "textDocument/didChange",
      "textDocument/didClose",
    ]);
    if (!allow.has(method)) throw new Error(t("main.notifyNotAllowed", { method }));
    if (method === "textDocument/didOpen") {
      javaLsp.didOpen(params.uri, params.languageId, params.text);
    } else if (method === "textDocument/didChange") {
      if (!javaLsp.isRunning()) return false;
      javaLsp.didChange(params.uri, params.text);
    } else if (method === "textDocument/didClose") {
      if (!javaLsp.isRunning()) return false;
      javaLsp.didClose(params.uri);
    }
    return true;
  });
}

module.exports = { registerLsp: register };
