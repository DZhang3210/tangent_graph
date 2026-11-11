// Updates for the installed app, from GitHub Releases (see "publish" in package.json).
// Windows: downloads in the background, then offers to restart. Unsigned Mac apps can't
// replace themselves, so on Mac it only says a new version is out and opens the download page.

import { app, dialog, shell } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;
// Same repo as "build.publish" in package.json (the installer strips that section, so it's repeated here).
const RELEASES = "https://github.com/DZhang3210/tangent-graph/releases/latest";
const EVERY_MS = 6 * 60 * 60 * 1000;
const selfInstall = process.platform !== "darwin";

/** @param {{ beforeRestart: () => void }} hooks  lets the app stop hiding to the tray, so it can really quit */
export function setupUpdates({ beforeRestart }) {
  if (!app.isPackaged) return { check: async () => dialog.showMessageBox({ message: "Updates only run in the installed app." }) };

  autoUpdater.autoDownload = selfInstall;
  autoUpdater.autoInstallOnAppQuit = selfInstall;
  let manual = false, told = "";

  autoUpdater.on("update-available", async info => {
    if (selfInstall || told === info.version) return;
    told = info.version;
    const r = await dialog.showMessageBox({
      type: "info", buttons: ["Download", "Later"], defaultId: 0, cancelId: 1,
      message: `Tangent Graph ${info.version} is available`,
      detail: `You have ${app.getVersion()}. Download the new version, then drag it into Applications to replace this one.`,
    });
    if (r.response === 0) shell.openExternal(RELEASES);
  });

  autoUpdater.on("update-downloaded", async info => {
    if (told === info.version) return;
    told = info.version;
    const r = await dialog.showMessageBox({
      type: "info", buttons: ["Restart now", "Later"], defaultId: 0, cancelId: 1,
      message: `Tangent Graph ${info.version} is ready`,
      detail: "Restart to finish updating. If you choose Later, it installs the next time you quit.",
    });
    if (r.response === 0) { beforeRestart(); autoUpdater.quitAndInstall(); }
  });

  autoUpdater.on("update-not-available", () => {
    if (manual) dialog.showMessageBox({ message: "You're up to date", detail: `Tangent Graph ${app.getVersion()} is the latest version.` });
  });

  // Checking quietly in the background: only a check you asked for reports errors.
  autoUpdater.on("error", e => {
    if (manual) dialog.showMessageBox({ type: "warning", message: "Couldn't check for updates", detail: e.message });
  });

  const check = async ({ asked = false } = {}) => {
    manual = asked;
    try { await autoUpdater.checkForUpdates(); } catch {} // reported through the "error" event
    finally { manual = false; }
  };
  setTimeout(() => check(), 15_000);
  setInterval(() => check(), EVERY_MS);
  return { check: () => check({ asked: true }) };
}
