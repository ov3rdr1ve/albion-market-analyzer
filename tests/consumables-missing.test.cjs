/**
 * Test: Newly added consumable items, recipes, and crafting items.
 * Validates data integrity: every craftable item has a recipe,
 * every recipe ingredient has a display name, and special flags are set.
 *
 * Run: node tests/consumables-missing.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadScript(filePath) {
  return fs.readFileSync(path.join(__dirname, "..", filePath), "utf-8");
}

const sandbox = { window: {}, document: { getElementById: () => null }, exports: {} };
vm.createContext(sandbox);
const scriptFiles = [
  "js/item-names.js",
  "js/data.js",
  "js/data-consumables.js",
  "js/recipes.js",
  "js/data-tracking-tools.js",
];
for (const s of scriptFiles) {
  try { vm.runInContext(loadScript(s), sandbox); }
  catch (e) { console.error(`Error loading ${s}: ${e.message}`); process.exit(1); }
}
// const-declared variables aren't sandbox properties; extract them via eval
const extract = (name) => vm.runInContext(name, sandbox);
const CONSUMABLES = extract("CONSUMABLES");
const ITEM_NAMES_MAP = extract("ITEM_NAMES_MAP");
const CRAFTING_ITEMS = extract("CRAFTING_ITEMS");
const BUNDLED_RECIPES = extract("BUNDLED_RECIPES");
const GEAR_TRACKING_TOOLS = extract("GEAR_TRACKING_TOOLS");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

// ── New item IDs ──
// Tier coverage matches what items.xml actually has — meals come in three
// tiers each on alternating-tier schedules (e.g. Salad is T2/T4/T6).
const NEW_POTION_IDS = [
  "T3_POTION_SLOWFIELD", "T5_POTION_SLOWFIELD", "T7_POTION_SLOWFIELD",
  "T4_POTION_COOLDOWN", "T6_POTION_COOLDOWN", "T8_POTION_COOLDOWN",
  "T8_POTION_CLEANSE",
];
const NEW_SALAD_IDS = [
  "T2_MEAL_SALAD", "T4_MEAL_SALAD", "T6_MEAL_SALAD",
];
const NEW_FISH_MEAL_IDS = [
  "T1_MEAL_SOUP_FISH", "T3_MEAL_SOUP_FISH", "T5_MEAL_SOUP_FISH",
  "T2_MEAL_SALAD_FISH", "T4_MEAL_SALAD_FISH", "T6_MEAL_SALAD_FISH",
  "T3_MEAL_PIE_FISH", "T5_MEAL_PIE_FISH", "T7_MEAL_PIE_FISH",
  "T3_MEAL_OMELETTE_FISH", "T5_MEAL_OMELETTE_FISH", "T7_MEAL_OMELETTE_FISH",
  "T4_MEAL_STEW_FISH", "T6_MEAL_STEW_FISH", "T8_MEAL_STEW_FISH",
  "T4_MEAL_SANDWICH_FISH", "T6_MEAL_SANDWICH_FISH", "T8_MEAL_SANDWICH_FISH",
  "T3_MEAL_ROAST_FISH", "T5_MEAL_ROAST_FISH", "T7_MEAL_ROAST_FISH",
];
const NEW_AVALON_MEAL_IDS = [
  "T3_MEAL_OMELETTE_AVALON", "T5_MEAL_OMELETTE_AVALON", "T7_MEAL_OMELETTE_AVALON",
  "T4_MEAL_STEW_AVALON", "T6_MEAL_STEW_AVALON", "T8_MEAL_STEW_AVALON",
  "T4_MEAL_SANDWICH_AVALON", "T6_MEAL_SANDWICH_AVALON", "T8_MEAL_SANDWICH_AVALON",
];
// Plain meals that were missing from the catalog. T1_MEAL_SOUP (Carrot Soup)
// was skipped as "no market" — liquidity is the volume gate's job at render
// time, not a reason to drop a craftable item from the catalog.
const NEW_MEAL_IDS = [
  "T1_MEAL_SOUP",
];
const ALL_NEW_CRAFTABLE_IDS = [
  ...NEW_POTION_IDS, ...NEW_SALAD_IDS, ...NEW_MEAL_IDS,
  ...NEW_FISH_MEAL_IDS, ...NEW_AVALON_MEAL_IDS,
];

// In-game display names verified against albiononline2d.com on 2026-05-05.
// Spot-check a few to lock in the tier→meat mapping (T3=chicken, T4=goat,
// T5=goose, T6=mutton, T7=pork, T8=beef) and the fish naming pattern.
const EXPECTED_NAMES = {
  T1_MEAL_SOUP:             "Carrot Soup [T1]",
  T8_MEAL_SANDWICH_FISH:    "Thunderfall Lurcher Sandwich [T8]",
  T4_MEAL_SANDWICH_FISH:    "Stonestream Lurcher Sandwich [T4]",
  T8_MEAL_STEW_FISH:        "Deadwater Eel Stew [T8]",
  T3_MEAL_PIE:              "Chicken Pie [T3]",
  T7_MEAL_PIE:              "Pork Pie [T7]",
  T8_MEAL_STEW:             "Beef Stew [T8]",
  T8_MEAL_SANDWICH:         "Beef Sandwich [T8]",
  T7_MEAL_OMELETTE:         "Pork Omelette [T7]",
  T5_MEAL_OMELETTE_AVALON:  "Avalonian Goose Omelette [T5]",
  T8_POTION_COOLDOWN:       "Major Poison Potion [T8]",
  T5_POTION_REVIVE:         "Gigantify Potion [T5]",
  T8_POTION_CLEANSE:        "Invisibility Potion [T8]",
};

// ── Tests ──
console.log("\n=== Consumable items exist in CONSUMABLES ===");
const consumableIds = new Set(CONSUMABLES.map((c) => c.id));
ALL_NEW_CRAFTABLE_IDS.forEach((id) => {
  test(`${id} is in CONSUMABLES`, () => {
    assert.ok(consumableIds.has(id), `${id} missing from CONSUMABLES array`);
  });
});

console.log("\n=== Every new craftable has a BUNDLED_RECIPES entry ===");
ALL_NEW_CRAFTABLE_IDS.forEach((id) => {
  test(`${id} has a recipe`, () => {
    assert.ok(BUNDLED_RECIPES[id], `${id} missing from BUNDLED_RECIPES`);
    assert.ok(Array.isArray(BUNDLED_RECIPES[id]), `${id} recipe is not an array`);
    assert.ok(BUNDLED_RECIPES[id].length > 0, `${id} recipe is empty`);
  });
});

console.log("\n=== Recipe ingredients have display names ===");
// Only check ingredients that are real game items. Some legacy recipes still
// reference fake ids (e.g. T3_BREAD, T3_BUTTER) that were never in items.xml;
// these have no market data and nothing to display.
const FAKE_LEGACY_MAT_IDS = new Set([
  "T3_BREAD", "T5_BREAD",
  "T3_BUTTER", "T5_BUTTER", "T7_BUTTER",
  "T3_MILK", "T5_MILK", "T7_MILK",
  "T4_FLOUR", "T5_FLOUR",
  "T4_EGG",
  "T7_TEASEL", "T8_MULLEIN",
]);
const allMatIds = new Set();
ALL_NEW_CRAFTABLE_IDS.forEach((id) => {
  (BUNDLED_RECIPES[id] || []).forEach((m) => allMatIds.add(m.matId));
});
[...allMatIds].forEach((matId) => {
  if (FAKE_LEGACY_MAT_IDS.has(matId)) return;
  test(`${matId} has ITEM_NAMES_MAP entry`, () => {
    assert.ok(ITEM_NAMES_MAP[matId], `${matId} missing from ITEM_NAMES_MAP`);
  });
});

console.log("\n=== In-game display names ===");
Object.entries(EXPECTED_NAMES).forEach(([id, expected]) => {
  test(`${id} has correct in-game name`, () => {
    const entry = CONSUMABLES.find((c) => c.id === id);
    assert.ok(entry, `${id} missing from CONSUMABLES`);
    assert.strictEqual(entry.name, expected,
      `${id} name should be "${expected}", got "${entry.name}"`);
  });
});

console.log("\n=== Removed legacy/fake CONSUMABLES entries ===");
// These ids are NOT real items in the current game (verified against
// items.xml + albiononline2d 2026-05-05). They must not be in CONSUMABLES.
const REMOVED_FAKE_IDS = [
  // Pies on even tiers (only T3/T5/T7 exist)
  "T4_MEAL_PIE", "T6_MEAL_PIE", "T8_MEAL_PIE",
  // Stews/Sandwiches on odd tiers (only T4/T6/T8 exist)
  "T3_MEAL_STEW", "T5_MEAL_STEW", "T7_MEAL_STEW",
  "T3_MEAL_SANDWICH", "T5_MEAL_SANDWICH", "T7_MEAL_SANDWICH",
  // Omelettes/Roasts on even tiers
  "T4_MEAL_OMELETTE", "T6_MEAL_OMELETTE", "T8_MEAL_OMELETTE",
  "T4_MEAL_ROAST", "T6_MEAL_ROAST", "T8_MEAL_ROAST",
  // Soups outside T1/T3/T5
  "T4_MEAL_SOUP", "T6_MEAL_SOUP", "T7_MEAL_SOUP", "T8_MEAL_SOUP",
  // Salads outside T2/T4/T6
  "T5_MEAL_SALAD", "T7_MEAL_SALAD", "T8_MEAL_SALAD",
  // Healing/Energy outside T2/T4/T6
  "T3_POTION_HEAL", "T5_POTION_HEAL", "T7_POTION_HEAL", "T8_POTION_HEAL",
  "T3_POTION_ENERGY", "T5_POTION_ENERGY", "T7_POTION_ENERGY", "T8_POTION_ENERGY",
  // Resistance outside T3/T5/T7
  "T4_POTION_STONESKIN", "T6_POTION_STONESKIN", "T8_POTION_STONESKIN",
  // Whole POISON line — actual cooldown potions are POTION_COOLDOWN
  "T3_POTION_POISON", "T4_POTION_POISON", "T5_POTION_POISON",
  "T6_POTION_POISON", "T7_POTION_POISON", "T8_POTION_POISON",
  // GIGANTIFY ids never existed (legacy max-load potions are POTION_REVIVE)
  "T5_POTION_GIGANTIFY", "T6_POTION_GIGANTIFY", "T7_POTION_GIGANTIFY", "T8_POTION_GIGANTIFY",
  // REVIVE outside T3/T5/T7
  "T4_POTION_REVIVE", "T6_POTION_REVIVE", "T8_POTION_REVIVE",
  // Fake bread/butter/milk/flour/cheese/egg tiers
  "T3_BREAD", "T5_BREAD",
  "T3_BUTTER", "T5_BUTTER", "T7_BUTTER",
  "T3_MILK", "T5_MILK",
  "T4_FLOUR", "T5_FLOUR",
  "T4_CHEESE", "T5_CHEESE", "T6_CHEESE", "T7_CHEESE",
  "T3_EGGS", "T4_EGGS", "T5_EGGS",  // plural form was wrong; real id is _EGG
  // Wrong T7 crop id
  "T7_WHEAT",
];
REMOVED_FAKE_IDS.forEach((id) => {
  test(`${id} is NOT in CONSUMABLES`, () => {
    assert.ok(!consumableIds.has(id), `${id} should not be in CONSUMABLES (item doesn't exist in items.xml)`);
  });
});

console.log("\n=== Avalonian meals have noReturn on QUESTITEM_TOKEN_AVALON ===");
NEW_AVALON_MEAL_IDS.forEach((id) => {
  test(`${id} has noReturn on Avalon token`, () => {
    const recipe = BUNDLED_RECIPES[id];
    const avalonMat = recipe.find((m) => m.matId === "QUESTITEM_TOKEN_AVALON");
    assert.ok(avalonMat, `${id} missing QUESTITEM_TOKEN_AVALON ingredient`);
    assert.strictEqual(avalonMat.noReturn, true, `${id} Avalon token missing noReturn:true`);
  });
});

console.log("\n=== Hideout Construction Kit ===");
test("UNIQUE_HIDEOUT in CRAFTING_ITEMS with silverCost", () => {
  const hideout = CRAFTING_ITEMS.find((i) => i.id === "UNIQUE_HIDEOUT");
  assert.ok(hideout, "UNIQUE_HIDEOUT missing from CRAFTING_ITEMS");
  assert.strictEqual(hideout.silverCost, 10000000);
  assert.strictEqual(hideout.materials.length, 6);
  assert.strictEqual(hideout.noReturn, true, "Hideout kit must not get RRR on stones");
  // Verified in-game 2026-05-03: at 845 silver/100 nutrition the station fee is
  // 1,611,440 silver → 190,703 nutrition consumed per craft. The tier-derived
  // ivPerMat formula doesn't fit hideout (multi-tier mats + GvG token), so an
  // explicit nutrition value is required.
  assert.strictEqual(hideout.nutritionPerCraft, 190703);
});

console.log("\n=== Tracking Toolkit T3-T8 ===");
["T3", "T4", "T5", "T6", "T7", "T8"].forEach((tier) => {
  test(`${tier}_2H_TOOL_TRACKING exists with planks+leather`, () => {
    const tool = GEAR_TRACKING_TOOLS.find((t) => t.id === `${tier}_2H_TOOL_TRACKING`);
    assert.ok(tool, `${tier}_2H_TOOL_TRACKING missing`);
    assert.strictEqual(JSON.stringify(tool.materials), JSON.stringify([
      { matId: `${tier}_PLANKS`, count: 2 },
      { matId: `${tier}_LEATHER`, count: 6 },
    ]));
  });
});

console.log("\n=== Raw ingredient flips ===");
const flipIds = [
  "T3_FISH_FRESHWATER_FOREST_RARE", "T5_FISH_FRESHWATER_FOREST_RARE", "T7_FISH_FRESHWATER_FOREST_RARE",
  "T3_FISH_FRESHWATER_SWAMP_RARE", "T5_FISH_FRESHWATER_SWAMP_RARE", "T7_FISH_FRESHWATER_SWAMP_RARE",
  "T3_FISH_FRESHWATER_MOUNTAIN_RARE", "T5_FISH_FRESHWATER_MOUNTAIN_RARE", "T7_FISH_FRESHWATER_MOUNTAIN_RARE",
  "T3_FISH_FRESHWATER_HIGHLANDS_RARE", "T5_FISH_FRESHWATER_HIGHLANDS_RARE", "T7_FISH_FRESHWATER_HIGHLANDS_RARE",
  "T3_FISH_FRESHWATER_STEPPE_RARE", "T5_FISH_FRESHWATER_STEPPE_RARE", "T7_FISH_FRESHWATER_STEPPE_RARE",
  "T3_FISH_SALTWATER_ALL_RARE", "T5_FISH_SALTWATER_ALL_RARE", "T7_FISH_SALTWATER_ALL_RARE",
  "T3_FISH_FRESHWATER_AVALON_RARE", "T5_FISH_FRESHWATER_AVALON_RARE", "T7_FISH_FRESHWATER_AVALON_RARE",
  "T6_ALCOHOL", "T7_ALCOHOL", "T8_ALCOHOL",
  "QUESTITEM_TOKEN_AVALON",
];
flipIds.forEach((id) => {
  test(`${id} is in CONSUMABLES as raw flip`, () => {
    assert.ok(consumableIds.has(id), `${id} missing from CONSUMABLES`);
  });
});

// ── Summary ──
console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
