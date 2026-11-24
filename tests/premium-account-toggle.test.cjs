/**
 * Premium Account toggle → live PREMIUM_TAX.
 *
 * The header "Premium Account" checkbox flips Albion's market SALES TAX between
 * Premium (4% → 6.5% total with the 2.5% setup fee) and non-Premium (8% →
 * 10.5% total). Rather than thread a flag through the ~30 `(1 - PREMIUM_TAX)`
 * call sites, calculations.js exposes PREMIUM_TAX as a live global getter that
 * consults isPremiumEnabled(). This test drives that getter by stubbing
 * isPremiumEnabled on globalThis (the browser's checkbox reader) and asserts:
 *   1. the raw PREMIUM_TAX value flips 0.065 ⇄ 0.105,
 *   2. the default (no reader defined, as in Node) stays at the Premium 0.065
 *      baseline every other test relies on,
 *   3. a downstream calc (calcJournalEconomics) re-prices accordingly.
 *
 * Black-box: only public behavior (getter value + one consumer) is checked.
 */
const assert = require("assert");

// Ensure a clean slate: the getter is installed on globalThis at require time.
delete globalThis.PREMIUM_TAX;
delete globalThis.isPremiumEnabled;

const { calcJournalEconomics } = require("../js/calculations.js");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n       ${e.message}`);
    process.exitCode = 1;
  }
}

function setPremium(v) {
  // undefined → simulate "no checkbox reader" (Node default); function → stub it.
  if (v === undefined) delete globalThis.isPremiumEnabled;
  else globalThis.isPremiumEnabled = () => v;
}

console.log("=== PREMIUM_TAX live getter ===");

test("default (no reader) → Premium baseline 0.065", () => {
  setPremium(undefined);
  assert.strictEqual(globalThis.PREMIUM_TAX, 0.065);
});

test("isPremiumEnabled()=true → 0.065 (4% tax + 2.5% setup)", () => {
  setPremium(true);
  assert.strictEqual(globalThis.PREMIUM_TAX, 0.065);
});

test("isPremiumEnabled()=false → 0.105 (8% tax + 2.5% setup)", () => {
  setPremium(false);
  assert.strictEqual(globalThis.PREMIUM_TAX, 0.105);
});

test("toggling flips the value live (no re-require)", () => {
  setPremium(true);
  const prem = globalThis.PREMIUM_TAX;
  setPremium(false);
  const nonPrem = globalThis.PREMIUM_TAX;
  assert.strictEqual(prem, 0.065);
  assert.strictEqual(nonPrem, 0.105);
});

console.log("\n=== downstream consumer re-prices (calcJournalEconomics) ===");

const J = { emptyCost: 0, fullGross: 1000, maxfame: 0, baseFamePerHour: 0 };

test("Premium journal net = gross × (1 − 0.065)", () => {
  setPremium(true);
  assert.strictEqual(calcJournalEconomics(J).fullNet, 1000 * (1 - 0.065));
});

test("non-Premium journal net = gross × (1 − 0.105)", () => {
  setPremium(false);
  assert.strictEqual(calcJournalEconomics(J).fullNet, 1000 * (1 - 0.105));
});

test("non-Premium nets strictly less than Premium (higher tax)", () => {
  setPremium(true);
  const prem = calcJournalEconomics(J).fullNet;
  setPremium(false);
  const nonPrem = calcJournalEconomics(J).fullNet;
  assert.ok(nonPrem < prem, `expected ${nonPrem} < ${prem}`);
});

// Leave globalThis clean for any sibling suite sharing the process.
setPremium(undefined);

console.log(`\n${passed} passed`);
