/**
 * Test: the Crafting table's "Silver/Focus" column reports what focus actually
 * BUYS, not the craft's whole profit divided by its focus cost.
 *
 * Focus only adds RRR, so a focus point is worth the extra material it returns:
 *   silver/focus = RRR-eligible material cost × (focusRRR − baseRRR) × (1+setup)
 *                  ÷ focus cost per craft
 * The old column was `Pure Profit ÷ focus cost`, an AVERAGE that credited focus
 * with profit the craft earns anyway — it read 67.9 on a row whose focus was
 * really worth 36.8, and disagreed with the Crafting Planner's Best Focus play
 * (which has always been marginal). Refining/Transports made the same move
 * first; this is the crafting-side twin of marginalSilverPerFocus.
 *
 * Black-box: load the REAL render-crafting.js, drive computeCraftRoutesForCity →
 * computeCraftFocusColumn, and check the number against the definition, plus the
 * properties that separate marginal from average (sell price and station fee are
 * irrelevant; material value and the RRR delta are everything).
 *
 * Run: node tests/crafting-silver-focus-marginal.test.cjs
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
const CITY_CRAFT_SPEC = {};
function isBlackRedZoneEnabled() { return true; }
function isValidSourceCity() { return true; }
function isFocusEnabled() { return true; }
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
let testCraftFocus = 100;
function getFocusCost() { return testCraftFocus; }
function getCraftFocusCost(id, tier) { return getFocusCost(id, tier, "crafting"); }
function getTierFromId(id) { const m = id.match(/^T(\\d+)/); return m ? parseInt(m[1], 10) : 4; }
let testStationFee = 0;
function calcStationFeeSilver() { return testStationFee; }
function refineStationFeeSilver() { return testStationFee; }
function calculateProfitPerFocus(profit, focusCost) { if (!focusCost || focusCost <= 0) return 0; return profit / focusCost; }
function marginalSilverPerFocus(rrrEligibleMatCost, baseRrr, focusRrr, focusCost) {
  if (!focusCost || focusCost <= 0) return 0;
  return (rrrEligibleMatCost * (focusRrr - baseRrr) * (1 + SETUP_FEE)) / focusCost;
}
function matsNeededFor10kFocus(focusCost, per, applyRrr, rrr) { const c = Math.floor(10000 / focusCost); const e = applyRrr ? per * (1 - (rrr || 0)) : per; return Math.round(c * e); }
function __setStationFee(v) { testStationFee = v || 0; }
function __setCraftFocus(v) { testCraftFocus = v; }
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }

const mod = new Module("crafting-silver-focus-marginal-test");
mod._compile(
  sandbox + loadFile("js/focus-play.js") + loadFile("js/render-crafting.js") +
    "\nmodule.exports = { computeCraftRoutesForCity, computeCraftFocusColumn, __setStationFee, __setCraftFocus };",
  "render-crafting.js",
);
const { computeCraftRoutesForCity, computeCraftFocusColumn, __setStationFee, __setCraftFocus } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { __setStationFee(0); __setCraftFocus(100); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const CRAFT_CITY = "Lymhurst";
const BASE_RRR = 0.18 / 1.18;
const FOCUS_RRR = 0.77 / 1.77;
const DELTA = FOCUS_RRR - BASE_RRR;

function market(matPrice = 1000, sellPrice = 50000, extra = {}) {
  return {
    T4_CLOTH:      { Lymhurst: { buy_price: matPrice, sell_price: matPrice + 100, volume_24h: 9999 } },
    T4_ARTEFACT_X: { Lymhurst: { buy_price: 5000, sell_price: 5100, volume_24h: 9999 } },
    T4_TEST_ARMOR: { Lymhurst: { buy_price: 1, sell_price: sellPrice, volume_24h: 9999 } },
    ...extra,
  };
}

function focusColumn(item, materials, md) {
  const route = computeCraftRoutesForCity(CRAFT_CITY, item, materials, md, true)[0];
  assert.ok(route, "fixture should produce a route");
  return computeCraftFocusColumn(route, item, materials);
}

const ITEM = { id: "T4_TEST_ARMOR", craftType: "x", noReturn: false };
const MATS = [{ matId: "T4_CLOTH", count: 8 }];

console.log("\n=== Silver/Focus = silver the focus itself buys ===");

test("equals eligible mat cost × RRR delta × (1+setup) ÷ focus cost", () => {
  const { profitPerFocus, focusCost } = focusColumn(ITEM, MATS, market());
  const expected = (8 * 1000 * DELTA * 1.025) / 100;
  assert.strictEqual(focusCost, 100);
  assert.ok(Math.abs(profitPerFocus - expected) < 1e-9,
    `expected ${expected.toFixed(4)}, got ${profitPerFocus.toFixed(4)}`);
});

test("is NOT the craft's profit per focus (the old average)", () => {
  const { profitPerFocus } = focusColumn(ITEM, MATS, market());
  const average = (50000 * (1 - 0.065) - 8 * 1000 * (1 - FOCUS_RRR) * 1.025) / 100;
  assert.ok(average > profitPerFocus * 5,
    `the average (${average.toFixed(1)}) should dwarf the marginal (${profitPerFocus.toFixed(1)}) on this fixture`);
});

console.log("\n=== What it must ignore ===");

test("the sell price does not move it", () => {
  const cheap = focusColumn(ITEM, MATS, market(1000, 20000)).profitPerFocus;
  const rich = focusColumn(ITEM, MATS, market(1000, 900000)).profitPerFocus;
  assert.ok(Math.abs(cheap - rich) < 1e-9, `sell price must not change it (${cheap} vs ${rich})`);
});

test("the station fee does not move it (flat silver, cancels out)", () => {
  const free = focusColumn(ITEM, MATS, market()).profitPerFocus;
  __setStationFee(9999);
  const paid = focusColumn(ITEM, MATS, market()).profitPerFocus;
  assert.ok(Math.abs(free - paid) < 1e-9, `station fee must not change it (${free} vs ${paid})`);
});

console.log("\n=== What it must track ===");

test("doubling the material price doubles it", () => {
  const a = focusColumn(ITEM, MATS, market(1000)).profitPerFocus;
  const b = focusColumn(ITEM, MATS, market(2000)).profitPerFocus;
  assert.ok(Math.abs(b - 2 * a) < 1e-9, `expected ${(2 * a).toFixed(4)}, got ${b.toFixed(4)}`);
});

test("doubling the focus cost halves it", () => {
  const a = focusColumn(ITEM, MATS, market()).profitPerFocus;
  __setCraftFocus(200);
  const b = focusColumn(ITEM, MATS, market()).profitPerFocus;
  assert.ok(Math.abs(b - a / 2) < 1e-9, `expected ${(a / 2).toFixed(4)}, got ${b.toFixed(4)}`);
});

console.log("\n=== Non-returnable materials and no-return crafts ===");

test("artifact materials are excluded — focus never returns them", () => {
  const withArtifact = [{ matId: "T4_CLOTH", count: 8 }, { matId: "T4_ARTEFACT_X", count: 1 }];
  const spf = focusColumn(ITEM, withArtifact, market()).profitPerFocus;
  const expected = (8 * 1000 * DELTA * 1.025) / 100; // the 5,000 artifact contributes nothing
  assert.ok(Math.abs(spf - expected) < 1e-9,
    `artifact must not raise it (expected ${expected.toFixed(4)}, got ${spf.toFixed(4)})`);
});

test("a no-return craft (combine) is worth 0 per focus", () => {
  const combine = { id: "T4_TEST_ARMOR", craftType: "x", noReturn: true };
  const { profitPerFocus } = focusColumn(combine, MATS, market());
  assert.strictEqual(profitPerFocus, 0);
});

test("no focus cost → 0, never a divide-by-zero", () => {
  __setCraftFocus(0);
  const { profitPerFocus, focusCost } = focusColumn(ITEM, MATS, market());
  assert.strictEqual(focusCost, 0);
  assert.strictEqual(profitPerFocus, 0);
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
