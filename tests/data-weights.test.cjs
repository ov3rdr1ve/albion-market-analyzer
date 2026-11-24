/**
 * Test: generated weight table (js/data-weights.js) + its integration with
 * the travel-cost helper.
 *
 * Guards that scripts/extract-weights.js produced the real items.xml weights
 * for the Brecilien-produced finished-good families, and that travel-cost.js
 * picks them up through the same global it reads in the browser.
 *
 * If this fails after an items.xml refresh, re-run: node scripts/extract-weights.js
 *
 * Run: node tests/data-weights.test.cjs
 */
const assert = require("assert");

const dw = require("../js/data-weights.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.error(`  FAIL: ${name} — ${e.message}`); }
}
function approx(a, b, eps = 1e-6) {
  assert.ok(Math.abs(a - b) <= eps, `expected ${b}, got ${a}`);
}

console.log("Generated Weight Table Tests\n");

test("exports ITEM_WEIGHTS + ITEM_FT_FACTORS objects", () => {
  assert.ok(dw.ITEM_WEIGHTS && typeof dw.ITEM_WEIGHTS === "object");
  assert.ok(dw.ITEM_FT_FACTORS && typeof dw.ITEM_FT_FACTORS === "object");
});

// Real items.xml weights for the produced families.
const KNOWN = {
  T5_MEAL_SOUP: 7.56,   // food (heavy)
  T4_POTION_HEAL: 0.3,  // potion (light)
  T1_CARROT: 0.6,       // crop
  T4_TURNIP: 0.6,
  T8_PUMPKIN: 0.6,
  T3_EGG: 0.6,          // byproduct
  T4_MILK: 0.6,
  T2_AGARIC: 0.6,       // herb
};
Object.entries(KNOWN).forEach(([id, w]) => {
  test(`ITEM_WEIGHTS[${id}] = ${w}`, () => {
    approx(dw.ITEM_WEIGHTS[id], w);
  });
});

test("captured cape + bag weights (>0)", () => {
  assert.ok(dw.ITEM_WEIGHTS["T4_CAPE"] > 0, "expected T4_CAPE weight");
  assert.ok(dw.ITEM_WEIGHTS["T4_BAG"] > 0, "expected T4_BAG weight");
});

test("resources are NOT in the table (handled by formula)", () => {
  assert.strictEqual(dw.ITEM_WEIGHTS["T5_PLANKS"], undefined);
  assert.strictEqual(dw.ITEM_WEIGHTS["T5_ORE"], undefined);
});

// ── integration: travel-cost.js reads this table via the global it uses in
//    the browser (top-level const → global scope). We mirror that by setting
//    the globals before requiring the helper.
test("travel-cost helper resolves table weights end-to-end", () => {
  global.ITEM_WEIGHTS = dw.ITEM_WEIGHTS;
  global.ITEM_FT_FACTORS = dw.ITEM_FT_FACTORS;
  delete require.cache[require.resolve("../js/travel-cost.js")];
  const tc = require("../js/travel-cost.js");

  // Raw formula * Gold Market Stabilization (1.156) — matches the live
  // Travel Planner charge the player actually pays.
  const GMS = tc.GOLD_MARKET_STABILIZATION;
  const RATE = tc.TRAVEL_PLANNER_RATE;
  // food: RATE * 7.56 * 1 * 2 * GMS
  approx(tc.brecilienExitCostPerUnit("T5_MEAL_SOUP"), RATE * 7.56 * 1 * 2 * GMS, 0.5);
  // potion: RATE * 0.3 * 1 * 2 * GMS
  approx(tc.brecilienExitCostPerUnit("T4_POTION_HEAL"), RATE * 0.3 * 1 * 2 * GMS, 0.5);
  // crop: RATE * 0.6 * 1 * 2 * GMS (per-unit charge resolved from the table weight)
  approx(tc.brecilienExitCostPerUnit("T6_POTATO"), RATE * 0.6 * 1 * 2 * GMS, 0.5);

  delete global.ITEM_WEIGHTS;
  delete global.ITEM_FT_FACTORS;
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
