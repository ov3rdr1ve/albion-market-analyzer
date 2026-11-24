/**
 * Test: an unpriced Farming row's price cells still name a real city.
 *
 * Bug: an unpriced leg is `emptyFarmingLeg()` — `{ city: null, price: 0 }`
 * (js/farming-row-econ.js) — and the renderer handed that null straight to
 * priceTd. The cell came out as `data-city="null"`, so the click-to-edit editor
 * opened on a city that does not exist: buildCityOptions (js/price-edit-dropdown.js)
 * cannot find "null" in its city list, so preferCity is ignored and the default
 * selection falls through to nothing. The cell was clickable but pointed nowhere.
 *
 * Black-box: drive the real renderFarmingTable over synthetic market data with
 * legs deliberately unpriced, and read the HTML.
 *
 * Run: node tests/farming-no-data-city.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const _els = {
  "include-caerleon": { checked: true },
  "sort-instant": { checked: false },
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
  const body = price > 0 ? String(price) : "no data — click to set";
  return '<td class="cell-num price-editable" data-item-id="' + itemId
    + '" data-city="' + city + '" data-city-list="' + (side || "sell") + '">' + body + '</td>';
}
function profitTd() { return "<td></td>"; }
function volTd() { return "<td></td>"; }
function getProfitClass() { return ""; }
function addTdForKey() { return '<td class="cell-add"><button></button></td>'; }
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

const mod = new Module("farming-no-data-city");
mod._compile(
  stubs + sources
    + "\nmodule.exports = { tableState, renderFarmingTable, farmingPriceCity, _els, CITIES, ROYAL_CITIES, SELL_CITIES };",
  "farming-no-data-city.js",
);
const X = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

const KNOWN = new Set([...X.SELL_CITIES]);
const EMPTY = { city: null, price: 0, travelCost: 0 };

console.log("Farming — unpriced price cells still name a real city\n");

// ── the helper, over every combination of what is and is not known ──────────

const CASES = [
  {
    name: "both legs priced",
    row: { buySeed: { city: "Martlock" }, sellCrop: { city: "Thetford" }, section: "royal" },
    expectBuy: "Martlock", expectSell: "Thetford",
  },
  {
    name: "buy leg unpriced, sell leg known",
    row: { buySeed: EMPTY, sellCrop: { city: "Thetford" }, section: "royal" },
    expectBuy: "Thetford", expectSell: "Thetford",
  },
  {
    name: "sell leg unpriced, buy leg known",
    row: { buySeed: { city: "Martlock" }, sellCrop: EMPTY, section: "royal" },
    expectBuy: "Martlock", expectSell: "Martlock",
  },
  {
    name: "neither leg priced, royal section",
    row: { buySeed: EMPTY, sellCrop: EMPTY, section: "royal" },
    expectBuy: X.ROYAL_CITIES[0], expectSell: X.ROYAL_CITIES[0],
  },
  {
    name: "neither leg priced, caerleon section",
    row: { buySeed: EMPTY, sellCrop: EMPTY, section: "caerleon" },
    expectBuy: "Caerleon", expectSell: "Caerleon",
  },
];

CASES.forEach((c) => {
  test(c.name + " — buy cell", () => {
    const got = X.farmingPriceCity(c.row, c.row.buySeed, "buy", "T5_CABBAGE_SEED");
    assert.strictEqual(got, c.expectBuy);
    assert.ok(KNOWN.has(got), "not a real city: " + got);
  });
  test(c.name + " — sell cell", () => {
    const got = X.farmingPriceCity(c.row, c.row.sellCrop, "sell", "T5_CABBAGE");
    assert.strictEqual(got, c.expectSell);
    assert.ok(KNOWN.has(got), "not a real city: " + got);
  });
});

// ── end to end: nothing priced at all ───────────────────────────────────────

test("with an empty market no rendered cell carries data-city=\"null\"", () => {
  X.renderFarmingTable({});
  const html = X.tableState["farming-table"].html.join("\n");
  assert.ok(html.length > 0, "the table rendered nothing at all");
  assert.ok(!/data-city="null"/.test(html), 'a price cell points at the city "null"');
  assert.ok(!/data-city="undefined"/.test(html), "a price cell points at an undefined city");
  assert.ok(!/data-city=""/.test(html), "a price cell points at no city");
});

test("with an empty market the cells are still click-to-edit", () => {
  X.renderFarmingTable({});
  const html = X.tableState["farming-table"].html.join("\n");
  assert.ok(/data-city-list="buy"/.test(html), "no editable buy cell");
  assert.ok(/data-city-list="sell"/.test(html), "no editable sell cell");
  assert.ok(html.includes("click to set"), "the cells do not invite an edit");
});

test("every rendered city is one the price editor knows", () => {
  X.renderFarmingTable({});
  const html = X.tableState["farming-table"].html.join("\n");
  const cities = [...html.matchAll(/data-city="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(cities.length > 0, "no price cells at all");
  const bad = [...new Set(cities)].filter((c) => !KNOWN.has(c));
  assert.strictEqual(bad.length, 0, "unknown cities: " + bad.join(", "));
});

test("a priced row keeps its own cities", () => {
  const md = {};
  const put = (id, c, b, s) => { (md[id] = md[id] || {})[c] = { buy_price: b, sell_price: s, volume_24h: 500 }; };
  // Price one whole row: seed bought in Martlock, crop sold in Thetford.
  X.renderFarmingTable({});
  const sample = X.tableState["farming-table"].data.find((r) => r.item && r.item.outputId);
  put(sample.item.id, "Martlock", 300, 320);
  put(sample.item.outputId, "Thetford", 850, 900);
  X.renderFarmingTable(md);
  const rows = X.tableState["farming-table"];
  const idx = rows.data.findIndex((r) => r.item.id === sample.item.id && r.section !== "caerleon");
  const html = rows.html[idx];
  assert.ok(html.includes('data-item-id="' + sample.item.id + '"'), "seed cell missing");
  assert.ok(html.includes('data-item-id="' + sample.item.outputId + '"'), "crop cell missing");
  assert.ok(!/data-city="null"/.test(html), "priced row still points at a null city");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
