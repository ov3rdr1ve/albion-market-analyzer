/**
 * Test: the Refining/Transport "Profit / 10k Focus" and "Profit Gathered / 10k
 * Focus" columns are focus-ON benchmarks and MUST be invariant to the global
 * "Use Focus" checkbox.
 *
 * Bug (reported): toggling Use Focus changed Profit / 10k Focus for the SAME
 * route. The column paired an INVARIANT focus cost (computeRefineFocusColumn on
 * a force-focus evaluation — pinned by tests/refining-silver-focus-focus-toggle)
 * with the CHECKBOX route's profit, so half the product moved with the toggle.
 *
 * Fix: render-transport.js derives the profit from the same force-focus
 * evaluation, via computeRefineFocusProfit (js/refining-route.js). Spending a
 * whole 10,000-focus bar is focus-on play by definition, so both operands are
 * focus-on. Profit / Margin / Input Cost keep tracking the checkbox.
 *
 * Black-box: load the REAL refining modules, drive them exactly as
 * renderTransportTable does (checkbox route for the profit path, force-focus
 * route for the benchmark), and assert both per-10k figures are identical
 * across the toggle while the profit path still moves.
 *
 * Run: node tests/refining-per10k-focus-toggle.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const { calculateProfitPer10kFocus } = require("../js/calculations.js");

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
function getBuyPrice(itemData, city) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function getSellPrice(itemData, city) {
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
const routeSrc = loadFile("js/focus-play.js") + loadFile("js/refining-route.js");

const mod = new Module("refining-per10k-focus-toggle-test");
mod._compile(
  sandbox + recipesSrc + pricingSrc + routeSrc +
    "\nmodule.exports = { computeRefineRouteForCity, computeRefineFocusColumn," +
    " computeRefineGatheredProfit, computeRefineFocusProfit };",
  "refining-per10k-focus-toggle.js",
);
const {
  computeRefineRouteForCity, computeRefineFocusColumn,
  computeRefineGatheredProfit, computeRefineFocusProfit,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const FS_CITY = "Fort Sterling";

// Exactly what renderTransportTable builds for the two per-10k cells: the
// checkbox route drives Pure Profit, the force-focus route drives the columns.
function per10kCells(routeItem, md, focusCheckbox) {
  globalThis.__TEST_FOCUS__ = focusCheckbox;
  const result = computeRefineRouteForCity(FS_CITY, routeItem, md, "instant");
  const focusResult = focusCheckbox
    ? result
    : computeRefineRouteForCity(FS_CITY, routeItem, md, "instant", true);
  const { focusCost } = computeRefineFocusColumn(focusResult, routeItem);
  const fp = computeRefineFocusProfit(focusResult, routeItem);
  const gathered = result ? computeRefineGatheredProfit(result, routeItem) : null;
  const gatheredOn = fp.gatheredProfitFocusOn != null ? fp.gatheredProfitFocusOn : gathered;
  return {
    per10k: fp.profitFocusOn != null
      ? calculateProfitPer10kFocus(fp.profitFocusOn, focusCost) : null,
    gatheredPer10k: gatheredOn != null
      ? calculateProfitPer10kFocus(gatheredOn, focusCost) : null,
    displayProfit: result ? result.marginInfo.profit : null,
    focusCost,
  };
}

// ── Fixtures (shared with tests/refining-silver-focus-focus-toggle) ──────────
// Each one makes a DIFFERENT part of the route move with the checkbox: the
// secondary's chain depth, the faction-heart substitution, and the whole
// main→no-data-fallback path flip.
const FIXTURES = [
  {
    name: "chain path (deep secondary ladder)",
    route: { mat: "Planks [T8]", rawId: "T8_WOOD", refinedId: "T8_PLANKS",
      rawRatio: 5, resourceType: "wood", secondaryMatId: "T7_PLANKS", secondaryMatCount: 1 },
    market: () => {
      const md = {};
      const set = (id, buy, sell) => { md[id] = { [FS_CITY]: { buy_price: buy, sell_price: sell, volume_24h: 9999 } }; };
      set("T8_PLANKS", 999999, 30000);
      set("T7_PLANKS", 999999, 999999); set("T6_PLANKS", 999999, 999999);
      set("T5_PLANKS", 999999, 999999); set("T4_PLANKS", 999999, 999999);
      set("T3_PLANKS", 50, 60);
      set("T8_WOOD", 1500, 1600); set("T7_WOOD", 800, 900); set("T6_WOOD", 400, 500);
      set("T5_WOOD", 150, 200); set("T4_WOOD", 80, 120);
      return md;
    },
    profitMoves: true,
  },
  {
    name: "faction-heart substitution",
    route: { mat: "Planks [T4]", rawId: "T4_WOOD", refinedId: "T4_PLANKS",
      rawRatio: 2, resourceType: "wood", secondaryMatId: "T3_PLANKS", secondaryMatCount: 1 },
    market: () => {
      const md = {};
      const set = (id, buy, sell) => { md[id] = { [FS_CITY]: { buy_price: buy, sell_price: sell, volume_24h: 9999 } }; };
      set("T4_PLANKS", 999999, 4000);
      set("T4_WOOD", 1000, 1100);
      set("T3_PLANKS", 50, 60);
      set("T1_FACTION_FOREST_TOKEN_1", 550, 600); // Treeheart
      return md;
    },
    profitMoves: true,
  },
  {
    name: "main→fallback path flip (focus-off route is null)",
    route: { mat: "Planks [T6]", rawId: "T6_WOOD", refinedId: "T6_PLANKS",
      rawRatio: 4, resourceType: "wood", secondaryMatId: "T5_PLANKS", secondaryMatCount: 1 },
    market: () => {
      const md = {};
      const set = (id, buy, sell) => { md[id] = { [FS_CITY]: { buy_price: buy, sell_price: sell, volume_24h: 9999 } }; };
      set("T6_PLANKS", 999999, 21230);
      set("T6_WOOD", 10000, 10100);
      set("T5_PLANKS", 10, 20);
      return md;
    },
    profitMoves: false, // focus-off drops the route entirely (null)
  },
];

console.log("\n=== Profit / 10k Focus is invariant to the Use Focus checkbox ===");

FIXTURES.forEach((f) => {
  test(`fixture sanity: the profit path reacts to the checkbox — ${f.name}`, () => {
    const on = per10kCells(f.route, f.market(), true);
    const off = per10kCells(f.route, f.market(), false);
    if (f.profitMoves) {
      assert.ok(on.displayProfit != null && off.displayProfit != null, "route priced in both states");
      assert.ok(Math.abs(on.displayProfit - off.displayProfit) > 1e-6,
        `Pure Profit must move with the checkbox (on=${on.displayProfit}, off=${off.displayProfit})`);
    } else {
      assert.strictEqual(off.displayProfit, null, "focus-off route drops to the no-data fallback");
      assert.ok(on.displayProfit != null, "focus-on route is priced");
    }
  });

  test(`Profit / 10k Focus identical across the toggle — ${f.name}`, () => {
    const on = per10kCells(f.route, f.market(), true);
    const off = per10kCells(f.route, f.market(), false);
    assert.ok(on.per10k != null && off.per10k != null, "figure computes in both states");
    assert.ok(Math.abs(on.per10k - off.per10k) < 1e-6,
      `Profit / 10k Focus must be invariant (on=${on.per10k}, off=${off.per10k})`);
  });

  test(`Profit Gathered / 10k Focus identical across the toggle — ${f.name}`, () => {
    const on = per10kCells(f.route, f.market(), true);
    const off = per10kCells(f.route, f.market(), false);
    assert.ok(on.gatheredPer10k != null && off.gatheredPer10k != null, "figure computes in both states");
    assert.ok(Math.abs(on.gatheredPer10k - off.gatheredPer10k) < 1e-6,
      `Profit Gathered / 10k Focus must be invariant (on=${on.gatheredPer10k}, off=${off.gatheredPer10k})`);
  });

  test(`both operands are focus-ON, so the figure = focus profit × refines — ${f.name}`, () => {
    const on = per10kCells(f.route, f.market(), true);
    const refines = Math.floor(10000 / on.focusCost);
    globalThis.__TEST_FOCUS__ = true;
    const focusRoute = computeRefineRouteForCity(FS_CITY, f.route, f.market(), "instant", true);
    assert.ok(Math.abs(on.per10k - focusRoute.marginInfo.profit * refines) < 1e-6,
      "per-10k reproduces focus-ON profit × whole refines a bar buys");
  });
});

// A focus-off row still reports what a focus bar would earn: the figure comes
// off the focus-on route, so it can differ from the displayed Pure Profit ×
// refines — that difference is the point, not a bug.
test("with focus OFF the figure is NOT the displayed profit × refines", () => {
  const f = FIXTURES[0];
  const off = per10kCells(f.route, f.market(), false);
  const refines = Math.floor(10000 / off.focusCost);
  assert.ok(Math.abs(off.per10k - off.displayProfit * refines) > 1e-6,
    "focus-off Pure Profit must not be what the 10k-focus column multiplies");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
