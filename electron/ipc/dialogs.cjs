const fs = require("fs/promises");
const { dialog } = require("electron");
const { buildFileTree } = require("./fileTree.cjs");
function register({ ipcMain, getWindow }) {

  ipcMain.handle("dialog:openFolder", async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const folderPath = result.filePaths[0];
    const tree = await buildFileTree(folderPath);
    return tree;
  });

  // Parent-location picker for creating a new folder.
  // Reuses the same native "Open folder" dialog, but only
  // returns the chosen path without opening it as a workspace.
  ipcMain.handle("dialog:pickParentFolder", async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: "Selecciona dónde crear la carpeta",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("dialog:openFile", async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      properties: ["openFile"],
      filters: [
        { name: "Java", extensions: ["java"] },
        { name: "YAML", extensions: ["yml", "yaml"] },
        { name: "XML", extensions: ["xml"] },
        { name: "Markdown", extensions: ["md", "markdown"] },
        { name: "Todos los archivos", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, "utf-8");
    return { path: filePath, content };
  });

  ipcMain.handle("dialog:saveFileAs", async (_event, { content, defaultName }) => {
    const result = await dialog.showSaveDialog(getWindow(), {
      defaultPath: defaultName || "NuevoArchivo.java",
      filters: [
        { name: "Java", extensions: ["java"] },
        { name: "YAML", extensions: ["yml", "yaml"] },
        { name: "XML", extensions: ["xml"] },
        { name: "Markdown", extensions: ["md", "markdown"] },
        { name: "Todos los archivos", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePath) return null;

    await fs.writeFile(result.filePath, content, "utf-8");
    return result.filePath;
  });
}

module.exports = { registerDialogs: register };
