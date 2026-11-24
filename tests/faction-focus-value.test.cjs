/**
 * Test: Faction Spending "Profit / 10k Focus (FP inputs)".
 *
 * The column values an FP-bought BABY by what a full 10,000-focus bar earns
 * when it is bred & saddled as a free input: the mounts table's
 * fpAdjustedProfit (cycle profit with FP-priced inputs added back) over the
 * nurture focus per cycle. Hearts get no value (rendered as a dash).
 *
 * Black-box against js/faction-focus-value.js: feed row shapes in, assert the
 * returned numbers / nulls.
 *
 * Run: node tests/faction-focus-value.test.cjs
 */

const assert = require("assert");

// Global the module reads at call time (browser: js/calculations.js).
globalThis.calculateProfitPer10kFocus = (profit, focus, perOutput = 1) =>
  (!focus || focus <= 0) ? 0 : profit * (Math.floor(10000 / focus) / perOutput);

const { getBabyFpFocusValue } = require("../js/faction-focus-value.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\ngetBabyFpFocusValue");

test("cycles a full bar of nurture focus at the FP-adjusted profit", () => {
  const v = getBabyFpFocusValue({ nurtureFocusCost: 1000, fpAdjustedProfit: 45000 });
  assert.strictEqual(v.cycles, 10);
  assert.strictEqual(v.per10k, 450000);
});

test("floors partial cycles (2400 focus → 4 cycles)", () => {
  const v = getBabyFpFocusValue({ nurtureFocusCost: 2400, fpAdjustedProfit: 10000 });
  assert.strictEqual(v.cycles, 4);
  assert.strictEqual(v.per10k, 40000);
});

test("negative FP-adjusted profit still reports (breeding loses even free)", () => {
  const v = getBabyFpFocusValue({ nurtureFocusCost: 1000, fpAdjustedProfit: -5000 });
  assert.strictEqual(v.per10k, -50000);
});

[
  ["null breed data", null],
  ["no nurture focus", { nurtureFocusCost: 0, fpAdjustedProfit: 5000 }],
  ["unpriced cycle (profit 0)", { nurtureFocusCost: 1000, fpAdjustedProfit: 0 }],
].forEach(([name, bd]) => {
  test(`${name} → null`, () => {
    assert.strictEqual(getBabyFpFocusValue(bd), null);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
