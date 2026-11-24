/**
 * Albion Market Logic & Calculations
 * Formulas use the account-dependent sales tax (4% with Premium, 8% without)
 * plus the 2.5% market setup fee — which is charged only on the legs that
 * actually place an ORDER. See SETUP_FEE / PREMIUM_TAX below.
 */

// ─── Market fees ───────────────────────────────────────────────────────────
// Albion charges the 2.5% setup fee when an order is CREATED. Buying or
// selling instantly off the board creates no order and pays no setup fee; the
// sales tax still falls on the seller either way. So the friction on a leg
// depends on the header's Pricing Model — and the two legs are chosen
// INDEPENDENTLY there (a Buy pair and a Sell pair of radios), so each one is
// priced against its own toggle:
//
//   leg              instant          market order
//   buy              price            price × 1.025
//   sell (premium)   price × 0.96     price × 0.935
//   sell (non-prem)  price × 0.92     price × 0.895
//
// Both are exposed as LIVE global getters rather than plain consts, so the
// Pricing Model radios and the Premium Account checkbox re-price every table
// that reads `(1 + SETUP_FEE)` / `(1 - PREMIUM_TAX)` — no flag threaded
// through the ~120 call sites. `SETUP_FEE` is the BUY leg's fee and
// `PREMIUM_TAX` already carries the SELL leg's, so the split needs no edit at
// those sites; the two genuinely sell-side reads of `SETUP_FEE` (the salvage
// value below, and instantSellTax in js/render-rolling.js) call
// marketSetupFee("sell") instead. js/render-fees-calculator.js keeps its own
// independent per-side form.
//
// In Node tests neither getOrderType nor isPremiumEnabled exists, so this
// resolves to Premium + market orders, preserving the historical
// 0.025 / 0.065 baseline for every harness that does not stub them.
const SETUP_FEE_RATE = 0.025;
const SALES_TAX_PREMIUM = 0.04;
const SALES_TAX_NON_PREMIUM = 0.08;

/**
 * The setup fee on one leg: 0 when that leg is an instant fill.
 * @param {"buy"|"sell"} [side] — defaults to the buy leg.
 */
function marketSetupFee(side) {
  const leg = side === "sell" ? "sell" : "buy";
  const instant = typeof getOrderType === "function" && getOrderType(leg) === "instant";
  return instant ? 0 : SETUP_FEE_RATE;
}

/** Sales tax only, without the setup fee — 4% Premium, 8% not. */
function marketSalesTax() {
  return (typeof isPremiumEnabled === "function" && !isPremiumEnabled())
    ? SALES_TAX_NON_PREMIUM
    : SALES_TAX_PREMIUM;
}

// Buy-side fee. `PREMIUM_TAX` is the TOTAL sell-side cost (sales tax + the
// sell order's setup fee), not the tax alone — the name predates the split and
// is kept because ~60 call sites read it.
Object.defineProperty(globalThis, "SETUP_FEE", {
  configurable: true,
  enumerable: true,
  get() { return marketSetupFee("buy"); },
});
Object.defineProperty(globalThis, "PREMIUM_TAX", {
  configurable: true,
  enumerable: true,
  // Rounded: 0.08 + 0.025 is 0.10500000000000001 in binary floating point, and
  // that lands in every silver figure downstream.
  get() { return Math.round((marketSalesTax() + marketSetupFee("sell")) * 1e6) / 1e6; },
});

// Transport Ox
const OX_CAPACITY_KG = 3200; // T8 Transport Ox at 100% load

// The city bonus tables live in js/data-city-bonuses.js. In the browser they
// are already in scope (classic scripts share one top-level lexical scope), so
// the `module` guard short-circuits before the identifier is even touched.
// Under Node they have to be hoisted onto globalThis for the bare identifiers
// below to resolve — except when a test has already concatenated that file's
// source ahead of this one, which the CITY_FARM_SPEC check detects.
if (typeof module !== "undefined" && module.exports && typeof CITY_FARM_SPEC === "undefined") {
  Object.assign(globalThis, require("./data-city-bonuses.js"));
}

/**
 * Calculate the Resource Return Rate for a given production bonus
 * RRR = bonus / (1 + bonus)
 */
function calcRRR(productionBonus) {
  if (productionBonus <= 0) return 0;
  return productionBonus / (1 + productionBonus);
}

/**
 * Get the total production bonus for crafting an item in a specific city.
 * @param {string} city - City name
 * @param {string|null} craftType - Item's craft category (e.g., "sword", "plate_armor")
 * @param {boolean} useFocus - Whether focus is used
 * @returns {number} Resource return rate (0 to ~0.55)
 */
function getCraftRRR(city, craftType, useFocus = true) {
  let bonus = BASE_CITY_BONUS;
  // Add specialization bonus if this city specializes in this craft type
  const specs = CITY_CRAFT_SPEC[city];
  if (specs && craftType && specs.includes(craftType)) {
    bonus += CRAFT_SPEC_BONUS;
  }
  if (useFocus) bonus += FOCUS_BONUS;
  // Per-group Daily Production Bonus: a slot targeting THIS craftType applies;
  // a null craftType (mount rows) can never match. The old global scalar path
  // is gone — the bonus is only expressible per group.
  const dpb = (typeof globalThis.getDailyProductionBonusFor === "function") ? globalThis.getDailyProductionBonusFor(craftType) : 0;
  bonus += dpb;
  return calcRRR(bonus);
}

/**
 * Get the total production bonus for refining a resource in a specific city.
 * @param {string} city - City name
 * @param {string|null} resourceType - Resource type (e.g., "ore", "wood")
 * @param {boolean} useFocus - Whether focus is used
 * @returns {number} Resource return rate
 */
function getRefineRRR(city, resourceType, useFocus = true) {
  let bonus = BASE_CITY_BONUS;
  if (CITY_REFINE_SPEC[city] === resourceType) {
    bonus += REFINE_SPEC_BONUS;
  }
  if (useFocus) bonus += FOCUS_BONUS;
  // Refining matches by prefixed group id ("refine:wood"), never the bare
  // resource name — the prefix keeps it apart from same-named craft groups.
  const dpb = (typeof globalThis.getDailyProductionBonusFor === "function")
    ? globalThis.getDailyProductionBonusFor((globalThis.DAILY_BONUS_REFINE_PREFIX || "refine:") + resourceType)
    : 0;
  bonus += dpb;
  return calcRRR(bonus);
}

/**
 * Butcher RRR. Spec adds +10 PB when the city boosts the given meat tier
 * (per CITY_BUTCHER_SPEC). Non-meat inputs (fish chops, fish sauce synthetic
 * ids) get only the base 18 PB. Used by the consumables chain row when
 * chain.station === "butcher" — mill/cook stations have no city spec.
 * @param {string} city - City name
 * @param {string|null} meatId - Chain output id (e.g. "T7_MEAT", "T1_FISHCHOPS")
 * @param {boolean} useFocus - Whether focus is used
 * @returns {number} Resource return rate
 */
function getButcherRRR(city, meatId, useFocus = true) {
  let bonus = BASE_CITY_BONUS;
  const specs = CITY_BUTCHER_SPEC[city];
  if (specs && meatId && specs.includes(meatId)) {
    bonus += BUTCHER_SPEC_BONUS;
  }
  if (useFocus) bonus += FOCUS_BONUS;
  // One "butcher" group covers every meat: any butcher row matches a slot
  // targeting it, spec city or not.
  const dpb = (typeof globalThis.getDailyProductionBonusFor === "function") ? globalThis.getDailyProductionBonusFor("butcher") : 0;
  bonus += dpb;
  return calcRRR(bonus);
}

/**
 * Pick the optimal butcher city for a meat chain — the +10% spec city if
 * it's reachable in the current search pool, otherwise the fallback (which
 * is normally the buy city for the grown animal). Caller decouples the buy
 * city from the butcher city so the user can see "Buy: cheapest → Butcher
 * at spec city → Sell: best" instead of locking butcher to the buy city.
 * @param {string|null} meatId
 * @param {string[]} cityPool - cities the user is willing to operate in
 * @param {string} fallback - butcher city to use when no spec city is in pool
 * @returns {string}
 */
function getOptimalButcherCity(meatId, cityPool, fallback) {
  if (!meatId || !cityPool || cityPool.length === 0) return fallback;
  for (const city of cityPool) {
    const specs = CITY_BUTCHER_SPEC[city] || [];
    if (specs.includes(meatId)) return city;
  }
  return fallback;
}

/**
 * The CITY_CRAFT_SPEC category a CHAIN_RECIPES station crafts under, so a
 * chain-craft row can claim the same +15% Local Production Bonus a normal
 * craft row gets. The mill/cook intermediates (flour, bread, butter) are
 * craftingcategory="food" and ride Caerleon's "food" bonus.
 *
 * ALCOHOL gets nothing, from any city, and it is the one case where none of
 * the obvious signals agree:
 *   • Destiny Board: FARM_ALCHEMIST_ALCOHOL ("Bootlegger", ring 9), a spec node
 *     on the POTION branch under FARM_ALCHEMIST — confirmed in-game.
 *   • buildings.xml: @BUILDING_ITEMS_CATEGORY_POTIONS.
 *   • items.xml: craftingcategory="food".
 * Brecilien's "potion" +15% does NOT reach it — verified in-game 2026-08-26,
 * brewing Potato Schnapps in Brecilien reads the base 15.2% RRR (18 PB), not
 * 24.8%. And a potion-branch item has no claim on Caerleon's "food" bonus
 * either, so the honest mapping is null until a Caerleon reading says
 * otherwise. Claiming a bonus we have not seen overstates every schnapps row.
 *
 * The board node is a FOCUS node only: it makes schnapps far cheaper per unit
 * than flour (which has no spec node at all), and getFocusCost already reads it
 * from the item's own nodes. Focus cost and production bonus are unrelated here.
 *
 * Butcher is deliberately null too — meat/fish chops carry their own per-city
 * spec through CITY_BUTCHER_SPEC / getButcherRRR, not CITY_CRAFT_SPEC.
 *
 * @param {string|null} station - CHAIN_RECIPES[...].station
 * @returns {"food"|null}
 */
function getChainCraftType(station) {
  if (station === "mill" || station === "cook") return "food";
  return null;
}

/**
 * The city in `cityPool` that pays the +15% production bonus for `craftType`,
 * else `fallback`. Direct analogue of getOptimalButcherCity: you buy the input
 * wherever it is cheapest, but you physically craft in the bonus city. Without
 * this the bonus would only ever fire when the cheapest input happened to be
 * listed in Caerleon/Brecilien.
 *
 * @param {string|null} craftType - CITY_CRAFT_SPEC category, e.g. "food"
 * @param {string[]} cityPool - reachable cities, in search order
 * @param {string} fallback - city to craft in when none of the pool specializes
 * @returns {string}
 */
function getOptimalCraftCity(craftType, cityPool, fallback) {
  if (!craftType || !cityPool || cityPool.length === 0) return fallback;
  for (const city of cityPool) {
    const specs = CITY_CRAFT_SPEC[city] || [];
    if (specs.includes(craftType)) return city;
  }
  return fallback;
}

/**
 * Farming yield bonus (+0.10 when the city boosts the given output, else 0).
 * Crops are matched against `.crops`, herbs against `.herbs`, byproducts
 * against `.byproducts` — but in practice the output id alone is unique
 * (e.g. "T1_CARROT" only appears in crops), so a single CITY_FARM_SPEC
 * lookup that unions the three lists is enough.
 *
 * The bonus is a PRODUCT yield bonus in every case — 10% more crops, herbs or
 * byproducts out of the same slot. It does not raise the seed return; the
 * in-game seed tooltip credits Watering alone for that.
 *
 * @param {string} city
 * @param {string|null} outputId - market id of the harvested/produced item
 * @returns {0 | 0.10}
 */
function getFarmingYieldBonus(city, outputId) {
  const spec = CITY_FARM_SPEC[city];
  if (!spec || !outputId) return 0;
  const all = [].concat(spec.crops || [], spec.herbs || [], spec.byproducts || []);
  return all.includes(outputId) ? FARMING_SPEC_BONUS : 0;
}

/**
 * Per-cycle and per-day economics for a farming production row.
 *
 * Crops/herbs: each of `plotsPerCycle` seed slots yields `producePerCycle`
 * outputs at harvest (the BASE 3-6 average — the caller passes it undoubled),
 * scaled by the PRODUCT yield sum `(1 + premiumBonus + yieldBonus)`. The two
 * bonuses are the same stat on the in-game tooltip ("Premium: +100% Product
 * Yield", "Local: +10% Product Yield") and SUM ONCE — premium in a bonus city
 * is x2.1, not the chained x2-x1.1 2.2. The slot separately returns seeds at
 * rate (baseSeedYield + wateringBonus) — the city and premium never touch that
 * number; the in-game seed tooltip lists Watering alone. The
 * seed leg is TWO-SIDED, and 100% is the hinge, not the ceiling:
 *   under 100% you buy the shortfall  → cost, and it pays the buy-side setup fee
 *   over  100% you sell the surplus   → revenue (a NEGATIVE net seed cost),
 *                                       taxed and hauled, never setup-fee'd
 * In game, yield above 100% is a chance at a second seed (Albion Wiki, "Island
 * Farms"), and seeds are ordinary market items. Clamping the surplus to zero
 * priced watering at nothing for every crop/herb already self-sustaining while
 * dry — and for a high-tier herb the seed leg is worth far more than the crop.
 * `seedSellPrice` 0 (no seed market) collapses the surplus back to zero.
 *
 * Byproducts (eggs, milk): a GROWN animal on one pasture slot eats `feedCount`
 * crops and produces `producePerCycle` × (1 + premiumBonus + yieldBonus)
 * eggs/milk per cycle — the same additive product-yield sum. The animal
 * SURVIVES — it is reusable capital, priced by the caller as a separate leg —
 * so the only per-cycle input is the feed, and `seedPrice` is one feed crop.
 * Net per-output cost = feedCount × seedPrice ÷ outputs.
 *
 * `useWater=false` drops the watering bonus from the DISPLAYED cycle. It does not
 * touch `wateringProfitDelta` / `profitPerFocus`: those are the focus-ON benchmark
 * of what watering buys, and every table's Silver/Focus column is invariant to the
 * "Use Focus" checkbox.
 *
 * @returns {{
 *   totalSeedYield, netSeedCostPerOutput,
 *   profitPerOutput, profitPerCycle, profitPerDay,
 *   wateringProfitDelta, profitPerFocus, outputsPerCycle,
 *   surplusSeedsPerCycle, seedRevenuePerCycle,
 * }}
 */
function calcFarmingEconomics({
  type,
  seedPrice,
  outputSellPrice,
  baseSeedYield = 0,
  wateringBonus = 0,
  yieldBonus = 0,
  premiumBonus = 0,
  plotsPerCycle = 9,
  feedCount = 0,
  producePerCycle = 1,
  cycleHours,
  focusPerCycle = 0,
  useWater = true,
  travelCostPerOutput = 0,
  seedSellPrice = 0,
  seedTravelCostPerSeed = 0,
  wormsPerCycle = 0,
  wormSellPrice = 0,
  wormTravelCostPerWorm = 0,
}) {
  const revenuePerOutput = outputSellPrice * (1 - PREMIUM_TAX);
  // What one surplus seed actually banks: market tax off the top, then the
  // Travel Planner fee for hauling it out of Brecilien. Zero when the seed has
  // no sell listing — a missing market must never invent silver.
  const seedNetPerSeed = seedSellPrice > 0
    ? seedSellPrice * (1 - PREMIUM_TAX) - seedTravelCostPerSeed
    : 0;
  // The Earthworm leg, priced exactly like the surplus seed: a sale, so sales
  // tax and the haul out of Brecilien come off and no setup fee goes on. Worms
  // fall out of the HARVEST, so watering and the bonus city never touch them,
  // and a pasture row is handed 0 of them.
  const wormsPerPlot = type === "byproduct" ? 0 : Math.max(0, wormsPerCycle);
  const wormRevenuePerPlot = wormsPerPlot > 0 && wormSellPrice > 0
    ? wormsPerPlot * (wormSellPrice * (1 - PREMIUM_TAX) - wormTravelCostPerWorm)
    : 0;
  // One cycle at a given total yield. Everything focus can touch runs through
  // this one number, so the watered and unwatered cycles share the arithmetic.
  const cycleAtYield = (yieldTotal) => {
    // Pasture animals run on a different ledger: the feed is bought outright
    // every cycle (no return leg — an animal never hands crops back), and the
    // yield bonus adds produce rather than seeds. The animal itself is NOT
    // charged here; it survives the harvest and is reported as capital.
    if (type === "byproduct") {
      const outputs = plotsPerCycle * producePerCycle * yieldTotal;
      const feedCost = feedCount * seedPrice * plotsPerCycle;
      const feedPerOutput = outputs > 0 ? feedCost / outputs : 0;
      const perOutput = revenuePerOutput - feedPerOutput * (1 + SETUP_FEE) - travelCostPerOutput;
      return {
        netSeed: feedPerOutput, perOutput, outputs, perCycle: perOutput * outputs,
        surplusSeeds: 0, seedRevenue: 0,
        // The same feed as a COUNT: an animal eats every cycle and hands
        // nothing back, so what one egg costs is what one egg buys.
        seedsPerOutput: outputs > 0 ? (feedCount * plotsPerCycle) / outputs : 0,
      };
    }
    // Seeds you must buy (yield < 1) and seeds you get to sell (yield > 1) are
    // kept apart because only the buy side pays the setup fee. They meet at
    // exactly 1.0, so a break-even farm books neither a cost nor the buy/sell
    // spread as a phantom loss.
    const seedCost = Math.max(0, 1 - yieldTotal) * seedPrice;
    const surplusSeeds = Math.max(0, yieldTotal - 1);
    const seedRevenue = surplusSeeds * seedNetPerSeed;
    const netSeed = seedCost - seedRevenue;
    // One planted slot hands back `producePerCycle` crops (the BASE 3-6
    // average — the caller passes it undoubled), while the seed leg above is
    // ONE roll per slot however many crops that slot yields. So the ledger is
    // per PLOT, and the per-crop figures divide it back down.
    // travelCostPerOutput: Travel Planner fee per harvested unit when the crop
    // leaves Brecilien (free if grown+sold in Brecilien or grown elsewhere).
    // Premium (+100%) and the city's Local bonus (+10%) are the same stat —
    // "Product Yield" on the in-game tooltip — so they SUM ONCE here rather
    // than chain: x2.1 in a bonus city with Premium, and the seed yield is
    // untouched by either (Firetouched Mullein on a Thetford island: 91.11%
    // dry, the bare baseSeedYield).
    const cropsPerPlot = producePerCycle * (1 + premiumBonus + yieldBonus);
    const perPlot = cropsPerPlot * (revenuePerOutput - travelCostPerOutput)
      - seedCost * (1 + SETUP_FEE) + seedRevenue + wormRevenuePerPlot;
    const outputs = plotsPerCycle * cropsPerPlot;
    return {
      netSeed: cropsPerPlot > 0 ? netSeed / cropsPerPlot : netSeed,
      perOutput: cropsPerPlot > 0 ? perPlot / cropsPerPlot : 0,
      outputs,
      perCycle: perPlot * plotsPerCycle,
      surplusSeeds: surplusSeeds * plotsPerCycle,
      seedRevenue: seedRevenue * plotsPerCycle,
      // The seed leg as a COUNT rather than silver, on the same per-crop
      // footing as `netSeed` — it mirrors `seedCost` term for term. A plot at
      // or above 100% yield re-seeds itself and buys 0: the surplus it sells
      // is revenue, not a negative purchase, so this never goes below zero.
      seedsPerOutput: cropsPerPlot > 0
        ? Math.max(0, 1 - yieldTotal) / cropsPerPlot
        : Math.max(0, 1 - yieldTotal),
    };
  };

  const effectiveWatering = useWater ? wateringBonus : 0;
  // The product-yield sum, folded into the number cycleAtYield multiplies by.
  // Byproducts: premium + the city bonus on the produce batch. Crops/herbs:
  // the SEED return (base + watering) rides the same variable, but the crop
  // leg below applies premiumBonus and yieldBonus separately from it.
  const totalSeedYield = type === "byproduct"
    ? 1 + premiumBonus + yieldBonus
    : baseSeedYield + effectiveWatering;
  const cycle = cycleAtYield(totalSeedYield);
  const netSeedCostPerOutput = cycle.netSeed;
  const profitPerOutput = cycle.perOutput;
  const outputsPerCycle = cycle.outputs;
  const profitPerCycle = cycle.perCycle;

  const cyclesPerDay = cycleHours > 0 ? 24 / cycleHours : 0;
  const profitPerDay = profitPerCycle * cyclesPerDay;

  // What the WATERING focus itself buys, per cycle: the profit of a watered cycle
  // over the same cycle left dry. Always the focus-ON figure, like every other
  // table's Silver/Focus benchmark, so it does not move with the "Use Focus"
  // checkbox. The old column was profitPerCycle ÷ focus — an average that
  // credited focus with the crop's whole profit, most of which a dry plot earns
  // anyway. Byproducts get no watering bonus (their focus play is nurturing for
  // an offspring, priced by the caller), so their delta is 0 here.
  //
  // Above 100% yield the delta is entirely the SEEDS watering adds, not saved
  // seed purchases: both cycles buy nothing, and the watered one simply sells
  // more surplus. That is why the surplus has to be priced at all — with it
  // clamped to zero, a self-sustaining plot reported watering as worthless.
  const wateredYield = type === "byproduct"
    ? 1 + premiumBonus + yieldBonus
    : baseSeedYield + wateringBonus;
  const dryYield = type === "byproduct"
    ? 1 + premiumBonus + yieldBonus
    : baseSeedYield;
  const wateredCycle = cycleAtYield(wateredYield);
  const dryCycle = cycleAtYield(dryYield);
  const wateringProfitDelta = wateredCycle.perCycle - dryCycle.perCycle;
  const profitPerFocus = focusPerCycle > 0 ? wateringProfitDelta / focusPerCycle : 0;

  return {
    totalSeedYield,
    netSeedCostPerOutput,
    profitPerOutput,
    profitPerCycle,
    profitPerDay,
    wateringProfitDelta,
    profitPerFocus,
    // The WATERED cycle's own profit — the focus-ON operand behind Profit / 10k
    // Focus. Deliberately independent of `useWater`: a full focus bar is focus-ON
    // play by definition, so that column must not move with the Use Focus
    // checkbox (profitPerCycle above does, and is the right figure for its own
    // column). Byproducts get no watering bonus, so the two coincide there.
    profitPerCycleFocusOn: wateredCycle.perCycle,
    // The same watered-vs-dry comparison PER HARVESTED OUTPUT, which is the
    // unit this row's profit, cost and price are all quoted in. Not
    // wateringProfitDelta ÷ outputsPerCycle: watering changes the seed yield,
    // so the two cycles do not even harvest the same number of crops, and a
    // caller counting crops (My Crafting List, which prices the crops a finite
    // focus budget cannot water — js/craft-list-focus-budget.js) needs the two
    // per-crop figures differenced, not one cycle's figure spread over the
    // other cycle's outputs.
    profitPerOutputFocusOn: wateredCycle.perOutput,
    wateringProfitDeltaPerOutput: wateredCycle.perOutput - dryCycle.perOutput,
    outputsPerCycle,
    // What one harvested output actually costs in SEEDS (feed, for a pasture
    // row) — the count behind netSeedCostPerOutput, net of the seed return
    // exactly as that figure is. My Crafting List counts crops, so its
    // shopping board needs the seed leg as a count and not only as silver.
    seedsBoughtPerOutput: cycle.seedsPerOutput,
    // The same seed leg on the WATERED cycle, and the watered yield behind it.
    // Both are focus-ON benchmarks like profitPerCycleFocusOn above: the
    // "Seeds to Plant (10k Focus)" column spends a whole bar watering by
    // definition, so it must not move with the Use Focus checkbox. In Albion a
    // watered crop or herb plot is always at or above 100% seed return, which is
    // why that column reports "self-seeding" instead of a bare 0.
    wateredSeedYield: wateredYield,
    // The unwatered twin, for the seed line that follows the Use Focus checkbox.
    drySeedYield: dryYield,
    seedsBoughtPerOutputFocusOn: wateredCycle.seedsPerOutput,
    // The DRY cycle's seed leg — the count a plot the focus budget could not
    // water has to buy. Watering is a term in the seed-yield sum above, so this
    // is strictly the larger of the two: a watered crop or herb plot is at or
    // above 100% return and buys nothing, while `baseSeedYield + yieldBonus`
    // alone is below 100% for every crop and herb. My Crafting List prices its
    // unfunded tail from here (js/craft-list-extractors.js) — without it a
    // partly-focused basket showed an empty shopping board.
    seedsBoughtPerOutputNoFocus: dryCycle.seedsPerOutput,
    // The worm leg is flat across every cycle variant above — it moves with
    // neither watering nor the bonus city — so it is reported once, per cycle.
    wormsPerCycle: wormsPerPlot * plotsPerCycle,
    wormRevenuePerCycle: wormRevenuePerPlot * plotsPerCycle,
    // The seed leg's own two numbers, on the DISPLAYED cycle (so they follow
    // `useWater` exactly like profitPerCycle does) — the Yield cell quotes them.
    surplusSeedsPerCycle: cycle.surplusSeeds,
    seedRevenuePerCycle: cycle.seedRevenue,
  };
}

// Item weight formula: 0.1 * 1.5^tier (kg per single resource unit)
function getResourceWeightKg(tier) {
  return Math.round(0.1 * Math.pow(1.5, tier) * 100) / 100;
}

/**
 * Per-unit economics for gathering one raw resource (Mining / Quarrying /
 * Lumberjacking / Skinning / Harvesting). Gathering has NO material input cost
 * (you harvest for free), so only the sell-side market tax applies — there is
 * no buy-side setup fee. Two normalizations a gatherer cares about:
 *   - silverPerKg  = blended net per unit ÷ weight (weight = 0.1×1.5^tier). The
 *     haul-efficiency metric (mounts/bags are weight-limited) — enchanted units
 *     weigh the same as flat, so the enchant haul-value lifts silver/kg too.
 *   - silverPerHour = blended net per unit × unitsPerHour. The caller supplies
 *     the (estimated) gather rate; see GATHER_UNITS_PER_HOUR in data-gathering.js.
 *
 * silverPerHour additionally folds in the enchanted resources you gather from
 * T4+ nodes: a unit is flat with probability (1 − Σ enchantDist), else an
 * enchant-level-k variant worth enchantPrices[k]. net/unit and silver/kg stay
 * FLAT facts about the listed resource. Empty enchant maps (stone, or a thin
 * enchant market) collapse the blend back to flat — so Quarrying never lifts.
 *
 * @param {object}  p
 * @param {number}  p.sellPrice     - best market sell price for one unit (gross)
 * @param {number}  p.tier          - resource tier (2–8), drives weight
 * @param {number}  p.unitsPerHour  - estimated raw units gathered per hour
 * @param {object} [p.enchantPrices]- {1..4} → flat-equiv best sell of each enchant
 * @param {object} [p.enchantDist]  - {1..4} → P(a gathered unit is that enchant)
 * @param {number} [p.weightKg]     - explicit per-unit weight override (fish carry
 *   their real, lighter in-game weight); falls back to the 0.1×1.5^tier formula
 *   when null/0/omitted.
 * @returns {{ netPerUnit, weightKg, silverPerKg, blendedNetPerUnit, enchantUpliftPct, silverPerHour }}
 */
function calcGatheringEconomics({ sellPrice = 0, tier, unitsPerHour = 0, enchantPrices = {}, enchantDist = {}, weightKg = null }) {
  const gross = sellPrice > 0 ? sellPrice : 0;
  const netPerUnit = gross * (1 - PREMIUM_TAX);
  const resolvedWeightKg = weightKg > 0 ? weightKg : getResourceWeightKg(tier);

  // Blended expected gross per gathered unit, written as flat + Σ P(level)·(price−flat).
  // A missing enchant price falls back to the flat price (we never invent value we
  // can't quote from the market), and that level then contributes EXACTLY zero —
  // so stone & fish (no enchanted version) collapse to the flat price with no
  // floating-point residue at any zone rate, instead of relying on (1−ΣP)+ΣP
  // cancelling. Clamped ≥ 0 to guard a mis-tuned distribution.
  let enchExtra = 0;
  for (let k = 1; k <= 4; k++) {
    const pk = enchantDist[k] > 0 ? enchantDist[k] : 0;
    if (pk <= 0) continue;
    const priceK = enchantPrices[k] > 0 ? enchantPrices[k] : gross;
    enchExtra += pk * (priceK - gross);
  }
  const blendedGross = Math.max(0, gross + enchExtra);
  const blendedNetPerUnit = blendedGross * (1 - PREMIUM_TAX);
  const enchantUpliftPct = netPerUnit > 0 ? (blendedNetPerUnit / netPerUnit - 1) * 100 : 0;

  // silver/kg and silver/hour both use the blended value (enchanted units weigh
  // the same as flat, so the haul-value lifts both). netPerUnit stays the flat
  // fact about the listed resource.
  const silverPerKg = resolvedWeightKg > 0 ? blendedNetPerUnit / resolvedWeightKg : 0;
  const silverPerHour = unitsPerHour > 0 ? blendedNetPerUnit * unitsPerHour : 0;

  return { netPerUnit, weightKg: resolvedWeightKg, silverPerKg, blendedNetPerUnit, enchantUpliftPct, silverPerHour };
}

/**
 * Per-catch economics for a merged Fishing tier row. Fishing's bonus is the biome
 * RARE fish (fishing's analogue of enchanted drops): a SHARE of your catches are
 * rares (heavier, far pricier), the rest commons. This folds that bonus into the
 * all-in Silver/kg & Silver/Hour exactly like calcGatheringEconomics folds in
 * enchanted resources — so a Fishing row is directly comparable to a Mining/
 * Skinning row, with no separate "+x% bonus" badge.
 *
 *   net(x)            = x × (1 − PREMIUM_TAX)          (gather → sell-side tax only)
 *   blended net/catch = net(common)·(1−share) + net(rare)·share
 *   blended kg/catch  = commonWeight·(1−share) + rareWeight·share
 *   Silver/Hour       = blended net/catch × unitsPerHour   (ALL-IN)
 *   Silver/kg         = blended net/catch ÷ blended kg/catch
 *
 * netPerUnit & weightKg stay the COMMON catch (the staple shown in those columns),
 * mirroring how land rows display the flat resource. With no rare price to quote,
 * share collapses to 0 (never invent value) → the row is pure common.
 *
 * @param {object}  p
 * @param {number}  p.commonGross     - best common-fish sell price (gross)
 * @param {number}  p.commonWeightKg  - common fish weight
 * @param {number} [p.rareGross]      - best rare-fish sell price (gross); 0 ⇒ no rare
 * @param {number} [p.rareWeightKg]   - rare fish weight
 * @param {number} [p.rareShare]      - fraction of catches that are rares (0..1)
 * @param {number}  p.unitsPerHour    - estimated total fish caught per hour
 * @returns {{ netPerUnit, weightKg, blendedNetPerUnit, silverPerKg, silverPerHour, unitsPerHour, rareShareUsed }}
 */
function calcFishingEconomics({ commonGross = 0, commonWeightKg = 0, rareGross = 0, rareWeightKg = 0, rareShare = 0, unitsPerHour = 0 }) {
  const net = (g) => (g > 0 ? g * (1 - PREMIUM_TAX) : 0);
  const commonNet = net(commonGross);
  // No rare price ⇒ we can't quote those catches, so treat them as common (the
  // blend collapses to pure common). Otherwise a `share` fraction are rares.
  const share = rareGross > 0 && rareShare > 0 ? Math.min(rareShare, 1) : 0;
  const rareNet = net(rareGross);
  const blendedNetPerUnit = commonNet * (1 - share) + rareNet * share;
  const blendedWeightKg = commonWeightKg * (1 - share) + rareWeightKg * share;
  const silverPerHour = unitsPerHour > 0 ? blendedNetPerUnit * unitsPerHour : 0;
  const silverPerKg = blendedWeightKg > 0 ? blendedNetPerUnit / blendedWeightKg : 0;
  return {
    netPerUnit: commonNet,        // staple common catch (shown in Net/Unit)
    weightKg: commonWeightKg,     // staple common catch (shown in Weight)
    blendedNetPerUnit,
    silverPerKg,                  // all-in haul efficiency (rares are heavier)
    silverPerHour,                // all-in: commons + rare bonus folded in
    unitsPerHour,
    rareShareUsed: share,
  };
}

/**
 * Per-kill economics for a merged Tracking tier row. Tracking is HUNTING, not
 * harvesting: each kill drops a few Rare Animal Remains (the staple, like fishing's
 * common catch) plus a low chance of a high-value Shapeshifter Artifact (the bonus,
 * like the rare fish); rare-quarry hunts add Black Market loot (a tunable expected-
 * silver estimate — no clean per-unit price). All folded into the all-in Silver/kg &
 * Silver/Hour so a Tracking row is directly comparable to a Fishing / Mining row.
 *
 *   net(x)        = x × (1 − PREMIUM_TAX)               (loot → sell-side tax only)
 *   killValue     = net(remains)·remainsPerKill + net(artifact)·artifactShare + net(bmPerKill)
 *   killWeight    = remainsWeight·remainsPerKill + artifactWeight·artifactShare   (BM loot weightless)
 *   unitsPerHour  = killsPerHour · remainsPerKill        (remains/hour — matches Net/Unit)
 *   Silver/Hour   = killValue · killsPerHour             (ALL-IN)
 *   Silver/kg     = killValue ÷ killWeight
 *   blendedNetPerUnit = killValue ÷ remainsPerKill       (so Silver/Hour = blended × unitsPerHour,
 *                                                         keeping the renderer's cue math consistent)
 *
 * netPerUnit & weightKg stay the staple Remains (shown in those columns), mirroring
 * fishing/land. No artifact PRICE collapses the bonus to 0 (never invent value); no
 * remains price drives the row toward zero. BM loot value lifts Silver/Hour & Silver/
 * kg but carries no weight in the /kg denominator (it has no quotable per-kg weight).
 *
 * @param {object}  p
 * @param {number}  p.remainsGross     - best Rare Animal Remains sell price (gross)
 * @param {number}  p.remainsWeightKg  - one remains' weight (0.05 kg)
 * @param {number}  p.remainsPerKill   - expected remains dropped per kill
 * @param {number} [p.artifactGross]   - best Shapeshifter artifact sell price; 0 ⇒ no bonus
 * @param {number} [p.artifactWeightKg]- artifact weight (2 kg)
 * @param {number} [p.artifactShare]   - fraction of kills that drop an artifact (0..1)
 * @param {number} [p.bmLootPerKill]   - expected GROSS Black Market loot silver per kill
 *   (already blended by the rare-quarry share); 0 ⇒ none
 * @param {number}  p.killsPerHour     - estimated kills per hour
 * @returns {{ netPerUnit, weightKg, blendedNetPerUnit, silverPerKg, silverPerHour, unitsPerHour, artifactShareUsed, bmLootPerKillUsed }}
 */
function calcTrackingEconomics({
  remainsGross = 0, remainsWeightKg = 0, remainsPerKill = 0,
  artifactGross = 0, artifactWeightKg = 0, artifactShare = 0,
  bmLootPerKill = 0, killsPerHour = 0,
}) {
  const net = (g) => (g > 0 ? g * (1 - PREMIUM_TAX) : 0);
  const perKill = remainsPerKill > 0 ? remainsPerKill : 0;
  const remainsNet = net(remainsGross);
  // Artifact bonus only when we can actually quote it (never invent value).
  const artShare = artifactGross > 0 && artifactShare > 0 ? Math.min(artifactShare, 1) : 0;
  const artifactNet = net(artifactGross);
  const bmNet = net(bmLootPerKill);

  const killValue = remainsNet * perKill + artifactNet * artShare + bmNet;
  const killWeight = remainsWeightKg * perKill + artifactWeightKg * artShare; // BM loot weightless

  const unitsPerHour = killsPerHour > 0 ? killsPerHour * perKill : 0;
  const blendedNetPerUnit = perKill > 0 ? killValue / perKill : 0;
  const silverPerHour = killsPerHour > 0 ? killValue * killsPerHour : 0;
  const silverPerKg = killWeight > 0 ? killValue / killWeight : 0;

  return {
    netPerUnit: remainsNet,        // staple remains (shown in Net/Unit)
    weightKg: remainsWeightKg,     // staple remains (shown in Weight)
    blendedNetPerUnit,             // all-in value per remains unit (artifact + BM folded in)
    silverPerKg,                   // all-in haul efficiency (heavier artifact folded in)
    silverPerHour,                 // all-in: remains + artifact + rare-quarry BM loot
    unitsPerHour,                  // remains/hour = kills/hour × remains/kill
    artifactShareUsed: artShare,
    bmLootPerKillUsed: bmNet > 0 ? bmLootPerKill : 0,
  };
}

/**
 * Per-journal economics for the "best journal to fill while gathering" feature.
 *
 * While gathering you earn base fame, which passively fills any journal you
 * carry. The play is: BUY an empty journal → fill it with fame you'd earn
 * anyway → SELL the full one. So the gatherer's profit is the full journal's
 * net sale minus the empty journal's buy cost, and the constraint is FAME (each
 * tier needs a fixed `maxfame` to fill), not silver. Ranking is therefore
 * silver-per-fame; multiplying by the fame you actually make per hour while
 * gathering gives the extra silver/hour this journal adds on top of the raw
 * resources. Sell-side tax only (the full journal is sold; the empty is bought,
 * so no premium tax on it) — mirrors calcGatheringEconomics.
 *
 *   fullNet            = fullGross × (1 − PREMIUM_TAX)
 *   marginPerJournal   = fullNet − emptyCost          (loss passes through < 0)
 *   silverPerFame      = marginPerJournal ÷ maxfame   (0 when maxfame ≤ 0)
 *   extraSilverPerHour = silverPerFame × baseFamePerHour
 *
 * @param {object}  p
 * @param {number} [p.emptyCost]       - empty-journal buy cost (gross; a purchase, untaxed)
 * @param {number} [p.fullGross]       - full-journal sell price (gross)
 * @param {number} [p.maxfame]         - base fame needed to fill the journal
 * @param {number} [p.baseFamePerHour] - estimated base gathering fame earned per hour
 * @returns {{ fullNet, marginPerJournal, silverPerFame, extraSilverPerHour }}
 */
function calcJournalEconomics({ emptyCost = 0, fullGross = 0, maxfame = 0, baseFamePerHour = 0 }) {
  const fullNet = fullGross > 0 ? fullGross * (1 - PREMIUM_TAX) : 0;
  const marginPerJournal = fullNet - emptyCost;
  const silverPerFame = maxfame > 0 ? marginPerJournal / maxfame : 0;
  const extraSilverPerHour = silverPerFame * (baseFamePerHour > 0 ? baseFamePerHour : 0);
  return { fullNet, marginPerJournal, silverPerFame, extraSilverPerHour };
}

// Standard gear weight by tier (approximate)
function getGearWeightKg(tier) {
  return Math.round(0.5 * Math.pow(1.8, tier) * 100) / 100;
}

// Node test harness export. Browser load uses globals; this branch is inert
// at runtime in the browser (module is undefined).
if (typeof module !== "undefined" && module.exports) {
  const core = {
    // Live getters, not snapshots: a harness that concatenates this file and
    // stubs getOrderType / isPremiumEnabled must see the toggled rate.
    get PREMIUM_TAX() { return PREMIUM_TAX; },
    get SETUP_FEE() { return SETUP_FEE; },
    marketSetupFee, marketSalesTax, SETUP_FEE_RATE,
    SALES_TAX_PREMIUM, SALES_TAX_NON_PREMIUM,
    OX_CAPACITY_KG,
    BASE_CITY_BONUS, CRAFT_SPEC_BONUS, REFINE_SPEC_BONUS, BUTCHER_SPEC_BONUS, FARMING_SPEC_BONUS, PREMIUM_PRODUCT_BONUS, FOCUS_BONUS,
    CITY_CRAFT_SPEC, CITY_REFINE_SPEC, CITY_BUTCHER_SPEC, CITY_FARM_SPEC,
    getConsumableCraftType, calcRRR,
    getCraftRRR, getRefineRRR, getButcherRRR, getOptimalButcherCity,
    getChainCraftType, getOptimalCraftCity,
    getFarmingYieldBonus, calcFarmingEconomics,
    getResourceWeightKg, calcGatheringEconomics, calcFishingEconomics, calcTrackingEconomics, calcJournalEconomics, getGearWeightKg,
  };
  // The margin / focus-bar / format helpers live in js/calculations-margins.js.
  // A sandbox that concatenated that file already has them in scope; a plain
  // require() loads the sibling, whose free identifiers resolve through
  // globalThis (module-local names are published there first).
  let margins;
  if (typeof calculateFlipMargin === "function") {
    // Concatenated: margins evaluated before this file already filled module.exports;
    // after it, calculations-margins.js appends its names itself.
    margins = module.exports;
  } else {
    Object.assign(globalThis, { getCraftRRR, marketSetupFee, OX_CAPACITY_KG });
    margins = require("./calculations-margins.js");
  }
  module.exports = Object.assign(core, margins);
}
