/**
 * Regression test: the Daily Vol for a refining row must bottleneck on the
 * REFINED good's volume at the SELL city — not the raw's volume there.
 *
 * Reported bug: "volumes available for selling T8 leather, but selecting a sell
 * city shows no volume in the sell column". Cause: render-transport read
 * getMinVol(rawId, buyCity, sellCity) — the sell leg used rawId, so it reported
 * raw-hide liquidity at the sell city and ignored the refined leather's volume
 * (and any sell-city override stored under refinedId). Fixed by getMinVol2,
 * which reads rawId@buyCity and refinedId@sellCity independently.
 *
 * Drives the REAL render-transport.js with real getMinVol/getMinVol2 (not the
 * 0-stub used by other render tests) so dailyVol reflects the true bottleneck.
 *
 * Run: node tests/transport-sell-vol-refined.test.cjs
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
const MIN_VOLUME = 25;
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
// REAL volume helpers (override-aware), mirroring js/utils.js — the point of
// this test is to exercise the real bottleneck logic, not stub it to 0.
function getMinVol(marketData, itemId, c1, c2) {
  const v1 = getOverrideVolume(itemId, c1) ?? (marketData[itemId]?.[c1]?.volume_24h || 0);
  const v2 = getOverrideVolume(itemId, c2) ?? (marketData[itemId]?.[c2]?.volume_24h || 0);
  return Math.min(v1, v2);
}
function getMinVol2(marketData, id1, c1, id2, c2) {
  const v1 = getOverrideVolume(id1, c1) ?? (marketData[id1]?.[c1]?.volume_24h || 0);
  const v2 = getOverrideVolume(id2, c2) ?? (marketData[id2]?.[c2]?.volume_24h || 0);
  return Math.min(v1, v2);
}
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
function matPriceSpan(id, city, price) { return "<span class='mat'>@ "+(price>0?price:"no data")+" ea</span>"; }
function resourceAliasSpan() { return ""; }
function priceTd(p) { return "<td class='price'>"+(p>0?p:"no data")+"</td>"; }
function profitTd(mi) { return "<td class='PROFITPCT'>"+mi.margin.toFixed(2)+"%</td>"; }
function pureProfitTd(mi) { const pr = mi && mi.profit; if (pr===undefined||pr===null) return "<td>dash</td>"; return "<td>"+pr+"</td>"; }
function getRowKey(row) { return row.route.refinedId + "|" + (row.section || ""); }
function findBestBuyCity(marketData, itemId, cities) { let best = { city: null, price: 0 }; for (const c of cities) { const p = getBuyPrice(marketData[itemId], c); if (p > best.price) best = { city: c, price: p }; } if (!best.city) best = { city: cities[0] || null, price: 0 }; return best; }
function findBestSellCity(marketData, itemId, cities) { let best = { city: null, price: 0 }; for (const c of cities) { const p = getSellPrice(marketData[itemId], c); if (p > best.price) best = { city: c, price: p }; } if (!best.city) best = { city: cities[0] || null, price: 0 }; return best; }
function renderChainBreakdown() { return ""; }
const captured = { rows: [] };
function renderTableData(id, rows, fmt) { captured.rows = rows; rows.forEach((r,i) => { try { fmt(r,i); } catch(e){} }); }
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }
const mod = new Module("transport-sell-vol-refined-test");
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

console.log("renderTransportTable × sell-leg volume uses the refined good\n");

// Buy raw + refine + sell all at Fort Sterling (the reported single-city shape).
// Raw wood has HIGH volume at FS; refined planks have LOW volume at FS. The
// Daily Vol must bottleneck on the refined good (500), not the raw (90000).
function marketWith(refinedSellVol) {
  return {
    T8_WOOD:   { "Fort Sterling": { buy_price: 1500, sell_price: 1600, volume_24h: 90000 } },
    T7_PLANKS: { "Fort Sterling": { buy_price: 3000, sell_price: 3100, volume_24h: 90000 } },
    T8_PLANKS: { "Fort Sterling": { buy_price: 1, sell_price: 1200000, volume_24h: refinedSellVol } },
  };
}

test("Daily Vol bottlenecks on the refined good's sell volume, not the raw's", () => {
  renderTransportTable(marketWith(500));
  const row = captured.rows.find((r) => r.refineCity === "Fort Sterling");
  assert.ok(row, "Fort Sterling refine row should exist");
  assert.strictEqual(row.sellRefined.city, "Fort Sterling");
  assert.strictEqual(row.dailyVol, 500,
    `expected refined sell volume (500), got ${row.dailyVol} — the sell leg is reading rawId again`);
});

test("raw volume caps it when the raw is the thinner leg", () => {
  const md = marketWith(90000);
  md.T8_WOOD["Fort Sterling"].volume_24h = 300; // now the raw is the bottleneck
  renderTransportTable(md);
  const row = captured.rows.find((r) => r.refineCity === "Fort Sterling");
  assert.strictEqual(row.dailyVol, 300, `expected raw buy volume (300), got ${row.dailyVol}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
