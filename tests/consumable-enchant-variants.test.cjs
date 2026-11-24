/**
 * Test: Consumable enchant variants (.1 / .2 / .3) for T4+ items.
 * - Variant generation derives ids from base CONSUMABLES.
 * - Variants inherit the base recipe (fishsauce/extract is non-tradeable and
 *   excluded — same convention as recipes.js).
 * - Only craftable T4+ items get variants (raw flips and T1-T3 pass through
 *   unchanged).
 *
 * Run: node tests/consumable-enchant-variants.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function load(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const stubs = `
function getTierFromId(id) {
  const m = id.match(/^T(\\d)/);
  return m ? parseInt(m[1], 10) : 0;
}
`;

const dataConsumablesSrc = load("js/data-consumables.js");
const recipesSrc = load("js/recipes.js");
const sauceSrc = load("js/data-enchant-sauces.js");
// The variant generator lives in its own module (extracted from
// render-consumables.js for the 800-line cap); load it verbatim.
const variantsSrc = load("js/consumable-enchant-variants.js");
const renderSrc = (load("js/render-consumables.js") + load("js/render-consumables-row.js"));
// Pull just the helper that generates variants.
const helperEnd = renderSrc.indexOf("function renderConsumableTable");
const helperBlock = renderSrc.slice(0, helperEnd);

const mod = new Module("enchant-variant-test");
mod._compile(
  stubs + dataConsumablesSrc + recipesSrc + sauceSrc + variantsSrc + helperBlock +
  "\nmodule.exports = { generateConsumableEnchantVariants, CONSUMABLES, BUNDLED_RECIPES, ENCHANT_UPGRADE_SAUCE };",
  "render-consumables.js"
);
const { generateConsumableEnchantVariants, CONSUMABLES, ENCHANT_UPGRADE_SAUCE } = mod.exports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== generateConsumableEnchantVariants — basic shape ===");
test("returns an array", () => {
  const out = generateConsumableEnchantVariants(CONSUMABLES);
  assert.ok(Array.isArray(out));
});

test("includes every base CONSUMABLES entry", () => {
  const out = generateConsumableEnchantVariants(CONSUMABLES);
  const ids = new Set(out.map((c) => c.id));
  for (const base of CONSUMABLES) assert.ok(ids.has(base.id), `${base.id} missing`);
});

console.log("\n=== Variant generation rules ===");
test("T4+ recipe items get .1 / .2 / .3 variants", () => {
  const out = generateConsumableEnchantVariants(CONSUMABLES);
  const ids = new Set(out.map((c) => c.id));
  // T8 fish sandwich has a recipe and tier 8
  for (const lvl of [1, 2, 3]) {
    assert.ok(ids.has(`T8_MEAL_SANDWICH_FISH@${lvl}`),
      `T8_MEAL_SANDWICH_FISH@${lvl} missing`);
  }
});

test("variant name follows '<base name> [.N]' format", () => {
  const out = generateConsumableEnchantVariants(CONSUMABLES);
  const v1 = out.find((c) => c.id === "T8_MEAL_SANDWICH_FISH@1");
  assert.ok(v1, "T8_MEAL_SANDWICH_FISH@1 missing");
  assert.ok(/\[\.1\]/.test(v1.name),
    `name should include [.1], got "${v1.name}"`);
});

test("variant carries baseId for collapse-by-base lookup", () => {
  const out = generateConsumableEnchantVariants(CONSUMABLES);
  const v2 = out.find((c) => c.id === "T8_MEAL_SANDWICH_FISH@2");
  assert.strictEqual(v2.baseId, "T8_MEAL_SANDWICH_FISH");
});

test("T1-T3 raw flips do NOT spawn enchant variants", () => {
  const out = generateConsumableEnchantVariants(CONSUMABLES);
  const ids = new Set(out.map((c) => c.id));
  // Raw meat is a leaf item (no recipe); should not be variant-expanded
  // even though T8_MEAT is tier 8 — variants only apply to recipe items.
  assert.ok(!ids.has("T3_WHEAT@1"), "raw crops shouldn't enchant");
  assert.ok(!ids.has("T8_MEAT@1"), "raw meat shouldn't enchant");
  assert.ok(!ids.has("T8_MILK@1"), "raw dairy shouldn't enchant");
  // T1-T3 craftable items also stay base only (matches gear convention)
  assert.ok(!ids.has("T1_MEAL_SOUP@1"), "T1 carrot soup shouldn't enchant");
  assert.ok(!ids.has("T1_MEAL_SOUP_FISH@1"), "T1 fish soup shouldn't enchant");
  assert.ok(!ids.has("T2_MEAL_SALAD@1"), "T2 salad shouldn't enchant");
  assert.ok(!ids.has("T3_MEAL_PIE@1"), "T3 pie shouldn't enchant");
});

test("T4+ meals spawn .1 / .2 / .3 (three enchant levels exist in items.xml)", () => {
  const out = generateConsumableEnchantVariants(CONSUMABLES);
  const ids = new Set(out.map((c) => c.id));
  for (const lvl of [1, 2, 3]) {
    assert.ok(ids.has(`T4_MEAL_STEW@${lvl}`),
      `T4_MEAL_STEW@${lvl} missing`);
    assert.ok(ids.has(`T8_MEAL_SANDWICH_FISH@${lvl}`),
      `T8_MEAL_SANDWICH_FISH@${lvl} missing`);
  }
});

test("Potions spawn .1 / .2 / .3 — every potion upgrades with Arcane Extract", () => {
  const out = generateConsumableEnchantVariants(CONSUMABLES);
  const ids = new Set(out.map((c) => c.id));
  for (const lvl of [1, 2, 3]) {
    assert.ok(ids.has(`T4_POTION_HEAL@${lvl}`), `T4_POTION_HEAL@${lvl} missing`);
    assert.ok(ids.has(`T7_POTION_REVIVE@${lvl}`), `T7_POTION_REVIVE@${lvl} missing`);
    // Invisibility Potion — the reported gap: it enchants to .3, not .1 only.
    assert.ok(ids.has(`T8_POTION_CLEANSE@${lvl}`), `T8_POTION_CLEANSE@${lvl} missing`);
  }
});

console.log("\n=== Recipe inheritance & enchant sauce ===");
test("variant carries enchantSauce metadata (food → fishsauce of matching level)", () => {
  const out = generateConsumableEnchantVariants(CONSUMABLES);
  const v = out.find((c) => c.id === "T8_MEAL_SANDWICH_FISH@2");
  assert.ok(v);
  assert.strictEqual(v.enchantLevel, 2);
  assert.deepStrictEqual(v.enchantSauce, {
    matId: "T1_FISHSAUCE_LEVEL2",
    count: 27,
  });
});

test("potion variant carries the Arcane Extract of its enchant level", () => {
  const out = generateConsumableEnchantVariants(CONSUMABLES);
  const v = out.find((c) => c.id === "T6_POTION_HEAL@1");
  assert.ok(v);
  assert.deepStrictEqual(v.enchantSauce, {
    matId: "T1_ALCHEMY_EXTRACT_LEVEL1",
    count: 9,
  });
  const inv = out.find((c) => c.id === "T8_POTION_CLEANSE@3");
  assert.ok(inv);
  assert.deepStrictEqual(inv.enchantSauce, {
    matId: "T1_ALCHEMY_EXTRACT_LEVEL3",
    count: 9,
  });
});

test("ENCHANT_UPGRADE_SAUCE matches every variant we emit (no orphan sauces)", () => {
  const out = generateConsumableEnchantVariants(CONSUMABLES);
  const variants = out.filter((c) => c.id.includes("@"));
  for (const v of variants) {
    const ups = ENCHANT_UPGRADE_SAUCE[v.baseId];
    assert.ok(ups, `${v.baseId} missing from ENCHANT_UPGRADE_SAUCE`);
    const found = ups.find((u) => u.level === v.enchantLevel);
    assert.ok(found, `${v.id} has no matching upgrade entry`);
  }
});

console.log("\n=== Idempotency ===");
test("running twice on its own output is a no-op", () => {
  const once = generateConsumableEnchantVariants(CONSUMABLES);
  const twice = generateConsumableEnchantVariants(once);
  assert.strictEqual(once.length, twice.length,
    "second pass should not add new variants");
});

// ── Summary ──
console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
