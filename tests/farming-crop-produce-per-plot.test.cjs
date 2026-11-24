/**
 * Test: a farmed seed yields 3-6 crops, not 1.
 *
 * Ground truth, ao-bin-dumps + Albion Wiki ("Farming"):
 *   items.xml   <farmableitem uniquename="T6_FARM_POTATO_SEED" ...>
 *                 <harvest lootlist="T6_POTATO_LOOT" ...>
 *                   <seed chance="0.8667" amount="1" />
 *   loot.xml    <Lootlist name="T6_POTATO_LOOT">
 *                 <Item type="T6_POTATO" chance="1.0" amount="3-6" />
 *                 <Item type="T1_WORM"   chance="0.1" amount="1" />
 *   wiki        "Each plot can plant 9 seeds ... Each harvested seed yields
 *                3-6 of its crop (6-12 with premium)."
 *
 * So one 9-slot plot is 9 seeds in, ~40.5 crops out (81 with Premium), and the
 * seed return is a separate per-slot roll (86.67% for potato — "usually one
 * seed back, sometimes none"). The old model booked ONE crop per slot, which
 * understated every crop and herb row by 4.5x (9x with Premium).
 *
 * Black box over the shipped modules. No market, no DOM.
 *
 * Run: node tests/farming-crop-produce-per-plot.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const { calcFarmingEconomics, PREMIUM_TAX, SETUP_FEE } = require("../js/calculations.js");
const { farmingProducePerCycle } = require("../js/farming-row-econ.js");

const dataSrc = fs.readFileSync(path.join(ROOT, "js/data-farming.js"), "utf8");
const dataMod = new Module("farming-data-produce-test");
dataMod._compile(`${dataSrc}\nmodule.exports = { FARMING_PRODUCTION };`, "data-farming.js");
const { FARMING_PRODUCTION } = dataMod.exports;

const itemsXml = fs.readFileSync(path.join(ROOT, "data", "dumps", "items.xml"), "utf8");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); failed++; }
}
function close(actual, expected, eps, label) {
  assert.ok(Math.abs(actual - expected) < eps,
    `${label}: expected ${expected}, got ${actual}`);
}

console.log("=== crop / herb catalog carries the 3-6 loot roll ===");

const PLANTS = FARMING_PRODUCTION.filter((p) => p.type === "crop" || p.type === "herb");

PLANTS.forEach((p) => {
  test(`${p.name}: producePerPlot is the 3-6 average`, () => {
    assert.strictEqual(p.producePerPlot, 4.5);
  });

  test(`${p.name}: 9 seed slots per plot`, () => {
    assert.strictEqual(p.plotsPerCycle, 9);
  });

  test(`${p.name}: baseSeedYield is the items.xml <seed chance>`, () => {
    const block = itemsXml.split(`uniquename="${p.id}"`)[1] || "";
    const chance = Number((block.match(/<seed chance="([\d.]+)"/) || [])[1]);
    const amount = Number((block.match(/<seed chance="[\d.]+" amount="(\d+)"/) || [])[1]);
    close(p.baseSeedYield, chance, 1e-9, "seed chance");
    assert.strictEqual(amount, 1, "one seed per proc");
  });
});

console.log("\n=== farmingProducePerCycle ===");

// Premium is +100% Product Yield — the same stat the city's +10% is — so the
// doubling lives in calcFarmingEconomics' additive yield sum (premiumBonus),
// and this helper is just the BASE average off the catalog.
const POTATO = FARMING_PRODUCTION.find((p) => p.id === "T6_FARM_POTATO_SEED");
const COW = FARMING_PRODUCTION.find((p) => p.type === "byproduct" && p.outputId === "T8_MILK");

test("crop: the base 3-6 average, premium not folded in", () => {
  close(farmingProducePerCycle(POTATO), 4.5, 1e-9, "base");
});

test("byproduct reads produceBase (7-11 roll → 9)", () => {
  close(farmingProducePerCycle(COW), 9, 1e-9, "base");
});

console.log("\n=== calcFarmingEconomics — crops per plot ===");

// Potato, watered, no city bonus: yield 113.34% (surplus), 9 slots.
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
};

test("outputs per cycle = slots x crops per seed", () => {
  close(calcFarmingEconomics(CROP).outputsPerCycle, 40.5, 1e-9, "free");
  close(calcFarmingEconomics({ ...CROP, premiumBonus: 1 }).outputsPerCycle, 81, 1e-9, "premium x2");
});

test("Premium and the city bonus sum once on the product leg", () => {
  // 4.5 x (1 + 1.0 + 0.10) = 9.45 a seed, 85.05 a cycle — additive, not the
  // 89.1 a chained x2-x1.1 would give.
  close(
    calcFarmingEconomics({ ...CROP, premiumBonus: 1, yieldBonus: 0.10 }).outputsPerCycle,
    85.05, 1e-9, "premium + city additive",
  );
});

test("profit per cycle collects every crop the slots yield", () => {
  const e = calcFarmingEconomics(CROP);
  // Yield > 100% and no seed market → no seed cost, no seed revenue.
  const expected = 40.5 * 800 * (1 - PREMIUM_TAX);
  close(e.profitPerCycle, expected, 1e-6, "profit per cycle");
});

test("profit per OUTPUT stays per crop, not per slot", () => {
  const e = calcFarmingEconomics(CROP);
  close(e.profitPerOutput, 800 * (1 - PREMIUM_TAX), 1e-6, "per crop");
  close(e.profitPerCycle, e.profitPerOutput * e.outputsPerCycle, 1e-6, "cycle = per crop x outputs");
});

test("a bought seed is charged once per SLOT and spread over its crops", () => {
  // Dry cabbage: 80% yield → 20% of a seed re-bought per slot, plus setup fee.
  const dry = {
    ...CROP,
    seedPrice: 10000, baseSeedYield: 0.80, wateringBonus: 0.40, useWater: false,
  };
  const e = calcFarmingEconomics(dry);
  const seedCostPerPlot = 0.2 * 10000 * (1 + SETUP_FEE);
  const expectedCycle = 9 * (4.5 * 800 * (1 - PREMIUM_TAX) - seedCostPerPlot);
  close(e.profitPerCycle, expectedCycle, 1e-6, "profit per cycle");
  close(e.netSeedCostPerOutput, (0.2 * 10000) / 4.5, 1e-9, "net seed cost per crop");
});

test("watering delta is still the seed leg alone — crops are unchanged by it", () => {
  const e = calcFarmingEconomics({ ...CROP, seedPrice: 10000, baseSeedYield: 0.60, wateringBonus: 0.80 });
  // Dry 60%, watered 140%: the delta is 40% of a seed saved plus 40% surplus
  // seed, and neither cycle's CROP revenue moves.
  close(e.wateringProfitDelta, 9 * 0.4 * 10000 * (1 + SETUP_FEE), 1e-6, "delta");
});

test("travel cost is charged per crop hauled, not per slot", () => {
  const plain = calcFarmingEconomics(CROP);
  const hauled = calcFarmingEconomics({ ...CROP, travelCostPerOutput: 10 });
  close(plain.profitPerCycle - hauled.profitPerCycle, 40.5 * 10, 1e-6, "40.5 crops hauled");
});

test("surplus seeds still count per SLOT, never per crop", () => {
  const e = calcFarmingEconomics({ ...CROP, seedSellPrice: 12000 });
  close(e.surplusSeedsPerCycle, 9 * 0.1334, 1e-9, "surplus seeds");
  close(e.seedRevenuePerCycle, 9 * 0.1334 * 12000 * (1 - PREMIUM_TAX), 1e-6, "seed revenue");
});

test("producePerCycle defaults to 1 when the caller omits it", () => {
  const { producePerCycle, ...noProduce } = CROP;
  assert.strictEqual(calcFarmingEconomics(noProduce).outputsPerCycle, 9);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
