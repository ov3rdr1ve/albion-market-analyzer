/**
 * What a Black Market scan actually fetches.
 *
 * Every other scan button owns a catalog: press it and it prices its table's
 * items. The Black Market board owns nothing — it re-ranks rows the twelve
 * feeder tables already computed (js/render-bm-board.js), so "scan this board"
 * has to be answered from somewhere else.
 *
 * The answer is the board's own reason for existing. A Black Market number goes
 * quietly stale — the book is one-way, it is exempt from the outlier fence
 * (js/utils.js getIQRBounds), and the reported bug was a row quoting a bid the
 * player had personally sold into. So the button re-reads exactly the ids the
 * Black Market is KNOWN to quote, plus the legs the rows on screen are priced
 * from, and leaves discovering newly-quoted items to the full scan. On a real
 * saved scan that set is 5 026 ids against the 9 738 the map holds, and against
 * a feeder union that is effectively getAllRequiredItemIds — the full scan under
 * a second name, recipe pre-fetch and all.
 *
 * Two ids the sweep would miss if it were only "who has a Black Market price":
 *   - a bid quoted at quality 2-5 and not at Normal. Fetched flat it comes back
 *     empty (js/flip-route-quality.js documents a live bid at q1-3 only), so
 *     those ids are named separately for the per-quality request.
 *   - a row's BUY leg. It is a city price with no Black Market column of its
 *     own, and without it Input Cost freezes while the bid beside it refreshes.
 *
 * Pure: no DOM, no fetch, no globals. The caller passes the price maps and the
 * board's cached rows in, the same way js/render-schedule.js is written, so the
 * whole thing is testable in Node (tests/bm-board-scan.test.cjs).
 */

/** The city this board is about — never a buy city (js/render-bm-board.js). */
const BM_SCAN_CITY = "Black Market";

/**
 * The tables a Black Market row can come from, in draw order.
 * Kept in step with JOINED_SUMMARY_SOURCES (js/render-gating.js) and
 * JOINED_SOURCES (js/joined-summary-sources.js) — a feeder missing here is a
 * Black Market row that silently never refreshes.
 */
const BM_SCAN_FEEDERS = [
  "flipping-table",
  "crafting-table",
  "transport-table",
  "consumable-table",
  "mounts-table",
  "farming-table",
  "enchanting-table",
  "transmute-table",
  "rerolling-table",
  "rolling-table",
  "faction-spending-table",
  "laborers-table",
];

/**
 * Does this entry hold an actual Black Market number?
 *
 * "Has a Black Market key" does not mean "is quoted there". AODP answers the
 * scan's fixed location list (js/api.js LOCATIONS) for every id, so almost every
 * item comes back with a Black Market bucket that is entirely zeroes: measured
 * on a real saved scan, 9 674 of 9 738 ids carried one and only 5 026 held a
 * number. Reading the bucket alone turned this scan into the full one it exists
 * to avoid.
 *
 * Either side counts. The Black Market's book is one-way — it bids and does not
 * offer (js/app.js) — so a real listing usually has buy_price and nothing else;
 * the ask, where one exists, is what the flip tables read. A book that was READ
 * and found empty carries a seen stamp (js/price-freshness.js) and still holds
 * no number, so it is not a quote either.
 */
function bmHasQuote(entry) {
  if (!entry) return false;
  return Number(entry.buy_price) > 0 || Number(entry.sell_price) > 0;
}

/**
 * The ids a Black Market scan should re-read.
 *
 * @param {object}   [options]
 * @param {object}   [options.flat]     lastMarketData — map[id][city]
 * @param {object}   [options.quality]  lastQualityMarketData — map[id][quality][city]
 * @param {object[]} [options.rows]     the board's cached rows (tableState)
 * @returns {{ids: string[], qualityIds: string[]}} `ids` for fetchPricesBatch,
 *   `qualityIds` for fetchPricesBatchWithQualities. `qualityIds` is a subset of
 *   `ids`: an item needing the deep read needs the flat one too, because the
 *   feeders that do not price per quality read it out of the flat map.
 */
function getBlackMarketScanIds({ flat, quality, rows } = {}) {
  const ids = new Set();
  const qualityIds = new Set();

  Object.keys(flat || {}).forEach((id) => {
    if (flat[id] && bmHasQuote(flat[id][BM_SCAN_CITY])) ids.add(id);
  });

  Object.keys(quality || {}).forEach((id) => {
    const books = quality[id];
    if (!books) return;
    Object.keys(books).forEach((q) => {
      if (!books[q] || !bmHasQuote(books[q][BM_SCAN_CITY])) return;
      ids.add(id);
      // Quality 1 IS the flat book. Only a bid above Normal needs the deep read.
      if (Number(q) > 1) qualityIds.add(id);
    });
  });

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row) return;
    if (row.sellItemId) {
      ids.add(row.sellItemId);
      if (Number(row.sellQuality) > 1) qualityIds.add(row.sellItemId);
    }
    // The buy leg rides the flat request whatever quality the sell leg is read
    // at: an input is priced in a city, and city books are not quality-keyed
    // here (js/joined-summary-sources.js — only sellQuality is ever set).
    if (row.buyItemId) ids.add(row.buyItemId);
  });

  return { ids: [...ids], qualityIds: [...qualityIds] };
}

/**
 * Which feeders have to be redrawn before the board can see the new prices.
 *
 * The board projects over `tableState[feeder].data`, so a fresh price map alone
 * changes nothing on screen — the feeder that owns the row has to recompute it
 * first. Only the feeders whose catalog holds a scanned id can have moved.
 *
 * @param {string[]} ids      what the scan fetched
 * @param {object}   sources  tableId → that table's id universe, built from
 *   tableSources() (js/table-search-fetch.js) so scan and search-fetch never drift
 * @returns {string[]} feeder table ids, in BM_SCAN_FEEDERS order. With no usable
 *   source map, every feeder: a catalog function that threw or a script that has
 *   not loaded must degrade to "redraw everything", never to "redraw nothing".
 */
function bmScanFeederTables(ids, sources) {
  const wanted = new Set(ids || []);
  if (!wanted.size) return [];
  const hasSources = sources && Object.keys(sources).length > 0;
  if (!hasSources) return [...BM_SCAN_FEEDERS];
  return BM_SCAN_FEEDERS.filter((tableId) => {
    const catalog = sources[tableId];
    if (!Array.isArray(catalog)) return false;
    return catalog.some((id) => wanted.has(id));
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getBlackMarketScanIds, bmScanFeederTables, bmHasQuote,
    BM_SCAN_FEEDERS, BM_SCAN_CITY,
  };
}
