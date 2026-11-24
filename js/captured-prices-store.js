/**
 * Persistence for prices captured by the live market monitor.
 *
 * A capture is the only price source the user produces themselves: it is the
 * order book the game actually showed, at the second it was opened, for items
 * the AODP simply has no data on. Keeping it only in memory (the old
 * behaviour) meant closing the app threw it away, and a full "Scan Market Now"
 * — which assigns lastMarketData wholesale — threw it away too.
 *
 * So captures are mirrored to disk and folded back on top of scan data
 * DATE-AWARE: a capture wins only where it is newer than what is already
 * there, or where that side has no price at all. `volume_24h` is never taken
 * from a capture — a listing is not a trade (see market-price-store.js) — so a
 * scanned volume always survives the fold.
 *
 * WHERE they are mirrored: a JSON file under userData, over the same bridge
 * shape js/scan-price-store.js uses (js/captured-price-file.js, preload's
 * window.capturedPriceStore). They used to live in localStorage, and a week of
 * captures is megabytes there — past the quota, where the write is dropped
 * SILENTLY and takes the crafting list and the price overrides down with it.
 * localStorage remains the fallback for a plain browser page, and anything
 * still stored under the old key is migrated to the file on first hydrate.
 *
 * Shape stored: the quality-aware map, { itemId: { quality: { city: entry } } }.
 * The flat { itemId: { city: entry } } map every table reads is projected from
 * quality 1 on the way out.
 *
 * Growth is bounded by the cell cap alone: only the CAPTURED_MAX_CELLS newest
 * survive a save. There is NO age limit — a capture is kept until a newer
 * reading of the same item/quality/city replaces it, and that is the only thing
 * that ever removes one.
 *
 * There used to be a week-long TTL, and it was a silent data loss: this prune is
 * destructive (the pruned map is what gets written back), and a capture is
 * irreplaceable for anything the AODP has no data on. Artifacts are exactly
 * that — the sniffer is their only price source, so a week-old capture was
 * deleted with nothing on earth able to refill it. Nothing is hidden by keeping
 * it instead: every row badges its own age (formatPriceAge in js/app.js).
 *
 * `maxAgeMs` survives as an OPTION, for a caller that genuinely wants a window.
 *
 * The SAVE is deferred, and that is not an optimisation — it is what keeps the
 * window alive. Pruning walks every cell, the stringify is ~2 MB, and opening
 * one market emits a response per page: doing that per response cost ~78 ms of
 * blocked main thread each, seconds of frozen app for one market. Recording is
 * now proportional to the patch, and the whole map is written once the burst
 * settles (CAPTURED_SAVE_DEBOUNCE_MS) or on an explicit flushCapturedPrices().
 */

const CAPTURED_KEY = "capturedPrices";
const CAPTURED_VERSION_KEY = "capturedPricesVersion";
const CAPTURED_SCHEMA_VERSION = "1";
// One-time format marker for the seen-stamp migration. Stores saved before the
// fix for the false "not listed" badge hold sell_seen / buy_seen values no
// honest reading wrote — blanket stamps from anonymous own trades and from
// derived browse pages that priced nothing (js/own-orders-store.js,
// js/market-price-store.js). A store WITHOUT the marker has every stamp
// stripped on load; the marker itself is written by every save, so any stamp
// that survives a load was recorded by code that only stamps real readings.
// A top-level key no item id can collide with (ids are like "T4_BAG@2").
const CAPTURED_SEEN_PROOF_KEY = "$seenProof";
const CAPTURED_SEEN_PROOF = 1;
// No age limit: a stored capture is replaced by a newer reading, never expired.
const CAPTURED_MAX_AGE_MS = Infinity;
const CAPTURED_MAX_CELLS = 20000;                    // localStorage: ~2 MB of JSON
// The file has no quota to respect, so the cap is only there to stop a runaway
// map — a full week of heavy capture does not come close to this.
const CAPTURED_MAX_CELLS_FILE = 250000;
// How long a burst may keep pushing captures in before the map is written out.
// Long enough that one market open is a single save, short enough that a crash
// costs at most this much capture.
const CAPTURED_SAVE_DEBOUNCE_MS = 2000;

/** The accumulated captures of this session, kept so each save is complete. */
let capturedPrices = {};
/** Cells held, maintained incrementally so recording never re-walks the map. */
let capturedCells = 0;
/** Pending deferred save: the timer, and the options the next flush must use. */
let saveTimer = null;
let pendingSaveOptions = null;

function capDefaultStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch (e) {
    return null; // private mode / no DOM
  }
}

function capOpt(options, key, fallback) {
  return options && options[key] !== undefined ? options[key] : fallback;
}

/**
 * The userData-file bridge (preload.js), or null when there is none — a plain
 * browser page, or the Node tests unless one is injected. Everything below
 * falls back to localStorage when this is null, so the app degrades to the old
 * behaviour rather than to no persistence at all.
 */
function capBridge(options) {
  const injected = capOpt(options, "bridge", undefined);
  if (injected !== undefined) return injected;
  const b = (typeof window !== "undefined" && window.capturedPriceStore) || null;
  return b && typeof b.save === "function" ? b : null;
}

/** Cell budget for whichever backend is in play. */
function capMaxCells(options) {
  return capOpt(options, "maxCells", capBridge(options) ? CAPTURED_MAX_CELLS_FILE : CAPTURED_MAX_CELLS);
}

/** Epoch ms of the most recent side of one cell; 0 when it carries no date. */
function capEntryTime(entry) {
  if (!entry) return 0;
  const t = (d) => {
    const ms = d ? Date.parse(d) : NaN;
    return Number.isFinite(ms) ? ms : 0;
  };
  // volume_date counts: a volume-only cell (a captured price chart, no orders)
  // carries nothing else, and without it retention could never age it out.
  return Math.max(t(entry.sell_date), t(entry.buy_date), t(entry.volume_date));
}

/**
 * Fold one captured cell onto another. A zero side in `next` means "not
 * observed" (offers and requests arrive in separate responses), so it never
 * erases a known price — same rule as market-price-store.mergeEntry.
 */
/**
 * The later of two "book was read" stamps (sell_seen / buy_seen), undefined
 * when there is neither. A stamp only ever moves forward — see
 * js/market-price-store.js, which owns the same rule for a live patch.
 */
function capNewerStamp(previous, next) {
  if (!previous) return next || undefined;
  if (!next) return previous;
  return Date.parse(next) > Date.parse(previous) ? next : previous;
}

/** Copy the newer of each side's read-stamp onto `merged`. */
function capKeepStamps(merged, previous, next) {
  const sellSeen = capNewerStamp(previous && previous.sell_seen, next && next.sell_seen);
  const buySeen = capNewerStamp(previous && previous.buy_seen, next && next.buy_seen);
  if (sellSeen) merged.sell_seen = sellSeen;
  if (buySeen) merged.buy_seen = buySeen;
  return merged;
}

/**
 * How far apart two readings of one book may be and still be the SAME look at
 * it. Same window, same reason as js/market-price-store.js: order lists answer
 * in price-ascending pages, so a later page of one browse carries an item's
 * DEARER orders and must not be taken as the board's price.
 */
const CAPTURED_SAME_LOOK_MS = 60 * 1000;

/** Whether two readings fall inside one look at the book. */
function capSameLook(previous, next) {
  const a = previous ? Date.parse(previous) : NaN;
  const b = next ? Date.parse(next) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(b - a) <= CAPTURED_SAME_LOOK_MS;
}

function capFoldEntry(previous, next) {
  if (!previous) return { ...next };
  const merged = capKeepStamps({ ...previous, ...next }, previous, next);
  let keptSell = false;
  let keptBuy = false;
  if (!next.sell_price && previous.sell_price) {
    merged.sell_price = previous.sell_price;
    merged.sell_date = previous.sell_date;
    keptSell = true;
  }
  if (!next.buy_price && previous.buy_price) {
    merged.buy_price = previous.buy_price;
    merged.buy_date = previous.buy_date;
    keptBuy = true;
  }
  // Two pages of one browse reduce the way orders inside a page do: min over
  // asks, max over bids. Outside the window the newer reading wins.
  if (next.sell_price && previous.sell_price
    && capSameLook(previous.sell_date, next.sell_date)
    && previous.sell_price < next.sell_price) {
    merged.sell_price = previous.sell_price;
    merged.sell_date = previous.sell_date;
    keptSell = true;
  }
  if (next.buy_price && previous.buy_price
    && capSameLook(previous.buy_date, next.buy_date)
    && previous.buy_price > next.buy_price) {
    merged.buy_price = previous.buy_price;
    merged.buy_date = previous.buy_date;
    keptBuy = true;
  }
  // Provenance always follows the WINNING price per side: the kept side keeps
  // previous's source, a replaced side takes next's, an absent one is null —
  // a flag can never ride along with a price it does not describe.
  merged.sell_src = (keptSell ? previous.sell_src : next.sell_src) || null;
  merged.buy_src = (keptBuy ? previous.buy_src : next.buy_src) || null;
  if (!next.volume_24h && previous.volume_24h) merged.volume_24h = previous.volume_24h;
  return merged;
}

/** Walk every cell of a quality map: fn(itemId, quality, city, entry). */
function capForEachCell(map, fn) {
  Object.keys(map || {}).forEach((itemId) => {
    Object.keys(map[itemId] || {}).forEach((quality) => {
      Object.keys(map[itemId][quality] || {}).forEach((city) => {
        fn(itemId, quality, city, map[itemId][quality][city]);
      });
    });
  });
}

function capPutCell(target, itemId, quality, city, entry) {
  if (!target[itemId]) target[itemId] = {};
  if (!target[itemId][quality]) target[itemId][quality] = {};
  target[itemId][quality][city] = entry;
}

/** Whether a parsed store already went through the seen-stamp migration. */
function capHasSeenProof(parsed) {
  return !!parsed && parsed[CAPTURED_SEEN_PROOF_KEY] === CAPTURED_SEEN_PROOF;
}

/**
 * Strip every sell_seen / buy_seen from a store, in place. An unproven stamp
 * reads as "the book was read and this price was not in it" — with a blanket
 * stamp behind it, it hid a live price instead (js/price-freshness.js).
 */
function capStripSeenStamps(map) {
  capForEachCell(map, (itemId, quality, city, entry) => {
    if (!entry || typeof entry !== "object") return;
    delete entry.sell_seen;
    delete entry.buy_seen;
  });
  return map;
}

/**
 * The load half of the seen-stamp migration, shared by BOTH backends (the
 * userData file and the localStorage fallback hold the same bare-map shape).
 * A store with the marker passes through untouched; one without it is stripped.
 * The marker is not kept on the returned map — prune rebuilds it from cells —
 * it is written back by every save (capWithSeenProof), so the persisted copy
 * gains it with the store's normal save flow: the first save after this load.
 * Until then a re-load strips again, which is harmless: there is nothing left
 * to strip.
 */
function capLoadSeenProof(parsed, options) {
  if (capHasSeenProof(parsed)) return pruneCapturedPrices(parsed, options);
  return pruneCapturedPrices(capStripSeenStamps(parsed), options);
}

/** Mark a pruned map as proven before it is persisted. */
function capWithSeenProof(pruned) {
  pruned[CAPTURED_SEEN_PROOF_KEY] = CAPTURED_SEEN_PROOF;
  return pruned;
}

/**
 * Drop cells older than `maxAgeMs` (Infinity — the default — drops none), then
 * keep only the `maxCells` newest. Items and qualities left empty are removed
 * rather than kept as husks. Pure — returns a new map.
 */
function pruneCapturedPrices(map, options) {
  const now = capOpt(options, "now", Date.now());
  const maxAgeMs = capOpt(options, "maxAgeMs", CAPTURED_MAX_AGE_MS);
  const maxCells = capMaxCells(options);

  const cells = [];
  capForEachCell(map, (itemId, quality, city, entry) => {
    const ts = capEntryTime(entry);
    // A dateless cell cannot be aged out — treat it as just-captured so a
    // capture is never lost to a missing timestamp, but rank it last.
    const age = ts ? now - ts : 0;
    if (maxAgeMs !== Infinity && age > maxAgeMs) return;
    cells.push({ itemId, quality, city, entry, ts });
  });

  if (cells.length > maxCells) {
    cells.sort((a, b) => b.ts - a.ts);
    cells.length = maxCells;
  }

  const out = {};
  cells.forEach((c) => capPutCell(out, c.itemId, c.quality, c.city, c.entry));
  return out;
}

/**
 * Write a quality map out (pruned). The file wins when a bridge is available;
 * localStorage is the fallback for a plain browser page.
 * @returns {boolean} whether a write was issued — the file's is a promise the
 *   caller does not wait on, exactly like js/scan-price-store.js.
 */
function saveCapturedPrices(map, options) {
  const pruned = capWithSeenProof(pruneCapturedPrices(map, options));
  const bridge = capBridge(options);
  if (bridge) {
    try {
      const r = bridge.save(pruned);
      if (r && typeof r.catch === "function") r.catch(() => {});
      return true;
    } catch (e) {
      return false; // IPC gone: the session keeps its captures in memory
    }
  }
  return saveCapturedPricesToStorage(pruned, options);
}

/** The localStorage half of saveCapturedPrices. `map` is already pruned. */
function saveCapturedPricesToStorage(pruned, options) {
  const storage = capOpt(options, "storage", capDefaultStorage());
  if (!storage) return false;
  try {
    storage.setItem(CAPTURED_KEY, JSON.stringify(pruned));
    storage.setItem(CAPTURED_VERSION_KEY, CAPTURED_SCHEMA_VERSION);
    return true;
  } catch (e) {
    // Quota blown: halve the budget and try once more before giving up, so a
    // big session degrades to "the newest captures" rather than to nothing.
    try {
      const half = capWithSeenProof(pruneCapturedPrices(pruned, {
        ...options,
        bridge: null,
        maxCells: Math.floor(capMaxCells({ ...options, bridge: null }) / 2),
      }));
      storage.setItem(CAPTURED_KEY, JSON.stringify(half));
      storage.setItem(CAPTURED_VERSION_KEY, CAPTURED_SCHEMA_VERSION);
      return true;
    } catch (e2) {
      return false;
    }
  }
}

/** Read the localStorage quality map, pruned. {} when missing, stale or corrupt. */
function loadCapturedPrices(options) {
  const storage = capOpt(options, "storage", capDefaultStorage());
  if (!storage) return {};
  try {
    if (storage.getItem(CAPTURED_VERSION_KEY) !== CAPTURED_SCHEMA_VERSION) {
      storage.removeItem(CAPTURED_KEY);
      return {};
    }
    const raw = storage.getItem(CAPTURED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return capLoadSeenProof(parsed, options);
  } catch (e) {
    return {};
  }
}

/**
 * Read whatever is on disk, pruned. {} when there is no file, it is unreadable,
 * or there is no bridge to ask.
 */
async function loadCapturedPricesFromFile(options) {
  const bridge = capBridge(options);
  if (!bridge || typeof bridge.load !== "function") return {};
  let raw;
  try { raw = await bridge.load(); } catch (e) { return {}; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return capLoadSeenProof(raw, options);
}

/**
 * One-shot move of the pre-file captures out of localStorage. Returns what was
 * found there and clears the legacy keys — the file is the record from now on,
 * and leaving a stale copy behind would resurrect week-old cells on every boot.
 */
function migrateLegacyCapturedPrices(options) {
  const storage = capOpt(options, "storage", capDefaultStorage());
  if (!storage) return {};
  let legacy;
  try {
    if (!storage.getItem(CAPTURED_KEY)) return {};
    legacy = loadCapturedPrices(options);
    storage.removeItem(CAPTURED_KEY);
    storage.removeItem(CAPTURED_VERSION_KEY);
  } catch (e) {
    return {};
  }
  return legacy;
}

function countCapturedCells(map) {
  let n = 0;
  capForEachCell(map, () => { n++; });
  return n;
}

/**
 * Write the session map out now: prune, persist, cancel any pending save.
 * Call it when the capture can afford the pause — the window going to the
 * background, a page unload, a scan about to read the map.
 * @returns {boolean} whether the write landed
 */
function flushCapturedPrices(options) {
  const opts = options || pendingSaveOptions;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingSaveOptions = null;
  capturedPrices = pruneCapturedPrices(capturedPrices, opts);
  capturedCells = countCapturedCells(capturedPrices);
  return saveCapturedPrices(capturedPrices, opts);
}

/** Arm the trailing save. Already armed = nothing to do; the map is shared. */
function scheduleCapturedSave(options) {
  const delay = capOpt(options, "saveDelayMs", CAPTURED_SAVE_DEBOUNCE_MS);
  pendingSaveOptions = options || null;
  if (delay <= 0 || typeof setTimeout !== "function") {
    flushCapturedPrices(options);
    return;
  }
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; flushCapturedPrices(); }, delay);
  // Node only: a pending save must not hold a test process open.
  if (saveTimer && typeof saveTimer.unref === "function") saveTimer.unref();
}

/**
 * Accumulate a capture into the session map; the write is deferred.
 * Costs one fold per cell IN THE PATCH — nothing here touches the rest of the
 * map, which is what a market-open burst depends on.
 * Returns the number of cells now held.
 */
function recordCapturedPrices(patch, options) {
  capForEachCell(patch, (itemId, quality, city, entry) => {
    const prev = capturedPrices[itemId]?.[quality]?.[city];
    if (!prev) capturedCells++;
    capPutCell(capturedPrices, itemId, quality, city, capFoldEntry(prev, entry));
  });
  scheduleCapturedSave(options);
  return capturedCells;
}

/**
 * Seed the session map at boot. Returns the map (a promise — the file crosses
 * IPC).
 *
 * It MERGES rather than assigns, and that is the fix for a real loss: the
 * monitor auto-starts before this resolves (main.js prefs.autoStart), so a
 * player already standing in a market can capture a whole order book while the
 * boot is still awaiting the scan file. Replacing the session map dropped every
 * one of those cells, and the next debounced flush wrote the replacement over
 * them on disk. A live capture is the newer reading, so it wins; the stored
 * copy fills the sides it did not observe.
 */
async function hydrateCapturedPrices(options) {
  const stored = capBridge(options)
    ? { ...(await loadCapturedPricesFromFile(options)) }
    : loadCapturedPrices(options);

  // Anything still under the old localStorage key comes along, then goes.
  let migrated = null;
  if (capBridge(options)) {
    migrated = migrateLegacyCapturedPrices(options);
    capForEachCell(migrated, (itemId, quality, city, entry) => {
      const prev = stored[itemId]?.[quality]?.[city];
      capPutCell(stored, itemId, quality, city, prev ? capFoldEntry(entry, prev) : entry);
    });
  }

  capForEachCell(stored, (itemId, quality, city, entry) => {
    const live = capturedPrices[itemId]?.[quality]?.[city];
    capPutCell(capturedPrices, itemId, quality, city, capFoldEntry(entry, live || {}));
  });
  capturedPrices = pruneCapturedPrices(capturedPrices, options);
  capturedCells = countCapturedCells(capturedPrices);
  // Write the migrated cells through so the file is authoritative from here.
  if (migrated && Object.keys(migrated).length) saveCapturedPrices(capturedPrices, options);
  return capturedPrices;
}

/** The session map — what hydrate/record have accumulated. */
function getCapturedPrices() {
  return capturedPrices;
}

/** Forget everything held in memory (tests, and the "clear data" path). */
function resetCapturedPrices() {
  capturedPrices = {};
  capturedCells = 0;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  pendingSaveOptions = null;
}

/** Project quality 1 of a captured map onto the flat {item: {city: entry}}. */
function flattenCaptured(map, quality = 1) {
  const flat = {};
  Object.keys(map || {}).forEach((itemId) => {
    const byCity = map[itemId]?.[quality];
    if (!byCity || !Object.keys(byCity).length) return;
    flat[itemId] = { ...byCity };
  });
  return flat;
}

/** When a cell's volume was measured: its own stamp, else its price dates. */
function capVolumeTime(entry) {
  if (!entry) return 0;
  const own = entry.volume_date ? Date.parse(entry.volume_date) : NaN;
  return Number.isFinite(own) ? own : capEntryTime(entry);
}

/**
 * Fold one captured cell onto a target cell, side by side, newest-wins.
 *
 * Volume follows the same rule but on its own clock. An ORDER capture never
 * carries one — listed stock is not traded volume — so it cannot overwrite a
 * scanned number. A captured price CHART does carry one
 * (market-history-volume.js): it is the same traded series AODP aggregates, so
 * it fills an unmeasured cell and replaces a staler scanned figure.
 */
function capFoldOntoTarget(target, captured) {
  if (!target) return { ...captured };
  // The read-stamps ride across on their own, ahead of every price rule below:
  // "the book was opened and this ask was not in it" is a fact about the book,
  // true whether or not the capture carried a price to fold. It is the only
  // thing that can mark a scanned price the market no longer holds.
  const out = capKeepStamps({ ...target }, target, captured);
  const capturedVolume = Number(captured.volume_24h) || 0;
  if (capturedVolume > 0
    && (!(target.volume_24h > 0) || capVolumeTime(captured) > capVolumeTime(target))) {
    out.volume_24h = capturedVolume;
    out.volume_date = captured.volume_date || null;
    out.from_sniffer = true;
  }
  // A capture is a reading; a side the scan INVENTED from 24h history is a
  // guess, so the capture takes it whatever the dates say (an invented 712,435
  // Caerleon ask dated today beat a real 8,400 one captured four days earlier).
  const invented = scanFolds().invented;
  const takeSell = captured.sell_price > 0
    && (!(target.sell_price > 0) || invented(target, "sell")
      || capEntryTime({ sell_date: captured.sell_date }) > capEntryTime({ sell_date: target.sell_date }));
  const takeBuy = captured.buy_price > 0
    && (!(target.buy_price > 0) || invented(target, "buy")
      || capEntryTime({ buy_date: captured.buy_date }) > capEntryTime({ buy_date: target.buy_date }));
  if (takeSell) {
    out.sell_price = captured.sell_price;
    out.sell_date = captured.sell_date;
    out.sell_fallback = false;
    out.sell_src = captured.sell_src || null;
    out.from_sniffer = true;
  }
  if (takeBuy) {
    out.buy_price = captured.buy_price;
    out.buy_date = captured.buy_date;
    out.buy_fallback = false;
    out.buy_src = captured.buy_src || null;
    out.from_sniffer = true;
  }
  if ((takeSell || takeBuy) && out.used_fallback) {
    out.used_fallback = invented(out, "sell") && out.sell_price > 0
      || invented(out, "buy") && out.buy_price > 0;
  }
  return out;
}

/** Fold a flat captured map onto a flat market map, in place. Returns count. */
function mergeCapturedIntoFlat(target, captured) {
  let written = 0;
  Object.keys(captured || {}).forEach((itemId) => {
    if (!target[itemId]) target[itemId] = {};
    Object.keys(captured[itemId] || {}).forEach((city) => {
      target[itemId][city] = capFoldOntoTarget(target[itemId][city], captured[itemId][city]);
      written++;
    });
  });
  return written;
}

/** Fold a quality captured map onto a quality market map, in place. */
function mergeCapturedIntoQuality(target, captured) {
  let written = 0;
  capForEachCell(captured, (itemId, quality, city, entry) => {
    if (!target[itemId]) target[itemId] = {};
    if (!target[itemId][quality]) target[itemId][quality] = {};
    target[itemId][quality][city] = capFoldOntoTarget(target[itemId][quality][city], entry);
    written++;
  });
  return written;
}

/**
 * The side-aware fold js/market-price-store.js owns, resolved LAZILY.
 *
 * Lazily because these files are plain scripts in the browser: a top-level
 * `const` reading globalThis would freeze whatever was there at parse time, and
 * the two would then be coupled by <script> order for no reason. In Node the
 * sibling is a normal require.
 */
function scanFolds() {
  const none = () => false;
  if (typeof require !== "undefined") {
    const m = require("./market-price-store.js");
    const g = require("./invented-price-guard.js");
    return { flat: m.mergeFlatPrices, quality: m.mergeQualityPrices, invented: m.isInventedSide, guard: g.guardInventedPriceMap };
  }
  return {
    flat: globalThis.mergeFlatPrices,
    quality: globalThis.mergeQualityPrices,
    invented: globalThis.isInventedSide || none,
    guard: globalThis.guardInventedPriceMap || (() => 0),
  };
}

/**
 * Fold a scan result into the app's flat price map without dropping captures.
 *
 * `Object.assign` replaces a whole ITEM, and that cost real data twice over.
 * It erased every city a capture knew about (fixed by folding the captures back
 * below), and — the reason this now merges rather than assigns — it let an AODP
 * response with NO data delete a price that was still perfectly usable: the API
 * answers with a cell for every requested (item, city) pair, and an empty book
 * comes back as `sell_price: 0, buy_price: 0`. persistScanPrices() then wrote
 * that loss to scan-prices.json.
 *
 * So a scan patch folds exactly the way a capture patch does: a zero side means
 * "not observed", never "gone" (mergeEntry). Captured cells for the scanned
 * items are still folded on top afterwards, newest-wins.
 */
function applyScanPatch(target, data) {
  const folds = scanFolds();
  folds.flat(target, data || {});
  // Judge what the scan invented against every real price now in the map —
  // sniffer captures included, which AODP's own clamp never saw.
  folds.guard(target, Object.keys(data || {}));
  const captured = flattenCaptured(capturedPrices, 1);
  const overlap = {};
  Object.keys(data || {}).forEach((id) => { if (captured[id]) overlap[id] = captured[id]; });
  mergeCapturedIntoFlat(target, overlap);
  return target;
}

/**
 * applyScanPatch for the QUALITY map (lastQualityMarketData).
 *
 * The Rerolling scan and the rerolling search-fetch used to assign that map
 * directly, which erased every captured quality cell — the flat path had been
 * protected for a while, this one had not. Same rule, one level deeper: cells
 * fold side by side, then the captures for those items are folded back on top
 * newest-wins.
 */
function applyQualityScanPatch(target, data) {
  scanFolds().quality(target, data || {});
  const overlap = {};
  Object.keys(data || {}).forEach((id) => {
    if (capturedPrices[id]) overlap[id] = capturedPrices[id];
  });
  mergeCapturedIntoQuality(target, overlap);
  return target;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CAPTURED_KEY,
    CAPTURED_VERSION_KEY,
    CAPTURED_SCHEMA_VERSION,
    CAPTURED_SEEN_PROOF_KEY,
    CAPTURED_SEEN_PROOF,
    CAPTURED_MAX_AGE_MS,
    CAPTURED_MAX_CELLS,
    CAPTURED_MAX_CELLS_FILE,
    CAPTURED_SAVE_DEBOUNCE_MS,
    entryTime: capEntryTime,
    // The date-aware fold, exported for js/team-sync-payload.js: a teammate's
    // cell arriving through the shared folder may be OLDER than ours, which is
    // the one case recordCapturedPrices does not judge.
    capFoldEntry,
    capFoldOntoTarget,
    flushCapturedPrices,
    pruneCapturedPrices,
    saveCapturedPrices,
    loadCapturedPrices,
    loadCapturedPricesFromFile,
    migrateLegacyCapturedPrices,
    recordCapturedPrices,
    hydrateCapturedPrices,
    getCapturedPrices,
    resetCapturedPrices,
    flattenCaptured,
    mergeCapturedIntoFlat,
    mergeCapturedIntoQuality,
    applyQualityScanPatch,
    applyScanPatch,
  };
}
