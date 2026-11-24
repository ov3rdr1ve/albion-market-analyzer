/**
 * Test: the Mounts table's breeding "Sil/Focus" (nurture) column must be a
 * focus-ON benchmark — invariant to the global "Use Focus" checkbox.
 *
 * Bug (browser diff: 3 elite breeding rows changed, e.g. 240.24 -> 183.86):
 * profitPerFocus = (nurtureGainPct/100) × offspringValue ÷ nurtureFocus, and
 * offspringValue = max(babyPrice, cycleMargin). The cycle margin uses the
 * saddler RRR, which is checkbox-gated — so when the margin dominates the baby
 * price, toggling focus drags the nurture Silver/Focus with it.
 *
 * Fix (render-mounts.js): value the offspring with a focus-ON cycle margin
 * (saddlerMatCostFocusOn, computed with focus-on RRR) for the benchmark, while
 * the displayed margin and the focus-gated nurtureEv column stay checkbox-based.
 *
 * Mirror-style (matches tests/breeding-nurture-focus-toggle.test.cjs): encodes
 * both the OLD (checkbox-margin) and FIXED (focus-on-margin) formulas and
 * asserts OLD varies while FIXED is invariant.
 *
 * Run: node tests/breeding-nurture-silver-focus-toggle.test.cjs
 */

const assert = require("assert");

const SETUP_FEE = 0.025;
const PREMIUM_TAX = 0.065;
const BASE_CITY_BONUS = 0.18;
const FOCUS_BONUS = 0.59;
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
// Mounts have no city spec → base + (focus ? +0.59).
function getCraftRRR(useFocus) { return calcRRR(BASE_CITY_BONUS + (useFocus ? FOCUS_BONUS : 0)); }

// Shared cycle pieces for the fixture (margin dominates baby price → leak shows).
const FIX = {
  babyPrice: 800_000,
  feedCost: 100_000,
  sellPrice: 3_300_000,
  eligibleMatGross: 800_000, // 20× leather @ 40k, all RRR-eligible
  sellTravel: 0,
  nurtureGainPct: 15.0,
  focusCost: 6000,
};

function cycleMargin(rrr) {
  const saddlerMatCost = FIX.eligibleMatGross * (1 - rrr);
  const totalInputCost = (FIX.babyPrice + FIX.feedCost + saddlerMatCost) * (1 + SETUP_FEE) + FIX.sellTravel;
  return FIX.sellPrice * (1 - PREMIUM_TAX) - totalInputCost;
}

// OLD (buggy): offspring valued at the CHECKBOX cycle margin.
function profitPerFocusOld(checkbox) {
  const margin = cycleMargin(getCraftRRR(checkbox));
  const offspringValue = Math.max(FIX.babyPrice, margin);
  return (FIX.nurtureGainPct / 100) * offspringValue / FIX.focusCost;
}
// FIXED: offspring valued at the FOCUS-ON cycle margin, regardless of checkbox.
function profitPerFocusFixed(checkbox) {
  const margin = cycleMargin(getCraftRRR(true)); // focus-on basis, checkbox ignored
  const offspringValue = Math.max(FIX.babyPrice, margin);
  return (FIX.nurtureGainPct / 100) * offspringValue / FIX.focusCost;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Breeding nurture Silver/Focus — focus-ON benchmark ===");

test("fixture sanity: cycle margin dominates the baby price (leak is exercised)", () => {
  assert.ok(cycleMargin(getCraftRRR(true)) > FIX.babyPrice, "focus-on margin should exceed baby price");
  assert.ok(cycleMargin(getCraftRRR(false)) > FIX.babyPrice, "focus-off margin should exceed baby price");
});

test("OLD formula varies with the checkbox (documents the bug)", () => {
  assert.ok(Math.abs(profitPerFocusOld(true) - profitPerFocusOld(false)) > 1e-6,
    `old profitPerFocus should move (on=${profitPerFocusOld(true)}, off=${profitPerFocusOld(false)})`);
});

test("FIXED formula is invariant to the checkbox", () => {
  assert.ok(Math.abs(profitPerFocusFixed(true) - profitPerFocusFixed(false)) < 1e-9,
    `fixed profitPerFocus must be invariant (on=${profitPerFocusFixed(true)}, off=${profitPerFocusFixed(false)})`);
});

test("FIXED equals the focus-ON value of the OLD formula (no regression in the on-state)", () => {
  assert.ok(Math.abs(profitPerFocusFixed(false) - profitPerFocusOld(true)) < 1e-9,
    "fixed (any state) should equal old focus-on value");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
