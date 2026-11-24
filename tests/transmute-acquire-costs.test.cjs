/**
 * Test: computeTransmuteAcquireCosts — cheapest all-in cost to OBTAIN each
 * resource node, either by buying it at market or by transmuting up from a
 * cheaper-acquired lower node (produce-or-buy).
 *
 * This drives the "value the start material at min(buy, produce)" behavior: a
 * transmute row never assumes you bought an expensive intermediate when you
 * could buy a cheap base and transmute up. cost = bought ? price*(1+setup)
 * : acquire(pred) + stepFee. Topological over tier↑ then enchant↑.
 *
 * Black-box: real resource-names + data-transmute + render-transmute in a Module
 * with stubbed pricing helpers and synthetic marketData. No DOM, no live API.
 *
 * Run: node tests/transmute-acquire-costs.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const SETUP_FEE = 0.025;
function isSuspectMargin(m){ return Number.isFinite(m) && m > MAX_MARGIN_PERCENT; }
function suspectMarginBadge(){ return ""; }
function getIQRBounds(){ return null; }
function getBuyPrice(data, city){ return data && data[city] ? (data[city].buy || 0) : 0; }
function getOverridePrice(){ return null; }
`;

const sources = J("resource-names.js") + J("data-transmute.js") + J("render-transmute.js");
const mod = new Module("transmute-acquire");
mod._compile(stubs + sources + "\nmodule.exports = { computeTransmuteAcquireCosts };", "ta.js");
const { computeTransmuteAcquireCosts } = mod.exports;

// Real fees (from data-transmute.js): ENCHANTUP[8]={1:14400,2:45360,3:149688,4:784440}
// TIERUP[8][0]=5000, STONE_TIERUP[8]=16292.
const marketData = {
  // WOOD: a cheap 8.1 base, everything above unpriced or expensive → produced.
  "T8_WOOD_LEVEL1@1": { Thetford: { buy: 1000,   volume_24h: 99 } }, // 8.1 (cheap)
  "T8_WOOD_LEVEL3@3": { Thetford: { buy: 999999, volume_24h: 99 } }, // 8.3 (expensive → produce)
  T7_WOOD:            { Thetford: { buy: 400,    volume_24h: 99 } }, // 7.0 (cheap base for tier-up)
  T8_WOOD:            { Thetford: { buy: 999999, volume_24h: 99 } }, // 8.0 (expensive → produce from 7.0)
  // ORE: 8.2 cheaper to BUY than to produce from 8.1.
  "T8_ORE_LEVEL1@1":  { Thetford: { buy: 1000, volume_24h: 99 } },   // 8.1
  "T8_ORE_LEVEL2@2":  { Thetford: { buy: 100,  volume_24h: 99 } },   // 8.2 (cheap to buy)
  // ROCK: tier-only, no enchant nodes.
  T7_ROCK:            { Thetford: { buy: 300, volume_24h: 99 } },    // 7 rock
};

const acq = computeTransmuteAcquireCosts(marketData, ["Thetford"], 0);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Transmute acquire costs\n");

test("a node with only market data is bought: price*(1+setup)", () => {
  const a = acq["T8_WOOD_LEVEL1@1"];
  assert.ok(a, "missing 8.1 wood");
  assert.strictEqual(a.cost, 1025);          // 1000 * 1.025
  assert.strictEqual(a.produced, false);
  assert.strictEqual(a.city, "Thetford");
});

test("an expensive node is PRODUCED by enchant-up from the cheap base", () => {
  // 8.2 = acq(8.1)+45360 = 46385 ; 8.3 = 46385+149688 = 196073 (< buy 999999*1.025)
  const a3 = acq["T8_WOOD_LEVEL3@3"];
  assert.ok(a3, "missing 8.3 wood");
  assert.strictEqual(a3.cost, 196073);
  assert.strictEqual(a3.produced, true);
  assert.strictEqual(a3.viaId, "T8_WOOD_LEVEL2@2");
});

test("an unpriced higher node chains through produced predecessors", () => {
  // 8.4 = acq(8.3)+784440 = 196073+784440 = 980513
  const a4 = acq["T8_WOOD_LEVEL4@4"];
  assert.ok(a4, "missing 8.4 wood");
  assert.strictEqual(a4.cost, 980513);
  assert.strictEqual(a4.produced, true);
});

test("produce via TIER-up when the lower tier is cheaper than buying", () => {
  // 8.0 = acq(7.0)+TIERUP[8][0] = 410 + 5000 = 5410  (< buy 999999*1.025)
  const a = acq["T8_WOOD"];
  assert.ok(a, "missing 8.0 wood");
  assert.strictEqual(a.cost, 5410);
  assert.strictEqual(a.produced, true);
  assert.strictEqual(a.viaId, "T7_WOOD");
});

test("buy wins over produce when the market is cheaper", () => {
  // 8.2 ore: buy 100*1.025≈102.5 vs produce acq(8.1)+45360=46385 → buy.
  const a = acq["T8_ORE_LEVEL2@2"];
  assert.ok(a, "missing 8.2 ore");
  assert.ok(Math.abs(a.cost - 102.5) < 1e-6, `expected ~102.5, got ${a.cost}`);
  assert.strictEqual(a.produced, false);
});

test("bought node exposes raw market price for display", () => {
  assert.strictEqual(acq["T8_WOOD_LEVEL1@1"].marketPrice, 1000);
  assert.strictEqual(acq["T8_WOOD_LEVEL3@3"].marketPrice, null); // produced → no market price
});

test("stone is tier-only: no enchant nodes, tier-up produced", () => {
  // 8 rock = acq(7 rock)+STONE_TIERUP[8] = 307.5 + 16292 = 16599.5
  assert.strictEqual(acq["T8_ROCK"].cost, 16599.5);
  assert.strictEqual(acq["T8_ROCK"].produced, true);
  assert.strictEqual(acq["T8_ROCK"].viaId, "T7_ROCK");
  assert.strictEqual(acq["T8_ROCK_LEVEL1@1"], undefined); // no enchanted stone
});

test("a node with neither market data nor a producible predecessor is absent", () => {
  // FIBER has no market data at all → nothing acquirable.
  assert.strictEqual(acq["T8_FIBER"], undefined);
  assert.strictEqual(acq["T5_FIBER_LEVEL2@2"], undefined);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
