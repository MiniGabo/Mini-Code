const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Native dialogs
  openFolder: () => ipcRenderer.invoke("dialog:openFolder"),
  pickParentFolder: () => ipcRenderer.invoke("dialog:pickParentFolder"),
  pickJdk: () => ipcRenderer.invoke("dialog:pickJdk"),
  validateJdk: (home) => ipcRenderer.invoke("dialog:validateJdk", home),
  openFile: () => ipcRenderer.invoke("dialog:openFile"),
  saveFileAs: (content, defaultName) =>
    ipcRenderer.invoke("dialog:saveFileAs", { content, defaultName }),

  // File system
  readFile: (filePath) => ipcRenderer.invoke("fs:readFile", filePath),
  writeFile: (filePath, content) =>
    ipcRenderer.invoke("fs:writeFile", { filePath, content }),
  readDirTree: (dirPath) => ipcRenderer.invoke("fs:readDirTree", dirPath),
  createFile: (dirPath, fileName) =>
    ipcRenderer.invoke("fs:createFile", { dirPath, fileName }),
  createFolder: (dirPath, folderName) =>
    ipcRenderer.invoke("fs:createFolder", { dirPath, folderName }),
  moveEntry: (srcPath, destPath) =>
    ipcRenderer.invoke("fs:move", { srcPath, destPath }),
  deleteEntry: (filePath) => ipcRenderer.invoke("fs:delete", filePath),
  trashEntry: (filePath) => ipcRenderer.invoke("fs:trash", filePath),

  // Java IntelliSense (java-language-server)
  lspStart: (rootPath) => ipcRenderer.invoke("lsp:start", rootPath),
  lspStop: () => ipcRenderer.invoke("lsp:stop"),
  getSettings: () => ipcRenderer.invoke("settings:getAll"),
  setSetting: (key, value) => ipcRenderer.invoke("settings:set", { key, value }),
  lspRequest: (method, params) => ipcRenderer.invoke("lsp:request", { method, params }),
  lspNotify: (method, params) => ipcRenderer.invoke("lsp:notify", { method, params }),
  // External symbols (JDK/dependencies): real source or decompiled
  resolveExternal: (query) => ipcRenderer.invoke("external:resolve", query),
  // Build files: Maven Central existence (main, no CORS) + local ~/.m2/~/.gradle
  checkMavenDeps: (deps, repos) => ipcRenderer.invoke("build:checkMaven", { deps, repos }),
  onExternalProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("external:progress", listener);
    return () => ipcRenderer.removeListener("external:progress", listener);
  },
  onDiagnostics: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("lsp:diagnostics", listener);
    return () => ipcRenderer.removeListener("lsp:diagnostics", listener);
  },
  onLspStatus: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("lsp:status", listener);
    return () => ipcRenderer.removeListener("lsp:status", listener);
  },

  // Extensions (theme packs: manifest + theme JSON only)
  extensionsScan: () => ipcRenderer.invoke("extensions:scan"),
  extensionsReadJson: (dir, rel) => ipcRenderer.invoke("extensions:readJson", { dir, rel }),
  extensionsReadAsset: (dir, rel) => ipcRenderer.invoke("extensions:readAsset", { dir, rel }),
  extensionsInstall: () => ipcRenderer.invoke("extensions:install"),
  extensionsUninstall: (id) => ipcRenderer.invoke("extensions:uninstall", { id }),
  extensionsOpenFolder: () => ipcRenderer.invoke("extensions:openFolder"),

  // Integrated terminal (Option B: persistent PTY via node-pty + xterm.js).
  // The shell outlives the panel: open attaches (spawning on first use),
  // hiding the panel only detaches. Close kills explicitly (restart button).
  terminalOpen: (opts) => ipcRenderer.invoke("terminal:open", opts),
  terminalWrite: (id, data) => ipcRenderer.invoke("terminal:write", { id, data }),
  terminalResize: (id, cols, rows) => ipcRenderer.invoke("terminal:resize", { id, cols, rows }),
  terminalPause: (id) => ipcRenderer.invoke("terminal:pause", { id }),
  terminalCloseAll: () => ipcRenderer.invoke("terminal:closeAll"),
  onTerminalData: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("terminal:data", listener);
    return () => ipcRenderer.removeListener("terminal:data", listener);
  },
  onTerminalExit: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("terminal:exit", listener);
    return () => ipcRenderer.removeListener("terminal:exit", listener);
  },

  // Window controls (custom TitleBar)
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onMaximizeChange: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("window:maximize-change", listener);
    return () => ipcRenderer.removeListener("window:maximize-change", listener);
  },

  // Auto-updater (GitHub Releases latest.yml)
  getAppVersion: () => ipcRenderer.invoke("updater:getVersion"),
  checkForUpdates: (manual) => ipcRenderer.invoke("updater:check", { manual: !!manual }),
  downloadUpdate: () => ipcRenderer.invoke("updater:download"),
  cancelUpdateDownload: () => ipcRenderer.invoke("updater:cancelDownload"),
  openReleasePage: () => ipcRenderer.invoke("updater:openRelease"),
  quitAndInstall: () => ipcRenderer.invoke("updater:quitAndInstall"),
  onUpdaterStatus: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("updater:status", listener);
    return () => ipcRenderer.removeListener("updater:status", listener);
  },
  onUpdaterProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("updater:progress", listener);
    return () => ipcRenderer.removeListener("updater:progress", listener);
  },
});
