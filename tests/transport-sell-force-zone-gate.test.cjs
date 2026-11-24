/**
 * Test: the refining/transport table renders each item in a Caerleon-refine
 * section AND a royal-refine section, but the refined-good sell-city force is a
 * single global per (itemId, side). computeRefineRouteForCity must gate that
 * force by zone reachability — exactly like its own buy-side gate and its
 * fallback-path sell gate.
 *
 * Bug: the MAIN sell loop used `forcedSellCity ? [forcedSellCity] : CITIES`
 * with no reachability check (unlike the buy side at :143 and the fallback at
 * :400). A royal sell forced from the royal row was therefore seen by the
 * Caerleon row, found unreachable inside the loop, and collapsed the Caerleon
 * main route to null — dropping into the fallback path and silently losing heart
 * substitution. Mirrors the crafting-table sell-force bug
 * (tests/crafting-sell-force-zone-gate).
 *
 * Fix: gate with isInvalidCrossRoute(refineCity, forced); ignore + full-search
 * when unreachable. Black-box at the function boundary: a cross-zone force must
 * NOT turn the other section's main route into null.
 *
 * Run: node tests/transport-sell-force-zone-gate.test.cjs
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
const TRANSPORT_ITEMS = [{
  mat: "Whitewood Logs [T8]", rawId: "T8_WOOD", refinedId: "T8_PLANKS",
  rawRatio: 5, resourceType: "wood", secondaryMatId: "T7_PLANKS", secondaryMatCount: 1,
}];

function isBlackRedZoneEnabled() { return false; }   // BMR off → royal/Caerleon split
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

// Controllable sell-city force (the thing under test).
let _force = {};
function __setSellForce(itemId, city) { _force[itemId] = { sell: city }; }
function __clearForce() { _force = {}; }
function getCityForce(itemId, side) { return _force[itemId]?.[side] ?? null; }

// REAL zone rule (mirrors utils.js:isInvalidCrossRoute, BMR off, no Black Market here).
function isInvalidCrossRoute(buyCity, sellCity) {
  if (!buyCity || !sellCity) return true;
  if (isBlackRedZoneEnabled()) return false;
  const buyIsRoyal = ROYAL_CITIES.includes(buyCity);
  const sellIsRoyal = ROYAL_CITIES.includes(sellCity);
  if (buyIsRoyal && sellCity === "Caerleon") return true;
  if (buyCity === "Caerleon" && sellIsRoyal) return true;
  return false;
}

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
function getItemDisplayName(id) { return id; }
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }
const mod = new Module("transport-sell-force-zone-gate-test");
mod._compile(
  sandbox +
    loadFile("js/refining-chain-recipes.js") +
    loadFile("js/refining-chain-pricing.js") +
    loadFile("js/refining-route.js") + loadFile("js/render-transport.js") +
    "\nmodule.exports = { computeRefineRouteForCity, __setSellForce, __clearForce };",
  "render-transport.js",
);
const { computeRefineRouteForCity, __setSellForce, __clearForce } = mod.exports;

const ROUTE = {
  mat: "Whitewood Logs [T8]", rawId: "T8_WOOD", refinedId: "T8_PLANKS",
  rawRatio: 5, resourceType: "wood", secondaryMatId: "T7_PLANKS", secondaryMatCount: 1,
};

// Raw + secondary priced in BOTH zones so each section can produce a real route.
// Refined good sells in Caerleon AND royal cities (best royal = Fort Sterling).
const market = {
  T8_WOOD: {
    Caerleon:       { buy_price: 1500, sell_price: 1600, volume_24h: 9999 },
    "Fort Sterling":{ buy_price: 1500, sell_price: 1600, volume_24h: 9999 },
    Lymhurst:       { buy_price: 1500, sell_price: 1600, volume_24h: 9999 },
  },
  T7_PLANKS: {
    Caerleon:       { buy_price: 3000, sell_price: 3100, volume_24h: 9999 },
    "Fort Sterling":{ buy_price: 3000, sell_price: 3100, volume_24h: 9999 },
    Lymhurst:       { buy_price: 3000, sell_price: 3100, volume_24h: 9999 },
  },
  T8_PLANKS: {
    Caerleon:       { buy_price: 1, sell_price: 1200000, volume_24h: 9999 },
    "Fort Sterling":{ buy_price: 1, sell_price: 1300000, volume_24h: 9999 },
    Lymhurst:       { buy_price: 1, sell_price: 1100000, volume_24h: 9999 },
  },
};

const route = (rc) => computeRefineRouteForCity(rc, ROUTE, market, "market");

let passed = 0, failed = 0;
function test(name, fn) {
  __clearForce();
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Transport sell-force zone gate tests\n");

test("baseline: no force — Caerleon refine sells at Caerleon (reachable)", () => {
  const r = route("Caerleon");
  assert.ok(r, "Caerleon route must resolve");
  assert.strictEqual(r.sellCity, "Caerleon");
});

test("baseline: no force — royal refine sells at best reachable royal (Fort Sterling)", () => {
  const r = route("Fort Sterling");
  assert.ok(r, "royal route must resolve");
  assert.strictEqual(r.sellCity, "Fort Sterling");
});

test("royal sell force is HONOURED by the royal section", () => {
  __setSellForce("T8_PLANKS", "Lymhurst");
  const r = route("Fort Sterling");
  assert.ok(r, "royal route must resolve");
  assert.strictEqual(r.sellCity, "Lymhurst");
});

test("royal sell force does NOT collapse the Caerleon section to null — it keeps its reachable route", () => {
  // The regression: pre-fix this returned null (forced Lymhurst unreachable from
  // Caerleon), dropping the Caerleon row into the heart-less fallback path.
  __setSellForce("T8_PLANKS", "Lymhurst");
  const r = route("Caerleon");
  assert.ok(r, "Caerleon main route must NOT be null under a cross-zone force");
  assert.strictEqual(r.sellCity, "Caerleon");
});

test("Caerleon sell force does NOT collapse the royal section to null", () => {
  __setSellForce("T8_PLANKS", "Caerleon");
  const r = route("Fort Sterling");
  assert.ok(r, "royal main route must NOT be null under a cross-zone force");
  assert.strictEqual(r.sellCity, "Fort Sterling");
});

test("the Caerleon section is identical with and without a royal force (fully decoupled)", () => {
  const before = route("Caerleon");
  __setSellForce("T8_PLANKS", "Lymhurst");
  const after = route("Caerleon");
  assert.strictEqual(after.sellCity, before.sellCity);
  assert.strictEqual(after.marginInfo.margin, before.marginInfo.margin,
    "a force on the royal row must not move the Caerleon row's margin");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
