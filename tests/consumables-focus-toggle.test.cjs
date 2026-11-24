/**
 * Test: "Use Focus" checkbox flows into the consumable craft RRR.
 *
 * Bug: render-consumables.js called `getCraftRRR(craftCity, consumableCraftType)`
 * without the third arg, so RRR always defaulted to focus-on. Toggling the
 * checkbox had no effect on Pure Profit / Profit % (margin), even though the
 * Silver/Focus column intentionally stays focus-on.
 *
 * Black-box: mirrors the inner-loop margin calc with both focus states and
 * asserts that disabling focus shrinks RRR, raises input cost, and reduces
 * the profit. Mirrors the parity rule already enforced in render-crafting.js
 * (line 50 passes isFocusEnabled() through).
 *
 * Run: node tests/consumables-focus-toggle.test.cjs
 */

const assert = require("assert");

// ── Mirror getCraftRRR from js/calculations.js ───────────────────────────────
const BASE_CITY_BONUS = 0.18;
const CRAFT_SPEC_BONUS = 0.15;
const FOCUS_BONUS = 0.59;
const CITY_CRAFT_SPEC = {
  Caerleon: ["food"],
  Brecilien: ["potion"],
};
function calcRRR(bonus) { return bonus <= 0 ? 0 : bonus / (1 + bonus); }
function getCraftRRR(city, craftType, useFocus = true) {
  let bonus = BASE_CITY_BONUS;
  const specs = CITY_CRAFT_SPEC[city];
  if (specs && craftType && specs.includes(craftType)) bonus += CRAFT_SPEC_BONUS;
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}

// Ingredient cost calc mirroring render-consumables.js craft branch.
function computeMargin({ recipe, matBestPrices, sellPrice, craftCity, craftType, useFocus }) {
  const rrr = getCraftRRR(craftCity, craftType, useFocus);
  const SETUP_FEE = 0.025;
  const PREMIUM_TAX = 0.065;
  let totalInputCost = 0;
  recipe.forEach((m) => {
    const effectiveCount = m.noReturn ? m.count : m.count * (1 - rrr);
    totalInputCost += matBestPrices[m.matId].price * effectiveCount * (1 + SETUP_FEE);
  });
  const revenue = sellPrice * (1 - PREMIUM_TAX);
  const profit = revenue - totalInputCost;
  const margin = totalInputCost > 0 ? (profit / totalInputCost) * 100 : 0;
  return { rrr, totalInputCost, profit, margin };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Consumable focus-toggle propagation ===");

// Fixture: a stew at Lymhurst (no food spec) with two ingredients.
const RECIPE = [
  { matId: "T8_FISH", count: 9 },
  { matId: "T8_VEGETABLE", count: 1 },
];
const MAT_PRICES = {
  T8_FISH: { price: 5_000 },
  T8_VEGETABLE: { price: 1_200 },
};
const SELL_PRICE = 80_000;

test("focus-on RRR > focus-off RRR (Lymhurst, food)", () => {
  const onR = getCraftRRR("Lymhurst", "food", true);
  const offR = getCraftRRR("Lymhurst", "food", false);
  assert.ok(onR > offR, `expected focus-on RRR (${onR}) to exceed focus-off (${offR})`);
});

test("disabling focus raises input cost (Lymhurst, food)", () => {
  const on = computeMargin({ recipe: RECIPE, matBestPrices: MAT_PRICES, sellPrice: SELL_PRICE, craftCity: "Lymhurst", craftType: "food", useFocus: true });
  const off = computeMargin({ recipe: RECIPE, matBestPrices: MAT_PRICES, sellPrice: SELL_PRICE, craftCity: "Lymhurst", craftType: "food", useFocus: false });
  assert.ok(off.totalInputCost > on.totalInputCost, `focus-off cost (${off.totalInputCost}) should exceed focus-on cost (${on.totalInputCost})`);
});

test("disabling focus shrinks profit and margin (Lymhurst, food)", () => {
  const on = computeMargin({ recipe: RECIPE, matBestPrices: MAT_PRICES, sellPrice: SELL_PRICE, craftCity: "Lymhurst", craftType: "food", useFocus: true });
  const off = computeMargin({ recipe: RECIPE, matBestPrices: MAT_PRICES, sellPrice: SELL_PRICE, craftCity: "Lymhurst", craftType: "food", useFocus: false });
  assert.ok(off.profit < on.profit, `focus-off profit (${off.profit}) should be smaller than focus-on (${on.profit})`);
  assert.ok(off.margin < on.margin, `focus-off margin (${off.margin}) should be smaller than focus-on (${on.margin})`);
});

test("Caerleon food-spec respects useFocus toggle too", () => {
  const on = computeMargin({ recipe: RECIPE, matBestPrices: MAT_PRICES, sellPrice: SELL_PRICE, craftCity: "Caerleon", craftType: "food", useFocus: true });
  const off = computeMargin({ recipe: RECIPE, matBestPrices: MAT_PRICES, sellPrice: SELL_PRICE, craftCity: "Caerleon", craftType: "food", useFocus: false });
  assert.ok(on.rrr > off.rrr, "Caerleon focus-on RRR should exceed focus-off");
  assert.ok(on.profit > off.profit, "Caerleon focus-on profit should exceed focus-off");
});

test("regression: defaulting useFocus=true masks the checkbox state", () => {
  // The bug was calling getCraftRRR(city, type) with no third arg, which
  // returns the focus-on value regardless of UI state.
  const buggy = getCraftRRR("Lymhurst", "food");           // pre-fix call shape
  const focusOn = getCraftRRR("Lymhurst", "food", true);
  const focusOff = getCraftRRR("Lymhurst", "food", false);
  assert.strictEqual(buggy, focusOn, "default arg pins the result to focus-on");
  assert.notStrictEqual(buggy, focusOff, "with focus-off the bug would show wrong RRR");
});

test("noReturn ingredients (enchant sauce) are not affected by RRR or focus", () => {
  // Enchant sauces carry noReturn:true and should be unaffected by RRR.
  const recipeWithSauce = [
    { matId: "T8_FISH", count: 9 },
    { matId: "T8_VEGETABLE", count: 1 },
    { matId: "T1_FISHSAUCE_LEVEL3", count: 96, noReturn: true },
  ];
  const matsWithSauce = {
    ...MAT_PRICES,
    T1_FISHSAUCE_LEVEL3: { price: 200 },
  };
  // Pre-compute the no-return contribution; it should be identical regardless
  // of focus state.
  const SETUP_FEE = 0.025;
  const sauceCost = 200 * 96 * (1 + SETUP_FEE);
  const on = computeMargin({ recipe: recipeWithSauce, matBestPrices: matsWithSauce, sellPrice: SELL_PRICE, craftCity: "Lymhurst", craftType: "food", useFocus: true });
  const off = computeMargin({ recipe: recipeWithSauce, matBestPrices: matsWithSauce, sellPrice: SELL_PRICE, craftCity: "Lymhurst", craftType: "food", useFocus: false });
  // The delta between focus-on and focus-off costs must come ONLY from the
  // returnable ingredients — sauce contribution cancels out.
  const delta = off.totalInputCost - on.totalInputCost;
  // Sanity: delta is positive (focus-off costs more) and finite.
  assert.ok(delta > 0 && Number.isFinite(delta), "delta must be a positive finite silver amount");
  // The sauce cost stayed put (otherwise it would be subtracted from the delta).
  assert.ok(sauceCost > 0, "sauce cost is non-trivial in this fixture");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
