/**
 * Which price one LEG of a trade reads from an order-book cell.
 *
 * A cell carries both sides of a city's book: `sell_price` (cheapest ask) and
 * `buy_price` (fattest bid). The Pricing Model picks one per leg — Instant buys
 * at the ask and sells into the bid, Market Orders the other way round
 * (js/utils.js getBuyPrice / getSellPrice).
 *
 * Reported as the sniffer "no prices" bug: the captured file held fresh Lymhurst
 * cells, yet rows were blank. User: "there are prices but since table looking to
 * buy cheapest by buy order when i switch app to instant buy its empty". Those
 * books were bid-only, so an Instant buy leg read 0 beside a live bid. Two
 * fallbacks, decided 2026-09-10:
 *
 *   1. Under INSTANT, a SELL leg whose bid side is empty prices from the ask of
 *      the same book. Market Orders keep their one field — a patient order has
 *      no "other side" to fall back on. (The buy leg's ask → bid fallback was
 *      withdrawn 2026-09-11, see below.)
 *   2. A BUY leg may read any captured QUALITY when quality 1 has nothing on
 *      that side — any quality works as a craft input. The flat map every table
 *      reads is projected from quality 1 alone (flattenCaptured(map, 1)), and a
 *      gear book is often Good / Outstanding with nothing Normal in it. Sell legs
 *      stay quality 1: a crafted output is Normal.
 *
 * Read order, first positive wins:
 *   buy  / instant  ask(q1) → ask(any q)
 *   buy  / market   bid(q1) → bid(any q)
 *   sell / instant  bid(q1) → ask(q1)
 *   sell / market   ask(q1)
 *
 * Nothing can be bought instantly from a buy order. Reported 2026-09-11: the
 * Crafting Planner bought a Tame Firewing Drake "@ 1,500,003 ea (from Fort
 * Sterling)" — a standing bid in a market with no seller — and, once that
 * market's empty ask list was on record, reached for Martlock's bid instead.
 * User's call: an Instant buy with no sell orders reads 0, and the cell says
 * "no instant orders", click to set (onlyBuyOrders).
 *
 * The sell leg's stand-in is for a side nobody has LOOKED at: a bid list read
 * and found empty (`buy_seen`, js/market-price-store.js stampBookSeen) has
 * nothing to sell into, so the leg reads 0 there.
 *
 * The result names the FIELD it came from, so the outlier gate measures a
 * fallback against its own field's distribution and the age badge dates the
 * number actually printed (js/price-freshness.js priceDateFor).
 *
 * Browser global + Node export.
 */

/** The fields a leg reads, in order, before any-quality is considered. */
function bookFieldOrder(side, orderType) {
  const instant = orderType === "instant";
  if (side === "buy") return instant ? ["sell_price"] : ["buy_price"];
  return instant ? ["buy_price", "sell_price"] : ["sell_price"];
}

/**
 * The best `field` across every quality of `itemId` at `city` in the app's
 * capture-merged quality map (lastQualityMarketData): the cheapest ask or the
 * fattest bid. 0 when there is none.
 */
function anyQualityBookPrice(itemId, city, field) {
  const map = (typeof lastQualityMarketData !== "undefined") ? lastQualityMarketData : null;
  const byQuality = map && itemId ? map[itemId] : null;
  if (!byQuality) return 0;
  let best = 0;
  Object.keys(byQuality).forEach((q) => {
    const v = Number(byQuality[q] && byQuality[q][city] && byQuality[q][city][field]) || 0;
    if (v <= 0) return;
    if (!best || (field === "sell_price" ? v < best : v > best)) best = v;
  });
  return best;
}

/**
 * Whether `itemData` is the app's LIVE flat cell for `itemId` — the only map the
 * quality map describes. A per-quality view (`ITEM#Q2`, js/quality-flat-views.js)
 * or a caller's own synthetic map is never widened. An item the flat map has no
 * entry for at all (quality-1 projection empty) reads as live, which is exactly
 * the Good/Outstanding-only book the any-quality read exists for.
 */
function isLiveFlatCell(itemData, itemId) {
  if (!itemId || String(itemId).includes("#Q")) return false;
  const flat = (typeof lastMarketData !== "undefined") ? lastMarketData : null;
  return !!flat && flat[itemId] === itemData;
}

/**
 * Read one leg from one cell.
 *
 * @param {object|null} cell            {buy_price, sell_price, …} or null
 * @param {"buy"|"sell"} side
 * @param {"instant"|"market"} orderType
 * @param {((field:string)=>number)|null} anyQuality  any-quality reader for a
 *   buy leg on the live cell; null elsewhere
 * @returns {{price:number, field:"buy_price"|"sell_price"}} with price 0 the
 *   field is the leg's own primary field
 */
function readBookLeg(cell, side, orderType, anyQuality) {
  const order = bookFieldOrder(side, orderType);
  for (const field of order) {
    const own = Number(cell && cell[field]) || 0;
    if (own > 0) return { price: own, field };
    if (typeof anyQuality === "function") {
      const v = Number(anyQuality(field)) || 0;
      if (v > 0) return { price: v, field };
    }
    // This side was read and nothing was on it: no stand-in from the other side.
    if (cell && cell[field.replace("_price", "_seen")]) break;
  }
  return { price: 0, field: order[0] };
}

/**
 * Someone is bidding and nobody is selling: the case an Instant buy cell labels
 * "no instant orders" rather than "no data" — there is a market, just nothing
 * to take from it.
 *
 * With a `city`, that market alone; with none, every city `itemData` holds (an
 * unsourced planner material, whose line names only the craft city). Qualities
 * count too on the app's live flat cell, the same widening the buy leg reads.
 *
 * @param {object|null} itemData  {city: cell}
 * @param {string} itemId
 * @param {string|null} city
 */
function onlyBuyOrders(itemData, itemId, city) {
  if (!itemData) return false;
  const cities = city ? [city] : Object.keys(itemData);
  const live = isLiveFlatCell(itemData, itemId);
  const best = (c, field) => Math.max(
    Number(itemData[c] && itemData[c][field]) || 0,
    live ? anyQualityBookPrice(itemId, c, field) : 0,
  );
  let bid = false;
  for (const c of cities) {
    if (best(c, "sell_price") > 0) return false;
    if (best(c, "buy_price") > 0) bid = true;
  }
  return bid;
}

/**
 * Whether the field a leg read carries sniffer provenance — the cell came from
 * a live capture (`sell_src` / `buy_src` === "sniffer"), so the cross-city IQR
 * outlier gate must not judge it (js/utils.js getBuyPrice / getSellPrice,
 * rejectedOutlierPrice below). A flagless cell — a scan, an API merge, a
 * legacy record — gates exactly as before.
 */
function isSnifferLeg(cell, field) {
  if (!cell || !field) return false;
  return cell[field === "sell_price" ? "sell_src" : "buy_src"] === "sniffer";
}

/**
 * The price a leg WOULD have read at `city`, had the outlier gate not thrown it
 * away — so an empty cell can say "outlier ignored" instead of "no data".
 *
 * Reported: "Avalonian Energy @ no data" on the Consumables Caerleon row while
 * the price editor listed Caerleon at 712,435 against ~7,000 in every other
 * city. The gate was right to drop it; the cell was wrong to hide that it had.
 *
 * Measured exactly as getBuyPrice / getSellPrice measure it: the field the leg
 * reads (readBookLeg), against that field's cross-city ceiling. With no `city`,
 * the first city whose read is rejected. The exempt cities — the Black Market
 * and Caerleon (plan-caerleon-exempt.md) — are never judged.
 *
 * @param {object|null} itemData  {city: cell}
 * @param {string} itemId
 * @param {string|null} city
 * @param {"buy"|"sell"} side
 * @returns {{city:string, price:number}|null}
 */
function rejectedOutlierPrice(itemData, itemId, city, side) {
  if (!itemData || typeof getIQRBounds !== "function" || typeof sideUpper !== "function") return null;
  const orderType = (typeof getOrderType === "function") ? getOrderType(side) : "market";
  const bounds = getIQRBounds(itemData);
  const cities = city ? [city] : Object.keys(itemData);
  for (const c of cities) {
    // The exempt cities are read ungated by getBuyPrice / getSellPrice
    // (js/utils.js IQR_EXEMPT_CITIES), so no leg of theirs is ever "rejected".
    if (c === "Black Market" || c === "Caerleon" || !itemData[c]) continue;
    const { price, field } = readBookLeg(itemData[c], side, orderType, null);
    if (!(price > 0)) continue;
    if (isSnifferLeg(itemData[c], field)) continue;
    if (price > sideUpper(bounds, field === "sell_price" ? "sell" : "buy")) return { city: c, price };
  }
  return null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { bookFieldOrder, anyQualityBookPrice, isLiveFlatCell, readBookLeg, onlyBuyOrders, rejectedOutlierPrice, isSnifferLeg };
}
