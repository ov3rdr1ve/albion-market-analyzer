/**
 * Test: every consumable recipe in BUNDLED_RECIPES matches items.xml.
 *
 * recipes.js was originally hand-copied from a now-stale gameinfo dump, which
 * let potion/meal recipes drift from the game (e.g. Minor Resistance Potion
 * still listed T2 Limestone; meals referenced fake T3_BREAD / T4_FLOUR ids).
 * This test is the regression guard: it parses items.xml (the same source the
 * focus/sauce extractors use) and asserts each CONSUMABLES recipe — base
 * ingredients, counts, and noReturn (maxreturnamount="0") — matches exactly.
 *
 * Black-box: reads repo files only, no live API/DB. If a future items.xml drop
 * changes a recipe, this fails loudly instead of silently serving stale data.
 *
 * Run: node tests/consumable-recipes-match-itemsxml.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const root = path.join(__dirname, "..");
const load = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// ── Load the app catalogs (CONSUMABLES + merged BUNDLED_RECIPES) ──
const stub = `function getTierFromId(id){const m=id.match(/^T(\\d)/);return m?parseInt(m[1],10):0;}`;
const mod = new Module("recipe-match-test");
mod._compile(
  stub +
    load("js/data-consumables.js") +
    load("js/recipes.js") +
    load("js/recipes-rare-potions.js") +
    load("js/recipes-dragon-potions.js") +
    "\nmodule.exports = { CONSUMABLES, BUNDLED_RECIPES };",
  "recipe-match-test.js"
);
const { CONSUMABLES, BUNDLED_RECIPES } = mod.exports;

// ── Parse items.xml base recipes (attribute-order-independent) ──
// Per <craftresource>, pull uniquename/count/maxreturnamount in any order — the
// game data is inconsistent about attribute order (the Avalon token lists
// maxreturnamount before count).
const xml = load("data/dumps/items.xml");
const blocks = xml.match(/<consumableitem\b[\s\S]*?<\/consumableitem>/g) || [];
const itemsXmlRecipes = {};
for (const b of blocks) {
  const id = (b.match(/uniquename="([^"]+)"/) || [])[1];
  if (!id) continue;
  // base requirement = first <craftingrequirements> (enchant level 0)
  const base = (b.match(/<craftingrequirements\b[^>]*>[\s\S]*?<\/craftingrequirements>/) || [])[0] || "";
  const mats = [];
  for (const tag of base.match(/<craftresource\b[^>]*\/?>/g) || []) {
    const u = (tag.match(/uniquename="([^"]+)"/) || [])[1];
    const c = (tag.match(/count="(\d+)"/) || [])[1];
    if (!u) continue;
    mats.push({ matId: u, count: parseInt(c, 10), noReturn: /maxreturnamount="0"/.test(tag) });
  }
  if (mats.length) itemsXmlRecipes[id] = mats;
}

// Normalize a recipe to a comparable signature (sorted matId:count[:NR]).
const sig = (recipe) =>
  recipe
    .map((m) => `${m.matId}:${m.count}${m.noReturn ? ":NR" : ""}`)
    .sort()
    .join(" | ");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.error(`  FAIL: ${name}\n    ${e.message}`); }
}

// Every CONSUMABLES item that exists as a <consumableitem> in items.xml must
// have a matching recipe. (Fish-sauce upgrade mats are <simpleitem>, not
// <consumableitem>, so they're absent here and intentionally skipped.)
const checked = [];
console.log("\n=== BUNDLED_RECIPES matches items.xml for every consumable ===");
for (const c of CONSUMABLES) {
  const xmlRecipe = itemsXmlRecipes[c.id];
  if (!xmlRecipe) continue; // raw flips / fish-sauce simpleitems — no consumableitem recipe
  checked.push(c.id);
  test(`${c.id} recipe matches items.xml`, () => {
    const ours = BUNDLED_RECIPES[c.id];
    assert.ok(ours, `${c.id} is craftable in items.xml but missing from BUNDLED_RECIPES`);
    assert.strictEqual(
      sig(ours),
      sig(xmlRecipe),
      `${c.id} recipe drifted from items.xml\n      ours: ${sig(ours)}\n      xml : ${sig(xmlRecipe)}`
    );
  });
}

// Guard the specific bug the user reported: no rock/stone in Resistance potions.
console.log("\n=== Regression: Resistance potions contain no rock/limestone ===");
for (const id of ["T3_POTION_STONESKIN", "T5_POTION_STONESKIN", "T7_POTION_STONESKIN"]) {
  test(`${id} has no _ROCK ingredient`, () => {
    const ours = BUNDLED_RECIPES[id] || [];
    const rock = ours.find((m) => /_ROCK$/.test(m.matId));
    assert.ok(!rock, `${id} still lists ${rock && rock.matId} — stale recipe`);
  });
}

// Sanity: we actually checked a meaningful number of recipes (not silently zero).
console.log("\n=== Coverage ===");
test("checked at least 60 consumable recipes against items.xml", () => {
  assert.ok(checked.length >= 60, `only checked ${checked.length} recipes`);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed} | Recipes checked: ${checked.length}`);
if (failed > 0) process.exit(1);
