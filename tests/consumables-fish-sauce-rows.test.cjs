/**
 * Test: Fish Sauce rows in the Consumables table.
 *
 * Adds three new rows for the tradeable enchant-upgrade material:
 *   T1_FISHSAUCE_LEVEL1 — Basic Fish Sauce
 *   T1_FISHSAUCE_LEVEL2 — Fancy Fish Sauce
 *   T1_FISHSAUCE_LEVEL3 — Special Fish Sauce
 *
 * Three production-side changes the test pins:
 *  (a) js/data-consumables.js gets new entries for the three fish-sauce ids.
 *  (b) js/recipes.js BUNDLED_RECIPES gets craft recipes for them
 *      (per items.xml:1318-1335 — 15/45/135 fishchops + 1/3/9 seaweed).
 *  (c) js/api.js NON_TRADEABLE_PREFIXES is slimmed: T1_FISHSAUCE and
 *      T1_FISHCHOPS were incorrectly flagged as non-tradeable; only
 *      T1_ALCHEMY_EXTRACT remains. (User verified the marketplace listings.)
 *
 * Black-box: load the real source files, assert their post-fix contracts.
 *
 * Run: node tests/consumables-fish-sauce-rows.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function load(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// ── Compile api.js, recipes.js, data-consumables.js into a sandbox module ──
// api.js references `fetch` inside function bodies only — top-level is pure
// declarations — so a no-op stub keeps Module._compile from crashing on Node
// versions without the global. (Modern Node has it, but stub for safety.)
const stub = `globalThis.fetch = globalThis.fetch || (() => Promise.resolve(null));\n`;

const apiSrc = load("js/api.js");
const recipesSrc = load("js/recipes.js");
const dataConsumablesSrc = load("js/data-consumables.js");

const mod = new Module("fish-sauce-rows-test");
mod._compile(
  stub + apiSrc + recipesSrc + dataConsumablesSrc +
    "\nmodule.exports = { NON_TRADEABLE_PREFIXES, isNonTradeable, BUNDLED_RECIPES, CONSUMABLES };",
  "fish-sauce-rows-test.js",
);
const { NON_TRADEABLE_PREFIXES, isNonTradeable, BUNDLED_RECIPES, CONSUMABLES } = mod.exports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

console.log("\n=== NON_TRADEABLE_PREFIXES — fish sauce + fish chops removed ===");

test("T1_FISHSAUCE_LEVEL1 is tradeable (isNonTradeable === false)", () => {
  assert.strictEqual(isNonTradeable("T1_FISHSAUCE_LEVEL1"), false);
});
test("T1_FISHSAUCE_LEVEL2 is tradeable", () => {
  assert.strictEqual(isNonTradeable("T1_FISHSAUCE_LEVEL2"), false);
});
test("T1_FISHSAUCE_LEVEL3 is tradeable", () => {
  assert.strictEqual(isNonTradeable("T1_FISHSAUCE_LEVEL3"), false);
});
test("T1_FISHCHOPS is tradeable (user verified marketplace listings)", () => {
  assert.strictEqual(isNonTradeable("T1_FISHCHOPS"), false);
});
test("T1_SEAWEED is tradeable (sanity check — never was non-tradeable)", () => {
  assert.strictEqual(isNonTradeable("T1_SEAWEED"), false);
});
test("T1_ALCHEMY_EXTRACT remains non-tradeable (regression guard)", () => {
  assert.strictEqual(isNonTradeable("T1_ALCHEMY_EXTRACT"), true);
});
test("NON_TRADEABLE_PREFIXES contains exactly one entry", () => {
  assert.deepStrictEqual(NON_TRADEABLE_PREFIXES, ["T1_ALCHEMY_EXTRACT"]);
});

console.log("\n=== BUNDLED_RECIPES — fish sauce craft recipes from items.xml ===");

// Fish sauce has no resource return rate (verified against wiki + items.xml
// returnproductnotresource semantics — the cook step doesn't refund chops or
// seaweed). Every ingredient carries noReturn:true so the renderer's RRR
// multiplier at render-consumables.js:670 stays at m.count instead of
// dropping to m.count * (1 - rrr).
test("LEVEL1: 15× T1_FISHCHOPS + 1× T1_SEAWEED, both noReturn", () => {
  assert.deepStrictEqual(BUNDLED_RECIPES["T1_FISHSAUCE_LEVEL1"], [
    { matId: "T1_FISHCHOPS", count: 15, noReturn: true },
    { matId: "T1_SEAWEED", count: 1, noReturn: true },
  ]);
});
test("LEVEL2: 45× T1_FISHCHOPS + 3× T1_SEAWEED, both noReturn", () => {
  assert.deepStrictEqual(BUNDLED_RECIPES["T1_FISHSAUCE_LEVEL2"], [
    { matId: "T1_FISHCHOPS", count: 45, noReturn: true },
    { matId: "T1_SEAWEED", count: 3, noReturn: true },
  ]);
});
test("LEVEL3: 135× T1_FISHCHOPS + 9× T1_SEAWEED, both noReturn", () => {
  assert.deepStrictEqual(BUNDLED_RECIPES["T1_FISHSAUCE_LEVEL3"], [
    { matId: "T1_FISHCHOPS", count: 135, noReturn: true },
    { matId: "T1_SEAWEED", count: 9, noReturn: true },
  ]);
});
test("recipe entries are arrays (not undefined)", () => {
  for (const id of [
    "T1_FISHSAUCE_LEVEL1",
    "T1_FISHSAUCE_LEVEL2",
    "T1_FISHSAUCE_LEVEL3",
  ]) {
    assert.ok(Array.isArray(BUNDLED_RECIPES[id]), `${id} missing recipe`);
    assert.strictEqual(BUNDLED_RECIPES[id].length, 2, `${id} should have 2 ingredients`);
  }
});

console.log("\n=== CONSUMABLES list — three fish sauce rows ===");

test("T1_FISHSAUCE_LEVEL1 listed with name 'Basic Fish Sauce [T1]'", () => {
  const row = CONSUMABLES.find((c) => c.id === "T1_FISHSAUCE_LEVEL1");
  assert.ok(row, "T1_FISHSAUCE_LEVEL1 missing from CONSUMABLES");
  assert.strictEqual(row.name, "Basic Fish Sauce [T1]");
});
test("T1_FISHSAUCE_LEVEL2 listed with name 'Fancy Fish Sauce [T1]'", () => {
  const row = CONSUMABLES.find((c) => c.id === "T1_FISHSAUCE_LEVEL2");
  assert.ok(row, "T1_FISHSAUCE_LEVEL2 missing from CONSUMABLES");
  assert.strictEqual(row.name, "Fancy Fish Sauce [T1]");
});
test("T1_FISHSAUCE_LEVEL3 listed with name 'Special Fish Sauce [T1]'", () => {
  const row = CONSUMABLES.find((c) => c.id === "T1_FISHSAUCE_LEVEL3");
  assert.ok(row, "T1_FISHSAUCE_LEVEL3 missing from CONSUMABLES");
  assert.strictEqual(row.name, "Special Fish Sauce [T1]");
});
test("rows appear in tier-1 enchant-level order (LEVEL1 < LEVEL2 < LEVEL3)", () => {
  const idx1 = CONSUMABLES.findIndex((c) => c.id === "T1_FISHSAUCE_LEVEL1");
  const idx2 = CONSUMABLES.findIndex((c) => c.id === "T1_FISHSAUCE_LEVEL2");
  const idx3 = CONSUMABLES.findIndex((c) => c.id === "T1_FISHSAUCE_LEVEL3");
  assert.ok(idx1 >= 0 && idx2 > idx1 && idx3 > idx2,
    `expected LEVEL1 < LEVEL2 < LEVEL3, got ${idx1}/${idx2}/${idx3}`);
});

// Insert position contract: between Avalonian Meals and Raw Ingredients - Crops.
// Pinning this catches accidental moves into the wrong section.
test("rows positioned after 'Avalonian Meals' and before 'Raw Ingredients - Crops'", () => {
  const fishSauceIdx = CONSUMABLES.findIndex((c) => c.id === "T1_FISHSAUCE_LEVEL1");
  // T8_MEAL_STEW_AVALON is the last entry in Avalonian Meals section
  const lastAvalonIdx = CONSUMABLES.findIndex((c) => c.id === "T8_MEAL_STEW_AVALON");
  // T1_CARROT is the first entry in Raw Ingredients - Crops section
  const firstCropIdx = CONSUMABLES.findIndex((c) => c.id === "T1_CARROT");
  assert.ok(fishSauceIdx > lastAvalonIdx,
    `Fish sauce should follow Avalonian Meals (last @ ${lastAvalonIdx}), got @ ${fishSauceIdx}`);
  assert.ok(fishSauceIdx < firstCropIdx,
    `Fish sauce should precede Raw Ingredients - Crops (first @ ${firstCropIdx}), got @ ${fishSauceIdx}`);
});

console.log("\n=== Input cost math (sample prices) ===");

// Pure helper that mirrors the cost accumulation done in
// render-consumables.js when a recipe has only tradeable mats.
// We accumulate `count * price` per ingredient; RRR / fees are applied in
// the renderer's craft-route loop but are not part of THIS recipe's
// definition, so we verify the bare recipe arithmetic.
function recipeRawInputCost(recipeId, prices) {
  const recipe = BUNDLED_RECIPES[recipeId];
  if (!Array.isArray(recipe)) throw new Error(`no recipe for ${recipeId}`);
  return recipe.reduce((sum, m) => sum + m.count * (prices[m.matId] ?? 0), 0);
}

test("LEVEL1 raw input cost: 15×10 + 1×5 = 155", () => {
  const cost = recipeRawInputCost("T1_FISHSAUCE_LEVEL1", {
    T1_FISHCHOPS: 10,
    T1_SEAWEED: 5,
  });
  assert.strictEqual(cost, 155);
});
test("LEVEL2 raw input cost: 45×10 + 3×5 = 465", () => {
  const cost = recipeRawInputCost("T1_FISHSAUCE_LEVEL2", {
    T1_FISHCHOPS: 10,
    T1_SEAWEED: 5,
  });
  assert.strictEqual(cost, 465);
});
test("LEVEL3 raw input cost: 135×10 + 9×5 = 1395", () => {
  const cost = recipeRawInputCost("T1_FISHSAUCE_LEVEL3", {
    T1_FISHCHOPS: 10,
    T1_SEAWEED: 5,
  });
  assert.strictEqual(cost, 1395);
});
test("cost scales linearly with fishchops price", () => {
  const c1 = recipeRawInputCost("T1_FISHSAUCE_LEVEL1", { T1_FISHCHOPS: 100, T1_SEAWEED: 50 });
  const c2 = recipeRawInputCost("T1_FISHSAUCE_LEVEL1", { T1_FISHCHOPS: 200, T1_SEAWEED: 50 });
  // 15*100 + 50 = 1550, 15*200 + 50 = 3050 — diff = 1500 (= 15 fishchops × 100)
  assert.strictEqual(c2 - c1, 1500);
});
test("missing-price ingredient contributes 0 (graceful no-data)", () => {
  const cost = recipeRawInputCost("T1_FISHSAUCE_LEVEL2", {
    // T1_FISHCHOPS unset → 0
    T1_SEAWEED: 5,
  });
  assert.strictEqual(cost, 15); // 45*0 + 3*5
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
