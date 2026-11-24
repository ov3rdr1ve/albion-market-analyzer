/**
 * Test: evaluateFarmingRow — the farm city is chosen on the profit of the whole
 * cycle, and the seed is sourced separately from wherever it is cheapest.
 *
 * A farming row carries three cities: the seed/feed BUY city (cheapest listing
 * in the pool — seeds are freight and get carried in), the FARM city (the plot,
 * which decides the +10% local production bonus and is the origin of every sell
 * leg), and the SELL city. Welding the seed buy to the farm — the old
 * one-element findBestBuyCity call — hid cheaper listings next door and threw
 * the bonus away whenever another city undercut the bonus city by any amount.
 *
 * Market data here is a literal fixture and the city pickers are stubs; nothing
 * touches a live API or a database.
 *
 * Run: node tests/farming-best-farm-city.test.cjs
 */

const assert = require("assert");
const { getFarmingYieldBonus, calcFarmingEconomics } = require("../js/calculations.js");
const { evaluateFarmingRow } = require("../js/farming-row-econ.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// --- Fixtures ---------------------------------------------------------------
// market[itemId] = { buy: { city: price }, sell: { city: price } }

const FOXGLOVE = {
  type: "herb", id: "T6_FARM_FOXGLOVE_SEED", outputId: "T6_FOXGLOVE",
  tier: 6, cycleHours: 22, plotsPerCycle: 9,
  baseSeedYield: 0.8667, wateringBonus: 0.2667,
};

// A pasture row buys FEED every cycle and keeps the animal — see
// tests/farming-byproduct-feed-model.test.cjs for the model itself.
const COW_MILK = {
  type: "byproduct", id: "T8_PUMPKIN", outputId: "T8_MILK",
  animalId: "T8_FARM_COW_GROWN", babyId: "T8_FARM_COW_BABY", feedId: "T8_PUMPKIN",
  feedCount: 9, produceBase: 9.5,
  tier: 8, cycleHours: 22, plotsPerCycle: 1,
};

function makeDeps(market, overrides) {
  const buyAt = (id, c) => (market[id] && market[id].buy && market[id].buy[c]) || 0;
  const sellAt = (id, c) => (market[id] && market[id].sell && market[id].sell[c]) || 0;
  const deps = Object.assign({
    marketData: market,
    // Mirrors js/utils.js findBestBuyCity: a forced city inside the pool wins
    // unconditionally, even with no listing (the picker sets a city, not a price).
    findBestBuyCity(md, id, cities) {
      const forced = typeof deps.getCityForce === "function" ? deps.getCityForce(id, "buy") : null;
      if (forced && cities.includes(forced)) {
        return { city: forced, price: buyAt(id, forced), travelCost: 0 };
      }
      let city = null, price = 0;
      cities.forEach((c) => {
        const p = buyAt(id, c);
        if (p > 0 && (price === 0 || p < price)) { city = c; price = p; }
      });
      return { city, price, travelCost: 0 };
    },
    findBestSellCity(md, id, cities) {
      let city = null, price = 0;
      cities.forEach((c) => {
        const p = sellAt(id, c);
        if (p > price) { city = c; price = p; }
      });
      return { city, price, travelCost: 0 };
    },
    getFarmingYieldBonus,
    calcFarmingEconomics,
    getCityForce: () => null,
  }, overrides || {});
  return deps;
}

const OPTS = { minVolume: 0, focusOn: false, focusPerCycle: 100 };
const SELL = ["Caerleon"];

console.log("\n=== Farm city is picked on cycle profit ===");

// Martlock is the +10% city for T6_FOXGLOVE (CITY_FARM_SPEC).
test("the plot goes to the bonus city while the seed comes from the cheap one", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 15503, Martlock: 16500 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL, OPTS, makeDeps(market));
  assert.strictEqual(r.farmCity, "Martlock");
  assert.strictEqual(r.seedBuy.city, "Bridgewatch");
  assert.strictEqual(r.seedBuy.price, 15503);
  assert.strictEqual(r.cityYieldBonus, 0.10);
  // 86.67% base, watering off. The city's +10% is a product yield bonus and
  // never reaches this number - it shows up in outputsPerCycle instead.
  assert.ok(Math.abs(r.econ.totalSeedYield - 0.8667) < 1e-9);
});

test("a dear listing in the bonus city no longer pushes the plot elsewhere", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 15503, Martlock: 200000 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL, OPTS, makeDeps(market));
  assert.strictEqual(r.farmCity, "Martlock");
  assert.strictEqual(r.seedBuy.city, "Bridgewatch");
  assert.strictEqual(r.seedBuy.price, 15503);
  assert.strictEqual(r.cityYieldBonus, 0.10);
});

test("no city has a farm spec for the output -> nothing separates the cities", () => {
  const noSpec = Object.assign({}, FOXGLOVE, { outputId: "T6_NOT_A_FARM_ITEM" });
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 900, Martlock: 1200 }, sell: {} },
    T6_NOT_A_FARM_ITEM: { buy: {}, sell: { Caerleon: 543 } },
  };
  const r = evaluateFarmingRow(noSpec, ["Bridgewatch", "Martlock"], SELL, OPTS, makeDeps(market));
  assert.strictEqual(r.seedBuy.city, "Bridgewatch");
  assert.strictEqual(r.farmCity, "Bridgewatch", "tied candidates keep pool order");
  assert.strictEqual(r.cityYieldBonus, 0);
});

test("the harvest still sells at the best sell city, from the chosen farm city", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 15503, Martlock: 16500 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543, Thetford: 900 } },
  };
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], ["Caerleon", "Thetford"], OPTS, makeDeps(market));
  assert.strictEqual(r.farmCity, "Martlock");
  assert.strictEqual(r.seedBuy.city, "Bridgewatch");
  assert.strictEqual(r.cropSell.city, "Thetford");
  assert.strictEqual(r.cropSell.price, 900);
});

console.log("\n=== Forced city (the manual picker) ===");

test("a forced buy city pins the seed source, not the plot", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 15503, Martlock: 16500 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const deps = makeDeps(market, { getCityForce: (id, side) => (side === "buy" ? "Bridgewatch" : null) });
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL, OPTS, deps);
  assert.strictEqual(r.seedBuy.city, "Bridgewatch");
  assert.strictEqual(r.farmCity, "Martlock");
  assert.strictEqual(r.cityYieldBonus, 0.10);
});

test("a forced buy city that is the dear one is still honoured", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 15503, Martlock: 16500 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const deps = makeDeps(market, { getCityForce: (id, side) => (side === "buy" ? "Martlock" : null) });
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL, OPTS, deps);
  assert.strictEqual(r.seedBuy.city, "Martlock");
  assert.strictEqual(r.seedBuy.price, 16500);
});

test("a forced city outside the pool falls through to the normal ranking", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 15503, Martlock: 16500 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const deps = makeDeps(market, { getCityForce: () => "Thetford" });
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL, OPTS, deps);
  assert.strictEqual(r.farmCity, "Martlock");
  assert.strictEqual(r.seedBuy.city, "Bridgewatch");
});

test("a forced city with no seed listing keeps the city, price 0, and the row", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 15503 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const deps = makeDeps(market, { getCityForce: (id, side) => (side === "buy" ? "Martlock" : null) });
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL, OPTS, deps);
  assert.strictEqual(r.seedBuy.city, "Martlock");
  assert.strictEqual(r.seedBuy.price, 0);
  assert.ok(r.farmCity, "the blank seed price must not blank the whole row");
  assert.strictEqual(r.cropSell.city, "Caerleon");
});

console.log("\n=== Thin and missing markets ===");

test("only one city lists the seed -> every plot sources from it", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Martlock: 16500 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock", "Thetford"], SELL, OPTS, makeDeps(market));
  assert.strictEqual(r.seedBuy.city, "Martlock");
  assert.strictEqual(r.seedBuy.price, 16500);
  assert.strictEqual(r.farmCity, "Martlock", "the bonus city still wins the plot");
});

// An unpriced seed used to void the whole row. It no longer does: the seed CELL
// stays blank, the row keeps the farm city, the bonus and the crop's own sell
// price, and `seedPriced` tells the renderer not to print silver derived from a
// seed it never paid for. See tests/farming-unpriced-seed-row.test.cjs.
test("no city lists the seed -> blank seed leg, but the row still routes", () => {
  const market = { T6_FARM_FOXGLOVE_SEED: { buy: {}, sell: {} }, T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } } };
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL, OPTS, makeDeps(market));
  assert.strictEqual(r.seedPriced, false);
  assert.strictEqual(r.seedBuy.city, null);
  assert.strictEqual(r.seedBuy.price, 0);
  assert.ok(r.farmCity, "the farm city was dropped with the seed price");
  assert.strictEqual(r.cropSell.city, "Caerleon");
  assert.ok(!Number.isNaN(r.econ.profitPerDay));
});

test("an empty city pool returns a null row — there is nothing to score", () => {
  const market = { T6_FARM_FOXGLOVE_SEED: { buy: { Martlock: 100 }, sell: {} }, T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } } };
  const r = evaluateFarmingRow(FOXGLOVE, [], SELL, OPTS, makeDeps(market));
  assert.strictEqual(r.farmCity, null);
  assert.strictEqual(r.seedBuy.city, null);
  assert.strictEqual(r.econ.profitPerCycle, 0);
});

console.log("\n=== Byproducts ===");

test("byproduct: the pasture goes to the +10% city, the feed to the cheap one", () => {
  // Martlock is the T8_MILK spec city.
  const market = {
    T8_PUMPKIN: { buy: { Thetford: 350, Martlock: 400 }, sell: {} },
    T8_MILK: { buy: {}, sell: { Caerleon: 4000 } },
  };
  const r = evaluateFarmingRow(COW_MILK, ["Thetford", "Martlock"], SELL, OPTS, makeDeps(market));
  assert.strictEqual(r.farmCity, "Martlock");
  assert.strictEqual(r.seedBuy.city, "Thetford");
  assert.strictEqual(r.seedBuy.price, 350);
  assert.strictEqual(r.cityYieldBonus, 0.10);
  assert.ok(Math.abs(r.econ.totalSeedYield - 1.10) < 1e-9);
});

test("byproduct: no seed-sell leg is priced (animals hand back no feed)", () => {
  const market = {
    T8_PUMPKIN: { buy: { Martlock: 400 }, sell: { Caerleon: 99999 } },
    T8_MILK: { buy: {}, sell: { Caerleon: 4000 } },
  };
  const r = evaluateFarmingRow(COW_MILK, ["Martlock"], SELL, OPTS, makeDeps(market));
  assert.strictEqual(r.seedSell.city, null);
  assert.strictEqual(r.seedSell.price, 0);
});

console.log("\n=== The ranking follows the focus state ===");

// The seed comes from the same city either way; what moves with the focus state
// is the yield, and with it whether the plot clears 100% and hands seeds back.
const FLIP_MARKET = {
  T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 1000, Martlock: 5000 }, sell: { Caerleon: 4000 } },
  T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
};

test("focus OFF -> bonus city farms, cheap city supplies", () => {
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL,
    { minVolume: 0, focusOn: false, focusPerCycle: 100 }, makeDeps(FLIP_MARKET));
  assert.strictEqual(r.farmCity, "Martlock");
  assert.strictEqual(r.seedBuy.city, "Bridgewatch");
  assert.ok(r.econ.totalSeedYield < 1, "dry plot stays under 100%");
});

test("focus ON -> same two cities, and the plot now clears 100%", () => {
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL,
    { minVolume: 0, focusOn: true, focusPerCycle: 100 }, makeDeps(FLIP_MARKET));
  assert.strictEqual(r.farmCity, "Martlock");
  assert.strictEqual(r.seedBuy.city, "Bridgewatch");
  assert.ok(r.econ.totalSeedYield > 1, "watering alone clears 100%");
  assert.ok(r.econ.surplusSeedsPerCycle > 0);
});

console.log("\n=== Determinism ===");

test("identical candidates -> first city in the pool, stable across calls", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Thetford: 1000, Lymhurst: 1000 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const deps = makeDeps(market);
  const a = evaluateFarmingRow(FOXGLOVE, ["Thetford", "Lymhurst"], SELL, OPTS, deps);
  const b = evaluateFarmingRow(FOXGLOVE, ["Thetford", "Lymhurst"], SELL, OPTS, deps);
  assert.strictEqual(a.farmCity, "Thetford");
  assert.strictEqual(b.farmCity, "Thetford");
  assert.strictEqual(a.seedBuy.city, "Thetford");
});

test("equal profit but one candidate has the bonus -> the bonus city wins the tie", () => {
  // Economics pinned to a constant so the two cities are genuinely tied and only
  // the tie-break can decide. Bridgewatch is listed first, so input order would
  // pick it; the bonus must outrank that.
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 1000, Martlock: 1000 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const deps = makeDeps(market, {
    calcFarmingEconomics: () => ({ profitPerCycle: 100, totalSeedYield: 1, profitPerDay: 0 }),
  });
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL, OPTS, deps);
  assert.strictEqual(r.farmCity, "Martlock");
});

test("tied on profit and bonus -> pool order decides, sourcing stays cheapest", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Thetford: 2000, Lymhurst: 900 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const deps = makeDeps(market, {
    calcFarmingEconomics: () => ({ profitPerCycle: 100, totalSeedYield: 1, profitPerDay: 0 }),
  });
  const r = evaluateFarmingRow(FOXGLOVE, ["Thetford", "Lymhurst"], SELL, OPTS, deps);
  assert.strictEqual(r.farmCity, "Thetford");
  assert.strictEqual(r.seedBuy.city, "Lymhurst");
  assert.strictEqual(r.seedBuy.price, 900);
});

console.log("\n=== Missing dependency is survivable ===");

test("no calcFarmingEconomics -> zeroed row, no throw", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Martlock: 1000 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const deps = makeDeps(market, { calcFarmingEconomics: null });
  const r = evaluateFarmingRow(FOXGLOVE, ["Martlock"], SELL, OPTS, deps);
  assert.strictEqual(r.econ.profitPerCycle, 0);
  assert.strictEqual(r.econ.totalSeedYield, 0);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
