const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const { initI18n, setLanguage, t } = require("./i18n.cjs");
const { initSettings, getAllSettings, setSetting } = require("./settings.cjs");

// Single display name: prevents Electron from generating %APPDATA%/mini-code
// (package.json name) in addition to %APPDATA%/Mini Code (productName).
// Enforces a single userData path: %APPDATA%/Mini Code, in dev and packaged.
try {
  app.setName("Mini Code");
} catch {}
try {
  app.setAppUserModelId("com.gabo.minicode");
} catch {}
try {
  app.setPath("userData", path.join(app.getPath("appData"), "Mini Code"));
} catch (err) {
  console.warn("[main] no se pudo fijar userData:", err && err.message);
}

const isDev = process.env.NODE_ENV === "development";

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: "#131313",
    title: "Mini Code",
    frame: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window:maximize-change", true);
  });
  mainWindow.on("unmaximize", () => {
    mainWindow.webContents.send("window:maximize-change", false);
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  initI18n(app);
  initSettings(app);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Java IntelliSense (java-language-server over stdio)

const { JavaLanguageClient } = require("./lsp.cjs");

const javaLsp = new JavaLanguageClient({
  app,
  onNotification: (method, params) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (method === "textDocument/publishDiagnostics") {
      mainWindow.webContents.send("lsp:diagnostics", {
        uri: params.uri,
        diagnostics: params.diagnostics ?? [],
      });
    }
  },
  onUnexpectedExit: ({ code }) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("lsp:status", {
      state: "error",
      message: t("main.stopped", { code }),
    });
  },
});

// User settings file (settings.json, dev vs packaged paths in settings.cjs).
// Writing "language" also switches the main-process locale.
ipcMain.handle("settings:getAll", () => getAllSettings());
ipcMain.handle("settings:set", (_event, { key, value }) => {
  const saved = setSetting(key, value);
  if (key === "language" && typeof value === "string") setLanguage(value);
  return saved;
});

// IPC handlers (see electron/ipc/* and electron/external/*)

const { registerWindowControls } = require("./ipc/windowControls.cjs");
const { registerDialogs } = require("./ipc/dialogs.cjs");
const { registerFileSystem } = require("./ipc/filesystem.cjs");
const { registerLsp } = require("./ipc/lspIpc.cjs");
const { registerExternal } = require("./ipc/external.cjs");
const { registerBuild } = require("./ipc/buildIpc.cjs");
const { registerTerminal, killAllTerminals } = require("./ipc/terminalIpc.cjs");
const { registerExtensions } = require("./ipc/extensionsIpc.cjs");
const { registerUpdater, scheduleAutoChecks } = require("./ipc/updaterIpc.cjs");

const ipcCtx = { ipcMain, getWindow: () => mainWindow };
registerWindowControls(ipcCtx);
registerDialogs(ipcCtx);
registerFileSystem(ipcCtx);
registerLsp({ ...ipcCtx, javaLsp });
registerExternal({ ...ipcCtx, app, getRootPath: () => javaLsp.rootPath });
registerBuild(ipcCtx);
registerTerminal(ipcCtx);
registerExtensions({ ...ipcCtx, app });
registerUpdater({ ...ipcCtx, app });
scheduleAutoChecks(app, () => mainWindow);

app.on("before-quit", () => {
  try {
    killAllTerminals();
  } catch {
    // best-effort
  }
  javaLsp.stop();
});
