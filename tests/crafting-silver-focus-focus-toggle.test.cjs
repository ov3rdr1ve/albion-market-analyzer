/**
 * Test: the Crafting table's "Silver/Focus" column is a focus-ON benchmark and
 * MUST be invariant to the global "Use Focus" checkbox.
 *
 * Bug (found by browser diff: 118/2782 rows changed, sign-flipping): the
 * benchmark uses focus-on RRR for its own math but rides on the row's WINNING
 * route, whose sell city is chosen by the checkbox-dependent margin. The leak
 * vector is the `margin > 0` gate in computeCraftRoutesForCity: with focus off
 * the higher input cost pushes the best (highest-price) sell city's margin <= 0,
 * dropping it from validRoutes, so the displayed route falls back to a local
 * city → different sell price → different Silver/Focus.
 *
 * Fix: derive the Silver/Focus column from a force-focus route evaluation
 * (computeCraftRoutesForCity(..., forceFocus=true) → computeCraftFocusColumn),
 * decoupled from the checkbox. Profit/Margin keep tracking the checkbox.
 *
 * Convention (render-consumables.js): "Silver/Focus is a benchmark that ALWAYS
 * assumes focus-on RRR."
 *
 * Black-box: load the REAL render-crafting.js, drive computeCraftRoutesForCity /
 * computeCraftFocusColumn with isFocusEnabled() true vs false.
 *
 * Run: node tests/crafting-silver-focus-focus-toggle.test.cjs
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
const SELL_CITIES = CITIES;
const SETUP_FEE = 0.025;
const PREMIUM_TAX = 0.065;
const BASE_CITY_BONUS = 0.18;
const CRAFT_SPEC_BONUS = 0.15;
const FOCUS_BONUS = 0.59;
const CITY_CRAFT_SPEC = {}; // no spec for the fixture
function isBlackRedZoneEnabled() { return true; }      // BMR on => no zone filtering
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function isFocusEnabled() { return globalThis.__TEST_FOCUS__; }
function isInvalidCrossRoute() { return false; }
function getCityForce() { return null; }
function getOverridePrice() { return null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].buy_price) || 0; }
function getSellPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].sell_price) || 0; }
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getCraftRRR(city, craftType, useFocus = true) {
  let bonus = BASE_CITY_BONUS;
  const specs = CITY_CRAFT_SPEC[city];
  if (specs && craftType && specs.includes(craftType)) bonus += CRAFT_SPEC_BONUS;
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}
function getFocusCost() { return 100; }
function getCraftFocusCost(id, tier) { return getFocusCost(id, tier, "crafting"); }
function getTierFromId(id) { const m = id.match(/^T(\\d+)/); return m ? parseInt(m[1], 10) : 4; }
function calcStationFeeSilver() { return 0; }
function refineStationFeeSilver() { return 0; }
function calculateProfitPerFocus(profit, focusCost) { if (!focusCost || focusCost <= 0) return 0; return profit / focusCost; }
function marginalSilverPerFocus(matCost, baseRrr, focusRrr, focusCost) { if (!focusCost || focusCost <= 0) return 0; return (matCost * (focusRrr - baseRrr) * (1 + SETUP_FEE)) / focusCost; }
function matsNeededFor10kFocus(focusCost, per, applyRrr, rrr) { const c = Math.floor(10000 / focusCost); const e = applyRrr ? per * (1 - (rrr || 0)) : per; return Math.round(c * e); }
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }

const mod = new Module("crafting-silver-focus-focus-toggle-test");
mod._compile(
  sandbox + loadFile("js/focus-play.js") + loadFile("js/render-crafting.js") +
    "\nmodule.exports = { computeCraftRoutesForCity, computeCraftFocusColumn };",
  "render-crafting.js",
);
const { computeCraftRoutesForCity, computeCraftFocusColumn } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Fixture: craft at Lymhurst. Caerleon sells highest, but its margin goes <= 0
// when focus is off (higher input cost). A since-removed `margin > 0` gate used
// to drop it there and fall back to the Lymhurst self-route, flipping the sell
// city and, pre-fix, the Silver/Focus benchmark with it. The benchmark must stay
// put either way (tests/crafting-unprofitable-best-sell).
const CRAFT_CITY = "Lymhurst";
const ITEM = { id: "T4_TEST_ARMOR", craftType: "x", noReturn: false };
const MATERIALS = [{ matId: "T4_CLOTH", count: 8 }];
function market() {
  return {
    T4_CLOTH:       { Lymhurst: { buy_price: 1000, sell_price: 1100, volume_24h: 9999 } },
    T4_TEST_ARMOR:  {
      Caerleon: { buy_price: 1, sell_price: 6000, volume_24h: 9999 }, // best price, profitable only with focus
      Lymhurst: { buy_price: 1, sell_price: 5000, volume_24h: 9999 }, // craft-city fallback (always valid)
    },
  };
}
function routes(focusOn, forceFocus) {
  globalThis.__TEST_FOCUS__ = focusOn;
  return computeCraftRoutesForCity(CRAFT_CITY, ITEM, MATERIALS, market(), forceFocus);
}
function benchmarkSF(focusOn) {
  globalThis.__TEST_FOCUS__ = focusOn;
  const results = computeCraftRoutesForCity(CRAFT_CITY, ITEM, MATERIALS, market());
  const focusResults = focusOn ? results : computeCraftRoutesForCity(CRAFT_CITY, ITEM, MATERIALS, market(), true);
  const focusResult = focusResults[0] || results[0];
  return computeCraftFocusColumn(focusResult, ITEM, MATERIALS).profitPerFocus;
}

console.log("\n=== Crafting Silver/Focus invariant to the Use Focus toggle ===");

test("fixture sanity: focus-off is a loss yet still sells at the best price", () => {
  const on = routes(true)[0], off = routes(false)[0];
  assert.ok(on && off, "routes computed in both states");
  assert.strictEqual(on.sellCity, "Caerleon", "focus-on should sell at Caerleon (best price, profitable)");
  assert.ok(off.marginInfo.margin <= 0, "focus-off should be unprofitable in this fixture");
  assert.strictEqual(off.sellCity, "Caerleon", "a loss-making craft still sells where it loses least");
});

test("force-focus route is identical regardless of the checkbox", () => {
  globalThis.__TEST_FOCUS__ = true;  const a = routes(true, true)[0];
  globalThis.__TEST_FOCUS__ = false; const b = routes(false, true)[0];
  assert.ok(a && b, "force-focus routes valid");
  assert.strictEqual(a.sellCity, b.sellCity, "force-focus sell city must not depend on the checkbox");
  assert.strictEqual(a.sellCity, "Caerleon", "force-focus should sell at Caerleon (focus-on optimal)");
  assert.strictEqual(a.sellPrice, b.sellPrice, "force-focus sell price stable");
});

test("end-to-end Silver/Focus is identical across the toggle", () => {
  const on = benchmarkSF(true), off = benchmarkSF(false);
  assert.ok(Math.abs(on - off) < 1e-9, `Silver/Focus must be invariant (on=${on}, off=${off})`);
});

test("benchmark is derived from the force-focus route in both states", () => {
  // Since Silver/Focus became marginal (silver the focus itself buys, see
  // tests/crafting-silver-focus-marginal) the sell city cannot move it at all —
  // the leak this file guards is closed twice over. The invariant still holds
  // and is still worth asserting: the column must never track the checkbox.
  const on = benchmarkSF(true), off = benchmarkSF(false);
  assert.ok(on > 0, "focus-on benchmark should be positive for this fixture");
  assert.strictEqual(on, off, "off must equal on after the fix");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
