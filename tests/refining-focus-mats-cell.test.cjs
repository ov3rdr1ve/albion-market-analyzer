/**
 * Test: the Refining / Transports "10k Focus Mats" cell is a shopping list for
 * the route the row actually shows, and the per-10k columns count OUTPUTS.
 *
 * Two rendering bugs, both downstream of the one-tier focus fix
 * (tests/refining-chain-single-tier-focus):
 *
 *  1. The cell printed "1,283x T7 hide / 557x T6 leather" — telling the user to
 *     BUY the T6 leather — while the same row's material tree said "1x T6 leather
 *     (via chain)", i.e. refine it. A chain-produced intermediate is never a buy;
 *     the ladder's market leaves are.
 *  2. "Profit / 10k Focus" multiplied a per-OUTPUT profit by floor(10k/focusCost)
 *     REFINES. Those are the same number only when the focus sits on the ladder's
 *     top step. When a lower rung wins, one output costs less than one refine at
 *     that rung, so the bar yields more outputs than refines.
 *
 * Drives the REAL renderTransportTable over a synthetic hide catalog and reads
 * the emitted cells. Market helpers are stubbed — no live data.
 *
 * Run: node tests/refining-focus-mats-cell.test.cjs
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
const BLACK_ZONE_CITIES = ["Smugglers Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SETUP_FEE = 0.025;
const PREMIUM_TAX = 0.065;
const BASE_CITY_BONUS = 0.18;
const REFINE_SPEC_BONUS = 0.40;
const FOCUS_BONUS = 0.59;
const OX_CAPACITY_KG = 1500;
const CITY_REFINE_SPEC = { "Fort Sterling": "wood", Lymhurst: "fiber", Bridgewatch: "rock", Thetford: "ore", Martlock: "hide" };
const RESOURCE_DEFS = [
  { type: "hide", raw: "HIDE", refined: "LEATHER",
    tiers: [[2,"","",1],[3,"","",2],[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];
const TRANSPORT_ITEMS = [{
  mat: "Leather [T7]", rawId: "T7_HIDE", refinedId: "T7_LEATHER",
  rawRatio: 5, resourceType: "hide", secondaryMatId: "T6_LEATHER", secondaryMatCount: 1,
}];

function isBlackRedZoneEnabled() { return false; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function isFocusEnabled() { return true; }
function getOrderType() { return "instant"; }
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
function getTierFromId(id) { const m = String(id).match(/T(\\d+)/); return m ? parseInt(m[1],10) : 0; }
function getResourceWeightKg(tier) { return 0.1 * Math.pow(1.5, tier); }
function getMinVol() { return 0; }
function getMinVol2() { return 0; }
function matsNeededFor10kFocus(focusCost, per, applyRrr, rrr) { const c = Math.floor(10000/focusCost); const e = applyRrr ? per*(1-(rrr||0)) : per; return Math.round(c*e); }
function calculateTransportMargin(buyCost, sellPrice, rrr=0, sec=0, station=0, travel=0, nonRet=0, exempt=0) {
  if (!buyCost || !sellPrice) return { profit: 0, margin: 0 };
  const eff = ((buyCost + sec - exempt) * (1 - rrr) + nonRet) * (1 + SETUP_FEE) + exempt * (1 - rrr) + station + travel;
  const rev = sellPrice * (1 - PREMIUM_TAX);
  return { profit: rev - eff, margin: (rev - eff) / eff * 100 };
}
function calculateOxLoad(profit, weight) { if (!weight || weight <= 0) return { itemsPerLoad: 0, profitPerLoad: 0 }; const n = Math.floor(OX_CAPACITY_KG/weight); return { itemsPerLoad: n, profitPerLoad: profit * n }; }
const FOCUS_BAR = 10000;
function calculateProfitPer10kFocus(profit, focusCost, actionsPerOutput = 1) {
  if (!focusCost || focusCost <= 0) return 0;
  if (!(actionsPerOutput > 0)) return 0;
  return profit * (Math.floor(FOCUS_BAR / focusCost) / actionsPerOutput);
}
function calculateProfitPerFocus(p, f) { if (!f || f <= 0) return 0; return p / f; }
function formatSilver(n) { if (n === null || n === undefined) return "N/A"; return Math.round(n).toLocaleString(); }
function formatFocusCost(n) { if (n == null || !Number.isFinite(n)) return "N/A"; const a = Math.abs(n); if (a >= 100) return Math.round(n).toLocaleString(); return String(Number(n.toFixed(a >= 10 ? 1 : 2))); }
function getItemDisplayName(id) { return id; }
function matPriceSpan(id, city, price) { return "<span class='mat' data-item-id='"+id+"'>@ "+(price>0?price:"no data")+" ea</span>"; }
function resourceAliasSpan() { return ""; }
function aggregateCostTd(c, cls) { return '<td class="' + (cls || "silver-val cell-num") + '">' + (Number(c) > 0 ? c : "—") + '</td>'; }
function priceTd(p) { return "<td class='price'>"+(p>0?p:"no data")+"</td>"; }
function profitTd(mi) { return "<td class='PROFITPCT'>"+mi.margin.toFixed(2)+"%</td>"; }
function pureProfitTd(mi) { const pr = mi && mi.profit; if (pr===undefined||pr===null) return "<td class='PUREPROFIT'>dash</td>"; return "<td class='PUREPROFIT'>"+pr+"</td>"; }
function volTd(v) { return "<td class='vol'>"+v+"</td>"; }
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row) { return row.route.refinedId + "|" + (row.section || ""); }
function findBestBuyCity(marketData, itemId, cities) { let best = { city: null, price: 0 }; for (const c of cities) { const p = getBuyPrice(marketData[itemId], c); if (p > best.price) best = { city: c, price: p }; } if (!best.city) best = { city: cities[0] || null, price: 0 }; return best; }
function findBestSellCity(marketData, itemId, cities) { let best = { city: null, price: 0 }; for (const c of cities) { const p = getSellPrice(marketData[itemId], c); if (p > best.price) best = { city: c, price: p }; } if (!best.city) best = { city: cities[0] || null, price: 0 }; return best; }
function renderChainBreakdown() { return ""; }
const captured = { rows: [], html: [] };
function renderTableData(id, rows, fmt) { captured.tableId = id; captured.rows = rows; captured.html = rows.map((r,i) => { try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } }); }
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }
const mod = new Module("refining-focus-mats-cell-test");
mod._compile(
  sandbox +
    loadFile("js/route-cell.js") +
    loadFile("js/focus-play.js") +
    loadFile("js/refining-chain-recipes.js") +
    loadFile("js/refining-chain-pricing.js") +
    loadFile("js/refining-chain-focus.js") +
    loadFile("js/refining-route.js") +
    loadFile("js/render-transport.js") +
    "\nmodule.exports = { renderTransportTable, captured };",
  "render-transport.js",
);
const { renderTransportTable, captured } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const CITIES_T = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock",
  "Bridgewatch", "Brecilien"];

function market(prices) {
  const md = {};
  Object.entries(prices).forEach(([id, [buy, sell]]) => {
    md[id] = {};
    CITIES_T.forEach((c) => { md[id][c] = { buy_price: buy, sell_price: sell, volume_24h: 9999 }; });
  });
  return md;
}

// Ladder market: no leather bar is listed below T7, so every rung chains.
const LADDER = market({
  T7_HIDE: [3118, 3119], T6_HIDE: [1327, 1328], T5_HIDE: [503, 504],
  T4_HIDE: [45, 46], T3_HIDE: [90, 91], T2_HIDE: [30, 31],
  T7_LEATHER: [0, 18052],
});

// Same, but the T6 bar is listed cheap enough to buy outright.
const BOUGHT_BAR = market({
  T7_HIDE: [3118, 3119], T6_HIDE: [1327, 1328], T5_HIDE: [503, 504],
  T4_HIDE: [45, 46], T3_HIDE: [90, 91], T2_HIDE: [30, 31],
  T6_LEATHER: [2500, 2501],
  T7_LEATHER: [0, 18052],
});


function render(md) {
  renderTransportTable(md);
  const i = captured.rows.findIndex((r) => r.route.refinedId === "T7_LEATHER");
  assert.ok(i >= 0, "the T7 leather row must render");
  return { row: captured.rows[i], html: captured.html[i] };
}

// The 10k Focus Mats cell.
function matsCell(html) {
  const m = html.match(/<td class="cell-focus-mats">([\s\S]*?)<\/td>/);
  assert.ok(m, "the focus-mats cell must be present");
  return m[1];
}
function listedIds(cell) {
  return [...cell.matchAll(/\d[\d,]*x (T\d+_[A-Z]+)/g)].map((m) => m[1]);
}

console.log("\n=== 10k Focus Mats lists what the route BUYS ===");

test("A chain row lists the ladder's raws, never a bar the ladder refines", () => {
  const { row, html } = render(LADDER);
  assert.ok(row.secondaryChain, "fixture must chain");
  const ids = listedIds(matsCell(html));
  assert.deepStrictEqual(
    ids, ["T7_HIDE", "T6_HIDE", "T5_HIDE", "T4_HIDE", "T3_HIDE", "T2_HIDE"],
    "every rung's raw, highest tier first",
  );
  assert.ok(!ids.some((id) => id.endsWith("_LEATHER")),
    "a chain-refined bar is produced, so it can never appear on the shopping list");
});

test("A market-secondary row lists exactly the raw and that bar", () => {
  const { row, html } = render(BOUGHT_BAR);
  assert.strictEqual(row.secondaryChain, null, "fixture must buy the T6 bar");
  assert.deepStrictEqual(listedIds(matsCell(html)), ["T7_HIDE", "T6_LEATHER"]);
});

test("The refines-per-bar footnote survives on both", () => {
  [LADDER, BOUGHT_BAR].forEach((md) => {
    const cell = matsCell(render(md).html);
    assert.ok(/\d[\d,]*x refines @ [\d.,]+ focus ea/.test(cell), cell);
  });
});

test("focusMats (the sort key) is the sum of the listed units", () => {
  const { row, html } = render(LADDER);
  const units = [...matsCell(html).matchAll(/([\d,]+)x T\d+_/g)]
    .reduce((n, m) => n + Number(m[1].replace(/,/g, "")), 0);
  assert.strictEqual(row.focusMats, units);
});

console.log("\n=== Per-10k columns count OUTPUTS, not refine actions ===");

test("Top-tier focus: outputs === refines, so the plain formula still holds", () => {
  const { row } = render(LADDER);
  assert.strictEqual(row.focusBestTier, 7, "fixture focuses the row's own refine");
  assert.strictEqual(row.refinesPerOutput, 1);
  assert.ok(Math.abs(row.profitPer10kFocus
    - row.profitFocusOn * Math.floor(10000 / row.focusCost)) < 1e-6);
});

// Whichever rung takes the focus, the saving propagates up through the rungs
// above it at base RRR — so focusing T7 saves everything focusing T6 would, PLUS
// the return on the row's own raw. The row's own refine therefore wins by
// construction whenever its raw costs anything, at any price ratio. The
// refines-per-output divisor exists so the arithmetic stays right if that ever
// stops being true (e.g. an RRR-exempt leg at the root); it is not dead weight,
// but on today's model it is always 1.
[
  { name: "dear raw, cheap ladder", px: { T7_HIDE: 9000, T6_HIDE: 10 } },
  { name: "cheap raw, dear ladder", px: { T7_HIDE: 1, T6_HIDE: 9000 } },
  { name: "flat ladder", px: { T7_HIDE: 500, T6_HIDE: 500 } },
].forEach(({ name, px }) => {
  test(`Row's own refine takes the focus (${name}) — outputs === refines`, () => {
    const md = market({
      T7_HIDE: [px.T7_HIDE, px.T7_HIDE + 1], T6_HIDE: [px.T6_HIDE, px.T6_HIDE + 1],
      T5_HIDE: [10, 11], T4_HIDE: [10, 11], T3_HIDE: [10, 11], T2_HIDE: [10, 11],
      T7_LEATHER: [0, 200000],
    });
    const { row, html } = render(md);
    assert.ok(row.secondaryChain, "fixture must chain");
    assert.strictEqual(row.focusBestTier, 7);
    assert.strictEqual(row.refinesPerOutput, 1);
    assert.ok(!/\[Focus@T\d+\]/.test(html), "no badge when the focus is on the row's own tier");
    assert.ok(Math.abs(row.profitPer10kFocus
      - row.profitFocusOn * Math.floor(10000 / row.focusCost)) < 1e-6);
  });
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
