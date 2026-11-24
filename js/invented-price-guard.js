/**
 * Invented-price guard — drop a history-invented price that contradicts what
 * the other cities REALLY quote.
 *
 * js/api.js mergeEntryWithHistory fills a missing side of an AODP cell from the
 * 24h average, and clampFallbackOutliers rejects the result when it sits far
 * from AODP's own live prices in the other cities. That reference set is too
 * thin for anything the sniffer covers better than AODP does: Avalonian Energy
 * had fewer than two live AODP asks, so a Caerleon ask invented from a troll
 * trade (712,435 against ~7,000 everywhere else) survived the clamp, won every
 * fold by date, and left the Consumables Caerleon row reading "no data".
 *
 * Here the reference is every REAL price the app holds for that side — AODP
 * live and sniffer captures alike — once the scan has been folded in. Same band
 * as the clamp (÷3 … ×3 of the median), same exemptions: two references at
 * least, the Black Market and Caerleon (plan-caerleon-exempt.md) out of both
 * roles, real prices never touched (a real lone listing is the IQR gate's job,
 * js/utils.js iqrUpper).
 *
 * Browser: a plain global script. Node: required by the tests and by
 * js/captured-prices-store.js.
 */

const INVENTED_GUARD_FACTOR = 3;
// Same exemption as the clamp (js/api.js CLAMP_EXEMPT_CITIES): the Black
// Market's premium, and Caerleon's quotes at any ratio
// (plan-caerleon-exempt.md), belong to no cross-city comparison.
const INVENTED_GUARD_EXEMPT = ["Black Market", "Caerleon"];

/** isInventedSide lives with the fold that also needs it. */
function _igIsInvented(entry, side) {
  if (typeof isInventedSide === "function") return isInventedSide(entry, side);
  if (typeof require === "function") return require("./market-price-store.js").isInventedSide(entry, side);
  return false;
}

function _igMedian(sorted) {
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Guard one item's {city: cell} map in place.
 * @returns {number} how many sides were zeroed
 */
function guardInventedPrices(cityMap, factor = INVENTED_GUARD_FACTOR) {
  if (!cityMap) return 0;
  const cities = Object.keys(cityMap).filter((c) => !INVENTED_GUARD_EXEMPT.includes(c) && cityMap[c]);
  let zeroed = 0;
  ["buy", "sell"].forEach((side) => {
    const field = `${side}_price`;
    const refs = cities
      .filter((c) => cityMap[c][field] > 0 && !_igIsInvented(cityMap[c], side))
      .map((c) => cityMap[c][field])
      .sort((a, b) => a - b);
    if (refs.length < 2) return;
    const ref = _igMedian(refs);
    if (!(ref > 0)) return;
    cities.forEach((c) => {
      const cell = cityMap[c];
      const price = cell[field];
      if (!(price > 0) || !_igIsInvented(cell, side)) return;
      if (price > ref * factor || price * factor < ref) {
        cell[field] = 0;
        cell[`${side}_fallback`] = false;
        zeroed++;
      }
    });
  });
  // The cell-wide flag follows: exact when both sides are known, cleared when
  // nothing priced is left to have been invented.
  cities.forEach((c) => {
    const cell = cityMap[c];
    if (!cell.used_fallback) return;
    if (!(cell.buy_price > 0) && !(cell.sell_price > 0)) cell.used_fallback = false;
    else if (typeof cell.buy_fallback === "boolean" && typeof cell.sell_fallback === "boolean") {
      cell.used_fallback = cell.buy_fallback || cell.sell_fallback;
    }
  });
  return zeroed;
}

/**
 * Guard a flat {item: {city: cell}} map, in place — every item, or only `ids`.
 * @returns {number} sides zeroed
 */
function guardInventedPriceMap(map, ids) {
  if (!map) return 0;
  let zeroed = 0;
  (ids || Object.keys(map)).forEach((id) => { zeroed += guardInventedPrices(map[id]); });
  return zeroed;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { guardInventedPrices, guardInventedPriceMap, INVENTED_GUARD_FACTOR };
}
