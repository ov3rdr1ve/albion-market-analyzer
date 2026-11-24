/**
 * Test: surplus seeds are revenue, not zero.
 *
 * A farm plot returns seeds at rate (baseSeedYield + wateringBonus). The city
 * bonus is NOT in that sum - it is a product yield bonus (more crops out of the
 * same slot), which is what the in-game seed tooltip shows.
 * The old model priced the seed leg as `Math.max(0, 1 - yield) * seedPrice`, so
 * everything above 100% yield was worth exactly nothing. In game, yield over
 * 100% is a chance at a SECOND seed, and seeds are ordinary market items —
 * Albion Wiki "Island Farms": each 100% of seed yield always gives a seed, more
 * than 100% gives a chance of a second one.
 *
 * The clamp made watering look worthless for any crop/herb already self-
 * sustaining while dry (T7 Firetouched Mullein: dry 91.11%, watered 108.89%,
 * the surplus clamped to netSeed 0, so wateringProfitDelta lost the seeds
 * watering actually banks).
 *
 * The seed leg is now two-sided:
 *   deficit (yield < 1): (1 - yield) x seedPrice, buy side, pays SETUP_FEE
 *   surplus (yield > 1): (yield - 1) x (seedSellPrice x (1 - PREMIUM_TAX)
 *                                       - seedTravelCostPerSeed), booked as
 *                        revenue (a negative net seed cost), no setup fee
 *
 * Black box over the shipped module; no market data, no DOM, no live calls.
 *
 * Run: node tests/farming-seed-surplus.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  calcFarmingEconomics,
  PREMIUM_TAX,
  SETUP_FEE,
} = require("../js/calculations.js");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);

// Deficit row: 0.50 + 0.25 = 75% yield, seed cost applies.
const DEFICIT = {
  type: "crop", seedPrice: 300, outputSellPrice: 900,
  baseSeedYield: 0.5, wateringBonus: 0.25, plotsPerCycle: 9, cycleHours: 22,
  focusPerCycle: 100,
};
// Surplus row: 0.90 + 0.30 = 120% yield, seeds come back over par. No city
// bonus here on purpose - the city never reaches the seed leg, and a non-zero
// yieldBonus would only scale the crop count and blur these figures.
const SURPLUS = {
  type: "crop", seedPrice: 1000, outputSellPrice: 400,
  baseSeedYield: 0.9, wateringBonus: 0.3, yieldBonus: 0,
  plotsPerCycle: 9, cycleHours: 22, focusPerCycle: 100,
  seedSellPrice: 800,
};

console.log("\n=== the deficit branch is untouched ===");

test("yield < 100%: seedSellPrice changes nothing", () => {
  const without = calcFarmingEconomics({ ...DEFICIT });
  const withSeed = calcFarmingEconomics({ ...DEFICIT, seedSellPrice: 5000 });
  assert.strictEqual(without.profitPerCycle, withSeed.profitPerCycle);
  assert.strictEqual(without.netSeedCostPerOutput, withSeed.netSeedCostPerOutput);
  assert.strictEqual(without.wateringProfitDelta, withSeed.wateringProfitDelta);
});

test("yield < 100%: net seed cost is still (1 - yield) x seedPrice", () => {
  const e = calcFarmingEconomics({ ...DEFICIT });
  close(e.netSeedCostPerOutput, 0.25 * 300, 1e-9, "deficit seed cost");
});

test("yield < 100%: no surplus is published", () => {
  const e = calcFarmingEconomics({ ...DEFICIT, seedSellPrice: 5000 });
  assert.strictEqual(e.surplusSeedsPerCycle, 0);
  assert.strictEqual(e.seedRevenuePerCycle, 0);
});

console.log("\n=== the surplus branch is revenue ===");

test("yield > 100%: net seed cost goes negative", () => {
  const e = calcFarmingEconomics({ ...SURPLUS });
  assert.ok(e.netSeedCostPerOutput < 0,
    `expected surplus to book as revenue, got ${e.netSeedCostPerOutput}`);
});

test("yield > 100%: the cycle beats the same row with no seed market", () => {
  const sold = calcFarmingEconomics({ ...SURPLUS });
  const dead = calcFarmingEconomics({ ...SURPLUS, seedSellPrice: 0 });
  assert.ok(sold.profitPerCycle > dead.profitPerCycle,
    "selling the surplus must be worth more than throwing it away");
});

test("surplus revenue = (yield - 1) x plots x (price x (1 - tax) - travel)", () => {
  const travel = 12;
  const e = calcFarmingEconomics({ ...SURPLUS, seedTravelCostPerSeed: travel });
  const perSeedNet = 800 * (1 - PREMIUM_TAX) - travel;
  close(e.seedRevenuePerCycle, 0.2 * 9 * perSeedNet, 1e-6, "surplus revenue");
  close(e.surplusSeedsPerCycle, 0.2 * 9, 1e-9, "surplus seeds");
});

test("the surplus never pays the buy-side setup fee", () => {
  // perOutput = revenue - netSeed x (1 + SETUP_FEE). If the surplus ran through
  // that fee it would be INFLATED by 2.5%, not spared it.
  const e = calcFarmingEconomics({ ...SURPLUS });
  const revenuePerOutput = 400 * (1 - PREMIUM_TAX);
  const seedRevPerOutput = 0.2 * 800 * (1 - PREMIUM_TAX);
  close(e.profitPerOutput, revenuePerOutput + seedRevPerOutput, 1e-6, "per-output profit");
  assert.ok(
    Math.abs(e.profitPerOutput - (revenuePerOutput + seedRevPerOutput * (1 + SETUP_FEE))) > 1e-6,
    "the surplus must not be scaled by the setup fee",
  );
});

test("no seed market: yield > 100% reproduces the old clamped figures", () => {
  const e = calcFarmingEconomics({ ...SURPLUS, seedSellPrice: 0 });
  assert.strictEqual(e.netSeedCostPerOutput, 0);
  close(e.profitPerCycle, 400 * (1 - PREMIUM_TAX) * 9, 1e-6, "clamped cycle");
  assert.strictEqual(e.seedRevenuePerCycle, 0);
});

test("a seed sell price below the travel fee is a loss, and is kept as one", () => {
  const e = calcFarmingEconomics({ ...SURPLUS, seedSellPrice: 10, seedTravelCostPerSeed: 500 });
  assert.ok(e.seedRevenuePerCycle < 0, "hauling surplus at a loss is a real answer");
});

console.log("\n=== the two branches meet at exactly 100% ===");

test("yield exactly 1.0: net seed cost is 0 whatever the seed prices", () => {
  const e = calcFarmingEconomics({
    ...SURPLUS, baseSeedYield: 0.8, wateringBonus: 0.2, yieldBonus: 0,
  });
  assert.strictEqual(e.netSeedCostPerOutput, 0);
  assert.strictEqual(e.surplusSeedsPerCycle, 0);
});

test("approaching 100% from below and above converges", () => {
  const base = { ...SURPLUS, wateringBonus: 0, yieldBonus: 0 };
  const below = calcFarmingEconomics({ ...base, baseSeedYield: 0.9999 });
  const above = calcFarmingEconomics({ ...base, baseSeedYield: 1.0001 });
  close(below.profitPerCycle, above.profitPerCycle, 5, "continuity across 100%");
});

console.log("\n=== the reported bug: T7 Firetouched Mullein ===");

// Real row from the table: Thetford buy (+10% bonus city), seed 25,995,
// mullein 512. Dry 91.11%, watered 108.89% - the numbers the game prints, and
// the ones the old model returned 0 profit on. The city's +10% is deliberately
// absent from the seed legs: it lands on the crop count instead, so it is set
// here only where a test needs the harvest.
const MULLEIN = {
  type: "herb", seedPrice: 25995, outputSellPrice: 512,
  baseSeedYield: 0.9111, wateringBonus: 0.1778, yieldBonus: 0,
  plotsPerCycle: 9, cycleHours: 22, focusPerCycle: 100,
  seedSellPrice: 25995,
};

test("watering a self-sustaining herb is worth real silver", () => {
  const e = calcFarmingEconomics(MULLEIN);
  assert.ok(e.wateringProfitDelta > 0,
    `watering must not price to 0 above 100% yield, got ${e.wateringProfitDelta}`);
});

test("the delta is the seeds watering saves plus the seeds it banks", () => {
  // Watering carries this plot ACROSS 100%, so the delta has two halves:
  // dry it re-buys 8.89% of a seed a plot (setup fee on top), watered it sells
  // 8.89% of a seed a plot (sales tax off).
  const e = calcFarmingEconomics(MULLEIN);
  const shortfall = 1 - 0.9111;
  const bought = shortfall * 25995 * (1 + SETUP_FEE);
  const sold = shortfall * 25995 * (1 - PREMIUM_TAX);
  close(e.wateringProfitDelta, (bought + sold) * 9, 1e-6, "watering delta");
});

test("the seed leg dwarfs the crop leg at these prices", () => {
  const e = calcFarmingEconomics(MULLEIN);
  const cropRevenue = 9 * 512 * (1 - PREMIUM_TAX);
  assert.ok(e.seedRevenuePerCycle > cropRevenue * 4,
    `a T7 herb plot is a seed business: seeds ${e.seedRevenuePerCycle} vs crops ${cropRevenue}`);
});

test("the +10% city adds crops to this row, and no seeds at all", () => {
  const plain = calcFarmingEconomics(MULLEIN);
  const bonus = calcFarmingEconomics({ ...MULLEIN, yieldBonus: 0.10 });
  assert.strictEqual(bonus.totalSeedYield, plain.totalSeedYield);
  assert.strictEqual(bonus.surplusSeedsPerCycle, plain.surplusSeedsPerCycle);
  close(bonus.outputsPerCycle, plain.outputsPerCycle * 1.10, 1e-9, "crops");
});

test("the marginal rate is still delta / focus", () => {
  const e = calcFarmingEconomics(MULLEIN);
  assert.strictEqual(e.profitPerFocus, e.wateringProfitDelta / 100);
});

console.log("\n=== byproducts are untouched ===");

const BYPRODUCT = {
  type: "byproduct", seedPrice: 400, feedCount: 9, producePerCycle: 9.5,
  outputSellPrice: 700,
  baseSeedYield: 0, wateringBonus: 0, yieldBonus: 0.1,
  plotsPerCycle: 1, cycleHours: 22, focusPerCycle: 100,
};

test("a pasture animal ignores seedSellPrice entirely", () => {
  const plain = calcFarmingEconomics({ ...BYPRODUCT });
  const withSeed = calcFarmingEconomics({
    ...BYPRODUCT, seedSellPrice: 9999, seedTravelCostPerSeed: 7,
  });
  assert.strictEqual(plain.profitPerCycle, withSeed.profitPerCycle);
  assert.strictEqual(plain.netSeedCostPerOutput, withSeed.netSeedCostPerOutput);
});

test("a pasture animal publishes no surplus", () => {
  const e = calcFarmingEconomics({ ...BYPRODUCT, seedSellPrice: 9999 });
  assert.strictEqual(e.surplusSeedsPerCycle, 0);
  assert.strictEqual(e.seedRevenuePerCycle, 0);
});

test("the byproduct input leg is the feed bill spread over the produce", () => {
  const e = calcFarmingEconomics({ ...BYPRODUCT });
  close(e.netSeedCostPerOutput, (9 * 400) / (9.5 * 1.1), 1e-9, "byproduct feed cost");
});

console.log("\n=== the focus-ON twin still ignores the Use Focus checkbox ===");

[["surplus crop", SURPLUS], ["mullein", MULLEIN], ["byproduct", BYPRODUCT]].forEach(([label, base]) => {
  test(`${label}: profitPerCycleFocusOn is identical with useWater on and off`, () => {
    const on = calcFarmingEconomics({ ...base, useWater: true });
    const off = calcFarmingEconomics({ ...base, useWater: false });
    assert.strictEqual(on.profitPerCycleFocusOn, off.profitPerCycleFocusOn);
  });
});

test("surplus crop: the displayed cycle DOES follow useWater", () => {
  const on = calcFarmingEconomics({ ...SURPLUS, useWater: true });
  const off = calcFarmingEconomics({ ...SURPLUS, useWater: false });
  assert.notStrictEqual(on.profitPerCycle, off.profitPerCycle);
});

test("surplus seeds are reported for the DISPLAYED cycle, not the watered one", () => {
  const off = calcFarmingEconomics({ ...SURPLUS, useWater: false });
  close(off.surplusSeedsPerCycle, 0, 1e-9, "dry 100% yield has no surplus");
});

console.log("\n=== degenerate inputs ===");

test("no prices at all: 0 profit, no NaN", () => {
  const e = calcFarmingEconomics({
    ...SURPLUS, seedPrice: 0, outputSellPrice: 0, seedSellPrice: 0,
  });
  assert.ok(Number.isFinite(e.profitPerCycle));
  assert.ok(Number.isFinite(e.wateringProfitDelta));
  assert.strictEqual(e.profitPerCycle, 0);
});

test("negative seed sell price is treated as no market", () => {
  const e = calcFarmingEconomics({ ...SURPLUS, seedSellPrice: -50 });
  assert.strictEqual(e.seedRevenuePerCycle, 0);
});

console.log("\n=== the renderer wires the seed sale up ===");

const renderSrc = read("js/render-farming.js");
// The per-city legs moved out of the renderer when the farm city started being
// chosen on cycle profit instead of seed price — same wiring, new home.
const econSrc = read("js/farming-row-econ.js");

test("the seed's own sell city is resolved with the shared helper", () => {
  assert.ok(/findBestSellCity\(\s*marketData,\s*item\.id/.test(econSrc),
    "farming-row-econ must price the SEED's sale, not only the crop's");
});

test("both surplus inputs reach calcFarmingEconomics", () => {
  ["seedSellPrice:", "seedTravelCostPerSeed:"].forEach((field) => {
    assert.ok(econSrc.includes(field), `farming-row-econ does not pass ${field}`);
  });
});

test("the margin denominator is clamped so surplus cannot invert it", () => {
  assert.ok(/Math\.max\(0,\s*econ\.netSeedCostPerOutput\)/.test(renderSrc),
    "a negative net seed cost would flip the margin's sign");
});

test("the yield cell distinguishes surplus from break-even", () => {
  assert.ok(/surplus/i.test(renderSrc), "the yield cell must name the surplus");
  assert.ok(renderSrc.includes("self-sustaining"),
    "exactly 100% is still self-sustaining");
});

console.log("\n" + "=".repeat(50));
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
