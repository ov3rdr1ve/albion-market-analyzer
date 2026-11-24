/**
 * Test: the Refining / Transports table emits ONE row per candidate refine city
 * — the route the player would actually run.
 *
 * It used to emit two whenever the secondary was cheapest chain-refined: a
 * "⛓ chain" row and a "⊟ direct" twin with the secondary forced to market, side
 * by side for comparison. That doubled every chain route and left the reader to
 * score two rows the table had already scored. Now only the winner renders, and
 * the ⛓ badge simply names how the winner got its secondary.
 *
 * The data layer's `forceMarketSecondary` flag went with it — nothing could ask
 * for a deliberately worse route any more (this file replaces the test that
 * covered that flag, tests/refining-direct-vs-chain-comparison.test.cjs).
 *
 * Black-box: loads the REAL refining-chain + route modules and drives
 * computeRefineRouteForCity / getRefiningSourcing with synthetic prices. No live
 * API, no DB.
 *
 * Run: node tests/transport-single-variant-row.test.cjs
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
const CITY_REFINE_SPEC = {
  "Fort Sterling": "wood", Lymhurst: "fiber", Bridgewatch: "rock",
  Thetford: "ore", Martlock: "hide",
};
const RESOURCE_DEFS = [
  { type: "wood", raw: "WOOD", refined: "PLANKS",
    tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];
function isBlackRedZoneEnabled() { return false; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function isFocusEnabled() { return false; }
function getOverridePrice() { return null; }
function getCityForce() { return null; }
function isInvalidCrossRoute() { return false; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city, bounds, itemId) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function getSellPrice(itemData, city, bounds, itemId) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || 0;
}
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getRefineRRR(city, type, useFocus) {
  let bonus = BASE_CITY_BONUS;
  if (CITY_REFINE_SPEC[city] === type) bonus += REFINE_SPEC_BONUS;
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}
function getFocusCost(id, t) { return Math.round(30 * Math.pow(2, t-4)); }
function calcStationFeeSilver() { return 0; }
function refineStationFeeSilver() { return 0; }
function getTierFromId(id) { const m = id.match(/^T(\\d+)/); return m ? parseInt(m[1], 10) : 4; }
function getResourceWeightKg() { return 1; }
function matsNeededFor10kFocus() { return 0; }
function calculateProfitPerFocus(profit, focusCost) {
  if (!focusCost || focusCost <= 0) return 0;
  return profit / focusCost;
}
function calculateTransportMargin(buyCost, sellPrice, rrr = 0, secondaryMatCost = 0, stationFee = 0, travelCost = 0, nonReturnableMatCost = 0) {
  if (!buyCost || !sellPrice) return { profit: 0, margin: 0 };
  const effectiveCost = ((buyCost + secondaryMatCost) * (1 - rrr) + nonReturnableMatCost) * (1 + SETUP_FEE) + stationFee + travelCost;
  const totalRevenue = sellPrice * (1 - PREMIUM_TAX);
  const profit = totalRevenue - effectiveCost;
  return { profit, margin: (profit / effectiveCost) * 100 };
}
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }

const routeSrc = loadFile("js/refining-route.js");
const renderSrc = loadFile("js/render-transport.js");

const mod = new Module("transport-single-variant-row-test");
mod._compile(
  sandbox + loadFile("js/refining-chain-recipes.js") + loadFile("js/refining-chain-pricing.js") +
    routeSrc + renderSrc +
    "\nmodule.exports = { computeRefineRouteForCity, getSecondarySourcing, getRefiningSourcing };",
  "transport-single-variant-row.js",
);
const { computeRefineRouteForCity, getSecondarySourcing } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const FS = "Fort Sterling";

// T8 plank: cheap raws all the way down so the chain wins, but the T7 secondary
// ALSO carries a real (pricier) market price — the exact shape that used to emit
// a second "direct" row.
const ROUTE = {
  mat: "Planks [T8]", rawId: "T8_WOOD", refinedId: "T8_PLANKS",
  rawRatio: 5, resourceType: "wood", secondaryMatId: "T7_PLANKS", secondaryMatCount: 1,
};
function market() {
  const md = {};
  const set = (id, buy, sell) => { md[id] = { [FS]: { buy_price: buy, sell_price: sell, volume_24h: 9999 } }; };
  set("T8_PLANKS", 999999, 30000);
  set("T7_PLANKS", 20000, 21000);   // real price, but pricier than chaining it
  set("T6_PLANKS", 999999, 999999);
  set("T5_PLANKS", 999999, 999999);
  set("T4_PLANKS", 999999, 999999);
  set("T3_PLANKS", 50, 60);
  set("T8_WOOD", 1500, 1600); set("T7_WOOD", 800, 900); set("T6_WOOD", 400, 500);
  set("T5_WOOD", 150, 200); set("T4_WOOD", 80, 120);
  return md;
}

console.log("\n=== One route, sourced the cheaper way ===");

test("the secondary resolves to the refining chain when that is cheaper", () => {
  const r = computeRefineRouteForCity(FS, ROUTE, market(), "instant");
  assert.ok(r, "route should be priced");
  assert.ok(r.secondaryChain, "expected the chain to win over the 20,000 market bar");
  assert.strictEqual(r.secondaryChain.produces, "T7_PLANKS");
});

test("the secondary resolves to market when THAT is cheaper", () => {
  const md = market();
  md.T7_PLANKS[FS].buy_price = 1;
  const r = computeRefineRouteForCity(FS, ROUTE, md, "instant");
  assert.strictEqual(r.secondaryChain, null, "no chain when the bar is cheapest");
  assert.strictEqual(r.secPrice, 1);
  assert.strictEqual(r.secCity, FS);
});

console.log("\n=== No way to ask for the losing route ===");

test("computeRefineRouteForCity ignores a stray 6th argument", () => {
  // The old `forceMarketSecondary` flag lived in this position. Passing it must
  // no longer produce the deliberately-worse market-sourced route.
  const chain = computeRefineRouteForCity(FS, ROUTE, market(), "instant", false);
  const stray = computeRefineRouteForCity(FS, ROUTE, market(), "instant", false, true);
  assert.ok(stray.secondaryChain, "a stray flag must not disable the chain");
  assert.strictEqual(stray.totalRawCost, chain.totalRawCost);
});

test("getSecondarySourcing ignores a stray 5th argument", () => {
  const normal = getSecondarySourcing("T7_PLANKS", market(), FS, false);
  const stray = getSecondarySourcing("T7_PLANKS", market(), FS, false, true);
  assert.strictEqual(stray.source, "chain");
  assert.strictEqual(stray.perUnit, normal.perUnit);
});

console.log("\n=== The route kept is the cheaper one ===");

test("the chain route the table keeps beats the market-sourced alternative", () => {
  // Re-derive what the dropped "direct" row would have cost, without the flag:
  // the secondary at its market price, everything else identical.
  const r = computeRefineRouteForCity(FS, ROUTE, market(), "instant");
  const chainSecPerUnit = r.secondaryChain.costPerOutput;
  const marketSecPerUnit = market().T7_PLANKS[FS].buy_price;
  assert.ok(chainSecPerUnit < marketSecPerUnit,
    `the kept route's secondary (${Math.round(chainSecPerUnit)}) must undercut the bar (${marketSecPerUnit})`);
});

console.log("\n=== The renderer no longer builds a second row ===");

test("render-transport.js has no 'direct' variant left", () => {
  assert.ok(!/variant\s*=\s*"direct"/.test(renderSrc),
    "a direct comparison row must not be emitted any more");
  assert.ok(/variant\s*=\s*"chain"/.test(renderSrc),
    "the chain badge must survive — it names how the winner got its secondary");
});

test("the forceMarketSecondary plumbing is gone from both layers", () => {
  assert.ok(!/forceMarketSecondary/.test(routeSrc), "refining-route.js still references it");
  assert.ok(!/forceMarketSecondary/.test(renderSrc), "render-transport.js still references it");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
