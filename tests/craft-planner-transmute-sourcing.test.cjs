/**
 * Test: the Craft Planner can feed a self-refine with a TRANSMUTED raw.
 *
 * Reported: the planner's "Materials (refine ▲ vs buy)" column only ever showed
 * two answers — buy the bar, or refine it yourself off market raws. It never
 * offered "buy a cheaper node and transmute it up", the path the Refining /
 * Transports table has had at row level since js/refining-transmute-substitute.js.
 * That matters most on the enchanted rows: a refined id (T6_PLANKS_LEVEL2@2)
 * cannot be transmuted at all, so the only place an enchant-up can happen is the
 * RAW leg inside the chain — which was hard-coded to market-only.
 *
 * The behaviour is GATED: buildRefiningChain / getRefiningSourcing take a
 * trailing `opts` and only substitute when `opts.transmuteRaw` is set. The
 * Refining / Transports table passes nothing and must stay byte-identical — it
 * already substitutes on its own top-level raw, and its chain is the
 * refine-the-secondary sub-tree.
 *
 * Black-box: real js/refining-chain-pricing.js + js/refining-transmute-substitute.js
 * + the real fee tables in js/data-transmute.js, over synthetic prices. The
 * recipe map is a hand-written stand-in with the same shape the real generator
 * emits (js/refining-chain-recipes.js). No live API or DB.
 *
 * Run: node tests/craft-planner-transmute-sourcing.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const SETUP_FEE = 0.025;
let testCityForce = {}, testOverrides = {}, testStationRate = 0, testRefineStationFee = 0;
function isBlackRedZoneEnabled() { return true; }
function isValidSourceCity() { return true; }
function getOverridePrice(itemId, city) { return testOverrides[itemId + ":" + city] ?? null; }
function getCityForce(itemId, side) { return testCityForce[itemId]?.[side] ?? null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function legBrecilienCost() { return 0; }
function getStationFeeInput() { return testStationRate; }
function calcStationFeeSilver(tier, mats, nutritionOverride = null) {
  const nutrition = nutritionOverride != null ? nutritionOverride : mats * 14 * Math.pow(2, tier - 4) * 0.1125;
  return (getStationFeeInput() / 100) * nutrition;
}
function refineStationFeeSilver() { return testRefineStationFee; }
function getRefineRRR() { return 0; }
function getFocusCost(matId, tier) { return tier * 100; }
function resourceShortName(id) { return id; }
const MIN_CHAIN_TIER = 4;
const HEART_BY_RESOURCE = { wood: "T1_FACTION_FOREST_TOKEN_1" };
// Same shape as the real generator (js/refining-chain-recipes.js): T4.X consumes
// PLAIN T3, T5+.X inherits the parent's enchant on the secondary.
const REFINING_RECIPES = {
  T4_PLANKS: { rawId: "T4_WOOD", rawRatio: 2, secondaryMatId: "T3_PLANKS", secondaryMatCount: 1, resourceType: "wood", tier: 4, enchant: 0 },
  T5_PLANKS: { rawId: "T5_WOOD", rawRatio: 3, secondaryMatId: "T4_PLANKS", secondaryMatCount: 1, resourceType: "wood", tier: 5, enchant: 0 },
  T6_PLANKS: { rawId: "T6_WOOD", rawRatio: 4, secondaryMatId: "T5_PLANKS", secondaryMatCount: 1, resourceType: "wood", tier: 6, enchant: 0 },
  "T5_PLANKS_LEVEL2@2": { rawId: "T5_WOOD_LEVEL2@2", rawRatio: 3, secondaryMatId: "T4_PLANKS_LEVEL2@2", secondaryMatCount: 1, resourceType: "wood", tier: 5, enchant: 2 },
  "T6_PLANKS_LEVEL2@2": { rawId: "T6_WOOD_LEVEL2@2", rawRatio: 4, secondaryMatId: "T5_PLANKS_LEVEL2@2", secondaryMatCount: 1, resourceType: "wood", tier: 6, enchant: 2 },
};
function __setOverrides(m) { testOverrides = m || {}; }
function __setForce(m) { testCityForce = m || {}; }
function __setStationRate(r) { testStationRate = r || 0; }
function __setRefineStationFee(f) { testRefineStationFee = f || 0; }
function __reset() { __setOverrides({}); __setForce({}); __setStationRate(0); __setRefineStationFee(0); }
`;

const load = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const mod = new Module("craft-planner-transmute-sourcing");
mod._compile(
  sandbox +
    load("js/data-transmute.js") +
    load("js/refining-chain-pricing.js") +
    load("js/refining-transmute-substitute.js") +
    "\nmodule.exports = { buildRefiningChain, getRefiningSourcing, getRefiningChainIds," +
    " chainHasOverride, chainSilverCostWithFocusAtTier, getRawTransmuteSourcing," +
    " TRANSMUTE_ENCHANTUP_COST, TRANSMUTE_TIERUP_COST," +
    " __setOverrides, __setForce, __setStationRate, __setRefineStationFee, __reset };",
  "craft-planner-transmute-sourcing.js"
);
const {
  buildRefiningChain, getRefiningSourcing, getRefiningChainIds, chainHasOverride,
  chainSilverCostWithFocusAtTier, TRANSMUTE_ENCHANTUP_COST, TRANSMUTE_TIERUP_COST,
  __setOverrides, __setStationRate, __setRefineStationFee, __reset,
} = mod.exports;

const ON = { transmuteRaw: true };
const CITY = "Martlock";

let passed = 0, failed = 0;
function test(name, fn) {
  try { __reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
function priceMap(entries) {
  const out = {};
  for (const e of entries) { (out[e.id] ||= {})[e.city || CITY] = { buy_price: e.buy, volume_24h: 9999 }; }
  return out;
}
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: expected ${b}, got ${a}`);
const rawSrc = (chain) => chain.inputs[0].sourcing;

// Prices where the .2 raw is dear and the .1 node one enchant below is cheap:
// buying T6.1 wood at 4,000 and paying the 6,000 enchant-up fee lands at 10,000
// against a 30,000 sticker for T6.2 wood.
const ENCH_FEE_T6_2 = TRANSMUTE_ENCHANTUP_COST[6][2];
const ENCHANT_CASE = () => priceMap([
  { id: "T6_WOOD_LEVEL2@2", buy: 30_000 },
  { id: "T6_WOOD_LEVEL1@1", buy: 4_000 },
  { id: "T6_WOOD", buy: 3_900_000 },          // plain node is no help here
  { id: "T5_WOOD_LEVEL2@2", buy: 3_900_000 },
  { id: "T5_PLANKS_LEVEL2@2", buy: 40_000 },  // bought secondary, no sub-chain
  { id: "T4_PLANKS_LEVEL2@2", buy: 40_000 },
]);

console.log("\n=== The gate ===");

test("without opts the raw leg stays market-only (Refining table is untouched)", () => {
  const chain = buildRefiningChain("T6_PLANKS_LEVEL2@2", ENCHANT_CASE(), CITY, false, 0);
  assert.strictEqual(rawSrc(chain).source, "market");
  assert.strictEqual(rawSrc(chain).perUnit, 30_000);
});

test("with opts.transmuteRaw the raw leg becomes a transmute route", () => {
  const chain = buildRefiningChain("T6_PLANKS_LEVEL2@2", ENCHANT_CASE(), CITY, false, 0, ON);
  const src = rawSrc(chain);
  assert.strictEqual(src.source, "transmute", `expected a transmute route, got ${src.source}`);
  assert.strictEqual(src.transmute.startId, "T6_WOOD_LEVEL1@1");
  close(src.perUnit, 4_000 + ENCH_FEE_T6_2, "per-unit raw cost");
});

test("an explicit opts.transmuteRaw:false behaves exactly like no opts at all", () => {
  const a = buildRefiningChain("T6_PLANKS_LEVEL2@2", ENCHANT_CASE(), CITY, false, 0);
  const b = buildRefiningChain("T6_PLANKS_LEVEL2@2", ENCHANT_CASE(), CITY, false, 0, { transmuteRaw: false });
  close(b.costPerOutput, a.costPerOutput, "cost with the gate explicitly off");
  assert.strictEqual(rawSrc(b).source, "market");
});

console.log("\n=== Cost basis ===");

test("the transmuted raw is RRR-eligible and priced into costPerOutput", () => {
  const md = ENCHANT_CASE();
  const chain = buildRefiningChain("T6_PLANKS_LEVEL2@2", md, CITY, false, 0, ON);
  const expectedRaw = (4_000 + ENCH_FEE_T6_2) * 4;   // rawRatio 4, no travel on top
  const expectedSec = 40_000 * 1;
  // The transmute silver is consumed like the rest but was never bought at
  // market, so only the bought start pays the setup fee.
  const transmuteSilver = ENCH_FEE_T6_2 * 4;
  close(chain.costPerOutput,
    (expectedRaw + expectedSec - transmuteSilver) * 1.025 + transmuteSilver,
    "chain cost per output");
  close(chain.feePerOutput, transmuteSilver, "setup-exempt component");
});

test("no travel fee is charged twice — the route's own fee is inside perUnit", () => {
  const chain = buildRefiningChain("T6_PLANKS_LEVEL2@2", ENCHANT_CASE(), CITY, false, 0, ON);
  assert.strictEqual(rawSrc(chain).travelFeePerUnit || 0, 0);
});

test("station usage fees on each transmute step are inside perUnit", () => {
  __setStationRate(1000);
  const chain = buildRefiningChain("T6_PLANKS_LEVEL2@2", ENCHANT_CASE(), CITY, false, 0, ON);
  const src = rawSrc(chain);
  assert.strictEqual(src.source, "transmute");
  const steps = src.transmute.steps;
  assert.ok(steps.some((s) => s.stationFee > 0), "a non-zero station rate must reach the steps");
  close(src.perUnit, 4_000 + steps.reduce((s, x) => s + x.fee + x.stationFee, 0), "per-unit with station fees");
});

test("chainSilverCostWithFocusAtTier reuses the transmuted raw (no re-query)", () => {
  const chain = buildRefiningChain("T6_PLANKS_LEVEL2@2", ENCHANT_CASE(), CITY, false, 0, ON);
  close(chainSilverCostWithFocusAtTier(chain, -1), chain.costPerOutput, "focus-off recompute");
});

console.log("\n=== When NOT to substitute ===");

test("a cheap raw is bought outright even with the gate open", () => {
  const md = priceMap([
    { id: "T6_WOOD_LEVEL2@2", buy: 5_000 },
    { id: "T6_WOOD_LEVEL1@1", buy: 4_000 },   // + 6,000 fee = 10,000 > 5,000
    { id: "T5_PLANKS_LEVEL2@2", buy: 40_000 },
  ]);
  const chain = buildRefiningChain("T6_PLANKS_LEVEL2@2", md, CITY, false, 0, ON);
  assert.strictEqual(rawSrc(chain).source, "market");
  assert.strictEqual(rawSrc(chain).perUnit, 5_000);
});

test("a plain (.0) raw with no cheaper tier below is bought outright", () => {
  const md = priceMap([
    { id: "T6_WOOD", buy: 900 },
    { id: "T5_WOOD", buy: 5_000 },
    { id: "T5_PLANKS", buy: 20_000 },
  ]);
  const chain = buildRefiningChain("T6_PLANKS", md, CITY, false, 0, ON);
  assert.strictEqual(rawSrc(chain).source, "market");
});

test("a tier-up beats a dear plain raw when the tier below is cheap", () => {
  const md = priceMap([
    { id: "T6_WOOD", buy: 900_000 },
    { id: "T5_WOOD", buy: 1_000 },
    { id: "T4_WOOD", buy: 900_000 },
    { id: "T5_PLANKS", buy: 20_000 },
  ]);
  const chain = buildRefiningChain("T6_PLANKS", md, CITY, false, 0, ON);
  const src = rawSrc(chain);
  assert.strictEqual(src.source, "transmute");
  assert.strictEqual(src.transmute.startId, "T5_WOOD");
  close(src.perUnit, 1_000 + TRANSMUTE_TIERUP_COST[6][0], "tier-up per-unit");
});

console.log("\n=== An unlisted raw must not kill the chain ===");

test("no market listing for the raw at all, but a transmute route exists", () => {
  const md = priceMap([
    { id: "T6_WOOD_LEVEL1@1", buy: 4_000 },
    { id: "T5_PLANKS_LEVEL2@2", buy: 40_000 },
  ]);
  assert.strictEqual(
    buildRefiningChain("T6_PLANKS_LEVEL2@2", md, CITY, false, 0),
    null,
    "precondition: without the gate an unpriced raw still kills the chain"
  );
  const chain = buildRefiningChain("T6_PLANKS_LEVEL2@2", md, CITY, false, 0, ON);
  assert.ok(chain, "the gate must let a transmute-only raw build a chain");
  assert.strictEqual(rawSrc(chain).source, "transmute");
});

test("neither a market price nor a transmute route still returns null", () => {
  const md = priceMap([{ id: "T5_PLANKS_LEVEL2@2", buy: 40_000 }]);
  assert.strictEqual(buildRefiningChain("T6_PLANKS_LEVEL2@2", md, CITY, false, 0, ON), null);
});

console.log("\n=== opts threading ===");

test("getRefiningSourcing passes the gate down to the chain", () => {
  const md = ENCHANT_CASE();
  md["T6_PLANKS_LEVEL2@2"] = { [CITY]: { buy_price: 9_000_000, volume_24h: 9999 } };
  const off = getRefiningSourcing("T6_PLANKS_LEVEL2@2", md, CITY, false, 0);
  const on = getRefiningSourcing("T6_PLANKS_LEVEL2@2", md, CITY, false, 0, ON);
  assert.strictEqual(off.source, "chain");
  assert.strictEqual(on.source, "chain");
  assert.strictEqual(rawSrc(off.chain).source, "market");
  assert.strictEqual(rawSrc(on.chain).source, "transmute");
  assert.ok(on.perUnit < off.perUnit, "the transmute route must lower the chain cost");
});

test("the gate reaches a RECURSIVE secondary's own raw leg", () => {
  const md = priceMap([
    { id: "T6_WOOD_LEVEL2@2", buy: 30_000 },
    { id: "T6_WOOD_LEVEL1@1", buy: 4_000 },
    { id: "T5_PLANKS_LEVEL2@2", buy: 9_000_000 },   // dear bar → refine it too
    { id: "T5_WOOD_LEVEL2@2", buy: 30_000 },
    { id: "T5_WOOD_LEVEL1@1", buy: 4_000 },
    { id: "T4_PLANKS_LEVEL2@2", buy: 40_000 },
  ]);
  const chain = buildRefiningChain("T6_PLANKS_LEVEL2@2", md, CITY, false, 0, ON);
  const sec = chain.inputs[1].sourcing;
  assert.strictEqual(sec.source, "chain", "precondition: the secondary is self-refined");
  assert.strictEqual(rawSrc(sec.chain).source, "transmute",
    "the sub-chain's raw leg never saw the gate");
});

console.log("\n=== Bookkeeping around a transmuted raw ===");

test("chainHasOverride sees an override on the bought start node", () => {
  const md = ENCHANT_CASE();
  const chain = buildRefiningChain("T6_PLANKS_LEVEL2@2", md, CITY, false, 0, ON);
  assert.strictEqual(chainHasOverride(chain), false, "precondition: nothing is overridden yet");
  __setOverrides({ [`T6_WOOD_LEVEL1@1:${CITY}`]: 4_000 });
  const chain2 = buildRefiningChain("T6_PLANKS_LEVEL2@2", ENCHANT_CASE(), CITY, false, 0, ON);
  assert.strictEqual(chainHasOverride(chain2), true,
    "an override on the transmute start node must count as an override");
});

test("getRefiningChainIds adds the transmute grid only when gated on", () => {
  const off = getRefiningChainIds("T6_PLANKS_LEVEL2@2");
  const on = getRefiningChainIds("T6_PLANKS_LEVEL2@2", undefined, ON);
  assert.ok(!off.has("T6_WOOD_LEVEL1@1"), "the ungated id set must not grow");
  assert.ok(on.has("T6_WOOD_LEVEL1@1"), "the DP reads zeros unless its grid is pre-fetched");
  assert.ok(on.has("T5_WOOD_LEVEL2@2"), "the tier-down predecessor is part of the grid");
  for (const id of off) assert.ok(on.has(id), `${id} was dropped from the gated id set`);
});

test("a refine station fee still lands on top of a transmuted chain", () => {
  __setRefineStationFee(1_234);
  const chain = buildRefiningChain("T6_PLANKS_LEVEL2@2", ENCHANT_CASE(), CITY, false, 0, ON);
  const mats = (4_000 + ENCH_FEE_T6_2) * 4 + 40_000;
  const transmuteSilver = ENCH_FEE_T6_2 * 4;          // setup-exempt, like the station fee
  close(chain.costPerOutput,
    (mats - transmuteSilver) * 1.025 + transmuteSilver + 1_234,
    "chain cost with a station fee");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
