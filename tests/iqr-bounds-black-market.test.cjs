/**
 * Test: the Black Market is exempt from the cross-city outlier bounds.
 *
 * Bug this file exists for: the Crafting Planner could not show a Black Market
 * sale for T3_BAG. The BM bid (2,686) was thrown away by getSellPrice because
 * getIQRBounds pooled EVERY city — Black Market included — into one buy sample,
 * and the two royal bids left in that sample (22 and 545) put the small-sample
 * ceiling at 545 x 4 = 2,180. 59 ids in a real scan lost their BM bid this way.
 *
 * The rule already exists elsewhere: js/api.js CLAMP_EXEMPT_CITIES says the
 * Black Market "must neither anchor nor be judged by a cross-city comparison",
 * because it pays a structurally different price. This test pins that same rule
 * onto the IQR gate:
 *
 *   • getIQRBounds ignores the Black Market entry when building either pool.
 *   • getSellPrice returns the BM price however far above the city ceiling it
 *     sits — on BOTH fields, since the Black Market follows the Pricing Model
 *     like any other city (the bid under Instant, its own sell order under
 *     Market Orders).
 *   • City prices are gated exactly as before (no loosening).
 *
 * Run: node tests/iqr-bounds-black-market.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");

// ── Load the real utils.js (price + bounds logic) into a sandbox ──
const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
const elements = { "sort-instant": { checked: false } }; // default: market mode
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
const { getIQRBounds, getBuyPrice, getSellPrice } = sandbox.__exp;

const BM = "Black Market";
const entry = (buy, sell) => ({ buy_price: buy, sell_price: sell, volume_24h: 10 });
/** Drive the Pricing Model radio the way the app does. */
const setMode = (mode) => { elements["sort-instant"].checked = mode === "instant"; };
const inMode = (mode, fn) => { setMode(mode); try { fn(); } finally { setMode("market"); } };
/** Drop the Black Market entry — the "what would the cities alone say" control. */
function withoutBm(data) {
  const out = {};
  Object.entries(data).forEach(([c, v]) => { if (c !== BM) out[c] = v; });
  return out;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Black Market outlier-exemption tests\n");

// The measured T3_BAG shape: two thin royal bids and a BM bid four times the
// royal median, plus a full spread of asks.
const t3Bag = {
  [BM]: entry(2686, 3093),
  Brecilien: entry(22, 2530),
  Martlock: entry(545, 1900),
  Caerleon: entry(0, 4954),
  Thetford: entry(0, 1499),
  Lymhurst: entry(0, 2236),
  "Fort Sterling": entry(0, 2246),
  Bridgewatch: entry(0, 2092),
};

// ── The bounds themselves ───────────────────────────────────────────────────

[
  ["buyUpper", t3Bag],
  ["sellUpper", t3Bag],
].forEach(([field, data]) => {
  test(`${field} is identical with and without the Black Market entry`, () => {
    assert.strictEqual(getIQRBounds(data)[field], getIQRBounds(withoutBm(data))[field]);
  });
});

test("a lone huge BM bid cannot lift the city buy ceiling", () => {
  const data = {
    A: entry(5000, 0), B: entry(5200, 0), C: entry(4900, 0), D: entry(5100, 0),
    [BM]: entry(9999999, 0),
  };
  const b = getIQRBounds(data);
  assert.strictEqual(getBuyPrice(data, "A", b, "X"), 5000, "normal city bid kept");
  // Without the exemption the BM value IS the upper quartile and the fence
  // balloons — this asserts the city cluster still sets the ceiling.
  assert.ok(b.buyUpper < 9999999, `buyUpper (${b.buyUpper}) must not follow the BM bid`);
});

test("BM's ask never widens the city sell ceiling", () => {
  const cities = {
    A: entry(0, 5000), B: entry(0, 5200), C: entry(0, 4900), D: entry(0, 5100),
    E: entry(0, 500000), // an order-of-magnitude fat-finger ask, must stay rejected
  };
  const withBm = { ...cities, [BM]: entry(0, 38000) };
  assert.strictEqual(getIQRBounds(withBm).sellUpper, getIQRBounds(cities).sellUpper);
  assert.strictEqual(getSellPrice(withBm, "E", getIQRBounds(withBm), "X"), 0,
    "the city's fat-finger ask is still rejected once BM stops propping the fence up");
});

// ── Reading a Black Market price ────────────────────────────────────────────

test("the T3_BAG bid survives, however far above the royal ceiling it sits", () => {
  inMode("instant", () => {
    const b = getIQRBounds(t3Bag);
    assert.strictEqual(getSellPrice(t3Bag, BM, b, "T3_BAG"), 2686);
  });
});

test("the BM ASK is exempt too — Market Orders lists into the Black Market", () => {
  const data = { ...t3Bag, [BM]: entry(2686, 999999) };
  const b = getIQRBounds(data);
  assert.strictEqual(getSellPrice(data, BM, b, "T3_BAG"), 999999,
    "an ask far above the city distribution is still returned");
});

[
  ["a bid 4x the royal median", 2686],
  ["a bid 100x the royal median", 54500],
  ["a bid below every royal bid", 10],
].forEach(([label, bid]) => {
  test(`instant BM sale is read at the bid — ${label}`, () => {
    inMode("instant", () => {
      const data = { ...t3Bag, [BM]: entry(bid, 3093) };
      assert.strictEqual(getSellPrice(data, BM, getIQRBounds(data), "T3_BAG"), bid);
    });
  });
});

test("an instant BM sale reads the BID, never its ask", () => {
  inMode("instant", () => {
    const b = getIQRBounds(t3Bag);
    assert.strictEqual(getSellPrice(t3Bag, BM, b, "T3_BAG"), t3Bag[BM].buy_price);
  });
});

test("a Market Orders BM sale reads the ASK, never its bid", () => {
  const b = getIQRBounds(t3Bag);
  assert.strictEqual(getSellPrice(t3Bag, BM, b, "T3_BAG"), t3Bag[BM].sell_price);
});

test("no BM entry in the map is still 0, not a thrown error", () => {
  const data = withoutBm(t3Bag);
  assert.strictEqual(getSellPrice(data, BM, getIQRBounds(data), "T3_BAG"), 0);
});

test("a BM bid of 0 stays 0 under Instant", () => {
  inMode("instant", () => {
    const data = { ...t3Bag, [BM]: entry(0, 3093) };
    assert.strictEqual(getSellPrice(data, BM, getIQRBounds(data), "T3_BAG"), 0);
  });
});

test("a BM with no ask drops the leg under Market Orders — no fallback to the bid", () => {
  const data = { ...t3Bag, [BM]: entry(2686, 0) };
  assert.strictEqual(getSellPrice(data, BM, getIQRBounds(data), "T3_BAG"), 0);
});

// ── City gating is untouched ────────────────────────────────────────────────

test("a genuine city sell outlier is STILL rejected", () => {
  const data = {
    A: entry(0, 5000), B: entry(0, 5200), C: entry(0, 4900), D: entry(0, 5100),
    E: entry(0, 9999999),
    [BM]: entry(4000, 0),
  };
  const b = getIQRBounds(data);
  assert.strictEqual(getSellPrice(data, "E", b, "X"), 0, "typo ask still rejected");
  assert.strictEqual(getSellPrice(data, "A", b, "X"), 5000, "normal ask kept");
});

test("a genuine city buy outlier is STILL rejected", () => {
  const data = {
    A: entry(5000, 0), B: entry(5200, 0), C: entry(4900, 0), D: entry(5100, 0),
    E: entry(9999999, 0),
    [BM]: entry(6000, 0),
  };
  const b = getIQRBounds(data);
  assert.strictEqual(getBuyPrice(data, "E", b, "X"), 0, "typo bid still rejected");
  assert.strictEqual(getBuyPrice(data, "A", b, "X"), 5000, "normal bid kept");
});

test("an item priced ONLY at the Black Market gives cities an empty pool", () => {
  const data = { [BM]: entry(1234, 0) };
  const b = getIQRBounds(data);
  assert.strictEqual(b.buyUpper, Infinity, "no city prices left ⇒ nothing to gate against");
  assert.strictEqual(b.sellUpper, Infinity);
  inMode("instant", () => { assert.strictEqual(getSellPrice(data, BM, b, "X"), 1234); });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
