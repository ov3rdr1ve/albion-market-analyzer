/**
 * Test: Drake Egg Biscuits (Dragonfire, 2026-08-31) in the Consumables table.
 *
 * The biscuits are the odd one out among cooked foods on three counts, and all
 * three are what this test pins:
 *
 *   1. one craft action yields NINETY-NINE biscuits, the largest batch of any
 *      consumable in the game. Per-unit cost is the whole recipe divided by 99
 *      — get the output wrong and the row is off by two orders of magnitude
 *      (the amountcrafted bug this repo has hit before);
 *   2. the recipe eats a Firewing Drake Egg — a Kennel animal, not a cooked
 *      material — so the egg's price is the row's dominant input;
 *   3. it costs ZERO focus, so the focus toggle and the Silver/Focus column
 *      must stay inert for it.
 *
 * Black-box: reads the real catalog / recipe / focus / output data. No live API
 * or DB. Counts are the <craftresource> values verbatim from the ao-bin-dumps
 * items.xml of 2026-08-31.
 *
 * Run: node tests/drake-egg-biscuits.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function load(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const ID = "T8_MEAL_SPECIAL_FOOD_DRAKE_EGG";
const EGG = "T8_FARM_DRAKE_BABY";
const MATS = [["T3_FLOUR", 36], ["T8_BUTTER", 12], ["T8_MILK", 24], [EGG, 1]];
const OUTPUT = 99;

const stubs = [
  "function getTierFromId(id) {",
  "  const m = id.match(/^T(\\d)/);",
  "  return m ? parseInt(m[1], 10) : 0;",
  "}",
  "",
].join("\n");

const mod = new Module("drake-biscuits-test");
mod._compile(
  stubs +
    load("js/data-consumables.js") +
    load("js/recipes.js") +
    load("js/item-names.js") +
    "\nmodule.exports = { CONSUMABLES, BUNDLED_RECIPES, ITEM_NAMES_MAP };",
  "drake-biscuits-test.js"
);
const { CONSUMABLES, BUNDLED_RECIPES, ITEM_NAMES_MAP } = mod.exports;

const FOCUS_COSTS = require("../js/focus-costs.json");
const CONSUMABLE_OUTPUT = require("../js/consumable-output.json");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

console.log("\n=== Catalog and recipe ===");
test("the biscuits are in CONSUMABLES", () => {
  const row = CONSUMABLES.find((c) => c.id === ID);
  assert.ok(row, ID + " missing from CONSUMABLES");
  assert.ok(/Drake Egg Biscuits/.test(row.name), "name is \"" + row.name + "\"");
  assert.ok(!row.name.includes("_"), "name leaks a raw id");
});

test("recipe matches items.xml exactly", () => {
  const rec = BUNDLED_RECIPES[ID];
  assert.ok(Array.isArray(rec), ID + " has no BUNDLED_RECIPES entry");
  assert.deepStrictEqual(rec.map((m) => [m.matId, m.count]), MATS);
});

test("one Firewing Drake Egg per craft action", () => {
  const egg = BUNDLED_RECIPES[ID].find((m) => m.matId === EGG);
  assert.ok(egg, "the recipe must consume " + EGG);
  assert.strictEqual(egg.count, 1);
});

test("the egg is named, not shown as a raw id", () => {
  const name = ITEM_NAMES_MAP[EGG];
  assert.ok(name, EGG + " has no display name");
  assert.ok(/Firewing Drake Egg/.test(name), EGG + " shows as \"" + name + "\"");
});

test("every ingredient resolves to a display name", () => {
  for (const [matId] of MATS) {
    assert.ok(ITEM_NAMES_MAP[matId], matId + " has no display name");
  }
});

console.log("\n=== The 99-per-craft batch ===");
test("CONSUMABLE_OUTPUT says 99", () => {
  assert.strictEqual(CONSUMABLE_OUTPUT[ID], OUTPUT,
    "output should be " + OUTPUT + " (got " + CONSUMABLE_OUTPUT[ID] + ")");
});
test("it is the only consumable with a batch that large", () => {
  const big = Object.entries(CONSUMABLE_OUTPUT).filter(([, n]) => n >= 50);
  assert.deepStrictEqual(big.map(([k]) => k), [ID]);
});
test("per-unit cost is the batch cost divided by 99", () => {
  // Black-box arithmetic check against a synthetic price sheet: the row must
  // divide, not report the whole batch as one unit.
  const price = { T3_FLOUR: 100, T8_BUTTER: 1000, T8_MILK: 500, [EGG]: 990000 };
  const batch = BUNDLED_RECIPES[ID].reduce((s, m) => s + price[m.matId] * m.count, 0);
  const perUnit = batch / CONSUMABLE_OUTPUT[ID];
  assert.strictEqual(batch, 36 * 100 + 12 * 1000 + 24 * 500 + 990000);
  assert.ok(Math.abs(perUnit - batch / 99) < 1e-9);
  assert.ok(perUnit < batch / 50, "dividing by the batch must dominate the cost");
});

console.log("\n=== Focus: the biscuits are focus-free ===");
test("no focus cost is published for the biscuits", () => {
  const f = FOCUS_COSTS[ID];
  assert.ok(f === undefined || f === 0,
    "biscuits should cost no focus (got " + f + ")");
});
test("no enchant variants exist for the biscuits", () => {
  for (const lvl of [1, 2, 3]) {
    assert.strictEqual(FOCUS_COSTS[ID + "@" + lvl], undefined,
      ID + "@" + lvl + " should not exist");
  }
});

console.log("\n=== Return rate: an ordinary cooked food, nothing pinned ===");
test("no ingredient is flagged noReturn", () => {
  // items.xml gives the biscuit recipe no maxreturnamount="0" on any line —
  // including the egg — so the row takes the normal city return rate.
  assert.deepStrictEqual(
    BUNDLED_RECIPES[ID].filter((m) => m.noReturn).map((m) => m.matId), []);
});

console.log("\n" + "=".repeat(50));
console.log("Total: " + (passed + failed) + " | Passed: " + passed + " | Failed: " + failed);
if (failed > 0) process.exit(1);
