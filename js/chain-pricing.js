// Resolves a leaf ingredient to its cheapest sourcing path: direct market buy
// vs recursive chain craft (mill, bakery, dairy, butcher → breeding). Used by
// the consumables table to surface the "breeding chicken → raw meat → meal"
// chain when it's cheaper than buying raw meat off the market.
//
// Public API:
//   getChainSourcing(matId, marketData, citySearch) -> {
//     perUnit: number,                 // silver per single unit of matId
//     source: "market" | "chain",      // which path won
//     city: string | null,             // for source=market: the buy city
//     chain?: ChainNode,               // for source=chain: the breakdown
//   }
//
// ChainNode:
//   {
//     produces: matId,                 // what this node makes
//     output: number,                  // batch output per craft
//     station: string,                 // mill | cook | butcher | pasture
//     inputs: [{
//       matId, count, noReturn?,
//       sourcing: { perUnit, source, city, chain? }
//     }],
//     costPerOutput: number,           // total input cost ÷ (output × yieldMult)
//     // pasture rows only (eggs, milk):
//     yieldMult?: number,              // Premium × the byproduct spec city
//     pastureCity?: string,            // where the animal stands
//     capital?: { matId, count },      // the grown animal — priced, never charged
//   }

// Find the cheapest market buy across `cities` for a given matId.
// Returns { city, price } where price is 0 if nothing is available.
function findCheapestMarketBuy(matId, marketData, cities) {
  const itemData = marketData[matId];
  const bounds = (typeof getIQRBounds === "function")
    ? getIQRBounds(itemData) : { upper: Infinity };
  // A city force is ONE global slot per (itemId, side) — js/utils.js setCityForce —
  // so it counts only when the forced city is inside the list this caller prices.
  // Without the check, a Caerleon price edit pinned the ROYAL section of the same
  // table to Caerleon as well, and both sections then rendered the very same cell.
  // Every sibling sourcing helper already carries this guard (js/utils.js
  // findBestBuyCity, js/flip-route.js flipCandidateCities, …); the invariant lives
  // in tests/section-force-guard.test.cjs.
  const forced = (typeof getCityForce === "function")
    ? getCityForce(matId, "buy") : null;
  if (forced && Array.isArray(cities) && cities.includes(forced)) {
    const p = getBuyPrice(itemData, forced, bounds, matId);
    return { city: forced, price: p > 0 ? p : 0 };
  }
  let bestPrice = Infinity, bestCity = null;
  for (const c of cities) {
    const p = getBuyPrice(itemData, c, bounds, matId);
    if (p > 0 && p < bestPrice) {
      bestPrice = p;
      bestCity = c;
    }
  }
  return { city: bestCity, price: bestCity ? bestPrice : 0 };
}

// Builds a chain breakdown for matId by recursively pricing each sub-input.
// Returns null when any required leaf has no sourcing (so the caller falls
// back to market). depth is the recursion guard — chains are shallow (≤3
// levels), but the guard prevents accidental cycles in future data edits.
//
// When `tolerateNoData` is true, missing leaf prices don't bail — they're
// recorded as 0 with a fallback city (cities[0]) so the chain stays
// inspectable and the user can override prices via the editable cells.
// forceChainSourcing uses this mode for top-level chain consumables so the
// row never collapses to "no market data".
//
// Multi-option recipes (`recipe.options` is an array of {inputs, output})
// evaluate each option independently and return the cheapest. Used by
// T1_FISHCHOPS, where any of 38 fish sources can be butchered into chops
// at different yields. The selected option's branding (inputs + output)
// shapes the returned ChainNode.
function buildChainBreakdown(matId, marketData, cities, depth, tolerateNoData) {
  if (depth > 5) return null;
  const recipe = (typeof CHAIN_RECIPES !== "undefined") ? CHAIN_RECIPES[matId] : null;
  if (!recipe) return null;

  if (Array.isArray(recipe.options)) {
    // Two-pass selection: first prefer the cheapest option whose inputs
    // ALL have market data (costPerOutput > 0). Otherwise fall back to
    // the cheapest no-data option so the row still renders an editable
    // placeholder. Without this, options with `no data` ingredients win
    // as "free" and the user sees a misleading 0-cost auto-pick.
    let bestPricedNode = null;
    let bestAnyNode = null;
    for (const opt of recipe.options) {
      const virtualRecipe = {
        inputs: opt.inputs,
        output: opt.output,
        station: recipe.station,
      };
      const node = buildSingleOptionBreakdown(matId, virtualRecipe, marketData, cities, depth, tolerateNoData);
      if (!node) continue;
      if (node.costPerOutput > 0) {
        if (!bestPricedNode || node.costPerOutput < bestPricedNode.costPerOutput) {
          bestPricedNode = node;
        }
      }
      if (!bestAnyNode || node.costPerOutput < bestAnyNode.costPerOutput) {
        bestAnyNode = node;
      }
    }
    return bestPricedNode || bestAnyNode;
  }
  return buildSingleOptionBreakdown(matId, recipe, marketData, cities, depth, tolerateNoData);
}

// Single-option chain expansion. Extracted so multi-option recipes can
// evaluate each option independently. `recipe` here is either a real
// CHAIN_RECIPES entry or a synthesized one-option subrecipe.
function buildSingleOptionBreakdown(matId, recipe, marketData, cities, depth, tolerateNoData) {
  // Butcher chain: the input is a GROWN animal (or a fish), which we
  // price directly off the market. The breeding sub-chain (baby + feed
  // → grown) is intentionally NOT expanded here — that's surfaced in
  // the dedicated mounts/breeding table.
  let totalInputCost = 0;
  const pricedInputs = [];
  for (const inp of recipe.inputs) {
    let sub;
    if (tolerateNoData) {
      // Skeleton mode: prefer chain expansion so the user sees every leaf
      // (e.g. T4_BREAD ← T3_FLOUR ← T3_WHEAT) and can override each
      // price. Fall back to market with a default city when the
      // sub-ingredient has no chain recipe.
      const subRecipe = (typeof CHAIN_RECIPES !== "undefined") ? CHAIN_RECIPES[inp.matId] : null;
      if (subRecipe) {
        const subChain = buildChainBreakdown(inp.matId, marketData, cities, depth + 1, true);
        if (subChain) {
          sub = { perUnit: subChain.costPerOutput, source: "chain", chain: subChain, city: null };
        }
      }
      if (!sub) {
        const marketSrc = findCheapestMarketBuy(inp.matId, marketData, cities);
        sub = {
          perUnit: marketSrc.price,
          source: "market",
          city: marketSrc.city || cities[0],
        };
      }
    } else {
      sub = getChainSourcing(inp.matId, marketData, cities, depth + 1);
      if (sub.perUnit <= 0) return null; // can't price this leaf — bail
    }
    totalInputCost += sub.perUnit * inp.count;
    pricedInputs.push({ ...inp, sourcing: sub });
  }
  // Pasture rows (eggs, milk) are the one station whose BATCH scales:
  // Premium's +100% and the spec city's +10% Product Yield sum once
  // (getPastureYieldMultiplier). `output` stays
  // the raw per-cycle figure so the breakdown keeps printing the real 9-in/9-out
  // cycle; only the cost is spread over the bigger batch. Every caller reads the
  // same multiplier off the node, so it can never be applied twice.
  const isPasture = recipe.station === "pasture";
  const pastureCity = isPasture && typeof getOptimalPastureCity === "function"
    ? getOptimalPastureCity(matId, cities, (cities || [])[0] || null)
    : null;
  const yieldMult = isPasture && typeof getPastureYieldMultiplier === "function"
    ? getPastureYieldMultiplier(matId, pastureCity)
    : 1;
  return {
    produces: matId,
    output: recipe.output,
    station: recipe.station,
    inputs: pricedInputs,
    costPerOutput: totalInputCost / (recipe.output * yieldMult),
    ...(isPasture ? { yieldMult, pastureCity, capital: recipe.capital || null } : {}),
  };
}

// Both ways to get one unit of matId, side by side — the buy and the build.
//
//   { market: { perUnit, city }, chain: { perUnit, chain } | null }
//
// getChainSourcing picks the cheaper of the two and discards the loser, which
// is the right answer for a cost figure and the wrong one for a table that has
// to SHOW the road not taken. The consumables craft row prices its ingredients
// off the market leg and offers the chain leg as an alternative underneath, so
// it needs both (js/render-consumable-alt-routes.js).
//
// `chain` is null whenever no chain leg exists to offer: no CHAIN_RECIPES
// entry, a forcedChainOnly recipe (see below), or a chain that cannot be
// priced end to end.
//
// The market leg is always present, even at perUnit 0 — "nothing listed" is a
// state the caller has to render, not an absence.
function getChainAlternatives(matId, marketData, cities, depth) {
  const d = depth || 0;
  const market = findCheapestMarketBuy(matId, marketData, cities);
  const marketLeg = { perUnit: market.price, city: market.city };

  const recipe = (typeof CHAIN_RECIPES !== "undefined") ? CHAIN_RECIPES[matId] : null;
  // No chain recipe → market is the only option.
  // forcedChainOnly recipes are only consumed by the chain-craft row
  // builder (force-chain path). When this item appears as an INGREDIENT
  // of another recipe (e.g., T1_FISHCHOPS inside T1_FISHSAUCE_LEVEL1),
  // the chain is NOT competed against market — market wins by default.
  // Prevents the fish-sauce row from inline-expanding the multi-option
  // fishchops chain (the user wants the aggregate row to be its own
  // analysis, not a side effect of every recipe using fish chops).
  if (!recipe || recipe.forcedChainOnly) return { market: marketLeg, chain: null };

  const chain = buildChainBreakdown(matId, marketData, cities, d);
  if (!chain) return { market: marketLeg, chain: null };
  return { market: marketLeg, chain: { perUnit: chain.costPerOutput, chain } };
}

// Public entry point. depth is internal; callers pass nothing.
function getChainSourcing(matId, marketData, cities, depth) {
  const { market, chain } = getChainAlternatives(matId, marketData, cities, depth);

  // Both available → pick cheaper. Treat market.perUnit === 0 as "not available
  // on market" so the chain wins by default when nothing is listed.
  if (!chain || (market.perUnit > 0 && market.perUnit <= chain.perUnit)) {
    return { perUnit: market.perUnit, source: "market", city: market.city };
  }
  return { perUnit: chain.perUnit, source: "chain", chain: chain.chain };
}

// Force-chain variant: always returns the chain breakdown, never the market
// price. Used by the consumables row-builder for items that ARE the chain
// product (raw meat, flour, bread, butter) — the user is producing them, not
// arbitraging them, so the chain should be visible regardless of which path
// is cheaper. Returns null when the chain itself is unbuildable (missing
// baby/feed/leaf prices) — caller should render a no-data placeholder
// rather than fall back to a flip route.
function forceChainSourcing(matId, marketData, cities) {
  const recipe = (typeof CHAIN_RECIPES !== "undefined") ? CHAIN_RECIPES[matId] : null;
  if (!recipe) return null;
  const chain = buildChainBreakdown(matId, marketData, cities, 0, /*tolerateNoData=*/true);
  if (!chain) return null;
  return { perUnit: chain.costPerOutput, source: "chain", chain };
}

// Convenience helper used by the renderer: returns the cost of `count` units
// of `matId`, plus the sourcing metadata so the table can render the
// breakdown.
function computeMatUnitCost(matId, count, marketData, cities) {
  const sourcing = getChainSourcing(matId, marketData, cities);
  return {
    sourcing,
    totalCost: sourcing.perUnit * count,
  };
}

// Returns the "full-recursive" chain cost per output unit of matId, where
// every non-focus sub-ingredient is priced at min(market, sub-chain). This
// differs from buildChainBreakdown which respects `forcedChainOnly` on sub-
// ingredients and uses their market price instead. For savings accounting
// we want the player's TRUE chain-craft cost — including all the way down
// the tree.
//
// Focus-craftable sub-ingredients (e.g. T6_MEAT) are NOT chained here —
// they have their own focus-return accounting, and chaining them would
// double-count. Treat them as market-priced.
function fullChainCostRecursive(matId, marketData, cities, depth) {
  const d = depth || 0;
  const marketPrice = findCheapestMarketBuy(matId, marketData, cities).price;
  if (d > 5) return marketPrice;
  if (typeof CHAIN_RECIPES === "undefined" || !CHAIN_RECIPES[matId]) return marketPrice;
  const focus = (typeof getFocusCost === "function")
    ? getFocusCost(matId, (typeof getTierFromId === "function") ? getTierFromId(matId) : 0)
    : 0;
  if (focus > 0) return marketPrice;

  const recipe = CHAIN_RECIPES[matId];
  // Same batch scaling buildSingleOptionBreakdown applies — without it the
  // savings walker would price a pasture cycle at the free-account yield while
  // the row it feeds prices it at the Premium one.
  const yieldMult = recipe.station === "pasture" && typeof getPastureYieldMultiplier === "function"
    ? getPastureYieldMultiplier(
        matId,
        typeof getOptimalPastureCity === "function"
          ? getOptimalPastureCity(matId, cities, (cities || [])[0] || null)
          : null
      )
    : 1;
  const computeForInputs = (inputs, output) => {
    let cost = 0;
    for (const inp of inputs) {
      const subMarket = findCheapestMarketBuy(inp.matId, marketData, cities).price;
      const subChain = fullChainCostRecursive(inp.matId, marketData, cities, d + 1);
      let subCost;
      if (subMarket > 0 && subChain > 0) subCost = Math.min(subMarket, subChain);
      else if (subMarket > 0) subCost = subMarket;
      else if (subChain > 0) subCost = subChain;
      else return 0;
      cost += subCost * inp.count;
    }
    return cost / ((output || 1) * yieldMult);
  };

  if (Array.isArray(recipe.options)) {
    let best = 0;
    for (const opt of recipe.options) {
      const c = computeForInputs(opt.inputs, opt.output);
      if (c > 0 && (best === 0 || c < best)) best = c;
    }
    return best;
  }
  return computeForInputs(recipe.inputs, recipe.output);
}

// Chain-savings walker. Returns silver/output-unit saved when the player
// fully chain-crafts `matId` (and all eligible sub-ingredients) instead of
// buying it at market. Used by render-consumables.js to surface chain
// savings on focus-craftable PARENT recipes that consume non-focus-
// craftable intermediates (e.g. enchanted Kraken Salad uses
// T1_FISHSAUCE_LEVEL3 which uses 135× T1_FISHCHOPS — the chops chain
// savings of ~81.5 silver/chop should flow into the salad's silver/focus
// column).
//
// Returns 0 when matId is focus-craftable (its own focus return is the
// proper accounting), has no chain recipe, has no market price to compare
// against (non-tradeable), or chain is already pricier than market.
function chainSavingsPerOutput(matId, marketData, cities, depth) {
  const d = depth || 0;
  if (typeof CHAIN_RECIPES === "undefined" || !CHAIN_RECIPES[matId]) return 0;
  const focus = (typeof getFocusCost === "function")
    ? getFocusCost(matId, (typeof getTierFromId === "function") ? getTierFromId(matId) : 0)
    : 0;
  if (focus > 0) return 0;

  const market = findCheapestMarketBuy(matId, marketData, cities).price;
  const fullChain = fullChainCostRecursive(matId, marketData, cities, d);
  if (!(fullChain > 0) || !(market > 0)) return 0;
  return market > fullChain ? (market - fullChain) : 0;
}
