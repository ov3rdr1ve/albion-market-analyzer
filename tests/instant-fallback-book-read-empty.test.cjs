/**
 * Test: the Instant other-side fallback never crosses a side whose book was
 * READ and found empty.
 *
 * Reported 2026-09-11 on the Crafting Planner: "i opened fort sterling market
 * with sniffer active and theres no sell order for this item, but table still
 * shows its there". The row bought `1x Tame Firewing Drake @ 1,500,003 ea (from
 * Fort Sterling)`. The stored cell had no ask at all — 1,500,003 was a standing
 * BUY order, which the Instant buy leg reads when the ask side is empty
 * (js/price-book-fallback.js, decided 2026-09-10 for bid-only captures).
 *
 * That fallback exists for a side nobody has LOOKED at. Once the ask list was
 * opened and came back empty (`sell_seen`, js/market-price-store.js
 * stampBookSeen), there is nothing to buy instantly in that market, and quoting
 * the bid as a purchase price is exactly the reported lie. Symmetric for a sell
 * leg: a bid list read empty cannot be sold into, so the ask is not a stand-in.
 *
 * The same day the user went further for the BUY leg: it never reads a bid at
 * all (tests/instant-price-other-side-fallback.test.cjs). The sell-leg rule here
 * is what still depends on the stamp.
 *
 * Black box over the REAL js/utils.js + js/price-book-fallback.js +
 * js/price-freshness.js. Synthetic books.
 *
 * Run: node tests/instant-fallback-book-read-empty.test.cjs
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
;globalThis.__exp = { getBuyPrice, getSellPrice, setOverrideEntry, priceOverrides, priceDateFor, bookEmptySince };
globalThis.__setMaps = (flat, quality) => { lastMarketData = flat; lastQualityMarketData = quality; };`,
  vm.createContext(sandbox),
  { filename: "utils.js" },
);
const { getBuyPrice, getSellPrice, setOverrideEntry, priceDateFor, bookEmptySince } = sandbox.__exp;

function setMode(mode, side) {
  if (side !== "sell") _radios["buy-instant"].checked = mode === "instant";
  if (side !== "buy") _radios["sell-instant"].checked = mode === "instant";
}

let passed = 0, failed = 0;
function test(name, fn) {
  Object.keys(sandbox.__exp.priceOverrides).forEach((k) => delete sandbox.__exp.priceOverrides[k]);
  sandbox.__setMaps(undefined, undefined);
  setMode("instant");
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const FS = "Fort Sterling";
const ID = "T8_FARM_DRAKE_GROWN";
const BID_AT = "2026-09-11T08:40:10.788Z";
const LOOKED = "2026-09-11T08:40:09.500Z";
const OLD_LOOK = "2026-09-01T06:31:32.193Z";
const at = (cell) => ({ [FS]: { volume_24h: 0, sell_date: null, buy_date: null, ...cell } });

console.log("Instant fallback — a book read empty is not crossed\n");

// [label, cell, wantBuyLeg, wantSellLeg]
[
  ["the reported drake: ask list read empty, bid standing — nothing to buy",
    { buy_price: 1500003, sell_price: 0, buy_date: BID_AT, buy_seen: BID_AT, sell_seen: LOOKED }, 0, 1500003],
  ["an ask list read empty long ago still blocks the bid stand-in",
    { buy_price: 1500003, sell_price: 0, buy_date: BID_AT, sell_seen: OLD_LOOK }, 0, 1500003],
  // Revised 2026-09-11 (user): an Instant buy never reads a bid, looked or not.
  ["bid-only book, ask list never read: still nothing to buy instantly",
    { buy_price: 900, sell_price: 0, buy_date: BID_AT, buy_seen: BID_AT }, 0, 900],
  ["bid list read empty, ask standing — nothing to sell into",
    { buy_price: 0, sell_price: 1000, sell_date: BID_AT, sell_seen: BID_AT, buy_seen: LOOKED }, 1000, 0],
  ["ask-only book, bid list never read: the ask still stands in",
    { buy_price: 0, sell_price: 1000, sell_date: BID_AT, sell_seen: BID_AT }, 1000, 1000],
  ["both lists read empty: both legs read 0",
    { buy_price: 0, sell_price: 0, sell_seen: LOOKED, buy_seen: LOOKED }, 0, 0],
  ["a full book is untouched by its stamps",
    { buy_price: 900, sell_price: 1000, buy_date: BID_AT, sell_date: BID_AT, buy_seen: BID_AT, sell_seen: BID_AT }, 1000, 900],
].forEach(([label, cell, wantBuy, wantSell]) => {
  test(label, () => {
    assert.strictEqual(getBuyPrice(at(cell), FS, null, ID), wantBuy, "buy leg");
    assert.strictEqual(getSellPrice(at(cell), FS, null, ID), wantSell, "sell leg");
  });
});

test("Market Orders are unaffected: the buy leg reads the bid, stamps or not", () => {
  setMode("market");
  const cell = { buy_price: 1500003, sell_price: 0, buy_date: BID_AT, sell_seen: LOOKED };
  assert.strictEqual(getBuyPrice(at(cell), FS, null, ID), 1500003);
});

test("an override still wins over a book read empty", () => {
  setOverrideEntry(ID, FS, { buyOrder: 111, sellOrder: 222, use: "auto" });
  const cell = { buy_price: 1500003, sell_price: 0, sell_seen: LOOKED };
  assert.strictEqual(getBuyPrice(at(cell), FS, null, ID), 222);
});

test("a Good ask captured in the same read still prices the buy leg", () => {
  // stampBookSeen stamps quality 1 even when only Good was listed; the any-quality
  // read comes before the cross-side one, so a real ask at another quality wins.
  const flat = { [ID]: at({ buy_price: 1500003, sell_price: 0, buy_date: BID_AT, sell_seen: LOOKED }) };
  const quality = { [ID]: {
    1: at({ buy_price: 1500003, sell_price: 0, sell_seen: LOOKED }),
    2: at({ buy_price: 0, sell_price: 1800000, sell_date: LOOKED, sell_seen: LOOKED }),
  } };
  sandbox.__setMaps(flat, quality);
  assert.strictEqual(getBuyPrice(flat[ID], FS, null, ID), 1800000);
});

test("the age badge no longer dates a bid the leg does not read", () => {
  const cell = { buy_price: 1500003, sell_price: 0, buy_date: BID_AT, sell_date: null, sell_seen: LOOKED };
  assert.strictEqual(priceDateFor(cell, "buy", "instant"), null);
});

test("the cell still says the ask list was looked at", () => {
  const cell = { buy_price: 1500003, sell_price: 0, buy_date: BID_AT, sell_date: null, sell_seen: LOOKED };
  assert.strictEqual(bookEmptySince(cell, "buy", "instant"), LOOKED);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
