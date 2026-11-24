/**
 * Test: the Mounts table RE-PRICES on its Buy / Sell City picks.
 *
 * Reported: Buy = Lymhurst, Sell = Lymhurst on the mounts table, yet the row's
 * materials (and the Crafting List board fed from them) still named Fort
 * Sterling / Martlock / Bridgewatch. The pickers only filtered rendered rows;
 * the row builder kept sourcing the baby, the feed and every saddler mat
 * wherever each was cheapest. User decision (2026-09-10): "if i set source city
 * lymhurst, then all mats should show from lymhurst."
 *
 * Now, while a pick is active (js/mounts-city-pick.js over js/table-sell-city.js):
 *   Buy  → the baby, the feed, every saddler mat and every craft material are
 *          bought at the pick;
 *   Sell → the grown / saddled / crafted mount sells at the pick;
 *   a section (royal / Caerleon) that cannot reach the pick is dropped;
 *   a pick with no listing keeps the row, its unpriced cells at the pick;
 *   no pick = cheapest-across-cities, unchanged.
 *
 * Black box over the real renderMountsTable against synthetic market data.
 *
 * Run: node tests/mounts-city-pick-reroutes.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const _els = {};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const tableState = { "mounts-table": { data: [] }, "faction-spending-table": { data: [] } };
function renderTableData(id, rows, fmt) {
  tableState[id].data = rows;
  tableState[id].html = rows.map((r, i) => { try { return fmt(r, i); } catch (e) { return "ERR:" + e.message; } });
}
function priceTd(p, itemId, city) {
  return '<td class="price-editable" data-item-id="' + itemId + '" data-city="' + city + '">' + (p > 0 ? p : "no data") + '</td>';
}
function aggregateCostTd(cost) { return '<td>' + (cost > 0 ? cost : "—") + '</td>'; }
function volTd(){ return "<td></td>"; }
function profitTd(){ return "<td></td>"; }
function pureProfitTd(){ return "<td></td>"; }
function matPriceSpan(id, c, p) {
  return '<span class="price-editable" data-item-id="' + id + '" data-city="' + (c || "") + '">@ ' + (p > 0 ? p : "no data") + ' ea</span>';
}
function getProfitClass(){ return ""; }
function getRowKey(row) { return ((row.item && (row.item.babyId || row.item.id)) || "?") + "|" + (row.section || ""); }
function addTdForKey() { return '<td class="cell-add"></td>'; }
function dispName(id, name) { return name || id; }
function tx(en) { return en; }
function brecilienFeeBadge() { return ""; }
function focusPlayCell() { return "<td></td>"; }
function formatSilver(n) { return String(n); }
function formatFocusCost(n) { return String(n); }
function matsNeededFor10kFocus() { return 0; }
const ITEM_NAMES_MAP = {};
let lastMpMarketData = null, lastMarketData = null;
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const CRAFTING_ITEMS = [], FLIPPING_ITEMS = [], TRANSPORT_ITEMS = [], CONSUMABLES = [], FARMING_ITEMS = [], ARTIFACT_FLIP_ITEMS = [], GEAR_CAPES = [];
`;

const sources =
  J("table-sell-city.js") +
  J("route-cell.js") +
  J("focus-play.js") +
  J("data-faction-fp-costs.js") +
  J("focus-costs.js") +
  J("data-mounts.js") +
  J("data-city-bonuses.js") +
  (J("calculations.js") + J("calculations-margins.js")) +
  J("travel-cost.js") +
  J("mp-bonus.js") +
  (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  J("rrr-eligible.js") +
  J("mounts-city-pick.js") +
  J("render-mounts.js") + J("render-mounts-breeding-row.js") + J("render-mounts-craft-row.js");

const mod = new Module("mounts-city-pick-reroutes");
mod._compile(
  stubs + sources
    + "\nmodule.exports = { tableState, renderMountsTable, setTableBuyCity, setTableSellCity,"
    + " clearTableSellCities, setCityForce, clearCityForce };",
  "mounts-city-pick-reroutes.js",
);
const X = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  X.clearTableSellCities();
  X.clearCityForce("T5_PLANKS", "buy");
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
  finally { X.clearTableSellCities(); X.clearCityForce("T5_PLANKS", "buy"); }
}

// ── Fixture ─────────────────────────────────────────────────────────────────
// Ox line: T5_FARM_OX_BABY → grow on plants → saddle into T5_MOUNT_OX with
// 30× T5_PLANKS. The craft row buys T5_FARM_OX_GROWN + 30× T5_PLANKS.
// Every input is listed everywhere, CHEAPEST IN THETFORD. The ox sells best in
// Lymhurst (royal) and higher still at the Black Market (Caerleon only).
const ALL = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
const CHEAPEST = "Thetford";
const OX_ASK = {
  Lymhurst: 150000, "Fort Sterling": 148000, Thetford: 146000, Martlock: 144000,
  Bridgewatch: 142000, Brecilien: 140000, Caerleon: 139000,
};
const INPUTS = {
  T5_FARM_OX_BABY: 20000, T5_FARM_OX_GROWN: 60000, T5_PLANKS: 800,
  T5_CABBAGE: 50, T4_TURNIP: 60, T3_WHEAT: 70,
};

function market(omit = []) {
  const skip = new Set(omit.map(([id, c]) => `${id}|${c}`));
  const md = {};
  const put = (id, c, b, s) => {
    if (skip.has(`${id}|${c}`)) return;
    (md[id] = md[id] || {})[c] = { buy_price: b, sell_price: s, volume_24h: 9999 };
  };
  ALL.forEach((c) => {
    Object.entries(INPUTS).forEach(([id, base]) => {
      const p = c === CHEAPEST ? base : Math.round(base * 1.1);
      put(id, c, p, p + 5);
    });
    put("T5_MOUNT_OX", c, OX_ASK[c] - 500, OX_ASK[c]);
  });
  put("T5_MOUNT_OX", "Black Market", 170000, 170000);
  return md;
}

function render(md) {
  X.renderMountsTable(md || market());
  return X.tableState["mounts-table"];
}
function breeding(section) {
  const t = X.tableState["mounts-table"];
  const i = t.data.findIndex((r) => r.isBreeding && r.item.babyId === "T5_FARM_OX_BABY" && r.section === section);
  return i < 0 ? null : { row: t.data[i], html: t.html[i] };
}
function craft(section) {
  const t = X.tableState["mounts-table"];
  const i = t.data.findIndex((r) => r.isCraft && r.item.id === "T5_MOUNT_OX" && r.section === section);
  return i < 0 ? null : { row: t.data[i], html: t.html[i] };
}
/** Every city a breeding row buys something in: the baby, the feed, each saddler mat. */
function breedingBuyCities(row) {
  const out = new Set([row.buyMat.city]);
  if (row.feed) out.add(row.feed.city);
  Object.values(row.saddlerMatPrices || {}).forEach((m) => { if (!m.isProduced) out.add(m.city); });
  return [...out];
}
const craftBuyCities = (row) => [...new Set(Object.values(row.matBestPrices).map((m) => m.city))];
const summary = (t) => t.data.map((r) => ({
  id: r.item.babyId || r.item.id, section: r.section, margin: r.marginInfo.margin,
  buy: r.isBreeding ? breedingBuyCities(r) : craftBuyCities(r), sell: r.sellPot.city,
}));

console.log("Mounts — the City picks re-price the row builder\n");

console.log("=== No pick: cheapest across cities ===");

test("the royal breeding row buys baby, feed and saddler mats where cheapest", () => {
  render();
  const b = breeding("royal");
  assert.ok(b, "no royal ox breeding row");
  assert.deepStrictEqual(breedingBuyCities(b.row), [CHEAPEST]);
  assert.strictEqual(b.row.sellPot.city, "Lymhurst");
});

test("the royal craft row buys its materials where cheapest", () => {
  render();
  const c = craft("royal");
  assert.ok(c, "no royal ox craft row");
  assert.deepStrictEqual(craftBuyCities(c.row), [CHEAPEST]);
});

console.log("\n=== Buy City pick ===");

["Lymhurst", "Martlock"].forEach((city) => {
  test(`buy ${city}: baby, feed and every saddler mat come from ${city}`, () => {
    X.setTableBuyCity("mounts-table", city);
    render();
    const b = breeding("royal");
    assert.ok(b, "the royal breeding row must survive a royal pick");
    assert.deepStrictEqual(breedingBuyCities(b.row), [city]);
  });

  test(`buy ${city}: every craft material comes from ${city}`, () => {
    X.setTableBuyCity("mounts-table", city);
    render();
    const c = craft("royal");
    assert.ok(c, "the royal craft row must survive a royal pick");
    assert.deepStrictEqual(craftBuyCities(c.row), [city]);
  });
});

test("buy + sell Lymhurst: the breeding row's HTML names no other royal city", () => {
  X.setTableBuyCity("mounts-table", "Lymhurst");
  X.setTableSellCity("mounts-table", "Lymhurst");
  render();
  const b = breeding("royal");
  assert.ok(!String(b.html).startsWith("ERR:"), b.html);
  const other = String(b.html).match(/Fort Sterling|Thetford|Martlock|Bridgewatch|Brecilien/);
  assert.strictEqual(other, null, `row HTML still names ${other && other[0]}`);
});

test("a buy pick leaves the sell leg alone", () => {
  X.setTableBuyCity("mounts-table", "Martlock");
  render();
  assert.strictEqual(breeding("royal").row.sellPot.city, "Lymhurst");
  assert.strictEqual(craft("royal").row.sellPot.city, "Lymhurst");
});

test("the buy pick outranks a per-item buy pin", () => {
  X.setCityForce("T5_PLANKS", "buy", "Thetford");
  X.setTableBuyCity("mounts-table", "Martlock");
  render();
  assert.strictEqual(craft("royal").row.matBestPrices.T5_PLANKS.city, "Martlock");
  assert.strictEqual(breeding("royal").row.saddlerMatPrices.T5_PLANKS.city, "Martlock");
});

test("a royal buy pick drops the Caerleon section", () => {
  X.setTableBuyCity("mounts-table", "Lymhurst");
  render();
  assert.strictEqual(breeding("caerleon"), null);
  assert.strictEqual(craft("caerleon"), null);
});

test("a Caerleon buy pick drops the royal section and sources in Caerleon", () => {
  X.setTableBuyCity("mounts-table", "Caerleon");
  render();
  assert.strictEqual(breeding("royal"), null);
  assert.strictEqual(craft("royal"), null);
  assert.deepStrictEqual(breedingBuyCities(breeding("caerleon").row), ["Caerleon"]);
  assert.deepStrictEqual(craftBuyCities(craft("caerleon").row), ["Caerleon"]);
});

console.log("\n=== Sell City pick ===");

test("sell Martlock: the saddled and the crafted ox sell in Martlock", () => {
  X.setTableSellCity("mounts-table", "Martlock");
  render();
  assert.strictEqual(breeding("royal").row.sellPot.city, "Martlock");
  assert.strictEqual(craft("royal").row.sellPot.city, "Martlock");
  assert.deepStrictEqual(breedingBuyCities(breeding("royal").row), [CHEAPEST], "buy leg untouched");
});

test("sell Black Market: royal rows drop, the Caerleon rows sell at the BM", () => {
  X.setTableSellCity("mounts-table", "Black Market");
  render();
  assert.strictEqual(breeding("royal"), null, "no royal row can sell at the Black Market");
  assert.strictEqual(craft("royal"), null);
  assert.strictEqual(breeding("caerleon").row.sellPot.city, "Black Market");
  assert.strictEqual(craft("caerleon").row.sellPot.city, "Black Market");
});

test("both picks at once route both legs", () => {
  X.setTableBuyCity("mounts-table", "Martlock");
  X.setTableSellCity("mounts-table", "Bridgewatch");
  render();
  const b = breeding("royal").row;
  assert.deepStrictEqual(breedingBuyCities(b), ["Martlock"]);
  assert.strictEqual(b.sellPot.city, "Bridgewatch");
  const c = craft("royal").row;
  assert.deepStrictEqual(craftBuyCities(c), ["Martlock"]);
  assert.strictEqual(c.sellPot.city, "Bridgewatch");
});

console.log("\n=== A pick with no listing keeps the row, unpriced, at the pick ===");

test("no baby listed at the buy pick: the breeding row stays, buying at the pick", () => {
  X.setTableBuyCity("mounts-table", "Brecilien");
  render(market([["T5_FARM_OX_BABY", "Brecilien"]]));
  const b = breeding("royal");
  assert.ok(b, "the row stays on the table, editable");
  assert.strictEqual(b.row.marginInfo.margin, -1);
  assert.deepStrictEqual(breedingBuyCities(b.row), ["Brecilien"]);
});

test("no planks listed at the buy pick: the craft row stays, its blocker at the pick", () => {
  X.setTableBuyCity("mounts-table", "Brecilien");
  render(market([["T5_PLANKS", "Brecilien"]]));
  const c = craft("royal");
  assert.ok(c, "the craft row stays on the table, editable");
  assert.strictEqual(c.row.marginInfo.margin, -1);
  assert.strictEqual(c.row.matBestPrices.T5_PLANKS.city, "Brecilien");
});

test("no ox listed at the sell pick: the craft row stays, its sell cell at the pick", () => {
  X.setTableSellCity("mounts-table", "Bridgewatch");
  render(market([["T5_MOUNT_OX", "Bridgewatch"]]));
  const c = craft("royal");
  assert.ok(c, "the craft row stays on the table, editable");
  assert.strictEqual(c.row.sellPot.city, "Bridgewatch");
});

console.log("\n=== Pick back to All ===");

test("clearing both picks restores today's rows exactly", () => {
  const before = summary(render());
  X.setTableBuyCity("mounts-table", "Lymhurst");
  X.setTableSellCity("mounts-table", "Martlock");
  render();
  X.clearTableSellCities();
  assert.deepStrictEqual(summary(render()), before);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
