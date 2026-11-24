// Crafting Planner — the enchant acquisition route. An @n equipment item
// (n=1..3) can be crafted from enchanted resources (the planner's default) or
// BOUGHT as the @(n-1) item and enchanted up at a crafting station, burning a
// fixed rune/soul/relic count by slot (js/data-enchanting.js). This module
// prices the second route; js/craft-planner-pricing.js books it on the row when
// it beats the craft input cost.
//
// Economics mirror the standalone Enchanting table (js/render-enchanting.js):
//   cost = buyPrice(@(n-1)) × (1 + SETUP_FEE)
//        + slotCount × buyPrice(rune/soul/relic) × (1 + SETUP_FEE)
// except that the rune/soul/relic may be cheaper to transmute up from a lower
// node (Soul → Relic, 5× T5 → T6); its transmute silver pays no setup fee.
// No station fee, no RRR return, no journal fill, no focus — those are
// craft-route concepts and do not apply here.
//
// Buy-city selection mirrors the planner's material sourcing
// (_cpChainOpts in js/craft-planner-pricing.js): with no table Buy-City pick
// the pool is every city; with a pick it is exactly that city's reachable pool,
// and an empty pool means no route rather than a quiet fallback. A per-item
// buy force is honored when its city is in the pool (js/render-enchanting.js
// keeps the same rule for its section scope). Both buy legs must be able to
// REACH the row's sell city (isInvalidCrossRoute) like every other buy leg.
//
// Pure-ish: all cross-module helpers are resolved at call time so the file is
// unit-testable standalone (tests/craft-planner-enchant-route.test.cjs).

// The @n of an item id (0 when unenchanted).
function _ceEnchantOf(id) {
  const m = id && String(id).match(/@(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

// Cheapest priced buy of `id` across `pool`. A force on `id` that is in the
// pool owns the leg outright — priced there, or the leg is dead (a force says
// "source it here", not "source something else instead"). Mirrors
// render-enchanting.js:43-78 restricted to the planner's city pool.
function _ceCheapestBuy(id, marketData, pool) {
  if (!pool.length) return null;
  const bounds = getIQRBounds(marketData[id]);
  const force = (typeof getCityForce === "function") ? getCityForce(id, "buy") : null;
  if (force && pool.includes(force)) {
    const p = getBuyPrice(marketData[id], force, bounds, id);
    return p > 0 ? { price: p, city: force } : null;
  }
  let best = null;
  pool.forEach((c) => {
    const p = getBuyPrice(marketData[id], c, bounds, id);
    if (p > 0 && (!best || p < best.price)) best = { price: p, city: c };
  });
  return best;
}

/**
 * Price the buy-the-@(n-1)-and-enchant-up route for one planner row item.
 *
 * @param {object} item  the row's catalogue item (id may carry @n)
 * @param {object} marketData
 * @param {object} [opts] { craftCity, sellCity, buyCities }
 *   - sellCity: the row's chosen sell city; buy legs that cannot reach it are
 *     excluded. Null/absent skips the reachability filter.
 *   - buyCities: explicit pool override; by default it mirrors the planner's
 *     material sourcing (_cpChainOpts → the table's Buy-City pick, else CITIES).
 * @returns {null|object} null when the route does not apply or any leg is
 *   unpriced; otherwise
 *   { baseId, baseCity, basePrice, matId, matCount, matCity, matPrice, cost },
 *   plus `matSourcing` (the fragment route) when the mat is transmuted up.
 */
function computeEnchantAcquisition(item, marketData, opts) {
  if (!item || !item.id || typeof getEquipmentSlot !== "function") return null;
  const n = _ceEnchantOf(item.id);
  // .0 has nothing to buy below it; .3→.4 does not exist in game.
  if (n < 1 || n > 3) return null;
  const matCount = getEnchantMatCount(item);
  if (!matCount) return null;
  const trans = (typeof ENCHANT_TRANSITIONS !== "undefined")
    ? ENCHANT_TRANSITIONS.find((t) => t.to === n) : null;
  if (!trans) return null;

  const tier = getTierFromId(item.id);
  const baseId = getEnchantedItemId(item.id, n - 1);
  const matId = getEnchantMatId(tier, trans.matType);

  // Buy-city scope: the same one the row's material sourcing uses.
  let pool = opts && opts.buyCities;
  if (!pool) {
    const all = (typeof CITIES !== "undefined") ? CITIES : [];
    pool = (typeof _cpChainOpts === "function" && opts && opts.craftCity)
      ? (_cpChainOpts(opts.craftCity).buyCities || all) : all;
  }
  if (opts && opts.sellCity && typeof isInvalidCrossRoute === "function") {
    pool = pool.filter((c) => !isInvalidCrossRoute(c, opts.sellCity));
  }

  const base = _ceCheapestBuy(baseId, marketData, pool);
  const mat = _ceMatSourcing(matId, marketData, pool);
  if (!base || !mat) return null;

  // Market silver pays the setup fee; transmute silver (a Relic reached from a
  // cheaper Soul, …) does not.
  const cost = (base.price + matCount * mat.marketPerUnit) * (1 + SETUP_FEE)
    + matCount * mat.feePerUnit;
  return {
    baseId, baseCity: base.city, basePrice: base.price,
    // matCity / matPrice are the node actually BOUGHT; when that is not the
    // rune/soul/relic itself, matSourcing carries the transmute route.
    matId, matCount, matCity: mat.buyCity, matPrice: mat.buyPrice,
    cost,
    ...(mat.source === "transmute" ? { matSourcing: mat } : {}),
  };
}

// The rune/soul/relic leg: cheapest of buying it and transmuting a cheaper node
// up (js/fragment-transmute-sourcing.js). Without that module loaded it is the
// straight market buy, in the same shape.
function _ceMatSourcing(matId, marketData, pool) {
  if (typeof getFragmentSourcing === "function") {
    return pool.length ? getFragmentSourcing(matId, marketData, pool) : null;
  }
  const m = _ceCheapestBuy(matId, marketData, pool);
  return m && { source: "market", marketPerUnit: m.price, feePerUnit: 0,
    buyId: matId, buyCity: m.city, buyPrice: m.price, buyCount: 1, steps: [] };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { computeEnchantAcquisition };
}
