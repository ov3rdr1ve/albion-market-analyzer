/**
 * Test: the Earthworm leg of a crop / herb harvest.
 *
 * Ground truth, ao-bin-dumps + Albion Wiki ("Farming"):
 *   loot.xml  <Lootlist name="T6_POTATO_LOOT">
 *               <Item type="T6_POTATO" chance="1.0" amount="3-6" />
 *               <Item type="T1_WORM"   chance="0.1" amount="1" />
 *   wiki      "There's also a 10% chance of getting 1 Earthworm with each
 *              harvested seed (2 with premium)."
 *
 * So a harvested SLOT hands back 0.1 worms on average, 0.2 with Premium (the
 * amount doubles, the chance does not). Worms are ordinary market goods —
 * T1_WORM is the only bait ingredient in the game — so the leg is priced like
 * the surplus seed: sales tax off the top, Travel Planner fee for hauling it
 * out of Brecilien, and worth nothing when nobody lists worms.
 *
 * A pasture row has no worm leg at all: its produce list is eggs/milk only.
 *
 * Black box over the shipped modules. No market, no DOM.
 *
 * Run: node tests/farming-worm-revenue.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const { calcFarmingEconomics, PREMIUM_TAX } = require("../js/calculations.js");
const { evaluateFarmingRow, farmingWormsPerCycle } = require("../js/farming-row-econ.js");

const dataSrc = fs.readFileSync(path.join(ROOT, "js/data-farming.js"), "utf8");
const dataMod = new Module("farming-data-worm-test");
dataMod._compile(`${dataSrc}\nmodule.exports = { FARMING_PRODUCTION, FARM_WORM_ID };`, "data-farming.js");
const { FARMING_PRODUCTION, FARM_WORM_ID } = dataMod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); failed++; }
}
function close(actual, expected, eps, label) {
  assert.ok(Math.abs(actual - expected) < eps,
    `${label}: expected ${expected}, got ${actual}`);
}

console.log("=== catalog ===");

test("the worm is T1_WORM — the only bait ingredient in the game", () => {
  assert.strictEqual(FARM_WORM_ID, "T1_WORM");
});

FARMING_PRODUCTION.filter((p) => p.type === "crop" || p.type === "herb").forEach((p) => {
  test(`${p.name}: wormsPerPlot is the 10% loot roll`, () => {
    close(p.wormsPerPlot, 0.1, 1e-9, "worms per slot");
  });
});

FARMING_PRODUCTION.filter((p) => p.type === "byproduct").forEach((p) => {
  test(`${p.name}: a pasture row has no worm leg`, () => {
    assert.ok(!p.wormsPerPlot, "byproduct rows must not carry wormsPerPlot");
    assert.strictEqual(farmingWormsPerCycle(p, true), 0);
  });
});

console.log("\n=== farmingWormsPerCycle ===");

const POTATO = FARMING_PRODUCTION.find((p) => p.id === "T6_FARM_POTATO_SEED");

test("free account: 0.1 worms per slot", () => {
  close(farmingWormsPerCycle(POTATO, false), 0.1, 1e-9, "free");
});

test("Premium: 2 worms per proc, so 0.2 per slot", () => {
  close(farmingWormsPerCycle(POTATO, true), 0.2, 1e-9, "premium");
});

console.log("\n=== calcFarmingEconomics — the worm leg ===");

const CROP = {
  type: "crop",
  seedPrice: 15000,
  outputSellPrice: 800,
  baseSeedYield: 0.8667,
  wateringBonus: 0.2667,
  yieldBonus: 0,
  plotsPerCycle: 9,
  producePerCycle: 4.5,
  cycleHours: 22,
  focusPerCycle: 100,
  useWater: true,
  seedSellPrice: 0,
  wormsPerCycle: 0.1,
  wormSellPrice: 500,
};

test("worms per cycle count per SLOT, not per crop", () => {
  close(calcFarmingEconomics(CROP).wormsPerCycle, 0.9, 1e-9, "9 slots x 0.1");
  close(calcFarmingEconomics({ ...CROP, wormsPerCycle: 0.2 }).wormsPerCycle, 1.8, 1e-9, "Premium");
});

test("worm revenue is taxed like any other sale", () => {
  const e = calcFarmingEconomics(CROP);
  close(e.wormRevenuePerCycle, 0.9 * 500 * (1 - PREMIUM_TAX), 1e-6, "worm revenue");
});

test("the worm leg lands in profit per cycle", () => {
  const withWorms = calcFarmingEconomics(CROP);
  const without = calcFarmingEconomics({ ...CROP, wormSellPrice: 0 });
  close(withWorms.profitPerCycle - without.profitPerCycle,
    0.9 * 500 * (1 - PREMIUM_TAX), 1e-6, "delta");
  assert.strictEqual(without.wormRevenuePerCycle, 0, "no listing, no silver");
});

test("hauling a worm out of Brecilien costs the Travel Planner fee", () => {
  const e = calcFarmingEconomics({ ...CROP, wormTravelCostPerWorm: 20 });
  close(e.wormRevenuePerCycle, 0.9 * (500 * (1 - PREMIUM_TAX) - 20), 1e-6, "net of travel");
});

test("a worm never pays the setup fee — it is a sale, not a purchase", () => {
  // Same shape as the surplus seed: sell-side only.
  const e = calcFarmingEconomics({ ...CROP, wormSellPrice: 1000 });
  close(e.wormRevenuePerCycle, 0.9 * 1000 * (1 - PREMIUM_TAX), 1e-6, "no 2.5% on the sell leg");
});

test("watering buys no worms — the delta is untouched by the leg", () => {
  const dry = calcFarmingEconomics({ ...CROP, wormSellPrice: 0 });
  const wormy = calcFarmingEconomics(CROP);
  close(wormy.wateringProfitDelta, dry.wateringProfitDelta, 1e-9, "delta");
});

test("byproducts ignore the worm inputs entirely", () => {
  const e = calcFarmingEconomics({
    type: "byproduct", seedPrice: 400, feedCount: 9, producePerCycle: 9,
    outputSellPrice: 390, yieldBonus: 0, plotsPerCycle: 1, cycleHours: 22,
    focusPerCycle: 0, useWater: true, wormsPerCycle: 0.2, wormSellPrice: 500,
  });
  assert.strictEqual(e.wormsPerCycle, 0);
  assert.strictEqual(e.wormRevenuePerCycle, 0);
});

test("no worm inputs at all → the leg is silently zero", () => {
  const { wormsPerCycle, wormSellPrice, ...bare } = CROP;
  const e = calcFarmingEconomics(bare);
  assert.strictEqual(e.wormsPerCycle, 0);
  assert.strictEqual(e.wormRevenuePerCycle, 0);
});

console.log("\n=== evaluateFarmingRow — the worm sells with the harvest ===");

function makeDeps(market) {
  const at = (side) => (id, c) => (market[id] && market[id][side] && market[id][side][c]) || 0;
  const buyAt = at("buy"), sellAt = at("sell");
  return {
    marketData: market,
    findBestBuyCity(md, id, cities) {
      let city = null, price = 0;
      (cities || []).forEach((c) => {
        const p = buyAt(id, c);
        if (p > 0 && (price === 0 || p < price)) { city = c; price = p; }
      });
      return { city, price, travelCost: 0 };
    },
    findBestSellCity(md, id, cities) {
      let city = null, price = 0;
      (cities || []).forEach((c) => {
        const p = sellAt(id, c);
        if (p > price) { city = c; price = p; }
      });
      return { city, price, travelCost: 0 };
    },
    getFarmingYieldBonus: () => 0,
    calcFarmingEconomics,
    getCityForce: () => null,
  };
}

const MARKET = {
  T6_FARM_POTATO_SEED: { buy: { Martlock: 15000 }, sell: { Martlock: 15000 } },
  T6_POTATO: { buy: {}, sell: { Martlock: 800 } },
  T1_WORM: { buy: {}, sell: { Martlock: 500, Caerleon: 900 } },
};

test("the worm leg is priced at the best sell city and reported", () => {
  const r = evaluateFarmingRow(POTATO, ["Martlock"], ["Martlock", "Caerleon"],
    { premium: false }, makeDeps(MARKET));
  assert.strictEqual(r.wormSell.city, "Caerleon");
  assert.strictEqual(r.wormSell.price, 900);
  close(r.econ.wormsPerCycle, 0.9, 1e-9, "worms per cycle");
  close(r.econ.wormRevenuePerCycle, 0.9 * 900 * (1 - PREMIUM_TAX), 1e-6, "worm revenue");
});

test("Premium doubles the worms the same cycle yields", () => {
  const free = evaluateFarmingRow(POTATO, ["Martlock"], ["Martlock"], { premium: false }, makeDeps(MARKET));
  const prem = evaluateFarmingRow(POTATO, ["Martlock"], ["Martlock"], { premium: true }, makeDeps(MARKET));
  close(prem.econ.wormsPerCycle, 2 * free.econ.wormsPerCycle, 1e-9, "worms double");
});

test("no worm listing leaves the leg blank and the cycle unchanged", () => {
  const market = { ...MARKET, T1_WORM: { buy: {}, sell: {} } };
  const r = evaluateFarmingRow(POTATO, ["Martlock"], ["Martlock"], { premium: false }, makeDeps(market));
  assert.strictEqual(r.wormSell.price, 0);
  assert.strictEqual(r.econ.wormRevenuePerCycle, 0);
});

test("a pasture row carries an empty worm leg", () => {
  const cow = FARMING_PRODUCTION.find((p) => p.outputId === "T8_MILK");
  const market = {
    T8_PUMPKIN: { buy: { Martlock: 400 }, sell: { Martlock: 400 } },
    T8_MILK: { buy: {}, sell: { Martlock: 390 } },
    T1_WORM: { buy: {}, sell: { Martlock: 500 } },
  };
  const r = evaluateFarmingRow(cow, ["Martlock"], ["Martlock"], { premium: true }, makeDeps(market));
  assert.strictEqual(r.wormSell.price, 0);
  assert.strictEqual(r.wormSell.city, null);
  assert.strictEqual(r.econ.wormRevenuePerCycle, 0);
});

console.log("\n=== the Farming scan fetches the worm price ===");

test("getFarmingItemIds includes T1_WORM", () => {
  const utilsSrc = ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"].map((n) => fs.readFileSync(path.join(ROOT, "js/" + n + ".js"), "utf8")).join("\n");
  const fn = utilsSrc.split("function getFarmingItemIds()")[1].split("\n}")[0];
  assert.ok(/FARM_WORM_ID|T1_WORM/.test(fn),
    "getFarmingItemIds must enumerate the worm or the row prices it at 0 forever");
});

console.log("\n=== the row shows the worm leg (source shape) ===");

const renderSrc = fs.readFileSync(path.join(ROOT, "js/render-farming.js"), "utf8");

test("the route cell renders a worm leg beside the seed leg", () => {
  assert.ok(renderSrc.includes("${renderFarmingSeedLeg(row)}${renderFarmingWormLeg(row)}"),
    "renderFarmingWormLeg must be printed in the route cell");
});

test("the worm leg is hidden when no worm silver is banked", () => {
  const fn = renderSrc.split("function renderFarmingWormLeg(row)")[1].split("\n}")[0];
  assert.ok(/if \(!\(row\.wormRevenuePerCycle > 0\)/.test(fn), "no revenue, no leg");
  assert.ok(/row\.sellWorm/.test(fn), "the leg names the city that buys the worms");
});

test("the row carries the worm fields the cell reads", () => {
  ["sellWorm:", "wormsPerCycle:", "wormRevenuePerCycle:"].forEach((field) => {
    assert.ok(renderSrc.includes(field), `row is missing ${field}`);
  });
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
