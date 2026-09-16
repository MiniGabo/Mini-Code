const { checkMany } = require("../external/mavenCheck.cjs");
function register({ ipcMain }) {
  ipcMain.handle("build:checkMaven", async (_event, payload) => {
    try {
      const deps = Array.isArray(payload?.deps) ? payload.deps : [];
      const repos = Array.isArray(payload?.repos) ? payload.repos : [];
      const results = await checkMany(deps, repos);
      return { ok: true, results };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
}

module.exports = { registerBuild: register };
