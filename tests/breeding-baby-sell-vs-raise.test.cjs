/**
 * Test: own baby - sell it now, or raise it one more cycle?
 *
 *   babySellVsRaise({ babySellPrice, raiseNet, instant, tax, setupFee })
 *     sellNet = instant ? price * (1 - tax)                  (no setup fee on an instant leg)
 *             :           price * (1 - tax - setupFee)       (sell order pays both)
 *     winner  = sellNet > raiseNet ? "sell" : "raise"        (tie -> "raise")
 *     delta   = |sellNet - raiseNet|
 *     no sell price (<= 0) -> winner "raise", sellNet 0, sellUnpriced true
 *
 *   raiseNetFromRow(profit, babyCost, setupFee)
 *     = profit + babyCost * (1 + setupFee)   (owning the baby skips its purchase)
 *
 * The caller passes the live PREMIUM_TAX as `tax`. Black-box, simulated numbers only.
 *
 * Run: node tests/breeding-baby-sell-vs-raise.test.cjs
 */

const assert = require("assert");
const { babySellVsRaise, raiseNetFromRow } = require("../js/breeding-finish.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

console.log("\n=== Breeding: baby sell vs raise ===");

const PREMIUM = 0.04, NO_PREMIUM = 0.08, SETUP = 0.025;
const CASES = [
  { name: "sell wins", in: { babySellPrice: 10000, raiseNet: 5000, instant: true, tax: PREMIUM }, sellNet: 9600, winner: "sell", delta: 4600 },
  { name: "raise wins", in: { babySellPrice: 10000, raiseNet: 9900, instant: true, tax: PREMIUM }, sellNet: 9600, winner: "raise", delta: 300 },
  { name: "tie -> raise", in: { babySellPrice: 10000, raiseNet: 9600, instant: true, tax: PREMIUM }, sellNet: 9600, winner: "raise", delta: 0 },
  { name: "Premium off tax rate", in: { babySellPrice: 10000, raiseNet: 5000, instant: true, tax: NO_PREMIUM }, sellNet: 9200, winner: "sell", delta: 4200 },
  { name: "sell order pays setup fee", in: { babySellPrice: 10000, raiseNet: 5000, instant: false, tax: PREMIUM, setupFee: SETUP }, sellNet: 9350, winner: "sell", delta: 4350 },
  { name: "negative raise net, sell wins", in: { babySellPrice: 2000, raiseNet: -300, instant: true, tax: PREMIUM }, sellNet: 1920, winner: "sell", delta: 2220 },
  { name: "no sell price -> raise, flagged", in: { babySellPrice: 0, raiseNet: 5000, instant: true, tax: PREMIUM }, sellNet: 0, winner: "raise", delta: 0, sellUnpriced: true },
  { name: "no sell price, negative raise -> still raise", in: { babySellPrice: 0, raiseNet: -100, instant: true, tax: PREMIUM }, sellNet: 0, winner: "raise", delta: 0, sellUnpriced: true },
];
for (const k of CASES) {
  test(`babySellVsRaise: ${k.name}`, () => {
    const r = babySellVsRaise(k.in);
    assert.ok(near(r.sellNet, k.sellNet), `sellNet ${r.sellNet} != ${k.sellNet}`);
    assert.strictEqual(r.winner, k.winner);
    assert.ok(near(r.delta, k.delta), `delta ${r.delta} != ${k.delta}`);
    assert.strictEqual(!!r.sellUnpriced, !!k.sellUnpriced);
    assert.strictEqual(r.raiseNet, k.in.raiseNet);
  });
}

const RAISE_CASES = [
  { name: "profit + baby cost with setup fee", args: [1000, 4000, 0.025], want: 5100 },
  { name: "zero baby cost", args: [1000, 0, 0.025], want: 1000 },
  { name: "negative profit", args: [-500, 2000, 0], want: 1500 },
];
for (const k of RAISE_CASES) {
  test(`raiseNetFromRow: ${k.name}`, () => {
    assert.ok(near(raiseNetFromRow(...k.args), k.want));
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
