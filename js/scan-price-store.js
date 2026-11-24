/**
 * Persistence for prices pulled by the market SCAN buttons.
 *
 * The monitor's captures already survive a restart (captured-prices-store.js);
 * a scan did not. "Scan Market Now" assigned lastMarketData and the two
 * companion maps and that was the whole story — close the app and every table
 * was empty again until the user sat through another full scan.
 *
 * localStorage is not where this can live. A full scan is thousands of items
 * across nine cities in three maps: several megabytes of JSON, at or over the
 * 5 MB quota, and stringifying it on the main thread besides. So the bundle
 * goes to a JSON file under userData through the main process
 * (js/scan-price-file.js, `scanPrices:*` IPC) and this file keeps only the
 * parts worth testing: what a bundle is, when one is too old to trust, and the
 * deferred write that stops a burst of per-table scans from writing megabytes
 * a dozen times over.
 *
 * Freshness is PER CELL, on each entry's own sell/buy date. It used to be
 * bundle-wide, on the save stamp, and that was a reported data-loss bug: three
 * days without pressing Scan and every price in the file went at once — taking
 * with it the monitor captures that had been folded into the same bundle
 * minutes earlier. A cell ages out on its own now, and the tables already badge
 * each one's age (formatPriceAge in js/app.js), so nothing stale is shown
 * unlabelled.
 *
 * A cell is now kept until a newer reading of it arrives — same rule as the
 * capture store, and the only thing that removes one. The fortnight this used
 * to enforce was still deleting data the user could not get back: captures
 * folded into this bundle are the only artifact prices that exist anywhere, and
 * the age badge already tells the truth about how old a row is.
 *
 * `maxAgeMs` survives as an OPTION, for a caller that genuinely wants a window.
 */

const SCAN_BUNDLE_VERSION = 1;
// No age limit: a restored cell is replaced by a newer reading, never expired.
const SCAN_MAX_CELL_AGE_MS = Infinity;
// A per-table scan burst (Scan Planner then Scan Crafting then Scan Flipping)
// coalesces into one write instead of three multi-megabyte ones.
const SCAN_SAVE_DEBOUNCE_MS = 1500;

/** Pending deferred save: the timer, the clock it was armed on, its options. */
let scanSaveTimer = null;
let scanSaveTimers = null;
let scanSavePending = null;

function scanOpt(options, key, fallback) {
  return options && options[key] !== undefined ? options[key] : fallback;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asMap(value) {
  return isPlainObject(value) ? value : {};
}

function mapHasCells(map) {
  return isPlainObject(map) && Object.keys(map).length > 0;
}

/**
 * Wrap the three in-memory price maps as one storable bundle.
 * @param {object} options
 * @param {object} [options.flat]     lastMarketData      {item: {city: entry}}
 * @param {object} [options.quality]  lastQualityMarketData {item: {q: {city}}}
 * @param {object} [options.mp]       lastMpMarketData    {item: {city: entry}}
 * @param {number} [options.now]      save stamp, epoch ms
 */
function buildScanBundle({ flat, quality, mp, now = Date.now() } = {}) {
  return {
    version: SCAN_BUNDLE_VERSION,
    savedAt: new Date(now).toISOString(),
    flat: asMap(flat),
    quality: asMap(quality),
    mp: asMap(mp),
  };
}

/** Whether a bundle holds anything at all worth writing or restoring. */
function scanBundleHasPrices(bundle) {
  if (!isPlainObject(bundle)) return false;
  return mapHasCells(bundle.flat) || mapHasCells(bundle.quality) || mapHasCells(bundle.mp);
}

/**
 * Epoch ms of the most recent side of one price cell; 0 when it carries no
 * date at all. Same rule as js/captured-prices-store.js capEntryTime — the two
 * stores fold into each other, so they must agree on what "when" means.
 */
function scanCellTime(entry) {
  if (!entry || typeof entry !== "object") return 0;
  const t = (d) => {
    const ms = d ? Date.parse(d) : NaN;
    return Number.isFinite(ms) ? ms : 0;
  };
  return Math.max(t(entry.sell_date), t(entry.buy_date), t(entry.volume_date));
}

/**
 * Drop cells older than `maxAgeMs`, one at a time, and any item or quality left
 * empty behind them. `Infinity` — the default retention — drops none. A cell
 * with no date cannot be aged out either — nothing says when it was read — so
 * it is kept rather than silently discarded.
 *
 * @param {object} map     {item: {city: entry}} or {item: {q: {city: entry}}}
 * @param {boolean} nested true for the quality-shaped map
 * @returns {object} a new map
 */
function pruneScanMap(map, nested, now, maxAgeMs) {
  const out = {};
  const ages = maxAgeMs !== Infinity;
  Object.keys(asMap(map)).forEach((itemId) => {
    const level = asMap(map[itemId]);
    Object.keys(level).forEach((key) => {
      if (nested) {
        const cities = asMap(level[key]);
        Object.keys(cities).forEach((city) => {
          const ts = scanCellTime(cities[city]);
          if (ages && ts && now - ts > maxAgeMs) return;
          if (!out[itemId]) out[itemId] = {};
          if (!out[itemId][key]) out[itemId][key] = {};
          out[itemId][key][city] = cities[city];
        });
        return;
      }
      const ts = scanCellTime(level[key]);
      if (ages && ts && now - ts > maxAgeMs) return;
      if (!out[itemId]) out[itemId] = {};
      out[itemId][key] = level[key];
    });
  });
  return out;
}

/**
 * Validate + age-check a bundle read back from disk.
 * @returns {{flat:object, quality:object, mp:object, savedAt:string}|null}
 *   null for anything not worth restoring: corrupt, a schema this build does
 *   not know, undated, or left with no prices once stale cells are pruned.
 */
function readScanBundle(raw, options) {
  if (!isPlainObject(raw)) return null;
  if (raw.version !== SCAN_BUNDLE_VERSION) return null;

  // The save stamp no longer decides anything, but an unparseable one still
  // means the file is not what this code wrote.
  if (!Number.isFinite(Date.parse(raw.savedAt))) return null;

  const now = scanOpt(options, "now", Date.now());
  const maxAgeMs = scanOpt(options, "maxAgeMs", SCAN_MAX_CELL_AGE_MS);
  const bundle = {
    flat: pruneScanMap(raw.flat, false, now, maxAgeMs),
    quality: pruneScanMap(raw.quality, true, now, maxAgeMs),
    mp: pruneScanMap(raw.mp, false, now, maxAgeMs),
    savedAt: raw.savedAt,
  };
  return scanBundleHasPrices(bundle) ? bundle : null;
}

function scanTimerApi(options) {
  const injected = scanOpt(options, "timers", null);
  if (injected) return injected;
  return {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
}

/**
 * Write the pending bundle out now. Cancels the armed timer, so the trailing
 * save never fires twice.
 * @returns {boolean} whether a write landed
 */
function flushScanSave() {
  const pending = scanSavePending;
  if (scanSaveTimer !== null && scanSaveTimers) {
    scanSaveTimers.clearTimeout(scanSaveTimer);
  }
  scanSaveTimer = null;
  scanSaveTimers = null;
  scanSavePending = null;
  if (!pending) return false;

  let bundle;
  try {
    bundle = pending.getBundle();
  } catch (e) {
    return false; // the maps went away mid-flush; a scan must not die for it
  }
  if (!scanBundleHasPrices(bundle)) return false;
  try {
    return pending.save(bundle) !== false;
  } catch (e) {
    return false; // read-only profile, IPC gone: the scan itself still stands
  }
}

/**
 * Arm the trailing save. `getBundle` is called at write time, not now, so the
 * last state of a burst is what gets written.
 * @param {() => object} getBundle
 * @param {{save:(b:object)=>any, delayMs?:number, timers?:object}} options
 */
function scheduleScanSave(getBundle, options) {
  const save = scanOpt(options, "save", null);
  if (typeof getBundle !== "function" || typeof save !== "function") return;
  const timers = scanTimerApi(options);
  const delay = scanOpt(options, "delayMs", SCAN_SAVE_DEBOUNCE_MS);

  scanSavePending = { getBundle, save };
  if (delay <= 0) {
    flushScanSave();
    return;
  }
  if (scanSaveTimer !== null) return; // already armed; the pending state is shared
  scanSaveTimers = timers;
  scanSaveTimer = timers.setTimeout(() => {
    scanSaveTimer = null;
    flushScanSave();
  }, delay);
  if (scanSaveTimer && typeof scanSaveTimer.unref === "function") scanSaveTimer.unref();
}

/** Drop any pending save without writing it (tests, and "clear data"). */
function resetScanSave() {
  if (scanSaveTimer !== null && scanSaveTimers) scanSaveTimers.clearTimeout(scanSaveTimer);
  scanSaveTimer = null;
  scanSaveTimers = null;
  scanSavePending = null;
}

// ── renderer glue ───────────────────────────────────────────────────────────
// The bridge is only there under Electron (preload.js). Opened as a plain page
// there is nowhere to write, and every call below turns into a no-op rather
// than an error — the app still scans, it just forgets on close.

function scanPriceBridge() {
  const bridge = (typeof window !== "undefined" && window.scanPriceStore) || null;
  return bridge && typeof bridge.save === "function" ? bridge : null;
}

/** Snapshot the three live maps app.js keeps. Read at WRITE time, not before. */
function currentScanBundle() {
  return buildScanBundle({
    flat: typeof lastMarketData !== "undefined" ? lastMarketData : null,
    quality: typeof lastQualityMarketData !== "undefined" ? lastQualityMarketData : null,
    mp: typeof lastMpMarketData !== "undefined" ? lastMpMarketData : null,
  });
}

/** Call after any scan: the write is deferred, so a burst costs one file. */
function persistScanPrices(options) {
  const bridge = scanPriceBridge();
  if (!bridge) return;
  scheduleScanSave(currentScanBundle, { save: (b) => bridge.save(b), ...(options || {}) });
}

/**
 * Read back the last session's scan, already age-checked.
 * @returns {Promise<{flat:object, quality:object, mp:object, savedAt:string}|null>}
 */
async function hydrateScanPrices(options) {
  const bridge = scanPriceBridge();
  if (!bridge || typeof bridge.load !== "function") return null;
  let raw;
  try { raw = await bridge.load(); } catch (e) { return null; }
  return readScanBundle(raw, options);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SCAN_BUNDLE_VERSION,
    SCAN_MAX_CELL_AGE_MS,
    SCAN_SAVE_DEBOUNCE_MS,
    buildScanBundle,
    readScanBundle,
    pruneScanMap,
    scanBundleHasPrices,
    scheduleScanSave,
    flushScanSave,
    resetScanSave,
    persistScanPrices,
    hydrateScanPrices,
  };
}
