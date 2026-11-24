// Farm-city choice for one Farming row.
//
// A farming cycle is three separate decisions, and the table models them as
// three separate cities:
//
//   1. Buy   — seeds (or pasture feed) are freight. They are bought wherever
//              they are cheapest in the active pool and carried to the plot.
//   2. Farm  — where the plot sits. It decides whether the city's +10% local
//              production bonus lands on the HARVEST (it is a product yield
//              bonus, never a seed one), and it is the origin the harvest is
//              hauled from.
//   3. Sell  — the best listing for the crop, the surplus seed and the worms,
//              each found on its own.
//
// The seed leg used to be pinned to the farm city (a one-element city list), so
// a row could never quote a cheaper listing next door, and the +10% bonus was
// thrown away whenever any other city undercut the bonus city by a single
// silver. With sourcing decoupled the bonus is free to win on its own merit.
//
// This module evaluates every candidate farm city end to end and keeps the one
// with the best cycle. Dependencies are injected so Node tests can drive it off
// a fixture instead of a live market.

const FARMING_TIE_EPSILON = 1e-6;

function emptyFarmingEcon() {
  return {
    profitPerCycle: 0, profitPerDay: 0, profitPerFocus: 0, wateringProfitDelta: 0,
    totalSeedYield: 0, netSeedCostPerOutput: 0, profitPerOutput: 0,
    profitPerCycleFocusOn: 0, profitPerOutputFocusOn: 0,
    wateringProfitDeltaPerOutput: 0, outputsPerCycle: 0, seedsBoughtPerOutput: 0,
    seedsBoughtPerOutputFocusOn: 0, seedsBoughtPerOutputNoFocus: 0,
    surplusSeedsPerCycle: 0, seedRevenuePerCycle: 0,
    wormsPerCycle: 0, wormRevenuePerCycle: 0,
  };
}

function emptyFarmingLeg() {
  return { city: null, price: 0, travelCost: 0 };
}

function emptyFarmingRow() {
  return {
    farmCity: null,
    seedBuy: emptyFarmingLeg(),
    cropSell: emptyFarmingLeg(),
    seedSell: emptyFarmingLeg(),
    wormSell: emptyFarmingLeg(),
    animalBuy: emptyFarmingLeg(),
    cityYieldBonus: 0,
    econ: emptyFarmingEcon(),
    altFarm: null,
    seedPriced: false,
  };
}

// A planted slot yields 3-6 of its crop, so this is the average when the
// catalog row somehow carries no figure of its own.
const FARM_CROP_PRODUCE_PER_PLOT = 4.5;

// Output one slot hands over in one cycle: the BASE 3-6 average (7-11 for a
// pasture animal's `produceBase`). Premium is NOT folded in here — it is
// +100% Product Yield, the same stat as the city's +10%, so both are summed
// inside calcFarmingEconomics (`premiumBonus`) rather than chained. For a
// row with no figure at all, a slot still averages 4.5.
function farmingProducePerCycle(item) {
  if (!item) return 1;
  if (item.type === "byproduct") return item.produceBase || 0;
  return item.producePerPlot > 0 ? item.producePerPlot : FARM_CROP_PRODUCE_PER_PLOT;
}

// Earthworms one slot hands over: a 10% roll for 1 worm, 2 of them with Premium
// (Albion Wiki, "Farming"), so the average doubles the same way the crop does.
// A pasture animal's produce list is eggs/milk only — no worm leg there.
function farmingWormsPerCycle(item, premium) {
  if (!item || item.type === "byproduct") return 0;
  return (item.wormsPerPlot || 0) * (premium ? 2 : 1);
}

/**
 * Score one farming row with the plot at `farmCity`.
 *
 * The seed/feed is sourced across the WHOLE `buyCities` pool, not at the farm:
 * it is carried in. `farmCity` is still the destination of that haul, the origin
 * of every sell leg, and the city whose +10% bonus may apply.
 *
 * A candidate whose seed leg has no price is still returned, flagged
 * `seedPriced: false`. It used to be discarded, and since every city in the pool
 * fails the same way that emptied the WHOLE row — farm city, +10% bonus and the
 * crop's own sell price, which was known all along. A seed can be unpriced for
 * ordinary reasons: in `market` order type the buy cell reads `buy_price`, and a
 * book with no standing buy orders records 0 there while its ask is real. The
 * blank belongs to that one cell, not to the row. evaluateFarmingRow ranks these
 * candidates below every priced one, the same way findBestBuyCity treats the
 * volume gate as a preference rather than a filter (js/utils.js).
 */
function evaluateFarmingCity(item, farmCity, buyCities, sellCities, opts, deps) {
  const { marketData, findBestBuyCity, findBestSellCity } = deps;
  // The two legs gate on their own Pricing Model toggle. `minSellVolume`
  // defaults to `minVolume` so a caller that still passes one number keeps the
  // old linked behaviour.
  const minVolume = opts.minVolume || 0;
  const minSellVolume = opts.minSellVolume ?? minVolume;

  // destCity = the farm, so the seed haul carries the Brecilien Travel Planner
  // fee if that leg is ever re-enabled (js/travel-cost.js — currently 0).
  const pool = (Array.isArray(buyCities) && buyCities.length) ? buyCities : [farmCity];
  const found = findBestBuyCity(marketData, item.id, pool, minVolume, farmCity) || emptyFarmingLeg();
  const seedBuy = { city: found.city || null, price: found.price || 0, travelCost: found.travelCost || 0 };
  const seedPriced = seedBuy.price > 0;

  // originCity = the farm, so the sell finder nets the Travel Planner fee for a
  // crop grown in Brecilien and sold elsewhere.
  const cropSell = findBestSellCity(marketData, item.outputId, sellCities, minSellVolume, farmCity, farmCity)
    || emptyFarmingLeg();

  // A plot over 100% yield hands back more seeds than it planted, and for a
  // high-tier herb those are worth more than the crop. Pasture animals have no
  // seed leg at all.
  const seedSell = item.type === "byproduct"
    ? emptyFarmingLeg()
    : (findBestSellCity(marketData, item.id, sellCities, minSellVolume, farmCity, farmCity) || emptyFarmingLeg());

  // The Earthworm the harvest also turns up (10% a slot, doubled by Premium).
  // Its own sell city: worms are bait, and the city that pays for them is
  // rarely the one that pays for the crop.
  const wormId = typeof FARM_WORM_ID === "string" ? FARM_WORM_ID : "T1_WORM";
  const wormsPerCycle = farmingWormsPerCycle(item, opts.premium);
  const wormSell = wormsPerCycle > 0
    ? (findBestSellCity(marketData, wormId, sellCities, minSellVolume, farmCity, farmCity) || emptyFarmingLeg())
    : emptyFarmingLeg();

  const cityYieldBonus = typeof deps.getFarmingYieldBonus === "function"
    ? deps.getFarmingYieldBonus(farmCity || "", item.outputId)
    : 0;

  // Premium's +100% Product Yield and the city's +10% are one stat, summed
  // inside calcFarmingEconomics. The typeof guard matches the FARM_WORM_ID
  // one below: a Node harness that loads this file without the bonus tables
  // still gets the right game figure.
  const premiumBonus = opts.premium
    ? ((typeof PREMIUM_PRODUCT_BONUS === "number") ? PREMIUM_PRODUCT_BONUS : 1.0)
    : 0;

  const econ = typeof deps.calcFarmingEconomics === "function"
    ? Object.assign(emptyFarmingEcon(), deps.calcFarmingEconomics({
        type: item.type,
        seedPrice: seedBuy.price || 0,
        outputSellPrice: cropSell.price || 0,
        baseSeedYield: item.baseSeedYield || 0,
        wateringBonus: item.wateringBonus || 0,
        yieldBonus: cityYieldBonus,
        premiumBonus,
        plotsPerCycle: item.plotsPerCycle,
        feedCount: item.feedCount || 0,
        producePerCycle: farmingProducePerCycle(item),
        cycleHours: item.cycleHours,
        focusPerCycle: opts.focusPerCycle || 0,
        useWater: !!opts.focusOn,
        travelCostPerOutput: cropSell.travelCost || 0,
        seedSellPrice: seedSell.price || 0,
        seedTravelCostPerSeed: seedSell.travelCost || 0,
        wormsPerCycle,
        wormSellPrice: wormSell.price || 0,
        wormTravelCostPerWorm: wormSell.travelCost || 0,
      }))
    : emptyFarmingEcon();

  return { farmCity, seedBuy, cropSell, seedSell, wormSell, cityYieldBonus, econ, seedPriced };
}

/**
 * The grown animal behind a byproduct row: reusable capital, bought once and
 * still resellable, so it is priced for display but never charged to the cycle.
 * Searched across the whole candidate pool rather than at the farm city — the
 * animal is carried to the pasture once, and where it was cheapest does not
 * constrain where the feed is bought every cycle.
 */
function evaluateFarmingAnimal(item, cities, deps) {
  if (!item || item.type !== "byproduct" || !item.animalId) return emptyFarmingLeg();
  const found = deps.findBestBuyCity(deps.marketData, item.animalId, cities, 0, null);
  if (!found || !(found.price > 0)) return emptyFarmingLeg();
  return { city: found.city, price: found.price, travelCost: found.travelCost || 0 };
}

// Best cycle wins. Ties break on the bonus city, then the cheaper seed, then the
// order the cities came in — so a re-render never reshuffles equal candidates.
// The seed tie-break is usually a no-op now that every candidate quotes the same
// cheapest source; it still separates two farms whose haul-in fee differs.
function farmingCandidateBeats(a, b) {
  const delta = (a.econ.profitPerCycle || 0) - (b.econ.profitPerCycle || 0);
  if (Math.abs(delta) > FARMING_TIE_EPSILON) return delta > 0;
  const aBonus = a.cityYieldBonus > 0, bBonus = b.cityYieldBonus > 0;
  if (aBonus !== bBonus) return aBonus;
  if ((a.seedBuy.price || 0) !== (b.seedBuy.price || 0)) {
    return (a.seedBuy.price || 0) < (b.seedBuy.price || 0);
  }
  return false;
}

/**
 * Pick the farm city for one FARMING_PRODUCTION entry and return its economics.
 *
 * @param {object} item        FARMING_PRODUCTION row
 * @param {string[]} buyCities candidate farm cities, and the pool the seed is
 *                             sourced from — the two are no longer one city
 * @param {string[]} sellCities  where the harvest / surplus seed may be sold
 * @param {object} opts        { minVolume, minSellVolume, focusOn, focusPerCycle,
 *                             premium } — minSellVolume defaults to minVolume
 * @param {object} deps        { marketData, findBestBuyCity, findBestSellCity,
 *                               getFarmingYieldBonus, calcFarmingEconomics }
 * @returns {{farmCity, seedBuy, cropSell, seedSell, wormSell, cityYieldBonus,
 *            econ, altFarm, seedPriced}}
 *
 * A manual city pin on the seed needs nothing here: findBestBuyCity honours the
 * force itself (js/utils.js) and returns that city with a blank price, and a
 * blank price no longer costs the row its other legs.
 *
 * `altFarm` is the counterpart the row did NOT take: the best candidate on the
 * other side of the +10% line, scored end to end the same way and carrying its
 * own legs. It is what lets the table print the bonus's actual worth rather
 * than only the fact that one exists. Null when that side is empty — a
 * one-city pool, an output no city specializes in, or a pool (Brecilien and a
 * crop) where every candidate has the bonus.
 */
function evaluateFarmingRow(item, buyCities, sellCities, opts, deps) {
  if (!item || !deps || typeof deps.findBestBuyCity !== "function") return emptyFarmingRow();
  const cities = Array.isArray(buyCities) ? buyCities : [];

  const animalBuy = evaluateFarmingAnimal(item, cities, deps);

  // Two running bests instead of one — the candidates and their cost are
  // unchanged, they are just bucketed by whether the city carries the +10%
  // rather than collapsed into a single winner. The row keeps the same pick it
  // always made and gains the counterpart it passed over.
  //
  // farmingCandidateBeats orders on profit, then bonus, then seed price, then
  // pool order — a total order — so a per-bucket max plus one comparison
  // between the two picks exactly the candidate the old single scan did. Two
  // candidates from opposite buckets can never tie all the way down, because
  // they differ on the bonus key.
  //
  // The pair is kept TWICE: once for candidates that know what their seed
  // costs, once for the ones that do not. A priced candidate always wins, and
  // the unpriced pair is consulted only when no city in the pool quotes the
  // seed at all — which is the difference between a row that shows its crop
  // price with one blank cell and a row that shows nothing. Comparing across
  // the two would be meaningless anyway: an unpriced candidate's econ is
  // computed from a free seed, so it "beats" every real one.
  const priced = { bonus: null, plain: null };
  const unpriced = { bonus: null, plain: null };
  for (const city of cities) {
    const candidate = evaluateFarmingCity(item, city, cities, sellCities, opts, deps);
    if (!candidate) continue;
    const pair = candidate.seedPriced ? priced : unpriced;
    const key = candidate.cityYieldBonus > 0 ? "bonus" : "plain";
    if (!pair[key] || farmingCandidateBeats(candidate, pair[key])) pair[key] = candidate;
  }

  const pair = (priced.bonus || priced.plain) ? priced : unpriced;
  let best = pair.bonus, altFarm = pair.plain;
  if (!pair.bonus) {
    best = pair.plain;
    altFarm = null;
  } else if (pair.plain && farmingCandidateBeats(pair.plain, pair.bonus)) {
    // The bonus city can still lose the row — a thin sell book at that origin,
    // a haul-in fee — and when it does the table should say so, so the two
    // simply swap roles.
    best = pair.plain;
    altFarm = pair.bonus;
  }
  return best ? Object.assign(best, { animalBuy, altFarm }) : emptyFarmingRow();
}

// Node test harness export. Inert in the browser, which loads this as a global.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    evaluateFarmingRow, emptyFarmingEcon, farmingProducePerCycle, farmingWormsPerCycle,
  };
}
