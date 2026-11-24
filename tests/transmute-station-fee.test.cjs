/**
 * Test: transmute routes charge the crafting-station usage fee, on top of the
 * fixed transmute silver.
 *
 * In-game the silver shown when transmuting at a crafting station = the fixed
 * transmute silver (the market-cap sink, from items.xml) PLUS the station usage
 * fee. Calibrated 2026-07-18 against the full T4-T8 hide grid at a 930/100 station:
 *   - 7.0 -> 8.0 hide total 5,807  (fixed 5,000    -> fee     807)
 *   - 7.4 -> 8.4 hide total 901,675 (fixed 779,625 -> fee 122,050)
 * The station fee is a steady ~15.7% of the fixed silver across every step, tracking
 * the fixed-silver, NOT the resource itemvalue (raw hide iv 4-124 is far too small).
 * Anchored to 7.4->8.4: fee = (rate/100) * silver * 0.016833 hits it exactly, and
 * every other step lands within ~130 silver (<0.1%).
 *
 * Black-box: price a synthetic recipe at station-fee = 0 vs a rate R; the
 * difference must equal (R/100) * transmuteNutrition(silverCost). No DOM/API.
 *
 * Run: node tests/transmute-station-fee.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

// Controllable station-fee rate + the real calcStationFeeSilver formula (copied
// from utils.js: nutrition = nutritionOverride ?? mats*14*2^(t-4)*0.1125).
const stubs = `
let STATION_RATE = 0;
function __setStationRate(r){ STATION_RATE = r || 0; }
function getStationFeeInput(){ return STATION_RATE; }
function calcStationFeeSilver(tier, nonArtifactMats, nutritionOverride = null){
  const ivPerMat = 14 * Math.pow(2, tier - 4);
  const itemValue = nonArtifactMats * ivPerMat;
  const nutrition = nutritionOverride != null ? nutritionOverride : itemValue * 0.1125;
  return (getStationFeeInput() / 100) * nutrition;
}
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SETUP_FEE = 0.025, PREMIUM_TAX = 0.04;
function isSuspectMargin(m){ return Number.isFinite(m) && m > MAX_MARGIN_PERCENT; }
function suspectMarginBadge(){ return ""; }
function getIQRBounds(){ return null; }
function getBuyPrice(data, city){ return data && data[city] ? (data[city].buy || 0) : 0; }
function getSellPrice(data, city){ return data && data[city] ? (data[city].sell || 0) : 0; }
function getCityForce(){ return null; }
function getOverridePrice(){ return null; }
function isInvalidCrossRoute(){ return false; }
function getMinVol(){ return 123; }
function getMinVol2(){ return 123; }
`;

const sources = J("resource-names.js") + J("data-transmute.js") + J("render-transmute.js");

const mod = new Module("transmute-station-fee");
mod._compile(
  stubs + sources +
    "\nmodule.exports = { priceTransmuteRoute, transmuteNutrition, TRANSMUTE_NUTRITION_PER_SILVER, __setStationRate };",
  "transmute-station-fee.js",
);
const { priceTransmuteRoute, transmuteNutrition, TRANSMUTE_NUTRITION_PER_SILVER, __setStationRate } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

// Market id for a raw wood node. Grid fees are shared by wood/ore/fiber/hide.
function wood(t, e) { return e ? `T${t}_WOOD_LEVEL${e}@${e}` : `T${t}_WOOD`; }

// A single-step resource recipe from (srcT,srcE) to (tgtT,tgtE).
function recipe(srcT, srcE, tgtT, tgtE, silverCost) {
  return { kind: "resource", tier: srcT, sourceId: wood(srcT, srcE), targetId: wood(tgtT, tgtE), silverCost };
}
const BUY_CITIES = ["Caerleon"], SELL_CITIES = ["Caerleon"], MIN_VOLUME = 0;
function md(r) {
  return {
    [r.sourceId]: { Caerleon: { buy: 200000, volume_24h: 50 } },
    [r.targetId]: { Caerleon: { sell: 5000000, volume_24h: 50 } },
  };
}
function priceAt(rate, r) {
  __setStationRate(rate);
  return priceTransmuteRoute(r, BUY_CITIES, SELL_CITIES, MIN_VOLUME, md(r), null);
}

console.log("=== transmuteNutrition helper (linear fallback for stone/materials) ===");
test("nutrition is silverCost * 0.016833", () => {
  assert.strictEqual(TRANSMUTE_NUTRITION_PER_SILVER, 0.016833);
  assert.strictEqual(transmuteNutrition(5000), 5000 * 0.016833);
  assert.strictEqual(transmuteNutrition(0), 0);
  assert.strictEqual(transmuteNutrition(undefined), 0);
});

// The measured in-game station fees (at the 930/100 reference rate) the app must
// reproduce EXACTLY for every resource step. [srcT,srcE,tgtT,tgtE,silver,fee@930].
console.log("\n=== exact per-step grid at reference rate 930 ===");
const GRID = [
  // tier-ups
  [4,0,5,0,781,127], [4,4,5,4,25000,3979], [5,0,6,0,1250,203], [6,3,7,3,51975,8215],
  [7,0,8,0,5000,807], [7,1,8,1,15000,2394], [7,4,8,4,779625,122050],
  // enchant-ups
  [4,0,4,1,1500,247], [4,3,4,4,24000,3874], [6,1,6,2,6000,969], [8,0,8,1,14400,2300],
  [8,2,8,3,149688,23566], [8,3,8,4,784440,81185],
];
GRID.forEach(([sT, sE, tT, tE, silver, fee930]) => {
  const label = `${sT}${sE?'.'+sE:''}->${tT}${tE?'.'+tE:''}`;
  test(`${label} station fee == ${fee930} at rate 930`, () => {
    const r = recipe(sT, sE, tT, tE, silver);
    const zero = priceAt(0, r), withFee = priceAt(930, r);
    assert.ok(zero && withFee, "both routes must price");
    const actual = withFee.totalInputCost - zero.totalInputCost;
    assert.ok(Math.abs(actual - fee930) < 1e-6, `fee ${actual} != ${fee930}`);
    assert.ok(Math.abs(withFee.stationFee - fee930) < 1e-6, `stationFee ${withFee.stationFee} != ${fee930}`);
    // profit falls by exactly the fee.
    assert.ok(Math.abs((zero.profit - withFee.profit) - fee930) < 1e-6, "profit must fall by the fee");
  });
});

console.log("\n=== fee scales linearly with the station-fee input ===");
[[400], [1860], [3190]].forEach(([rate]) => {
  test(`7.4->8.4 fee scales to rate ${rate}`, () => {
    const r = recipe(7, 4, 8, 4, 779625);
    const zero = priceAt(0, r), withFee = priceAt(rate, r);
    const expected = 122050 * (rate / 930);
    const actual = withFee.totalInputCost - zero.totalInputCost;
    assert.ok(Math.abs(actual - expected) < 1e-6, `fee ${actual} != ${expected}`);
  });
});

test("zero station fee -> no change from bare silver sink", () => {
  const r = recipe(7, 4, 8, 4, 779625);
  const p = priceAt(0, r);
  // sourceCost = 200000 * 1.025 = 205000; + silver 779625, no fee.
  assert.ok(Math.abs(p.totalInputCost - (205000 + 779625)) < 1e-6, p.totalInputCost);
});

test("7.4->8.4 total at rate 930 == 205000 + 901,675", () => {
  const r = recipe(7, 4, 8, 4, 779625);
  const withFee = priceAt(930, r);
  assert.ok(Math.abs(withFee.totalInputCost - (205000 + 901675)) < 1e-6, withFee.totalInputCost);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
