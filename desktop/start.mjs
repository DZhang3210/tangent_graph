// Entry point. Loads the app so that a startup error shows a dialog instead of an app that
// silently never opens (an installed app has no console to print to).
import { app, dialog } from "electron";

try {
  await import("./main.mjs");
} catch (e) {
  await app.whenReady();
  dialog.showErrorBox("Tangent Graph couldn't start", e?.stack || String(e));
  app.exit(1);
}
