// Electron main process for the Interview Coach desktop overlay.
// Wraps the existing Next.js app in an always-on-top floating window with
// global hotkeys and system-audio capture, so it can sit on top of a live
// Zoom/Meet/Teams call.
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  session,
  desktopCapturer,
} = require("electron");
const path = require("path");
const net = require("net");
const fs = require("fs");
const { spawn } = require("child_process");

// Optional: present only in packaged builds. Guarded so dev/source runs don't
// fail if it isn't installed.
let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch {
  autoUpdater = null;
}

// Pin a space-free app name so userData / log / DB paths are deterministic and
// safe for the Prisma SQLite file: URL (%APPDATA%\InterviewCoach). The
// user-facing product name is still "Interview Coach" (build.productName).
// Must run before the app is ready.
app.setName("InterviewCoach");

const isDev = process.env.ELECTRON_DEV === "1";
const PORT = Number(process.env.PORT || 3000);
// Use an explicit IPv4 host for both the server bind and the window URL.
// "localhost" can resolve to IPv6 (::1) on Windows while the server listens on
// IPv4 (127.0.0.1), which produces a blank/black window.
const HOST = "127.0.0.1";
const APP_URL = `http://${HOST}:${PORT}/session`;

/** @type {import("electron").BrowserWindow | null} */
let mainWindow = null;
/** @type {import("child_process").ChildProcess | null} */
let serverProcess = null;
let pinned = true;
// Window opacity, cycled from the titlebar. 1 = opaque.
const OPACITY_STEPS = [1, 0.9, 0.8, 0.7, 0.6];
let currentOpacity = 0.9;
// Stealth: exclude the overlay from screen capture / screen share (and hide it
// from the taskbar). ON by default — it stays fully visible on the physical
// screen but is invisible to Zoom/Meet/Teams share, OBS, and screenshots. The
// renderer re-syncs this to the user's persisted setting shortly after load.
let stealthEnabled = true;

/** Apply the current stealth state to the window (content protection + taskbar). */
function applyStealth(enabled) {
  stealthEnabled = Boolean(enabled);
  if (!mainWindow) return;
  // setContentProtection -> WDA_EXCLUDEFROMCAPTURE (Windows) / sharingType none (macOS).
  mainWindow.setContentProtection(stealthEnabled);
  mainWindow.setSkipTaskbar(stealthEnabled);
}

/** Flip stealth and notify the renderer so its UI stays in sync (used by hotkey). */
function toggleStealth() {
  applyStealth(!stealthEnabled);
  mainWindow?.webContents.send("stealth-changed", stealthEnabled);
  return stealthEnabled;
}

// Append diagnostics to log files so packaged runs are debuggable (the GUI
// process has no attached console). Written to both userData and the temp dir
// so it's easy to find: %APPDATA%\Interview Coach\main.log and
// %TEMP%\interview-coach-main.log.
let logTargets = null;
function logFilePaths() {
  if (logTargets) return logTargets;
  if (!app.isReady()) return [];
  logTargets = [
    path.join(app.getPath("userData"), "main.log"),
    path.join(app.getPath("temp"), "interview-coach-main.log"),
  ];
  return logTargets;
}
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => String(a)).join(" ")}`;
  for (const file of logFilePaths()) {
    try {
      fs.appendFileSync(file, `${line}\n`);
    } catch {
      // ignore logging failures
    }
  }
  console.log(line);
}

function waitForPort(port, host = HOST, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const attempt = () => {
      const socket = net.connect(port, host);
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for http://${host}:${port}`));
        } else {
          setTimeout(attempt, 400);
        }
      });
    };
    attempt();
  });
}

// In a packaged build the SQLite file must live somewhere writable (the app
// directory is read-only). Seed it from the bundled template on first launch.
function resolvePackagedDatabaseUrl() {
  const userDb = path.join(app.getPath("userData"), "interview-coach.db");
  if (!fs.existsSync(userDb)) {
    const seed = path.join(process.resourcesPath, "seed.db");
    if (fs.existsSync(seed)) fs.copyFileSync(seed, userDb);
  }
  // Prisma's SQLite connector is happier with forward slashes; backslashes in
  // the file: URL can be misinterpreted on Windows.
  return `file:${userDb.replace(/\\/g, "/")}`;
}

async function ensureServer() {
  // 1. Dev: the Next dev server is started separately (npm run electron:dev).
  if (isDev) {
    await waitForPort(PORT);
    return;
  }

  // 2. Packaged installer: run the bundled standalone server with Electron's
  //    own Node (no npm/node_modules on the user's machine).
  if (app.isPackaged) {
    const appDir = path.join(process.resourcesPath, "server");
    const serverJs = path.join(appDir, "server.js");
    const dbUrl = resolvePackagedDatabaseUrl();
    log("starting server:", serverJs, "exists:", fs.existsSync(serverJs));
    log("database:", dbUrl);

    serverProcess = spawn(process.execPath, [serverJs], {
      cwd: appDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        PORT: String(PORT),
        HOSTNAME: HOST,
        DATABASE_URL: dbUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverProcess.stdout?.on("data", (d) => log("[server]", d.toString().trim()));
    serverProcess.stderr?.on("data", (d) => log("[server:err]", d.toString().trim()));
    serverProcess.on("exit", (code) => log("[server] exited with code", code));

    await waitForPort(PORT);
    log("server is up on", `${HOST}:${PORT}`);
    return;
  }

  // 3. Unpackaged production (npm run electron:start) - run from source.
  const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
  serverProcess = spawn(cmd, ["run", "start"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT) },
    stdio: "inherit",
  });
  await waitForPort(PORT);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    minWidth: 300,
    minHeight: 380,
    frame: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: "#0b0b0f",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  // Start slightly translucent so it blends over the call. Adjustable from the
  // titlebar.
  mainWindow.setOpacity(currentOpacity);
  // Exclude from screen capture immediately, before the first frame is shown,
  // so there's never a capturable moment.
  applyStealth(stealthEnabled);
  if (process.platform !== "win32") {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  // Auto-grant getDisplayMedia so capturing the meeting / system audio does not
  // prompt a picker every time. Falls back gracefully to mic-only if loopback
  // audio is unsupported on the platform.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => {
          if (sources.length > 0) {
            callback({ video: sources[0], audio: "loopback" });
          } else {
            callback({});
          }
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false }
  );

  // Retry the load a few times — on first launch the server may need a moment.
  let loadAttempts = 0;
  const tryLoad = () => {
    loadAttempts += 1;
    mainWindow?.loadURL(APP_URL).catch((err) => log("loadURL error:", err.message));
  };

  mainWindow.webContents.on(
    "did-fail-load",
    (_e, code, desc, url, isMainFrame) => {
      // -3 is ERR_ABORTED (a navigation superseded by another) — not a failure.
      if (!isMainFrame || code === -3) return;
      log("did-fail-load", code, desc, url, "attempt", loadAttempts);
      if (loadAttempts < 30) setTimeout(tryLoad, 700);
    }
  );

  tryLoad();
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  // Safety net: reveal the window even if "ready-to-show" never fires.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
  }, 5000);
}

function registerShortcuts() {
  // Generate an answer from anywhere, even when the call window is focused.
  globalShortcut.register("CommandOrControl+Shift+Enter", () => {
    mainWindow?.webContents.send("global-generate");
  });

  // Show / hide the overlay quickly.
  globalShortcut.register("CommandOrControl+Shift+Backslash", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else mainWindow.show();
  });

  // Toggle stealth (screen-capture exclusion) from anywhere.
  globalShortcut.register("CommandOrControl+Shift+S", () => {
    toggleStealth();
  });

  // Toggle the live-coding copilot panel from anywhere.
  globalShortcut.register("CommandOrControl+Shift+C", () => {
    mainWindow?.webContents.send("coding-toggle");
  });

  // Capture the shared screen into the coding panel from anywhere.
  globalShortcut.register("CommandOrControl+Shift+2", () => {
    mainWindow?.webContents.send("coding-capture");
  });
}

ipcMain.on("win:minimize", () => mainWindow?.minimize());
ipcMain.on("win:close", () => mainWindow?.close());
ipcMain.handle("win:toggle-pin", () => {
  pinned = !pinned;
  mainWindow?.setAlwaysOnTop(pinned, "screen-saver");
  return pinned;
});

// Cycle the overlay opacity (1 -> 0.9 -> ... -> 0.6 -> 1). Returns the new value.
ipcMain.handle("win:cycle-opacity", () => {
  const idx = OPACITY_STEPS.findIndex((v) => Math.abs(v - currentOpacity) < 0.01);
  currentOpacity = OPACITY_STEPS[(idx + 1) % OPACITY_STEPS.length];
  mainWindow?.setOpacity(currentOpacity);
  return currentOpacity;
});

// Stealth (screen-capture exclusion) controls.
ipcMain.handle("stealth:get", () => stealthEnabled);
ipcMain.handle("stealth:set", (_e, enabled) => {
  applyStealth(enabled);
  // Broadcast so any other UI (e.g. the titlebar shield) stays in sync.
  mainWindow?.webContents.send("stealth-changed", stealthEnabled);
  return stealthEnabled;
});
ipcMain.handle("stealth:toggle", () => toggleStealth());

/* --------------------------- Live coding capture --------------------------- */
// Screenshot the shared screen/window for the coding copilot. Because the
// overlay has content protection ON (stealth), it is excluded from these
// captures on Windows/macOS — the frame shows what's BEHIND our window, so the
// candidate can screenshot the problem without capturing the copilot itself.

// List available capture sources (screens + windows) so the candidate picks one
// once at the start — important for multi-monitor setups. Thumbnails are small
// (just for the picker); the real capture is taken at higher resolution.
ipcMain.handle("coding:list-sources", async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 200 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      displayId: s.display_id || "",
    }));
  } catch (err) {
    log("coding:list-sources failed:", err instanceof Error ? err.message : String(err));
    return [];
  }
});

// Capture a fresh, high-resolution frame of the chosen source as a PNG data URL.
// Falls back to the first screen if the id is stale (e.g. a window closed).
ipcMain.handle("coding:capture", async (_e, sourceId) => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 2560, height: 1600 },
    });
    const src =
      sources.find((s) => s.id === sourceId) ||
      sources.find((s) => s.id.startsWith("screen")) ||
      sources[0];
    if (!src) return null;
    return src.thumbnail.toDataURL();
  } catch (err) {
    log("coding:capture failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
});

/* --------------------- Windows Live Captions bridge --------------------- */
// Reads the on-device Live Captions text via a PowerShell + UI Automation
// sidecar and streams new caption strings to the renderer.
/** @type {import("child_process").ChildProcess | null} */
let captionProc = null;

function stopCaptions() {
  if (captionProc && !captionProc.killed) captionProc.kill();
  captionProc = null;
}

ipcMain.on("livecaptions:start", (event) => {
  if (process.platform !== "win32") {
    event.sender.send("live-caption-error", "Live Captions capture is Windows-only.");
    return;
  }
  if (captionProc) return;

  // The script is read by an external process (powershell.exe), which cannot
  // see inside app.asar — resolve to the unpacked copy.
  const script = path
    .join(__dirname, "livecaptions.ps1")
    .replace("app.asar", "app.asar.unpacked");
  captionProc = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
    { windowsHide: true }
  );

  let buffer = "";
  captionProc.stdout?.on("data", (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj.text === "string") {
          event.sender.send("live-caption-text", obj.text);
        }
      } catch {
        // Ignore non-JSON noise.
      }
    }
  });
  captionProc.stderr?.on("data", (d) => console.error("[livecaptions]", d.toString()));
  captionProc.on("error", (err) => {
    event.sender.send("live-caption-error", err.message);
    captionProc = null;
  });
  captionProc.on("exit", () => {
    captionProc = null;
  });
});

ipcMain.on("livecaptions:stop", () => stopCaptions());

app.whenReady().then(async () => {
  log("app ready. packaged:", app.isPackaged, "resources:", process.resourcesPath);
  try {
    await ensureServer();
  } catch (err) {
    log("ensureServer failed:", err instanceof Error ? err.message : String(err));
  }
  createWindow();
  registerShortcuts();

  // Check GitHub Releases for a newer version and install it in the background.
  if (app.isPackaged && autoUpdater) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error("[updater]", err);
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopCaptions();
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});
