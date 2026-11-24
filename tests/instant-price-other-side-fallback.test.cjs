/**
 * Test: under Instant pricing, a leg whose own side of the book is empty prices
 * from the OTHER side of the same book instead of reading 0.
 *
 * Reported (sniffer "no prices"): the captured file held fresh Lymhurst cells,
 * yet rows were blank. User: "there are prices but since table looking to buy
 * cheapest by buy order when i switch app to instant buy its empty". Instant buy
 * reads the ask (sell_price); those books were bid-only, so every buy leg read 0.
 *
 * Decision (2026-09-10): under Instant,
 *   buy  leg: ask → (ask at any quality, see captured-buy-any-quality) → bid
 *   sell leg: bid → ask
 * Market Orders are unchanged (one field per leg). An active override still wins.
 * The outlier gate measures the fallback against ITS field's distribution.
 *
 * Revised 2026-09-11 for the BUY leg: nothing can be bought instantly from a buy
 * order. The Crafting Planner bought a Tame Firewing Drake "@ 1,500,003 ea (from
 * Fort Sterling)" off a standing bid with no seller in the market, and the next
 * city it reached for was another bid. User's call: an Instant buy with no sell
 * orders reads 0 and the cell says "no instant orders", click to set. The sell
 * leg's bid → ask fallback is unchanged.
 *
 * Black box over the REAL js/utils.js + js/price-book-fallback.js. Synthetic books.
 *
 * Run: node tests/instant-price-other-side-fallback.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const _radios = { "buy-instant": { checked: true }, "sell-instant": { checked: true } };
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
const read = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
vm.runInContext(
  read("price-book-fallback.js") + "\n" + (read("utils.js") + read("utils-item-ids.js") + read("utils-overrides.js") + read("utils-focus-fees.js")) + "\n"
    + read("price-freshness.js").replace(/if \(typeof module[\s\S]*$/, "")
    + `
;globalThis.__exp = { getBuyPrice, getSellPrice, setOverrideEntry, priceOverrides, priceDateFor };`,
  vm.createContext(sandbox),
  { filename: "utils.js" },
);
const { getBuyPrice, getSellPrice, setOverrideEntry } = sandbox.__exp;

function setMode(mode, side) {
  if (side !== "sell") _radios["buy-instant"].checked = mode === "instant";
  if (side !== "buy") _radios["sell-instant"].checked = mode === "instant";
}
function clearOverrides() {
  const store = sandbox.__exp.priceOverrides;
  Object.keys(store).forEach((k) => delete store[k]);
}

let passed = 0, failed = 0;
function test(name, fn) {
  clearOverrides();
  setMode("market");
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const book = (buy, sell) => ({ Lymhurst: { buy_price: buy, sell_price: sell, volume_24h: 0 } });

console.log("Instant pricing — other-side fallback\n");

// [label, buyMode, sellMode, cell(buy,sell), wantBuyLeg, wantSellLeg]
[
  ["instant, full book: each leg reads its own side", "instant", "instant", [900, 1000], 1000, 900],
  ["instant buy, bid-only book: nothing to buy, the bid is not a stand-in", "instant", "instant", [900, 0], 0, 900],
  ["instant sell, ask-only book: sell reads the ask", "instant", "instant", [0, 1000], 1000, 1000],
  ["instant, empty book: both legs read 0", "instant", "instant", [0, 0], 0, 0],
  ["market orders, bid-only book: sell leg stays 0 (no fallback)", "market", "market", [900, 0], 900, 0],
  ["market orders, ask-only book: buy leg stays 0 (no fallback)", "market", "market", [0, 1000], 0, 1000],
  ["mixed: market buy stays strict, instant sell falls back", "market", "instant", [0, 1000], 0, 1000],
  ["mixed: instant buy and market sell both stay strict", "instant", "market", [900, 0], 0, 0],
].forEach(([label, buyMode, sellMode, [b, s], wantBuy, wantSell]) => {
  test(label, () => {
    setMode(buyMode, "buy");
    setMode(sellMode, "sell");
    assert.strictEqual(getBuyPrice(book(b, s), "Lymhurst", null, "T5_PLANKS"), wantBuy, "buy leg");
    assert.strictEqual(getSellPrice(book(b, s), "Lymhurst", null, "T5_PLANKS"), wantSell, "sell leg");
  });
});

test("an active override still wins over the fallback", () => {
  setMode("instant");
  setOverrideEntry("T5_PLANKS", "Lymhurst", { buyOrder: 111, sellOrder: 222, use: "auto" });
  assert.strictEqual(getBuyPrice(book(900, 0), "Lymhurst", null, "T5_PLANKS"), 222);
});

test("no cell for the city still reads 0", () => {
  setMode("instant");
  assert.strictEqual(getBuyPrice({}, "Lymhurst", null, "T5_PLANKS"), 0);
  assert.strictEqual(getSellPrice({}, "Lymhurst", null, "T5_PLANKS"), 0);
});

test("an instant buy never reads a bid, whatever the outlier bounds", () => {
  setMode("instant");
  const bounds = { buyUpper: 2000, sellUpper: 10000, upper: 10000 };
  assert.strictEqual(getBuyPrice(book(900, 0), "Lymhurst", bounds, "T5_PLANKS"), 0);
  assert.strictEqual(getBuyPrice(book(900, 5000), "Lymhurst", bounds, "T5_PLANKS"), 5000);
});

test("the fallback ask on an instant sell is gated against the ASK distribution", () => {
  setMode("instant");
  const bounds = { buyUpper: 1000, sellUpper: 8000, upper: 8000 };
  assert.strictEqual(getSellPrice(book(0, 5000), "Lymhurst", bounds, "T5_PLANKS"), 5000);
  assert.strictEqual(getSellPrice(book(0, 90000), "Lymhurst", bounds, "T5_PLANKS"), 0);
});

// ── The age badge dates the number actually printed ───────────────────────
const { priceDateFor } = sandbox.__exp;
const dated = (buy, sell) => ({
  buy_price: buy, sell_price: sell, buy_date: "2026-09-10T10:00:00Z", sell_date: "2026-09-09T10:00:00Z",
});

[
  // No ask to date: the leg read nothing, so it badges its own (ask) field.
  ["instant buy, bid-only: the ask's date, not the unread bid's", dated(900, 0), "buy", "instant", "2026-09-09T10:00:00Z"],
  ["instant buy, full book: the ask's date", dated(900, 1000), "buy", "instant", "2026-09-09T10:00:00Z"],
  ["instant sell, ask-only: the ask's date", dated(0, 1000), "sell", "instant", "2026-09-09T10:00:00Z"],
  // Market Orders never fall back, so the badge keeps reading the leg's own field.
  ["market buy, ask-only: its own field's date, as before", dated(0, 1000), "buy", "market", "2026-09-10T10:00:00Z"],
].forEach(([label, entry, side, mode, want]) => {
  test(`priceDateFor — ${label}`, () => {
    assert.strictEqual(priceDateFor(entry, side, mode), want);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
