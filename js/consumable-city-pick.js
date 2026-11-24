/**
 * The Consumables table's two City picks, applied to the pools its row builders
 * search.
 *
 * js/table-sell-city.js owns the picks themselves and the general rules; this
 * file is only the Consumables-shaped call into them, so js/render-consumables.js
 * (at the repo's 800-line cap) reads one named call instead of carrying the
 * table id, the pool and the reachability guard at every site.
 *
 * Three shapes, because the row builders start from three different places:
 *
 *   consumableBuyCities   a craft row knows the city it crafts in, so the buy
 *                         pool is "every market that city may source from",
 *                         narrowed to the pick (effectiveBuyCities).
 *   consumableSellCities  the same for the sale, with the per-item sell pin the
 *                         pick outranks (effectiveSellCities).
 *   consumablePickedPool  the chain and flip rows, which are handed a pool per
 *                         section (royal / Caerleon) rather than one craft city
 *                         — there is nothing to check reachability against, so
 *                         it is the plain intersection (effectiveFlipCities).
 *
 * An empty array means "the pick cannot be honoured here": the caller drops that
 * arm rather than emitting a route that ignores it. Every helper is a no-op with
 * no pick active, so a table with both pickers on "All" prices exactly as before.
 *
 * Browser global + Node export, like the other shared row-level modules.
 */

const CONSUMABLE_TABLE_ID = "consumable-table";

/**
 * Markets `craftCity` may buy its ingredients in, under the Buy City pick.
 *
 * @param {string} craftCity
 * @returns {string[]} empty when the pick cannot reach this craft city
 */
function consumableBuyCities(craftCity) {
  const all = (typeof CITIES !== "undefined" && Array.isArray(CITIES)) ? CITIES : [];
  const sourceable = all.filter((c) => typeof isValidSourceCity !== "function"
    || isValidSourceCity(c, craftCity));
  if (typeof effectiveBuyCities !== "function") return sourceable;
  return effectiveBuyCities(CONSUMABLE_TABLE_ID, craftCity, sourceable);
}

/**
 * Markets the finished consumable may be sold in, under the Sell City pick.
 *
 * `forcedSellCity` is the per-item pin a typed override leaves behind; pass it
 * only when the craft city can legitimately reach it (the royal / Caerleon
 * split), which is the guard the callers already applied.
 *
 * @param {string} craftCity
 * @param {string|null} forcedSellCity
 * @returns {string[]} empty when the pick cannot reach this craft city
 */
function consumableSellCities(craftCity, forcedSellCity) {
  const all = (typeof SELL_CITIES !== "undefined" && Array.isArray(SELL_CITIES)) ? SELL_CITIES : [];
  if (typeof effectiveSellCities !== "function") {
    return forcedSellCity ? [forcedSellCity] : all;
  }
  return effectiveSellCities(CONSUMABLE_TABLE_ID, craftCity, forcedSellCity || null, all);
}

/**
 * One leg's pool narrowed to that side's pick, for the rows built per SECTION
 * rather than per craft city (the chain rows and the flip rows).
 *
 * @param {"buy"|"sell"} side
 * @param {string[]} pool the caller's own unfiltered list for this leg
 * @returns {string[]} empty when this section cannot honour the pick
 */
function consumablePickedPool(side, pool) {
  const list = Array.isArray(pool) ? pool : [];
  if (typeof effectiveFlipCities !== "function") return list;
  return effectiveFlipCities(CONSUMABLE_TABLE_ID, side, list);
}

/**
 * Profit / 10k Focus is focus-ON play, so it must not follow the Use Focus
 * checkbox. With Black/Red Zone routes on, one row merges Caerleon and the royal
 * cities, which source from DIFFERENT markets — so the checkbox can flip the
 * winning craft city (or chain arm) and drag the per-10k figure along with it.
 * These pick the winner WITH focus (the same pick the checkbox-on render makes)
 * and lend its focus-on figure to the displayed row.
 */
function trackFocusOnBest(best, candidate, focusProfit, focusInputCost) {
  candidate.focusOnMargin = focusInputCost > 0 ? (focusProfit / focusInputCost) * 100 : 0;
  return !best || candidate.focusOnMargin > best.focusOnMargin ? candidate : best;
}

/** The chain arm that wins with focus on (per-output focus-on profit). */
function bestFocusOnArm(arms) {
  return arms.reduce((best, r) => (
    !best || (r.profitFocusOnPerOutput || 0) > (best.profitFocusOnPerOutput || 0) ? r : best
  ), null);
}

/** `row` carrying `focusRow`'s focus-on per-10k figure (row itself when the same). */
function withFocusOnPer10k(row, focusRow) {
  if (!row || !focusRow || focusRow === row) return row;
  return { ...row, profitFocusOn: focusRow.profitFocusOn, profitPer10kFocus: focusRow.profitPer10kFocus,
    profitFocusOnGathered: focusRow.profitFocusOnGathered,
    profitPer10kFocusGathered: focusRow.profitPer10kFocusGathered };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CONSUMABLE_TABLE_ID,
    consumableBuyCities,
    consumableSellCities,
    consumablePickedPool,
    trackFocusOnBest,
    bestFocusOnArm,
    withFocusOnPer10k,
  };
}
