/**
 * Test: a consumable resolves its FULL recipe on a cold recipeCache.
 *
 * Bug (reported): rows added to the Crafting List from the Consumables table
 * (Minor Poison Potion, Avalonian Beef Sandwich, the Avalonian stews) came back
 * after a reload rendered as FLIP rows — "Buy: X -> Sell: Y" with a dash in the
 * Materials column — and contributed nothing to "Materials to Buy".
 *
 * Cause: render-consumables.js read `recipeCache[item.id]` directly. That cache
 * is only ever filled by fetchCraftingRecipe() from behind a scan button, but
 * renderAllTables() also runs at boot (js/app.js) once persisted + captured
 * prices are restored — with an EMPTY cache. Every consumable then fell into
 * the "no recipe" flip branch. Same bug class as the crafting table's, fixed
 * there by js/recipe-resolver.js (tests/crafting-materials-cold-cache).
 *
 * Fix: resolveConsumableRecipe() in js/recipe-resolver.js — cache, then the
 * bundled catalog, plus the derived `@n` enchant variants (base recipe + the
 * enchant sauce) that exist nowhere but the cache.
 *
 * Black-box: compiles the real js/ sources and calls the real global. No live
 * API or DB.
 *
 * Run: node tests/consumable-recipe-cold-cache.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
function getTierFromId(id) { const m = id.match(/^T(\\d)/); return m ? parseInt(m[1], 10) : 0; }
let recipeCache = {};          // ← the cold cache: exactly the boot-render state
`;

/** Compile the resolver with (or deliberately without) the bundled catalog. */
function build({ withBundled = true, withCache = true } = {}) {
  const renderSrc = (J("render-consumables.js") + J("render-consumables-row.js"));
  // Only the helper block — renderConsumableTable itself needs the whole app.
  const helperBlock = renderSrc.slice(0, renderSrc.indexOf("function renderConsumableTable"));
  // The variant generator was extracted to its own module for the 800-line cap.
  const variantsSrc = J("consumable-enchant-variants.js");

  const sources =
    (withBundled ? J("recipes.js") : "") +
    J("data-consumables.js") +
    J("data-enchant-sauces.js") +
    J("recipe-resolver.js") +
    variantsSrc +
    helperBlock;

  const mod = new Module(`consumable-cold-${withBundled}-${withCache}`);
  mod._compile(
    (withCache ? stubs : stubs.replace(/^let recipeCache.*$/m, "")) +
      sources +
      "\nmodule.exports = { resolveConsumableRecipe, resolveRecipeById, CONSUMABLES," +
      " generateConsumableEnchantVariants," +
      " BUNDLED_RECIPES: typeof BUNDLED_RECIPES !== 'undefined' ? BUNDLED_RECIPES : null," +
      " peekCache: (id) => (typeof recipeCache !== 'undefined' ? recipeCache[id] : undefined)," +
      " seedCache: (id, r) => { if (typeof recipeCache !== 'undefined') recipeCache[id] = r; }," +
      " clearCache: () => { if (typeof recipeCache !== 'undefined') recipeCache = {}; } };",
    "consumable-recipe-cold-cache.js"
  );
  return mod.exports;
}

const APP = build();
const {
  resolveConsumableRecipe, CONSUMABLES, BUNDLED_RECIPES, generateConsumableEnchantVariants,
} = APP;

const sig = (mats) => (mats || []).map((m) => `${m.matId}:${m.count}`).sort().join(" | ");
const byId = (id) => CONSUMABLES.find((c) => c.id === id);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.error(`  FAIL: ${name}\n    ${e.message}`); }
}

// ── 1. The reported rows resolve cold ────────────────────────────────────
console.log("\n=== Reported rows resolve on a cold cache ===");
const REPORTED = [
  "T4_POTION_COOLDOWN",        // Minor Poison Potion
  "T8_MEAL_SANDWICH_AVALON",   // Avalonian Beef Sandwich
  "T8_MEAL_STEW_AVALON",       // Avalonian Beef Stew
  "T6_MEAL_STEW_AVALON",       // Avalonian Mutton Stew
  "T4_MEAL_STEW_AVALON",       // Avalonian Goat Stew
];
REPORTED.forEach((id) => {
  test(`${id} resolves to its full bundled recipe before any scan`, () => {
    APP.clearCache();
    const item = byId(id);
    assert.ok(item, `${id} missing from CONSUMABLES`);
    const mats = resolveConsumableRecipe(item);
    assert.ok(Array.isArray(mats) && mats.length > 0, `${id} resolved to nothing on a cold cache`);
    assert.strictEqual(sig(mats), sig(BUNDLED_RECIPES[id]));
  });
});

// ── 2. Every bundled-backed consumable, cold ─────────────────────────────
console.log("\n=== Every bundled-backed CONSUMABLES entry resolves in full ===");
const bundledBacked = CONSUMABLES.filter((c) => BUNDLED_RECIPES[c.id]);
test("the consumable catalog is actually covered (not silently zero)", () => {
  assert.ok(bundledBacked.length >= 50, `only ${bundledBacked.length} entries have a bundled recipe`);
});
bundledBacked.forEach((item) => {
  test(`${item.id} cold === bundled`, () => {
    APP.clearCache();
    assert.strictEqual(sig(resolveConsumableRecipe(item)), sig(BUNDLED_RECIPES[item.id]));
  });
});

// ── 3. Recipe-less ingredients must STAY recipe-less (flip rows) ─────────
console.log("\n=== Raw ingredients stay recipe-less so they still render as flips ===");
// resolveItemRecipe would fall back to item.materials / item.matId here and
// invent a bogus single-material craft row; the consumable path must not.
const RAW_FLIPS = ["T8_MEAT", "T3_WHEAT", "QUESTITEM_TOKEN_AVALON", "T6_ALCOHOL", "T8_MILK"];
RAW_FLIPS.forEach((id) => {
  test(`${id} resolves to nothing`, () => {
    APP.clearCache();
    const item = byId(id);
    assert.ok(item, `${id} missing from CONSUMABLES`);
    const mats = resolveConsumableRecipe(item);
    assert.ok(!mats || mats.length === 0, `${id} invented a recipe: ${sig(mats)}`);
  });
});

// ── 4. Derived @n enchant variants ───────────────────────────────────────
console.log("\n=== Derived @n variants: base recipe + enchant sauce ===");
const variants = generateConsumableEnchantVariants(CONSUMABLES).filter((c) => c.id.includes("@"));
const VARIANT_CASES = ["T8_MEAL_SANDWICH_AVALON@2", "T4_POTION_COOLDOWN@1", "T8_MEAL_STEW_AVALON@3"];
VARIANT_CASES.forEach((vid) => {
  test(`${vid} = base recipe + its sauce, cold`, () => {
    APP.clearCache();
    const v = variants.find((c) => c.id === vid);
    assert.ok(v, `${vid} not generated`);
    const mats = resolveConsumableRecipe(v);
    assert.ok(Array.isArray(mats) && mats.length > 0, `${vid} resolved to nothing`);
    const base = BUNDLED_RECIPES[v.baseId];
    assert.strictEqual(mats.length, base.length + 1, "expected exactly one extra sauce line");
    const sauce = mats[mats.length - 1];
    assert.strictEqual(sauce.matId, v.enchantSauce.matId);
    assert.strictEqual(sauce.count, v.enchantSauce.count);
    assert.strictEqual(sauce.noReturn, true, "the sauce is not refunded by city RRR");
    assert.strictEqual(sauce.isEnchantSauce, true);
  });
});

test("every generated variant resolves cold", () => {
  APP.clearCache();
  const dead = variants.filter((v) => {
    const m = resolveConsumableRecipe(v);
    return !Array.isArray(m) || m.length === 0;
  });
  assert.strictEqual(dead.length, 0, `${dead.length} variants resolved to nothing, e.g. ${dead[0] && dead[0].id}`);
});

test("a derived variant is memoized into recipeCache (nothing else knows it)", () => {
  APP.clearCache();
  const v = variants.find((c) => c.id === "T8_MEAL_SANDWICH_AVALON@2");
  assert.strictEqual(APP.peekCache(v.id), undefined, "precondition: cache is cold");
  resolveConsumableRecipe(v);
  assert.ok(Array.isArray(APP.peekCache(v.id)), "variant recipe was not written back to recipeCache");
});

// ── 5. Scan order must not change the answer ─────────────────────────────
console.log("\n=== Scan order independence ===");
[...bundledBacked, ...variants].forEach((item) => {
  test(`${item.id} resolves identically cold and warm`, () => {
    APP.clearCache();
    const cold = sig(resolveConsumableRecipe(item));
    APP.clearCache();
    // Warm = what fetchCraftingRecipe() would have put there (js/api.js).
    if (BUNDLED_RECIPES[item.id]) APP.seedCache(item.id, BUNDLED_RECIPES[item.id]);
    if (item.baseId && BUNDLED_RECIPES[item.baseId]) APP.seedCache(item.baseId, BUNDLED_RECIPES[item.baseId]);
    const warm = sig(resolveConsumableRecipe(item));
    APP.clearCache();
    assert.strictEqual(cold, warm, `${item.id} changes depending on whether a scan ran first`);
  });
});

test("a seeded cache entry still wins over the bundled recipe", () => {
  APP.clearCache();
  APP.seedCache("T8_MEAL_STEW_AVALON", [{ matId: "T8_DERIVED", count: 1 }]);
  const mats = resolveConsumableRecipe(byId("T8_MEAL_STEW_AVALON"));
  APP.clearCache();
  assert.strictEqual(sig(mats), "T8_DERIVED:1");
});

// ── 6. Degenerate sandboxes must not throw ───────────────────────────────
console.log("\n=== Degenerate sandboxes ===");
test("no BUNDLED_RECIPES at all → null, no throw", () => {
  const bare = build({ withBundled: false });
  assert.strictEqual(bare.BUNDLED_RECIPES, null, "precondition: bundled catalog not loaded");
  const stew = bare.CONSUMABLES.find((c) => c.id === "T8_MEAL_STEW_AVALON");
  const mats = bare.resolveConsumableRecipe(stew);
  assert.ok(!mats || mats.length === 0);
});
test("no recipeCache global → still resolves from the bundle, no throw", () => {
  const noCache = build({ withCache: false });
  const stew = noCache.CONSUMABLES.find((c) => c.id === "T8_MEAL_STEW_AVALON");
  assert.strictEqual(
    sig(noCache.resolveConsumableRecipe(stew)),
    sig(noCache.BUNDLED_RECIPES["T8_MEAL_STEW_AVALON"])
  );
});
test("null/undefined item → null, no throw", () => {
  assert.ok(!resolveConsumableRecipe(null));
  assert.ok(!resolveConsumableRecipe(undefined));
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
