const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Diálogos nativos
  openFolder: () => ipcRenderer.invoke("dialog:openFolder"),
  pickParentFolder: () => ipcRenderer.invoke("dialog:pickParentFolder"),
  openFile: () => ipcRenderer.invoke("dialog:openFile"),
  saveFileAs: (content, defaultName) =>
    ipcRenderer.invoke("dialog:saveFileAs", { content, defaultName }),

  // Sistema de archivos
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

  // IntelliSense Java (java-language-server)
  lspStart: (rootPath) => ipcRenderer.invoke("lsp:start", rootPath),
  lspStop: () => ipcRenderer.invoke("lsp:stop"),
  lspRequest: (method, params) => ipcRenderer.invoke("lsp:request", { method, params }),
  lspNotify: (method, params) => ipcRenderer.invoke("lsp:notify", { method, params }),
  // Símbolos externos (JDK/dependencias): fuente real o descompilado
  resolveExternal: (query) => ipcRenderer.invoke("external:resolve", query),
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

  // Controles de ventana (TitleBar propio)
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onMaximizeChange: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("window:maximize-change", listener);
    return () => ipcRenderer.removeListener("window:maximize-change", listener);
  },
});
