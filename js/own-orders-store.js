/**
 * The market orders that are YOURS.
 *
 * The price map (js/market-price-store.js) records the cheapest ask and the
 * fattest bid and has no idea who placed them. Two things went wrong because of
 * that, both reported from the live app:
 *
 *   - a Flipping row quoted the player's own Black Market listing back at them
 *     as the best sell price on the board — profit computed against yourself,
 *   - closing that order changed nothing, because the only thing that can
 *     correct a stored price is a fresh reading of that book, and selling into
 *     a bid is not a reading of the book it emptied. The number sat there,
 *     badged `0m ago`, until the player happened to reopen the market.
 *
 * The player's own market traffic answers both. Which orders stand in your name
 * comes from AuctionGetMyOpenOffers / AuctionGetMyOpenRequests and from every
 * order you place; which books your own trade just invalidated comes from the
 * cancel / sell / buy responses.
 *
 * The second answer is deliberately a STAMP, never a price and never a delete:
 * "this book was read and your number was not in it" is the vocabulary the app
 * already has (`sell_seen` / `buy_seen`, js/price-freshness.js). A trade is
 * evidence about one order, not a census of the book behind it — a partial fill
 * leaves the rest of the bid standing — so it flags, and the next real reading
 * settles it.
 */

// Bound under local names: in the browser these files are plain scripts sharing
// one global scope, so a top-level `const marketCityName` would collide with
// the declaration market-locations.js already makes there.
const ownCityOf = (typeof require !== "undefined")
  ? require("./market-locations.js").marketCityName
  : globalThis.marketCityName;

/** The wire multiplies every silver value by 10000, as it does for orders. */
const OWN_SILVER_SCALE = 10000;

/**
 * What the game just told us about an order of ours.
 *
 *   mine       it stands in your name (a listing of your open orders)
 *   listed     you placed it just now
 *   cancelled  you took it back
 *   sold       you sold into a bid
 *   bought     you bought from an ask
 *
 * `mine` and `listed` say an order EXISTS; the other three say one is gone or
 * smaller, which is the half that invalidates a stored price.
 */
const OWN_ORDER_ACTIONS = new Set(["mine", "listed", "cancelled", "sold", "bought"]);
const OWN_STANDING_ACTIONS = new Set(["mine", "listed"]);
const OWN_CLOSING_ACTIONS = new Set(["cancelled", "sold", "bought"]);

/** A deliberate twin of orderItemId (js/market-price-store.js). */
function ownOrderItemId(order) {
  const base = order && typeof order.ItemTypeId === "string" ? order.ItemTypeId.trim() : "";
  if (!base) return null;
  if (base.includes("@")) return base;
  const enchant = Number(order.EnchantmentLevel) || 0;
  return enchant > 0 ? `${base}@${enchant}` : base;
}

/** "sell" for an ask, "buy" for a bid — the app's names, not the wire's. */
function ownOrderSide(order) {
  const type = String((order && order.AuctionType) || "").toLowerCase();
  if (type === "offer") return "sell";
  if (type === "request") return "buy";
  return null;
}

/** The book one of your orders stands in. */
function ownOrderKey(itemId, quality, city, side) {
  return `${itemId}|${quality}|${city}|${side}`;
}

/** A fresh, empty record of what is yours. Session-scoped; never persisted. */
function createOwnOrders() {
  return { books: {} };
}

/**
 * Everything one order says about itself, or null when it cannot be filed.
 * `city` falls back to the order's own location exactly as the price map does:
 * dens and hideout banks name themselves, city markets rely on where you stand.
 */
function readOwnOrder(order, city) {
  const itemId = ownOrderItemId(order);
  if (!itemId) return null;
  const side = ownOrderSide(order);
  if (!side) return null;
  const where = ownCityOf(order && order.LocationId) || city;
  if (!where) return null;
  const quality = Number(order && order.QualityLevel) || 1;
  const raw = Number(order && order.UnitPriceSilver);
  const price = Number.isFinite(raw) && raw > 0 ? Math.floor(raw / OWN_SILVER_SCALE) : 0;
  return { itemId, side, city: where, quality, price };
}

/**
 * Fold one own-order event into the record.
 *
 * Standing actions add the price to its book, closing ones remove it — matched
 * on the PRICE rather than on the auction id, because that is what the rest of
 * the app can ask about: a row holds a number, not an order id.
 *
 * @returns {number} how many orders were filed or cleared
 */
function recordOwnOrders(state, { action, orders, city = null } = {}) {
  if (!state || !OWN_ORDER_ACTIONS.has(action)) return 0;
  const list = Array.isArray(orders) ? orders : [];
  const standing = OWN_STANDING_ACTIONS.has(action);
  let written = 0;
  for (const order of list) {
    const read = readOwnOrder(order, city);
    if (!read || !read.price) continue;
    const key = ownOrderKey(read.itemId, read.quality, read.city, read.side);
    const prices = state.books[key] || (state.books[key] = []);
    const at = prices.indexOf(read.price);
    if (standing) {
      if (at === -1) prices.push(read.price);
    } else if (at !== -1) {
      prices.splice(at, 1);
      if (!prices.length) delete state.books[key];
    }
    written++;
  }
  return written;
}

/** Whether a stored number is a standing order of yours. */
function isOwnPrice(state, itemId, quality, city, side, price) {
  if (!state || !state.books || !price) return false;
  const prices = state.books[ownOrderKey(itemId, Number(quality) || 1, city, side)];
  return Array.isArray(prices) && prices.includes(price);
}

/** A cell holding nothing but the fact that its book was looked at. */
function ownBlankEntry() {
  return {
    buy_price: 0,
    sell_price: 0,
    sell_date: null,
    buy_date: null,
    volume_24h: 0,
    used_fallback: false,
    from_sniffer: true,
  };
}

/**
 * The stamp-only patch a trade of yours justifies, in the shape
 * `{itemId: {quality: {city: entry}}}` — the same one ordersToPrices produces,
 * so it merges through mergeQualityPrices / recordCapturedPrices unchanged.
 *
 * Only the quality actually traded is stamped: selling a Good bow says nothing
 * about the Normal book beside it.
 */
function invalidateFromAction({ action, orders, city = null, now } = {}) {
  const patch = {};
  if (!OWN_CLOSING_ACTIONS.has(action)) return patch;
  const list = Array.isArray(orders) ? orders : [];
  for (const order of list) {
    const read = readOwnOrder(order, city);
    if (!read) continue;
    const field = read.side === "buy" ? "buy_seen" : "sell_seen";
    if (!patch[read.itemId]) patch[read.itemId] = {};
    if (!patch[read.itemId][read.quality]) patch[read.itemId][read.quality] = {};
    if (!patch[read.itemId][read.quality][read.city]) {
      patch[read.itemId][read.quality][read.city] = ownBlankEntry();
    }
    patch[read.itemId][read.quality][read.city][field] = now;
  }
  return patch;
}

/**
 * The stamp-only patch for a trade whose response named no order at all.
 *
 * Deliberately always EMPTY — and that is a fix, not a gap. This used to stamp
 * every quality of every item the game had answered about a moment before
 * ("read, empty"), but a trade is evidence about ONE order, and nobody read
 * those books: a browse slice does not enumerate them, and the post-trade
 * re-read this relied on to re-price them is often not captured. Live prices
 * sat badged "not listed · looked Xm ago" until the player happened to reopen
 * the market. A response that names no order is evidence about no book, so it
 * invalidates none; the next real reading of each book stamps it honestly.
 * Named responses still go through invalidateFromAction above.
 *
 * The signature is kept for the caller in js/monitor-session.js
 * (`{ itemIds, city, side, now }` — all deliberately ignored).
 */
function invalidateBooks() {
  return {};
}

/** Every book you hold an order in, as `{key: [price, ...]}`. */
function ownOrdersSnapshot(state) {
  return state && state.books ? { ...state.books } : {};
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createOwnOrders, recordOwnOrders, isOwnPrice, invalidateFromAction,
    invalidateBooks, ownOrdersSnapshot,
    ownOrderKey, ownOrderItemId, ownOrderSide, OWN_ORDER_ACTIONS,
  };
}
