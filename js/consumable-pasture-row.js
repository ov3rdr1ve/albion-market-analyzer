// Consumables table — the PASTURE row (eggs, milk).
//
// A pasture is not a craft: there is no station fee, no return rate and no focus
// to spend. One grown animal eats 9 favorite crops per 22h cycle and hands back
// 9 byproducts — 18 with Premium, +10% again in the city that specializes in
// that byproduct. The animal survives, so it is capital: priced so the row can
// show what the play costs to START, but never charged to the cycle (the same
// treatment js/farming-row-econ.js evaluateFarmingAnimal gives it).
//
// Split out of js/render-consumables.js, which is at its size cap. The chain
// pricer has already spread the feed cost over the scaled batch
// (js/chain-pricing.js), so this module only reads the node back and prices the
// capital leg.

/**
 * The pasture-specific fields of one chain-craft row.
 *
 * @param {object} chain - the ChainNode from forceChainSourcing (station "pasture")
 * @param {object} ctx - { perUnit, marketData, citySearch, fallbackCity }
 * @returns {{
 *   pastureCity: string, pastureBonus: string|null, yieldMult: number,
 *   effectiveOutput: number, effectiveCostPerOutput: number,
 *   capitalBuy: { matId, city, price }|null,
 * }}
 */
function buildPastureRowFields(chain, ctx) {
  const yieldMult = chain.yieldMult || 1;
  const pastureCity = chain.pastureCity || ctx.fallbackCity;
  const bonus = (typeof getFarmingYieldBonus === "function")
    ? getFarmingYieldBonus(pastureCity || "", chain.produces)
    : 0;
  return {
    pastureCity,
    pastureBonus: bonus > 0 ? `+${Math.round(bonus * 100)}%` : null,
    yieldMult,
    // The cycle's whole produce, and the feed cost already divided by it.
    effectiveOutput: chain.output * yieldMult,
    effectiveCostPerOutput: ctx.perUnit,
    capitalBuy: priceStandingAnimal(chain, ctx),
  };
}

/**
 * Cheapest listing for the grown animal across the whole candidate pool. It is
 * carried to the pasture once, so where it was cheapest does not constrain where
 * the feed is bought every cycle — same search evaluateFarmingAnimal runs.
 */
function priceStandingAnimal(chain, ctx) {
  if (!chain.capital || !chain.capital.matId) return null;
  if (typeof findBestBuyCity !== "function") return null;
  const found = findBestBuyCity(ctx.marketData, chain.capital.matId, ctx.citySearch, 0, null);
  if (!found || !(found.price > 0)) {
    return { matId: chain.capital.matId, city: null, price: 0 };
  }
  return { matId: chain.capital.matId, city: found.city, price: found.price };
}

/**
 * The capital line under a pasture row's ingredients. Worded as capital, not as
 * a cost: it is deliberately outside Total Input Cost because the animal is
 * reusable and still resellable.
 */
function renderPastureCapitalLine(capitalBuy) {
  if (!capitalBuy) return "";
  const name = (typeof ITEM_NAMES_MAP !== "undefined" && ITEM_NAMES_MAP[capitalBuy.matId])
    || (typeof getItemDisplayName === "function" && getItemDisplayName(capitalBuy.matId))
    || capitalBuy.matId;
  const label = tx("capital", "r_capital");
  const priced = capitalBuy.price > 0
    ? `${formatSilver(capitalBuy.price)} @ ${capitalBuy.city}`
    : tx("no data", "r_no_data");
  const tip = tx("Bought once and still resellable — the animal survives every cycle, so it is not part of the cost per unit", "r_capital_tip");
  return `<br><small style="color:#9ca3af" title="${tip}">${label}: 1x ${name} — ${priced}</small>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildPastureRowFields, renderPastureCapitalLine };
}
