/**
 * Test: Transmute "Daily Vol" bottleneck reads the two ACTUAL traded legs —
 * buy the SOURCE at buyCity, sell the TARGET at sellCity.
 *
 * Regression: the renderer used getMinVol(targetId, buyCity, sellCity), i.e. the
 * end product's volume at BOTH cities. targetId@buyCity is ~0 (nobody sells the
 * transmuted product at the source-buy city), so Daily Vol collapsed to a
 * spurious small/zero number that disagreed with the Sell Price column's own
 * volume badge (targetId@sellCity). The fix uses getMinVol2(sourceId, buyCity,
 * targetId, sellCity).
 *
 * Black-box: capture the getMinVol2 call args and assert item/city per leg.
 *
 * Run: node tests/transmute-daily-vol-legs.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const captured = { minVolCalls: [] };
const stubs = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const SETUP_FEE = 0.025, PREMIUM_TAX = 0.04, MAX_MARGIN_PERCENT = 100000;
function getOrderType(){ return "buy"; }
function isBlackRedZoneEnabled(){ return true; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function isSuspectMargin(m){ return Number.isFinite(m) && m > MAX_MARGIN_PERCENT; }
function suspectMarginBadge(){ return ""; }
function getIQRBounds(){ return null; }
function calcStationFeeSilver(){ return 0; }
function getBuyPrice(data, city){ return data && data[city] ? (data[city].buy || 0) : 0; }
function getSellPrice(data, city){ return data && data[city] ? (data[city].sell || 0) : 0; }
function getCityForce(){ return null; }
function getOverridePrice(){ return null; }
function isInvalidCrossRoute(){ return false; }
function getMinVol(){ return 123; }
function getMinVol2(md, id1, c1, id2, c2){
  __cap.minVolCalls.push({ id1, c1, id2, c2 });
  const v1 = md[id1] && md[id1][c1] ? (md[id1][c1].volume_24h || 0) : 0;
  const v2 = md[id2] && md[id2][c2] ? (md[id2][c2].volume_24h || 0) : 0;
  return Math.min(v1, v2);
}
function formatSilver(n){ return String(n); }
function getItemDisplayName(id){ const s = resourceShortName(id); return s || id; }
function matPriceSpan(id, city, price){ return "<span>@ "+price+"</span>"; }
function resourceAliasSpan(){ return ""; }
function priceTd(p){ return "<td>"+p+"</td>"; }
function profitTd(mi){ return "<td>"+(mi&&mi.profit)+"</td>"; }
function pureProfitTd(mi){ return "<td>"+(mi&&mi.profit)+"</td>"; }
function volTd(v){ return "<td class='vol'>"+v+"</td>"; }
function getRowKey(row){ return row.tier + "|" + (row.transition && row.transition.label) + "|" + row.section; }
const __cap = { rows: [] };
function renderTableData(id, rows, fmt){ __cap.rows = rows; rows.forEach((r,i)=>{ try{ fmt(r,i); }catch(e){} }); }
`;

const sources = J("resource-names.js") + J("data-transmute.js") + J("render-transmute.js");
const mod = new Module("transmute-vol");
mod._compile(
  stubs.replace(/__cap/g, "GLOBAL_CAP") +
    sources +
    "\nmodule.exports = { renderTransmuteTable, GLOBAL_CAP };",
  "transmute-vol.js",
);
const { renderTransmuteTable, GLOBAL_CAP } = mod.exports;
GLOBAL_CAP.minVolCalls = captured.minVolCalls;

// T4 ore (source) liquid at buy city, T5 ore (target) thin at sell city. The
// target has NO listing at the buy city — the old code would have read 0 there.
const marketData = {
  T4_ORE: { Caerleon: { buy: 100, volume_24h: 9000 } },
  T5_ORE: { Caerleon: { sell: 2000, volume_24h: 55 } },
};

renderTransmuteTable(marketData);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Transmute daily-vol legs\n");

const oreCall = captured.minVolCalls.find(
  (c) => c.id1 === "T4_ORE" && c.id2 === "T5_ORE",
);

test("buy leg reads SOURCE id, sell leg reads TARGET id (not target twice)", () => {
  assert.ok(oreCall, "no getMinVol2 call for the T4_ORE→T5_ORE row");
  assert.notStrictEqual(oreCall.id1, oreCall.id2, "both legs used the same id");
});

test("legs pair source@buyCity and target@sellCity", () => {
  assert.strictEqual(oreCall.id1, "T4_ORE");
  assert.strictEqual(oreCall.id2, "T5_ORE");
  assert.strictEqual(oreCall.c1, "Caerleon");
  assert.strictEqual(oreCall.c2, "Caerleon");
});

test("Daily Vol = min(source buy vol, target sell vol) = 55, not 0", () => {
  const row = GLOBAL_CAP.rows.find((r) => r.transition && r.tier === 4);
  assert.ok(row, "T4 ore row missing");
  assert.strictEqual(row.dailyVol, 55);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
