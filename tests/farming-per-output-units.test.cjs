/**
 * Farming economics: the seed count behind the per-output cost
 * (calcFarmingEconomics, js/calculations.js).
 *
 * My Crafting List counts CROPS, so it needs the seed leg as a count per
 * harvested output, not just as silver. `seedsBoughtPerOutput` is that count,
 * and it has to reconcile exactly with the seed/feed term already inside
 * `netSeedCostPerOutput` — otherwise the shopping board and the row's own
 * Input Cost describe two different farms.
 *
 * Black-box over the pure calculator: synthetic prices, no market data.
 *
 * Run: node tests/farming-per-output-units.test.cjs
 */

const assert = require("assert");
const { calcFarmingEconomics } = require("../js/calculations.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// A crop under 100% seed yield (seeds are bought), the same crop over 100%
// (seeds are sold), and a pasture animal (feed is bought outright).
const CROP = {
  type: "crop", seedPrice: 300, outputSellPrice: 900,
  baseSeedYield: 0.5, wateringBonus: 0.25, plotsPerCycle: 9,
  producePerCycle: 4.5, cycleHours: 22,
};
const SURPLUS = { ...CROP, baseSeedYield: 1.1, wateringBonus: 0.2 };
const BYPRODUCT = {
  type: "byproduct", seedPrice: 400, feedCount: 9, producePerCycle: 9.5,
  outputSellPrice: 700, baseSeedYield: 0, wateringBonus: 0,
  plotsPerCycle: 1, cycleHours: 22,
};

console.log("\n=== seedsBoughtPerOutput is a count of the same seeds the cost prices ===");

// Under 100% yield the cost of one crop IS the seeds it needed (there is no
// surplus to net off), so count × price must land on netSeedCostPerOutput.
[["watered", true], ["dry", false]].forEach(([label, useWater]) => {
  test(`crop (${label}): count x seed price = the per-output seed cost`, () => {
    const e = calcFarmingEconomics({ ...CROP, useWater, seedSellPrice: 0 });
    assert.ok(e.seedsBoughtPerOutput > 0, "no seeds counted");
    near(e.seedsBoughtPerOutput * CROP.seedPrice, e.netSeedCostPerOutput, 1e-6);
  });
});

// Watering raises the seed return, so the SAME crop needs fewer bought seeds.
test("crop: watering lowers the seeds bought per output", () => {
  const on = calcFarmingEconomics({ ...CROP, useWater: true, seedSellPrice: 0 });
  const off = calcFarmingEconomics({ ...CROP, useWater: false, seedSellPrice: 0 });
  assert.ok(on.seedsBoughtPerOutput < off.seedsBoughtPerOutput,
    `${on.seedsBoughtPerOutput} !< ${off.seedsBoughtPerOutput}`);
});

// The reported shape: a T6 potato plot at ~96.7% yield over an 81-crop cycle.
// 9 slots x 3.3% of a seed each, spread over 81 crops.
test("crop: a near-self-sustaining plot buys a fraction of a seed per crop", () => {
  const e = calcFarmingEconomics({
    ...CROP, baseSeedYield: 0.8667, wateringBonus: 0.2667, useWater: false,
    producePerCycle: 9, seedSellPrice: 0,
  });
  near(e.outputsPerCycle, 81, 1e-9);
  near(e.seedsBoughtPerOutput, (1 - 0.8667) / 9, 1e-9);
  // 15,000 potatoes is ~222 seeds, never 15,000.
  assert.ok(e.seedsBoughtPerOutput * 15000 < 500);
});

// At or above 100% the plot re-seeds itself: nothing is bought, whatever the
// surplus sells for. The count must not go negative and turn into a "buy".
test("crop: a surplus plot buys no seed at all", () => {
  const e = calcFarmingEconomics({ ...SURPLUS, useWater: true, seedSellPrice: 250 });
  assert.strictEqual(e.seedsBoughtPerOutput, 0);
  assert.ok(e.netSeedCostPerOutput < 0, "a surplus plot should earn on seeds");
});

// A pasture animal eats feedCount crops per slot every cycle with no return
// leg, so the count is the feed spread over the produce.
test("byproduct: the count is the feed per output", () => {
  const e = calcFarmingEconomics({ ...BYPRODUCT, useWater: false });
  near(e.seedsBoughtPerOutput,
    (BYPRODUCT.feedCount * BYPRODUCT.plotsPerCycle) / e.outputsPerCycle, 1e-9);
  near(e.seedsBoughtPerOutput * BYPRODUCT.seedPrice, e.netSeedCostPerOutput, 1e-6);
});

// A city yield bonus adds produce for the same feed, so each egg costs less.
test("byproduct: a yield bonus lowers the feed per output", () => {
  const plain = calcFarmingEconomics({ ...BYPRODUCT, useWater: false });
  const bonus = calcFarmingEconomics({ ...BYPRODUCT, useWater: false, yieldBonus: 0.1 });
  assert.ok(bonus.seedsBoughtPerOutput < plain.seedsBoughtPerOutput);
});

// Nothing priced: the field is a number, never undefined — the list multiplies
// it by a quantity.
test("an unpriced row publishes 0, not undefined", () => {
  const e = calcFarmingEconomics({ ...CROP, seedPrice: 0, outputSellPrice: 0, useWater: false });
  assert.strictEqual(typeof e.seedsBoughtPerOutput, "number");
  assert.ok(Number.isFinite(e.seedsBoughtPerOutput));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
