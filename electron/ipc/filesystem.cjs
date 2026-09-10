const path = require("path");
const fs = require("fs/promises");
const { shell } = require("electron");
const { buildFileTree } = require("./fileTree.cjs");
function register({ ipcMain }) {

  ipcMain.handle("fs:readFile", async (_event, filePath) => {
    return fs.readFile(filePath, "utf-8");
  });

  ipcMain.handle("fs:writeFile", async (_event, { filePath, content }) => {
    await fs.writeFile(filePath, content, "utf-8");
    return true;
  });

  ipcMain.handle("fs:readDirTree", async (_event, dirPath) => {
    return buildFileTree(dirPath);
  });

  ipcMain.handle("fs:createFile", async (_event, { dirPath, fileName }) => {
    const filePath = path.join(dirPath, fileName);
    await fs.writeFile(filePath, "", { flag: "wx" });
    return filePath;
  });

  ipcMain.handle("fs:createFolder", async (_event, { dirPath, folderName }) => {
    const folderPath = path.join(dirPath, folderName);
    await fs.mkdir(folderPath);
    return folderPath;
  });

  ipcMain.handle("fs:move", async (_event, { srcPath, destPath }) => {
    await fs.rename(srcPath, destPath);
    return destPath;
  });

  ipcMain.handle("fs:delete", async (_event, filePath) => {
    await fs.rm(filePath, { recursive: true, force: true });
    return true;
  });

  // Eliminado seguro: mueve a la papelera (recuperable desde el SO)
  ipcMain.handle("fs:trash", async (_event, filePath) => {
    await shell.trashItem(filePath);
    return true;
  });
}

module.exports = { registerFileSystem: register };
