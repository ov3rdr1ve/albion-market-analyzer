/**
 * Test: IQR outlier bounds are computed per price-side (buy vs sell).
 *
 * Regression for the "Brecilien bag shows ingredient + sell prices but no
 * profit" bug. Root cause: getIQRBounds pooled buy_price AND sell_price from
 * every city into one distribution. For a high-value crafted item that only
 * carries a real SELL listing in one city while other cities show only low BUY
 * orders, the buy orders dragged the outlier ceiling below the legitimate sell
 * price — so getSellPrice(...bounds) discarded it, collapsing the craft row to
 * "no data" even though that price is the actual market.
 *
 * Fix: getIQRBounds exposes buyUpper (from the buy_price field across cities)
 * and sellUpper (from the sell_price field), and getBuyPrice/getSellPrice each
 * bound their value against the SAME field's distribution, never the other's.
 *
 * Run: node tests/iqr-bounds-side-split.test.cjs
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

function setMarketMode() { elements["sort-instant"].checked = false; }
function setInstantMode() { elements["sort-instant"].checked = true; }

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("IQR Bounds Side-Split Tests\n");

// The exact failing shape: only Brecilien lists the bag for SALE (303,120);
// the royals carry only low BUY orders (~40k).
const bagData = {
  Brecilien: { buy_price: 0, sell_price: 303120, volume_24h: 8971 },
  Lymhurst: { buy_price: 40000, sell_price: 0, volume_24h: 5 },
  Martlock: { buy_price: 41000, sell_price: 0, volume_24h: 5 },
  Bridgewatch: { buy_price: 39000, sell_price: 0, volume_24h: 5 },
  "Fort Sterling": { buy_price: 38000, sell_price: 0, volume_24h: 5 },
  Thetford: { buy_price: 40500, sell_price: 0, volume_24h: 5 },
};

test("getIQRBounds exposes separate buyUpper and sellUpper", () => {
  const b = getIQRBounds(bagData);
  assert.ok("buyUpper" in b, "should expose buyUpper");
  assert.ok("sellUpper" in b, "should expose sellUpper");
  assert.ok("upper" in b, "should keep combined upper for back-compat");
});

test("lone high sell price survives when other cities only have low buy orders", () => {
  setMarketMode();
  const b = getIQRBounds(bagData);
  const p = getSellPrice(bagData, "Brecilien", b, "T7_BAG@1");
  assert.strictEqual(p, 303120, "sell price must NOT be flagged as a buy-side outlier");
});

test("sellUpper is driven only by sell_price values, not buy_price values", () => {
  const b = getIQRBounds(bagData);
  // Only one sell value present → lenient median*6 fallback, well above 303,120.
  assert.ok(b.sellUpper >= 303120, `sellUpper (${b.sellUpper}) should not sit below the only sell price`);
  // buyUpper is built from the ~40k cluster and is far below the sell price.
  assert.ok(b.buyUpper < 303120, `buyUpper (${b.buyUpper}) should reflect the low buy cluster`);
});

test("a genuine sell outlier IS still rejected within the sell distribution", () => {
  setMarketMode();
  const data = {
    A: { buy_price: 0, sell_price: 5000, volume_24h: 10 },
    B: { buy_price: 0, sell_price: 5200, volume_24h: 10 },
    C: { buy_price: 0, sell_price: 4900, volume_24h: 10 },
    D: { buy_price: 0, sell_price: 5100, volume_24h: 10 },
    E: { buy_price: 0, sell_price: 9999999, volume_24h: 1 }, // fat-finger typo
  };
  const b = getIQRBounds(data);
  assert.strictEqual(getSellPrice(data, "E", b, "X"), 0, "typo sell price still rejected");
  assert.strictEqual(getSellPrice(data, "A", b, "X"), 5000, "normal sell price kept");
});

test("a genuine buy outlier IS still rejected within the buy distribution", () => {
  setMarketMode();
  const data = {
    A: { buy_price: 5000, sell_price: 0, volume_24h: 10 },
    B: { buy_price: 5200, sell_price: 0, volume_24h: 10 },
    C: { buy_price: 4900, sell_price: 0, volume_24h: 10 },
    D: { buy_price: 5100, sell_price: 0, volume_24h: 10 },
    E: { buy_price: 9999999, sell_price: 0, volume_24h: 1 },
  };
  const b = getIQRBounds(data);
  assert.strictEqual(getBuyPrice(data, "E", b, "X"), 0, "typo buy price still rejected");
  assert.strictEqual(getBuyPrice(data, "A", b, "X"), 5000, "normal buy price kept");
});

test("instant mode bounds the instant-buy value against the sell distribution", () => {
  // Instant buy pays the ask (sell_price). The lone high ask in Brecilien must
  // be bounded by the sell distribution (lenient), not the low buy cluster.
  setInstantMode();
  const b = getIQRBounds(bagData);
  const p = getBuyPrice(bagData, "Brecilien", b, "T7_BAG@1");
  assert.strictEqual(p, 303120, "instant-buy ask should survive (bounded by sell side)");
  setMarketMode();
});

test("back-compat: a stub bounds object with only {upper} still gates prices", () => {
  setMarketMode();
  const data = { A: { buy_price: 0, sell_price: 100, volume_24h: 5 } };
  assert.strictEqual(getSellPrice(data, "A", { upper: Infinity }, "X"), 100, "Infinity upper keeps price");
  assert.strictEqual(getSellPrice(data, "A", { upper: 50 }, "X"), 0, "tight legacy upper still rejects");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
