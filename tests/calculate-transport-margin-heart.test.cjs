/**
 * Test: calculateTransportMargin — the nonReturnableMatCost parameter (a
 * faction heart used as a refining substitute). A heart is fully consumed and
 * NOT returned by the resource return rate, so its cost must sit OUTSIDE the
 * (1-rrr) discount but still INSIDE the (1+SETUP_FEE) buy-side fee.
 *
 * Run: node tests/calculate-transport-margin-heart.test.cjs
 */

const assert = require("assert");
const { calculateTransportMargin, SETUP_FEE, PREMIUM_TAX } = require("../js/calculations.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("calculateTransportMargin — heart (nonReturnableMatCost) tests\n");

test("default nonReturnableMatCost=0 → byte-identical to the legacy formula", () => {
  const buy = 300, sell = 1000, rrr = 0.3, sec = 200, station = 50, travel = 10;
  const legacyCost = (buy + sec) * (1 - rrr) * (1 + SETUP_FEE) + station + travel;
  const rev = sell * (1 - PREMIUM_TAX);
  const r = calculateTransportMargin(buy, sell, rrr, sec, station, travel);
  assert.ok(Math.abs(r.profit - (rev - legacyCost)) < 1e-9, `profit ${r.profit}`);
});

test("heart cost is excluded from (1-rrr) but inside (1+SETUP_FEE)", () => {
  const buy = 300, sell = 1000, rrr = 0.3, heart = 50;
  const eff = ((buy + 0) * (1 - rrr) + heart) * (1 + SETUP_FEE);
  const rev = sell * (1 - PREMIUM_TAX);
  const r = calculateTransportMargin(buy, sell, rrr, 0, 0, 0, heart);
  assert.ok(Math.abs(r.profit - (rev - eff)) < 1e-9, `profit ${r.profit}`);
});

test("RRR-exempt heart costs more than if it were a returnable secondary", () => {
  // Same silver amount, two placements: as nonReturnable (correct) vs as a
  // returnable secondary (the wrong model that would over-discount it).
  const buy = 300, sell = 1000, rrr = 0.3, amt = 50;
  const correct = calculateTransportMargin(buy, sell, rrr, 0, 0, 0, amt);
  const ifReturnable = calculateTransportMargin(buy, sell, rrr, amt, 0, 0, 0);
  assert.ok(correct.profit < ifReturnable.profit,
    "a non-returned heart must reduce profit more than a returned secondary of equal price");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
