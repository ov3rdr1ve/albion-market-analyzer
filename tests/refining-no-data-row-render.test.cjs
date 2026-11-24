/**
 * Integration test: renderTransportTable must render the profit columns as n/a
 * for a refining row whose RAW resource has no market data — even when the
 * secondary and sell sides ARE priced. This is the reported "8.4 planks" bug:
 * "5x 8.4 logs @ no data" + "1x 7.4 planks @ 949,999" was still printing a
 * profit, because the fallback computed a margin off the priced secondary alone.
 *
 * Drives the REAL render-transport.js (+ real refining-chain recipes/pricing)
 * with a synthetic single-route catalog and a renderTableData capture. Market
 * helpers are stubbed (no live data). profitTd/pureProfitTd stubs carry unique
 * markers so the test can prove those cells are REPLACED by the n/a dash when
 * data is missing — and still rendered when everything is priced.
 *
 * Run: node tests/refining-no-data-row-render.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// Row text runs through tx(english, slug); en-mode identity keeps assertions in English.
globalThis.tx = globalThis.tx || ((en) => en);

const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SETUP_FEE = 0.025;
const PREMIUM_TAX = 0.065;
const BASE_CITY_BONUS = 0.18;
const REFINE_SPEC_BONUS = 0.40;
const FOCUS_BONUS = 0.59;
const OX_CAPACITY_KG = 1500;
const CITY_REFINE_SPEC = { "Fort Sterling": "wood", Lymhurst: "fiber", Bridgewatch: "rock", Thetford: "ore", Martlock: "hide" };
const RESOURCE_DEFS = [
  { type: "wood", raw: "WOOD", refined: "PLANKS", tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];
// One synthetic route: T8 planks = 5x T8 wood (raw) + 1x T7 planks (secondary).
const TRANSPORT_ITEMS = [{
  mat: "Whitewood Logs [T8]", rawId: "T8_WOOD", refinedId: "T8_PLANKS",
  rawRatio: 5, resourceType: "wood", secondaryMatId: "T7_PLANKS", secondaryMatCount: 1,
}];

function isBlackRedZoneEnabled() { return false; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function isFocusEnabled() { return false; }
function getOrderType() { return "market"; }
function getOverridePrice() { return null; }
function getOverrideVolume() { return null; }
function getCityForce() { return null; }
function isInvalidCrossRoute() { return false; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].buy_price) || 0; }
function getSellPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].sell_price) || 0; }
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getRefineRRR(city, t, f) { let b = BASE_CITY_BONUS; if (CITY_REFINE_SPEC[city]===t) b+=REFINE_SPEC_BONUS; if (f) b+=FOCUS_BONUS; return calcRRR(b); }
function getFocusCost() { return 100; }
function calcStationFeeSilver() { return 0; }
function refineStationFeeSilver() { return 0; }
function getTierFromId(id) { const m = id.match(/T(\\d+)/); return m ? parseInt(m[1],10) : 0; }
function getResourceWeightKg(tier) { return 0.1 * Math.pow(1.5, tier); }
function getMinVol() { return 0; }
function getMinVol2() { return 0; }
function matsNeededFor10kFocus(focusCost, per, applyRrr, rrr) { const c = Math.floor(10000/focusCost); const e = applyRrr ? per*(1-(rrr||0)) : per; return Math.round(c*e); }
function calculateTransportMargin(buyCost, sellPrice, rrr=0, sec=0, station=0, travel=0, nonRet=0) {
  if (!buyCost || !sellPrice) return { profit: 0, margin: 0 };
  const eff = ((buyCost + sec) * (1 - rrr) + nonRet) * (1 + SETUP_FEE) + station + travel;
  const rev = sellPrice * (1 - PREMIUM_TAX);
  return { profit: rev - eff, margin: (rev - eff) / eff * 100 };
}
function calculateOxLoad(profit, weight) { if (!weight || weight <= 0) return { itemsPerLoad: 0, profitPerLoad: 0 }; const n = Math.floor(OX_CAPACITY_KG/weight); return { itemsPerLoad: n, profitPerLoad: profit * n }; }
function calculateProfitPer10kFocus(profit, focusCost) { if (!focusCost || focusCost <= 0) return 0; return profit * Math.floor(10000 / focusCost); }
function calculateProfitPerFocus(p, f) { if (!f || f <= 0) return 0; return p / f; }
function formatSilver(n) { if (n === null || n === undefined) return "N/A"; return Math.round(n).toLocaleString(); }
function formatFocusCost(n) { if (n == null || !Number.isFinite(n)) return "N/A"; const a = Math.abs(n); if (a >= 100) return Math.round(n).toLocaleString(); return String(Number(n.toFixed(a >= 10 ? 1 : 2))); }
function getItemDisplayName(id) { return id; }
function matPriceSpan(id, city, price) { return "<span class='mat' data-item-id='"+id+"' data-city='"+(city||"")+"'>@ "+(price>0?price:"no data")+" ea</span>"; }
function resourceAliasSpan() { return ""; }
// Read-only aggregate cost cell (js/app.js aggregateCostTd) — the Input Cost
// column is a sum, so it is not a click-to-override price cell.
function aggregateCostTd(c, cls) { return '<td class="' + (cls || "silver-val cell-num") + '">' + (Number(c) > 0 ? c : "—") + '</td>'; }
function priceTd(p) { return "<td class='price'>"+(p>0?p:"no data")+"</td>"; }
function profitTd(mi) { return "<td class='PROFITPCT'>"+mi.margin.toFixed(2)+"%</td>"; }
function pureProfitTd(mi) { const pr = mi && mi.profit; if (pr===undefined||pr===null) return "<td class='PUREPROFIT'>dash</td>"; return "<td class='PUREPROFIT'>"+pr+"</td>"; }
function volTd(v) { return "<td class='vol'>"+v+"</td>"; }
// The "+" column cell (js/table-add-button.js) — every row template emits it.
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row) { return row.route.refinedId + "|" + (row.section || ""); }
function findBestBuyCity(marketData, itemId, cities) { let best = { city: null, price: 0 }; for (const c of cities) { const p = getBuyPrice(marketData[itemId], c); if (p > best.price) best = { city: c, price: p }; } if (!best.city) best = { city: cities[0] || null, price: 0 }; return best; }
function findBestSellCity(marketData, itemId, cities) { let best = { city: null, price: 0 }; for (const c of cities) { const p = getSellPrice(marketData[itemId], c); if (p > best.price) best = { city: c, price: p }; } if (!best.city) best = { city: cities[0] || null, price: 0 }; return best; }
function renderChainBreakdown() { return ""; }
const captured = { rows: [], html: [] };
function renderTableData(id, rows, fmt) { captured.tableId = id; captured.rows = rows; captured.html = rows.map((r,i) => { try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } }); }
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }
const mod = new Module("refining-no-data-row-render-test");
mod._compile(
  sandbox +
    loadFile("js/route-cell.js") +
    loadFile("js/focus-play.js") +
    loadFile("js/refining-chain-recipes.js") +
    loadFile("js/refining-chain-pricing.js") +
    loadFile("js/refining-route.js") + loadFile("js/render-transport.js") +
    "\nmodule.exports = { renderTransportTable, captured };",
  "render-transport.js",
);
const { renderTransportTable, captured } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log(`  PASS: ${name}`); passed++; } catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; } }

console.log("renderTransportTable × no-data raw\n");

// Market WITHOUT the raw (T8_WOOD) but WITH a priced secondary + sell — the
// exact "8.4 planks" shape: logs have no data, planks are priced.
const noRawMarket = {
  T7_PLANKS: { "Fort Sterling": { buy_price: 949999, sell_price: 950500, volume_24h: 9999 } },
  T8_PLANKS: { "Fort Sterling": { buy_price: 1, sell_price: 1200000, volume_24h: 9999 } },
};

test("no-data raw → every route row is margin -1 (n/a)", () => {
  renderTransportTable(noRawMarket);
  assert.ok(captured.rows.length > 0, "expected at least one route row");
  for (const r of captured.rows) {
    assert.strictEqual(r.marginInfo.margin, -1,
      `row for ${r.route.refinedId} @ ${r.refineCity} should be n/a, got ${r.marginInfo.margin}`);
  }
});

test("no-data raw → profit cells render the dash, NOT a computed % or silver", () => {
  renderTransportTable(noRawMarket);
  const html = captured.html.join("\n");
  assert.ok(!html.includes("PROFITPCT"),
    "profit % cell must be replaced by the n/a dash (no profitTd output)");
  assert.ok(!/class='PUREPROFIT'>\d/.test(html),
    "pure-profit cell must not show a silver number");
  assert.ok(html.includes("—"), "n/a dash must be present in the profit columns");
});

test("no-data raw → raw still renders an editable 'no data' span (clickable to fix)", () => {
  renderTransportTable(noRawMarket);
  const html = captured.html.join("\n");
  assert.ok(html.includes("data-item-id='T8_WOOD'"), "raw mat span present");
  assert.ok(html.includes("no data"), "raw shows 'no data' so the user can click to set it");
});

// Control: price the raw too — the gate must NOT trigger; a real profit shows.
const fullMarket = {
  T8_WOOD: { "Fort Sterling": { buy_price: 1500, sell_price: 1600, volume_24h: 9999 } },
  T7_PLANKS: { "Fort Sterling": { buy_price: 3000, sell_price: 3100, volume_24h: 9999 } },
  T8_PLANKS: { "Fort Sterling": { buy_price: 1, sell_price: 1200000, volume_24h: 9999 } },
};

test("fully priced → gate does NOT trigger; profit % cell is rendered", () => {
  renderTransportTable(fullMarket);
  const fsRow = captured.rows.find((r) => r.refineCity === "Fort Sterling");
  assert.ok(fsRow, "Fort Sterling (wood spec) row should exist");
  assert.notStrictEqual(fsRow.marginInfo.margin, -1, "priced route must not be n/a");
  assert.ok(Number.isFinite(fsRow.marginInfo.margin), "margin must be a finite number");
  const idx = captured.rows.indexOf(fsRow);
  assert.ok(captured.html[idx].includes("PROFITPCT"),
    "fully-priced row must render the real profit % cell");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
