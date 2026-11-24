/**
 * Test: a farming row carries BOTH farm-city outcomes — the one it picked and
 * the counterpart it did not.
 *
 * Every Royal City boosts one crop, one herb and one livestock byproduct by
 * +10% (js/data-city-bonuses.js). evaluateFarmingRow scores every candidate
 * farm city end to end and keeps the winner, which in practice is the bonus
 * city — so the table could say THAT a bonus existed but never what it was
 * worth, and a player whose plot sits elsewhere had no figure at all.
 *
 * The row now reports the losing bucket too, as `altFarm`: the best candidate
 * on the other side of the bonus line, scored the same way, with its own seed
 * and sell legs. `altFarm` is null when that bucket is empty — a one-city pool,
 * a crop no city specializes in, or a pool where every city has the bonus.
 *
 * The pick itself must not move: the same candidate wins as before.
 *
 * Market data is a literal fixture and the city pickers are stubs; nothing
 * touches a live API or a database.
 *
 * Run: node tests/farming-both-city-profits.test.cjs
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

// Martlock is the +10% city for T6_FOXGLOVE.
const FOXGLOVE = {
  type: "herb", id: "T6_FARM_FOXGLOVE_SEED", outputId: "T6_FOXGLOVE",
  tier: 6, cycleHours: 22, plotsPerCycle: 9,
  baseSeedYield: 0.8667, wateringBonus: 0.2667,
};

// Lymhurst AND Brecilien both boost T1_CARROT — Brecilien boosts all 8 crops.
const CARROT = {
  type: "crop", id: "T1_FARM_CARROT_SEED", outputId: "T1_CARROT",
  tier: 1, cycleHours: 22, plotsPerCycle: 9,
  baseSeedYield: 0, wateringBonus: 2.00,
};

// Martlock is the +10% city for T8_MILK.
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

console.log("\n=== The bonus city wins and the plain city is reported beside it ===");

test("Foxglove: Martlock farms, Bridgewatch is the no-bonus counterpart", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 15503, Martlock: 16500 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL, OPTS, makeDeps(market));
  assert.strictEqual(r.farmCity, "Martlock");
  assert.strictEqual(r.cityYieldBonus, 0.10);
  assert.ok(r.altFarm, "the plain city must be reported");
  assert.strictEqual(r.altFarm.farmCity, "Bridgewatch");
  assert.strictEqual(r.altFarm.cityYieldBonus, 0);
});

test("the counterpart is strictly worse — that gap IS the bonus", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 15503, Martlock: 16500 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL, OPTS, makeDeps(market));
  assert.ok(r.altFarm.econ.profitPerCycle < r.econ.profitPerCycle,
    `alt ${r.altFarm.econ.profitPerCycle} should be under headline ${r.econ.profitPerCycle}`);
  // Both plots return seeds at the same 86.67% dry - the city bonus is a
  // product yield bonus, so the whole gap is 10% more foxglove off the same
  // seed bill.
  assert.ok(Math.abs(r.altFarm.econ.totalSeedYield - 0.8667) < 1e-9);
  assert.ok(Math.abs(r.econ.totalSeedYield - 0.8667) < 1e-9);
  assert.ok(Math.abs(r.econ.outputsPerCycle - r.altFarm.econ.outputsPerCycle * 1.10) < 1e-9);
});

test("profitPerDay follows profitPerCycle on both sides (same cycle length)", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 15503, Martlock: 16500 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL, OPTS, makeDeps(market));
  assert.ok(r.altFarm.econ.profitPerDay < r.econ.profitPerDay);
});

test("the counterpart sources its seed across the WHOLE pool, not at its own city", () => {
  // Thetford is the cheap source and has no foxglove spec; Bridgewatch is the
  // plain candidate that wins its bucket on pool order once both quote Thetford.
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Thetford: 900, Bridgewatch: 15503, Martlock: 16500 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock", "Thetford"], SELL, OPTS, makeDeps(market));
  assert.strictEqual(r.farmCity, "Martlock");
  assert.strictEqual(r.seedBuy.city, "Thetford");
  assert.strictEqual(r.altFarm.farmCity, "Bridgewatch", "tied plain candidates keep pool order");
  assert.strictEqual(r.altFarm.seedBuy.city, "Thetford");
  assert.strictEqual(r.altFarm.seedBuy.price, 900);
});

test("the counterpart keeps its own sell leg", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 15503, Martlock: 16500 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543, Thetford: 900 } },
  };
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], ["Caerleon", "Thetford"], OPTS, makeDeps(market));
  assert.strictEqual(r.cropSell.city, "Thetford");
  assert.strictEqual(r.altFarm.cropSell.city, "Thetford");
  assert.strictEqual(r.altFarm.cropSell.price, 900);
});

console.log("\n=== No counterpart to report ===");

test("no city specializes in the output -> altFarm is null", () => {
  const noSpec = Object.assign({}, FOXGLOVE, { outputId: "T6_NOT_A_FARM_ITEM" });
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 900, Martlock: 1200 }, sell: {} },
    T6_NOT_A_FARM_ITEM: { buy: {}, sell: { Caerleon: 543 } },
  };
  const r = evaluateFarmingRow(noSpec, ["Bridgewatch", "Martlock"], SELL, OPTS, makeDeps(market));
  assert.strictEqual(r.cityYieldBonus, 0);
  assert.strictEqual(r.altFarm, null);
});

test("every city in the pool has the bonus -> altFarm is null", () => {
  // Lymhurst boosts carrots; Brecilien boosts all 8 crops. Neither is plain.
  const market = {
    T1_FARM_CARROT_SEED: { buy: { Lymhurst: 2000, Brecilien: 2100 }, sell: {} },
    T1_CARROT: { buy: {}, sell: { Caerleon: 100 } },
  };
  const r = evaluateFarmingRow(CARROT, ["Lymhurst", "Brecilien"], SELL, OPTS, makeDeps(market));
  assert.strictEqual(r.cityYieldBonus, 0.10);
  assert.strictEqual(r.altFarm, null);
});

test("a one-city pool has nothing to compare against", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Martlock: 16500 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const r = evaluateFarmingRow(FOXGLOVE, ["Martlock"], SELL, OPTS, makeDeps(market));
  assert.strictEqual(r.farmCity, "Martlock");
  assert.strictEqual(r.altFarm, null);
});

// An unpriced seed no longer voids the row (tests/farming-unpriced-seed-row.test.cjs).
// The two buckets are still filled, so the row keeps a counterpart — both sides
// of it are flagged `seedPriced: false` and the renderer prints no silver.
test("no city lists the seed -> the row still routes, flagged unpriced", () => {
  const market = { T6_FARM_FOXGLOVE_SEED: { buy: {}, sell: {} }, T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } } };
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL, OPTS, makeDeps(market));
  assert.ok(r.farmCity, "the farm city was dropped with the seed price");
  assert.strictEqual(r.seedPriced, false);
  assert.ok(!r.altFarm || r.altFarm.seedPriced === false, "a priced counterpart appeared from nowhere");
  assert.ok(!Number.isNaN(r.econ.profitPerDay));
});

test("an empty city pool -> altFarm null", () => {
  const market = { T6_FARM_FOXGLOVE_SEED: { buy: { Martlock: 100 }, sell: {} }, T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } } };
  const r = evaluateFarmingRow(FOXGLOVE, [], SELL, OPTS, makeDeps(market));
  assert.strictEqual(r.altFarm, null);
});

console.log("\n=== The other direction: the bonus city loses ===");

test("bonus city pays less -> the plain city farms and the BONUS one is the counterpart", () => {
  // Economics pinned to the bonus flag so the bonus city genuinely loses; a real
  // market does this through a thin sell book at that origin.
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 1000, Martlock: 1000 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const deps = makeDeps(market, {
    calcFarmingEconomics: ({ yieldBonus }) => ({
      profitPerCycle: yieldBonus > 0 ? 50 : 100,
      profitPerDay: yieldBonus > 0 ? 55 : 110,
      totalSeedYield: 1,
    }),
  });
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL, OPTS, deps);
  assert.strictEqual(r.farmCity, "Bridgewatch");
  assert.strictEqual(r.cityYieldBonus, 0);
  assert.strictEqual(r.econ.profitPerCycle, 100);
  assert.ok(r.altFarm, "the bonus city must still be reported");
  assert.strictEqual(r.altFarm.farmCity, "Martlock");
  assert.strictEqual(r.altFarm.cityYieldBonus, 0.10);
  assert.strictEqual(r.altFarm.econ.profitPerCycle, 50);
});

console.log("\n=== The pick itself does not move ===");

test("equal profit, one candidate has the bonus -> bonus still wins the tie", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 1000, Martlock: 1000 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const deps = makeDeps(market, {
    calcFarmingEconomics: () => ({ profitPerCycle: 100, totalSeedYield: 1, profitPerDay: 0 }),
  });
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL, OPTS, deps);
  assert.strictEqual(r.farmCity, "Martlock");
  assert.strictEqual(r.altFarm.farmCity, "Bridgewatch");
});

test("a dear listing in the bonus city still does not push the plot elsewhere", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 15503, Martlock: 200000 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL, OPTS, makeDeps(market));
  assert.strictEqual(r.farmCity, "Martlock");
  assert.strictEqual(r.seedBuy.city, "Bridgewatch");
});

test("a forced buy city pins BOTH sides' seed source", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 15503, Martlock: 16500 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const deps = makeDeps(market, { getCityForce: (id, side) => (side === "buy" ? "Martlock" : null) });
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL, OPTS, deps);
  assert.strictEqual(r.seedBuy.city, "Martlock");
  assert.strictEqual(r.altFarm.seedBuy.city, "Martlock");
});

test("identical calls return the same pair", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Bridgewatch: 15503, Martlock: 16500 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const deps = makeDeps(market);
  const a = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL, OPTS, deps);
  const b = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock"], SELL, OPTS, deps);
  assert.strictEqual(a.farmCity, b.farmCity);
  assert.strictEqual(a.altFarm.farmCity, b.altFarm.farmCity);
  assert.strictEqual(a.altFarm.econ.profitPerCycle, b.altFarm.econ.profitPerCycle);
});

console.log("\n=== Byproducts get the same pair ===");

test("Cow's Milk: Martlock pastures, Thetford is the no-bonus counterpart", () => {
  const market = {
    T8_PUMPKIN: { buy: { Thetford: 350, Martlock: 400 }, sell: {} },
    T8_MILK: { buy: {}, sell: { Caerleon: 4000 } },
  };
  const r = evaluateFarmingRow(COW_MILK, ["Thetford", "Martlock"], SELL, OPTS, makeDeps(market));
  assert.strictEqual(r.farmCity, "Martlock");
  assert.strictEqual(r.altFarm.farmCity, "Thetford");
  assert.strictEqual(r.altFarm.cityYieldBonus, 0);
  // 1.10 vs 1.00 produce multiplier — same feed bill either way.
  assert.ok(Math.abs(r.econ.totalSeedYield - 1.10) < 1e-9);
  assert.strictEqual(r.altFarm.econ.totalSeedYield, 1.00);
  assert.ok(r.altFarm.econ.outputsPerCycle < r.econ.outputsPerCycle);
  assert.ok(r.altFarm.econ.profitPerCycle < r.econ.profitPerCycle);
});

test("the counterpart carries no seed-sell leg on a pasture row either", () => {
  const market = {
    T8_PUMPKIN: { buy: { Thetford: 350, Martlock: 400 }, sell: { Caerleon: 99999 } },
    T8_MILK: { buy: {}, sell: { Caerleon: 4000 } },
  };
  const r = evaluateFarmingRow(COW_MILK, ["Thetford", "Martlock"], SELL, OPTS, makeDeps(market));
  assert.strictEqual(r.seedSell.city, null);
  assert.strictEqual(r.altFarm.seedSell.city, null);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
