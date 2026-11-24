/**
 * Test: a consumable picked into "My Crafting List" contributes its materials
 * to the "Materials to Buy" sub-table.
 *
 * Bug (reported): after a reload the Avalonian stews / sandwich / Minor Poison
 * Potion rows showed a dash in the Materials column and added NOTHING to
 * "Materials to Buy" — the totals were computed from a shopping list missing
 * every consumable input.
 *
 * The chain: on a cold recipeCache the consumables row builder produced a FLIP
 * row (`isFlip:true`, no `recipe`, no `craftCity`), and the craft-list extractor
 * for `consumable-table` reads exactly those fields, so `_clRecipeMats` returned
 * an empty array. The craft-list code was never wrong — it faithfully reported
 * a row that had lost its recipe. This test pins both halves of that coupling.
 *
 * Black-box: real js/recipe-resolver.js + js/craft-list-materials.js, synthetic
 * prices. No live API or DB.
 *
 * Run: node tests/craft-list-consumable-materials.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
function getTierFromId(id) { const m = id.match(/^T(\\d)/); return m ? parseInt(m[1], 10) : 0; }
function isRrrEligible(matId) { return !/QUESTITEM|FISHSAUCE|ALCHEMY_EXTRACT/.test(matId); }
let recipeCache = {};
`;

const mod = new Module("craft-list-consumable-materials");
mod._compile(
  stubs + J("recipes.js") + J("data-consumables.js") + J("data-enchant-sauces.js") +
    J("recipe-resolver.js") + J("craft-list-focus-budget.js") +
    J("craft-list-extractors.js") + J("craft-list-extractors-transport.js") +
    J("craft-list-materials.js") +
    "\nmodule.exports = { resolveConsumableRecipe, CONSUMABLES, BUNDLED_RECIPES," +
    " CRAFT_LIST_EXTRACTORS, extractCraftListRow, aggregateCraftListMaterials," +
    " clearCache: () => { recipeCache = {}; } };",
  "craft-list-consumable-materials.js"
);
const {
  resolveConsumableRecipe, CONSUMABLES, extractCraftListRow, aggregateCraftListMaterials,
} = mod.exports;

const byId = (id) => CONSUMABLES.find((c) => c.id === id);

/** The craft-row shape render-consumables.js emits once a recipe resolves. */
function craftRow(id, craftCity, rrr) {
  mod.exports.clearCache();
  const item = byId(id);
  const recipe = resolveConsumableRecipe(item);
  const matBestPrices = {};
  (recipe || []).forEach((m, i) => {
    matBestPrices[m.matId] = { city: i % 2 ? "Martlock" : "Lymhurst", price: 100 * (i + 1) };
  });
  return {
    item, recipe, matBestPrices, craftCity, rrr,
    sellPot: { city: "Brecilien", price: 50_000 },
    totalInputCost: 30_000,
    marginInfo: { profit: 20_000 },
    focusCost: 90,
    section: "royal",
  };
}

/** The FLIP shape the cold-cache bug produced: no recipe, no craft city. */
function flipRow(id) {
  return {
    item: byId(id),
    isFlip: true,
    buyMat: { city: "Martlock", price: 1_000 },
    sellPot: { city: "Martlock", price: 1_500 },
    matBestPrices: null,
    totalInputCost: 1_000,
    marginInfo: { profit: 500 },
    rrr: 0,
    section: "royal",
  };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.error(`  FAIL: ${name}\n    ${e.message}`); }
}

const REPORTED = [
  "T4_POTION_COOLDOWN",
  "T8_MEAL_SANDWICH_AVALON",
  "T8_MEAL_STEW_AVALON",
  "T6_MEAL_STEW_AVALON",
  "T4_MEAL_STEW_AVALON",
];

console.log("\n=== Every reported row contributes materials ===");
REPORTED.forEach((id) => {
  test(`${id} extracts one material line per recipe ingredient`, () => {
    const row = craftRow(id, "Martlock", 0.152);
    const out = extractCraftListRow("consumable-table", row);
    assert.ok(out, "extractor returned nothing");
    assert.strictEqual(out.materials.length, row.recipe.length,
      `expected ${row.recipe.length} lines, got ${out.materials.length}`);
    out.materials.forEach((m) => {
      assert.ok(m.matId, "a material line lost its id");
      assert.ok(m.city, `${m.matId} has no city — the shopping list can't say where to buy it`);
      assert.ok(m.count > 0, `${m.matId} has a zero count`);
    });
  });
});

console.log("\n=== Materials to Buy aggregation ===");
test("quantities scale by the list entry's qty and merge per material+city", () => {
  const a = extractCraftListRow("consumable-table", craftRow("T8_MEAL_STEW_AVALON", "Martlock", 0));
  const b = extractCraftListRow("consumable-table", craftRow("T8_MEAL_STEW_AVALON", "Martlock", 0));
  const { lines, grandTotal } = aggregateCraftListMaterials([
    { ...a, qty: 2 }, { ...b, qty: 3 },
  ]);
  assert.ok(lines.length > 0, "Materials to Buy came back empty");
  assert.strictEqual(lines.length, a.materials.length, "same material+city should merge into one line");
  lines.forEach((l) => {
    const src = a.materials.find((m) => m.matId === l.matId);
    assert.strictEqual(l.count, src.count * 5, `${l.matId} did not scale by qty 2+3`);
  });
  assert.ok(grandTotal > 0, "grand total is zero despite priced materials");
});

test("RRR discounts the shopping count, exempt inputs stay gross", () => {
  const rrr = 0.2;
  const row = craftRow("T8_MEAL_STEW_AVALON", "Martlock", rrr);
  const out = extractCraftListRow("consumable-table", row);
  row.recipe.forEach((m) => {
    const line = out.materials.find((l) => l.matId === m.matId);
    const expected = /QUESTITEM|FISHSAUCE|ALCHEMY_EXTRACT/.test(m.matId)
      ? m.count
      : m.count * (1 - rrr);
    assert.ok(Math.abs(line.count - expected) < 1e-9,
      `${m.matId}: expected ${expected}, got ${line.count}`);
  });
});

test("a derived @n variant carries its enchant sauce into the shopping list", () => {
  mod.exports.clearCache();
  const base = byId("T8_MEAL_STEW_AVALON");
  const variant = {
    ...base, id: "T8_MEAL_STEW_AVALON@2", baseId: base.id,
    enchantSauce: { matId: "T1_FISHSAUCE_LEVEL2", count: 27 },
  };
  const recipe = resolveConsumableRecipe(variant);
  const out = extractCraftListRow("consumable-table", {
    item: variant, recipe, matBestPrices: {}, craftCity: "Martlock", rrr: 0.2,
    sellPot: { city: "Brecilien", price: 1 }, totalInputCost: 1, marginInfo: { profit: 0 },
  });
  const sauce = out.materials.find((m) => m.matId === "T1_FISHSAUCE_LEVEL2");
  assert.ok(sauce, "the enchant sauce is missing from the shopping list");
  assert.strictEqual(sauce.count, 27, "the sauce is noReturn — RRR must not discount it");
  assert.strictEqual(sauce.city, "Martlock", "an unpriced line falls back to the craft city");
});

console.log("\n=== The regression itself: a recipe-less row buys nothing ===");
REPORTED.forEach((id) => {
  test(`${id} as a flip row yields zero material lines (the reported bug)`, () => {
    const out = extractCraftListRow("consumable-table", flipRow(id));
    assert.ok(out, "extractor returned nothing");
    assert.strictEqual(out.materials.length, 0);
    assert.strictEqual(aggregateCraftListMaterials([{ ...out, qty: 1 }]).lines.length, 0);
  });
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
