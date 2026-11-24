/**
 * Test: getCraftingMaterials returns the FULL recipe on a cold recipeCache.
 *
 * Bug (reported): the Crafting Planner showed "Elder's Bed = 10x Elder's
 * Planks". The real recipe is 10 planks + 20 CLOTH. renderAllTables() runs at
 * boot (js/app.js) once persisted + captured prices are restored, long before
 * any scan has called fetchCraftingRecipe(), so recipeCache was empty and
 * getCraftingMaterials fell through to the single-material legacy line. The
 * furniture entries in CRAFTING_ITEMS carry only their PRIMARY material by
 * design ("full recipe in BUNDLED_RECIPES"), so half of every furniture recipe
 * vanished: understated material cost, overstated profit, wrong journal fame.
 *
 * Fix: js/recipe-resolver.js reads BUNDLED_RECIPES directly. The cache is only
 * ever a copy of that bundled constant, so scan order can no longer change what
 * a table renders.
 *
 * Black-box: compiles the real js/ sources with a cold `recipeCache` and calls
 * the real global. No live API/DB.
 *
 * Run: node tests/crafting-materials-cold-cache.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const _els = {};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
// City lists come from the real js/data.js below — this harness loads the whole
// catalog, unlike crafting-thin-volume-gate which stubs them.
const FOCUS_COSTS = {};
let recipeCache = {};          // ← the cold cache: exactly the boot-render state
let lastMarketData = null;
`;

/** Compile the app with (or deliberately without) the bundled recipe catalog. */
function build({ withBundled = true } = {}) {
  const sources =
    (withBundled ? J("recipes.js") : "") +
    J("data.js") +
    J("recipe-resolver.js") +
    J("data-city-bonuses.js") +
    (J("calculations.js") + J("calculations-margins.js")) +
    J("travel-cost.js") +
    (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
    J("render-crafting.js");

  const mod = new Module("cold-cache-" + (withBundled ? "full" : "bare"));
  mod._compile(
    stubs +
      sources +
      "\nmodule.exports = { getCraftingMaterials, CRAFTING_ITEMS," +
      " BUNDLED_RECIPES: typeof BUNDLED_RECIPES !== 'undefined' ? BUNDLED_RECIPES : null," +
      " seedCache: (id, r) => { recipeCache[id] = r; }, clearCache: () => { recipeCache = {}; } };",
    "cold-cache.js"
  );
  return mod.exports;
}

const APP = build();
const { getCraftingMaterials, CRAFTING_ITEMS, BUNDLED_RECIPES } = APP;

const sig = (mats) => (mats || []).map((m) => `${m.matId}:${m.count}`).sort().join(" | ");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.error(`  FAIL: ${name}\n    ${e.message}`); }
}

// ── 1. Cold cache returns the bundled recipe, for every catalog entry ─────
console.log("\n=== Cold cache: every CRAFTING_ITEMS entry with a bundled recipe resolves in full ===");
const bundledBacked = CRAFTING_ITEMS.filter((i) => BUNDLED_RECIPES[i.id]);
for (const item of bundledBacked) {
  test(`${item.id} resolves to its full bundled recipe on a cold cache`, () => {
    APP.clearCache();
    assert.strictEqual(
      sig(getCraftingMaterials(item)),
      sig(BUNDLED_RECIPES[item.id]),
      `${item.id} rendered a partial recipe before any scan`
    );
  });
}
test("the furniture catalog is actually covered (not silently zero)", () => {
  assert.ok(bundledBacked.length >= 17, `only ${bundledBacked.length} CRAFTING_ITEMS entries have a bundled recipe`);
});

// ── Named regressions ────────────────────────────────────────────────────
console.log("\n=== Named regressions ===");
const byId = (id) => CRAFTING_ITEMS.find((i) => i.id === id);
test("Elder's Bed is 10 planks AND 20 cloth", () => {
  APP.clearCache();
  assert.strictEqual(sig(getCraftingMaterials(byId("T8_FURNITUREITEM_BED"))), "T8_CLOTH:20 | T8_PLANKS:10");
});
test("Trophy Shark keeps its planks and metal bars", () => {
  APP.clearCache();
  assert.strictEqual(
    sig(getCraftingMaterials(byId("T8_FURNITUREITEM_TROPHY_FISHING_BOSS"))),
    "T8_FISH_SALTWATER_ALL_BOSS_SHARK:1 | T8_METALBAR:2 | T8_PLANKS:4"
  );
});
test("Elder's Table is 30 planks AND 30 cloth", () => {
  APP.clearCache();
  assert.strictEqual(sig(getCraftingMaterials(byId("T8_FURNITUREITEM_TABLE"))), "T8_CLOTH:30 | T8_PLANKS:30");
});

// ── 2. Cache order must not change the answer ────────────────────────────
console.log("\n=== Scan order independence ===");
for (const item of bundledBacked) {
  test(`${item.id} resolves identically cold and warm`, () => {
    APP.clearCache();
    const cold = sig(getCraftingMaterials(item));
    APP.seedCache(item.id, BUNDLED_RECIPES[item.id]);
    const warm = sig(getCraftingMaterials(item));
    APP.clearCache();
    assert.strictEqual(cold, warm, `${item.id} changes depending on whether a scan ran first`);
  });
}

// ── 3. item.materials is still honoured ──────────────────────────────────
console.log("\n=== item.materials still wins where there is no bundled recipe ===");
test("UNIQUE_HIDEOUT returns its own 6-material list", () => {
  APP.clearCache();
  const hideout = byId("UNIQUE_HIDEOUT");
  assert.ok(hideout, "UNIQUE_HIDEOUT missing from CRAFTING_ITEMS");
  assert.ok(!BUNDLED_RECIPES["UNIQUE_HIDEOUT"], "precondition: UNIQUE_HIDEOUT has no bundled recipe");
  const mats = getCraftingMaterials(hideout);
  assert.strictEqual(mats.length, 6);
  assert.ok(mats.some((m) => m.matId === "UNIQUE_GVGTOKEN_GENERIC" && m.count === 500));
});
test("a gear-shaped entry with materials and no bundled recipe returns materials", () => {
  APP.clearCache();
  const fixture = { id: "T4_FAKE_GEAR", materials: [{ matId: "T4_CLOTH", count: 16 }, { matId: "T4_PLANKS", count: 8 }] };
  assert.strictEqual(sig(getCraftingMaterials(fixture)), "T4_CLOTH:16 | T4_PLANKS:8");
});

// ── 4. Single-material legacy fallback still works ───────────────────────
console.log("\n=== Single-material fallback ===");
test("an entry with only matId/matCount still resolves", () => {
  APP.clearCache();
  assert.strictEqual(sig(getCraftingMaterials({ id: "T4_FAKE", matId: "T4_X", matCount: 3 })), "T4_X:3");
});

// ── 5. recipeCache still wins (derived @n consumable variants live only there) ──
console.log("\n=== recipeCache still takes precedence ===");
test("a seeded cache entry overrides the bundled recipe", () => {
  APP.clearCache();
  APP.seedCache("T8_FURNITUREITEM_BED", [{ matId: "T8_DERIVED", count: 1 }]);
  const mats = getCraftingMaterials(byId("T8_FURNITUREITEM_BED"));
  APP.clearCache();
  assert.strictEqual(sig(mats), "T8_DERIVED:1", "derived @n variants written into recipeCache must still win");
});

// ── 6. No BUNDLED_RECIPES at all must not throw ──────────────────────────
console.log("\n=== Sandbox without BUNDLED_RECIPES ===");
test("compiles and resolves with BUNDLED_RECIPES undefined", () => {
  const bare = build({ withBundled: false });
  assert.strictEqual(bare.BUNDLED_RECIPES, null, "precondition: bundled catalog not loaded");
  const mats = bare.getCraftingMaterials({ id: "T4_FAKE", matId: "T4_X", matCount: 3 });
  assert.strictEqual(sig(mats), "T4_X:3");
  const bed = bare.CRAFTING_ITEMS.find((i) => i.id === "T8_FURNITUREITEM_BED");
  assert.strictEqual(sig(bare.getCraftingMaterials(bed)), "T8_PLANKS:10", "falls back to the primary material only");
});

// ── 7. matId/matCount must survive: they are the cold-cache recipe fallback ──
console.log("\n=== matId is still the cold-cache recipe fallback ===");
test("every furniture CRAFTING_ITEMS entry keeps a truthy matId", () => {
  // resolveItemRecipe (js/recipe-resolver.js) falls through to [{matId, count:
  // matCount}] when BUNDLED_RECIPES has no entry — the case tested above.
  // Deleting matId would leave those rows with no recipe at all.
  const furniture = CRAFTING_ITEMS.filter((i) => /FURNITUREITEM/.test(i.id));
  assert.ok(furniture.length >= 17, `only found ${furniture.length} furniture entries`);
  for (const f of furniture) {
    assert.ok(f.matId, `${f.id} lost its matId`);
    assert.ok(f.matCount > 0, `${f.id} lost its matCount`);
  }
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
