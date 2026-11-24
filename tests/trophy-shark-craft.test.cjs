/**
 * Black-box tests for the Trophy Shark craft.
 *
 * T8_FURNITUREITEM_TROPHY_FISHING_BOSS is the ONLY craftable trophy of the 58 in
 * items.xml — every other trophy comes back from a laborer sent out with a full
 * trophy journal. It is also a GENERAL trophy: labourersaffected="all",
 * labourerhappiness="5", labourersperfurnitureitem="10". The fisherman trophy is
 * the Swordfish Trophy (T8_FURNITUREITEM_TROPHY_FISH, journal-only,
 * labourersaffected="fishing", happiness 10, 3 laborers) — the two must not be
 * conflated.
 *
 * Recipe (items.xml, verified against the dump in this repo): 1× T8 shark +
 * 4× T8 planks + 2× T8 metal bar, craftingfocus="0", amountcrafted="1".
 *
 * Run: node tests/trophy-shark-craft.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const { getCraftStation } = require("../js/data-craft-stations.js");

const SHARK = "T8_FURNITUREITEM_TROPHY_FISHING_BOSS";
const SWORDFISH = "T8_FURNITUREITEM_TROPHY_FISH";

let passed = 0,
  failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL: ${name}\n        ${e.message}`);
    failed++;
  }
}

// The crafting catalog is a browser global; compile data.js the same way the app
// loads it (no DOM), as the other catalog tests do.
const dataMod = new Module("crafting-catalog");
dataMod.paths = Module._nodeModulePaths(process.cwd());
dataMod._compile(
  fs.readFileSync(path.join(ROOT, "js", "data.js"), "utf8") +
    "\nmodule.exports = { CRAFTING_ITEMS };",
  "crafting-catalog.js",
);
const { CRAFTING_ITEMS } = dataMod.exports;

const recipeMod = new Module("bundled-recipes");
recipeMod.paths = Module._nodeModulePaths(process.cwd());
recipeMod._compile(
  fs.readFileSync(path.join(ROOT, "js", "recipes.js"), "utf8") +
    "\nmodule.exports = { BUNDLED_RECIPES };",
  "bundled-recipes.js",
);
const { BUNDLED_RECIPES } = recipeMod.exports;

console.log("Trophy Shark craft\n");

test("appears in the crafting catalog", () => {
  const row = CRAFTING_ITEMS.find((i) => i.id === SHARK);
  assert.ok(row, `${SHARK} missing from CRAFTING_ITEMS`);
  assert.strictEqual(row.name, "Trophy Shark");
});

test("recipe is 1 shark + 4 planks + 2 metal bars", () => {
  const recipe = BUNDLED_RECIPES[SHARK];
  assert.ok(recipe, `${SHARK} missing from BUNDLED_RECIPES`);
  assert.deepStrictEqual(recipe, [
    { matId: "T8_FISH_SALTWATER_ALL_BOSS_SHARK", count: 1 },
    { matId: "T8_PLANKS", count: 4 },
    { matId: "T8_METALBAR", count: 2 },
  ]);
});

test("costs no focus — items.xml gives it craftingfocus=0", () => {
  const focus = JSON.parse(fs.readFileSync(path.join(ROOT, "js", "focus-costs.json"), "utf8"));
  assert.ok(!focus[SHARK], `${SHARK} should carry no focus cost, got ${focus[SHARK]}`);
});

test("is crafted at the Toolmaker, like the other furniture", () => {
  assert.strictEqual(getCraftStation({ id: SHARK, craftType: null }), "toolmaker");
});

test("the Swordfish Trophy stays journal-only (no recipe)", () => {
  assert.ok(!BUNDLED_RECIPES[SWORDFISH], "the fisherman trophy must not be craftable");
  assert.ok(
    !CRAFTING_ITEMS.some((i) => i.id === SWORDFISH),
    "the fisherman trophy must not be in the crafting catalog",
  );
});

test("both trophies are named apart in the display map", () => {
  const names = fs.readFileSync(path.join(ROOT, "js", "item-names.js"), "utf8");
  assert.ok(names.includes(`${SHARK}: "Trophy Shark"`), "Trophy Shark name missing");
  assert.ok(names.includes(`${SWORDFISH}: "Swordfish Trophy"`), "Swordfish Trophy name missing");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
