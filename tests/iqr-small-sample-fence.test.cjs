/**
 * Test: the IQR outlier fence must survive SMALL city samples.
 *
 * Bug this file exists for: T7_PLANKS carried three live asks — Caerleon
 * 80,979 (one troll listing), Fort Sterling 11,486, Lymhurst 12,960. With n=3
 * the quartile fence picks q3 = 80,979 — the outlier IS the upper quartile — so
 * the fence lands at q3 + 3×IQR ≈ 290k and rejects nothing. The T8 Tinker
 * laborer row then valued 44% of its payload at 80,979/plank and reported
 * 225,413 silver/cycle instead of ~49,000.
 *
 * Fix: for samples of ≤6 prices the quartile fence is additionally capped at
 * the median — the same median-anchored idea already used for n < 3, which a
 * lone fat-finger listing cannot drag with it. The cap started at ×4 (×3 below
 * three samples) and was raised to ×8 (×6 below three) so genuine red-zone
 * premiums — a Caerleon asking ~3-6× the royal median — pass the gate; only
 * order-of-magnitude junk is still rejected (plan-outlier-cap.md). The 80,979
 * planks ask, 6.25× the median, moved from "rejected" to "kept" by that raise;
 * the junk companion below keeps the reported shape covered at junk magnitude.
 *
 * The fixtures below carry the premium/junk ask on BRIDGEWATCH: Caerleon is
 * exempt from the gate entirely now (plan-caerleon-exempt.md), so pinning the
 * cap on it would prove nothing — a royal probe is what exercises the cap.
 *
 * Run: node tests/iqr-small-sample-fence.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
const elements = { "sort-instant": { checked: false } }; // market mode
sandbox.document = { getElementById: (id) => elements[id] || null };
sandbox.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
const ctx = vm.createContext(sandbox);
let code = ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"].map((n) => fs.readFileSync(path.join(__dirname, "..", "js", n + ".js"), "utf8")).join("\n");
code += "\n;globalThis.__exp = { getIQRBounds, isPriceOutlier, getBuyPrice, getSellPrice };";
vm.runInContext(code, ctx, { filename: "utils.js" });
const { getIQRBounds, getSellPrice, getBuyPrice } = sandbox.__exp;

function setMarketMode() { elements["sort-instant"].checked = false; }
function setInstantMode() { elements["sort-instant"].checked = true; }

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Small-sample IQR fence tests\n");

// ── The reported shape: 3 asks, one of them nonsense ─────────────────────
const planks = {
  Bridgewatch:     { buy_price: 0,     sell_price: 80979, volume_24h: 19675 },
  "Fort Sterling": { buy_price: 10056, sell_price: 11486, volume_24h: 425937 },
  Lymhurst:        { buy_price: 8589,  sell_price: 12960, volume_24h: 164799 },
};

test("a 6.25× ask among 3 asks sits inside the ×8 cap and is kept", () => {
  setMarketMode();
  const b = getIQRBounds(planks);
  // 80,979 is 6.25× the 12,960 median: over the old ×4 cap, inside the ×8 cap
  // raised for genuine red-zone premiums (plan-outlier-cap.md).
  assert.strictEqual(getSellPrice(planks, "Bridgewatch", b, "T7_PLANKS"), 80979);
});

test("an order-of-magnitude ask among 3 asks is still rejected", () => {
  setMarketMode();
  const junk = {
    Bridgewatch:     { buy_price: 0,     sell_price: 809790, volume_24h: 19675 },
    "Fort Sterling": { buy_price: 10056, sell_price: 11486, volume_24h: 425937 },
    Lymhurst:        { buy_price: 8589,  sell_price: 12960, volume_24h: 164799 },
  };
  const b = getIQRBounds(junk);
  assert.strictEqual(getSellPrice(junk, "Bridgewatch", b, "T7_PLANKS"), 0);
});

test("the legitimate asks in the same sample survive", () => {
  setMarketMode();
  const b = getIQRBounds(planks);
  assert.strictEqual(getSellPrice(planks, "Fort Sterling", b, "T7_PLANKS"), 11486);
  assert.strictEqual(getSellPrice(planks, "Lymhurst", b, "T7_PLANKS"), 12960);
});

test("instant mode (reads the ask) keeps the same 6.25× ask", () => {
  setInstantMode();
  const b = getIQRBounds(planks);
  assert.strictEqual(getBuyPrice(planks, "Bridgewatch", b, "T7_PLANKS"), 80979);
  setMarketMode();
});

// ── Sample sizes where the outlier can BE the quartile ───────────────────
function sellsOnly(prices) {
  const d = {};
  prices.forEach((p, i) => { d[`City${i}`] = { buy_price: 0, sell_price: p, volume_24h: 10 }; });
  return d;
}

[
  { n: 3, prices: [1000, 1100, 9000] },
  { n: 4, prices: [1000, 1100, 1050, 9000] },
  { n: 5, prices: [1000, 1100, 1050, 980, 9000] },
  { n: 6, prices: [1000, 1100, 1050, 980, 1020, 9000] },
].forEach(({ n, prices }) => {
  test(`n=${n} sample [${prices.join(",")}] → the 9k+ outlier is rejected`, () => {
    setMarketMode();
    const d = sellsOnly(prices);
    const b = getIQRBounds(d);
    prices.forEach((p, i) => {
      const got = getSellPrice(d, `City${i}`, b, "X");
      if (p >= 9000) assert.strictEqual(got, 0, `${p} should be rejected`);
      else assert.strictEqual(got, p, `${p} should survive`);
    });
  });
});

// ── The cap must not eat legitimate spread ───────────────────────────────

test("a 2× city premium is kept (well inside median×8)", () => {
  setMarketMode();
  const d = sellsOnly([1000, 1100, 1050, 2100]);
  const b = getIQRBounds(d);
  assert.strictEqual(getSellPrice(d, "City3", b, "X"), 2100);
});

test("a 3.5× city premium is kept", () => {
  setMarketMode();
  const d = sellsOnly([1000, 1100, 1050, 3500]);
  const b = getIQRBounds(d);
  assert.strictEqual(getSellPrice(d, "City3", b, "X"), 3500);
});

test("a single lone price is never an outlier against itself", () => {
  setMarketMode();
  const d = sellsOnly([303120]);
  const b = getIQRBounds(d);
  assert.strictEqual(getSellPrice(d, "City0", b, "X"), 303120);
});

test("two prices keep the lenient median×6 rule (raised from ×3)", () => {
  setMarketMode();
  const d = sellsOnly([1000, 2500]);
  const b = getIQRBounds(d);
  assert.strictEqual(getSellPrice(d, "City1", b, "X"), 2500);
});

test("large samples still use the quartile fence (cap does not apply)", () => {
  // 8 prices with a wide but genuine upper spread: median 1150, so a median×4
  // cap (4600) would wrongly cut 5,000 — the quartile fence must own n>6.
  setMarketMode();
  const d = sellsOnly([1000, 1050, 1100, 1150, 1400, 2000, 3500, 5000]);
  const b = getIQRBounds(d);
  assert.strictEqual(getSellPrice(d, "City7", b, "X"), 5000);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
