/**
 * Test: an EMPTY price cell says whether anyone has looked.
 *
 * A priced cell already carries the "not listed" badge — the book was read and
 * the number above it was not in it (js/price-freshness.js, bookEmptySince).
 * A cell with no price at all had nothing: it read "no data — click to set"
 * whether the market had never been visited or its order list had come back
 * with nothing on this side.
 *
 * That is the confusion behind "I fetched every price with the sniffer and the
 * row still says no data". In `market` order type a BUY cell reads `buy_price`,
 * so a book carrying a real ask and no standing bid is empty only to the cell
 * reading the bid — and the capture stamps `buy_seen` to prove it was read.
 *
 * Black-box: compile the real priceTd out of js/app.js against stubs and read
 * the HTML. No DOM, no live API, no database.
 *
 * Run: node tests/price-cell-book-empty-note.test.cjs
 */

const fs = require("fs");
const { appSource } = require("./helpers/app-source.cjs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const appSrc = appSource();
const fnMatch = /\nfunction priceTd\([\s\S]*?\n}\n/.exec(appSrc);
assert.ok(fnMatch, "priceTd is missing from js/app.js");

// The real freshness rules — the point of the cell is that it agrees with them.
const freshness = read("js/price-freshness.js");

const ITEM = "T8_FARM_YARROW_SEED";
const CITY = "Caerleon";

// One compiled cell per order type; `lastMarketData` is swapped per case.
function harness(orderType) {
  const m = new Module("price-cell-book-empty-" + orderType);
  m._compile(
    `let lastMarketData = {};
     let lastQualityMarketData = {};
     function tx(en) { return en; }
     function formatSilver(n) { return String(Math.round(Number(n) || 0)); }
     function getOrderType() { return ${JSON.stringify(orderType)}; }
     function getOverridePrice() { return null; }
     function getOverrideField() { return null; }
     function qualityOverrideKey(id) { return id; }
     function bookDatesTitle() { return "dates"; }
     // Ages are formatted elsewhere; a fixed label keeps this test about the
     // note appearing, not about how a duration reads.
     function formatPriceAge(d) { return d ? { label: "5m ago", color: "#9ca3af" } : null; }
     ${freshness}
     ${fnMatch[0]}
     module.exports = { priceTd, setMarket: (md) => { lastMarketData = md; } };`,
    path.join(ROOT, "js", "price-cell-book-empty-test.js"),
  );
  return m.exports;
}

const MARKET = harness("market");
const INSTANT = harness("instant");

const cell = (X, entry, { price = 0, side = "buy" } = {}) => {
  X.setMarket(entry === null ? {} : { [ITEM]: { [CITY]: entry } });
  return X.priceTd(price, ITEM, CITY, side);
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

const NOTE = "no orders";
const SEEN = "2026-09-01T10:00:00.000Z";

console.log("Price cell — an empty cell says whether the book was read\n");

// ── the reported shape ──────────────────────────────────────────────────────

test("market: a read book with no bids says so on the buy cell", () => {
  const html = cell(MARKET, {
    buy_price: 0, sell_price: 49996, buy_seen: SEEN,
    sell_date: "2026-09-01T09:59:00.000Z", buy_date: null, volume_24h: 0,
  });
  assert.ok(html.includes("no data"), "the cell stopped inviting an edit");
  assert.ok(html.includes(NOTE), "no reason was given: " + html);
  assert.ok(html.includes("looked"), "the note carries no age: " + html);
});

test("the same entry's SELL cell is unaffected — its ask was there", () => {
  const html = cell(MARKET, {
    buy_price: 0, sell_price: 49996, buy_seen: SEEN,
    sell_date: "2026-09-01T09:59:00.000Z", buy_date: null, volume_24h: 0,
  }, { price: 49996, side: "sell" });
  assert.ok(!html.includes(NOTE), "a priced cell was told it has no orders: " + html);
});

// ── it must not fire without evidence ───────────────────────────────────────

test("a market nobody has read keeps the bare 'no data'", () => {
  const html = cell(MARKET, { buy_price: 0, sell_price: 0, volume_24h: 0 });
  assert.ok(html.includes("no data"));
  assert.ok(!html.includes(NOTE), "an unread book claimed to be empty: " + html);
});

test("a city with no entry at all keeps the bare 'no data'", () => {
  const html = cell(MARKET, null);
  assert.ok(html.includes("no data"));
  assert.ok(!html.includes(NOTE), "a city never scanned claimed to be empty: " + html);
});

test("a stamp OLDER than the price on that side does not fire", () => {
  const html = cell(MARKET, {
    buy_price: 0, sell_price: 0, buy_seen: "2026-08-01T00:00:00.000Z",
    buy_date: "2026-09-01T09:00:00.000Z", volume_24h: 0,
  });
  assert.ok(!html.includes(NOTE), "a stale read flagged a newer reading: " + html);
});

// ── it follows the field the cell actually printed ──────────────────────────

test("instant: a buy cell reads the ask, so a sell_seen stamp drives its note", () => {
  const entry = {
    buy_price: 0, sell_price: 0, sell_seen: SEEN, buy_date: null, sell_date: null, volume_24h: 0,
  };
  assert.ok(cell(INSTANT, entry).includes(NOTE), "instant buy ignored sell_seen");
  assert.ok(!cell(MARKET, entry).includes(NOTE), "market buy read the wrong stamp");
});

test("market: a buy cell reads the bid, so a buy_seen stamp drives its note", () => {
  const entry = {
    buy_price: 0, sell_price: 0, buy_seen: SEEN, buy_date: null, sell_date: null, volume_24h: 0,
  };
  assert.ok(cell(MARKET, entry).includes(NOTE), "market buy ignored buy_seen");
  assert.ok(!cell(INSTANT, entry).includes(NOTE), "instant buy read the wrong stamp");
});

// ── the cell stays a cell ───────────────────────────────────────────────────

test("the note never costs the cell its edit affordances", () => {
  const html = cell(MARKET, {
    buy_price: 0, sell_price: 0, buy_seen: SEEN, volume_24h: 0,
  });
  assert.ok(html.includes(`data-item-id="${ITEM}"`), "item id lost");
  assert.ok(html.includes(`data-city="${CITY}"`), "city lost");
  assert.ok(html.includes('data-city-list="buy"'), "side lost");
  assert.ok(html.includes("price-editable"), "the cell stopped being editable");
});

test("a priced cell keeps the existing 'not listed' badge, not this one", () => {
  const html = cell(MARKET, {
    buy_price: 549999, sell_price: 0, buy_seen: SEEN,
    buy_date: "2026-08-20T00:00:00.000Z", volume_24h: 10,
  }, { price: 549999 });
  assert.ok(html.includes("not listed"), "the priced-cell badge was lost: " + html);
  assert.ok(!html.includes(NOTE), "both badges fired at once: " + html);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
