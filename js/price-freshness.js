/**
 * Which date belongs beside a price.
 *
 * A market entry carries TWO order books and two timestamps — `sell_price` /
 * `sell_date` for the asks, `buy_price` / `buy_date` for the bids — and they
 * age independently. A capture of the Black Market's standing bids writes only
 * the buy side; mergeEntry (js/market-price-store.js) deliberately keeps the
 * previous ask and ITS date. Better than half of a typical stored book has more
 * than a day between the two.
 *
 * So a cell that prints one field and dates it with the other is simply lying,
 * which is what "a price captured minutes ago labelled 4d ago" was. The field
 * is picked exactly the way getBuyPrice / getSellPrice (js/utils.js) pick the
 * PRICE field — off that side's OWN Pricing Model toggle, since the Buy and
 * Sell radios move independently — so the badge always describes the number
 * above it:
 *
 *   cell            reads                 date
 *   buy  / instant  sell_price (ask)      sell_date
 *   buy  / market   buy_price  (bid)      buy_date
 *   sell / instant  buy_price  (bid)      buy_date
 *   sell / market   sell_price (ask)      sell_date
 *
 * The Black Market needs no special case: getSellPrice picks its field by the
 * same sell toggle as every other city, so the badge follows it for free.
 *
 * Consumed by priceTd (js/app.js) and the Rolling table's fragment cell
 * (js/render-rolling.js). Loaded before js/app.js.
 */

/**
 * How far apart two readings of one book may be and still count as the SAME
 * look at it.
 *
 * Order lists answer in price-ascending PAGES, and a market category browse
 * pages across dozens of items at once: the page carrying an item's cheapest
 * Normal ask is followed, seconds later, by a dearer page carrying only its
 * Outstanding one. Both pages stamp the item as read, so without this window
 * the cheapest ask on the board was flagged "not listed" by the very browse
 * that had just found it — reported on `Grandmaster's Bow [T7]`, price and
 * stamp ten seconds apart.
 *
 * A minute is far longer than a browse's paging and far shorter than a second
 * visit to the market, which is the only thing the flag is meant to describe.
 */
const BOOK_READ_BURST_MS = 60 * 1000;

/** The entry field holding the date for a cell on `side`. */
function priceDateField(side, orderType) {
  // `orderType`, when given, pins the field regardless of the header. Otherwise
  // the side asks its own toggle; getOrderType absent (Node harnesses) resolves
  // to market orders, the same default the fee getters in js/calculations.js take.
  const mode = orderType
    || (typeof getOrderType === "function" ? getOrderType(side) : "market");
  const instant = mode === "instant";
  return side === "buy"
    ? (instant ? "sell_date" : "buy_date")
    : (instant ? "buy_date" : "sell_date");
}

/** The date to badge a `side` cell of `entry` with, or null. */
function priceDateFor(entry, side, orderType) {
  if (!entry) return null;
  const mode = orderType
    || (typeof getOrderType === "function" ? getOrderType(side) : "market");
  // Under Instant an empty side is priced from the other side of the book
  // (js/price-book-fallback.js), so the badge dates the field actually printed.
  if (typeof readBookLeg === "function") {
    const { price, field } = readBookLeg(entry, side, mode, null);
    if (price > 0) return entry[field.replace("_price", "_date")] || null;
  }
  return entry[priceDateField(side, mode)] || null;
}

/**
 * The field stamping when the book behind a `side` cell was last READ.
 *
 * A price and an observation are different facts. `sell_date` says when this
 * ask was recorded; `sell_seen` says when the ask list was last opened. Only
 * the second can tell "nothing is listed here" from "nobody has looked" —
 * a zero price cannot, because a zero side means "not observed" and is never
 * allowed to erase a price (mergeEntry, js/market-price-store.js).
 */
function priceSeenField(side, orderType) {
  return priceDateField(side, orderType).replace("_date", "_seen");
}

/**
 * When the book behind a `side` cell was last read WITHOUT the price it shows
 * being in it — i.e. the number above the badge is gone from the market. Null
 * when the book has not been read since, or was never read at all.
 *
 * The price is flagged, never deleted. Order lists arrive in pages and packets
 * get dropped, so an offer missing from what was captured is not proof it is
 * missing from the market; and a later page carrying it moves its date past
 * the stamp, which clears this on its own.
 */
function bookEmptySince(entry, side, orderType) {
  if (!entry) return null;
  const seen = entry[priceSeenField(side, orderType)];
  const seenMs = seen ? Date.parse(seen) : NaN;
  if (!Number.isFinite(seenMs)) return null;
  const priced = entry[priceDateField(side, orderType)];
  const pricedMs = priced ? Date.parse(priced) : NaN;
  if (Number.isFinite(pricedMs) && pricedMs >= seenMs - BOOK_READ_BURST_MS) return null;
  return seen;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    priceDateField, priceDateFor, priceSeenField, bookEmptySince, BOOK_READ_BURST_MS,
  };
}
