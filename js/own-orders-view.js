/**
 * The player's own standing orders, on the renderer's side of the wire.
 *
 * The capture decides what is yours (js/own-orders-store.js, in the main
 * process); this is the copy the tables ask. It exists because a Flipping row
 * was quoting the player's own Black Market listing back at them as the best
 * sell price on the board: buy at Caerleon, sell to yourself, book the profit.
 *
 * Deliberately session-scoped and never persisted. An order you cancelled while
 * the app was closed would otherwise be claimed as yours forever, and the game
 * re-lists your open orders every time you open a market anyway.
 *
 * Loaded before js/app.js. The state hangs off a function rather than a
 * top-level `const` on purpose: classic scripts put `const` in lexical scope,
 * not on globalThis, so the other files could not see it.
 */

/** "item|quality|city|side" → [price, ...]. Replaced whole on every update. */
var ownOrderBooks = {};

/** Take the capture's snapshot of what stands in the player's name. */
function setOwnOrderBooks(books) {
  ownOrderBooks = books && typeof books === "object" ? books : {};
}

/** Whether a number on the board is an order of the player's own. */
function isOwnMarketPrice(itemId, quality, city, side, price) {
  if (!price || !itemId || !city) return false;
  const key = `${itemId}|${Number(quality) || 1}|${city}|${side}`;
  const prices = ownOrderBooks[key];
  return Array.isArray(prices) && prices.includes(price);
}

/** Whether anything at all is known to be the player's. */
function hasOwnOrders() {
  return Object.keys(ownOrderBooks).length > 0;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { setOwnOrderBooks, isOwnMarketPrice, hasOwnOrders };
}
