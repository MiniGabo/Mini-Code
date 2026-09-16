const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { dialog } = require("electron");
const { t } = require("../i18n.cjs");
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
      title: t("main.pickParentTitle"),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // JDK home picker for Settings (returns the path without opening anything).
  ipcMain.handle("dialog:pickJdk", async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: t("main.pickJdkTitle"),
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Validates a JDK home: <home>/bin/java(.exe) must exist.
  ipcMain.handle("dialog:validateJdk", async (_event, home) => {
    const exe = process.platform === "win32" ? "java.exe" : "java";
    const dir = String(home ?? "").trim();
    if (dir) {
      try {
        if (fsSync.existsSync(path.join(dir, "bin", exe))) return { ok: true };
      } catch {
        // unreadable location: invalid
      }
    }
    return { ok: false, error: t("settings.java.jdkInvalid", { exe, path: dir || "?" }) };
  });

  ipcMain.handle("dialog:openFile", async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      properties: ["openFile"],
      filters: [
        { name: "Java", extensions: ["java"] },
        { name: "YAML", extensions: ["yml", "yaml"] },
        { name: "XML", extensions: ["xml"] },
        { name: "Markdown", extensions: ["md", "markdown"] },
        { name: t("main.allFilesFilter"), extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, "utf-8");
    return { path: filePath, content };
  });

  ipcMain.handle("dialog:saveFileAs", async (_event, { content, defaultName }) => {
    const result = await dialog.showSaveDialog(getWindow(), {
      defaultPath: defaultName || t("main.defaultFileName"),
      filters: [
        { name: "Java", extensions: ["java"] },
        { name: "YAML", extensions: ["yml", "yaml"] },
        { name: "XML", extensions: ["xml"] },
        { name: "Markdown", extensions: ["md", "markdown"] },
        { name: t("main.allFilesFilter"), extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePath) return null;

    await fs.writeFile(result.filePath, content, "utf-8");
    return result.filePath;
  });
}

module.exports = { registerDialogs: register };
