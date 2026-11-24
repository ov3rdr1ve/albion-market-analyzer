/**
 * The Mounts table's two City picks, applied to the pools its row builders
 * search.
 *
 * js/table-sell-city.js owns the picks and the general rules; this file is the
 * Mounts-shaped call into them, so js/render-mounts.js and
 * js/render-mounts-craft-row.js read one named call per pool instead of carrying
 * the table id and the reachability guard at every site. Same pattern as
 * js/consumable-city-pick.js.
 *
 * Reported: Buy = Lymhurst, Sell = Lymhurst, and a breeding row still bought its
 * feed in Fort Sterling and its planks in Martlock — the picks only filtered the
 * rendered rows. User decision (2026-09-10): "if i set source city lymhurst, then
 * all mats should show from lymhurst."
 *
 *   mountsPickedPool       a breeding row is built per SECTION (royal / Caerleon /
 *                          everything with Black/Red Zone Routes on), from a pool
 *                          per leg — the baby, the feed and the saddler mats on
 *                          the buy leg, the grown / saddled mount, its masterpiece
 *                          and the raw baby sale on the sell leg.
 *   mountsCraftBuyCities   a craft row knows its craft city, so the buy pool is
 *                          "every market that city may source from", narrowed.
 *   mountsCraftSellCities  the same for the sale; the pick outranks a per-item pin.
 *   mountsPick             the active pick for one leg, for a no-data row's
 *                          editable cells.
 *
 * An empty array means "this section / craft city cannot honour the pick": the
 * caller builds no row there, not even a no-data one. Every helper is a no-op
 * with no pick active, so a table with both pickers on "All" prices exactly as
 * before (effectiveFlipCities hands the very same array back).
 *
 * Browser global + Node export, like the other shared row-level modules.
 */

const MOUNTS_TABLE_ID = "mounts-table";

/**
 * One leg's section pool narrowed to that side's pick.
 *
 * @param {"buy"|"sell"} side
 * @param {string[]} pool the section's own unfiltered list for this leg
 * @returns {string[]} the same array with no pick; [] when the pick is outside it
 */
function mountsPickedPool(side, pool) {
  const list = Array.isArray(pool) ? pool : [];
  if (typeof effectiveFlipCities !== "function") return list;
  return effectiveFlipCities(MOUNTS_TABLE_ID, side, list);
}

/**
 * Markets `craftCity` may buy its craft materials in, under the Buy City pick.
 *
 * @param {string} craftCity
 * @returns {string[]} empty when the pick cannot reach this craft city
 */
function mountsCraftBuyCities(craftCity) {
  const all = (typeof CITIES !== "undefined" && Array.isArray(CITIES)) ? CITIES : [];
  const sourceable = all.filter((c) => typeof isValidSourceCity !== "function"
    || isValidSourceCity(c, craftCity));
  if (typeof effectiveBuyCities !== "function") return sourceable;
  return effectiveBuyCities(MOUNTS_TABLE_ID, craftCity, sourceable);
}

/**
 * Markets a crafted mount may sell in, under the Sell City pick.
 *
 * With no pick this is exactly the craft loop's historical rule — the per-item
 * pin, else every sell city — including a pin the craft city cannot reach (that
 * craft city then records a no-data row, as it always did).
 *
 * @param {string} craftCity
 * @param {string|null} forcedSellCity per-item sell pin
 * @returns {string[]} empty when an active pick cannot be reached from craftCity
 */
function mountsCraftSellCities(craftCity, forcedSellCity) {
  const all = (typeof SELL_CITIES !== "undefined" && Array.isArray(SELL_CITIES)) ? SELL_CITIES : [];
  const pick = mountsPick("sell");
  if (!pick || typeof effectiveSellCities !== "function") {
    return forcedSellCity ? [forcedSellCity] : all;
  }
  return effectiveSellCities(MOUNTS_TABLE_ID, craftCity, null, all);
}

/** The active pick for one leg, or null ("All"). */
function mountsPick(side) {
  if (side === "buy") {
    return (typeof getTableBuyCity === "function") ? getTableBuyCity(MOUNTS_TABLE_ID) : null;
  }
  return (typeof getTableSellCity === "function") ? getTableSellCity(MOUNTS_TABLE_ID) : null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MOUNTS_TABLE_ID,
    mountsPickedPool,
    mountsCraftBuyCities,
    mountsCraftSellCities,
    mountsPick,
  };
}
