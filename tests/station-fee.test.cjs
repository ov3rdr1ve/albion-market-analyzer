/**
 * Test: calcStationFeeSilver — tier-derived nutrition vs explicit override.
 *
 * Covers:
 *  - Default tier-based formula (ivPerMat = 14 × 2^(tier-4), nutrition = iv × 0.1125)
 *  - Explicit nutritionOverride (used by UNIQUE_HIDEOUT — multi-tier mats + GvG token
 *    don't fit the single-tier formula; in-game value at 845/100 station fee is
 *    1,611,440 silver, implying 190,703 nutrition per craft)
 *  - stationFeeInput scaling (silver = (input/100) × nutrition)
 *
 * Run: node tests/station-fee.test.cjs
 */

const assert = require("assert");

// Pure copy of calcStationFeeSilver from js/utils.js, with stationFeeInput injected
// (the live function reads from a DOM input via getStationFeeInput()).
function calcStationFeeSilver(tier, nonArtifactMats, nutritionOverride, stationFeeInput) {
  const ivPerMat = 14 * Math.pow(2, tier - 4);
  const itemValue = nonArtifactMats * ivPerMat;
  const nutrition = nutritionOverride != null ? nutritionOverride : itemValue * 0.1125;
  return (stationFeeInput / 100) * nutrition;
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("calcStationFeeSilver tests\n");

// --- Tier-derived nutrition (no override) ---
const tierCases = [
  // [tier, mats, stationFeeInput, expected]
  [4, 1,    400, 14 * 1 * 0.1125 * 4],         // T4 single-mat
  [5, 1,    400, 28 * 1 * 0.1125 * 4],         // T5 single-mat
  [6, 1,    400, 56 * 1 * 0.1125 * 4],         // T6 single-mat
  [7, 1,    400, 112 * 1 * 0.1125 * 4],        // T7 single-mat
  [8, 1,    400, 224 * 1 * 0.1125 * 4],        // T8 single-mat
  [4, 8,    400, 14 * 8 * 0.1125 * 4],         // T4 plate-armor-style 8 bars
  [6, 6400, 845, 56 * 6400 * 0.1125 * 8.45],   // hideout if tier-6 ivPerMat were correct (it isn't)
];
tierCases.forEach(([tier, mats, fee, expected]) => {
  test(`tier ${tier}, ${mats} mats, ${fee}/100 → ${expected.toFixed(2)}`, () => {
    const got = calcStationFeeSilver(tier, mats, null, fee);
    assert.ok(Math.abs(got - expected) < 0.01, `Got ${got}`);
  });
});

// --- Override path (hideout) ---
test("nutritionOverride bypasses tier formula", () => {
  const tierResult = calcStationFeeSilver(6, 6400, null, 845);
  const overrideResult = calcStationFeeSilver(6, 6400, 190703, 845);
  // The override value must NOT equal the tier-derived value (proves the override path took effect)
  assert.notStrictEqual(tierResult, overrideResult);
});

test("UNIQUE_HIDEOUT @ 845/100: override 190703 nutrition → 1,611,440 silver (in-game verified)", () => {
  const fee = calcStationFeeSilver(6, 6400, 190703, 845);
  assert.strictEqual(Math.round(fee), 1611440);
});

test("UNIQUE_HIDEOUT @ 400/100: override 190703 nutrition → 762,812 silver", () => {
  const fee = calcStationFeeSilver(6, 6400, 190703, 400);
  assert.strictEqual(Math.round(fee), 762812);
});

test("override of 0 still uses 0 (not falsy fallback to tier formula)", () => {
  const fee = calcStationFeeSilver(6, 6400, 0, 400);
  assert.strictEqual(fee, 0);
});

test("undefined override falls through to tier formula", () => {
  const tierVal = calcStationFeeSilver(6, 1, null, 400);
  const undefVal = calcStationFeeSilver(6, 1, undefined, 400);
  assert.strictEqual(tierVal, undefVal);
});

// --- stationFeeInput scaling ---
test("stationFeeInput = 0 → 0 silver fee", () => {
  assert.strictEqual(calcStationFeeSilver(6, 6400, 190703, 0), 0);
});

test("stationFeeInput doubles → fee doubles", () => {
  const a = calcStationFeeSilver(6, 6400, 190703, 400);
  const b = calcStationFeeSilver(6, 6400, 190703, 800);
  assert.ok(Math.abs(b - 2 * a) < 0.01);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
