// Electron main process for the Albion Market Analyzer.
//
// The app itself is a self-contained static site (index.html + js/ + css/).
// It talks only to the public Albion Online Data Project API over HTTPS
// (CORS: access-control-allow-origin: *), so the renderer keeps the secure
// defaults — no Node integration, context isolation on — and just loads the
// local index.html.

const {
  app, BrowserWindow, shell, ipcMain, dialog, crashReporter, utilityProcess,
} = require("electron");
const path = require("path");
const {
  isNpcapInstalled,
  findBundledNpcapInstaller,
  npcapAction,
  NPCAP_DOWNLOAD_URL,
} = require("./js/npcap-status.js");
const { loadMonitorPrefs, saveMonitorPrefs } = require("./js/monitor-prefs.js");
const { mainWindowOptions, bootWindows } = require("./js/app-boot.js");
const {
  SCAN_PRICES_FILENAME,
  loadScanPricesFile,
  saveScanPricesFile,
} = require("./js/scan-price-file.js");
const {
  CAPTURED_PRICES_FILENAME,
  loadCapturedPricesFile,
  saveCapturedPricesFile,
} = require("./js/captured-price-file.js");
const { SYNC_PREFS_FILENAME, loadSyncPrefs, saveSyncPrefs } = require("./js/sync-prefs.js");
const { readPeerFiles, writeOwnFile } = require("./js/sync-folder.js");
const { applyGpuPreference } = require("./js/gpu-preference.js");
const { installCrashGuard } = require("./js/crash-guard.js");

// Evidence, before anything can die: the crash reporter (so a crash leaves a
// .dmp under userData/Crashpad) plus listeners that log every abnormal exit —
// uncaught exceptions, gone child processes and renderers, the quit path — to
// a daily file under userData/logs. The 2026-09-20 crash left one stderr line
// and no dump, because nothing had started the reporter. See js/crash-guard.js.
const { logger } = installCrashGuard({
  app,
  crashReporter,
  logDir: path.join(app.getPath("userData"), "logs"),
});

// Before `ready`, or Chromium ignores it: render on the discrete GPU. The
// integrated one froze the window at boot — see js/gpu-preference.js.
applyGpuPreference(app.commandLine);

// A single shared window. Kept in module scope so `activate` can detect it.
let mainWindow = null;

// Live capture. Optional by design: it needs the native `cap` module plus the
// npcap driver, and the rest of the app must work without either. Nothing
// starts until the renderer asks — see the Start Monitor button.
//
// ONE capture feeds everything: this app's prices and the
// contribution back to the Albion Online Data Project the Scan button reads.
let session = null;
let monitorStatus = { status: "idle", message: "not started" };
let uploadEnabled = true;
let statsTimer = null;
// The market location is only announced on a zone Join, so a capture started
// while the player already stands in the city never learns one and drops every
// order. This is the answer to that: a city named by hand, which the next real
// Join overrides. Restored from the prefs file on ready, because the capture
// auto-starts before the page can push it.
let seededLocation = "";
// Settings the capture needs before the page exists: whether it starts by
// itself, and the city it files prices under. Loaded on ready; see
// js/monitor-prefs.js.
let prefs = { autoStart: true, captureCity: "" };
// Team sync: which shared folder this install reads and writes, and the device
// id naming the files it owns in it. Loaded on ready; see js/sync-prefs.js.
let syncPrefs = null;
// One npcap dialog at a time: the check runs on auto-start AND on every Start
// click, and a user who leaves the prompt open must not collect a stack of them.
let npcapPromptOpen = false;

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function prefsFile() {
  return path.join(app.getPath("userData"), "monitor-prefs.json");
}

function scanPricesFile() {
  return path.join(app.getPath("userData"), SCAN_PRICES_FILENAME);
}

function capturedPricesFile() {
  return path.join(app.getPath("userData"), CAPTURED_PRICES_FILENAME);
}

function syncPrefsFile() {
  return path.join(app.getPath("userData"), SYNC_PREFS_FILENAME);
}

/**
 * The sync settings, minting this install's device id on first use.
 *
 * A minted id is written back straight away. It names the files this box owns
 * in the shared folder, so an id that only lived in memory would leave a fresh
 * pair of orphans behind on every launch — and nothing in a shared folder ever
 * cleans those up.
 */
function currentSyncPrefs() {
  if (syncPrefs) return syncPrefs;
  const file = syncPrefsFile();
  // An empty id from this load means the file had none to give.
  const stored = loadSyncPrefs({ file, makeId: () => "" });
  syncPrefs = stored.deviceId ? stored : saveSyncPrefs({ file, prefs: stored });
  return syncPrefs;
}

/**
 * Where a licensed Npcap OEM installer would sit if this package was built with
 * one. Public builds have neither the directory nor the right to ship it — see
 * js/npcap-status.js — so this is expected to come back empty.
 */
function npcapBundleDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "npcap")
    : path.join(__dirname, "build", "npcap");
}

function setUnavailable(message) {
  monitorStatus = { status: "unavailable", message, running: false };
  sendToRenderer("monitor:status", monitorStatus);
  return monitorStatus;
}

/**
 * Ask the user to install the capture driver, then either run the bundled
 * installer or open npcap.com. Never blocks the caller: the monitor simply
 * stays unavailable, and the next Start click re-checks.
 */
async function promptNpcap() {
  if (npcapPromptOpen) return;
  npcapPromptOpen = true;
  try {
    const action = npcapAction({
      installed: false,
      bundledInstaller: findBundledNpcapInstaller({ dir: npcapBundleDir() }),
    });
    const first = action.kind === "run" ? "Install Npcap…" : "Open download page";
    const { response } = await dialog.showMessageBox(mainWindow || undefined, {
      type: "warning",
      buttons: [first, "Not now"],
      defaultId: 0,
      cancelId: 1,
      title: "Npcap required",
      message: "The live market monitor needs the Npcap capture driver.",
      detail:
        "Npcap is a separate Windows driver that lets this app read the game's own "
        + "market traffic. Everything else — scanning, crafting, flipping — works without it.\n\n"
        + (action.kind === "run"
          ? "The installer bundled with this app will open now. Accept its defaults."
          : `Install it from ${NPCAP_DOWNLOAD_URL} (accept the default options), then restart this app.`),
    });
    if (response !== 0) return;
    if (action.kind === "run") {
      // The free Npcap installer has no silent mode (/S is OEM-only), so this is
      // a normal, visible install the user clicks through.
      const error = await shell.openPath(action.target);
      if (error) await shell.openExternal(NPCAP_DOWNLOAD_URL);
    } else {
      await shell.openExternal(action.target);
    }
  } catch (e) {
    /* a failed dialog must not take the app down */
  } finally {
    npcapPromptOpen = false;
  }
}

function buildSession() {
  const { createMonitorSession } = require("./js/monitor-session.js");
  const { createSupervisedSniffer } = require("./js/sniffer-supervisor.js");
  const { createAodpUploader } = require("./js/aodp-uploader.js");

  let sniffer = null;
  const uploader = createAodpUploader({
    getServerIp: () => (sniffer ? sniffer.serverIp : null),
    isEnabled: () => uploadEnabled,
  });

  return createMonitorSession({
    // cap runs in the "albion-capture" utility process: its native close-path
    // fault then kills only that process, which is restarted, instead of the
    // whole app. Same surface as the sniffer — see js/sniffer-supervisor.js.
    createSniffer: (hooks) => {
      sniffer = createSupervisedSniffer({
        ...hooks,
        fork: (...args) => utilityProcess.fork(...args),
        entryPath: path.join(__dirname, "js", "sniffer-host.js"),
        logger,
      });
      return sniffer;
    },
    upload: (payload, topic) => uploader.upload(payload, topic),
    isUploadEnabled: () => uploadEnabled,
    onPrices: (update) => sendToRenderer("monitor:prices", update),
    onOwnOrders: (update) => sendToRenderer("monitor:own-orders", update),
    onLocation: (loc) => sendToRenderer("monitor:location", loc),
    // `running` is the tap's real state, not an inference from the message: the
    // sniffer reports "idle" after a silent adapter while the capture stays
    // open, and the button has to keep offering Stop for that.
    onStatus: (state) => {
      monitorStatus = { ...state, running: !!(session && session.running) };
      sendToRenderer("monitor:status", monitorStatus);
    },
  });
}

function startMonitor() {
  if (session && session.running) return monitorStatus;
  // Checked before the native module is even loaded: without the driver `cap`
  // throws a message about a missing DLL, which tells the user nothing about
  // what to install.
  if (!isNpcapInstalled()) {
    promptNpcap();
    return setUnavailable("npcap capture driver not installed");
  }
  try {
    if (!session) session = buildSession();
    if (seededLocation) session.seedLocation(seededLocation);
    session.start();
    if (!statsTimer) {
      statsTimer = setInterval(() => {
        if (session && session.running) {
          sendToRenderer("monitor:stats", {
            ...session.stats,
            diagnostics: session.diagnostics,
          });
        }
      }, 5000);
    }
  } catch (e) {
    monitorStatus = { status: "unavailable", message: e.message };
    sendToRenderer("monitor:status", monitorStatus);
  }
  return monitorStatus;
}

function stopMonitor() {
  if (session) session.stop();
  if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
  return monitorStatus;
}

ipcMain.handle("monitor:start", () => startMonitor());
ipcMain.handle("monitor:stop", () => stopMonitor());
ipcMain.handle("monitor:status", () => monitorStatus);
ipcMain.handle("monitor:setUpload", (_event, on) => { uploadEnabled = !!on; return uploadEnabled; });
ipcMain.handle("monitor:setCity", (_event, locationId) => {
  seededLocation = typeof locationId === "string" ? locationId.trim() : "";
  // Persisted, not just held: the capture opens with the app, before the page
  // exists to push this, and orders captured in that window need a city.
  prefs = saveMonitorPrefs({ file: prefsFile(), prefs: { ...prefs, captureCity: seededLocation } });
  if (session && seededLocation) session.seedLocation(seededLocation);
  return seededLocation;
});

ipcMain.handle("monitor:getAutoStart", () => prefs.autoStart);
ipcMain.handle("monitor:setAutoStart", (_event, on) => {
  prefs = saveMonitorPrefs({ file: prefsFile(), prefs: { ...prefs, autoStart: !!on } });
  return prefs.autoStart;
});
// What the page shows when the capture is unavailable, and the way back from it.
ipcMain.handle("monitor:npcap", () => ({
  installed: isNpcapInstalled(),
  downloadUrl: NPCAP_DOWNLOAD_URL,
}));
ipcMain.handle("monitor:installNpcap", async () => {
  if (isNpcapInstalled()) return { installed: true };
  await promptNpcap();
  return { installed: isNpcapInstalled() };
});

// Scanned prices. A full scan is tens of megabytes across three maps — far
// past what localStorage will hold — so the renderer hands the bundle here and
// it lands as one JSON file under userData. Validation (schema version, age)
// is the renderer's job; see js/scan-price-store.js.
ipcMain.handle("scanPrices:load", () => loadScanPricesFile({ file: scanPricesFile() }));
ipcMain.handle("scanPrices:save", (_event, bundle) =>
  saveScanPricesFile({ file: scanPricesFile(), bundle }));

// Captured prices, same deal. These used to sit in localStorage, where a week
// of captures is past the quota — and a quota error there is silent and takes
// the crafting list and the price overrides down with it. Age and cell caps
// stay the renderer's job; see js/captured-prices-store.js.
ipcMain.handle("capturedPrices:load", () => loadCapturedPricesFile({ file: capturedPricesFile() }));
ipcMain.handle("capturedPrices:save", (_event, map) =>
  saveCapturedPricesFile({ file: capturedPricesFile(), map }));

// Team sync through a shared folder (Dropbox, OneDrive, a network drive — the
// app neither knows nor cares which). Main is the transport only: it lists,
// reads and writes files. What a payload means, and how two people's portals
// merge, stays in the renderer next to the graph — see js/team-sync-payload.js.
ipcMain.handle("sync:getPrefs", () => currentSyncPrefs());
ipcMain.handle("sync:setPrefs", (_event, patch) => {
  const current = currentSyncPrefs();
  const next = patch && typeof patch === "object" ? patch : {};
  // The device id is never taken from the renderer: it is this machine's
  // identity in the folder, not a setting.
  syncPrefs = saveSyncPrefs({
    file: syncPrefsFile(),
    prefs: { ...current, ...next, deviceId: current.deviceId },
  });
  return syncPrefs;
});

/** The folder picker. Cancelling returns the folder that was already set. */
ipcMain.handle("sync:pickFolder", async () => {
  const current = currentSyncPrefs();
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow || undefined, {
    title: "Choose the shared folder",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: current.folder || undefined,
  });
  if (canceled || !filePaths || !filePaths[0]) return current;
  syncPrefs = saveSyncPrefs({
    file: syncPrefsFile(),
    prefs: { ...current, folder: filePaths[0] },
  });
  return syncPrefs;
});

ipcMain.handle("sync:readPeers", (_event, seen) => {
  const current = currentSyncPrefs();
  if (!current.enabled) return { ok: false, peers: [], mtimes: {}, error: "sync is off" };
  return readPeerFiles({ folder: current.folder, deviceId: current.deviceId, seen });
});

ipcMain.handle("sync:publish", (_event, kind, text) => {
  const current = currentSyncPrefs();
  if (!current.enabled) return { ok: false, error: "sync is off" };
  if (kind === "prices" && !current.sharePrices) return { ok: false, error: "prices are not shared" };
  return writeOwnFile({ folder: current.folder, deviceId: current.deviceId, kind, text });
});

// Display size. The widest tables run to 17 columns, so a scroll wrapper alone
// cannot make them fit; see js/app-zoom.js. Done through the window's own zoom
// factor rather than a CSS transform so hit-testing and scrollbars stay right.
ipcMain.handle("app:setZoom", (_event, factor) => {
  const n = Number(factor);
  if (!Number.isFinite(n) || n <= 0) return false;
  const clamped = Math.min(1.5, Math.max(0.5, n));
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.webContents.setZoomFactor(clamped);
  return true;
});

function createWindow() {
  // Built hidden; bootWindows() shows it once the renderer has painted.
  mainWindow = new BrowserWindow(
    mainWindowOptions({ preloadPath: path.join(__dirname, "preload.js") }),
  );

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  // Any window.open / target=_blank (e.g. links to the wiki) opens in the
  // user's real browser instead of a frameless Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Keep in-page navigation from replacing the app with an external site.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow.webContents.getURL();
    if (url !== current && (url.startsWith("http://") || url.startsWith("https://"))) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Single-instance lock: re-launching focuses the existing window instead of
// opening a second copy.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    prefs = loadMonitorPrefs({ file: prefsFile() });
    // Before the window: the capture may open as soon as the page loads, and a
    // city that lands after it does nothing for the orders already sniffed.
    if (prefs.captureCity) seededLocation = prefs.captureCity;
    createWindow();
    bootWindows({
      main: mainWindow,
      // Whichever arrives first. `dom-ready` means the page is parsed, so the
      // headings and the per-table loading rows are there to be painted, which
      // is enough to show the window — and it arrives even when
      // `ready-to-show` does not.
      readyOn: [
        [mainWindow, "ready-to-show"],
        [mainWindow.webContents, "dom-ready"],
      ],
      onShown: (reason, ms) => console.log(`[boot] window shown after ${ms}ms (${reason})`),
    });

    // Auto-start. The capture is the app's only source of live prices, and there is nothing to configure before it runs — so
    // it opens with the app rather than waiting for a click. Waiting for the
    // page keeps the first status line from being sent into a dead window, and
    // lets the renderer's saved capture city land first.
    mainWindow.webContents.once("did-finish-load", () => {
      if (prefs.autoStart) {
        if (!isNpcapInstalled()) {
          setUnavailable("npcap capture driver not installed");
          promptNpcap();
        } else {
          startMonitor();
        }
      }
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length !== 0) return;
      // Same rule as the first launch: the window is created hidden, so
      // something has to show it.
      createWindow();
      bootWindows({ main: mainWindow });
    });
  });
}

app.on("before-quit", () => {
  // Lets the capture process close its handle instead of being torn down mid-packet.
  stopMonitor();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
