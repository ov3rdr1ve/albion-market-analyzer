/**
 * Test: the Farming seed/feed leg is sourced across the WHOLE city pool, not at
 * the farm.
 *
 * Seeds and pasture feed are freight: they are bought wherever they are cheapest
 * and carried to the plot. The farm city stays a separate decision — it decides
 * the +10% local production bonus, it is the destination of the seed haul, and
 * it is the origin every sell leg is ranked from.
 *
 * The dependencies handed to evaluateFarmingRow are stubs over a literal fixture
 * market; nothing here touches a live API or a database.
 *
 * Run: node tests/farming-seed-sourced-across-cities.test.cjs
 */

const assert = require("assert");
const { getFarmingYieldBonus, calcFarmingEconomics } = require("../js/calculations.js");
const { evaluateFarmingRow } = require("../js/farming-row-econ.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// Martlock carries the +10% spec for T6_FOXGLOVE and T8_MILK (CITY_FARM_SPEC).
const FOXGLOVE = {
  type: "herb", id: "T6_FARM_FOXGLOVE_SEED", outputId: "T6_FOXGLOVE",
  tier: 6, cycleHours: 22, plotsPerCycle: 9,
  baseSeedYield: 0.8667, wateringBonus: 0.2667,
};

const COW_MILK = {
  type: "byproduct", id: "T8_PUMPKIN", outputId: "T8_MILK",
  animalId: "T8_FARM_COW_GROWN", babyId: "T8_FARM_COW_BABY", feedId: "T8_PUMPKIN",
  feedCount: 9, produceBase: 9.5,
  tier: 8, cycleHours: 22, plotsPerCycle: 1,
};

const OPTS = { minVolume: 0, focusOn: false, focusPerCycle: 100 };

// Records every call so the pool and destination handed to the buy finder can be
// asserted directly — that contract is the whole feature.
function makeDeps(market, overrides) {
  const buyAt = (id, c) => (market[id] && market[id].buy && market[id].buy[c]) || 0;
  const sellAt = (id, c) => (market[id] && market[id].sell && market[id].sell[c]) || 0;
  const calls = [];
  const deps = Object.assign({
    calls,
    marketData: market,
    findBestBuyCity(md, id, cities, minVolume, destCity) {
      calls.push({ id, cities: cities.slice(), minVolume, destCity });
      let city = null, price = 0;
      cities.forEach((c) => {
        const p = buyAt(id, c);
        if (p > 0 && (price === 0 || p < price)) { city = c; price = p; }
      });
      return { city, price, travelCost: 0 };
    },
    findBestSellCity(md, id, cities, minVolume, excludeBuyCity) {
      let city = null, price = 0;
      cities.forEach((c) => {
        if (deps.blockedRoutes && deps.blockedRoutes(excludeBuyCity, c)) return;
        const p = sellAt(id, c);
        if (p > price) { city = c; price = p; }
      });
      return { city, price, travelCost: 0 };
    },
    getFarmingYieldBonus,
    calcFarmingEconomics,
    getCityForce: () => null,
    blockedRoutes: null,
  }, overrides || {});
  return deps;
}

console.log("\n=== The seed pool is every candidate city ===");

test("the buy finder is handed the whole pool, with the farm as destination", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Lymhurst: 900, Martlock: 1200, Thetford: 1100 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const pool = ["Lymhurst", "Martlock", "Thetford"];
  const deps = makeDeps(market);
  const r = evaluateFarmingRow(FOXGLOVE, pool, ["Caerleon"], OPTS, deps);

  const seedCalls = deps.calls.filter((c) => c.id === "T6_FARM_FOXGLOVE_SEED");
  assert.strictEqual(seedCalls.length, pool.length, "one seed lookup per candidate farm");
  seedCalls.forEach((c) => assert.deepStrictEqual(c.cities, pool, "full pool every time"));
  assert.deepStrictEqual(seedCalls.map((c) => c.destCity), pool, "destination is the farm");
  assert.strictEqual(r.seedBuy.city, "Lymhurst");
  assert.strictEqual(r.seedBuy.price, 900);
  assert.strictEqual(r.farmCity, "Martlock");
});

test("the volume preference reaches the seed leg", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Lymhurst: 900 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const deps = makeDeps(market);
  evaluateFarmingRow(FOXGLOVE, ["Lymhurst", "Martlock"], ["Caerleon"],
    { minVolume: 25, focusOn: false, focusPerCycle: 100 }, deps);
  const seedCalls = deps.calls.filter((c) => c.id === "T6_FARM_FOXGLOVE_SEED");
  seedCalls.forEach((c) => assert.strictEqual(c.minVolume, 25));
});

test("only a city that cannot farm the crop lists the seed -> it still supplies", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Thetford: 4000 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const r = evaluateFarmingRow(FOXGLOVE, ["Bridgewatch", "Martlock", "Thetford"], ["Caerleon"], OPTS, makeDeps(market));
  assert.strictEqual(r.seedBuy.city, "Thetford");
  assert.strictEqual(r.farmCity, "Martlock", "the plot still takes the bonus city");
});

test("a single-city pool buys and farms in the same place", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Martlock: 1200 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const r = evaluateFarmingRow(FOXGLOVE, ["Martlock"], ["Caerleon"], OPTS, makeDeps(market));
  assert.strictEqual(r.seedBuy.city, "Martlock");
  assert.strictEqual(r.farmCity, "Martlock");
});

console.log("\n=== The farm city is still decided on the cycle ===");

test("a farm cut off from the best sell city loses to one that is not", () => {
  // Martlock has the bonus but cannot ship to the only city paying real silver,
  // so the plot moves to Bridgewatch. The seed comes from Lymhurst either way.
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Lymhurst: 800, Martlock: 900, Bridgewatch: 900 }, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 5000, Lymhurst: 100 } },
  };
  const deps = makeDeps(market, {
    blockedRoutes: (from, to) => from === "Martlock" && to === "Caerleon",
  });
  const r = evaluateFarmingRow(FOXGLOVE, ["Martlock", "Bridgewatch", "Lymhurst"], ["Caerleon", "Lymhurst"], OPTS, deps);
  assert.strictEqual(r.farmCity, "Bridgewatch");
  assert.strictEqual(r.cropSell.city, "Caerleon");
  assert.strictEqual(r.seedBuy.city, "Lymhurst");
  assert.strictEqual(r.cityYieldBonus, 0);
});

test("the sell legs are ranked from the farm, not from the seed source", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: { Lymhurst: 900, Martlock: 1500 }, sell: { Caerleon: 3000 } },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  let seenOrigin = null;
  const deps = makeDeps(market);
  const inner = deps.findBestSellCity;
  deps.findBestSellCity = (md, id, cities, minVolume, excludeBuyCity, originCity) => {
    if (id === "T6_FOXGLOVE") seenOrigin = originCity;
    return inner(md, id, cities, minVolume, excludeBuyCity, originCity);
  };
  const r = evaluateFarmingRow(FOXGLOVE, ["Lymhurst", "Martlock"], ["Caerleon"], OPTS, deps);
  assert.strictEqual(r.farmCity, "Martlock");
  assert.strictEqual(r.seedBuy.city, "Lymhurst");
  assert.strictEqual(seenOrigin, "Martlock");
});

console.log("\n=== Pasture feed follows the same rule ===");

test("byproduct: the feed is bought away from the pasture", () => {
  const market = {
    T8_PUMPKIN: { buy: { Thetford: 300, Martlock: 900 }, sell: {} },
    T8_MILK: { buy: {}, sell: { Caerleon: 4000 } },
    T8_FARM_COW_GROWN: { buy: { Lymhurst: 250000 }, sell: {} },
  };
  const r = evaluateFarmingRow(COW_MILK, ["Thetford", "Martlock", "Lymhurst"], ["Caerleon"], OPTS, makeDeps(market));
  assert.strictEqual(r.seedBuy.city, "Thetford");
  assert.strictEqual(r.seedBuy.price, 300);
  assert.strictEqual(r.farmCity, "Martlock");
  assert.strictEqual(r.cityYieldBonus, 0.10);
  // The animal is capital and keeps its own free-pool search.
  assert.strictEqual(r.animalBuy.city, "Lymhurst");
});

console.log("\n=== Nothing to source ===");

// The seed CELL goes blank; the row does not. Discarding every candidate over an
// unpriced seed also threw away the crop's own sell price — see
// tests/farming-unpriced-seed-row.test.cjs for the reported case.
test("the seed is listed nowhere -> blank seed leg, crop leg intact", () => {
  const market = {
    T6_FARM_FOXGLOVE_SEED: { buy: {}, sell: {} },
    T6_FOXGLOVE: { buy: {}, sell: { Caerleon: 543 } },
  };
  const r = evaluateFarmingRow(FOXGLOVE, ["Lymhurst", "Martlock"], ["Caerleon"], OPTS, makeDeps(market));
  assert.strictEqual(r.seedPriced, false);
  assert.strictEqual(r.seedBuy.city, null);
  assert.strictEqual(r.seedBuy.price, 0);
  assert.ok(r.farmCity, "the farm city was dropped with the seed price");
  assert.strictEqual(r.cropSell.city, "Caerleon");
  assert.strictEqual(r.cropSell.price, 543);
  assert.ok(!Number.isNaN(r.econ.profitPerDay));
});

test("an empty pool never calls the buy finder for a seed", () => {
  const market = { T6_FARM_FOXGLOVE_SEED: { buy: { Martlock: 900 }, sell: {} }, T6_FOXGLOVE: { buy: {}, sell: {} } };
  const deps = makeDeps(market);
  const r = evaluateFarmingRow(FOXGLOVE, [], ["Caerleon"], OPTS, deps);
  assert.strictEqual(deps.calls.filter((c) => c.id === "T6_FARM_FOXGLOVE_SEED").length, 0);
  assert.strictEqual(r.farmCity, null);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
