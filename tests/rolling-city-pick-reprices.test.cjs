/**
 * Test: the Artifact Rolling table RE-PRICES on its Buy / Sell City picks.
 *
 * Reported: Sell City = Lymhurst (with Show All on) left only the artifacts
 * whose best sale already happened to be Lymhurst — every other artifact of the
 * group vanished, so its price could not be set by hand — and the group header's
 * "/frag" figure kept the best-anywhere prices instead of Lymhurst's. The picker
 * only filtered rendered rows; each row still sold at its best city.
 *
 * Now, while a pick is active (js/table-sell-city.js):
 *   Sell → every artifact sells at the pick; one nobody lists there is kept as
 *          an unpriced, editable row at the pick; the group economics use the
 *          pick's prices;
 *   Buy  → the fragment is bought at the pick;
 *   a section (royal / Caerleon) whose city list lacks the pick is dropped;
 *   no pick = best city across the section, unchanged.
 *
 * Black box over the real renderRollingTable against synthetic market data.
 *
 * Run: node tests/rolling-city-pick-reprices.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const _els = {
  "include-caerleon": { checked: false },
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
  J("table-sell-city.js") +
  J("data-artifacts.js") +
  J("rolling-strategy.js") +
  J("render-rolling.js");

const mod = new Module("rolling-city-pick-reprices");
mod._compile(
  stubs + sources + `
module.exports = {
  _els, tableState, renderRollingTable, CITIES, SELL_CITIES, ROYAL_CITIES,
  setTableSellCity, setTableBuyCity, clearTableSellCities,
  tableRepricesOnCityPick, sellCityOptionsFor, buyCityOptionsFor,
  setCityForce,
  setOverride: (id, city, price) => {
    (priceOverrides[id] = priceOverrides[id] || {})[city] = { use: "auto", buyOrder: price, sellOrder: price };
  },
  clearPins: () => {
    Object.keys(priceOverrides).forEach((k) => delete priceOverrides[k]);
    Object.keys(cityForceOverrides).forEach((k) => delete cityForceOverrides[k]);
  },
};`,
  "rolling-city-pick-reprices.js",
);
const X = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  X.clearTableSellCities();
  X._els["include-caerleon"].checked = false; // royal / Caerleon split
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
  X.clearTableSellCities();
}

const entry = (buy, sell, vol) => ({ buy_price: buy, sell_price: sell, volume_24h: vol });

// Every id the table works with, discovered from an empty-market pass.
X.renderRollingTable({});
const IDS = X.tableState["rolling-table"].data;
const FRAGMENT_IDS = [...new Set(IDS.map((r) => r.fragmentId))];
const ART_IDS = [...new Set(IDS.map((r) => r.artId))];
// One artifact nobody lists in Lymhurst (still listed in Martlock).
const UNLISTED_IN_LYMHURST = ART_IDS.find((id) => /^T4_ARTEFACT_/.test(id));

/**
 * Fragments climb 20 silver per city in CITIES order, so Brecilien (listed last)
 * is the dearest without falling outside the IQR bounds. Artifacts sell best in
 * Martlock (60k) over Lymhurst (45k) and every other city (30k).
 */
function market() {
  const md = {};
  const put = (id, city, b, s) => { (md[id] = md[id] || {})[city] = entry(b, s, 500); };
  FRAGMENT_IDS.forEach((id) => X.CITIES.forEach((c, i) => put(id, c, 900 + 20 * i, 1000 + 20 * i)));
  ART_IDS.forEach((id) => X.SELL_CITIES.forEach((c) => {
    if (c === "Martlock") put(id, c, 55000, 60000);
    else if (c === "Lymhurst") { if (id !== UNLISTED_IN_LYMHURST) put(id, c, 40000, 45000); }
    else put(id, c, 25000, 30000);
  }));
  return md;
}

function render() {
  X.renderRollingTable(market());
  return X.tableState["rolling-table"];
}

const rowsOf = (t, section) => t.data.filter((r) => r.section === section);

// "/frag" printed on the T4 Rune (Any) group header, as a number.
function perFragOnHeader(t) {
  const html = t.html.find((h) => h.includes('data-header-roll="T4 Rune"') && h.includes('data-roll-cat="Any"'));
  assert.ok(html, "T4 Rune (Any) header not rendered");
  const m = html.match(/>(-?\d+)<small style="color:#9ca3af"> \/frag/);
  assert.ok(m, "no /frag figure on the header");
  return Number(m[1]);
}

console.log("Artifact Rolling — City picks re-price the table\n");

test("rolling-table is registered as re-pricing on both legs", () => {
  assert.strictEqual(X.tableRepricesOnCityPick("rolling-table"), true);
  assert.deepStrictEqual([...X.sellCityOptionsFor("rolling-table")], [...X.SELL_CITIES]);
  assert.deepStrictEqual([...X.buyCityOptionsFor("rolling-table")], [...X.CITIES]);
});

test("no pick: each artifact sells at its best city (unchanged)", () => {
  const t = render();
  const royal = rowsOf(t, "royal").find((r) => r.artId !== UNLISTED_IN_LYMHURST);
  assert.strictEqual(royal.bestSellCity, "Martlock");
  assert.ok(rowsOf(t, "caerleon").length > 0, "Caerleon section must stay");
});

test("sell pick: every royal artifact row survives, priced at the pick", () => {
  const baseline = rowsOf(render(), "royal").length;
  X.setTableSellCity("rolling-table", "Lymhurst");
  const t = render();
  const royal = rowsOf(t, "royal");
  assert.strictEqual(royal.length, baseline, "an artifact was dropped under the pick");
  assert.ok(royal.every((r) => r.bestSellCity === "Lymhurst"),
    "a row sells somewhere other than the pick");
  const listed = royal.find((r) => r.artId !== UNLISTED_IN_LYMHURST);
  assert.strictEqual(listed.bestSellPrice, 45000);
});

test("sell pick: an artifact unlisted at the pick stays as an editable row there", () => {
  X.setTableSellCity("rolling-table", "Lymhurst");
  const t = render();
  const i = t.data.findIndex((r) => r.artId === UNLISTED_IN_LYMHURST && r.section === "royal");
  assert.ok(i >= 0, "the unlisted artifact vanished");
  assert.strictEqual(t.data[i].hasNoArtData, true);
  assert.ok(/data-item-id="[^"]+" data-city="Lymhurst" data-city-list="sell">no data — click to set/.test(t.html[i]),
    "sell cell is not an editable no-data cell at Lymhurst");
});

test("sell pick: a section that cannot sell at the pick is dropped", () => {
  X.setTableSellCity("rolling-table", "Lymhurst");
  assert.strictEqual(rowsOf(render(), "caerleon").length, 0);
  X.setTableSellCity("rolling-table", "Black Market");
  const t = render();
  assert.strictEqual(rowsOf(t, "royal").length, 0);
  assert.ok(rowsOf(t, "caerleon").length > 0);
  assert.ok(rowsOf(t, "caerleon").every((r) => r.bestSellCity === "Black Market"));
});

test("sell pick: the group header's /frag follows the pick's prices", () => {
  X.setTableSellCity("rolling-table", "Martlock");
  const atMartlock = perFragOnHeader(render());
  X.setTableSellCity("rolling-table", "Lymhurst");
  const atLymhurst = perFragOnHeader(render());
  assert.ok(atLymhurst < atMartlock,
    `Lymhurst sells lower, so /frag must drop (Martlock ${atMartlock}, Lymhurst ${atLymhurst})`);
});

test("sell pick outranks a per-item sell pin elsewhere", () => {
  const art = ART_IDS.find((id) => id !== UNLISTED_IN_LYMHURST && /^T4_/.test(id));
  // A typed override at Martlock pins the item's sell city there.
  X.setOverride(art, "Martlock", 99999);
  X.setCityForce(art, "sell", "Martlock");
  try {
    assert.strictEqual(
      rowsOf(render(), "royal").find((r) => r.artId === art).bestSellCity, "Martlock",
      "fixture: without a pick the pin must win");
    X.setTableSellCity("rolling-table", "Lymhurst");
    const row = rowsOf(render(), "royal").find((r) => r.artId === art);
    assert.ok(row, "row missing under the pick");
    assert.strictEqual(row.bestSellCity, "Lymhurst");
    assert.strictEqual(row.bestSellPrice, 45000);
  } finally {
    X.clearPins();
  }
});

test("buy pick: fragments are bought at the pick even when dearer", () => {
  X.setTableBuyCity("rolling-table", "Brecilien");
  const t = render();
  const royal = rowsOf(t, "royal").filter((r) => !r.hasNoFragData);
  assert.ok(royal.length > 0, "no priced royal rows");
  assert.ok(royal.every((r) => r.fragBuyCity === "Brecilien"),
    "a fragment was bought outside the pick");
});

test("buy pick: a section that cannot buy at the pick is dropped", () => {
  X.setTableBuyCity("rolling-table", "Brecilien");
  assert.strictEqual(rowsOf(render(), "caerleon").length, 0);
});

// Black/Red Zone Routes on: one merged section over every city.
test("zone routes on: a sell pick keeps every artifact, priced at the pick", () => {
  X._els["include-caerleon"].checked = true;
  const baseline = render().data.length;
  X.setTableSellCity("rolling-table", "Lymhurst");
  const t = render();
  assert.strictEqual(t.data.length, baseline, "an artifact was dropped under the pick");
  assert.ok(t.data.every((r) => r.bestSellCity === "Lymhurst"));
  assert.ok(t.data.some((r) => r.artId === UNLISTED_IN_LYMHURST && r.hasNoArtData));
});

test("zone routes on: a buy pick sources every fragment at the pick", () => {
  X._els["include-caerleon"].checked = true;
  X.setTableBuyCity("rolling-table", "Brecilien");
  const t = render().data.filter((r) => !r.hasNoFragData);
  assert.ok(t.length > 0, "no priced rows");
  assert.ok(t.every((r) => r.fragBuyCity === "Brecilien"));
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
