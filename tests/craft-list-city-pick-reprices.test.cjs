/**
 * My Crafting List: its City pick RE-PRICES the entries instead of filtering
 * them (js/render-craft-list.js _clListState, js/table-sell-city.js
 * withTableCityPicks, js/craft-list-filter.js rowPassesListCity).
 *
 * Reported: picking "Sell City: Lymhurst" on the list hid every entry whose
 * source row happened to sell somewhere else. The list should instead show
 * every entry as if it sold in Lymhurst — the same rule every re-pricing table
 * already follows — without moving the source table's own picks.
 *
 * Run: node tests/craft-list-city-pick-reprices.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const loadFile = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/if \(typeof module[\s\S]*$/, "");

const sandbox = `
const SELL_CITIES = ["Martlock", "Lymhurst", "Caerleon", "Black Market"];
const CITIES = ["Martlock", "Lymhurst", "Caerleon"];
// The Black Market sells from Caerleon alone.
function isInvalidCrossRoute(from, to) { return to === "Black Market" && from !== "Caerleon"; }

const _store = { renders: 0, painted: 0 };
const document = undefined;
function getRowKey(row) { return row.item.id + "|" + row.craftCity; }
function craftListIdentity(tableId, key) { return tableId + "::" + key; }
let lastMarketData = { seeded: true };
const lastQualityMarketData = null;

// What renderTableData does (js/app-cells.js), minus the table itself.
function renderTableData(id, rows, formatter) {
  tableState[id].data = rows;
  tableState[id].formatter = formatter;
  if (!isTableShadowRender(id)) _store.painted++;
}
// A crafting renderer: sells at its own City pick, else at its best city.
function renderCrafting() {
  _store.renders++;
  const pick = getTableSellCity("crafting-table");
  const rows = ["Martlock", "Caerleon"].flatMap((craftCity) => {
    if (pick && isInvalidCrossRoute(craftCity, pick)) return [];
    const city = pick || (craftCity === "Caerleon" ? "Black Market" : "Martlock");
    return [{ item: { id: "T5_BAG" }, craftCity, sellCity: city, price: city.length * 1000 }];
  });
  renderTableData("crafting-table", rows, (r) => "<tr>" + r.sellCity + "</tr>");
}
const window = { tableRenderers: () => ({ "crafting-table": renderCrafting }) };

const tableState = { "crafting-table": { data: [], formatter: null, sortCol: "profit" } };
`;

const src = sandbox
  + loadFile("js/table-sell-city.js")
  + loadFile("js/render-craft-list-source.js")
  + loadFile("js/render-craft-list-cells.js")
  + loadFile("js/render-craft-list.js")
  + `
module.exports = {
  _clListState, findCraftListRow, withTableCityPicks, isTableShadowRender,
  sellCityFilterChanged, setTableSellCity, getTableSellCity, getTableBuyCity,
  tableRepricesOnCityPick, sellCityOptionsFor,
  _store, tableState, renderCrafting,
};`;
const m = new Module("craft-list-city-pick-test");
m._compile(src, path.join(ROOT, "js", "craft-list-city-pick-test.js"));
const api = m.exports;

let failed = 0;
function test(name, fn) {
  try { fn(); console.log("ok -", name); }
  catch (e) { failed++; console.log("not ok -", name); console.log(e); }
}

const LIST = "craft-list-table";
const martlockEntry = { tableId: "crafting-table", rowKey: "T5_BAG|Martlock", itemId: "T5_BAG" };
const caerleonEntry = { tableId: "crafting-table", rowKey: "T5_BAG|Caerleon", itemId: "T5_BAG" };

api.renderCrafting();
const baseData = api.tableState["crafting-table"].data;

test("the list offers every sell city, and its pick counts as re-pricing", () => {
  assert.strictEqual(api.tableRepricesOnCityPick(LIST), true);
  assert.ok(api.sellCityOptionsFor(LIST).includes("Lymhurst"));
});

test("no list pick: the list reads the source's own rows", () => {
  api.sellCityFilterChanged(LIST, "");
  assert.strictEqual(api._clListState("crafting-table"), api.tableState["crafting-table"]);
});

test("a list pick re-prices every entry at that city", () => {
  api.sellCityFilterChanged(LIST, "Lymhurst");
  const state = api._clListState("crafting-table");
  const a = api.findCraftListRow(state, martlockEntry);
  const b = api.findCraftListRow(state, caerleonEntry);
  assert.strictEqual(a.row.sellCity, "Lymhurst");
  assert.strictEqual(b.row.sellCity, "Lymhurst");
  assert.deepStrictEqual(a.repriced, { sell: "Lymhurst", buy: null });
});

test("the source table is left exactly as it was", () => {
  const live = api.tableState["crafting-table"];
  assert.strictEqual(live.data, baseData, "the source's own rows are put back");
  assert.strictEqual(live.sortCol, "profit");
  assert.strictEqual(api.getTableSellCity("crafting-table"), null, "the source's pick is untouched");
  assert.strictEqual(api._store.painted, 1, "the off-screen render never painted the source");
  assert.strictEqual(api.isTableShadowRender("crafting-table"), false);
});

test("the re-priced rows are cached until the source re-renders", () => {
  const before = api._store.renders;
  api._clListState("crafting-table");
  assert.strictEqual(api._store.renders, before, "same source rows, same pick: no re-render");
  api.renderCrafting(); // a new price pass hands the source a new array
  api._clListState("crafting-table");
  assert.strictEqual(api._store.renders, before + 2, "the source's own pass, then one re-price");
});

test("an entry the pick cannot reach falls back to its own row", () => {
  api.sellCityFilterChanged(LIST, "Black Market");
  const state = api._clListState("crafting-table");
  const royal = api.findCraftListRow(state, martlockEntry);
  assert.strictEqual(royal.row.sellCity, "Martlock", "the source's own row, still naming its city");
  assert.strictEqual(royal.repriced, null, "not marked re-priced, so the list filter judges it");
  const caer = api.findCraftListRow(state, caerleonEntry);
  assert.strictEqual(caer.row.sellCity, "Black Market");
  assert.ok(caer.repriced);
  api.sellCityFilterChanged(LIST, "");
});

test("withTableCityPicks restores the picks even when the render throws", () => {
  api.setTableSellCity("crafting-table", "Martlock");
  assert.throws(() => api.withTableCityPicks("crafting-table", { sell: "Lymhurst" }, () => {
    assert.strictEqual(api.getTableSellCity("crafting-table"), "Lymhurst");
    assert.strictEqual(api.isTableShadowRender("crafting-table"), true);
    throw new Error("boom");
  }));
  assert.strictEqual(api.getTableSellCity("crafting-table"), "Martlock");
  assert.strictEqual(api.getTableBuyCity("crafting-table"), null);
  assert.strictEqual(api.isTableShadowRender("crafting-table"), false);
  api.setTableSellCity("crafting-table", null);
});

// ── the list filter's city leg ──────────────────────────────────────────────

global.window = {
  tableSearchInternals: {},
  tableFilters: {
    rowCities: (tr, side) => new Set(tr.cities[side] || []),
  },
};
const filter = require(path.join(ROOT, "js", "craft-list-filter.js"));
delete global.window;
const tr = (attrs, cities) => ({
  cities,
  getAttribute: (n) => (Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null),
});

test("a row re-priced at the pick passes the list's city filter", () => {
  const row = tr({ "data-cl-repriced-sell": "Lymhurst" }, { sell: [] });
  assert.strictEqual(filter.rowPassesListCity(row, "sell", "Lymhurst"), true);
});

test("a row the pick could not re-price is judged on the cities it names", () => {
  assert.strictEqual(filter.rowPassesListCity(tr({}, { sell: ["Martlock"] }), "sell", "Lymhurst"), false);
  assert.strictEqual(filter.rowPassesListCity(tr({}, { sell: ["Lymhurst"] }), "sell", "Lymhurst"), true);
  assert.strictEqual(filter.rowPassesListCity(tr({}, {}), "sell", ""), true);
});

if (failed) { console.log(`${failed} failed`); process.exit(1); }
