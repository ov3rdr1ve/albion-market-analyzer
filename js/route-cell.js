// The Route column: "Buy: Thetford → Refine: Martlock → Sell: Caerleon".
//
// It names the two cities every other number on the row is derived from, and it
// used to be dead text — the only way to correct one of those prices was to hunt
// for the matching cell in the Materials or Sell column, which on a wide table is
// off-screen. So the city names are click-to-override now, using the same
// contract every price cell in the app already uses (js/app.js matPriceSpan /
// priceTd): class `price-editable` plus data-item-id / data-city / data-raw-price
// / data-city-list. The global delegated handler picks them up with no wiring of
// its own.
//
// Only the legs that name a PRICED item are clickable. A craft or refine city is
// a place, not a price, so it stays plain — there is nothing to override there.
//
// Browser + Node (tests inject nothing; this file touches no DOM and no globals
// beyond the escaper it borrows).

/** Minimal attribute escaper — mirrors the inline escaping the renderers do. */
function _routeAttr(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function _routeTx(en, slug) {
  return typeof tx === "function" ? tx(en, slug) : en;
}

/**
 * One leg of a route.
 *
 * @param {object} part
 * @param {string} part.label   "Buy" / "Refine" / "Sell" — already translated
 * @param {string} part.city
 * @param {string} [part.itemId] the item priced at that city; omit for a leg
 *                               that is a place only (a craft/refine station)
 * @param {"buy"|"sell"} [part.side]  which order book the editor should open on
 * @param {number} [part.price] the price the row is using, for the editor's
 *                              "was" value (data-raw-price)
 * @param {number} [part.quality] the order-book quality (2..5) the price came
 *                                from; emitted as data-quality exactly like
 *                                js/app.js priceTd, so the editor opens that book
 * @param {string} [part.suffix] HTML appended inside the leg (spec / fee badges)
 * @returns {string} HTML
 */
function routeLeg(part) {
  const label = part.label ? `${part.label}: ` : "";
  const city = part.city || "";
  // Escaped in the text too, not only in the attributes: city names come from a
  // fixed constant today, but a cell that interpolates a string into markup
  // should not depend on that staying true.
  const cityText = _routeAttr(city);
  const suffix = part.suffix || "";
  if (!city || !part.itemId) return `${label}${cityText}${suffix}`;
  const side = part.side === "buy" ? "buy" : "sell";
  const title = _routeTx("Click to override price", "r_tip_override_price");
  const qualityAttr = part.quality != null ? ` data-quality="${_routeAttr(part.quality)}"` : "";
  return `${label}<span class="price-editable route-city"`
    + ` data-item-id="${_routeAttr(part.itemId)}"`
    + ` data-city="${_routeAttr(city)}"`
    + ` data-raw-price="${Number(part.price) || 0}"`
    + ` data-city-list="${side}"${qualityAttr}`
    + ` title="${_routeAttr(title)}">${cityText}</span>${suffix}`;
}

/**
 * The whole `<td class="cell-route">`.
 *
 * @param {object[]} parts   legs, in reading order (see routeLeg)
 * @param {object}   [opts]
 * @param {string}   [opts.trailing]   HTML after the last leg (fee badges)
 * @param {string}   [opts.separator]  default " → "
 * @param {string}   [opts.style]      inline style for the cell
 * @returns {string} HTML
 */
function routeCityCell(parts, { trailing = "", separator = " → ", style = "" } = {}) {
  // A leg with no city is a leg the row does not have — dropped rather than
  // rendered as a dangling "Sell: " with a separator in front of it.
  const body = (parts || []).filter((p) => p && p.city).map(routeLeg).join(separator);
  const styleAttr = style ? ` style="${style}"` : "";
  return `<td class="cell-route"${styleAttr}>${body}${trailing}</td>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { routeLeg, routeCityCell };
}
