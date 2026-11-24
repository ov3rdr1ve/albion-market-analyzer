/**
 * Whether the numeric item index still names what the game means.
 *
 * An order-book request names its items only by number (parameter 8), and those
 * numbers are line indices in ao-bin-dumps items.txt — which a game patch
 * renumbers. js/item-index.js is a snapshot of that file, so after a patch it
 * names the wrong item with full confidence. Reported 2026-09-11: the 09-03
 * patch inserted items near the top, 12,049 of 12,071 ids shifted, and for a
 * week every "book was read" stamp and every captured price-chart volume was
 * filed under some other item. Opening the Firewing Drake stamped the Crystal
 * Roving Bastion; the empty Tame Firewing Drake ask list was never recorded,
 * so the Crafting Planner went on buying a drake nobody was selling.
 *
 * A response that carries orders is the check: every order names its own item.
 * A named request answered with orders for none of the items it named is a
 * mismatch. Mismatches outweighing matches means the index is stale — and then
 * the only thing that can still be trusted is what the orders say.
 *
 * Dependency-free; browser global + Node export.
 */

/** Mismatches needed before a verdict: one odd response is not a stale index. */
const INDEX_STALE_MIN_MISMATCHES = 3;

/** "T4_BAG@2" → "T4_BAG". An enchanted order still answers its base item. */
function baseItemId(id) {
  return String(id).replace(/@\d+$/, "");
}

/**
 * Judge one named request against the orders its own response carried.
 * @param {string[]} namedIds  ids the index resolved the request's numbers to
 * @param {string[]} orderIds  ids the returned orders name themselves
 * @returns {"match"|"mismatch"|"unknown"}  unknown when either side is empty
 */
function judgeNamedQuery(namedIds, orderIds) {
  const named = new Set((namedIds || []).filter(Boolean).map(baseItemId));
  const answered = (orderIds || []).filter(Boolean).map(baseItemId);
  if (!named.size || !answered.length) return "unknown";
  return answered.some((id) => named.has(id)) ? "match" : "mismatch";
}

/** Whether the tally says the index names the wrong items. */
function itemIndexLooksStale(matches, mismatches) {
  return mismatches >= INDEX_STALE_MIN_MISMATCHES && mismatches > matches;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { judgeNamedQuery, itemIndexLooksStale, INDEX_STALE_MIN_MISMATCHES };
}
