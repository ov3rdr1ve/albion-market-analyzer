/**
 * Test: Instant vs Market Orders price selection, per LEG.
 *
 * - Instant buy reads sell_price  (sell_price_min from the API = cheapest ask)
 * - Instant sell reads buy_price  (buy_price_max  from the API = fattest bid)
 * - Market buy  reads buy_price
 * - Market sell reads sell_price
 *
 * The Buy and Sell Pricing Model radios are independent, so each leg asks its
 * own toggle. Most cases below move both together (the pre-split behaviour, and
 * still the common setting); the per-leg block proves they are not linked.
 *
 * This file compiles the REAL js/utils.js. It used to re-implement getBuyPrice /
 * getSellPrice inline, which is exactly how the Black Market bug passed a green
 * suite (see tests/black-market-order-type.test.cjs).
 *
 * No market API, no database — synthetic order books only.
 *
 * Run: node tests/order-type-pricing.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ── Load the real js/utils.js against the two radio groups ─────────────────
const _radios = {
  "buy-instant": { checked: true },
  "sell-instant": { checked: true },
};
const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
sandbox.document = { getElementById: (id) => _radios[id] || null, querySelector: () => null };
sandbox.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
vm.runInContext(
  // The leg reader (js/price-book-fallback.js) ships beside utils.js in the page.
  fs.readFileSync(path.join(__dirname, "..", "js", "price-book-fallback.js"), "utf8") + "\n"
    + ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"].map((n) => fs.readFileSync(path.join(__dirname, "..", "js", n + ".js"), "utf8")).join("\n")
    + `
;globalThis.__exp = { getOrderType, getBuyPrice, getSellPrice,
  setOverrideEntry, priceOverrides };`,
  vm.createContext(sandbox),
  { filename: "utils.js" },
);
const { getOrderType, getBuyPrice, getSellPrice, setOverrideEntry } = sandbox.__exp;

/** The override store is a module-scope object, mutated in place. */
function clearOverrides() {
  const store = sandbox.__exp.priceOverrides;
  Object.keys(store).forEach((k) => delete store[k]);
}

// ── Test data ────────────────────────────────────────────────────────────
// Simulating what the API returns after mapping:
// buy_price = buy_price_max (highest buy order) = 2906
// sell_price = sell_price_min (lowest sell order) = 3899
const mockItemData = {
  Bridgewatch: {
    buy_price: 2906,   // buy_price_max from API
    sell_price: 3899,  // sell_price_min from API
    volume_24h: 100,
  },
  Lymhurst: {
    buy_price: 2800,
    sell_price: 3700,
    volume_24h: 50,
  },
};

// ── Test harness ─────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

/** Set one leg, or both when `side` is omitted. */
function setMode(mode, side) {
  if (side !== "sell") _radios["buy-instant"].checked = mode === "instant";
  if (side !== "buy") _radios["sell-instant"].checked = mode === "instant";
}

// ── Tests ────────────────────────────────────────────────────────────────
console.log("Order Type Pricing Tests\n");

// --- getOrderType basic tests ---

test("getOrderType returns 'instant' when the instant radios are checked", () => {
  setMode("instant");
  assert.strictEqual(getOrderType("buy"), "instant");
  assert.strictEqual(getOrderType("sell"), "instant");
});

test("getOrderType returns 'market' when the instant radios are unchecked", () => {
  setMode("market");
  assert.strictEqual(getOrderType("buy"), "market");
  assert.strictEqual(getOrderType("sell"), "market");
});

// --- Instant mode: Buy prices should use sell_price (sell_price_min) ---

test("Instant: getBuyPrice returns sell_price (3899), not buy_price (2906)", () => {
  setMode("instant");
  const price = getBuyPrice(mockItemData, "Bridgewatch", null, "TEST_ITEM");
  assert.strictEqual(price, 3899, `Expected sell_price=3899 for instant buy, got ${price}`);
});

test("Instant: getBuyPrice returns sell_price for Lymhurst (3700)", () => {
  setMode("instant");
  const price = getBuyPrice(mockItemData, "Lymhurst", null, "TEST_ITEM");
  assert.strictEqual(price, 3700);
});

// --- Instant mode: Sell prices should use buy_price (buy_price_max) ---

test("Instant: getSellPrice returns buy_price (2906), not sell_price (3899)", () => {
  setMode("instant");
  const price = getSellPrice(mockItemData, "Bridgewatch", null, "TEST_ITEM");
  assert.strictEqual(price, 2906, `Expected buy_price=2906 for instant sell, got ${price}`);
});

// --- Patient mode: Buy prices should use buy_price (buy_price_max) ---

test("Patient: getBuyPrice returns buy_price (2906), not sell_price (3899)", () => {
  setMode("market");
  const price = getBuyPrice(mockItemData, "Bridgewatch", null, "TEST_ITEM");
  assert.strictEqual(price, 2906, `Expected buy_price=2906 for patient buy, got ${price}`);
});

// --- Patient mode: Sell prices should use sell_price (sell_price_min) ---

test("Patient: getSellPrice returns sell_price (3899), not buy_price (2906)", () => {
  setMode("market");
  const price = getSellPrice(mockItemData, "Bridgewatch", null, "TEST_ITEM");
  assert.strictEqual(price, 3899, `Expected sell_price=3899 for patient sell, got ${price}`);
});

// --- Mode switching changes output ---

test("Switching modes changes getBuyPrice output", () => {
  setMode("instant");
  const instantBuy = getBuyPrice(mockItemData, "Bridgewatch", null, "TEST_ITEM");
  setMode("market");
  const patientBuy = getBuyPrice(mockItemData, "Bridgewatch", null, "TEST_ITEM");
  assert.notStrictEqual(instantBuy, patientBuy, "Instant and patient buy prices should differ");
  assert.strictEqual(instantBuy, 3899, "Instant buy = sell_price");
  assert.strictEqual(patientBuy, 2906, "Patient buy = buy_price");
});

test("Switching modes changes getSellPrice output", () => {
  setMode("instant");
  const instantSell = getSellPrice(mockItemData, "Bridgewatch", null, "TEST_ITEM");
  setMode("market");
  const patientSell = getSellPrice(mockItemData, "Bridgewatch", null, "TEST_ITEM");
  assert.notStrictEqual(instantSell, patientSell, "Instant and patient sell prices should differ");
  assert.strictEqual(instantSell, 2906, "Instant sell = buy_price");
  assert.strictEqual(patientSell, 3899, "Patient sell = sell_price");
});

// --- The Black Market follows the toggle like any other city ---
// It does take sell orders: fill its standing buy order (instant) or list your
// own price and wait for the merchant demand to reach it (market orders). The
// authoritative coverage, against the real js/utils.js, is in
// tests/black-market-order-type.test.cjs.

const bmData = {
  "Black Market": { buy_price: 5000, sell_price: 6000, volume_24h: 100 },
};

test("Black Market: patient sell reads the sell order (6000)", () => {
  setMode("market");
  assert.strictEqual(getSellPrice(bmData, "Black Market", null, "TEST_ITEM"), 6000);
});

test("Black Market: instant sell reads the bid (5000)", () => {
  setMode("instant");
  assert.strictEqual(getSellPrice(bmData, "Black Market", null, "TEST_ITEM"), 5000);
  setMode("market");
});

// --- Margin comparison: instant should have worse margins ---

test("Instant mode produces worse margins than patient mode for crafting", () => {
  const matData = {
    Bridgewatch: { buy_price: 100, sell_price: 150, volume_24h: 100 },
  };
  const gearData = {
    Bridgewatch: { buy_price: 800, sell_price: 1000, volume_24h: 50 },
  };

  // Instant: buy mat at 150, sell gear at 800 → profit = 800 - 150 = 650
  setMode("instant");
  const instantMatCost = getBuyPrice(matData, "Bridgewatch", null, "MAT");
  const instantGearRevenue = getSellPrice(gearData, "Bridgewatch", null, "GEAR");
  const instantProfit = instantGearRevenue - instantMatCost;

  // Patient: buy mat at 100, sell gear at 1000 → profit = 1000 - 100 = 900
  setMode("market");
  const patientMatCost = getBuyPrice(matData, "Bridgewatch", null, "MAT");
  const patientGearRevenue = getSellPrice(gearData, "Bridgewatch", null, "GEAR");
  const patientProfit = patientGearRevenue - patientMatCost;

  assert.ok(
    patientProfit > instantProfit,
    `Patient profit (${patientProfit}) should > instant profit (${instantProfit})`
  );
  assert.strictEqual(instantMatCost, 150, "Instant mat cost = sell_price");
  assert.strictEqual(patientMatCost, 100, "Patient mat cost = buy_price");
  assert.strictEqual(instantGearRevenue, 800, "Instant gear revenue = buy_price");
  assert.strictEqual(patientGearRevenue, 1000, "Patient gear revenue = sell_price");
});

// --- Edge: zero prices ---

// An empty ask under Instant briefly fell back to the bid (2026-09-10). Withdrawn
// 2026-09-11 by the user: nothing can be bought instantly from a buy order, so
// the leg reads 0 and the cell says "no instant orders"
// (tests/instant-price-other-side-fallback.test.cjs, tests/no-instant-orders.test.cjs).
test("Instant buy with no ask reads 0, bid or not; Market Orders read the bid", () => {
  const noSellData = { Bridgewatch: { buy_price: 500, sell_price: 0, volume_24h: 10 } };
  setMode("instant");
  assert.strictEqual(getBuyPrice(noSellData, "Bridgewatch", null, "X"), 0);
  setMode("market");
  assert.strictEqual(getBuyPrice(noSellData, "Bridgewatch", null, "X"), 500);
  const emptyBook = { Bridgewatch: { buy_price: 0, sell_price: 0, volume_24h: 10 } };
  setMode("instant");
  assert.strictEqual(getBuyPrice(emptyBook, "Bridgewatch", null, "X"), 0);
  setMode("market");
});

// --- Active override wins over live data and ignores the order-type toggle ---

test("Override: active=buy returns the buy-order value for buy AND sell, in any mode", () => {
  clearOverrides();
  setOverrideEntry("OV", "Bridgewatch", { buyOrder: 1234, sellOrder: 4321, use: "buy" });
  setMode("market");
  assert.strictEqual(getBuyPrice(mockItemData, "Bridgewatch", null, "OV"), 1234);
  assert.strictEqual(getSellPrice(mockItemData, "Bridgewatch", null, "OV"), 1234);
  setMode("instant");
  assert.strictEqual(getBuyPrice(mockItemData, "Bridgewatch", null, "OV"), 1234, "toggle ignored");
  assert.strictEqual(getSellPrice(mockItemData, "Bridgewatch", null, "OV"), 1234, "toggle ignored");
  setMode("market");
  clearOverrides();
});

test("Override: active=sell models an instant buy (mat valued at the ask)", () => {
  clearOverrides();
  setMode("market");
  setOverrideEntry("OV", "Bridgewatch", { buyOrder: 2906, sellOrder: 3899, use: "sell" });
  assert.strictEqual(getBuyPrice(mockItemData, "Bridgewatch", null, "OV"), 3899, "buy cost = sell order (ask)");
  clearOverrides();
});

test("Override: non-overridden item still follows the order-type toggle", () => {
  clearOverrides();
  setMode("instant");
  assert.strictEqual(getBuyPrice(mockItemData, "Bridgewatch", null, "OV"), 3899, "no override -> instant buy = sell_price");
  setMode("market");
  assert.strictEqual(getBuyPrice(mockItemData, "Bridgewatch", null, "OV"), 2906, "no override -> market buy = buy_price");
  clearOverrides();
});


// --- The two legs are independent ----------------------------------------
// Buy patiently and dump into the standing bid, or the mirror. Before the split
// one toggle drove both fields and neither of these was reachable.

test("Buy market / sell instant: both cells read the BID", () => {
  setMode("market", "buy");
  setMode("instant", "sell");
  assert.strictEqual(getBuyPrice(mockItemData, "Bridgewatch", null, "X"), 2906);
  assert.strictEqual(getSellPrice(mockItemData, "Bridgewatch", null, "X"), 2906);
  setMode("market");
});

test("Buy instant / sell market: both cells read the ASK", () => {
  setMode("instant", "buy");
  setMode("market", "sell");
  assert.strictEqual(getBuyPrice(mockItemData, "Bridgewatch", null, "X"), 3899);
  assert.strictEqual(getSellPrice(mockItemData, "Bridgewatch", null, "X"), 3899);
  setMode("market");
});

test("Moving one leg leaves the other where it was", () => {
  setMode("instant");
  setMode("market", "buy");
  assert.strictEqual(getBuyPrice(mockItemData, "Bridgewatch", null, "X"), 2906, "buy switched");
  assert.strictEqual(getSellPrice(mockItemData, "Bridgewatch", null, "X"), 2906, "sell still instant");
  setMode("market");
});

test("An auto override follows the CALLING leg's toggle", () => {
  clearOverrides();
  setOverrideEntry("AUTO", "Bridgewatch", { buyOrder: 1000, sellOrder: 2000, use: "auto" });
  setMode("market", "buy");
  setMode("instant", "sell");
  // A market buy reads the buy order; an instant sell also receives the bid.
  assert.strictEqual(getBuyPrice(mockItemData, "Bridgewatch", null, "AUTO"), 1000);
  assert.strictEqual(getSellPrice(mockItemData, "Bridgewatch", null, "AUTO"), 1000);
  setMode("instant", "buy");
  setMode("market", "sell");
  // An instant buy pays the ask; a market sell lists at the ask.
  assert.strictEqual(getBuyPrice(mockItemData, "Bridgewatch", null, "AUTO"), 2000);
  assert.strictEqual(getSellPrice(mockItemData, "Bridgewatch", null, "AUTO"), 2000);
  setMode("market");
  clearOverrides();
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
