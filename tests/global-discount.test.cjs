/**
 * Tests for the Global Discount — the gold-price-driven scaler on every silver
 * sink in the game (repair, transmutation, quality rerolls, station fees,
 * island upgrades).
 *
 * Wiki formula: Global Discount = (1 - gold price / 5000) * 100%, active only
 * while gold trades BELOW 5000. Above the pivot there is no discount and no
 * surcharge, so the cost multiplier is:
 *
 *     factor = clamp(gold / 5000, 0, 1)
 *
 * Gold has traded 7,500-8,700 all year, so the factor is 1 in practice today.
 * The point of wiring it is that the tables stop being silently wrong the next
 * time gold dips under the pivot.
 *
 * Black-box: drive the public helpers through the pivot.
 *
 * Run: node tests/global-discount.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const mod = new Module("global-discount-test");
mod._compile(
  "const localStorage = undefined;\n" +
    read("global-discount.js") +
    "\nmodule.exports = { GLOBAL_DISCOUNT_PIVOT, setGoldPrice, getGoldPrice," +
    " getGlobalDiscountFactor, getGlobalDiscountPercent, applyGlobalDiscount };",
  "global-discount.js",
);
const {
  GLOBAL_DISCOUNT_PIVOT,
  setGoldPrice,
  getGoldPrice,
  getGlobalDiscountFactor,
  getGlobalDiscountPercent,
  applyGlobalDiscount,
} = mod.exports;

let passed = 0,
  failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${name} — ${err.message}`);
    failed++;
  }
}
const close = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: expected ~${b}, got ${a}`);

console.log("\n=== Global Discount ===");

test("pivot is the documented 5000 gold", () => {
  assert.strictEqual(GLOBAL_DISCOUNT_PIVOT, 5000);
});

// [gold, factor, discount %, why]
[
  [5000, 1, 0, "at the pivot there is no discount"],
  [7872, 1, 0, "above the pivot: no discount and no surcharge"],
  [8700, 1, 0, "well above the pivot stays capped at 1"],
  [2500, 0.5, 50, "half the pivot halves every silver cost"],
  [4000, 0.8, 20, "the wiki's negatively-proportional curve"],
  [1000, 0.2, 80, "cheap gold, deep discount"],
  [0, 0, 100, "free silver at zero gold"],
].forEach(([gold, factor, pct, why]) => {
  test(`gold ${gold}: factor ${factor} (${why})`, () => {
    setGoldPrice(gold);
    close(getGlobalDiscountFactor(), factor, 1e-9, "factor");
    close(getGlobalDiscountPercent(), pct, 1e-6, "percent");
  });
});

test("an unknown gold price bills full price rather than guessing", () => {
  setGoldPrice(null);
  assert.strictEqual(getGoldPrice(), null);
  assert.strictEqual(getGlobalDiscountFactor(), 1);
});

[NaN, Infinity, -100, "abc", undefined, 0.5].forEach((bad) => {
  test(`rejects a nonsense gold price (${String(bad)})`, () => {
    setGoldPrice(6000);
    setGoldPrice(bad);
    assert.strictEqual(getGoldPrice(), 6000, "last good price must survive");
  });
});

test("applyGlobalDiscount scales a silver figure by the factor", () => {
  setGoldPrice(2500);
  close(applyGlobalDiscount(1000), 500, 1e-9, "half price");
  setGoldPrice(7872);
  close(applyGlobalDiscount(1000), 1000, 1e-9, "no change above the pivot");
});

test("applyGlobalDiscount passes non-numbers through as 0", () => {
  setGoldPrice(2500);
  [null, undefined, NaN, "x"].forEach((bad) => {
    assert.strictEqual(applyGlobalDiscount(bad), 0, `input ${String(bad)}`);
  });
});

test("the wiki's worked example reproduces: 4.74% off 1,875,000", () => {
  // Island upgrade 1,875,000 -> 1,786,125 at a 4.74% discount.
  setGoldPrice(GLOBAL_DISCOUNT_PIVOT * (1 - 0.0474));
  close(applyGlobalDiscount(1875000), 1786125, 1, "discounted island upgrade");
});

// ─── Wiring: a silver sink actually moves with gold ──────────────────────────

console.log("\n=== Applied to a silver sink (quality reroll) ===");

const sinkMod = new Module("global-discount-sink-test");
sinkMod._compile(
  "const localStorage = undefined;\n" +
    read("global-discount.js") +
    read("item-values.js") +
    read("data-rerolling.js") +
    "\nmodule.exports = { setGoldPrice, getExpectedRerollCost };",
  "data-rerolling.js",
);
const sink = sinkMod.exports;

test("reroll cost is unchanged while gold sits above the pivot", () => {
  sink.setGoldPrice(7872);
  close(sink.getExpectedRerollCost("T4_2H_BOW", 1, 4), 512 * 21.717143, 1, "full price");
});

test("reroll cost halves when gold halves the pivot", () => {
  sink.setGoldPrice(2500);
  close(sink.getExpectedRerollCost("T4_2H_BOW", 1, 4), 512 * 21.717143 * 0.5, 1, "half price");
});

test("an unreachable transition stays free rather than becoming free-of-charge", () => {
  sink.setGoldPrice(2500);
  assert.strictEqual(sink.getExpectedRerollCost("T4_2H_BOW", 4, 3), 0, "already at target");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
