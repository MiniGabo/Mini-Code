const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");

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
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// IntelliSense Java (java-language-server por stdio)

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
      message: `El servidor Java se detuvo (code=${code})`,
    });
  },
});

// Handlers IPC (ver electron/ipc/* y electron/external/*)

const { registerWindowControls } = require("./ipc/windowControls.cjs");
const { registerDialogs } = require("./ipc/dialogs.cjs");
const { registerFileSystem } = require("./ipc/filesystem.cjs");
const { registerLsp } = require("./ipc/lspIpc.cjs");
const { registerExternal } = require("./ipc/external.cjs");

const ipcCtx = { ipcMain, getWindow: () => mainWindow };
registerWindowControls(ipcCtx);
registerDialogs(ipcCtx);
registerFileSystem(ipcCtx);
registerLsp({ ...ipcCtx, javaLsp });
registerExternal({ ...ipcCtx, app, getRootPath: () => javaLsp.rootPath });

app.on("before-quit", () => {
  javaLsp.stop();
});
