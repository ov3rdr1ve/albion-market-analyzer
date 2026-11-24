/**
 * Test: consumable recipes yield a BATCH (amountcrafted) per craft, and the
 * cooking/potion craft branch must cost materials PER OUTPUT UNIT.
 *
 * Bug being fixed: render-consumables.js' craft branch summed material counts
 * over the full per-craft recipe (e.g. T4_MEAL_SALAD = 24 turnip + 24 wheat)
 * but compared that against ONE unit's sale price — implicitly assuming
 * amountcrafted=1. items.xml says salads yield 10/craft, heal potions 5, and
 * single-ingredient foods 1. The result: every batch-yield meal/potion showed a
 * ~10×/5× false loss and was hidden from the table.
 *
 * The fix introduces getRecipeOutput(itemId) (reads generated CONSUMABLE_OUTPUT,
 * default 1, strips @enchant suffix) and divides material costs by it so the row
 * is priced per single unit — consistent with the per-unit focus cost (168 base)
 * and the per-unit sale price.
 *
 * Black-box: we assert (a) getRecipeOutput returns the items.xml amountcrafted,
 * (b) the generated map stays in sync with items.xml, and (c) the per-unit
 * economics flips a falsely-negative batch row to its true (positive) value.
 *
 * Run: node tests/consumable-amountcrafted.test.cjs
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

function loadFileContent(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf-8");
}

// ── Load CONSUMABLE_OUTPUT + getRecipeOutput from the real source ──────────
const outputJson = JSON.parse(loadFileContent("js/consumable-output.json"));
const utilsSrc = (loadFileContent("js/utils.js") + loadFileContent("js/utils-item-ids.js") + loadFileContent("js/utils-overrides.js") + loadFileContent("js/utils-focus-fees.js"));
const { getRecipeOutput } = new Function(
  `const CONSUMABLE_OUTPUT = ${JSON.stringify(outputJson)};
   ${utilsSrc};
   return { getRecipeOutput };`
)();

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Consumable amountcrafted (batch yield) ===");

// ── (a) getRecipeOutput returns the in-game amountcrafted ──────────────────
const expectedOutputs = [
  ["T4_MEAL_SALAD", 10],      // Turnip Salad — the reported scenario
  ["T2_MEAL_SALAD", 10],
  ["T6_MEAL_SALAD", 10],
  ["T2_POTION_HEAL", 5],      // Heal potions yield 5
  ["T4_POTION_HEAL", 5],
  ["T3_POTION_MOB_RESET", 10],// Calming (rare) potion yields 10
  ["T1_MEAL_GRILLEDFISH", 1], // single-ingredient cooked food yields 1
  ["T1_MEAL_SEAWEEDSALAD", 1],
];
expectedOutputs.forEach(([id, n]) => {
  test(`getRecipeOutput(${id}) = ${n}`, () => {
    assert.strictEqual(getRecipeOutput(id), n);
  });
});

// Enchant variants reuse the base recipe → same batch yield via @-suffix strip.
test("getRecipeOutput strips @enchant suffix (T4_MEAL_SALAD@2 → 10)", () => {
  assert.strictEqual(getRecipeOutput("T4_MEAL_SALAD@2"), 10);
});

// Unknown / non-consumable ids default to 1 (no over-division).
test("getRecipeOutput defaults to 1 for unknown id", () => {
  assert.strictEqual(getRecipeOutput("T4_NOT_A_REAL_ITEM"), 1);
});
test("getRecipeOutput(undefined) = 1 (no crash)", () => {
  assert.strictEqual(getRecipeOutput(undefined), 1);
});

// ── (b) Generated map stays in sync with items.xml for every MEAL/POTION ───
const xml = loadFileContent("data/dumps/items.xml");
// Mirror the generator: anchor on the DEFINITION element (tag ends in "item",
// never a <craftresource> ref) and read amountcrafted from the first
// <craftingrequirements> opening tag only (absent attr → 1).
function itemsXmlAmountCrafted(id) {
  const m = xml.match(new RegExp(`<[a-z]+item[^>]*\\buniquename="${id}"[^>]*>([\\s\\S]{0,300})`));
  if (!m) return null;
  const crTag = m[1].match(/<craftingrequirements[^>]*>/);
  if (!crTag) return null; // not craftable
  const a = crTag[0].match(/amountcrafted="(\d+)"/);
  return a ? parseInt(a[1], 10) : 1;
}
const mealPotionIds = [
  ...new Set(
    [...xml.matchAll(/uniquename="(T[0-9]_(?:MEAL|POTION)_[A-Z0-9_]*)"/g)].map((m) => m[1])
  ),
].filter((id) => itemsXmlAmountCrafted(id) !== null);

test(`CONSUMABLE_OUTPUT matches items.xml for all ${mealPotionIds.length} MEAL/POTION recipes`, () => {
  const mismatches = [];
  for (const id of mealPotionIds) {
    const want = itemsXmlAmountCrafted(id);
    const got = getRecipeOutput(id);
    if (got !== want) mismatches.push(`${id}: map=${got} xml=${want}`);
  }
  assert.strictEqual(mismatches.length, 0, `mismatches:\n  ${mismatches.join("\n  ")}`);
});

// ── (c) Per-unit economics: the fix flips a false batch loss to true profit ─
// Mirrors the craft-branch formula: per-unit input cost = batch material cost
// divided by amountcrafted; revenue & focus are already per single unit.
const SETUP_FEE = 0.025, PREMIUM_TAX = 0.065;
function perUnitProfit({ recipe, prices, rrr, output, sellPrice }) {
  let batchCost = 0;
  recipe.forEach((m) => {
    const eff = (m.noReturn ? m.count : m.count * (1 - rrr));
    batchCost += prices[m.matId] * eff * (1 + SETUP_FEE);
  });
  const inputPerUnit = batchCost / output;
  const revenue = sellPrice * (1 - PREMIUM_TAX);
  return revenue - inputPerUnit;
}

const SALAD = {
  recipe: [{ matId: "T4_TURNIP", count: 24 }, { matId: "T3_WHEAT", count: 24 }],
  prices: { T4_TURNIP: 45, T3_WHEAT: 28 },
  rrr: 0.435,
  sellPrice: 300,
};

test("amountcrafted=1 (legacy bug) makes T4 salad a false loss", () => {
  const p = perUnitProfit({ ...SALAD, output: 1 });
  assert.ok(p < 0, `expected the buggy output=1 path to be negative, got ${p.toFixed(1)}`);
});

test("amountcrafted=10 makes T4 salad correctly profitable", () => {
  const p = perUnitProfit({ ...SALAD, output: 10 });
  assert.ok(p > 0, `expected positive per-unit profit at output=10, got ${p.toFixed(1)}`);
});

test("per-unit input cost scales as 1/output", () => {
  const one = perUnitProfit({ ...SALAD, output: 1 });
  const ten = perUnitProfit({ ...SALAD, output: 10 });
  const revenue = SALAD.sellPrice * (1 - PREMIUM_TAX);
  // (revenue - costBatch) vs (revenue - costBatch/10): the input portion is /10.
  const costBatch = revenue - one;
  const costPerUnit = revenue - ten;
  assert.ok(Math.abs(costPerUnit - costBatch / 10) < 1e-6,
    `per-unit cost ${costPerUnit.toFixed(2)} should equal batch ${costBatch.toFixed(2)} / 10`);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
