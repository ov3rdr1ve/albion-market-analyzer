/**
 * Test: the Refining / Transports table's Buy City pick pins where the route
 * buys its inputs.
 *
 * The pick used to be a DOM filter: the raw (and the market-bought secondary)
 * stayed wherever they were cheapest. User decision (2026-09-10): "if i set
 * source city lymhurst, then all mats should show from lymhurst. same applies
 * for other tables."
 *
 * Now, while a Buy City pick is active:
 *   - the raw is bought at the pick, and so is a market-bought secondary;
 *   - a refine city that cannot source from the pick (royal vs Caerleon with
 *     Black/Red Zone Routes off) has no honest row, so that section is dropped;
 *   - a pick with no listing keeps the row as n/a, its raw cell at the pick;
 *   - the sell leg is untouched;
 *   - no pick = today's cheapest-across-cities search.
 *
 * Drives the REAL render-transport.js + refining-route.js + refining chain
 * modules with a synthetic single-route catalog. No live data.
 *
 * Run: node tests/transport-city-pick-reroutes.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

globalThis.tx = globalThis.tx || ((en) => en);

const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
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
const TRANSPORT_ITEMS = [{
  mat: "Whitewood Logs [T8]", rawId: "T8_WOOD", refinedId: "T8_PLANKS",
  rawRatio: 5, resourceType: "wood", secondaryMatId: "T7_PLANKS", secondaryMatCount: 1,
}];

function isBlackRedZoneEnabled() { return false; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (buyCity === "Black Market") return false;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function isInvalidCrossRoute(a, b) {
  if (!a || !b) return true;
  const eb = b === "Black Market" ? "Caerleon" : b;
  return (a === "Caerleon") !== (eb === "Caerleon");
}
function isFocusEnabled() { return false; }
function getOrderType() { return "market"; }
function getOverridePrice() { return null; }
function getOverrideVolume() { return null; }
const _force = {};
function getCityForce(id, side) { return _force[id + "|" + side] || null; }
function setCityForce(id, side, c) { _force[id + "|" + side] = c; }
function clearForces() { Object.keys(_force).forEach((k) => delete _force[k]); }
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
function formatFocusCost(n) { return String(n); }
function getItemDisplayName(id) { return id; }
function matPriceSpan(id, city, price) { return "<span class='mat' data-item-id='"+id+"' data-city='"+(city||"")+"'>@ "+(price>0?price:"no data")+" ea</span>"; }
function resourceAliasSpan() { return ""; }
function aggregateCostTd(c, cls) { return '<td class="' + (cls || "silver-val cell-num") + '">' + (Number(c) > 0 ? c : "—") + '</td>'; }
function priceTd(p) { return "<td class='price'>"+(p>0?p:"no data")+"</td>"; }
function profitTd(mi) { return "<td class='PROFITPCT'>"+mi.margin.toFixed(2)+"%</td>"; }
function pureProfitTd(mi) { return "<td class='PUREPROFIT'>"+(mi && mi.profit)+"</td>"; }
function volTd(v) { return "<td class='vol'>"+v+"</td>"; }
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row) { return row.route.refinedId + "|" + (row.section || ""); }
// Cheapest-first, like the real js/utils.js helpers; an empty book falls back to
// the first city in the pool at price 0.
function findBestBuyCity(marketData, itemId, cities) { let best = { city: null, price: 0 }; for (const c of cities) { const p = getBuyPrice(marketData[itemId], c); if (p > 0 && (!best.city || p < best.price)) best = { city: c, price: p }; } if (!best.city) best = { city: cities[0] || null, price: 0 }; return best; }
function findBestSellCity(marketData, itemId, cities) { let best = { city: null, price: 0 }; for (const c of cities) { const p = getSellPrice(marketData[itemId], c); if (p > best.price) best = { city: c, price: p }; } if (!best.city) best = { city: cities[0] || null, price: 0 }; return best; }
function renderChainBreakdown() { return ""; }
const captured = { rows: [], html: [] };
function renderTableData(id, rows, fmt) { captured.rows = rows; captured.html = rows.map((r,i) => { try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } }); }
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }
const mod = new Module("transport-city-pick-reroutes-test");
mod._compile(
  sandbox +
    loadFile("js/table-sell-city.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/route-cell.js") +
    loadFile("js/focus-play.js") +
    loadFile("js/refining-chain-recipes.js") +
    loadFile("js/refining-chain-pricing.js") +
    loadFile("js/refining-route.js") + loadFile("js/render-transport.js") +
    "\nmodule.exports = { renderTransportTable, captured, setTableBuyCity, setTableSellCity,"
    + " clearTableSellCities, setCityForce, clearForces };",
  "render-transport.js",
);
const X = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  X.clearTableSellCities();
  X.clearForces();
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
  finally { X.clearTableSellCities(); X.clearForces(); }
}

// ── Fixture ─────────────────────────────────────────────────────────────────
// The raw (T8 logs) and the market secondary (T7 planks) are listed in every
// city, CHEAPEST IN THETFORD. T7 planks cannot be chain-refined here (no T7
// logs anywhere), so the secondary is always a market buy. T8 planks sell best
// in Fort Sterling, the wood spec city.
const ALL = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
function market(omit = []) {
  const skip = new Set(omit.map(([id, c]) => `${id}|${c}`));
  const md = {};
  const put = (id, c, b, s) => {
    if (skip.has(`${id}|${c}`)) return;
    (md[id] = md[id] || {})[c] = { buy_price: b, sell_price: s, volume_24h: 9999 };
  };
  ALL.forEach((c) => {
    const k = c === "Thetford" ? 1 : 1.1;
    put("T8_WOOD", c, Math.round(1500 * k), Math.round(1600 * k));
    put("T7_PLANKS", c, Math.round(3000 * k), Math.round(3100 * k));
    put("T8_PLANKS", c, 1, c === "Fort Sterling" ? 1200000 : 1000000);
  });
  return md;
}

function rowAt(section) {
  return captured().rows.find((r) => r.section === section) || null;
}
function captured() { return X.captured; }
function render(md) { X.renderTransportTable(md || market()); return X.captured.rows; }
const pick = (r) => ({
  refine: r.refineCity, buy: r.buyRaw.city, sec: r.secondaryMat && r.secondaryMat.city,
  sell: r.sellRefined.city, margin: r.marginInfo.margin,
});

console.log("Refining / Transports — the Buy City pick pins the input legs\n");

test("no pick: the royal row buys raw and secondary where cheapest", () => {
  render();
  const r = rowAt("royal");
  assert.ok(r, "no royal row");
  assert.strictEqual(r.buyRaw.city, "Thetford");
  assert.strictEqual(r.secondaryMat.city, "Thetford");
});

["Lymhurst", "Martlock"].forEach((city) => {
  test(`pick ${city}: the raw is bought in ${city}`, () => {
    X.setTableBuyCity("transport-table", city);
    render();
    const r = rowAt("royal");
    assert.ok(r, "the royal row must survive a royal pick");
    assert.strictEqual(r.buyRaw.city, city);
  });

  test(`pick ${city}: the market-bought secondary comes from ${city} too`, () => {
    X.setTableBuyCity("transport-table", city);
    render();
    assert.strictEqual(rowAt("royal").secondaryMat.city, city);
  });
});

test("the buy pick leaves the sell leg alone", () => {
  X.setTableBuyCity("transport-table", "Martlock");
  render();
  assert.strictEqual(rowAt("royal").sellRefined.city, "Fort Sterling");
});

test("the pick outranks a per-item raw buy pin", () => {
  X.setCityForce("T8_WOOD", "buy", "Thetford");
  X.setTableBuyCity("transport-table", "Martlock");
  render();
  assert.strictEqual(rowAt("royal").buyRaw.city, "Martlock");
});

test("a pick the refine city cannot source from drops that section", () => {
  X.setTableBuyCity("transport-table", "Caerleon");
  const rows = render();
  assert.strictEqual(rows.filter((r) => r && r.section === "royal").length, 0,
    "no royal refine city can buy in Caerleon");
  const caer = rowAt("caerleon");
  assert.ok(caer, "the Caerleon row still routes");
  assert.strictEqual(caer.buyRaw.city, "Caerleon");
});

test("a pick with no raw listing keeps the row as n/a, its raw at the pick", () => {
  X.setTableBuyCity("transport-table", "Brecilien");
  render(market([["T8_WOOD", "Brecilien"]]));
  const r = rowAt("royal");
  assert.ok(r, "the row stays on the table, editable");
  assert.strictEqual(r.marginInfo.margin, -1);
  assert.strictEqual(r.buyRaw.city, "Brecilien", "never quietly sourced in Thetford");
});

test("clearing the pick restores today's rows exactly", () => {
  const before = render().map(pick);
  X.setTableBuyCity("transport-table", "Lymhurst");
  render();
  X.clearTableSellCities();
  assert.deepStrictEqual(render().map(pick), before);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
