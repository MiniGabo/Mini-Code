// Auto-updater IPC: check against latest.yml, download with progress,
// opening the release page, and installing the downloaded .exe.
const { shell } = require("electron");
const updater = require("../updater.cjs");

let lastCheck = null;
let downloading = null; // { controller, promise }
let downloadedPath = null;

function send(win, channel, payload) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  } catch {}
}

function registerUpdater({ ipcMain, app, getWindow }) {
  const getWin = typeof getWindow === "function" ? getWindow : () => null;

  ipcMain.handle("updater:getVersion", () => {
    try {
      return { ok: true, version: app.getVersion() };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  ipcMain.handle("updater:check", async (_event, opts) => {
    const manual = !!(opts && opts.manual);
    // In dev the real check gets in the way: report the local version unless manually triggered.
    if (!app.isPackaged && !manual) {
      const v = app.getVersion();
      lastCheck = { ok: true, currentVersion: v, latestVersion: v, updateAvailable: false, checkedAt: Date.now(), dev: true };
      return lastCheck;
    }
    try {
      const res = await updater.checkForUpdates(app);
      lastCheck = { ...res, checkedAt: Date.now() };
      send(getWin(), "updater:status", lastCheck);
      return lastCheck;
    } catch (err) {
      const fail = {
        ok: false,
        currentVersion: app.getVersion(),
        latestVersion: null,
        updateAvailable: false,
        error: String((err && err.message) || err),
        checkedAt: Date.now(),
      };
      lastCheck = fail;
      send(getWin(), "updater:status", fail);
      return fail;
    }
  });

  ipcMain.handle("updater:download", async () => {
    if (downloading) return { ok: false, error: "already downloading" };
    if (!lastCheck || !lastCheck.updateAvailable || !lastCheck.downloadUrl) {
      return { ok: false, error: "no update available" };
    }
    const win = getWin();
    const { downloadUrl, sha512 } = lastCheck;
    const controller = new AbortController();
    const task = updater
      .downloadUpdate(
        downloadUrl,
        sha512,
        (p) => send(win, "updater:progress", { ...p, status: "downloading" }),
        controller.signal
      )
      .then((filePath) => {
        downloadedPath = filePath;
        downloading = null;
        send(win, "updater:progress", { status: "downloaded", path: filePath });
        return { ok: true, path: filePath };
      })
      .catch((err) => {
        downloading = null;
        const error = String((err && err.message) || err);
        send(win, "updater:progress", { status: "error", error });
        return { ok: false, error };
      });
    downloading = { controller, promise: task };
    send(win, "updater:progress", { status: "started" });
    return task;
  });

  ipcMain.handle("updater:cancelDownload", () => {
    if (downloading) {
      try {
        downloading.controller.abort();
      } catch {}
      return { ok: true };
    }
    return { ok: false, error: "not downloading" };
  });

  ipcMain.handle("updater:openRelease", async () => {
    const url = (lastCheck && lastCheck.releasePage) || updater.RELEASE_PAGE_URL;
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  // Runs the downloaded installer and quits the app so NSIS can update.
  ipcMain.handle("updater:quitAndInstall", async () => {
    if (!downloadedPath) return { ok: false, error: "no downloaded update" };
    try {
      await shell.openPath(downloadedPath);
      // Give the installer time to start before quitting.
      setTimeout(() => {
        try {
          app.quit();
        } catch {}
      }, 800);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
}

// Automatic check on startup + interval. Packaged builds only.
function scheduleAutoChecks(app, getWindow, { initialDelayMs = 20000, intervalMs = 6 * 60 * 60 * 1000 } = {}) {
  if (!app.isPackaged) return () => {};
  let timer = null;
  let interval = null;
  const run = async () => {
    try {
      const res = await updater.checkForUpdates(app);
      lastCheck = { ...res, checkedAt: Date.now() };
      const win = getWindow();
      send(win, "updater:status", lastCheck);
    } catch {}
  };
  timer = setTimeout(() => {
    void run();
    interval = setInterval(() => void run(), intervalMs);
  }, initialDelayMs);
  return () => {
    if (timer) clearTimeout(timer);
    if (interval) clearInterval(interval);
  };
}

module.exports = { registerUpdater, scheduleAutoChecks };
