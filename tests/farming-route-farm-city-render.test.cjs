/**
 * Test: the Farming Route cell names all three cities.
 *
 * A row is "buy the seed where it is cheapest, farm where the +10% bonus is,
 * sell where the crop pays most" (js/farming-row-econ.js). The middle city is
 * printed only when it differs from the seed source, so a same-city row keeps
 * reading "Buy: X → Sell: Y" and the column does not widen.
 *
 * Black-box: drive the real renderFarmingTable over a synthetic market and read
 * the HTML. No live API, no database.
 *
 * Run: node tests/farming-route-farm-city-render.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const _els = {
  "include-caerleon": { checked: true },
  "sort-instant": { checked: true },
  "use-focus": { checked: true },
  "premium-account": { checked: true },
};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const tableState = { "farming-table": { data: [], html: [] } };
function renderTableData(id, rows, fmt) {
  tableState[id].data = rows;
  tableState[id].html = rows.map((r, i) => { try { return fmt(r, i); } catch (e) { return "ERR:" + e.message; } });
}
function priceTd(price, itemId, city, side) {
  return '<td data-item-id="' + itemId + '" data-city="' + city + '">' + (price > 0 ? String(price) : "-") + '</td>';
}
function profitTd() { return "<td></td>"; }
function volTd() { return "<td></td>"; }
function getProfitClass() { return ""; }
function addTdForKey() { return "<td></td>"; }
function getRowKey(row) { return ((row.item && row.item.id) || "?") + "|" + (row.section || ""); }
function dispName(id, name) { return name || id; }
function tx(en) { return en; }
function focusPlayCell() { return "<td></td>"; }
function formatSilver(n) { return String(Math.round(Number(n) || 0)); }
function formatFocusCost(n) { return String(Math.round(Number(n) || 0)); }
const ITEM_NAMES_MAP = {};
let lastMarketData = null;
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
`;

const sources =
  J("data-city-bonuses.js") +
  (J("calculations.js") + J("calculations-margins.js")) +
  J("travel-cost.js") +
  J("mp-bonus.js") +
  (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  J("focus-play.js") +
  J("focus-costs.js") +
  J("data-farming.js") +
  J("farming-row-econ.js") +
  J("render-farming.js");

const mod = new Module("farming-route-farm-city");
mod._compile(
  stubs + sources + "\nmodule.exports = { tableState, renderFarmingTable };",
  "farming-route-farm-city.js",
);
const X = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

// Martlock carries the +10% crop spec for T6_POTATO (js/data-city-bonuses.js).
const SEED = "T6_FARM_POTATO_SEED";
const CROP = "T6_POTATO";

// "instant" order type is stubbed on, so getBuyPrice reads sell_price and
// getSellPrice reads buy_price. Both fields are filled so either model works.
function market(seedPrices, cropPrices) {
  const md = {};
  const put = (id, city, price) => {
    (md[id] = md[id] || {})[city] = { buy_price: price, sell_price: price, volume_24h: 500 };
  };
  Object.entries(seedPrices).forEach(([c, p]) => put(SEED, c, p));
  Object.entries(cropPrices).forEach(([c, p]) => put(CROP, c, p));
  return md;
}

// The potato row of the royal/all section — the byproduct row that FEEDS on
// T6_POTATO is a different entry and is skipped by matching on the seed id.
function potatoRow(md) {
  X.renderFarmingTable(md);
  const t = X.tableState["farming-table"];
  const idx = t.data.findIndex((r) => r.item && r.item.id === SEED);
  assert.ok(idx >= 0, "no potato row rendered");
  return { row: t.data[idx], html: t.html[idx] };
}

console.log("Farming — the Route cell names buy, farm and sell\n");

test("seed bought in one city and farmed in another prints all three", () => {
  const { row, html } = potatoRow(market(
    { "Fort Sterling": 14264, Martlock: 15958 },
    { Thetford: 900 },
  ));
  assert.strictEqual(row.buySeed.city, "Fort Sterling");
  assert.strictEqual(row.farmCity, "Martlock");
  assert.ok(html.includes("Buy: Fort Sterling"), "seed city missing: " + html);
  assert.ok(html.includes("Farm: Martlock"), "farm city missing: " + html);
  assert.ok(html.includes("Sell: Thetford"), "sell city missing: " + html);
  assert.ok(html.indexOf("Buy: Fort Sterling") < html.indexOf("Farm: Martlock"),
    "the farm leg must sit between buy and sell");
  assert.ok(html.indexOf("Farm: Martlock") < html.indexOf("Sell: Thetford"));
});

test("the seed price cell quotes the city the seed is bought in", () => {
  const { html } = potatoRow(market(
    { "Fort Sterling": 14264, Martlock: 15958 },
    { Thetford: 900 },
  ));
  assert.ok(html.includes(`data-item-id="${SEED}" data-city="Fort Sterling">14264`),
    "the seed cell does not price Fort Sterling: " + html);
});

test("buying and farming in the same city prints no Farm leg", () => {
  const { row, html } = potatoRow(market({ Martlock: 15958 }, { Thetford: 900 }));
  assert.strictEqual(row.buySeed.city, "Martlock");
  assert.strictEqual(row.farmCity, "Martlock");
  assert.ok(html.includes("Buy: Martlock"), "seed city missing");
  assert.ok(!html.includes("Farm:"), "the farm leg was printed twice over: " + html);
});

test("the bonus badge reports the farm city, not the seed source", () => {
  const { html } = potatoRow(market(
    { "Fort Sterling": 14264, Martlock: 15958 },
    { Thetford: 900 },
  ));
  assert.ok(html.includes("Farming in Martlock"), "badge tooltip not on the farm city: " + html);
  assert.ok(!html.includes("Buying in Fort Sterling"), "badge still reads the seed source");
});

test("an unpriced row still renders a route without null cities", () => {
  const { html } = potatoRow({});
  assert.ok(!/data-city="null"/.test(html), "a price cell points at the city null");
  assert.ok(!html.includes("Farm: null"), "a null farm city was printed");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
