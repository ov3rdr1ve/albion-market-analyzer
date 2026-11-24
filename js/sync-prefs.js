/**
 * Team-sync settings the MAIN process needs (js/sync-folder.js reads them).
 *
 * Sibling of js/monitor-prefs.js and there for the same reason: these are read
 * while the window is still loading, long before any renderer storage exists.
 *
 * `deviceId` is the important one. It names the pair of files this install owns
 * in the shared folder — `peer-<deviceId>.json` and `peer-<deviceId>-prices.json`
 * — and it is what stops two clients ever writing the same path, which is the
 * only thing Dropbox cannot resolve without losing somebody's map. It is minted
 * once, on the first load, and kept for the life of the install. It lives in a
 * userData FILE rather than localStorage on purpose: the settings export bundle
 * carries localStorage, so a user importing their own settings onto a second box
 * would otherwise give both boxes the same id and both would fight over one file.
 *
 * Failure is never fatal: a missing, truncated or hand-edited file falls back to
 * the defaults, and the default is sync switched off.
 */

const SYNC_PREFS_FILENAME = "sync-prefs.json";

const DEFAULT_SYNC_PREFS = Object.freeze({
  enabled: false,
  folder: "",
  deviceId: "",
  deviceName: "",
  sharePrices: true,
});

/** Filename-safe and short enough to read out loud over voice comms. */
function randomDeviceId() {
  try {
    return require("crypto").randomUUID().replace(/-/g, "").slice(0, 8);
  } catch (e) {
    return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  }
}

/** Anything that could escape the folder or confuse the parser is not an id. */
function isSafeDeviceId(value) {
  return typeof value === "string" && /^[a-z0-9]{6,32}$/.test(value);
}

function coerce(raw, makeId) {
  const prefs = { ...DEFAULT_SYNC_PREFS };
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  if (typeof source.enabled === "boolean") prefs.enabled = source.enabled;
  if (typeof source.sharePrices === "boolean") prefs.sharePrices = source.sharePrices;
  if (typeof source.folder === "string") prefs.folder = source.folder.trim();
  if (typeof source.deviceName === "string") prefs.deviceName = source.deviceName.trim().slice(0, 40);
  prefs.deviceId = isSafeDeviceId(source.deviceId) ? source.deviceId : makeId();
  return prefs;
}

/**
 * @param {object} options
 * @param {string} options.file  full path to the prefs file
 * @param {(f:string)=>string} [options.readFile]  reads it as UTF-8
 * @param {()=>string} [options.makeId]  device id source, injected by the tests
 */
function loadSyncPrefs({
  file,
  readFile = (f) => require("fs").readFileSync(f, "utf8"),
  makeId = randomDeviceId,
} = {}) {
  let text;
  try { text = readFile(file); } catch (e) { return coerce(null, makeId); }
  try { return coerce(JSON.parse(text), makeId); } catch (e) { return coerce(null, makeId); }
}

/**
 * @returns {object} the merged prefs — returned even when the write failed, so
 *   the current session honours the choice the user just made.
 */
function saveSyncPrefs({
  file,
  writeFile = (f, d) => require("fs").writeFileSync(f, d),
  prefs,
  makeId = randomDeviceId,
} = {}) {
  const merged = coerce(prefs, makeId);
  try { writeFile(file, JSON.stringify(merged, null, 2)); } catch (e) { /* read-only profile */ }
  return merged;
}

module.exports = {
  SYNC_PREFS_FILENAME,
  DEFAULT_SYNC_PREFS,
  randomDeviceId,
  isSafeDeviceId,
  loadSyncPrefs,
  saveSyncPrefs,
};
