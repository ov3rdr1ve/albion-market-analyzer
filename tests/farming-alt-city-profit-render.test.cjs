/**
 * Test: the Farming Profit cells print the counterpart farm city.
 *
 * The Bonus City column has always said a +10% local production bonus EXISTS;
 * it never said what it was worth, and a player whose plot sits in the wrong
 * city had no figure at all. Both Profit cells now carry a muted second line —
 * the same cycle farmed on the other side of the bonus line — plus the gap
 * between the two, which is the bonus itself.
 *
 * The line reads "<city> <profit> (<gap>)", with "+10% " in front when the
 * counterpart is the bonus city. It used to spell out "no bonus: {profit} @
 * {city}", but the cell it sits in is capped (cell-num) and every extra word
 * cost another wrapped line; the full sentence stayed in the title tooltip.
 * SUB_LINE below is that line's structural marker — the only <br><small> in a
 * farming row that carries a title.
 *
 * Black-box: drive the real renderFarmingTable over a synthetic market and read
 * the HTML. No live API, no database.
 *
 * Run: node tests/farming-alt-city-profit-render.test.cjs
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

const mod = new Module("farming-alt-city-profit");
mod._compile(
  stubs + sources + "\nmodule.exports = { tableState, renderFarmingTable, formatSilver };",
  "farming-alt-city-profit.js",
);
const X = mod.exports;
// utils.js redefines formatSilver over the stub, so read the assertions through
// the very function the cell used rather than re-implementing its grouping.
const money = (n) => X.formatSilver(n);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

// Martlock carries the +10% crop spec for T6_POTATO (js/data-city-bonuses.js).
const SEED = "T6_FARM_POTATO_SEED";
const CROP = "T6_POTATO";

function market(seedPrices, cropPrices) {
  const md = {};
  const put = (id, city, price) => {
    (md[id] = md[id] || {})[city] = { buy_price: price, sell_price: price, volume_24h: 500 };
  };
  Object.entries(seedPrices).forEach(([c, p]) => put(SEED, c, p));
  Object.entries(cropPrices).forEach(([c, p]) => put(CROP, c, p));
  return md;
}

function potatoRow(md) {
  X.renderFarmingTable(md);
  const t = X.tableState["farming-table"];
  const idx = t.data.findIndex((r) => r.item && r.item.id === SEED);
  assert.ok(idx >= 0, "no potato row rendered");
  return { row: t.data[idx], html: t.html[idx] };
}

const PRICED = () => market({ "Fort Sterling": 14264, Martlock: 15958 }, { Thetford: 900 });

// The alt-city sub-line's structural marker. The route's own <br><small> legs
// carry no title, so this matches the Profit cells' line and nothing else.
const SUB_LINE = '<br><small style="color:#9ca3af" title=';

console.log("Farming — the Profit cells price both sides of the +10%\n");

test("a bonus-city row names its no-bonus counterpart", () => {
  const { row, html } = potatoRow(PRICED());
  assert.strictEqual(row.farmCity, "Martlock");
  assert.strictEqual(row.cityYieldBonus, 0.10);
  assert.ok(row.altFarmCity, "no counterpart city was carried onto the row");
  assert.strictEqual(row.altHasBonus, false);
  assert.ok(html.includes(SUB_LINE), "the sub-line is missing: " + html);
  assert.ok(html.includes(row.altFarmCity + " "),
    "the counterpart city is not named: " + html);
  // The no-bonus side leads with the city; only the bonus side is prefixed.
  assert.ok(!html.includes("+10% " + row.altFarmCity),
    "a non-bonus counterpart was labelled +10%: " + html);
});

test("the counterpart figure and the gap are both printed", () => {
  const { row, html } = potatoRow(PRICED());
  const alt = money(row.altProfitPerCycle);
  const gap = money(row.profitPerCycle - row.altProfitPerCycle);
  assert.ok(row.altProfitPerCycle < row.profitPerCycle, "the counterpart should pay less");
  assert.ok(html.includes(row.altFarmCity + " " + alt),
    "the counterpart profit is missing: " + html);
  assert.ok(html.includes("(+" + gap + ")"), "the bonus gap is missing: " + html);
});

test("the sub-line hangs off the Profit / Cycle value, not the route", () => {
  const { row, html } = potatoRow(PRICED());
  const headline = money(row.profitPerCycle);
  assert.ok(html.includes(headline + '<br><small style="color:#9ca3af"'),
    "the sub-line is not glued to the Profit / Cycle figure: " + html);
});

test("Profit / Day carries its own sub-line, on the daily figures", () => {
  const { row, html } = potatoRow(PRICED());
  const altDay = money(row.altProfitPerDay);
  assert.ok(row.altProfitPerDay < row.profitPerDay);
  assert.ok(html.includes(row.altFarmCity + " " + altDay),
    "the daily counterpart is missing: " + html);
  // One line per Profit cell — Cycle and Day, and nothing else.
  assert.strictEqual(html.split(SUB_LINE).length - 1, 2,
    "expected exactly two sub-lines: " + html);
});

test("the headline still leads its cell and the pick has not moved", () => {
  const { row, html } = potatoRow(PRICED());
  assert.strictEqual(row.buySeed.city, "Fort Sterling");
  assert.strictEqual(row.sellCrop.city, "Thetford");
  assert.ok(html.indexOf(money(row.profitPerCycle)) <
    html.indexOf(SUB_LINE), "the counterpart is printed ahead of the headline");
});

// An unpriced seed no longer voids the row, so the two buckets still fill and a
// counterpart city exists. Nothing may be PRINTED from it: every silver figure
// on such a row would be revenue built on a free seed, so the profit cells (and
// the sub-line inside them) are replaced by "—".
// See tests/farming-unpriced-seed-row.test.cjs.
test("an unpriced row prints no sub-line", () => {
  const { row, html } = potatoRow({});
  assert.strictEqual(row.seedPriced, false);
  assert.ok(!html.includes(SUB_LINE), "a sub-line was printed with no data: " + html);
  assert.ok(!html.includes("null "), "a null counterpart city was printed: " + html);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
