/**
 * Test: the Refining-table FALLBACK margin must not double-count the secondary
 * mat (nor the setup fee).
 *
 * Background: with market-order volume gating, a refined route whose raw has a
 * real price but thin volume (< 25/24h) is rejected by computeRefineRouteForCity
 * and rendered via renderTransportTable's fallback branch. That branch built its
 * cost as raw*(1+fee) + sec*(1+fee) and then passed BOTH that sum (as buyCost)
 * AND sec*(1+fee) again (as the secondaryMatCost arg) to calculateTransportMargin
 * — which itself applies (1-rrr) and (1+SETUP_FEE) once to (buyCost + secCost).
 * Net: the secondary was charged twice and the setup fee twice, understating the
 * margin. The main path passes raw-only and secondary-only GROSS costs.
 *
 * Invariant under test: economics depend on prices, not on liquidity. A thin
 * (fallback) route and a healthy (main-path) route with IDENTICAL prices must
 * report the SAME margin, the SAME silver/focus, and the SAME displayed buy cost
 * (= raw + secondary gross, no setup fee). Drives the REAL renderTransportTable.
 *
 * Run: node tests/refining-fallback-margin-no-double-count.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

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
// T8 planks = 5x T8 wood (raw) + 1x T7 planks (secondary).
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
function getOrderType() { return "market"; } // MIN_VOLUME = 25 → thin raw routes to fallback
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
function getItemDisplayName(id) { return id; }
function matPriceSpan(id, city, price) { return "<span data-item-id='"+id+"'>@ "+(price>0?price:"no data")+" ea</span>"; }
function priceTd(p) { return "<td>"+(p>0?p:"no data")+"</td>"; }
function profitTd(mi) { return "<td>"+mi.margin.toFixed(2)+"%</td>"; }
function pureProfitTd(mi) { const pr = mi && mi.profit; return "<td>"+(pr==null?"dash":pr)+"</td>"; }
function volTd(v) { return "<td>"+v+"</td>"; }
function getRowKey(row) { return row.route.refinedId + "|" + (row.section || ""); }
function findBestBuyCity(marketData, itemId, cities) { let best = { city: null, price: 0 }; for (const c of cities) { const p = getBuyPrice(marketData[itemId], c); if (p > best.price) best = { city: c, price: p }; } if (!best.city) best = { city: cities[0] || null, price: 0 }; return best; }
function findBestSellCity(marketData, itemId, cities) { let best = { city: null, price: 0 }; for (const c of cities) { const p = getSellPrice(marketData[itemId], c); if (p > best.price) best = { city: c, price: p }; } if (!best.city) best = { city: cities[0] || null, price: 0 }; return best; }
function renderChainBreakdown() { return ""; }
const captured = { rows: [] };
function renderTableData(id, rows, fmt) { captured.rows = rows; rows.forEach((r,i) => { try { fmt(r,i); } catch(e){} }); }
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }
const mod = new Module("refining-fallback-margin-test");
mod._compile(
  sandbox +
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

// Same prices in both; only the RAW's 24h volume differs. Lower tiers are left
// unpriced so the secondary resolves to a plain market buy (no chain) in both.
const RAW_PRICE = 1500, SEC_PRICE = 3000, SELL_PRICE = 50000;
function market(rawVol) {
  return {
    T8_WOOD:   { "Fort Sterling": { buy_price: RAW_PRICE, sell_price: RAW_PRICE + 100, volume_24h: rawVol } },
    T7_PLANKS: { "Fort Sterling": { buy_price: SEC_PRICE, sell_price: SEC_PRICE + 100, volume_24h: 9999 } },
    T8_PLANKS: { "Fort Sterling": { buy_price: 1, sell_price: SELL_PRICE, volume_24h: 9999 } },
  };
}

function fsRow(marketData) {
  renderTransportTable(marketData);
  const row = captured.rows.find((r) => r.refineCity === "Fort Sterling");
  assert.ok(row, "Fort Sterling (wood spec) row should exist");
  return row;
}

console.log("Refining fallback margin — no double-count\n");

const thin = fsRow(market(10));     // raw vol < 25 → fallback branch
const healthy = fsRow(market(9999)); // raw vol >= 25 → main path

test("fallback margin equals main-path margin for identical prices", () => {
  assert.ok(Number.isFinite(thin.marginInfo.margin), "thin margin must be finite");
  assert.ok(Number.isFinite(healthy.marginInfo.margin), "healthy margin must be finite");
  assert.ok(Math.abs(thin.marginInfo.margin - healthy.marginInfo.margin) < 1e-6,
    `thin (fallback) margin ${thin.marginInfo.margin} must equal main-path margin ${healthy.marginInfo.margin}`);
});

test("fallback profit equals main-path profit", () => {
  assert.ok(Math.abs(thin.marginInfo.profit - healthy.marginInfo.profit) < 1e-6,
    `thin profit ${thin.marginInfo.profit} must equal main profit ${healthy.marginInfo.profit}`);
});

test("fallback silver/focus equals main-path silver/focus", () => {
  assert.ok(Math.abs(thin.profitPerFocus - healthy.profitPerFocus) < 1e-6,
    `thin s/f ${thin.profitPerFocus} must equal main s/f ${healthy.profitPerFocus}`);
});

test("displayed buy cost is gross raw + secondary (no setup fee), matching main path", () => {
  const expectedGross = 5 * RAW_PRICE + 1 * SEC_PRICE; // 7500 + 3000
  assert.strictEqual(thin.totalRawCost, expectedGross,
    `fallback totalRawCost should be ${expectedGross}, got ${thin.totalRawCost}`);
  assert.strictEqual(healthy.totalRawCost, expectedGross,
    `main totalRawCost should be ${expectedGross}, got ${healthy.totalRawCost}`);
});

test("margin matches the single-count hand calculation", () => {
  const rrr = 0.58 / 1.58;
  const eff = (5 * RAW_PRICE + 1 * SEC_PRICE) * (1 - rrr) * (1 + 0.025);
  const expectedMargin = (SELL_PRICE * (1 - 0.065) - eff) / eff * 100;
  assert.ok(Math.abs(thin.marginInfo.margin - expectedMargin) < 1e-6,
    `fallback margin ${thin.marginInfo.margin} should match single-count ${expectedMargin}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
