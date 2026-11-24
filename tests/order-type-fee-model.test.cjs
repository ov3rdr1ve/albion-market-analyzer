/**
 * Test: market fees follow the Pricing Model toggle.
 *
 * Albion charges the 2.5% setup fee only when an ORDER is created. Buying or
 * selling instantly off the board pays no setup fee; the 4%/8% sales tax still
 * falls on the seller either way. The app used to charge the setup fee on both
 * legs unconditionally, so every table overstated friction by up to 5
 * percentage points whenever "Instant Buy/Sell (Fast)" was selected.
 *
 *   leg              instant            market order
 *   buy              price              price x 1.025
 *   sell (premium)   price x 0.96       price x 0.935
 *   sell (non-prem)  price x 0.92       price x 0.895
 *
 * SETUP_FEE and PREMIUM_TAX are live global getters, so every existing
 * `(1 + SETUP_FEE)` / `(1 - PREMIUM_TAX)` call site re-prices with no edit.
 *
 * The Buy and Sell radios are independent, so SETUP_FEE reads the buy leg and
 * PREMIUM_TAX the sell one. This harness stubs getOrderType ignoring its `side`
 * argument, which pins both legs together — the pre-split behaviour, and what
 * the matrix below describes. The per-leg matrix, including the two mixed
 * modes, is tests/order-type-split-sides.test.cjs.
 *
 * Black-box: real js/calculations.js compiled with a DOM stub. No live data.
 *
 * Run: node tests/order-type-fee-model.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
let _instant = false;
let _premium = true;
const _els = {
  "sort-instant": { get checked() { return _instant; } },
  "premium-account": { get checked() { return _premium; } },
};
const document = { getElementById: (id) => _els[id] || null };
function setInstant(on) { _instant = !!on; }
function setPremium(on) { _premium = !!on; }
// Deliberately argument-blind: one mode for both legs.
function getOrderType() { return _instant ? "instant" : "market"; }
function isPremiumEnabled() { return _premium; }
`;

const mod = new Module("order-type-fee-model");
mod._compile(
  stubs + J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) +
    "\nmodule.exports = { setInstant, setPremium," +
    " get SETUP_FEE() { return SETUP_FEE; }, get PREMIUM_TAX() { return PREMIUM_TAX; }," +
    " calculateFlipMargin, calculateTransportMargin, calculateCraftMargin };",
  "order-type-fee-model.js",
);
const X = mod.exports;

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
const near = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);

// ── the fee matrix ─────────────────────────────────────────────────────────
// [instant, premium, SETUP_FEE, PREMIUM_TAX]
const MATRIX = [
  [false, true,  0.025, 0.065],
  [false, false, 0.025, 0.105],
  [true,  true,  0,     0.04],
  [true,  false, 0,     0.08],
];

console.log("order-type fee model");
MATRIX.forEach(([instant, premium, setup, sell]) => {
  const label = `${instant ? "instant" : "market"} / ${premium ? "premium" : "non-premium"}`;
  test(`${label}: SETUP_FEE = ${setup}, PREMIUM_TAX = ${sell}`, () => {
    X.setInstant(instant); X.setPremium(premium);
    near(X.SETUP_FEE, setup);
    near(X.PREMIUM_TAX, sell);
  });
});

// ── the reported row: T1 Rare Animal Remains at Lymhurst ───────────────────
// ask 2,984 / bid 2,915. Instant-instant crosses the spread the wrong way, so
// it stays a loss — but a smaller one than the double setup fee implied.
console.log("reported row (buy 2984 / sell 2915, premium)");
test("instant: no setup fee on either leg", () => {
  X.setInstant(true); X.setPremium(true);
  const r = X.calculateFlipMargin(2984, 2915);
  near(r.profit, 2915 * 0.96 - 2984);          // -185.6
  near(r.margin, ((2915 * 0.96 - 2984) / 2984) * 100); // -6.220...%
});
test("market orders: both setup fees, unchanged from before", () => {
  X.setInstant(false); X.setPremium(true);
  const r = X.calculateFlipMargin(2984, 2915);
  const cost = 2984 * 1.025;
  near(r.profit, 2915 * 0.935 - cost);         // -333.4
  near(r.margin, ((2915 * 0.935 - cost) / cost) * 100); // -10.89...%
});
test("instant beats market orders on the same two prices", () => {
  X.setPremium(true);
  X.setInstant(true);
  const fast = X.calculateFlipMargin(2984, 2915).profit;
  X.setInstant(false);
  const slow = X.calculateFlipMargin(2984, 2915).profit;
  assert.ok(fast > slow, `instant ${fast} should beat market ${slow}`);
});

// ── the other two margin models read the same getters ─────────────────────
console.log("other margin models");
test("calculateTransportMargin drops the buy-side fee under instant", () => {
  X.setPremium(true);
  X.setInstant(false);
  const slow = X.calculateTransportMargin(1000, 1500);
  near(slow.profit, 1500 * 0.935 - 1000 * 1.025);
  X.setInstant(true);
  const fast = X.calculateTransportMargin(1000, 1500);
  near(fast.profit, 1500 * 0.96 - 1000);
});
test("calculateCraftMargin drops the material setup fee under instant", () => {
  X.setPremium(true);
  X.setInstant(true);
  const r = X.calculateCraftMargin(100, 10, 2000);
  near(r.profit, 2000 * 0.96 - 100 * 10);
});
test("travel cost is never fee-scaled", () => {
  X.setInstant(true); X.setPremium(true);
  const a = X.calculateFlipMargin(1000, 1500, 0).profit;
  const b = X.calculateFlipMargin(1000, 1500, 50).profit;
  near(a - b, 50);
});

// ── Node default: no getOrderType in scope ⇒ market rates ──────────────────
console.log("plain require (no DOM, no getOrderType)");
test("defaults to market orders, preserving the historical baseline", () => {
  const bare = require("../js/calculations.js");
  near(bare.SETUP_FEE, 0.025);
  near(bare.PREMIUM_TAX, 0.065);
});

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
