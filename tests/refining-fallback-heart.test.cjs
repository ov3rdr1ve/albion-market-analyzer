/**
 * Test: the Refining-table FALLBACK path must apply a profitable faction-heart
 * substitution, just like the main path.
 *
 * Background: with market-order volume gating, a refined route whose raw has a
 * real price but thin 24h volume (< 25) is rejected by computeRefineRouteForCity
 * and rendered via renderTransportTable's fallback branch. High-enchant raws are
 * exactly the thin-volume case — and exactly where a faction heart (a cheap,
 * RRR-exempt stand-in for one expensive raw unit) is most often profitable. The
 * fallback branch used to hardcode `secHeart: null`, silently dropping the heart.
 *
 * Invariants under test:
 *   1. A thin (fallback) row with a winning heart surfaces secHeart + heartCost,
 *      and prices only the KEPT raws + heart (RRR-exempt).
 *   2. Economics depend on prices, not liquidity: a thin (fallback) row and a
 *      healthy (main-path) row with IDENTICAL prices and a heart report the SAME
 *      margin and SAME displayed buy cost.
 *   3. Pristine (.4) refines never get a heart on the fallback path either.
 *
 * Drives the REAL renderTransportTable. Run: node tests/refining-fallback-heart.test.cjs
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
let TRANSPORT_ITEMS = [];

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
function getValidBuyCitiesForRefine(refineCity) { return refineCity === "Caerleon" ? ["Caerleon"] : ROYAL_CITIES; }
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
const mod = new Module("refining-fallback-heart-test");
mod._compile(
  sandbox +
    loadFile("js/focus-play.js") +
    loadFile("js/refining-chain-recipes.js") +
    loadFile("js/refining-chain-pricing.js") +
    loadFile("js/refining-route.js") + loadFile("js/render-transport.js") +
    "\nmodule.exports = { renderTransportTable, captured, setItems: (x) => { TRANSPORT_ITEMS = x; } };",
  "render-transport.js",
);
const { renderTransportTable, captured, setItems } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log(`  PASS: ${name}`); passed++; } catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; } }

const FOREST_HEART = "T1_FACTION_FOREST_TOKEN_1";
const RAW_PRICE = 1500, SEC_PRICE = 3000, SELL_PRICE = 80000;
const RRR = 0.58 / 1.58; // Fort Sterling wood spec, no focus

// T8.{ench} planks = 5x T8 wood raw + 1x T7 planks secondary, with a cheap heart.
function suffix(ench) { return ench ? `_LEVEL${ench}@${ench}` : ""; }
function itemFor(ench) {
  const s = suffix(ench);
  return [{
    mat: `Whitewood Logs [T8.${ench}]`, rawId: `T8_WOOD${s}`, refinedId: `T8_PLANKS${s}`,
    rawRatio: 5, resourceType: "wood", secondaryMatId: `T7_PLANKS${s}`, secondaryMatCount: 1,
  }];
}
function market(ench, rawVol, heartPrice) {
  const s = suffix(ench);
  const m = {
    [`T8_WOOD${s}`]:   { "Fort Sterling": { buy_price: RAW_PRICE, sell_price: RAW_PRICE + 100, volume_24h: rawVol } },
    [`T7_PLANKS${s}`]: { "Fort Sterling": { buy_price: SEC_PRICE, sell_price: SEC_PRICE + 100, volume_24h: 9999 } },
    [`T8_PLANKS${s}`]: { "Fort Sterling": { buy_price: 1, sell_price: SELL_PRICE, volume_24h: 9999 } },
  };
  if (heartPrice != null) m[FOREST_HEART] = { "Fort Sterling": { buy_price: heartPrice, volume_24h: 9999 } };
  return m;
}
function fsRow(ench, rawVol, heartPrice) {
  setItems(itemFor(ench));
  renderTransportTable(market(ench, rawVol, heartPrice));
  const row = captured.rows.find((r) => r.refineCity === "Fort Sterling");
  assert.ok(row, "Fort Sterling (wood spec) row should exist");
  return row;
}

console.log("Refining fallback path — faction-heart substitution\n");

test("thin .3 row applies a winning heart (secHeart + RRR-exempt heartCost)", () => {
  // threshold = RAW_PRICE*(1-rrr) ≈ 949 ; heart 200 wins. rawVol 10 < 25 → fallback.
  const row = fsRow(3, 10, 200);
  assert.ok(row.secHeart && row.secHeart.id === FOREST_HEART, "heart surfaced on fallback row");
  // displayed buy cost = keptRaw(4*1500) + secondary(3000) + heart(200)
  assert.strictEqual(row.totalRawCost, 4 * RAW_PRICE + SEC_PRICE + 200);
});

test("thin (fallback) heart row equals healthy (main) heart row for identical prices", () => {
  const thin = fsRow(3, 10, 200);     // raw vol < 25 → fallback branch
  const healthy = fsRow(3, 9999, 200); // raw vol >= 25 → main path
  assert.ok(healthy.secHeart, "main-path heart applied (sanity)");
  assert.ok(Math.abs(thin.marginInfo.margin - healthy.marginInfo.margin) < 1e-6,
    `thin margin ${thin.marginInfo.margin} must equal main margin ${healthy.marginInfo.margin}`);
  assert.strictEqual(thin.totalRawCost, healthy.totalRawCost, "same displayed buy cost");
});

test("thin heart row beats the same thin row with no heart available", () => {
  const withHeart = fsRow(3, 10, 200);
  const noHeart = fsRow(3, 10, null);
  assert.strictEqual(noHeart.secHeart, null, "no heart when unpriced");
  assert.ok(withHeart.marginInfo.profit > noHeart.marginInfo.profit,
    `heart profit ${withHeart.marginInfo.profit} should beat no-heart ${noHeart.marginInfo.profit}`);
});

test("expensive heart loses on the fallback path too", () => {
  // heart 1200 > threshold ≈ 949 → loses
  const row = fsRow(3, 10, 1200);
  assert.strictEqual(row.secHeart, null, "no heart when it loses to a raw unit");
  assert.strictEqual(row.totalRawCost, 5 * RAW_PRICE + SEC_PRICE, "all 5 raws kept");
});

test("pristine .4 row never gets a heart on the fallback path", () => {
  const row = fsRow(4, 10, 200); // cheap heart, but .4 is barred
  assert.strictEqual(row.secHeart, null, "no heart at .4");
  assert.strictEqual(row.totalRawCost, 5 * RAW_PRICE + SEC_PRICE, "all 5 raws kept at .4");
});

test("heart-RRR-exempt math matches the per-term formula on the fallback path", () => {
  const row = fsRow(3, 10, 200);
  const eff = ((4 * RAW_PRICE + SEC_PRICE) * (1 - RRR) + 200) * 1.025;
  const expProfit = SELL_PRICE * (1 - 0.065) - eff;
  assert.ok(Math.abs(row.marginInfo.profit - expProfit) < 0.5,
    `profit ${row.marginInfo.profit} vs expected ${expProfit.toFixed(2)}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
