/**
 * Test: the Black Market obeys the Pricing Model (Instant / Market Orders).
 *
 * Reported: with "Market Orders (Patient)" selected, a Flipping row selling
 * Grandmaster's Bag [T7] into the Black Market still quoted the Black Market
 * BID (87,147) instead of its sell order (140,986). getSellPrice carried a
 * `city === "Black Market"` special case that forced the bid in BOTH pricing
 * models, justified by a comment claiming the Black Market "has no asks".
 *
 * It does have asks. Selling into the Black Market is the same two-sided choice
 * as any city: fill its standing buy order now (Instant), or list your own sell
 * order and wait for the merchant's demand to reach it (Market Orders). So the
 * toggle applies there like everywhere else.
 *
 * What the Black Market IS exempt from is the cross-city outlier fence — it
 * pays a structurally different price and getIQRBounds leaves it out of both
 * pools (see tests/iqr-bounds-black-market.test.cjs). That exemption must now
 * cover BOTH fields.
 *
 * This file compiles the REAL js/utils.js. The pre-existing coverage
 * (tests/order-type-pricing.test.cjs) replicated getSellPrice in-file, which is
 * exactly how the bug passed a green suite.
 *
 * No market API, no database — synthetic order books only.
 *
 * Run: node tests/black-market-order-type.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ── Load the real js/utils.js ───────────────────────────────────────────────
// The Pricing Model is two radio groups, one per leg. Selling into the Black
// Market is a SELL, so it is the sell group that decides its field; the buy
// group is here to prove it has no say.
const elements = {
  "buy-instant": { checked: false },
  "sell-instant": { checked: false },   // default: market orders on both legs
};
const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
sandbox.document = { getElementById: (id) => elements[id] || null };
sandbox.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
const ctx = vm.createContext(sandbox);
// The leg reader (js/price-book-fallback.js) ships beside utils.js in the page.
let code = fs.readFileSync(path.join(__dirname, "..", "js", "price-book-fallback.js"), "utf8")
  + "\n" + ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"].map((n) => fs.readFileSync(path.join(__dirname, "..", "js", n + ".js"), "utf8")).join("\n");
code += "\n;globalThis.__exp = { getIQRBounds, getBuyPrice, getSellPrice,"
      + " getQualitySellPrice, resolveOverrideSide, getOverridePrice, priceOverrides };";
vm.runInContext(code, ctx, { filename: "utils.js" });
const {
  getIQRBounds, getBuyPrice, getSellPrice, getQualitySellPrice, resolveOverrideSide,
  getOverridePrice,
} = sandbox.__exp;

const BM = "Black Market";
const INSTANT = "instant";
const MARKET = "market";
const setMode = (mode, side) => {
  if (side !== "sell") elements["buy-instant"].checked = mode === INSTANT;
  if (side !== "buy") elements["sell-instant"].checked = mode === INSTANT;
};
/** Replace the live override store (a module-scope object, mutated in place). */
const setOverrides = (obj) => {
  const store = sandbox.__exp.priceOverrides;
  Object.keys(store).forEach((k) => delete store[k]);
  Object.assign(store, obj);
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { setMode(MARKET); setOverrides({}); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// The reported book: T7_BAG. Lymhurst bid 81,222 / ask 109,996; the Black
// Market bids 87,147 and lists at 140,986.
const T7_BAG = {
  [BM]: { buy_price: 87147, sell_price: 140986, volume_24h: 20790 },
  Lymhurst: { buy_price: 81222, sell_price: 109996, volume_24h: 3321 },
  Caerleon: { buy_price: 80000, sell_price: 112000, volume_24h: 900 },
};

console.log("Black Market order-type tests\n");

// ── 1-2. The field the sell leg reads, parameterised over mode × city ───────

[
  [MARKET, BM, 140986, "market orders at the Black Market list a sell order"],
  [INSTANT, BM, 87147, "instant at the Black Market fills its buy order"],
  [MARKET, "Lymhurst", 109996, "market orders in a city list a sell order"],
  [INSTANT, "Lymhurst", 81222, "instant in a city fills its buy order"],
].forEach(([mode, city, expected, label]) => {
  test(`${label} (${mode} @ ${city} = ${expected})`, () => {
    setMode(mode);
    assert.strictEqual(getSellPrice(T7_BAG, city, null, "T7_BAG"), expected);
  });
});

test("the Black Market is no longer pinned — the two modes disagree", () => {
  setMode(INSTANT);
  const instant = getSellPrice(T7_BAG, BM, null, "T7_BAG");
  setMode(MARKET);
  const market = getSellPrice(T7_BAG, BM, null, "T7_BAG");
  assert.notStrictEqual(instant, market);
});

// ── 3. A missing field: market orders drop the leg, Instant falls back ──────
// Under Instant an empty side prices from the other side of the same book — the
// sniffer "no prices" decision (tests/instant-price-other-side-fallback.test.cjs).
// A patient order has no other side to fall back on.

[
  [MARKET, { buy_price: 87147, sell_price: 0 }, 0, "no ask under market orders drops the leg"],
  [INSTANT, { buy_price: 0, sell_price: 140986 }, 140986, "no bid under instant reads the ask"],
  [INSTANT, { buy_price: 0, sell_price: 0 }, 0, "an empty book under instant drops the leg"],
].forEach(([mode, bm, expected, label]) => {
  test(`${label} (${expected})`, () => {
    setMode(mode);
    const data = { ...T7_BAG, [BM]: { ...bm, volume_24h: 10 } };
    assert.strictEqual(getSellPrice(data, BM, null, "T7_BAG"), expected);
  });
});

// ── 4. The buy side at the Black Market ─────────────────────────────────────
// You cannot buy AT the Black Market (isInvalidCrossRoute blocks it), so
// getBuyPrice has no special case there and must be pure toggle behaviour.

[
  [MARKET, 87147],
  [INSTANT, 140986],
].forEach(([mode, expected]) => {
  test(`getBuyPrice at the Black Market is plain toggle behaviour (${mode})`, () => {
    setMode(mode);
    assert.strictEqual(getBuyPrice(T7_BAG, BM, null, "T7_BAG"), expected);
  });
});

// ── 5. Both BM fields stay exempt from the IQR fence ────────────────────────

const thinBook = {
  [BM]: { buy_price: 2686, sell_price: 999999, volume_24h: 10 },
  Brecilien: { buy_price: 22, sell_price: 2530, volume_24h: 10 },
  Martlock: { buy_price: 545, sell_price: 1900, volume_24h: 10 },
  Thetford: { buy_price: 300, sell_price: 1499, volume_24h: 10 },
  Lymhurst: { buy_price: 410, sell_price: 2236, volume_24h: 10 },
};

[
  [INSTANT, 2686, "bid"],
  [MARKET, 999999, "ask"],
].forEach(([mode, expected, field]) => {
  test(`the BM ${field} clears the outlier fence (${mode})`, () => {
    setMode(mode);
    const bounds = getIQRBounds(thinBook);
    assert.strictEqual(getSellPrice(thinBook, BM, bounds, "T3_BAG"), expected);
  });
});

test("a city ask far above the distribution is still fenced off", () => {
  // The junk city is Fort Sterling: Caerleon is exempt from the fence now
  // (plan-caerleon-exempt.md), so its ask would be returned as-is.
  const data = { ...thinBook, "Fort Sterling": { buy_price: 0, sell_price: 999999, volume_24h: 10 } };
  const bounds = getIQRBounds(data);
  assert.strictEqual(getSellPrice(data, "Fort Sterling", bounds, "T3_BAG"), 0);
});

// ── 6. getQualitySellPrice mirrors the same rule ────────────────────────────

const QUALITY = { T7_BAG: { 3: { [BM]: { buy_price: 87147, sell_price: 140986, volume_24h: 5 } } } };

[
  [MARKET, 140986],
  [INSTANT, 87147],
].forEach(([mode, expected]) => {
  test(`getQualitySellPrice at the Black Market follows the toggle (${mode})`, () => {
    setMode(mode);
    assert.strictEqual(getQualitySellPrice(QUALITY, "T7_BAG", 3, BM), expected);
  });
});

test("getQualitySellPrice drops the BM leg when the ask is missing (market)", () => {
  setMode(MARKET);
  const q = { T7_BAG: { 3: { [BM]: { buy_price: 87147, sell_price: 0, volume_24h: 5 } } } };
  assert.strictEqual(getQualitySellPrice(q, "T7_BAG", 3, BM), 0);
});

// ── 7. Overrides: "auto" follows the toggle at the BM too, a pin still wins ──

const AUTO_ENTRY = { T7_BAG: { [BM]: { buyOrder: 11, sellOrder: 22, use: "auto" } } };

[
  [MARKET, "sell", 22],
  [INSTANT, "buy", 11],
].forEach(([mode, field, expected]) => {
  test(`an "auto" override at the BM reads the ${field} order (${mode})`, () => {
    setMode(mode);
    setOverrides(AUTO_ENTRY);
    const entry = AUTO_ENTRY.T7_BAG[BM];
    assert.strictEqual(resolveOverrideSide(entry, BM, "sell"), field);
    assert.strictEqual(getOverridePrice("T7_BAG", BM, "sell"), expected);
    assert.strictEqual(getSellPrice(T7_BAG, BM, null, "T7_BAG"), expected, "override wins over live data");
  });
});

[MARKET, INSTANT].forEach((mode) => {
  test(`a PINNED override at the BM ignores the toggle (${mode})`, () => {
    setMode(mode);
    setOverrides({ T7_BAG: { [BM]: { buyOrder: 11, sellOrder: 22, use: "buy" } } });
    assert.strictEqual(getSellPrice(T7_BAG, BM, null, "T7_BAG"), 11);
  });
});

test('an "auto" override carrying only one price still answers with it', () => {
  setMode(MARKET);
  setOverrides({ T7_BAG: { [BM]: { buyOrder: 11, use: "auto" } } });
  assert.strictEqual(getSellPrice(T7_BAG, BM, null, "T7_BAG"), 11,
    "a hand-typed number is not a market field — the fallback stays");
});

// ── The buy leg has no say over a sale into the Black Market ───────────────
[
  [MARKET, 140986, "lists a sell order"],
  [INSTANT, 87147, "fills its buy order"],
].forEach(([sellMode, expected, what]) => {
  [MARKET, INSTANT].forEach((buyMode) => {
    test(`sell ${sellMode} ${what} whatever the buy leg says (buy ${buyMode})`, () => {
      setMode(buyMode, "buy");
      setMode(sellMode, "sell");
      assert.strictEqual(getSellPrice(T7_BAG, BM, null, "T7_BAG"), expected);
    });
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
