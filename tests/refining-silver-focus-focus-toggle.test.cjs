/**
 * Test: the Refining/Transport "Silver/Focus" column is a focus-ON benchmark
 * and MUST be invariant to the global "Use Focus" checkbox.
 *
 * Bug (reported): toggling Use Focus changed Silver/Focus for the SAME route —
 * sometimes dramatically, sometimes flipping negative (7.4 bar 81.3 -> 139.1;
 * 8.4 cloth 76.8 -> -26.1). Three distinct leaks fed the checkbox into the
 * benchmark, all via computeRefineRouteForCity reading isFocusEnabled():
 *   1. secondary refining-chain sourcing (chain depth + market-vs-chain),
 *   2. faction-heart raw substitution (heart toggles -> raw count changes),
 *   3. main->no-data-fallback path flip (a focus-profitable route returns null
 *      under focus-off RRR, so the row drops to the fallback's own calc).
 *
 * Fix: render-transport.js evaluates the route a second time with focus forced
 * ON (computeRefineRouteForCity(..., forceFocus=true)) and derives the
 * Silver/Focus column from THAT (computeRefineFocusColumn). All three leaks
 * close at once because the benchmark rides on a fully focus-on route.
 *
 * Convention (matches crafting/consumables/mounts): render-consumables.js —
 * "Silver/Focus is a benchmark that ALWAYS assumes focus-on RRR". Profit/Margin
 * keep tracking the checkbox; only Silver/Focus is pinned.
 *
 * Black-box: load the REAL render-transport.js + refining-chain modules, drive
 * computeRefineRouteForCity / computeRefineFocusColumn with isFocusEnabled()
 * true vs false, and assert the benchmark is identical across the toggle while
 * the profit path moves.
 *
 * Run: node tests/refining-silver-focus-focus-toggle.test.cjs
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
function isFocusEnabled() { return globalThis.__TEST_FOCUS__; }
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

const recipesSrc = loadFile("js/refining-chain-recipes.js");
const pricingSrc = loadFile("js/refining-chain-pricing.js");
const transportSrc = loadFile("js/focus-play.js") + loadFile("js/refining-route.js") + loadFile("js/render-transport.js");

const mod = new Module("refining-silver-focus-focus-toggle-test");
mod._compile(
  sandbox + recipesSrc + pricingSrc + transportSrc +
    "\nmodule.exports = { computeRefineRouteForCity, computeRefineFocusColumn };",
  "refining-silver-focus-focus-toggle.js",
);
const { computeRefineRouteForCity, computeRefineFocusColumn } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const FS = "Fort Sterling";

// Silver/Focus exactly as renderTransportTable derives it: checkbox path picks
// the route; the benchmark rides on a force-focus re-evaluation.
function benchmarkSF(routeItem, md, focusCheckbox) {
  globalThis.__TEST_FOCUS__ = focusCheckbox;
  const result = computeRefineRouteForCity(FS, routeItem, md, "instant");
  const focusResult = focusCheckbox ? result : computeRefineRouteForCity(FS, routeItem, md, "instant", true);
  return computeRefineFocusColumn(focusResult, routeItem).profitPerFocus;
}
function profitPath(routeItem, md, focusCheckbox) {
  globalThis.__TEST_FOCUS__ = focusCheckbox;
  return computeRefineRouteForCity(FS, routeItem, md, "instant");
}

// ── Fixture 1: chain path (T8 plank, T7 secondary refines down a deep chain) ──
const CHAIN_ROUTE = {
  mat: "Planks [T8]", rawId: "T8_WOOD", refinedId: "T8_PLANKS",
  rawRatio: 5, resourceType: "wood", secondaryMatId: "T7_PLANKS", secondaryMatCount: 1,
};
function chainMarket() {
  const md = {};
  const set = (id, buy, sell) => { md[id] = { [FS]: { buy_price: buy, sell_price: sell, volume_24h: 9999 } }; };
  set("T8_PLANKS", 999999, 30000);
  set("T7_PLANKS", 999999, 999999); set("T6_PLANKS", 999999, 999999);
  set("T5_PLANKS", 999999, 999999); set("T4_PLANKS", 999999, 999999);
  set("T3_PLANKS", 50, 60);
  set("T8_WOOD", 1500, 1600); set("T7_WOOD", 800, 900); set("T6_WOOD", 400, 500);
  set("T5_WOOD", 150, 200); set("T4_WOOD", 80, 120);
  return md;
}

console.log("\n=== Chain path: Silver/Focus invariant to the Use Focus toggle ===");

test("fixture sanity: profit path moves with the checkbox", () => {
  const on = profitPath(CHAIN_ROUTE, chainMarket(), true);
  const off = profitPath(CHAIN_ROUTE, chainMarket(), false);
  assert.ok(on && off, "route priced in both states");
  assert.notStrictEqual(on.rrr, off.rrr, "profit-path rrr tracks the checkbox");
  assert.ok(Math.abs(on.marginInfo.profit - off.marginInfo.profit) > 1e-6, "profit moves with the checkbox");
});

test("force-focus evaluation is identical regardless of the checkbox", () => {
  globalThis.__TEST_FOCUS__ = true;
  const a = computeRefineRouteForCity(FS, CHAIN_ROUTE, chainMarket(), "instant", true);
  globalThis.__TEST_FOCUS__ = false;
  const b = computeRefineRouteForCity(FS, CHAIN_ROUTE, chainMarket(), "instant", true);
  assert.ok(a && b, "force-focus route valid in both");
  assert.strictEqual(a.rrr, b.rrr, "force-focus rrr must not depend on the checkbox");
  assert.strictEqual(a.sellPrice, b.sellPrice, "force-focus sell price stable");
  assert.ok(Math.abs((a.secondaryChain?.costPerOutput || 0) - (b.secondaryChain?.costPerOutput || 0)) < 1e-6,
    "force-focus chain cost stable");
});

test("end-to-end Silver/Focus is identical across the toggle (chain path)", () => {
  const on = benchmarkSF(CHAIN_ROUTE, chainMarket(), true);
  const off = benchmarkSF(CHAIN_ROUTE, chainMarket(), false);
  assert.ok(on !== null && off !== null, "benchmark computes in both states");
  assert.ok(Math.abs(on - off) < 1e-6, `Silver/Focus must be invariant (on=${on}, off=${off})`);
});

// ── Fixture 2: single-tier path with a faction-heart raw substitution ─────────
// Heart price 550 loses to a focus-discounted raw (1000*(1-0.539)=461) but
// beats a non-focus raw (1000*(1-0.367)=633) -> the heart toggles with focus.
const HEART_ROUTE = {
  mat: "Planks [T4]", rawId: "T4_WOOD", refinedId: "T4_PLANKS",
  rawRatio: 2, resourceType: "wood", secondaryMatId: "T3_PLANKS", secondaryMatCount: 1,
};
function heartMarket() {
  const md = {};
  const set = (id, buy, sell) => { md[id] = { [FS]: { buy_price: buy, sell_price: sell, volume_24h: 9999 } }; };
  set("T4_PLANKS", 999999, 4000);
  set("T4_WOOD", 1000, 1100);
  set("T3_PLANKS", 50, 60);
  set("T1_FACTION_FOREST_TOKEN_1", 550, 600); // Treeheart
  return md;
}

console.log("\n=== Single-tier + faction heart: substitution must not leak ===");

test("fixture sanity: heart toggles on the profit path", () => {
  const on = profitPath(HEART_ROUTE, heartMarket(), true);
  const off = profitPath(HEART_ROUTE, heartMarket(), false);
  assert.ok(on && off, "route priced in both states");
  assert.ok(!on.secondaryChain && !off.secondaryChain, "secondary is market (single-tier path)");
  assert.ok(Math.abs((on.heartCost || 0) - (off.heartCost || 0)) > 1e-6,
    `fixture must flip the heart (heartCost on=${on.heartCost}, off=${off.heartCost})`);
});

test("end-to-end Silver/Focus is identical across the toggle (heart path)", () => {
  const on = benchmarkSF(HEART_ROUTE, heartMarket(), true);
  const off = benchmarkSF(HEART_ROUTE, heartMarket(), false);
  assert.ok(on !== null && off !== null, "benchmark computes in both states");
  assert.ok(Math.abs(on - off) < 1e-6, `Silver/Focus must be invariant (on=${on}, off=${off})`);
});

// ── Fixture 3: main->fallback path flip (the case that defeated field-patching) ─
// Tuned so the focus-OFF margin is well below -1% (route returns null -> no-data
// fallback) while the focus-ON margin is positive (valid route).
const FLIP_ROUTE = {
  mat: "Planks [T6]", rawId: "T6_WOOD", refinedId: "T6_PLANKS",
  rawRatio: 4, resourceType: "wood", secondaryMatId: "T5_PLANKS", secondaryMatCount: 1,
};
function flipMarket() {
  const md = {};
  const set = (id, buy, sell) => { md[id] = { [FS]: { buy_price: buy, sell_price: sell, volume_24h: 9999 } }; };
  set("T6_PLANKS", 999999, 21230);  // sell tuned: focus-on +~5%, focus-off ~-24%
  set("T6_WOOD", 10000, 10100);
  set("T5_PLANKS", 10, 20);         // cheap market secondary => single-tier
  return md;
}

console.log("\n=== Main->fallback path flip: benchmark stays stable ===");

test("fixture sanity: focus-off route drops to null, force-focus stays valid", () => {
  const off = profitPath(FLIP_ROUTE, flipMarket(), false);
  globalThis.__TEST_FOCUS__ = false;
  const forced = computeRefineRouteForCity(FS, FLIP_ROUTE, flipMarket(), "instant", true);
  assert.strictEqual(off, null, "focus-off margin should be below -1% => null (no-data fallback)");
  assert.ok(forced, "force-focus route should still be valid");
});

test("Silver/Focus survives the main->fallback path flip unchanged", () => {
  const on = benchmarkSF(FLIP_ROUTE, flipMarket(), true);
  const off = benchmarkSF(FLIP_ROUTE, flipMarket(), false);
  assert.ok(on !== null && off !== null, "benchmark computes in both states");
  assert.ok(Math.abs(on - off) < 1e-6, `Silver/Focus must survive the path flip (on=${on}, off=${off})`);
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
