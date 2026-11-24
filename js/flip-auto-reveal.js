/**
 * Enchant (.1–.4) rows the Flipping table puts on the board by itself.
 *
 * Reported: "if the 8.4 flip is profitable I cannot see it until I expand the
 * row to 8.4 — if it is profitable it should show as a separate entry, and a
 * row holding profitable .1–.4 items should already be expanded."
 *
 * The board is base ids only (js/flip-enchant-variants.js): materialising every
 * enchant level up front would triple the app's biggest table, and a flip row is
 * a route search over city PAIRS, not a lookup. So a variant only existed once
 * the user opened its base or picked its level — which means a profitable .4
 * flip was invisible to anyone who did not already suspect it.
 *
 * The way out is not to price everything. It is to notice that a variant can
 * only ever route if the app ALREADY holds both sides of its book, and that is
 * an O(cities) read:
 *
 *   4,598 enchant variants carry a price in a real store
 *   2,669 of those carry an ask AND a bid  ← the only ones worth routing
 *     ~430 of those actually turn a profit ← the only ones that get a row
 *
 * So the pre-gate does the cheap arithmetic and the EXISTING row builder does
 * the expensive part, on a sixth of the board. There is no second profit model
 * here: `flipAutoRevealLevels` takes the renderer's own `buildFlipRowsForItem`
 * and keeps whatever it calls profitable, so an auto-revealed row and a
 * hand-expanded one are the same row, decided the same way.
 *
 * Expansion state is TWO sets, deliberately:
 *
 *   - the Flipping table's own expand set (expandedCraftItemsFor, js/sorting.js)
 *     is what the USER opened.
 *   - `flipAutoCollapsed` is what the user closed that this file had opened.
 *
 * Without the second one a click on the ▼ of an auto-expanded base would add it
 * to `expandedCraftItems` and open it further — the toggle would look broken.
 * `flipToggleExpand` owns both, so "does this base show its children" has one
 * answer and one place that changes it.
 *
 * Loaded after js/flip-enchant-variants.js, before js/render-flipping.js.
 */

/** baseId → Set of enchant levels worth a row of their own. Rebuilt per render. */
let flipAutoRevealed = new Map();

/** Bases the user closed after this file opened them. Survives a re-render. */
const flipAutoCollapsed = new Set();

/**
 * Could this variant possibly route? An ask somewhere AND a bid somewhere.
 *
 * Cheap on purpose — this runs over ~5,700 ids before a single route search —
 * and deliberately blind to which cities they are in: the pairing rules
 * (js/flip-route.js isInvalidCrossRoute, the city picks, the volume gate) are
 * the row builder's job, and duplicating them here would be a second model to
 * keep in step. A candidate that turns out unroutable simply loses in the pass
 * that follows.
 *
 * Both maps are read because a captured gear book is routinely Good or
 * Outstanding with nothing Normal in it (js/quality-flat-views.js), and the flat
 * map is the quality-1 projection alone.
 */
function flipVariantCouldRoute(id, flatData, qualityData) {
  let ask = false;
  let bid = false;
  const scan = (byCity) => {
    if (!byCity) return;
    for (const city of Object.keys(byCity)) {
      const entry = byCity[city];
      if (!entry) continue;
      if (entry.sell_price > 0) ask = true;
      if (entry.buy_price > 0) bid = true;
      if (ask && bid) return;
    }
  };
  scan(flatData && flatData[id]);
  const byQuality = qualityData && qualityData[id];
  if (byQuality) {
    for (const quality of Object.keys(byQuality)) {
      if (ask && bid) break;
      scan(byQuality[quality]);
    }
  }
  return ask && bid;
}

/**
 * Which .1–.4 levels of each base earn a row on their own.
 *
 * @param {object[]} catalog   the flip universe, base ids (getAllFlippingItems)
 * @param {object} flatData    {itemId: {city: entry}}
 * @param {object} qualityData {itemId: {quality: {city: entry}}}
 * @param {(item:object) => object[]} buildRows  the renderer's own row builder
 * @returns {Map<string, Set<number>>}
 *
 * Profit, not margin percent: a 40% margin on a 300-silver bag is not a play,
 * and the board's own Pure Profit column is what a reader ranks by. A row that
 * cannot price (`noData`) is never revealed — the user asked for the profitable
 * ones, and an empty row is noise wearing their shape.
 */
function flipAutoRevealLevels(catalog, flatData, qualityData, buildRows) {
  const map = new Map();
  if (typeof buildRows !== "function") return map;
  if (typeof hasEnchantVariants !== "function" || typeof flipEnchantVariant !== "function") return map;
  (catalog || []).forEach((item) => {
    if (!item || !hasEnchantVariants(item.id)) return;
    for (let n = 1; n <= 4; n++) {
      if (!flipVariantCouldRoute(`${item.id}@${n}`, flatData, qualityData)) continue;
      const rows = buildRows(flipEnchantVariant(item, n));
      const worth = Array.isArray(rows) && rows.some((row) =>
        row && !row.noData && row.marginInfo && row.marginInfo.profit > 0);
      if (!worth) continue;
      if (!map.has(item.id)) map.set(item.id, new Set());
      map.get(item.id).add(n);
    }
  });
  return map;
}

/** Install the pass's result. Called once per render, before the rows are built. */
function setFlipAutoRevealed(map) {
  flipAutoRevealed = map instanceof Map ? map : new Map();
}

/**
 * The levels this base reveals by itself — none once the user has closed it.
 * Ascending, so the children read .1 → .4 under their parent.
 */
function flipAutoRevealedLevels(baseId) {
  if (flipAutoCollapsed.has(baseId)) return [];
  const set = flipAutoRevealed.get(baseId);
  return set ? [...set].sort((a, b) => a - b) : [];
}

/**
 * The Flipping table's own user-expand set (js/sorting.js keeps one per table,
 * so a base opened in Crafting does not open here). Falls back to the bare
 * shared set where sorting.js is not loaded.
 */
function _flipUserExpanded() {
  if (typeof expandedCraftItemsFor === "function") return expandedCraftItemsFor("flipping-table");
  return typeof expandedCraftItems !== "undefined" ? expandedCraftItems : null;
}

/** Is this base showing children right now, for whatever reason? */
function isFlipExpanded(baseId) {
  const expanded = _flipUserExpanded();
  if (expanded && expanded.has(baseId)) return true;
  return flipAutoRevealedLevels(baseId).length > 0;
}

/**
 * The Flipping table's ▶/▼ click, for both kinds of open row.
 *
 * Closing an auto-expanded base is remembered separately from the user's own
 * expansions, and opening any base clears that memory — so a base the user
 * re-opens shows the FULL ladder, not just the levels that happened to be
 * profitable.
 *
 * @returns {boolean} whether the base is open after the click, which is what
 *   tells the caller if a lazy price fetch is worth firing.
 */
function flipToggleExpand(baseId) {
  const open = isFlipExpanded(baseId);
  const expanded = _flipUserExpanded();
  if (!expanded) return open;
  if (open) {
    expanded.delete(baseId);
    if (flipAutoRevealed.has(baseId)) flipAutoCollapsed.add(baseId);
    return false;
  }
  flipAutoCollapsed.delete(baseId);
  expanded.add(baseId);
  return true;
}

/** Tests and the "clear data" path: forget every derived and remembered state. */
function resetFlipAutoReveal() {
  flipAutoRevealed = new Map();
  flipAutoCollapsed.clear();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    flipVariantCouldRoute,
    flipAutoRevealLevels,
    setFlipAutoRevealed,
    flipAutoRevealedLevels,
    isFlipExpanded,
    flipToggleExpand,
    resetFlipAutoReveal,
  };
}
