function register({ ipcMain, getWindow }) {

  ipcMain.handle("window:minimize", () => {
    getWindow().minimize();
  });

  ipcMain.handle("window:toggle-maximize", () => {
    if (getWindow().isMaximized()) getWindow().unmaximize();
    else getWindow().maximize();
  });

  ipcMain.handle("window:close", () => {
    getWindow().close();
  });

  ipcMain.handle("window:is-maximized", () => getWindow().isMaximized());
}

module.exports = { registerWindowControls: register };
