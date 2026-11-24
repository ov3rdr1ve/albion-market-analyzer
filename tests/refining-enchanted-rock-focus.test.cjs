/**
 * Test: focus cost of an ENCHANTED-ROCK refine row (Refining/Transports table).
 *
 * Ground truth
 * ------------
 * items.xml `craftingfocus` is a PER-OUTPUT-UNIT figure, not a per-craft-action
 * total. Proof inside the same data file: T4_MEAL_SALAD is amountcrafted="10"
 * with craftingfocus="168", while T4_MEAL_SALAD_FISH is amountcrafted="1" with
 * craftingfocus="231". Read per-unit those are the same ballpark (168 vs 231);
 * read per-action the batch salad would cost 16.8 focus per salad against 231
 * for the fish salad — a 14x gap between two T4 foods, which is nonsense. The
 * sibling `time` attribute DOES scale with the batch (0.84 for 10 salads vs
 * 0.115 for 1 fish salad), which is why nutrition/station fee scales and focus
 * does not.
 *
 * Applied to stone: T5_STONEBLOCK carries craftingfocus="94" on ALL of its
 * recipes — plain (amountcrafted 1) and the .1/.2/.3 enchanted-rock recipes
 * (amountcrafted 2/4/8). Per OUTPUT BLOCK that is a flat 94 at every enchant;
 * the .3 craft action burns 94x8 = 752 focus and returns 8 blocks. Matches the
 * Albion forum thread 122884 ("the .3 is 8 times a regular rock focus"), and
 * the official refining guide (input refined blocks and output blocks both
 * scale, raw rock count does not).
 *
 * So: refining enchanted rock gives NO focus discount per block. The table is
 * normalized per 1 output block, therefore focusCost for a .1/.2/.3 rock row
 * must EQUAL the plain rock row's focusCost — it must not be divided by
 * outputPerRefine (which made .3 look 8x focus-cheaper than plain).
 *
 * Black-box: drive the real computeRefineFocusColumn from js/refining-route.js.
 *
 * Run: node tests/refining-enchanted-rock-focus.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// Per-output-unit focus straight off items.xml for stone blocks.
const STONE_FOCUS = { 4: 54, 5: 94, 6: 164, 7: 287, 8: 503 };

const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const SETUP_FEE = 0.025;
const PREMIUM_TAX = 0.065;
const BASE_CITY_BONUS = 0.18;
const REFINE_SPEC_BONUS = 0.40;
const FOCUS_BONUS = 0.59;
const CITY_REFINE_SPEC = { Bridgewatch: "rock" };
const STONE_FOCUS = ${JSON.stringify(STONE_FOCUS)};
function isBlackRedZoneEnabled() { return false; }
function isFocusEnabled() { return true; }
function isValidSourceCity() { return true; }
function getOverridePrice() { return null; }
function getCityForce() { return null; }
function isInvalidCrossRoute() { return false; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice() { return 0; }
function getSellPrice() { return 0; }
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getRefineRRR(city, type, useFocus) {
  let bonus = BASE_CITY_BONUS;
  if (CITY_REFINE_SPEC[city] === type) bonus += REFINE_SPEC_BONUS;
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}
// Mirrors the real getFocusCost contract: a per-OUTPUT-UNIT figure keyed by the
// refined id, identical for every enchant of the same block.
function getFocusCost(id, tier) { return STONE_FOCUS[getTierFromId(id)] || 0; }
function calcStationFeeSilver() { return 0; }
function refineStationFeeSilver() { return 0; }
function getTierFromId(id) { const m = id.match(/^T(\\d+)/); return m ? parseInt(m[1], 10) : 4; }
function getResourceWeightKg() { return 1; }
function legBrecilienCost() { return 0; }
function matsNeededFor10kFocus(focusCost, count) {
  if (!focusCost || focusCost <= 0) return 0;
  return Math.round((10000 / focusCost) * count);
}
function calculateProfitPerFocus(profit, focusCost) {
  if (!focusCost || focusCost <= 0) return 0;
  return profit / focusCost;
}
function calculateTransportMargin() { return { profit: 0, margin: 0 }; }
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }

const mod = new Module("refining-enchanted-rock-focus-test");
mod._compile(
  sandbox + loadFile("js/focus-play.js") + loadFile("js/refining-route.js") +
    "\nmodule.exports = { computeRefineFocusColumn };",
  "refining-enchanted-rock-focus.js",
);
const { computeRefineFocusColumn } = mod.exports;

// Row shapes as data.js builds them (per-1-output-block basis).
const BASE_RATIO = { 4: 2, 5: 3, 6: 4, 7: 5, 8: 5 };
function plainRow(tier) {
  return {
    rawId: `T${tier}_ROCK`,
    refinedId: `T${tier}_STONEBLOCK`,
    rawRatio: BASE_RATIO[tier],
    resourceType: "rock",
    secondaryMatId: `T${tier - 1}_STONEBLOCK`,
    secondaryMatCount: 1,
  };
}
function enchantedRow(tier, ench) {
  const yieldPer = Math.pow(2, ench);
  return {
    rawId: `T${tier}_ROCK_LEVEL${ench}@${ench}`,
    refinedId: `T${tier}_STONEBLOCK`,
    rawRatio: BASE_RATIO[tier] / yieldPer,
    resourceType: "rock",
    secondaryMatId: `T${tier - 1}_STONEBLOCK`,
    secondaryMatCount: 1,
    outputPerRefine: yieldPer,
    enchantedRaw: ench,
  };
}
function focusResultFor(city = "Bridgewatch") {
  return {
    refineCity: city,
    rawUnitCost: 100,
    totalRawCost: 1000,
    heartCost: 0,
    secondaryChain: null,
  };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Enchanted-rock refining focus cost\n");

const TIERS = [4, 5, 6, 7, 8];
const ENCHANTS = [1, 2, 3];

// ── 1. Unpriced row (focusResult === null) ──
TIERS.forEach((tier) => {
  ENCHANTS.forEach((ench) => {
    test(`T${tier}.${ench} rock, no route: focus per block = plain (${STONE_FOCUS[tier]})`, () => {
      const got = computeRefineFocusColumn(null, enchantedRow(tier, ench)).focusCost;
      assert.strictEqual(got, STONE_FOCUS[tier],
        `expected ${STONE_FOCUS[tier]} focus/block, got ${got}`);
    });
  });
});

// ── 2. Priced row (focusResult present, no secondary chain) ──
TIERS.forEach((tier) => {
  ENCHANTS.forEach((ench) => {
    test(`T${tier}.${ench} rock, priced route: focus per block = plain (${STONE_FOCUS[tier]})`, () => {
      const got = computeRefineFocusColumn(focusResultFor(), enchantedRow(tier, ench)).focusCost;
      assert.strictEqual(got, STONE_FOCUS[tier],
        `expected ${STONE_FOCUS[tier]} focus/block, got ${got}`);
    });
  });
});

// ── 3. Enchanted rows match the plain row exactly (the whole point) ──
TIERS.forEach((tier) => {
  test(`T${tier}: every enchant charges the same focus/block as plain rock`, () => {
    const plain = computeRefineFocusColumn(focusResultFor(), plainRow(tier)).focusCost;
    ENCHANTS.forEach((ench) => {
      const got = computeRefineFocusColumn(focusResultFor(), enchantedRow(tier, ench)).focusCost;
      assert.strictEqual(got, plain,
        `.${ench} charged ${got} vs plain ${plain} — enchanted rock is not a focus discount`);
    });
  });
});

// ── 4. Focus is never fractional (a per-block cost is a whole focus figure) ──
test("no enchanted-rock row produces a fractional focus cost", () => {
  TIERS.forEach((tier) => {
    ENCHANTS.forEach((ench) => {
      const got = computeRefineFocusColumn(focusResultFor(), enchantedRow(tier, ench)).focusCost;
      assert.ok(Number.isInteger(got), `T${tier}.${ench} focus is fractional: ${got}`);
    });
  });
});

// ── 5. Silver/focus benchmark does not inherit the old 2^e inflation ──
test("silver/focus for .3 is not 8x the plain row's (same focus, same RRR delta)", () => {
  const plain = computeRefineFocusColumn(focusResultFor(), plainRow(5));
  const ench3 = computeRefineFocusColumn(focusResultFor(), enchantedRow(5, 3));
  assert.strictEqual(ench3.focusCost, plain.focusCost);
  assert.strictEqual(ench3.profitPerFocus, plain.profitPerFocus,
    "same material gross + same focus must give the same marginal silver/focus");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
