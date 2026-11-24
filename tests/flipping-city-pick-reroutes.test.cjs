/**
 * Test: the Flipping table's Buy City / Sell City pickers RE-ROUTE the flip,
 * they do not filter rendered rows.
 *
 * Bug (reported): "T5, T7 bags and other items missing in the flipping table" —
 * with Show All on and Black/Red Zone Routes on, so neither the profit gate nor
 * the zone rules were hiding them.
 *
 * Root cause: the Sell City picker was set to Black Market, and on Flipping that
 * picker only hid rendered rows. A row keeps exactly ONE route — the best-margin
 * pair — so an item whose best pair happened to sell in Caerleon failed the
 * rendered-row filter and left the board entirely, however good the Black
 * Market's bid for it was. Which items vanished changed with every scan, which
 * is why it read as "items randomly missing".
 *
 * Fix: js/table-sell-city.js registers flipping-table for BOTH legs (it is the
 * one table with two pickers, so each pick names its leg unambiguously) and
 * js/render-flipping.js narrows the city lists it hands findBestFlipPair. An
 * item the picked city has no book for becomes an honest `noData` row instead of
 * disappearing.
 *
 * Also covered: an over-MAX_MARGIN_PERCENT route is MARKED (⚠) and kept, never
 * dropped — hiding it left nothing to click to correct the stale price behind it.
 *
 * Black-box: real js/calculations.js + js/travel-cost.js + js/utils.js +
 * js/flip-route.js + js/table-sell-city.js + js/render-flipping.js compiled with
 * stubs, fed synthetic market data. No DOM, no live API.
 *
 * Run: node tests/flipping-city-pick-reroutes.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
let _instant = false;
let _bmr = true;
const _els = {
  "sort-instant": { get checked() { return _instant; } },
  "include-caerleon": { get checked() { return _bmr; } },
};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CITIES = [...CRAFT_CITIES, ...BLACK_ZONE_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const FOCUS_COSTS = {};
let recipeCache = {};
let lastMarketData = null;
// Luxury catalog, injected per test (see setLuxury).
let _luxury = {};
function setLuxury(map) { _luxury = map || {}; }
function getLuxuryFlipInfo(id) { return _luxury[id] || null; }
function setInstant(on) { _instant = !!on; }
function setRoutes(on) { _bmr = !!on; }
// i18n is a no-op in Node; the renderer only needs the English text back.
function tx(en) { return en; }
`;

const sources =
  J("data-city-bonuses.js") +
  (J("calculations.js") + J("calculations-margins.js")) + J("travel-cost.js") + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  J("flip-route.js") + J("table-sell-city.js") + J("render-flipping.js");

const mod = new Module("flipping-city-pick-reroutes");
mod._compile(
  stubs + sources +
    "\nmodule.exports = { buildFlipRowsForItem, buildFlipRowData, flipProfitTd, flipCityList," +
    " effectiveFlipCities, setTableBuyCity, setTableSellCity, clearTableSellCities," +
    " isSuspectMargin, setInstant, setRoutes, setLuxury };",
  "flipping-city-pick-reroutes.js",
);
const X = mod.exports;

const TABLE = "flipping-table";
const CAE = "Caerleon";
const LYM = "Lymhurst";
const MAR = "Martlock";
const THE = "Thetford";
const BM = "Black Market";

const V_HI = 100;
const ITEM = { id: "T5_BAG", name: "Expert's Bag [T5]" };

/** Synthetic order book: city -> [buy_price, sell_price, volume_24h]. */
function md(entries) {
  const out = { [ITEM.id]: {} };
  Object.entries(entries).forEach(([city, [buy, sell, vol]]) => {
    out[ITEM.id][city] = { buy_price: buy, sell_price: sell, volume_24h: vol === undefined ? V_HI : vol };
  });
  return out;
}

/**
 * The book behind the report. Instant order type, matching the screenshot: a
 * buy is quoted at the city's ask, and a SALE — at a city or at the Black
 * Market alike — is quoted at the bid you can clear into.
 *
 * Caerleon's bid is the fattest sale, so the unconstrained best pair sells
 * there. The Black Market's bid is a perfectly good sale that simply loses that
 * head-to-head — and losing it is exactly what used to remove the whole item
 * from the board under a Black Market pick.
 */
const BAG_BOOK = md({
  [LYM]: [9000, 13000],    // cheapest ask — the natural buy leg
  [MAR]: [9500, 14000],
  [CAE]: [22000, 24000],   // best sale: 22,000 bid
  [THE]: [10000, 15000],
  [BM]:  [19000, 0],       // the Black Market pays its BID, and only that
});

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    X.clearTableSellCities();
    X.setInstant(true);   // the reported view; a city buy is quoted at the ask
    X.setRoutes(true);
    X.setLuxury({});
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

const rowsFor = (book) => X.buildFlipRowsForItem(ITEM, book);
const onlyRow = (book) => {
  const rows = rowsFor(book);
  assert.strictEqual(rows.length, 1, `expected exactly one row, got ${rows.length}`);
  return rows[0];
};

console.log("Flipping City pick re-routes the flip\n");

// ── effectiveFlipCities: the rule on its own ───────────────────────────────
[
  ["no pick returns the caller's list untouched", null, null, "sell", ["A", "B"], ["A", "B"]],
  ["a sell pick inside the list collapses to it", null, "B", "sell", ["A", "B"], ["B"]],
  ["a sell pick outside the list yields nothing", null, "Z", "sell", ["A", "B"], []],
  ["a buy pick reads the buy side, not the sell one", "A", "B", "buy", ["A", "B"], ["A"]],
  ["a sell pick reads the sell side, not the buy one", "A", "B", "sell", ["A", "B"], ["B"]],
  ["a buy pick leaves the sell leg alone", "A", null, "sell", ["A", "B"], ["A", "B"]],
].forEach(([name, buyPick, sellPick, side, list, want]) => {
  test(name, () => {
    if (buyPick) X.setTableBuyCity(TABLE, buyPick);
    if (sellPick) X.setTableSellCity(TABLE, sellPick);
    assert.deepStrictEqual(X.effectiveFlipCities(TABLE, side, list), want);
  });
});

// ── The reported regression ────────────────────────────────────────────────
test("no pick: the row takes the best pair, which sells in Caerleon", () => {
  const row = onlyRow(BAG_BOOK);
  assert.strictEqual(row.sell.city, CAE, "Caerleon's 22,000 ask beats the BM bid");
  assert.strictEqual(row.buy.city, LYM);
  assert.ok(!row.noData);
});

test("Sell City = Black Market: the row stays and sells THERE (the reported bug)", () => {
  X.setTableSellCity(TABLE, BM);
  const row = onlyRow(BAG_BOOK);
  assert.strictEqual(row.sell.city, BM, "the pick must re-route, not hide the item");
  assert.strictEqual(row.sell.price, 19000, "the Black Market pays its bid");
  assert.strictEqual(row.buy.city, LYM, "the buy leg is still free to be cheapest");
  assert.ok(row.marginInfo.margin > 0, "and it is still a profitable flip");
});

test("Buy City = Martlock: the row buys there even though Lymhurst is cheaper", () => {
  X.setTableBuyCity(TABLE, MAR);
  const row = onlyRow(BAG_BOOK);
  assert.strictEqual(row.buy.city, MAR);
  assert.strictEqual(row.buy.price, 14000, "instant buy pays Martlock's ask");
  assert.strictEqual(row.sell.city, CAE, "the sell leg is untouched by a buy pick");
});

test("both picks: exactly that pair, even when it is not the best-margin one", () => {
  X.setTableBuyCity(TABLE, THE);
  X.setTableSellCity(TABLE, BM);
  const row = onlyRow(BAG_BOOK);
  assert.strictEqual(row.buy.city, THE);
  assert.strictEqual(row.sell.city, BM);
  assert.strictEqual(row.buy.price, 15000);
  assert.strictEqual(row.sell.price, 19000);
});

// ── A pick the item has no book for ────────────────────────────────────────
test("a picked city with no book is a no-data row, not a missing item", () => {
  X.setTableSellCity(TABLE, THE);
  const row = onlyRow(md({ [LYM]: [9000, 13000], [CAE]: [11000, 22000] }));
  assert.ok(row.noData, "the row must survive as no-data");
  assert.strictEqual(row.sell.price, 0);
  assert.strictEqual(row.buy.price, 0);
  assert.strictEqual(row.item.id, ITEM.id, "and still name the item");
});

test("a no-data row's margin cell reads as an em dash, not -1.00%", () => {
  X.setTableSellCity(TABLE, THE);
  const html = X.flipProfitTd(onlyRow(md({ [LYM]: [9000, 13000] })), 0);
  assert.ok(html.includes("—"), "expected an em dash");
  assert.ok(!html.includes("-1.00%"), "the -1 sentinel must never reach the cell");
  assert.ok(html.includes('data-profit-cell="1"'), "still a click-to-change-sell-city cell");
});

// ── Zone rules are untouched ───────────────────────────────────────────────
test("routes OFF: a Black Market pick leaves only the Caerleon section", () => {
  X.setRoutes(false);
  X.setTableSellCity(TABLE, BM);
  const rows = rowsFor(BAG_BOOK);
  assert.strictEqual(rows.length, 1, "the royal section cannot honour a BM pick");
  assert.strictEqual(rows[0].section, "caerleon");
  assert.strictEqual(rows[0].sell.city, BM);
  assert.strictEqual(rows[0].buy.city, CAE);
});

test("routes OFF, no pick: both sections are still built", () => {
  X.setRoutes(false);
  const rows = rowsFor(BAG_BOOK);
  assert.deepStrictEqual(rows.map((r) => r.section), ["royal", "caerleon"]);
});

test("routes OFF: a royal buy pick leaves only the royal section", () => {
  X.setRoutes(false);
  X.setTableBuyCity(TABLE, LYM);
  const rows = rowsFor(BAG_BOOK);
  assert.strictEqual(rows.length, 1, "the Caerleon section buys in Caerleon only");
  assert.strictEqual(rows[0].section, "royal");
  assert.strictEqual(rows[0].buy.city, LYM);
});

// ── Luxury goods: a fixed trader, not a market ─────────────────────────────
const LUX = {
  id: "TREASURE_KNOWLEDGE_RARITY3",
  name: "Ancient Tome",
  sellCity: MAR,
  npcPrice: 25000,
  tier: 6,
  weight: 6.25,
};
const LUX_ANY = { ...LUX, id: "TREASURE_AVALON_RARITY3", name: "Golden Sextant", sellCity: "any" };

function luxBook(id, entries) {
  const out = { [id]: {} };
  Object.entries(entries).forEach(([city, [buy, sell]]) => {
    out[id][city] = { buy_price: buy, sell_price: sell, volume_24h: V_HI };
  });
  return out;
}

test("a luxury good whose trader city is not the sell pick is dropped", () => {
  X.setLuxury({ [LUX.id]: LUX });
  X.setTableSellCity(TABLE, BM);
  assert.deepStrictEqual(
    X.buildFlipRowsForItem({ id: LUX.id }, luxBook(LUX.id, { [LYM]: [1000, 1200] })),
    [],
    "the trader NPC sells in Martlock and nowhere else",
  );
});

test("a luxury good IS kept when the sell pick names its trader city", () => {
  X.setLuxury({ [LUX.id]: LUX });
  X.setTableSellCity(TABLE, MAR);
  const rows = X.buildFlipRowsForItem({ id: LUX.id }, luxBook(LUX.id, { [LYM]: [1000, 1200] }));
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].sell.price, LUX.npcPrice);
});

test("a buy pick narrows a luxury good's buy leg", () => {
  X.setLuxury({ [LUX.id]: LUX });
  X.setTableBuyCity(TABLE, THE);
  const rows = X.buildFlipRowsForItem(
    { id: LUX.id },
    luxBook(LUX.id, { [LYM]: [1000, 1200], [THE]: [1800, 2000] }),
  );
  assert.strictEqual(rows[0].buy.city, THE, "Lymhurst is cheaper but not picked");
  assert.strictEqual(rows[0].buy.price, 2000);
});

test("an 'any' luxury good follows the sell pick through its buy leg", () => {
  // It is sold in the city it was bought in, so the two legs are one city.
  X.setLuxury({ [LUX_ANY.id]: LUX_ANY });
  X.setTableSellCity(TABLE, THE);
  const rows = X.buildFlipRowsForItem(
    { id: LUX_ANY.id },
    luxBook(LUX_ANY.id, { [LYM]: [1000, 1200], [THE]: [1800, 2000] }),
  );
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].buy.city, THE);
  assert.strictEqual(rows[0].sell.city, THE);
});

// ── Suspect margins are marked, never dropped ──────────────────────────────
test("an over-cap margin is flagged on the row, and the row still exists", () => {
  // 600 buy -> 19,000 BM bid is far past MAX_MARGIN_PERCENT (500%).
  const row = onlyRow(md({ [LYM]: [400, 600], [BM]: [19000, 0] }));
  assert.ok(X.isSuspectMargin(row.marginInfo.margin), "the fixture must exceed the cap");
  assert.strictEqual(row.suspectMargin, true, "the row carries the flag the badge reads");
});

test("a flagged row's margin cell wears the warning and keeps its number", () => {
  const html = X.flipProfitTd(onlyRow(md({ [LYM]: [400, 600], [BM]: [19000, 0] })), 0);
  assert.ok(html.includes("⚠"), "expected the warning badge");
  assert.ok(/\d+\.\d\d%/.test(html), "expected the margin to still be printed");
});

test("a normal margin gets no badge", () => {
  const html = X.flipProfitTd(onlyRow(BAG_BOOK), 0);
  assert.ok(!html.includes("⚠"));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
