/**
 * Renderer bridges.
 *
 * The window keeps Electron's secure defaults (contextIsolation on, no node
 * integration), so the page never touches the capture library itself. It only
 * receives what the main process pushes over IPC, plus a few narrow calls.
 */

const { contextBridge, ipcRenderer } = require("electron");

/**
 * Prices from the Scan buttons, kept between sessions.
 *
 * They cannot go in the page's localStorage — a full scan is tens of megabytes
 * across three maps, past the quota — so the bundle crosses to the main
 * process and lives as a JSON file under userData. The page decides what is
 * still worth restoring (js/scan-price-store.js); this is only the pipe.
 */
contextBridge.exposeInMainWorld("scanPriceStore", {
  /** The stored bundle, or null when there is none / it is unreadable. */
  load: () => ipcRenderer.invoke("scanPrices:load"),
  /** Resolves true when the write landed. */
  save: (bundle) => ipcRenderer.invoke("scanPrices:save", bundle),
});

/**
 * Prices the live monitor captured, kept between sessions.
 *
 * Same pipe, same reason: a week of captures is megabytes, and localStorage
 * drops that write silently once the quota goes — taking the crafting list and
 * the price overrides sharing that quota with it. See
 * js/captured-prices-store.js for what is worth keeping.
 */
/**
 * The window's zoom factor, driven by the header Zoom picker and Ctrl+=/-/0
 * (js/app-zoom.js). Clamped main-side; the page only asks.
 */
contextBridge.exposeInMainWorld("appZoom", {
  set: (factor) => ipcRenderer.invoke("app:setZoom", factor),
});

/**
 * Team sync: one shared folder, one file per player.
 *
 * The page owns every decision here — what to publish, when, and how a peer's
 * portals merge with its own (js/team-sync-loop.js, js/team-sync-payload.js).
 * Main only lists, reads and writes, so this bridge is four calls wide and
 * carries plain text in both directions.
 */
contextBridge.exposeInMainWorld("teamSync", {
  /** {enabled, folder, deviceId, deviceName, sharePrices}. */
  getPrefs: () => ipcRenderer.invoke("sync:getPrefs"),
  /** Merges a patch; deviceId is machine-owned and ignored here. */
  setPrefs: (patch) => ipcRenderer.invoke("sync:setPrefs", patch),
  /** Opens the folder picker; resolves the prefs, unchanged if cancelled. */
  pickFolder: () => ipcRenderer.invoke("sync:pickFolder"),
  /** {ok, peers:[{name, deviceId, kind, mtimeMs, text}], mtimes, error}. */
  readPeers: (seen) => ipcRenderer.invoke("sync:readPeers", seen),
  /** kind is "portals" | "prices". Resolves {ok, error}. */
  publish: (kind, text) => ipcRenderer.invoke("sync:publish", kind, text),
});

contextBridge.exposeInMainWorld("capturedPriceStore", {
  /** The stored quality map, or null when there is none / it is unreadable. */
  load: () => ipcRenderer.invoke("capturedPrices:load"),
  /** Resolves true when the write landed. */
  save: (map) => ipcRenderer.invoke("capturedPrices:save", map),
});

/**
 * The same capture, seen from the market side: price patches the main process
 * has already decoded, plus the switch that controls whether readings are
 * contributed back to the Albion Online Data Project.
 */
contextBridge.exposeInMainWorld("marketMonitor", {
  /** Called with {prices, city, locationId, count} per captured market page. */
  onPrices(callback) {
    if (typeof callback !== "function") return;
    ipcRenderer.on("monitor:prices", (_event, update) => callback(update));
  },
  /**
   * Called with {books, action, city} whenever the game says something about
   * an order of the player's own. `books` maps "item|quality|city|side" to the
   * prices standing in the player's name, so a table can stop quoting them
   * back as if they were the market.
   */
  onOwnOrders(callback) {
    if (typeof callback !== "function") return;
    ipcRenderer.on("monitor:own-orders", (_event, update) => callback(update));
  },
  /** Called with {status, message}. */
  onStatus(callback) {
    if (typeof callback !== "function") return;
    ipcRenderer.on("monitor:status", (_event, state) => callback(state));
  },
  /**
   * Called with {locationId, city, at} every time the game names the player's
   * location. Separate from onPrices: the city has to be able to change without
   * a market being opened, which is what let a stale city outlive the position.
   */
  onLocation(callback) {
    if (typeof callback !== "function") return;
    ipcRenderer.on("monitor:location", (_event, loc) => callback(loc));
  },
  /** Called every few seconds with the running counters. */
  onStats(callback) {
    if (typeof callback !== "function") return;
    ipcRenderer.on("monitor:stats", (_event, stats) => callback(stats));
  },
  start: () => ipcRenderer.invoke("monitor:start"),
  stop: () => ipcRenderer.invoke("monitor:stop"),
  status: () => ipcRenderer.invoke("monitor:status"),
  setUpload: (on) => ipcRenderer.invoke("monitor:setUpload", !!on),
  /** Whether the capture opens with the app. Stored main-side, not in localStorage. */
  getAutoStart: () => ipcRenderer.invoke("monitor:getAutoStart"),
  setAutoStart: (on) => ipcRenderer.invoke("monitor:setAutoStart", !!on),
  /** {installed, downloadUrl} for the npcap capture driver. */
  npcap: () => ipcRenderer.invoke("monitor:npcap"),
  /** Opens the install prompt; resolves {installed} once the user is done with it. */
  installNpcap: () => ipcRenderer.invoke("monitor:installNpcap"),
  /** Name the market location by hand; "" goes back to reading it off the wire. */
  setCity: (locationId) => ipcRenderer.invoke("monitor:setCity", locationId || ""),
});
