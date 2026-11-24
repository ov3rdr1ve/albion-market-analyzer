/**
 * Test: "Profit / 10k Focus" is a focus-ON benchmark in EVERY table that shows
 * it, and never follows the global "Use Focus" checkbox.
 *
 * Spending a whole 10,000-focus bar is focus-on play by definition, so both
 * operands of the figure (profit per craft AND focus per craft) must come from
 * the focus-on evaluation of the row. The reported bug was the mismatch: the
 * focus cost was already pinned (the Silver/Focus fix) while the profit still
 * tracked the checkbox, so the product moved when the user toggled it.
 *
 * Part 1 — Crafting, end to end against the REAL render-crafting.js: drive
 *          computeCraftRoutesForCity / computeCraftFocusColumn exactly as
 *          renderCraftingTable does and assert the figure holds still.
 * Part 2 — call-site contract over the shipped renderers: every
 *          calculateProfitPer10kFocus() call must be handed a focus-ON profit,
 *          never a `marginInfo.profit` that reacts to the checkbox. This catches
 *          a new table wiring itself up the old way, whatever its own test does.
 *
 * The other tables have their own end-to-end files: Refining in
 * tests/refining-per10k-focus-toggle.test.cjs, Consumables in
 * tests/consumables-per10k-focus-toggle.test.cjs, Mounts in
 * tests/mounts-per10k-focus-toggle.test.cjs, and the Crafting Planner's
 * invariance is asserted in tests/craft-planner-pricing.test.cjs.
 *
 * Run: node tests/per10k-focus-toggle-tables.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const { calculateProfitPer10kFocus } = require("../js/calculations.js");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── Part 1: Crafting, end to end ────────────────────────────────────────────

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
const CITY_CRAFT_SPEC = {};
function isBlackRedZoneEnabled() { return true; }
function isValidSourceCity() { return true; }
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

const mod = new Module("per10k-focus-toggle-crafting");
mod._compile(
  sandbox + read("js/focus-play.js") + read("js/render-crafting.js") +
    "\nmodule.exports = { computeCraftRoutesForCity, computeCraftFocusColumn };",
  "render-crafting.js",
);
const { computeCraftRoutesForCity, computeCraftFocusColumn } = mod.exports;

// Fixture (shared with tests/crafting-silver-focus-focus-toggle): Caerleon pays
// the best price but its margin only clears the `margin > 0` gate with focus on,
// so the checkbox moves BOTH the profit and the winning sell city.
const CRAFT_CITY = "Lymhurst";
const ITEM = { id: "T4_TEST_ARMOR", craftType: "x", noReturn: false };
const MATERIALS = [{ matId: "T4_CLOTH", count: 8 }];
function market() {
  return {
    T4_CLOTH:      { Lymhurst: { buy_price: 1000, sell_price: 1100, volume_24h: 9999 } },
    T4_TEST_ARMOR: {
      Caerleon: { buy_price: 1, sell_price: 6000, volume_24h: 9999 },
      Lymhurst: { buy_price: 1, sell_price: 5000, volume_24h: 9999 },
    },
  };
}

// What renderCraftingTable builds for the cell: the checkbox route drives Pure
// Profit, the force-focus route drives the focus columns.
function per10k(focusCheckbox) {
  globalThis.__TEST_FOCUS__ = focusCheckbox;
  const results = computeCraftRoutesForCity(CRAFT_CITY, ITEM, MATERIALS, market());
  const focusResults = focusCheckbox
    ? results
    : computeCraftRoutesForCity(CRAFT_CITY, ITEM, MATERIALS, market(), true);
  const result = results[0];
  const focusResult = focusResults[0] || result;
  const { focusCost } = computeCraftFocusColumn(focusResult, ITEM, MATERIALS);
  const profitFocusOn = focusResult.marginInfo.profit;
  return {
    value: calculateProfitPer10kFocus(profitFocusOn, focusCost),
    displayProfit: result.marginInfo.profit,
    profitFocusOn,
    focusCost,
  };
}

console.log("\n=== Part 1: Crafting Profit / 10k Focus across the toggle ===");

test("fixture sanity: the displayed profit reacts to the checkbox", () => {
  const on = per10k(true), off = per10k(false);
  assert.ok(Math.abs(on.displayProfit - off.displayProfit) > 1e-6,
    `Pure Profit must move (on=${on.displayProfit}, off=${off.displayProfit})`);
});

test("Profit / 10k Focus is identical across the toggle", () => {
  const on = per10k(true), off = per10k(false);
  assert.ok(Math.abs(on.value - off.value) < 1e-6,
    `must be invariant (on=${on.value}, off=${off.value})`);
});

test("the figure is focus-ON profit × the whole crafts a bar buys", () => {
  const on = per10k(true);
  const crafts = Math.floor(10000 / on.focusCost);
  assert.ok(Math.abs(on.value - on.profitFocusOn * crafts) < 1e-6);
});

test("with focus OFF it is NOT the displayed profit × crafts", () => {
  const off = per10k(false);
  const crafts = Math.floor(10000 / off.focusCost);
  assert.ok(Math.abs(off.value - off.displayProfit * crafts) > 1e-6,
    "the checkbox profit must not be what the column multiplies");
});

// ── Part 2: call-site contract ──────────────────────────────────────────────
//
// Every per-10k figure in the app is built by calculateProfitPer10kFocus. Its
// first argument must be a focus-ON profit. The accepted names below are the
// focus-on values each renderer computes for exactly this purpose:
//   *FocusOn            — the force-focus route / candidate profit
//   focusProfit         — consumables: revenue − inputCostAtRrr(focusRrr)
//   focusCycleProfit    — mounts breeding: the focus-on saddler cycle
//   focusCombinedProfit — planner: focus-on craft profit + journal fill
//   profitPerBatch      — consumables chain rows: the batch priced at
//                         benchmarkRrr, which is focus-on by construction
//   profitPerCycleFocusOn — farming: the WATERED harvest cycle, built by
//                         calcFarmingEconomics regardless of `useWater`
const FOCUS_ON_OPERAND = /(FocusOn|focusProfit|focusCycleProfit|focusCombinedProfit|profitPerBatch)/;
const PER10K_CALLERS = [
  "js/render-transport.js",
  "js/render-crafting.js",
  "js/render-consumables.js",
  "js/render-mounts.js",
  "js/render-farming.js",
  "js/craft-planner-pricing.js",
];

console.log("\n=== Part 2: every per-10k call site is handed a focus-ON profit ===");

PER10K_CALLERS.forEach((f) => {
  const src = read(f);
  const args = [...src.matchAll(/calculateProfitPer10kFocus\(\s*([^,]+),/g)].map((m) => m[1].trim());

  test(`${f} builds its per-10k figure at least once`, () => {
    assert.ok(args.length > 0, "no calculateProfitPer10kFocus call found");
  });

  args.forEach((arg, i) => {
    test(`${f} call #${i + 1} passes a focus-ON profit (${arg.replace(/\s+/g, " ")})`, () => {
      assert.ok(!/marginInfo\.profit/.test(arg),
        "marginInfo.profit tracks the Use Focus checkbox — the column would move with it");
      assert.ok(FOCUS_ON_OPERAND.test(arg),
        "operand is not one of the renderers' focus-ON profits");
    });
  });
});

test("the Refining row publishes its focus-ON twins for downstream columns", () => {
  const src = read("js/refining-route.js");
  assert.ok(/function computeRefineFocusProfit\(/.test(src),
    "computeRefineFocusProfit is the shared source of the focus-ON profit");
  const transport = read("js/render-transport.js");
  ["profitFocusOn", "rrrFocusOn", "heartCostFocusOn"].forEach((field) => {
    assert.ok(new RegExp(field).test(transport), `row does not publish ${field}`);
  });
});

test("the Faction Spending FP column reads the focus-ON twins", () => {
  const src = read("js/faction-focus-value.js");
  assert.ok(/fpAdjustedProfitFocusOn/.test(src), "baby value still rides on the checkbox profit");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
