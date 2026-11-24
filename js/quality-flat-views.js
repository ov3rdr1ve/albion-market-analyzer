/**
 * Per-quality views of the flat price map.
 *
 * The flat map every table reads is projected from quality 1 alone —
 * flattenQuality(map, 1) in js/render-monitor.js, flattenCaptured(captured, 1)
 * in js/captured-prices-store.js and js/app.js. That is right for the AODP
 * scan, which requests `qualities=1` (js/api.js), and wrong for a CAPTURE: the
 * sniffer reads whatever the book holds, and a gear book is routinely Good and
 * Outstanding with nothing Normal in it at all.
 *
 * Reported as "the sniffer sees Caerleon but the Rootbound Staff's instant buy
 * price never updates". It had updated — quality 2 sell 698,874, quality 3
 * 698,941, captured to the second. Caerleon simply had no Normal ask, so the
 * quality-1 projection had nothing to carry and the table kept a two-day-old
 * AODP number. In one real capture file 291 item/city slots are in that state.
 *
 * A view is `{quality, viewId, data}` where `data` is a flat
 * {itemId: {city: entry}} map — the shape getBuyPrice / getSellPrice /
 * getIQRBounds / volumeAt / findBestFlipPair already take. The trick is the
 * KEY: a view for quality q ≥ 2 is filed under the synthetic quality id
 * `ITEM#Q2` (qualityOverrideKey, js/utils.js), which buys three things for
 * free —
 *
 *   - the IQR outlier pool is built from that quality's cities only, so a
 *     Normal price never fences an Outstanding one (or the reverse),
 *   - price overrides stay per quality, the contract the Rerolling table
 *     already relies on,
 *   - not one line of js/utils.js or js/flip-route.js has to know about it.
 *
 * Quality 1 is the identity view: it hands back the caller's own flat map,
 * unwrapped and unfiltered, so a table adopting this cannot regress — the
 * baseline it evaluates first is byte-for-byte what it evaluates today.
 *
 * Built per item, on demand: a view is O(cities), there is no cache to
 * invalidate and no second store to keep in step. The quality map it reads
 * (lastQualityMarketData) is already capture-merged by mergeCapturedIntoQuality.
 *
 * Loaded before js/flip-route-quality.js.
 */

/** Every quality the game has: Normal, Good, Outstanding, Excellent, Masterpiece. */
const QUALITY_LEVELS = [1, 2, 3, 4, 5];

/**
 * The id a view is filed under. Quality 1 keeps the plain item id — it IS the
 * flat map — and everything above it takes the synthetic quality key.
 */
function qualityViewId(itemId, quality) {
  if (quality == null || Number(quality) === 1) return itemId;
  return typeof qualityOverrideKey === "function"
    ? qualityOverrideKey(itemId, quality)
    : `${itemId}#Q${quality}`;
}

/** Does this quality's book hold a price anywhere? Volume alone is not one. */
function qualityBookHasPrice(byCity) {
  if (!byCity) return false;
  return Object.keys(byCity).some((city) => {
    const entry = byCity[city];
    return !!entry && (entry.sell_price > 0 || entry.buy_price > 0);
  });
}

/**
 * The priced qualities of one item, as flat-map views.
 *
 * @param {string} itemId
 * @param {object} flatData      {itemId: {city: entry}} — the app's flat map
 * @param {object} qualityData   {itemId: {quality: {city: entry}}}
 * @param {{qualities?:number[]}} [options]
 * @returns {{quality:number, viewId:string, data:object}[]}  quality-ascending
 */
function qualityViewsFor(itemId, flatData, qualityData, options = {}) {
  const levels = Array.isArray(options.qualities) ? options.qualities : QUALITY_LEVELS;
  const views = [];
  levels.slice().sort((a, b) => a - b).forEach((quality) => {
    if (Number(quality) === 1) {
      // Never gated on the item being present: an absent item makes the caller
      // answer "no route", which is what it answers today.
      views.push({ quality: 1, viewId: itemId, data: flatData || {} });
      return;
    }
    const byCity = qualityData && qualityData[itemId] ? qualityData[itemId][quality] : null;
    if (!qualityBookHasPrice(byCity)) return;
    const viewId = qualityViewId(itemId, quality);
    views.push({ quality: Number(quality), viewId, data: { [viewId]: byCity } });
  });
  return views;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { QUALITY_LEVELS, qualityViewId, qualityBookHasPrice, qualityViewsFor };
}
