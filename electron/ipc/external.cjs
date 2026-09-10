const { resolveExternal } = require("../external/resolve.cjs");
function register({ ipcMain, app, getWindow, getRootPath }) {
  ipcMain.handle("external:resolve", async (_event, query) => {
    const token = query?.token ?? null;
    const progress = (message) => {
      try {
        if (token && getWindow() && !getWindow().isDestroyed()) {
          getWindow().webContents.send("external:progress", { token, message });
        }
      } catch {
        // progreso best-effort
      }
    };
    try {
      return await resolveExternal(app, query, getRootPath(), progress);
    } catch (err) {
      console.error("[external] fallo:", err.message);
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { registerExternal: register };
