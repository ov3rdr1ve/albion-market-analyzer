/**
 * Test: an Artifact Rolling row with no sell city keeps an editable sell cell.
 *
 * Bug: the sell cell was gated on a best sell city being found —
 * `bestSellCity ? priceTd(...) : '<td …>—</td>'`. No sell city means nobody has
 * listed the artifact anywhere, which is exactly when the user wants to type the
 * price in; the gate removed the editor in the one case it exists for. The
 * FRAGMENT cell immediately beside it already does the opposite: it falls back
 * to `fragBuyCity || CITIES[0]` and renders "no data — click to set".
 *
 * Black-box: drive the real renderRollingTable over synthetic market data and
 * read the row HTML it hands renderTableData.
 *
 * Run: node tests/rolling-no-sell-city-editable.test.cjs
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
};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const tableState = { "rolling-table": { data: [], html: [] } };
function renderTableData(id, rows, fmt) {
  tableState[id].data = rows;
  tableState[id].html = rows.map((r, i) => { try { return fmt(r, i); } catch (e) { return "ERR:" + e.message; } });
}
function priceTd(price, itemId, city) {
  const body = price > 0 ? String(price) : "no data — click to set";
  return '<td class="silver-val cell-num price-editable" data-item-id="' + itemId
    + '" data-city="' + city + '" data-city-list="sell">' + body + '</td>';
}
function profitTd() { return "<td></td>"; }
function volTd() { return "<td></td>"; }
function getProfitClass() { return ""; }
function addTdForKey() { return '<td class="cell-add"><button></button></td>'; }
function getRowKey(row) { return (row.artId || "?") + "|" + (row.rollType || ""); }
function dispName(id, name) { return name || id; }
function tx(en) { return en; }
function formatSilver(n) { return String(Math.round(Number(n) || 0)); }
function formatPriceAge() { return null; }
function bookDatesTitle() { return ""; }
function makeStrategyBadge() { return ""; }
function suspectMarginBadge() { return ""; }
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
  J("price-freshness.js") +
  J("data-artifacts.js") +
  J("rolling-strategy.js") +
  J("render-rolling.js");

const mod = new Module("rolling-no-sell-city-editable");
mod._compile(
  stubs + sources + "\nmodule.exports = { tableState, renderRollingTable, _els, CITIES, SELL_CITIES };",
  "rolling-no-sell-city-editable.js",
);
const X = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

const entry = (buy, sell, vol) => ({ buy_price: buy, sell_price: sell, volume_24h: vol });

/**
 * `artifactsPriced` false = nobody has listed any artifact, so no row can find a
 * best sell city. Fragments stay priced either way, so the rows themselves are
 * still built.
 */
function render(artifactsPriced) {
  const md = {};
  const rows = X.tableState["rolling-table"];
  // Price every fragment id the table asks for, and (optionally) every artifact.
  const put = (id, city, b, s) => { (md[id] = md[id] || {})[city] = entry(b, s, 500); };
  // First pass with an empty market discovers the ids the table works with.
  X.renderRollingTable({});
  rows.data.forEach((r) => {
    if (r.fragmentId) X.CITIES.forEach((c) => put(r.fragmentId, c, 900, 1000));
    if (artifactsPriced && r.artId) X.CITIES.forEach((c) => put(r.artId, c, 40000, 45000));
  });
  X.renderRollingTable(md);
  return rows;
}

const firstRow = (rows) => {
  const i = rows.data.findIndex((r) => r.artId);
  return { row: rows.data[i], html: rows.html[i] };
};

console.log("Artifact Rolling — the sell cell survives an unlisted artifact\n");

test("rows are still produced when no artifact is listed anywhere", () => {
  const rows = render(false);
  assert.ok(rows.data.length > 0, "no rolling rows at all");
  const { html } = firstRow(rows);
  assert.ok(!String(html).startsWith("ERR:"), "formatter threw: " + html);
});

test("the sell cell is click-to-edit with no sell city", () => {
  const rows = render(false);
  const { row, html } = firstRow(rows);
  assert.ok(!row.bestSellCity || row.bestSellPrice === 0,
    "fixture failed to produce an unlisted artifact");
  assert.ok(/data-item-id="[^"]+"[^>]*data-city-list="sell"/.test(html),
    "no editable sell cell: " + String(html).slice(0, 200));
  assert.ok(html.includes("click to set"), "sell cell does not invite an edit");
});

test("the sell cell names a real city, never null", () => {
  const rows = render(false);
  const { html } = firstRow(rows);
  const m = html.match(/data-city="([^"]*)"[^>]*data-city-list="sell"/);
  assert.ok(m, "sell cell missing");
  assert.ok(m[1] && m[1] !== "null" && m[1] !== "undefined", 'bad sell city "' + (m && m[1]) + '"');
  assert.ok(X.SELL_CITIES.includes(m[1]), "fallback city is not a sell city: " + m[1]);
});

test("the sell cell keys on the artifact, not the fragment", () => {
  const rows = render(false);
  const { row, html } = firstRow(rows);
  const m = html.match(/data-item-id="([^"]*)"[^>]*data-city-list="sell"/);
  assert.strictEqual(m && m[1], row.artId);
});

test("a listed artifact still prices and edits at its own best city", () => {
  const rows = render(true);
  const { row, html } = firstRow(rows);
  assert.ok(row.bestSellCity, "a listed artifact should resolve a sell city");
  assert.ok(html.includes('data-city="' + row.bestSellCity + '"'),
    "priced row lost its own sell city");
  assert.ok(!html.includes("click to set"), "a priced cell should show the price");
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
