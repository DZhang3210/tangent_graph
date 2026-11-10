// The only bridge between the page and the desktop app. The page works without it (in a browser),
// so everything here is optional for web/index.html.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tangentApp", {
  /** Move the window to fit a page mode. */
  snap: mode => ipcRenderer.send("snap", mode),
  /** The tray menu picked a mode. */
  onSetMode: cb => ipcRenderer.on("set-mode", (_e, mode) => cb(mode)),
});
