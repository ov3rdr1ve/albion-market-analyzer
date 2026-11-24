/**
 * Test: what a quality-priced Flipping row actually renders.
 *
 * Two things the reported bug needs the cells to say:
 *
 *   1. WHICH quality the row is a trade in. A flip is a matched pair, so the
 *      row buys and sells one specific quality; when the only live book is a
 *      Good one, "Q2" is the difference between a price the reader can act on
 *      and a price they will misread. And a quality cell must be DATED from
 *      the quality map it was priced from, not from the Normal book.
 *
 *   2. That the price shown is not in the book any more. The reported row
 *      advertised `549,999 - 2d ago` while the player stood in that market with
 *      the ask list open and nothing Normal in it. The number stays and stays
 *      clickable — a capture is evidence, not proof — but it says so.
 *
 * Black-box: the REAL priceTd sliced out of js/app.js over the real
 * js/price-freshness.js, and the REAL render-flipping cell helpers compiled
 * with stubs. No DOM, no live API.
 *
 * Run: node tests/flipping-quality-row.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

// ── priceTd, sliced out of app.js exactly as price-age-follows-order-field does
const appSrc = appSource();
const start = appSrc.indexOf("function formatPriceAge");
const end = appSrc.indexOf("function pureProfitTd");
assert.ok(start >= 0 && end > start, "could not locate the priceTd slice in app.js");

const cellSandbox = `
let lastMarketData = null;
let lastQualityMarketData = null;
let _instant = false;
let _override = null;
function tx(en) { return en; }
function getOrderType() { return _instant ? "instant" : "market"; }
function getOverridePrice() { return _override; }
function getOverrideField() { return _override; }
function qualityOverrideKey(id, q) { return id + "#Q" + q; }
function formatSilver(n) { return Math.round(n).toLocaleString(); }
function __setMarket(md) { lastMarketData = md; }
function __setQuality(qd) { lastQualityMarketData = qd; }
function __setInstant(on) { _instant = !!on; }
function __setOverride(v) { _override = v; }
`;

const cellMod = new Module("flipping-quality-cell");
cellMod._compile(
  cellSandbox + J("price-freshness.js") + appSrc.slice(start, end)
    + "\nmodule.exports = { priceTd, __setMarket, __setQuality, __setInstant, __setOverride };",
  "app.js",
);
const C = cellMod.exports;

// ── the row helpers, compiled from the real render-flipping.js
const renderStubs = `
let _instant2 = false;
let _bmr = true;
const _els = {
  "sort-instant": { get checked() { return _instant2; } },
  "include-caerleon": { get checked() { return _bmr; } },
};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const FOCUS_COSTS = {};
let recipeCache = {};
let lastMarketData = null;
let lastQualityMarketData = null;
function tx(en) { return en; }
function dispName(id, name) { return name || id; }
`;

const rowMod = new Module("flipping-quality-row");
rowMod._compile(
  renderStubs + J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + J("travel-cost.js")
    + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) + J("flip-route.js") + J("quality-flat-views.js")
    + J("flip-route-quality.js") + J("flip-quality-breakdown.js") + J("render-flipping.js")
    + "\nmodule.exports = { flipQualityChip, flipQualityNote, flipNameTd, buildFlipRoute,"
    + " buildFlipRowData, __setRowMarket: (m) => { lastMarketData = m; },"
    + " __setRowQuality: (q) => { lastQualityMarketData = q; },"
    + " __setRowInstant: (on) => { _instant2 = !!on; } };",
  "render-flipping.js",
);
const R = rowMod.exports;

const CAE = "Caerleon";
const ID = "T7_2H_SHAPESHIFTER_SET2";
const MINUTES_5 = new Date(Date.now() - 5 * 60000).toISOString();
const DAYS_2 = new Date(Date.now() - 2 * 24 * 3600000).toISOString();

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    C.__setInstant(false);
    C.__setOverride(null);
    C.__setMarket(null);
    C.__setQuality(null);
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} - ${e.message}`);
    failed++;
  }
}

console.log("Flipping quality row tests\n");

// ── the quality chip ──────────────────────────────────────────────────────
test("a Normal row carries no chip at all", () => {
  assert.strictEqual(R.flipQualityChip({ quality: 1 }), "");
  assert.strictEqual(R.flipQualityChip({}), "");
  assert.strictEqual(R.flipQualityChip(null), "");
});

[[2, "Good"], [3, "Outstanding"], [4, "Excellent"], [5, "Masterpiece"]].forEach(([q, name]) => {
  test(`a quality-${q} row is chipped Q${q} and named ${name}`, () => {
    const chip = R.flipQualityChip({ quality: q });
    assert.ok(chip.includes(`Q${q}`), chip);
    assert.ok(chip.includes(name), chip);
  });
});

test("the chip rides in the name cell", () => {
  const td = R.flipNameTd({ id: ID, name: "Grandmaster's Rootbound Staff [T7]" }, { quality: 2 });
  assert.ok(td.startsWith("<td"), td);
  assert.ok(td.includes("Rootbound"), td);
  assert.ok(td.includes("Q2"), td);
});

// The same chip rides on the Black Market board, whose rows carry the priced
// quality as sellQuality — the feeder normalized it off `quality`, so the chip
// reads one field further down the pipe.
test("a board row's sellQuality chips the same way", () => {
  assert.ok(R.flipQualityChip({ sellQuality: 2 }).includes("Q2"));
  assert.ok(R.flipQualityChip({ sellQuality: 5 }).includes("Masterpiece"));
});

test("a board row at Normal or without a quality carries no chip", () => {
  assert.strictEqual(R.flipQualityChip({ sellQuality: 1 }), "");
  assert.strictEqual(R.flipQualityChip({ sellQuality: null }), "");
  assert.strictEqual(R.flipQualityChip({}), "");
});

// ── the per-quality ladder under each cell ───────────────────────────────
// The list itself is js/flip-quality-breakdown.js and is covered end-to-end by
// tests/flip-quality-breakdown.test.cjs. What the ROW owes it is the wiring:
// the module is optional, so a harness (or a load order) without it must render
// the cells exactly as they were before the ladder existed.
test("a row with nothing to compare asks for no note", () => {
  assert.strictEqual(R.flipQualityNote({ quality: 1, byQuality: [] }, "buy"), "");
  assert.strictEqual(
    R.flipQualityNote({ quality: 1, byQuality: [{ quality: 1, routable: true }] }, "sell"), "",
    "a single routable quality is what the price cell already prints",
  );
});

// ── the cell: dating a quality price ──────────────────────────────────────
test("a quality cell is dated from the quality map, not the Normal book", () => {
  C.__setInstant(true);
  C.__setMarket({ [ID]: { [CAE]: { sell_price: 549999, sell_date: DAYS_2 } } });
  C.__setQuality({ [ID]: { 2: { [CAE]: { sell_price: 698874, sell_date: MINUTES_5 } } } });
  const td = C.priceTd(698874, ID, CAE, "buy", "silver-val", false, 2, true);
  assert.ok(td.includes("5m ago"), td);
  assert.ok(!td.includes("2d ago"), "the Normal book's age must not leak in");
  assert.ok(td.includes('data-quality="2"'), td);
});

test("a Normal cell is unchanged by any of this", () => {
  C.__setInstant(true);
  C.__setMarket({ [ID]: { [CAE]: { sell_price: 549999, sell_date: DAYS_2 } } });
  const td = C.priceTd(549999, ID, CAE, "buy", "silver-val", false, null, true);
  assert.ok(td.includes("2d ago"), td);
  assert.ok(!td.includes("data-quality"), td);
});

// ── the cell: a price the book no longer holds ────────────────────────────
test("a price the book was opened without carries a 'not listed' badge", () => {
  C.__setInstant(true);
  C.__setMarket({
    [ID]: { [CAE]: { sell_price: 549999, sell_date: DAYS_2, sell_seen: MINUTES_5 } },
  });
  const td = C.priceTd(549999, ID, CAE, "buy", "silver-val", false, null, true);
  assert.ok(td.includes("not listed"), td);
  assert.ok(td.includes("looked"), td);
  assert.ok(td.includes("549,999"), "the number stays");
  assert.ok(td.includes("price-editable"), "and stays clickable");
});

test("the badge follows the side the cell printed", () => {
  // Only the ASK list was read. A cell printing the BID has learned nothing.
  const entry = { sell_price: 549999, sell_date: DAYS_2, buy_price: 3, buy_date: DAYS_2, sell_seen: MINUTES_5 };
  C.__setMarket({ [ID]: { [CAE]: entry } });
  C.__setInstant(true);
  assert.ok(C.priceTd(549999, ID, CAE, "buy", "silver-val", false, null, true).includes("not listed"));
  C.__setInstant(false);
  assert.ok(!C.priceTd(3, ID, CAE, "buy", "silver-val", false, null, true).includes("not listed"));
});

test("a price newer than the stamp is not badged", () => {
  C.__setInstant(true);
  C.__setMarket({
    [ID]: { [CAE]: { sell_price: 698874, sell_date: MINUTES_5, sell_seen: MINUTES_5 } },
  });
  assert.ok(!C.priceTd(698874, ID, CAE, "buy", "silver-val", false, null, true).includes("not listed"));
});

test("an overridden cell is never badged - the number is the user's", () => {
  C.__setInstant(true);
  C.__setOverride(400000);
  C.__setMarket({
    [ID]: { [CAE]: { sell_price: 549999, sell_date: DAYS_2, sell_seen: MINUTES_5 } },
  });
  assert.ok(!C.priceTd(400000, ID, CAE, "buy", "silver-val", false, null, true).includes("not listed"));
});

test("a cell with no stamp renders exactly as it always did", () => {
  C.__setInstant(true);
  C.__setMarket({ [ID]: { [CAE]: { sell_price: 549999, sell_date: DAYS_2 } } });
  assert.ok(!C.priceTd(549999, ID, CAE, "buy", "silver-val", false, null, true).includes("not listed"));
});

// ── the reported row, end to end ──────────────────────────────────────────
// "Elder's Hellion Shoes [T8.4] Black Market price not detected by the
// sniffer." It WAS captured — T8_SHOES_LEATHER_HELL@4 held a Black Market bid
// at qualities 1-3 and a Caerleon ask at quality 4 — but no single quality was
// a matched pair, so the router discarded all four and the row rendered as a
// bare "no data" with every captured number gone.
const HELLION = "T8_SHOES_LEATHER_HELL@4";
const BLACK_MARKET = "Black Market";

function hellionRow() {
  R.__setRowInstant(true);
  const quality = { [HELLION]: {
    2: { [BLACK_MARKET]: { buy_price: 3977892, buy_date: MINUTES_5 } },
    3: { [BLACK_MARKET]: { buy_price: 3850938, buy_date: MINUTES_5 } },
    4: { [CAE]: { sell_price: 16999999, sell_date: MINUTES_5 } },
  } };
  // Quality 1 lives in the FLAT map — that is what flattenCaptured(captured, 1)
  // folds into lastMarketData at boot — and every quality above it in the
  // quality map. The fixture mirrors that split exactly.
  const flat = { [HELLION]: { [BLACK_MARKET]: { buy_price: 13182057, buy_date: MINUTES_5 } } };
  R.__setRowMarket(flat);
  R.__setRowQuality(quality);
  const item = { id: HELLION, name: "Elder's Hellion Shoes [T8.4]", tier: 8, enchantVariant: 4,
    baseId: "T8_SHOES_LEATHER_HELL" };
  const route = R.buildFlipRoute(flat, HELLION, CITIES_ALL, SELL_ALL);
  return { row: R.buildFlipRowData(item, route, flat, undefined), route };
}
const CITIES_ALL = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock",
  "Bridgewatch", "Brecilien"];
const SELL_ALL = [...CITIES_ALL, BLACK_MARKET];

test("the reported row still says it cannot be flipped", () => {
  const { row } = hellionRow();
  assert.strictEqual(row.noData, true, "no quality is a matched pair");
  assert.strictEqual(row.buy.price, 0);
  assert.strictEqual(row.sell.price, 0);
});

test("but every captured Black Market bid is on the row", () => {
  const { row } = hellionRow();
  const sell = R.flipQualityNote(row, "sell");
  assert.ok(sell.includes("3,850,938"), sell);
  assert.ok(sell.includes("3,977,892"), sell);
  assert.ok(sell.includes("13,182,057"), sell);
  assert.ok(sell.includes("Black Mkt"), sell);
});

test("the quality that only has an ask shows its ask, on the buy side", () => {
  const { row } = hellionRow();
  const buy = R.flipQualityNote(row, "buy");
  assert.ok(buy.includes("16,999,999"), buy);
  assert.ok(buy.includes("Caerleon"), buy);
});

test("the bid-only qualities print an em dash on the buy side, never a zero", () => {
  const { row } = hellionRow();
  const buy = R.flipQualityNote(row, "buy");
  assert.ok(buy.includes("—"), buy);
  assert.ok(!buy.includes(">0<"), buy);
});

test("not one of them is allowed to look like a route", () => {
  const { row } = hellionRow();
  assert.ok(row.byQuality.every((e) => e.routable === false), JSON.stringify(row.byQuality));
  assert.ok(!R.flipQualityNote(row, "sell").includes("▸"), "nothing took the row");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
