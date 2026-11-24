/**
 * Test: the per-quality ladder printed under a Flipping row's price cells.
 *
 * A flip is a matched PAIR — the row buys and sells one quality — so the two
 * cells must list the SAME qualities in the SAME order. That alignment is the
 * feature: line N of Buy Cost and line N of Sell Revenue are one trade, read
 * across. Everything else here (the taken marker, the age, the pin, the undated
 * flag) exists so a reader can tell which of those trades is actually takeable.
 *
 * Black-box over the REAL js/flip-quality-breakdown.js, compiled with the same
 * kind of stubs js/app.js gives it in the browser. No DOM, no live API.
 *
 * Run: node tests/flip-quality-breakdown.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

// formatPriceAge, sliced out of app.js so the age buckets under test are the
// ones the price cell itself prints.
const appSrc = appSource();
const ageStart = appSrc.indexOf("function formatPriceAge");
const ageEnd = appSrc.indexOf("function matPriceSpan");
assert.ok(ageStart >= 0 && ageEnd > ageStart, "could not locate formatPriceAge in app.js");

const sandbox = `
let lastMarketData = null;
let lastQualityMarketData = null;
let _instant = false;
let _overrides = {};
function tx(en) { return en; }
function getOrderType() { return _instant ? "instant" : "market"; }
function getOverrideField(id, city, side) {
  const v = _overrides[id + "|" + city + "|" + side];
  return v === undefined ? null : v;
}
function getOverridePrice() { return null; }
function formatSilver(n) { return Math.round(n).toLocaleString("en-US"); }
function __setMarket(md) { lastMarketData = md; }
function __setQuality(qd) { lastQualityMarketData = qd; }
function __setInstant(on) { _instant = !!on; }
function __setOverride(id, city, side, v) { _overrides[id + "|" + city + "|" + side] = v; }
function __clearOverrides() { _overrides = {}; }
let _own = {};
function isOwnMarketPrice(itemId, quality, city, side, price) {
  return _own[[itemId, quality, city, side, price].join("|")] === true;
}
function __setOwn(itemId, quality, city, side, price) {
  _own[[itemId, quality, city, side, price].join("|")] = true;
}
function __clearOwn() { _own = {}; }
`;

const mod = new Module("flip-quality-breakdown");
mod._compile(
  sandbox + J("price-freshness.js") + appSrc.slice(ageStart, ageEnd) + J("flip-quality-breakdown.js")
    + "\nmodule.exports = { flipQualityBreakdown, qbrkStatus, __setMarket, __setQuality, __setInstant, __setOverride, __clearOverrides, __setOwn, __clearOwn };",
  "flip-quality-breakdown.js",
);
const B = mod.exports;

const ID = "T8_2H_INFERNOSTAFF";
const CAE = "Caerleon";
const BM = "Black Market";
const MIN_5 = new Date(Date.now() - 5 * 60000).toISOString();
const HOURS_3 = new Date(Date.now() - 3 * 3600000).toISOString();
const DAYS_2 = new Date(Date.now() - 2 * 24 * 3600000).toISOString();

/** A row shaped exactly as buildFlipRowData builds one. */
function row(byQuality, opts = {}) {
  return {
    item: { id: ID, name: "Elder's Wild Staff" },
    quality: opts.quality === undefined ? 1 : opts.quality,
    noData: !!opts.noData,
    byQuality,
  };
}

/** A byQuality entry as findBestFlipPairAcrossQualities scores one. */
function pair(quality, buyPrice, sellPrice, opts = {}) {
  return {
    quality,
    viewId: quality === 1 ? ID : ID + "#Q" + quality,
    buyCity: opts.buyCity || CAE,
    buyPrice,
    sellCity: opts.sellCity || BM,
    sellPrice,
    travelCost: 0,
    liquid: true,
    profit: sellPrice - buyPrice,
    datable: opts.datable === undefined ? true : opts.datable,
  };
}

const qTokens = (html) => (html.match(/Q\d/g) || []);
const lineCount = (html) => (html.match(/class="qbrk-line/g) || []).length;

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    B.__setInstant(false);
    B.__setMarket(null);
    B.__setQuality(null);
    B.__clearOverrides();
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} - ${e.message}`);
    failed++;
  }
}

console.log("Flipping per-quality breakdown tests\n");

// ── nothing to compare ────────────────────────────────────────────────────
[
  ["a null row", null],
  ["a row with no byQuality", { item: { id: ID }, quality: 1 }],
  ["an empty byQuality", row([])],
  ["a single routable quality", row([pair(1, 100, 200)])],
].forEach(([name, r]) => {
  test(`${name} renders no ladder at all`, () => {
    assert.strictEqual(B.flipQualityBreakdown(r, "buy"), "");
    assert.strictEqual(B.flipQualityBreakdown(r, "sell"), "");
  });
});

// ── each side prints its OWN leg ──────────────────────────────────────────
test("the buy side names every routable quality with its buy price and buy city", () => {
  const html = B.flipQualityBreakdown(row([
    pair(1, 609999, 889328),
    pair(2, 620000, 900000, { buyCity: "Martlock" }),
    pair(4, 649999, 950000),
  ]), "buy");
  assert.strictEqual(lineCount(html), 3, html);
  assert.deepStrictEqual(qTokens(html), ["Q1", "Q2", "Q4"], html);
  assert.ok(html.includes("609,999") && html.includes("620,000") && html.includes("649,999"), html);
  assert.ok(html.includes("Martlock"), "each line names its own buy city");
});

test("the sell side names the same qualities with sell prices and sell cities", () => {
  const rows = [
    pair(1, 609999, 889328),
    pair(2, 620000, 900000, { sellCity: "Bridgewatch" }),
    pair(4, 649999, 950000),
  ];
  const html = B.flipQualityBreakdown(row(rows), "sell");
  assert.ok(html.includes("889,328") && html.includes("900,000") && html.includes("950,000"), html);
  assert.ok(html.includes("Bridgewatch"), html);
});

test("both cells list the same qualities in the same order - line N is one trade", () => {
  const rows = [pair(1, 1, 2), pair(3, 3, 4), pair(5, 5, 6)];
  const buy = B.flipQualityBreakdown(row(rows), "buy");
  const sell = B.flipQualityBreakdown(row(rows), "sell");
  assert.deepStrictEqual(qTokens(buy), qTokens(sell), "the ladders must stay in step");
  assert.strictEqual(lineCount(buy), lineCount(sell));
});

test("the ladder keeps byQuality's own order, never a price sort", () => {
  // A fatter quality further down must not climb to the top: that would move a
  // line on one side only and break the pairing with the other cell.
  const rows = [pair(1, 500, 600), pair(2, 100, 9000), pair(3, 400, 500)];
  assert.deepStrictEqual(qTokens(B.flipQualityBreakdown(row(rows), "buy")), ["Q1", "Q2", "Q3"]);
  assert.deepStrictEqual(qTokens(B.flipQualityBreakdown(row(rows), "sell")), ["Q1", "Q2", "Q3"]);
});

// ── the city label ───────────────────────────────────────────────────────
test("a long city is shortened on the line and spelled out in the hover text", () => {
  const html = B.flipQualityBreakdown(row([
    pair(1, 100, 200),
    pair(2, 300, 400, { buyCity: "Fort Sterling", sellCity: "Black Market" }),
  ]), "sell");
  assert.ok(html.includes("Black Mkt"), html);
  assert.ok(html.includes("title=\"") && html.includes("sell Black Market"), "the tooltip keeps the real name");
});

test("a city with no short form keeps its own name", () => {
  const html = B.flipQualityBreakdown(row([
    pair(1, 100, 200), pair(2, 300, 400, { buyCity: "Martlock" }),
  ]), "buy");
  assert.ok(html.includes("Martlock"), html);
});

// ── which line the row actually took ──────────────────────────────────────
test("the quality the row trades is marked, and only that one", () => {
  const rows = [pair(1, 1, 2), pair(2, 3, 4), pair(3, 5, 6)];
  const html = B.flipQualityBreakdown(row(rows, { quality: 2 }), "buy");
  assert.strictEqual((html.match(/qbrk-take/g) || []).length, 1, html);
  assert.ok(html.includes("▸Q2"), html);
  assert.ok(!html.includes("▸Q1") && !html.includes("▸Q3"), html);
});

test("a no-data row marks nothing - it took no quality", () => {
  const rows = [pair(1, 1, 2, { datable: false }), pair(2, 3, 4, { datable: false })];
  const html = B.flipQualityBreakdown(row(rows, { noData: true }), "buy");
  assert.strictEqual(lineCount(html), 2, "the priced qualities are still listed");
  assert.ok(!html.includes("qbrk-take"), html);
});

// ── an undated quality is shown, and shown to be unusable ─────────────────
test("an undated quality is listed and flagged", () => {
  const rows = [pair(1, 100, 200), pair(2, 300, 900, { datable: false })];
  const html = B.flipQualityBreakdown(row(rows), "buy");
  assert.strictEqual((html.match(/qbrk-undated/g) || []).length, 1, html);
  assert.ok(html.includes("cannot take the row"), html);
  assert.ok(html.includes("300"), "its price is still named");
});

// ── the age beside each line ──────────────────────────────────────────────
test("each line is dated from its OWN quality book", () => {
  B.__setInstant(true); // buy cell reads the ask, so sell_date
  B.__setMarket({ [ID]: { [CAE]: { sell_price: 609999, sell_date: DAYS_2 } } });
  B.__setQuality({ [ID]: {
    2: { [CAE]: { sell_price: 620000, sell_date: MIN_5 } },
    4: { [CAE]: { sell_price: 649999, sell_date: HOURS_3 } },
  } });
  const html = B.flipQualityBreakdown(row([pair(1, 609999, 1), pair(2, 620000, 1), pair(4, 649999, 1)]), "buy");
  assert.ok(html.includes(">2d<"), html);
  assert.ok(html.includes(">5m<"), html);
  assert.ok(html.includes(">3h<"), html);
  assert.ok(!html.includes(" ago"), "the ladder's ages are compact");
});

test("the age follows the order field the line printed", () => {
  // Market orders: a buy leg reads the BID and must be dated buy_date, even
  // when the ask beside it is two days older.
  B.__setInstant(false);
  B.__setQuality({ [ID]: { 2: { [CAE]: {
    buy_price: 500, buy_date: MIN_5, sell_price: 900, sell_date: DAYS_2,
  } } } });
  B.__setMarket({ [ID]: { [CAE]: { buy_price: 400, buy_date: MIN_5 } } });
  const html = B.flipQualityBreakdown(row([pair(1, 400, 1), pair(2, 500, 1)]), "buy");
  assert.ok(html.includes(">5m<"), html);
  assert.ok(!html.includes(">2d<"), "the ask's age must not stamp a bid");
});

test("a quality with no book carries no age, and still lists", () => {
  B.__setInstant(true);
  B.__setMarket({ [ID]: { [CAE]: { sell_price: 100, sell_date: MIN_5 } } });
  const html = B.flipQualityBreakdown(row([pair(1, 100, 1), pair(3, 300, 1)]), "buy");
  assert.strictEqual(lineCount(html), 2, html);
  assert.strictEqual((html.match(/>\d+[mhd]</g) || []).length, 1, html);
});

test("a pinned leg shows the pin instead of a market age", () => {
  B.__setInstant(true);
  B.__setQuality({ [ID]: { 2: { [CAE]: { sell_price: 620000, sell_date: DAYS_2 } } } });
  B.__setMarket({ [ID]: { [CAE]: { sell_price: 100, sell_date: MIN_5 } } });
  B.__setOverride(ID + "#Q2", CAE, "buy", 555000);
  const html = B.flipQualityBreakdown(row([pair(1, 100, 1), pair(2, 620000, 1)]), "buy");
  assert.ok(html.includes("⚡"), html);
  assert.ok(!html.includes(">2d<"), "a pinned number has no book age");
});

test("a pin on one side does not silence the other side's age", () => {
  B.__setInstant(true);
  B.__setQuality({ [ID]: { 2: {
    [CAE]: { sell_price: 620000, sell_date: DAYS_2 },
    [BM]: { buy_price: 900000, buy_date: MIN_5 },
  } } });
  B.__setMarket({ [ID]: { [CAE]: { sell_price: 100, sell_date: MIN_5 } } });
  B.__setOverride(ID + "#Q2", CAE, "buy", 555000);
  const sell = B.flipQualityBreakdown(row([pair(1, 100, 1), pair(2, 620000, 900000)]), "sell");
  assert.ok(sell.includes(">5m<"), sell);
  assert.ok(!sell.includes("⚡"), sell);
});

/** A byQuality entry for a book with a price on ONE side only. */
function oneSided(quality, side, city, price) {
  return {
    quality,
    viewId: quality === 1 ? ID : ID + "#Q" + quality,
    buyCity: side === "buy" ? city : null,
    buyPrice: side === "buy" ? price : 0,
    sellCity: side === "sell" ? city : null,
    sellPrice: side === "sell" ? price : 0,
    travelCost: 0,
    liquid: false,
    profit: null,
    routable: false,
    datable: false,
  };
}

// -- One-sided books --------------------------------------------------------
// The reported case: the Black Market bid 3,850,938 for an Outstanding pair of
// Elder's Hellion Shoes and nobody was asking, so the row had no route and the
// ladder was the only place that price could appear.
const HELLION_BID = 3850938;

test("a lone one-sided quote renders, unlike a lone routable one", () => {
  B.__setInstant(true);
  B.__setQuality({});
  B.__setMarket({});
  const r = row([oneSided(3, "sell", BM, HELLION_BID)], { noData: true });
  const sell = B.flipQualityBreakdown(r, "sell");
  assert.ok(sell.includes("3,850,938"), sell);
  assert.ok(sell.includes("Black Mkt"), sell);
  assert.ok(sell.includes("qbrk-unroutable"), sell);
});

test("a cell whose every line would be a dash renders nothing at all", () => {
  // A row priced only by bids: the Buy Cost ladder would be a column of em
  // dashes saying nothing, while the Sell Revenue one carries the whole list.
  B.__setInstant(true);
  B.__setQuality({});
  B.__setMarket({});
  const r = row([oneSided(1, "sell", BM, 13182057), oneSided(3, "sell", BM, HELLION_BID)],
    { noData: true });
  assert.strictEqual(B.flipQualityBreakdown(r, "buy"), "");
  assert.ok(B.flipQualityBreakdown(r, "sell").includes("3,850,938"));
});

test("a side with SOME orders dashes the qualities that have none, never zeroes", () => {
  B.__setInstant(true);
  B.__setQuality({});
  B.__setMarket({});
  const r = row([oneSided(3, "sell", BM, HELLION_BID), oneSided(4, "buy", CAE, 16999999)],
    { noData: true });
  const buy = B.flipQualityBreakdown(r, "buy");
  assert.ok(buy.includes("16,999,999"), buy);
  assert.ok(buy.includes("—"), "the bid-only quality has no ask to print");
  assert.ok(!buy.includes(">0<"), buy);
});

test("the hover text says why it is not a flip", () => {
  B.__setInstant(true);
  B.__setQuality({});
  B.__setMarket({});
  const sell = B.flipQualityBreakdown(row([oneSided(3, "sell", BM, HELLION_BID)], { noData: true }), "sell");
  assert.ok(sell.includes("nobody is asking at this quality"), sell);
  assert.ok(!sell.includes("profit"), "a quote has no profit to name");
});

test("a one-sided quote carries no age badge on the side it lacks", () => {
  B.__setInstant(true);
  B.__setQuality({ [ID]: { 3: { [BM]: { buy_price: HELLION_BID, buy_date: MIN_5 } } } });
  B.__setMarket({});
  const r = row([oneSided(3, "sell", BM, HELLION_BID)], { noData: true });
  assert.ok(B.flipQualityBreakdown(r, "sell").includes(">5m<"), "the side it has is dated");
  assert.ok(!B.flipQualityBreakdown(r, "buy").includes(">5m<"), "the side it lacks is not");
});

test("no quality takes the row, so no line wears the taken marker", () => {
  B.__setInstant(true);
  B.__setQuality({});
  B.__setMarket({});
  const r = row([oneSided(1, "sell", BM, 13182057), oneSided(3, "sell", BM, HELLION_BID)], { noData: true });
  const sell = B.flipQualityBreakdown(r, "sell");
  assert.ok(!sell.includes("▸"), sell);
  assert.ok(sell.includes("13,182,057") && sell.includes("3,850,938"), sell);
});


// ── a number no route may use ──────────────────────────────────────────────
// The ladder printed price, city and age and nothing else, so the two numbers a
// route is forbidden to use looked exactly like the ones it is allowed to. Both
// were reported from the live app on Black Market rows.

test("a price the book was read without is struck through and says so", () => {
  B.__clearOwn();
  B.__setMarket({ [ID]: { [BM]: { buy_price: 0, sell_price: 838798, sell_date: HOURS_3, sell_seen: MIN_5 } } });
  const html = B.flipQualityBreakdown(row([pair(1, 100, 838798), pair(2, 100, 200)]), "sell");
  assert.ok(html.includes("qbrk-gone"), "the line is marked gone");
  assert.ok(html.includes(">gone<"), "and says why");
});

test("your own standing order is named as yours, not aged", () => {
  B.__clearOwn();
  B.__setMarket({ [ID]: { [BM]: { buy_price: 0, sell_price: 373848, sell_date: MIN_5 } } });
  B.__setOwn(ID, 1, BM, "sell", 373848);
  const html = B.flipQualityBreakdown(row([pair(1, 100, 373848), pair(2, 100, 200)]), "sell");
  assert.ok(html.includes("qbrk-yours"));
  assert.ok(html.includes(">yours<"));
  assert.ok(!html.includes(">5m<"), "the age badge gives way to the reason");
});

test("a healthy line keeps its age badge", () => {
  B.__clearOwn();
  B.__setMarket({ [ID]: { [BM]: { buy_price: 0, sell_price: 548994, sell_date: MIN_5 } } });
  const html = B.flipQualityBreakdown(row([pair(1, 100, 548994), pair(2, 100, 200)]), "sell");
  assert.ok(!html.includes("qbrk-gone"));
  assert.ok(!html.includes("qbrk-yours"));
  assert.ok(html.includes("qbrk-age"));
});

test("a pinned price outranks both flags — a typed number is a decision", () => {
  B.__clearOwn();
  B.__clearOverrides();
  B.__setMarket({ [ID]: { [BM]: { buy_price: 0, sell_price: 373848, sell_date: HOURS_3, sell_seen: MIN_5 } } });
  B.__setOwn(ID, 1, BM, "sell", 373848);
  B.__setOverride(ID, BM, "sell", 373848);
  const html = B.flipQualityBreakdown(row([pair(1, 100, 373848), pair(2, 100, 200)]), "sell");
  assert.ok(!html.includes("qbrk-gone"));
  assert.ok(!html.includes("qbrk-yours"));
  assert.ok(html.includes("\u26a1"));
  B.__clearOverrides();
});

test("the flag follows the side the cell prints", () => {
  B.__clearOwn();
  // The buy cell reads the BID book under market orders (js/price-freshness.js),
  // so that is the side the fixture has to age.
  B.__setMarket({ [ID]: {
    [CAE]: { buy_price: 147996, buy_date: HOURS_3, buy_seen: MIN_5, sell_price: 0 },
    [BM]: { buy_price: 0, sell_price: 200, sell_date: MIN_5 },
  } });
  const r = row([pair(1, 147996, 200, { sellCity: BM }), pair(2, 100, 200)]);
  const sell = B.flipQualityBreakdown(r, "sell");
  const buy = B.flipQualityBreakdown(r, "buy");
  assert.ok(!sell.includes("qbrk-gone"), "the Black Market bid was not the one read empty");
  assert.ok(buy.includes("qbrk-gone"), "the Caerleon ask was");
});

test("a quality above Normal is read under its own book, not the flat one", () => {
  B.__clearOwn();
  B.__setMarket({ [ID]: { [BM]: { buy_price: 0, sell_price: 100, sell_date: MIN_5 } } });
  B.__setQuality({ [ID]: { 3: { [BM]: { buy_price: 0, sell_price: 500, sell_date: HOURS_3, sell_seen: MIN_5 } } } });
  const html = B.flipQualityBreakdown(row([pair(1, 100, 100), pair(3, 100, 500)]), "sell");
  const lines = html.split('class="qbrk-line');
  assert.ok(!lines[1].includes("qbrk-gone"), "Normal is fine");
  assert.ok(lines[2].includes("qbrk-gone"), "Outstanding is not");
  B.__setQuality(null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
