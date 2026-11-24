/**
 * Test: computeTransmuteAcquireCosts charges each produced step its station
 * usage fee.
 *
 * The acquire DP decides whether a node is cheaper to BUY or to PRODUCE, and the
 * Transmute table hides any row whose start is cheaper to produce. It used to
 * relax with the fixed transmute silver alone, while priceTransmuteRoute charged
 * the station fee on the very same step — so produce always looked cheaper than
 * it is, and the verdict (and the hiding) ran on an understated cost.
 *
 * Station fee here is stubbed flat per step so expectations stay readable; the
 * measured nutrition grid is covered by tests/transmute-station-fee.
 *
 * Run: node tests/transmute-acquire-station-fee.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const STEP_STATION_FEE = 100;
const stubs = `
const SETUP_FEE = 0.025;
function isSuspectMargin(m){ return Number.isFinite(m) && m > MAX_MARGIN_PERCENT; }
function suspectMarginBadge(){ return ""; }
function getIQRBounds(){ return null; }
function getBuyPrice(data, city){ return data && data[city] ? (data[city].buy || 0) : 0; }
function getOverridePrice(){ return null; }
// Flat per-step charge: one call per transmute step.
function calcStationFeeSilver(){ return ${STEP_STATION_FEE}; }
`;

const mod = new Module("transmute-acquire-station-fee");
mod._compile(
  stubs + J("resource-names.js") + J("data-transmute.js") + J("render-transmute.js") +
    "\nmodule.exports = { computeTransmuteAcquireCosts, TRANSMUTE_TIERUP_COST, " +
    "TRANSMUTE_ENCHANTUP_COST, TRANSMUTE_STONE_TIERUP_COST };",
  "ta.js",
);
const {
  computeTransmuteAcquireCosts, TRANSMUTE_TIERUP_COST,
  TRANSMUTE_ENCHANTUP_COST, TRANSMUTE_STONE_TIERUP_COST,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Transmute acquire costs — station fee\n");

const marketData = {
  "T8_WOOD_LEVEL1@1": { Thetford: { buy: 1000, volume_24h: 99 } },
  "T8_WOOD_LEVEL3@3": { Thetford: { buy: 999999, volume_24h: 99 } },
  T7_WOOD: { Thetford: { buy: 400, volume_24h: 99 } },
  T8_WOOD: { Thetford: { buy: 999999, volume_24h: 99 } },
  T7_ROCK: { Thetford: { buy: 300, volume_24h: 99 } },
  // 8.1 ore: producing from 8.0 costs 1,025 + 14,400 (+ fee); buying costs
  // 15,100 × 1.025 = 15,477.5 — between the two, so buy wins ONLY once the
  // station fee is counted.
  T8_ORE: { Thetford: { buy: 1000, volume_24h: 99 } },
  "T8_ORE_LEVEL1@1": { Thetford: { buy: 15100, volume_24h: 99 } },
};
const acq = computeTransmuteAcquireCosts(marketData, ["Thetford"], 0);

test("a bought node is unaffected by the station fee", () => {
  assert.strictEqual(acq["T8_WOOD_LEVEL1@1"].cost, 1025);
  assert.strictEqual(acq["T8_WOOD_LEVEL1@1"].produced, false);
});

test("one produced step costs pred + silver + station fee", () => {
  // 8.0 wood = acq(7.0) + TIERUP[8][0] + fee = 410 + 5000 + 100
  const a = acq.T8_WOOD;
  assert.strictEqual(a.produced, true);
  assert.strictEqual(a.cost, 410 + TRANSMUTE_TIERUP_COST[8][0] + STEP_STATION_FEE);
});

test("each step of a chain pays its own station fee", () => {
  // 8.2 = acq(8.1) + 45,360 + fee ; 8.3 = that + 149,688 + fee
  const c82 = 1025 + TRANSMUTE_ENCHANTUP_COST[8][2] + STEP_STATION_FEE;
  const c83 = c82 + TRANSMUTE_ENCHANTUP_COST[8][3] + STEP_STATION_FEE;
  assert.strictEqual(acq["T8_WOOD_LEVEL2@2"].cost, c82);
  assert.strictEqual(acq["T8_WOOD_LEVEL3@3"].cost, c83);
  assert.strictEqual(acq["T8_WOOD_LEVEL3@3"].produced, true);
});

test("stone tier-up pays it too", () => {
  assert.strictEqual(
    acq.T8_ROCK.cost, 307.5 + TRANSMUTE_STONE_TIERUP_COST[8] + STEP_STATION_FEE);
});

test("the fee can flip a produce verdict back to buy", () => {
  // produce = 1,025 + 14,400 + 100 = 15,525 ; buy = 15,100 * 1.025 = 15,477.5
  // (without the fee, produce at 15,425 would have won)
  const a = acq["T8_ORE_LEVEL1@1"];
  assert.strictEqual(a.produced, false, "buying is cheaper once the step is fully charged");
  assert.ok(Math.abs(a.cost - 15100 * 1.025) < 1e-6, `got ${a.cost}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
