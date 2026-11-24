/**
 * Test: CITY_FARM_SPEC table + getFarmingYieldBonus + calcFarmingEconomics.
 *
 * Source: Albion Wiki "Island Farms" + "Local Production Bonus"
 * (verified 2026-05-17). Each Royal City boosts one crop, one herb, and
 * one livestock byproduct by +10% (Caerleon = 3 herbs, Brecilien = all 8
 * crops). Two cities boost two-meat byproducts (Fort Sterling = eggs + milk,
 * via T3 chicken eggs and T6 sheep milk).
 *
 * The +10% in farming context is a PRODUCT yield bonus: 10% more crops or
 * herbs out of the same planted slot, and 10% more eggs/milk out of the same
 * pasture cycle. It does NOT raise the seed return. The in-game seed tooltip
 * (Firetouched Mullein Seeds on a Thetford island, Local bonus active) reads
 * "Local: +10% Product Yield" beside "Watering: +17.78% Seed Yield", and
 * prints Seed Yield 91.11% — the bare baseSeedYield, city bonus and all.
 *
 * Run: node tests/farming-city-bonus.test.cjs
 */

const assert = require("assert");
const {
  CITY_FARM_SPEC,
  FARMING_SPEC_BONUS,
  getFarmingYieldBonus,
  calcFarmingEconomics,
} = require("../js/calculations.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

console.log("\n=== CITY_FARM_SPEC table coverage ===");

const EXPECTED_CROPS = {
  T1_CARROT: ["Lymhurst", "Brecilien"],
  T2_BEAN: ["Bridgewatch", "Brecilien"],
  T3_WHEAT: ["Martlock", "Brecilien"],
  T4_TURNIP: ["Fort Sterling", "Brecilien"],
  T5_CABBAGE: ["Thetford", "Brecilien"],
  T6_POTATO: ["Martlock", "Brecilien"],
  T7_CORN: ["Bridgewatch", "Brecilien"],
  T8_PUMPKIN: ["Lymhurst", "Brecilien"],
};

Object.entries(EXPECTED_CROPS).forEach(([cropId, cities]) => {
  cities.forEach((city) => {
    test(`${city} boosts crop ${cropId}`, () => {
      const specs = CITY_FARM_SPEC[city] || {};
      assert.ok(
        (specs.crops || []).includes(cropId),
        `expected ${city}.crops to include ${cropId}; got ${JSON.stringify(specs.crops)}`,
      );
    });
  });
});

const EXPECTED_HERBS = {
  T2_AGARIC: ["Thetford"],
  T3_COMFREY: ["Caerleon"],
  T4_BURDOCK: ["Lymhurst"],
  T5_TEASEL: ["Bridgewatch", "Caerleon"],
  T6_FOXGLOVE: ["Martlock"],
  T7_MULLEIN: ["Thetford", "Caerleon"],
  T8_YARROW: ["Fort Sterling"],
};

Object.entries(EXPECTED_HERBS).forEach(([herbId, cities]) => {
  cities.forEach((city) => {
    test(`${city} boosts herb ${herbId}`, () => {
      const specs = CITY_FARM_SPEC[city] || {};
      assert.ok(
        (specs.herbs || []).includes(herbId),
        `expected ${city}.herbs to include ${herbId}; got ${JSON.stringify(specs.herbs)}`,
      );
    });
  });
});

const EXPECTED_BYPRODUCTS = {
  T3_EGG: ["Fort Sterling"],       // Hen Eggs
  T4_MILK: ["Bridgewatch"],        // Goat's Milk
  T5_EGG: ["Lymhurst"],            // Goose Eggs
  T6_MILK: ["Fort Sterling"],      // Sheep's Milk (FS gets BOTH T3 egg + T6 milk)
  T8_MILK: ["Martlock"],           // Cow's Milk
};

Object.entries(EXPECTED_BYPRODUCTS).forEach(([byId, cities]) => {
  cities.forEach((city) => {
    test(`${city} boosts byproduct ${byId}`, () => {
      const specs = CITY_FARM_SPEC[city] || {};
      assert.ok(
        (specs.byproducts || []).includes(byId),
        `expected ${city}.byproducts to include ${byId}; got ${JSON.stringify(specs.byproducts)}`,
      );
    });
  });
});

test("FARMING_SPEC_BONUS = 0.10 (per wiki +10%)", () => {
  assert.strictEqual(FARMING_SPEC_BONUS, 0.10);
});

console.log("\n=== getFarmingYieldBonus ===");

test("Lymhurst + T1_CARROT -> +0.10 bonus", () => {
  assert.strictEqual(getFarmingYieldBonus("Lymhurst", "T1_CARROT"), 0.10);
});

test("Brecilien boosts EVERY crop (T1-T8)", () => {
  ["T1_CARROT","T2_BEAN","T3_WHEAT","T4_TURNIP","T5_CABBAGE","T6_POTATO","T7_CORN","T8_PUMPKIN"]
    .forEach((cropId) => {
      assert.strictEqual(getFarmingYieldBonus("Brecilien", cropId), 0.10,
        `Brecilien should boost ${cropId}`);
    });
});

test("Thetford + T1_CARROT (no spec) -> 0 bonus", () => {
  assert.strictEqual(getFarmingYieldBonus("Thetford", "T1_CARROT"), 0);
});

test("Caerleon + T3_COMFREY -> +0.10 (3-herb capital)", () => {
  assert.strictEqual(getFarmingYieldBonus("Caerleon", "T3_COMFREY"), 0.10);
});

test("Fort Sterling + T3_EGG -> +0.10 (FS hen eggs)", () => {
  assert.strictEqual(getFarmingYieldBonus("Fort Sterling", "T3_EGG"), 0.10);
});

test("Fort Sterling + T6_MILK -> +0.10 (FS sheep milk too)", () => {
  assert.strictEqual(getFarmingYieldBonus("Fort Sterling", "T6_MILK"), 0.10);
});

test("Unknown city -> 0 bonus (no crash)", () => {
  assert.strictEqual(getFarmingYieldBonus("Atlantis", "T1_CARROT"), 0);
});

test("null outputId -> 0 bonus (no crash)", () => {
  assert.strictEqual(getFarmingYieldBonus("Lymhurst", null), 0);
});

test("undefined city -> 0 bonus (no crash)", () => {
  assert.strictEqual(getFarmingYieldBonus(undefined, "T1_CARROT"), 0);
});

console.log("\n=== calcFarmingEconomics — crop/herb ===");

// Canonical wiki entry: Carrots = base 0% + watering 200% = 200% seed yield.
// Lymhurst's +10% does not join that sum — it buys 10% more carrots instead.
test("Carrot at Lymhurst with watering: 200% seed yield, city off the seed leg", () => {
  const r = calcFarmingEconomics({
    type: "crop",
    seedPrice: 2000,
    outputSellPrice: 100,
    baseSeedYield: 0,
    wateringBonus: 2.00,
    yieldBonus: 0.10,           // Lymhurst boost
    plotsPerCycle: 9,
    cycleHours: 22,
    focusPerCycle: 100,
    useWater: true,
  });
  // total seed yield 200% >= 100% => seed economy is sustainable, no net cost
  assert.strictEqual(r.totalSeedYield, 2.00);
  assert.strictEqual(r.netSeedCostPerOutput, 0, "200% yield should make net seed cost zero");
  // The bonus shows up on the harvest instead: 9 plots × 1 crop × 1.10.
  assert.ok(Math.abs(r.outputsPerCycle - 9.9) < 1e-9);
});

test("Carrot at Lymhurst no water: 0% seed yield, city buys crops not seeds", () => {
  const r = calcFarmingEconomics({
    type: "crop",
    seedPrice: 2000,
    outputSellPrice: 100,
    baseSeedYield: 0,
    wateringBonus: 2.00,
    yieldBonus: 0.10,
    plotsPerCycle: 9,
    cycleHours: 22,
    focusPerCycle: 100,
    useWater: false,            // no watering -> no watering bonus
  });
  assert.strictEqual(r.totalSeedYield, 0);
  // One seed is re-bought per SLOT, and the bonus spreads it over 1.10 crops:
  // (1 - 0) × 2000 ÷ 1.10 = 1818.18 per crop.
  assert.ok(Math.abs(r.netSeedCostPerOutput - 2000 / 1.1) < 1e-9);
});

test("Carrot at Thetford (no farm spec) with watering: 200% yield exactly", () => {
  const r = calcFarmingEconomics({
    type: "crop",
    seedPrice: 2000,
    outputSellPrice: 100,
    baseSeedYield: 0,
    wateringBonus: 2.00,
    yieldBonus: 0,              // Thetford has no carrot spec
    plotsPerCycle: 9,
    cycleHours: 22,
    focusPerCycle: 100,
    useWater: true,
  });
  assert.strictEqual(r.totalSeedYield, 2.00);
  assert.strictEqual(r.netSeedCostPerOutput, 0);
});

test("Pumpkin at Lymhurst with water: 93.33%+13.33%=106.66% (surplus, free seed)", () => {
  const r = calcFarmingEconomics({
    type: "crop",
    seedPrice: 30000,
    outputSellPrice: 800,
    baseSeedYield: 0.9333,
    wateringBonus: 0.1333,
    yieldBonus: 0.10,
    plotsPerCycle: 9,
    cycleHours: 22,
    focusPerCycle: 100,
    useWater: true,
  });
  assert.ok(Math.abs(r.totalSeedYield - 1.0666) < 1e-3,
    `expected 106.66%, got ${(r.totalSeedYield * 100).toFixed(2)}%`);
  assert.strictEqual(r.netSeedCostPerOutput, 0);
});

test("calcFarmingEconomics: profit/cycle scales by plotsPerCycle", () => {
  const r = calcFarmingEconomics({
    type: "crop",
    seedPrice: 0,                // free seeds for clarity
    outputSellPrice: 100,
    baseSeedYield: 2,            // surplus
    wateringBonus: 0,
    yieldBonus: 0,
    plotsPerCycle: 9,
    cycleHours: 22,
    focusPerCycle: 100,
    useWater: true,
  });
  // Revenue per crop = 100 × (1 - PREMIUM_TAX 0.065) = 93.5
  // Profit per crop = 93.5 (no input cost)
  // Profit per cycle = 93.5 × 9 plots = 841.5
  const expectedProfitPerCrop = 100 * (1 - 0.065);
  assert.ok(Math.abs(r.profitPerOutput - expectedProfitPerCrop) < 0.01);
  assert.ok(Math.abs(r.profitPerCycle - expectedProfitPerCrop * 9) < 0.01);
});

test("calcFarmingEconomics: profit/day extrapolates from cycle hours", () => {
  const r = calcFarmingEconomics({
    type: "crop",
    seedPrice: 0,
    outputSellPrice: 100,
    baseSeedYield: 2,
    wateringBonus: 0,
    yieldBonus: 0,
    plotsPerCycle: 9,
    cycleHours: 22,
    focusPerCycle: 100,
    useWater: true,
  });
  // cyclesPerDay = 24 / 22 ≈ 1.0909
  // profit/day = profit/cycle × cyclesPerDay
  assert.ok(Math.abs(r.profitPerDay - r.profitPerCycle * (24 / 22)) < 0.01);
});

// Silver/Focus is MARGINAL everywhere (js/focus-play.js): what the WATERING focus
// itself buys, i.e. the profit a watered cycle makes over the same plot left dry,
// over the focus it costs. It is NOT profit/cycle ÷ focus — that average credits
// focus with the crop's whole profit, most of which a dry plot earns anyway.
test("calcFarmingEconomics: silver/focus = watering delta / focusPerCycle", () => {
  const r = calcFarmingEconomics({
    type: "crop",
    seedPrice: 400,
    outputSellPrice: 100,
    baseSeedYield: 0.60,
    wateringBonus: 0.80,
    yieldBonus: 0,
    plotsPerCycle: 9,
    cycleHours: 22,
    focusPerCycle: 100,
    useWater: true,
  });
  assert.ok(r.wateringProfitDelta > 0, "watering must add profit at these prices");
  assert.ok(Math.abs(r.profitPerFocus - r.wateringProfitDelta / 100) < 1e-9);
  // The delta is the seed cost watering removes: 9 plots × (1−0.6)×400 seed, plus
  // setup — nothing to do with the crop's sale value, which both cycles collect.
  assert.ok(Math.abs(r.wateringProfitDelta - 9 * 0.4 * 400 * 1.025) < 1e-6);
});

test("calcFarmingEconomics: a free seed makes watering worth nothing", () => {
  // Watering only ever saves the seed you would otherwise re-buy. Seed price 0 →
  // nothing to save, so focus buys nothing here however profitable the crop is.
  const r = calcFarmingEconomics({
    type: "crop",
    seedPrice: 0,
    outputSellPrice: 100,
    baseSeedYield: 0.60,
    wateringBonus: 0.80,
    yieldBonus: 0,
    plotsPerCycle: 9,
    cycleHours: 22,
    focusPerCycle: 100,
    useWater: true,
  });
  assert.ok(r.profitPerCycle > 0, "the crop is profitable");
  assert.strictEqual(r.wateringProfitDelta, 0);
  assert.strictEqual(r.profitPerFocus, 0);
});

test("calcFarmingEconomics: a self-sustaining plot cannot bank more watering value", () => {
  // Yield already ≥ 100% without watering → no seed is ever re-bought, so the
  // watering bonus has nothing left to save.
  const r = calcFarmingEconomics({
    type: "crop",
    seedPrice: 400,
    outputSellPrice: 100,
    baseSeedYield: 1.2,
    wateringBonus: 0.80,
    yieldBonus: 0,
    plotsPerCycle: 9,
    cycleHours: 22,
    focusPerCycle: 100,
    useWater: true,
  });
  assert.strictEqual(r.wateringProfitDelta, 0);
});

test("calcFarmingEconomics: no-water mode skips focus & watering bonus", () => {
  const r = calcFarmingEconomics({
    type: "crop",
    seedPrice: 0,
    outputSellPrice: 100,
    baseSeedYield: 0,
    wateringBonus: 2.00,        // would be 200% if useWater
    yieldBonus: 0,
    plotsPerCycle: 9,
    cycleHours: 22,
    focusPerCycle: 100,
    useWater: false,
  });
  assert.strictEqual(r.totalSeedYield, 0, "no watering -> no bonus");
  // Silver/Focus is a focus-ON benchmark in every table, so it does NOT collapse
  // to 0 with the checkbox: it keeps answering "what would watering buy me here?"
  // while the DISPLAYED cycle stays dry. Seed is free in this fixture, so the
  // honest answer happens to be 0 — see the free-seed case above.
  assert.ok(Math.abs(r.profitPerFocus - r.wateringProfitDelta / 100) < 1e-9);
});

// Pinned to the in-game tooltip, Firetouched Mullein Seeds on a Thetford
// island with the Local bonus active (screenshot, 2026-09-05):
//   Local:    +10%    Product Yield
//   Premium:  +100%   Product Yield
//   Watering: +17.78% Seed Yield
//   Seed Yield: 91.11%
// The city bonus is nowhere in that 91.11%, which is exactly the catalog's
// baseSeedYield for T7_FARM_MULLEIN_SEED (js/data-farming.js).
const MULLEIN = { baseSeedYield: 0.9111, wateringBonus: 0.1778 };
const mullein = (over) => calcFarmingEconomics(Object.assign({
  type: "herb",
  seedPrice: 12000,
  outputSellPrice: 900,
  baseSeedYield: MULLEIN.baseSeedYield,
  wateringBonus: MULLEIN.wateringBonus,
  yieldBonus: 0.10,           // Thetford / Caerleon herb spec
  producePerCycle: 4.5,
  plotsPerCycle: 9,
  cycleHours: 22,
  focusPerCycle: 1125,
  useWater: true,
}, over));

test("Mullein dry at Thetford: 91.11% seed yield, the game's number", () => {
  const r = mullein({ useWater: false });
  assert.strictEqual(r.totalSeedYield, 0.9111);
});

test("Mullein watered at Thetford: 108.89%, watering alone carries it over 100%", () => {
  const r = mullein({});
  assert.ok(Math.abs(r.totalSeedYield - 1.0889) < 1e-9,
    `expected 108.89%, got ${(r.totalSeedYield * 100).toFixed(2)}%`);
  assert.ok(Math.abs(r.wateredSeedYield - 1.0889) < 1e-9);
});

test("Mullein: the bonus city changes crops, never the seed yield", () => {
  const bonus = mullein({});
  const plain = mullein({ yieldBonus: 0 });
  assert.strictEqual(bonus.totalSeedYield, plain.totalSeedYield);
  assert.strictEqual(bonus.wateredSeedYield, plain.wateredSeedYield);
  assert.ok(Math.abs(bonus.outputsPerCycle - plain.outputsPerCycle * 1.10) < 1e-9,
    `expected 1.10x the crops, got ${bonus.outputsPerCycle} vs ${plain.outputsPerCycle}`);
});

test("Mullein: Premium alone doubles the product leg", () => {
  // The caller passes the BASE 4.5 plus premiumBonus: 4.5 x (1 + 1.0) = 9 a
  // plot, 81 a cycle — the 6-12 roll. Outside the spec city (yieldBonus 0).
  const r = mullein({ premiumBonus: 1, yieldBonus: 0 });
  assert.ok(Math.abs(r.outputsPerCycle - 81) < 1e-9,
    `expected 81 crops a cycle, got ${r.outputsPerCycle}`);
});

test("Mullein: Premium and the city bonus stack ADDITIVELY on the product leg", () => {
  // Local +10% and Premium +100% are the same stat on the tooltip, summed
  // once: 4.5 x (1 + 1.0 + 0.10) = 9.45 a plot, 85.05 a cycle — not the
  // 89.1 a chained x2-x1.1 would print.
  const r = mullein({ premiumBonus: 1 });
  assert.ok(Math.abs(r.outputsPerCycle - 85.05) < 1e-9,
    `expected 85.05 crops a cycle, got ${r.outputsPerCycle}`);
});

test("Mullein: the city bonus rides the dry cycle too — with focus and without", () => {
  // The +10% is a product-yield bonus, so it lands on the watered AND the dry
  // cycle alike, while the seed leg stays base + watering in both.
  const dryBonus = mullein({ useWater: false });
  const dryPlain = mullein({ useWater: false, yieldBonus: 0 });
  const wetBonus = mullein({});

  assert.ok(Math.abs(dryBonus.outputsPerCycle - dryPlain.outputsPerCycle * 1.10) < 1e-9,
    `expected 1.10x crops dry, got ${dryBonus.outputsPerCycle} vs ${dryPlain.outputsPerCycle}`);
  assert.strictEqual(dryBonus.totalSeedYield, dryPlain.totalSeedYield,
    "the city bonus never touches the dry seed yield");
  assert.strictEqual(wetBonus.totalSeedYield, mullein({ yieldBonus: 0 }).totalSeedYield,
    "the city bonus never touches the watered seed yield either");

  // Both cycles scale by the same 1.10, so what watering buys is invariant
  // to the bonus city: the delta is the seed leg alone, in both cities.
  const wetPlain = mullein({ yieldBonus: 0 });
  assert.ok(Math.abs(wetBonus.wateringProfitDelta - wetPlain.wateringProfitDelta) < 1e-6,
    `watering delta moved with the city: ${wetBonus.wateringProfitDelta} vs ${wetPlain.wateringProfitDelta}`);
});

test("Mullein outside a spec city: both legs untouched", () => {
  const r = mullein({ yieldBonus: 0 });
  assert.ok(Math.abs(r.totalSeedYield - 1.0889) < 1e-9);
  assert.ok(Math.abs(r.outputsPerCycle - 40.5) < 1e-9, "9 plots x 4.5 crops");
});


console.log("\n=== calcFarmingEconomics — animal byproduct ===");

// Animal byproduct path: a GROWN animal eats 9 crops and hands over its
// produce every 22h without being consumed (the city bonus adds +10% produce,
// and never costs extra feed).
test("Hen Eggs at Fort Sterling: +10% yield -> 10.45 eggs per cycle", () => {
  const r = calcFarmingEconomics({
    type: "byproduct",
    seedPrice: 400,             // one feed crop
    feedCount: 9,
    producePerCycle: 9.5,
    outputSellPrice: 80,        // egg sell
    yieldBonus: 0.10,           // FS hen eggs spec
    plotsPerCycle: 1,           // one animal per slot
    cycleHours: 22,             // the produce cycle
    focusPerCycle: 0,           // feeding a grown animal costs no focus
    useWater: true,
  });
  assert.ok(Math.abs(r.totalSeedYield - 1.10) < 1e-9);
  assert.ok(Math.abs(r.outputsPerCycle - 10.45) < 1e-9);
  // Net per-output cost = feed bill / produce = 3600 / 10.45
  assert.ok(Math.abs(r.netSeedCostPerOutput - 3600 / 10.45) < 0.01);
});

test("Hen Eggs at Thetford (no spec): 9.5 eggs on the same feed bill", () => {
  const r = calcFarmingEconomics({
    type: "byproduct",
    seedPrice: 400,
    feedCount: 9,
    producePerCycle: 9.5,
    outputSellPrice: 80,
    yieldBonus: 0,
    plotsPerCycle: 1,
    cycleHours: 22,
    focusPerCycle: 0,
    useWater: true,
  });
  assert.strictEqual(r.totalSeedYield, 1.00);
  assert.ok(Math.abs(r.outputsPerCycle - 9.5) < 1e-9);
  assert.ok(Math.abs(r.netSeedCostPerOutput - 3600 / 9.5) < 0.01);
});

test("Hen Eggs with Premium at Fort Sterling: +100% and +10% sum to 2.1x -> 19.95", () => {
  const r = calcFarmingEconomics({
    type: "byproduct",
    seedPrice: 400,
    feedCount: 9,
    producePerCycle: 9.5,
    outputSellPrice: 80,
    yieldBonus: 0.10,           // FS hen eggs spec
    premiumBonus: 1,            // +100% Product Yield
    plotsPerCycle: 1,
    cycleHours: 22,
    focusPerCycle: 0,
    useWater: true,
  });
  assert.ok(Math.abs(r.outputsPerCycle - 9.5 * 2.1) < 1e-9,
    `expected 19.95 eggs, got ${r.outputsPerCycle}`);
});

test("Byproduct profit/day uses the 22h produce cycle", () => {
  const r = calcFarmingEconomics({
    type: "byproduct",
    seedPrice: 0,               // free feed for clarity
    feedCount: 9,
    producePerCycle: 1,
    outputSellPrice: 100,
    yieldBonus: 0,
    plotsPerCycle: 1,
    cycleHours: 22,
    focusPerCycle: 0,
    useWater: true,
  });
  // profit/cycle = 100 × 0.935 = 93.5
  assert.ok(Math.abs(r.profitPerDay - 93.5 * (24 / 22)) < 0.01);
});

console.log("\n=== Edge cases ===");

test("seedPrice 0 and outputSellPrice 0 -> 0 profit, no NaN", () => {
  const r = calcFarmingEconomics({
    type: "crop",
    seedPrice: 0,
    outputSellPrice: 0,
    baseSeedYield: 0,
    wateringBonus: 0,
    yieldBonus: 0,
    plotsPerCycle: 9,
    cycleHours: 22,
    focusPerCycle: 100,
    useWater: false,
  });
  assert.strictEqual(r.profitPerCycle, 0);
  assert.strictEqual(r.profitPerDay, 0);
  assert.strictEqual(r.profitPerFocus, 0);
});

test("focusPerCycle 0: profit/focus = 0 (no NaN/Infinity)", () => {
  const r = calcFarmingEconomics({
    type: "crop",
    seedPrice: 0, outputSellPrice: 100,
    baseSeedYield: 2, wateringBonus: 0, yieldBonus: 0,
    plotsPerCycle: 9, cycleHours: 22, focusPerCycle: 0,
    useWater: true,
  });
  assert.strictEqual(r.profitPerFocus, 0);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
