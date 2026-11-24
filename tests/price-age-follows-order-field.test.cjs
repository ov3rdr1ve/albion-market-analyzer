/**
 * Test: the price cell's age badge dates the field it actually printed.
 *
 * Reported bug: a Black Market book captured minutes earlier still read
 * "4d ago". A market entry carries two independently-aged order books, and
 * priceTd dated every cell with `sell_date` regardless of side or pricing
 * mode. Under Instant the sell cell prints `buy_price`, so a fresh Black
 * Market bid wore the four-day-old ask's timestamp.
 *
 *   cell            reads                 date
 *   buy  / instant  sell_price (ask)      sell_date
 *   buy  / market   buy_price  (bid)      buy_date
 *   sell / instant  buy_price  (bid)      buy_date   <- the reported cell
 *   sell / market   sell_price (ask)      sell_date
 *
 * The Buy and Sell Pricing Model radios are independent, so each cell asks its
 * OWN side's toggle — the mixed-mode block at the end covers that.
 *
 * Black-box: the REAL priceDateField/priceDateFor (js/price-freshness.js) and
 * the REAL formatPriceAge + priceTd sliced out of js/app.js, driven with a
 * stubbed lastMarketData. No DOM, no live data.
 *
 * Run: node tests/price-age-follows-order-field.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");
const Module = require("module");
globalThis.tx = globalThis.tx || ((en) => en);

const src = appSource();
const start = src.indexOf("function formatPriceAge");
const end = src.indexOf("function pureProfitTd");
assert.ok(start >= 0 && end > start, "could not locate priceTd slice in app.js");
const slice = src.slice(start, end);
const freshness = fs.readFileSync(path.join(__dirname, "..", "js/price-freshness.js"), "utf8");

const sandbox = `
let lastMarketData = null;
let _buyInstant = false;
let _sellInstant = false;
let _override = null;
function getOrderType(side) {
  return (side === "sell" ? _sellInstant : _buyInstant) ? "instant" : "market";
}
function getOverridePrice() { return _override; }
function getOverrideField() { return _override; }
function qualityOverrideKey(id, q) { return id + "|q" + q; }
function formatSilver(n) { return Math.round(n).toLocaleString(); }
function __setMarket(md) { lastMarketData = md; }
function __setInstant(on) { _buyInstant = !!on; _sellInstant = !!on; }
function __setModes(buy, sell) { _buyInstant = !!buy; _sellInstant = !!sell; }
function __setOverride(v) { _override = v; }
`;

const mod = new Module("price-age-test");
mod._compile(
  sandbox + freshness + slice +
    "\nmodule.exports = { priceTd, formatPriceAge, priceDateField, priceDateFor," +
    " __setMarket, __setInstant, __setModes, __setOverride };",
  "app.js",
);
const X = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const HOURS_2 = new Date(Date.now() - 2 * 3600000).toISOString();
const DAYS_4 = new Date(Date.now() - 4 * 24 * 3600000).toISOString();

// ── the field matrix ───────────────────────────────────────────────────────
console.log("priceDateField: the cell's side × the pricing model\n");
const MATRIX = [
  ["buy", "instant", "sell_date"],
  ["buy", "market", "buy_date"],
  ["sell", "instant", "buy_date"],
  ["sell", "market", "sell_date"],
];
MATRIX.forEach(([side, mode, field]) => {
  test(`${side} cell / ${mode} → ${field}`, () => {
    assert.strictEqual(X.priceDateField(side, mode), field);
  });
  test(`${side} cell / ${mode} → ${field} (mode read from getOrderType)`, () => {
    X.__setInstant(mode === "instant");
    assert.strictEqual(X.priceDateField(side), field);
  });
});
test("no getOrderType in scope → market orders (Node default)", () => {
  const bare = require("../js/price-freshness.js");
  assert.strictEqual(bare.priceDateField("sell"), "sell_date");
  assert.strictEqual(bare.priceDateField("buy"), "buy_date");
});
test("priceDateFor tolerates a missing entry and a missing date", () => {
  assert.strictEqual(X.priceDateFor(null, "sell", "instant"), null);
  assert.strictEqual(X.priceDateFor({ buy_date: null }, "sell", "instant"), null);
});

// ── the reported row ───────────────────────────────────────────────────────
// T6_CAPEITEM_AVALON at the Black Market: the bid was captured 2h ago, the ask
// is a 4-day-old scan the capture never touched.
console.log("\nreported row: Black Market bid fresh, ask four days old\n");
const BM = () => ({
  T6_CAPEITEM_AVALON: {
    "Black Market": {
      buy_price: 271375, buy_date: HOURS_2,
      sell_price: 295274, sell_date: DAYS_4,
      volume_24h: 19498,
    },
  },
});
const cell = (side) => X.priceTd(271375, "T6_CAPEITEM_AVALON", "Black Market", side);

test("instant sell cell dates the BID it printed, not the stale ask", () => {
  X.__setMarket(BM()); X.__setInstant(true);
  const html = cell("sell");
  assert.ok(html.includes("2h ago"), `expected '2h ago', got: ${html}`);
  assert.ok(!html.includes("4d ago"), `must not show the ask's age: ${html}`);
});
test("market-orders sell cell still dates the ask", () => {
  X.__setMarket(BM()); X.__setInstant(false);
  const html = cell("sell");
  assert.ok(html.includes("4d ago"), `expected '4d ago', got: ${html}`);
});
test("buy cell mirrors it: instant dates the ask, market dates the bid", () => {
  X.__setMarket(BM());
  X.__setInstant(true);
  assert.ok(cell("buy").includes("4d ago"), "instant buy reads the ask");
  X.__setInstant(false);
  assert.ok(cell("buy").includes("2h ago"), "market buy reads the bid");
});
test("the fresh badge is coloured fresh, the stale one stale", () => {
  X.__setMarket(BM());
  X.__setInstant(true);
  assert.ok(cell("sell").includes("#5e9e78"), "2h old is the fresh colour");
  X.__setInstant(false);
  assert.ok(cell("sell").includes("#9e5858"), "4d old is the stale colour");
});
test("the hover title names both order dates", () => {
  X.__setMarket(BM()); X.__setInstant(true);
  const html = cell("sell");
  assert.ok(html.includes(HOURS_2), `expected the buy date in the title: ${html}`);
  assert.ok(html.includes(DAYS_4), `expected the sell date in the title too: ${html}`);
});

// ── one-sided books (the Black Market's normal shape) ─────────────────────
console.log("\none-sided books\n");
test("a bid-only entry shows no age under market orders, keeps the volume", () => {
  X.__setMarket({
    T5_CAPEITEM_AVALON: {
      "Black Market": { buy_price: 146940, buy_date: HOURS_2, sell_price: 0, sell_date: null, volume_24h: 88 },
    },
  });
  X.__setInstant(false);
  const html = X.priceTd(146940, "T5_CAPEITEM_AVALON", "Black Market", "sell");
  assert.ok(!html.includes("ago"), `no ask date to show: ${html}`);
  assert.ok(html.includes("88 vol"), `volume must still render: ${html}`);
});
test("the same entry under instant does show the bid's age", () => {
  X.__setInstant(true);
  const html = X.priceTd(146940, "T5_CAPEITEM_AVALON", "Black Market", "sell");
  assert.ok(html.includes("2h ago"), `expected the bid age: ${html}`);
});

// ── a pinned price has no market age ─────────────────────────────────────
console.log("\nmanual overrides\n");
test("an overridden cell drops the age but keeps the volume", () => {
  X.__setMarket(BM()); X.__setInstant(true); X.__setOverride(300000);
  const html = cell("sell");
  assert.ok(html.includes("⚡"), "override marker expected");
  assert.ok(!html.includes("ago"), `a pinned price has no market age: ${html}`);
  assert.ok(html.includes("19,498 vol"), `volume must still render: ${html}`);
  X.__setOverride(null);
});

// ── mixed modes: each cell asks its own leg ───────────────────────────────
console.log("");
console.log("mixed Pricing Model: the two cells age apart");
console.log("");
test("buy market / sell instant: both cells date the bid", () => {
  X.__setMarket(BM());
  X.__setModes(false, true);
  assert.strictEqual(X.priceDateField("buy"), "buy_date");
  assert.strictEqual(X.priceDateField("sell"), "buy_date");
  assert.ok(cell("buy").includes("2h ago"));
  assert.ok(cell("sell").includes("2h ago"));
});
test("buy instant / sell market: both cells date the ask", () => {
  X.__setMarket(BM());
  X.__setModes(true, false);
  assert.strictEqual(X.priceDateField("buy"), "sell_date");
  assert.strictEqual(X.priceDateField("sell"), "sell_date");
  assert.ok(cell("buy").includes("4d ago"));
  assert.ok(cell("sell").includes("4d ago"));
});
test("moving the buy leg does not move the sell cell's field", () => {
  X.__setModes(true, true);
  assert.strictEqual(X.priceDateField("sell"), "buy_date");
  X.__setModes(false, true);
  assert.strictEqual(X.priceDateField("sell"), "buy_date", "sell leg untouched");
  assert.strictEqual(X.priceDateField("buy"), "buy_date", "buy leg switched");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
