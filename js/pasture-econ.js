// Pasture economics — how many eggs/milk one 22h produce cycle actually hands
// over, and where to stand the animal.
//
// A grown animal on a pasture slot eats `feedCount` favorite crops and produces
// `produceBase` byproducts per cycle (js/data-farming.js). Two things scale that
// batch, and neither is a Return Rate: Premium's +100% Product Yield and the +10%
// local production bonus of the city that specializes in the byproduct (the same
// bonus the Farming table claims through getFarmingYieldBonus). They are the same
// stat on the in-game tooltip, so they SUM ONCE (x2.1 with both) instead of
// chaining. The animal itself is reusable capital and is priced separately —
// never charged to the cycle.
//
// Kept out of js/calculations.js on purpose: that file is already at the 800-line
// cap, and this is one self-contained rule shared by the chain pricer
// (js/chain-pricing.js) and the Consumables pasture row.

/**
 * How much bigger one pasture batch is than the free-account, no-bonus base.
 *
 * @param {string} outputId - the byproduct's market id (T4_MILK, T3_EGG, …)
 * @param {string|null} city - where the animal stands
 * @returns {number} multiplier on the recipe's base output (1, 1.1, 2 or 2.1)
 */
function getPastureYieldMultiplier(outputId, city) {
  // Premium defaults to ON when the toggle isn't loaded (Node, boot render) —
  // same convention as js/render-farming.js.
  const premium = (typeof isPremiumEnabled === "function") ? isPremiumEnabled() : true;
  const bonus = (typeof getFarmingYieldBonus === "function")
    ? (getFarmingYieldBonus(city || "", outputId) || 0)
    : 0;
  return 1 + (premium ? 1 : 0) + bonus;
}

/**
 * The city in `cityPool` that pays the byproduct's +10% bonus, else `fallback`.
 * Direct analogue of getOptimalButcherCity: the feed is bought wherever it is
 * cheapest, but the pasture the animal stands on is a choice of its own.
 *
 * @param {string} outputId - the byproduct's market id
 * @param {string[]} cityPool - reachable cities, in search order
 * @param {string} fallback - city to use when none of the pool specializes
 * @returns {string}
 */
function getOptimalPastureCity(outputId, cityPool, fallback) {
  if (!outputId || !Array.isArray(cityPool) || cityPool.length === 0) return fallback;
  if (typeof getFarmingYieldBonus !== "function") return fallback;
  for (const city of cityPool) {
    if ((getFarmingYieldBonus(city, outputId) || 0) > 0) return city;
  }
  return fallback;
}

// Node test harness export. Inert in the browser, which loads this as a global.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getPastureYieldMultiplier, getOptimalPastureCity };
}
