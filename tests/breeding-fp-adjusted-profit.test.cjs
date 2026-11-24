/**
 * Test: silverPerFp gate for breeding rows.
 *
 * Verifies the FP-adjusted silver-per-FP calc at js/render-mounts.js:307-314
 * activates whenever full market data is available (canScoreMargin), not only
 * when the all-silver cycle is profitable. Bug it fixes: T5 FW babies whose
 * silver cycle is a loss (e.g. Baby Swamp Salamander @ Thetford with vinehearts
 * at ~40k ea) used to render "—" in the S/FP (Bred) column even though the
 * FP-paid cycle is the actual breeding workflow.
 *
 * Pattern: mirror the calc inside the test (same approach as `nurtureEvFor` in
 * tests/breeding-metadata-and-row.test.cjs:749). breedingRowFor is defined
 * inside renderMountsTable's closure and isn't compilable in isolation. Keep
 * this helper in sync with render-mounts.js:307-314 if that math evolves.
 *
 * Run: node tests/breeding-fp-adjusted-profit.test.cjs
 */

const assert = require("assert");

// Mirror of js/render-mounts.js:307-314. Pure function; no externals.
function computeFpAdjustedSilverPerFp({
  marginInfoProfit, nurtureEv, fpMatSilverCost, totalFpCost,
  canScoreMargin, setupFee = 0.025,
}) {
  const fpAdjustedProfit = canScoreMargin
    ? (nurtureEv || marginInfoProfit) + fpMatSilverCost * (1 + setupFee)
    : 0;
  const silverPerFp = (totalFpCost > 0 && fpAdjustedProfit > 0)
    ? fpAdjustedProfit / totalFpCost
    : 0;
  return { fpAdjustedProfit, silverPerFp };
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Breeding fpAdjustedProfit / silverPerFp gate tests\n");

// (a) Bug case: T5 Baby Swamp Salamander @ Thetford. Silver cycle is a loss but
// FP-paid cycle yields ~11.7 silver/FP. Pre-fix this rendered "—".
test("silver-loss + FP-positive cycle (T5 swamp salamander) yields ~11.71 silver/FP", () => {
  const r = computeFpAdjustedSilverPerFp({
    marginInfoProfit: -58_001,    // 266k×0.935 − (62684+9106+227440)×1.025
    nurtureEv:        -58_001,    // collapses to marginInfoProfit when silver-loss
    fpMatSilverCost:  262_184,    // baby 62684 + 5×vineheart 39900
    totalFpCost:       18_000,    // 3000 baby + 5×3000 vineheart
    canScoreMargin: true,
  });
  // -58001 + 262184 * 1.025 = -58001 + 268738.6 = 210737.6
  assert.ok(Math.abs(r.fpAdjustedProfit - 210_737.6) < 0.5,
    `fpAdjustedProfit: expected ~210,737.6, got ${r.fpAdjustedProfit}`);
  // 210737.6 / 18000 = 11.7076...
  assert.ok(Math.abs(r.silverPerFp - 11.708) < 0.05,
    `silverPerFp: expected ~11.71, got ${r.silverPerFp}`);
});

// (b) Silver-positive cycle: nurture EV carries through with FP add-back. The
// `(nurtureEv || marginInfoProfit)` falsy-pick uses nurtureEv when it's
// non-zero (positive, in this case).
test("silver-positive cycle: nurtureEv carries into fpAdjustedProfit", () => {
  const r = computeFpAdjustedSilverPerFp({
    marginInfoProfit:  50_000,
    nurtureEv:         70_000,    // 50k base + 20k offspring bonus
    fpMatSilverCost:  100_000,
    totalFpCost:       18_000,
    canScoreMargin: true,
  });
  // 70_000 + 100_000 * 1.025 = 172_500
  assert.strictEqual(r.fpAdjustedProfit, 172_500);
  // 172_500 / 18_000 = 9.5833...
  assert.ok(Math.abs(r.silverPerFp - 9.583) < 0.05,
    `silverPerFp: expected ~9.58, got ${r.silverPerFp}`);
});

// (c) Silver-loss too deep for FP add-back to offset: silverPerFp stays 0.
// Verifies the downstream `fpAdjustedProfit > 0` gate still suppresses
// hopeless cycles (e.g. tiny FP exposure on a big silver loss).
test("FP-paid cycle stays unprofitable when add-back can't offset the silver loss", () => {
  const r = computeFpAdjustedSilverPerFp({
    marginInfoProfit: -200_000,
    nurtureEv:        -200_000,
    fpMatSilverCost:     1_000,    // tiny FP exposure
    totalFpCost:         3_000,
    canScoreMargin: true,
  });
  // -200_000 + 1_025 = -198_975 (still deeply negative)
  assert.ok(r.fpAdjustedProfit < 0,
    `fpAdjustedProfit: expected negative, got ${r.fpAdjustedProfit}`);
  assert.strictEqual(r.silverPerFp, 0);
});

// (d) No market data (canScoreMargin false) short-circuits to 0.
test("canScoreMargin=false short-circuits fpAdjustedProfit to 0", () => {
  const r = computeFpAdjustedSilverPerFp({
    marginInfoProfit:       0,
    nurtureEv:              0,
    fpMatSilverCost:  100_000,
    totalFpCost:       18_000,
    canScoreMargin: false,
  });
  assert.strictEqual(r.fpAdjustedProfit, 0);
  assert.strictEqual(r.silverPerFp, 0);
});

// (e) No FP-priced inputs (e.g. regular mount with no hearts and no FP-baby):
// silverPerFp gated to 0 even when fpAdjustedProfit is positive.
test("totalFpCost=0 returns silverPerFp=0 regardless of fpAdjustedProfit", () => {
  const r = computeFpAdjustedSilverPerFp({
    marginInfoProfit:  100_000,
    nurtureEv:         120_000,
    fpMatSilverCost:         0,
    totalFpCost:             0,
    canScoreMargin: true,
  });
  assert.strictEqual(r.fpAdjustedProfit, 120_000);
  assert.strictEqual(r.silverPerFp, 0);
});

// (f) Regression: silver-positive baseline (typical happy path) matches the
// pre-fix behavior since canScoreMargin and (profit > 0 || nurtureEv > 0)
// both evaluate true here.
test("regression: silver-positive baseline yields ~13.82 silver/FP", () => {
  const r = computeFpAdjustedSilverPerFp({
    marginInfoProfit:  80_000,
    nurtureEv:         95_000,
    fpMatSilverCost: 150_000,
    totalFpCost:      18_000,
    canScoreMargin: true,
  });
  // 95_000 + 150_000 * 1.025 = 248_750
  assert.strictEqual(r.fpAdjustedProfit, 248_750);
  // 248_750 / 18_000 = 13.819...
  assert.ok(Math.abs(r.silverPerFp - 13.819) < 0.01,
    `silverPerFp: expected ~13.82, got ${r.silverPerFp}`);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
