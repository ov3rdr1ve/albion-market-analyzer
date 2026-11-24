/**
 * Crafting Planner — per-item row cache for data-refresh passes.
 *
 * The planner is the app's longest renderer (seconds on a real price map), and
 * a sniffer capture used to recompute every row of it. Reported: a captured
 * price never reached the planner until the table was updated by hand.
 *
 * Each catalogue item's rows are remembered together with every price-map id
 * they READ. The reads are recorded by handing the row builder a view over the
 * map that notes each id it is asked for; reads that bypass the map (a journal
 * fame price answered from its own cache) report their ids through
 * recordPriceDependency. A pass that only brings new prices (js/render-async.js
 * DATA_REFRESH_REASONS) then rebuilds exactly the items that read a moved id and
 * reuses the rest.
 *
 * Anything that is not a price — a toggle, a pick, an override, a spec — goes
 * through a full pass, and a settings signature guards the cache against a
 * change that slipped past one. Nothing is committed until the caller paints,
 * so a cancelled pass leaves the previous cache whole.
 *
 * Browser global + Node export. No DOM.
 */

/** The dependency set being recorded right now, or null. */
let _cpRecording = null;

/** Note ids a row read without going through the recording view. */
function recordPriceDependency(...ids) {
  if (!_cpRecording) return;
  ids.forEach((id) => { if (id) _cpRecording.add(String(id)); });
}

function createPlannerRowCache() {
  return { entries: new Map(), valid: false, settings: null };
}

/**
 * A view over `marketData` that records every id read from it into whichever
 * set is recording at the time. ONE view per pass, not per item: caches keyed
 * on the price map's identity (js/journal-fame-price.js) then still share their
 * answers across items, and report their ids on a hit instead.
 */
function _cpRecordingView(marketData) {
  const target = marketData || {};
  return new Proxy(target, {
    get(t, key) {
      if (_cpRecording && typeof key === "string") _cpRecording.add(key);
      return t[key];
    },
    has(t, key) {
      if (_cpRecording && typeof key === "string") _cpRecording.add(key);
      return key in t;
    },
  });
}

/** Rows for one item, with the ids they read. */
function _cpComputeRecorded(item, view, computeRows) {
  const deps = new Set();
  const outer = _cpRecording;
  _cpRecording = deps;
  try {
    const rows = computeRows(item, view);
    return { rows: rows || [], deps };
  } finally {
    _cpRecording = outer;
  }
}

function _cpTouches(deps, dirty) {
  for (const id of dirty) if (deps.has(id)) return true;
  return false;
}

/**
 * Build the planner's candidate rows one item at a time, reusing cached items
 * where allowed. Stepwise so the chunked renderer can hand the thread back
 * between items; plannerRowsWithCache below is the same thing in one go.
 *
 * @param {object[]} items          expanded catalogue (base + @n variants)
 * @param {object}   marketData
 * @param {Function} computeRows    (item, marketView) => rows[]
 * @param {object}   options
 * @param {object}   options.cache     from createPlannerRowCache
 * @param {string[]|null} options.dirtyIds  ids whose prices moved; null = full
 * @param {string}   options.settings  signature of every non-price input
 * @returns {{step: Function, done: Function, result: Function}}
 *   step() builds the next item; result() is
 *   {rows, entries, settings, recomputed, incremental}
 */
function plannerRowBuilder(items, marketData, computeRows, { cache, dirtyIds = null, settings = "" } = {}) {
  const incremental = !!(cache && cache.valid && Array.isArray(dirtyIds) && cache.settings === settings);
  const dirty = incremental ? new Set(dirtyIds.map(String)) : null;
  const entries = new Map();
  const rows = [];
  const view = _cpRecordingView(marketData);
  let recomputed = 0;
  let i = 0;
  return {
    step() {
      if (i >= items.length) return;
      const item = items[i++];
      const key = String(item.id);
      const cached = incremental ? cache.entries.get(key) : null;
      let entry;
      if (cached && !_cpTouches(cached.deps, dirty)) {
        entry = cached;
      } else {
        entry = _cpComputeRecorded(item, view, computeRows);
        recomputed++;
      }
      entries.set(key, entry);
      rows.push(...entry.rows);
    },
    done: () => i >= items.length,
    result: () => ({ rows, entries, settings, recomputed, incremental }),
  };
}

/** plannerRowBuilder, run to the end in one go. */
function plannerRowsWithCache(items, marketData, computeRows, options) {
  const b = plannerRowBuilder(items, marketData, computeRows, options);
  while (!b.done()) b.step();
  return b.result();
}

/** Make a finished pass the cache the next refresh reuses. */
function commitPlannerRowCache(cache, result) {
  if (!cache || !result) return;
  cache.entries = result.entries;
  cache.settings = result.settings;
  cache.valid = true;
}

/**
 * Every non-price input a planner row reads, as one string. A cache built under
 * a different signature is never reused, whatever pass asks.
 */
function plannerSettingsSignature(tableId) {
  const call = (fn, ...args) => (typeof fn === "function" ? fn(...args) : "");
  return [
    call(typeof isFocusEnabled !== "undefined" ? isFocusEnabled : null),
    call(typeof isBlackRedZoneEnabled !== "undefined" ? isBlackRedZoneEnabled : null),
    call(typeof isPremiumEnabled !== "undefined" ? isPremiumEnabled : null),
    call(typeof getOrderType !== "undefined" ? getOrderType : null, "buy"),
    call(typeof getOrderType !== "undefined" ? getOrderType : null, "sell"),
    call(typeof getTableSellCity !== "undefined" ? getTableSellCity : null, tableId),
    call(typeof getTableBuyCity !== "undefined" ? getTableBuyCity : null, tableId),
    call(typeof getHouseTier !== "undefined" ? getHouseTier : null),
    call(typeof getStationFeeInput !== "undefined" ? getStationFeeInput : null),
    call(typeof getGlobalDiscountFactor !== "undefined" ? getGlobalDiscountFactor : null),
  ].join("|");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createPlannerRowCache, plannerRowBuilder, plannerRowsWithCache, commitPlannerRowCache,
    recordPriceDependency, plannerSettingsSignature,
  };
}
