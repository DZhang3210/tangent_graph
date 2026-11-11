// The desktop app: runs the local server, shows the web UI in its own window, and lives in the
// tray so Ctrl+Alt+T can pull it up from anywhere.
// Two ways to run it:
//   from the repo (`npm run app`): runs src/ with tsx, data in ./data, port 5179
//   installed (`npm run dist`):    runs the bundled server, data in the user folder, port 5180
// TANGENT_DATA, TANGENT_JUDGE, PORT, CLAUDE_BIN override these as they do for `npm run dev`.

import { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, screen, shell } from "electron";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boundsFor } from "./geometry.mjs";
import { setupUpdates } from "./updates.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installed = app.isPackaged;
// Its own settings folder and single-instance lock, apart from the repo copy ("tangent-graph").
if (installed) {
  app.setName("Tangent Graph");
  app.setPath("userData", path.join(app.getPath("appData"), "Tangent Graph"));
}
// Different ports, so the installed app and `npm run dev` never pick up each other's server.
const port = Number(process.env.PORT) || (installed ? 5180 : 5179);
const base = `http://localhost:${port}`;
const dataDir = process.env.TANGENT_DATA ?? (installed ? path.join(app.getPath("userData"), "data") : path.join(root, "data"));
// The repo copy leaves a note saying where its data lives, so the installed app can copy it once.
const devNote = path.join(app.getPath("appData"), "tangent-graph", "dev-data.json");
const HOTKEY = "Control+Alt+T";
const icon = nativeImage.createFromPath(path.join(root, "desktop", "icon.png"));

let win = null, tray = null, server = null, quitting = false;
// From the repo, Electron runs this folder as the app, so login launches need it as an argument.
const loginItem = { path: process.execPath, args: installed ? ["--hidden"] : [root, "--hidden"] };
const startHidden = process.argv.includes("--hidden");

// A second launch (shortcut, hotkey) just brings the running app forward.
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => show());

async function healthy() {
  try { return (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

/** First run of the installed app: copy the graphs and chats you made with the repo copy. */
function adoptDevData() {
  if (!installed || process.env.TANGENT_DATA || existsSync(path.join(dataDir, "graphs"))) return;
  try {
    const from = JSON.parse(readFileSync(devNote, "utf8")).dataDir;
    if (from && existsSync(from)) cpSync(from, dataDir, { recursive: true, filter: f => !f.endsWith("server.log") });
  } catch {} // no repo copy on this machine: start empty
}

function noteDevData() {
  if (installed || process.env.TANGENT_DATA) return; // only your usual data folder, not a test one
  try { mkdirSync(path.dirname(devNote), { recursive: true }); writeFileSync(devNote, JSON.stringify({ dataDir })); } catch {}
}

/** Reuses a server that's already running (e.g. `npm run dev`); otherwise starts one with Electron's own Node. */
async function ensureServer() {
  if (await healthy()) return;
  adoptDevData();
  mkdirSync(dataDir, { recursive: true });
  const log = openSync(path.join(dataDir, "server.log"), "a");
  // Installed builds carry the server as one bundled file (npm run build:server); the repo runs src/.
  const args = installed ? [path.join(root, "desktop", "build", "server.mjs")] : ["--import", "tsx", path.join(root, "src", "server", "main.ts")];
  server = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", TANGENT_DATA: dataDir, TANGENT_WEB: path.join(root, "web"), PORT: String(port) },
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  server.on("exit", code => { server = null; if (!quitting && code) dialog.showErrorBox("Tangent Graph", `The server stopped (code ${code}). See ${path.join(dataDir, "server.log")}.`); });
  for (let i = 0; i < 120; i++) {
    if (await healthy()) return;
    if (!server) break;
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`The server didn't start. See ${path.join(dataDir, "server.log")}.`);
}

// Where the window was last time, so it reopens in the same spot (and the same page mode).
const placeFile = () => path.join(app.getPath("userData"), "window.json");
function loadPlace() {
  try {
    const p = JSON.parse(readFileSync(placeFile(), "utf8"));
    const onScreen = screen.getAllDisplays().some(d => {
      const a = d.workArea;
      return p.x < a.x + a.width && p.x + p.width > a.x && p.y < a.y + a.height && p.y + p.height > a.y;
    });
    return onScreen ? p : null;
  } catch { return null; }
}
function savePlace() {
  if (!win) return;
  try { writeFileSync(placeFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch {}
}

function createWindow() {
  const place = loadPlace();
  win = new BrowserWindow({
    ...(place ? { x: place.x, y: place.y, width: place.width, height: place.height } : { width: 1280, height: 860 }),
    minWidth: 360, minHeight: 280,
    title: "Tangent Graph", icon, autoHideMenuBar: true, show: false, backgroundColor: "#111216",
    webPreferences: { preload: path.join(root, "desktop", "preload.cjs") },
  });
  win.loadURL(base);
  let wantMax = !place || place.maximized; // first launch opens maximized: full page
  const firstShow = () => { if (wantMax) win.maximize(); wantMax = false; };
  win.once("ready-to-show", () => { if (!startHidden) { win.show(); firstShow(); } });
  win.once("show", firstShow);
  for (const ev of ["moved", "resized", "maximize", "unmaximize", "hide"]) win.on(ev, savePlace);
  // Closing hides to the tray, so the hotkey can bring it back instantly. Quit from the tray.
  win.on("close", e => { if (!quitting) { e.preventDefault(); win.hide(); } });
  // Links in Claude's replies open in your browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(base)) { e.preventDefault(); shell.openExternal(url); } });
}

function show() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggle() {
  if (win?.isVisible() && win.isFocused()) win.hide();
  else show();
}

/** Moves the window to fit a page mode: full = maximized, half = right half, quarter = top-right quarter. */
function snap(mode) {
  if (!win || !["full", "half", "quarter"].includes(mode)) return;
  const b = boundsFor(mode, screen.getDisplayMatching(win.getBounds()).workArea);
  if (b === "maximize") return win.maximize();
  if (win.isMaximized()) win.unmaximize();
  win.setBounds(b);
}

/** Asks the page to switch mode (it snaps the window back through `snap`). */
function pickMode(mode) {
  show();
  win.webContents.send("set-mode", mode);
}

function createTray(hotkeyOk, updates) {
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip(`Tangent Graph ${app.getVersion()}` + (hotkeyOk ? ` (${HOTKEY.replace("Control", "Ctrl")})` : ""));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show Tangent Graph", accelerator: hotkeyOk ? HOTKEY : undefined, click: show },
    { type: "separator" },
    { label: "Full page", click: () => pickMode("full") },
    { label: "Half page", click: () => pickMode("half") },
    { label: "Quarter page (quick ask)", click: () => pickMode("quarter") },
    { type: "separator" },
    // Off by default. On, the app starts hidden at sign-in, so Ctrl+Alt+T always works.
    { label: process.platform === "darwin" ? "Open at login" : "Start with Windows", type: "checkbox",
      checked: app.getLoginItemSettings(loginItem).openAtLogin,
      click: item => app.setLoginItemSettings({ ...loginItem, openAtLogin: item.checked }) },
    { label: `Check for updates… (${app.getVersion()})`, click: () => updates.check() },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", toggle);
}

ipcMain.on("snap", (_e, mode) => snap(mode));

app.on("before-quit", () => { quitting = true; });
app.on("will-quit", () => { globalShortcut.unregisterAll(); server?.kill(); });

app.whenReady().then(async () => {
  app.setAppUserModelId("TangentGraph");
  try { await ensureServer(); }
  catch (e) { dialog.showErrorBox("Tangent Graph", e.message); quitting = true; app.quit(); return; }
  noteDevData();
  createWindow();
  const hotkeyOk = globalShortcut.register(HOTKEY, toggle);
  if (!hotkeyOk) console.warn(`${HOTKEY} is taken by another app; use the tray icon instead.`);
  createTray(hotkeyOk, setupUpdates({ beforeRestart: () => { quitting = true; } }));
});
