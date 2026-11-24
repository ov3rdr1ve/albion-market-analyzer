/**
 * Test: refining transmute substitution — instead of buying the refine's RAW
 * resource at market, buy a cheaper lower node of the same family and transmute
 * it up (tier-up and/or enchant-up) to the raw the recipe needs.
 *
 * KEY RULES:
 *  - The transmuted raw IS a normal raw unit: it is RRR-eligible (unlike the
 *    faction heart) and it replaces ALL rawRatio units, not just one.
 *  - Per-unit cost = start market price (+ Brecilien exit fee) + Σ transmute
 *    silver + Σ station usage fee. Cheapest path wins (grid DP over tier×enchant).
 *  - Stone: tier-up at enchant 0 only — no enchant axis, so enchanted rock has
 *    no transmute path.
 *  - The substitute is used only when it beats the raw's own effective market buy.
 *
 * Run: node tests/refining-transmute-substitute.test.cjs
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
let testBmrEnabled = false, testCityForce = {}, testOverrides = {}, testStationRate = 0;
let testBrecFee = 0;
function isBlackRedZoneEnabled() { return testBmrEnabled; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function getOverridePrice(itemId, city) { return testOverrides[itemId + ":" + city] ?? null; }
function getCityForce(itemId, side) { return testCityForce[itemId]?.[side] ?? null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
// Brecilien exit fee stand-in: flat per-unit charge when hauling OUT of Brecilien.
function legBrecilienCost(from, to, itemId, units) {
  return from === "Brecilien" && to !== "Brecilien" ? testBrecFee * units : 0;
}
function getStationFeeInput() { return testStationRate; }
function calcStationFeeSilver(tier, nonArtifactMats, nutritionOverride = null) {
  const ivPerMat = 14 * Math.pow(2, tier - 4);
  const itemValue = nonArtifactMats * ivPerMat;
  const nutrition = nutritionOverride != null ? nutritionOverride : itemValue * 0.1125;
  return (getStationFeeInput() / 100) * nutrition;
}
function resourceShortName(id) { return id; }
function __setBMR(v) { testBmrEnabled = !!v; }
function __setOverrides(m) { testOverrides = m || {}; }
function __setForce(m) { testCityForce = m || {}; }
function __setStationRate(r) { testStationRate = r || 0; }
function __setBrecFee(f) { testBrecFee = f || 0; }
function __reset() { __setBMR(false); __setOverrides({}); __setForce({}); __setStationRate(0); __setBrecFee(0); }
// Minimal REFINING_RECIPES stub: refining-chain-pricing.js only reads it for the
// chain path, which these tests never enter.
const REFINING_RECIPES = {};
const MIN_CHAIN_TIER = 4;
function getRefineRRR() { return 0; }
function getFocusCost() { return 0; }
`;

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const mod = new Module("refining-transmute-test");
mod._compile(
  sandbox +
    loadFile("js/data-transmute.js") +
    loadFile("js/refining-chain-pricing.js") +
    loadFile("js/refining-transmute-substitute.js") +
    "\nmodule.exports = { getRawTransmuteSourcing, resolveRefineRawSource, " +
    "parseTransmuteNode, TRANSMUTE_NUTRITION_PER_SILVER, TRANSMUTE_STATION_FEE_REF_RATE, " +
    "TRANSMUTE_ENCHANTUP_STATIONFEE, __setBMR, __setOverrides, __setForce, __setStationRate, __setBrecFee, __reset };",
  "refining-transmute-substitute.js",
);
const M = mod.exports;
const {
  getRawTransmuteSourcing, resolveRefineRawSource, parseTransmuteNode,
  __setBMR, __setStationRate, __setBrecFee, __reset,
} = M;

let passed = 0, failed = 0;
function test(name, fn) {
  try { __reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
function priceMap(entries) {
  const out = {};
  for (const e of entries) { (out[e.id] ||= {})[e.city] = { buy_price: e.buy, volume_24h: 9999 }; }
  return out;
}

const MARTLOCK = "Martlock";
const FS = "Fort Sterling";

// Fee tables (data-transmute.js) used to build expected values.
const ENCH_T6 = { 1: 3000, 2: 6000, 3: 19800, 4: 79200 };
const TIER_T8_E0 = 5000;
const STONE_T8 = 16292;

// ── id parsing ───────────────────────────────────────────────────────────────
console.log("\n=== parseTransmuteNode ===");
test("parses plain + enchanted resource ids", () => {
  assert.deepStrictEqual(parseTransmuteNode("T6_HIDE"), { family: "HIDE", tier: 6, enchant: 0 });
  assert.deepStrictEqual(parseTransmuteNode("T6_HIDE_LEVEL4@4"), { family: "HIDE", tier: 6, enchant: 4 });
  assert.deepStrictEqual(parseTransmuteNode("T5_ROCK"), { family: "ROCK", tier: 5, enchant: 0 });
});
test("null for refined / non-resource / unknown ids", () => {
  assert.strictEqual(parseTransmuteNode("T6_LEATHER"), null);
  assert.strictEqual(parseTransmuteNode("T1_FACTION_STEPPE_TOKEN_1"), null);
  assert.strictEqual(parseTransmuteNode("T4_PLANKS_LEVEL2@2"), null);
  assert.strictEqual(parseTransmuteNode(undefined), null);
});

// ── single-step enchant-up ───────────────────────────────────────────────────
console.log("\n=== enchant-up substitution ===");
test("6.3 hide + 79,200 fee beats a 121,995 6.4 hide", () => {
  const md = priceMap([
    { id: "T6_HIDE_LEVEL4@4", city: FS, buy: 121995 },
    { id: "T6_HIDE_LEVEL3@3", city: FS, buy: 20000 },
  ]);
  const t = getRawTransmuteSourcing("T6_HIDE_LEVEL4@4", md, MARTLOCK);
  assert.ok(t, "expected a transmute path");
  assert.strictEqual(t.source, "transmute");
  assert.strictEqual(t.startId, "T6_HIDE_LEVEL3@3");
  assert.strictEqual(t.startCity, FS);
  assert.strictEqual(t.steps.length, 1);
  assert.strictEqual(t.perUnit, 20000 + ENCH_T6[4]);
});
test("no path when the raw is cheaper at market than any transmute route", () => {
  const md = priceMap([
    { id: "T6_HIDE_LEVEL4@4", city: FS, buy: 50000 },
    { id: "T6_HIDE_LEVEL3@3", city: FS, buy: 20000 },   // 20k + 79.2k = 99.2k > 50k
  ]);
  assert.strictEqual(getRawTransmuteSourcing("T6_HIDE_LEVEL4@4", md, MARTLOCK), null);
});
test("path is offered when the raw has NO market price at all", () => {
  const md = priceMap([{ id: "T6_HIDE_LEVEL3@3", city: FS, buy: 20000 }]);
  const t = getRawTransmuteSourcing("T6_HIDE_LEVEL4@4", md, MARTLOCK);
  assert.ok(t && t.perUnit === 20000 + ENCH_T6[4]);
});
test("null when neither the raw nor any predecessor is priced", () => {
  assert.strictEqual(getRawTransmuteSourcing("T6_HIDE_LEVEL4@4", priceMap([]), MARTLOCK), null);
});

// ── multi-step / cheapest-path DP ────────────────────────────────────────────
console.log("\n=== cheapest path (grid DP) ===");
test("chooses the 2-step 6.2 → 6.3 → 6.4 start when it is cheapest", () => {
  const md = priceMap([
    { id: "T6_HIDE_LEVEL4@4", city: FS, buy: 300000 },
    { id: "T6_HIDE_LEVEL3@3", city: FS, buy: 99000 },   // 99,000 + 79,200 = 178,200
    { id: "T6_HIDE_LEVEL2@2", city: FS, buy: 50000 },   // 50,000 + 19,800 + 79,200 = 149,000
  ]);
  const t = getRawTransmuteSourcing("T6_HIDE_LEVEL4@4", md, MARTLOCK);
  assert.strictEqual(t.startId, "T6_HIDE_LEVEL2@2");
  assert.strictEqual(t.steps.length, 2);
  assert.strictEqual(t.perUnit, 50000 + ENCH_T6[3] + ENCH_T6[4]);
  assert.strictEqual(t.transmuteCost, ENCH_T6[3] + ENCH_T6[4]);
});
test("stops at the cheaper intermediate rather than always walking to the bottom", () => {
  const md = priceMap([
    { id: "T6_HIDE_LEVEL4@4", city: FS, buy: 300000 },
    { id: "T6_HIDE_LEVEL3@3", city: FS, buy: 1000 },    // 1,000 + 79,200 = 80,200 (best)
    { id: "T6_HIDE_LEVEL2@2", city: FS, buy: 50000 },   // 149,000
  ]);
  const t = getRawTransmuteSourcing("T6_HIDE_LEVEL4@4", md, MARTLOCK);
  assert.strictEqual(t.startId, "T6_HIDE_LEVEL3@3");
  assert.strictEqual(t.perUnit, 1000 + ENCH_T6[4]);
});
test("tier-up path: T7 ore → T8 ore at enchant 0", () => {
  const md = priceMap([
    { id: "T8_ORE", city: FS, buy: 9000 },
    { id: "T7_ORE", city: FS, buy: 1500 },              // 1,500 + 5,000 = 6,500 < 9,000
  ]);
  const t = getRawTransmuteSourcing("T8_ORE", md, MARTLOCK);
  assert.strictEqual(t.startId, "T7_ORE");
  assert.strictEqual(t.perUnit, 1500 + TIER_T8_E0);
  assert.strictEqual(t.steps[0].fee, TIER_T8_E0);
});
test("mixed path: cheapest of tier-up-then-enchant vs enchant-then-tier-up", () => {
  // Reaching 8.1 from 7.0. Route A: 7.0→8.0 (5,000) →8.1 (14,400) = 19,400
  //                        Route B: 7.0→7.1 (4,800) →8.1 (15,000) = 19,800
  const md = priceMap([
    { id: "T8_ORE_LEVEL1@1", city: FS, buy: 999999 },
    { id: "T7_ORE", city: FS, buy: 1000 },
  ]);
  const t = getRawTransmuteSourcing("T8_ORE_LEVEL1@1", md, MARTLOCK);
  assert.strictEqual(t.startId, "T7_ORE");
  assert.strictEqual(t.transmuteCost, 5000 + 14400);
  assert.deepStrictEqual(t.steps.map((s) => s.toId), ["T8_ORE", "T8_ORE_LEVEL1@1"]);
});

// ── no path cases ────────────────────────────────────────────────────────────
console.log("\n=== unsupported nodes ===");
test("T4 plain has no predecessor", () => {
  const md = priceMap([{ id: "T4_HIDE", city: FS, buy: 500 }, { id: "T3_HIDE", city: FS, buy: 1 }]);
  assert.strictEqual(getRawTransmuteSourcing("T4_HIDE", md, MARTLOCK), null);
});
test("enchanted rock has no transmute path (stone is enchant-0 tier-up only)", () => {
  const md = priceMap([
    { id: "T6_ROCK_LEVEL2@2", city: FS, buy: 999999 },
    { id: "T6_ROCK_LEVEL1@1", city: FS, buy: 1 },
    { id: "T5_ROCK", city: FS, buy: 1 },
  ]);
  assert.strictEqual(getRawTransmuteSourcing("T6_ROCK_LEVEL2@2", md, MARTLOCK), null);
});
test("plain rock still tier-ups", () => {
  const md = priceMap([{ id: "T8_ROCK", city: FS, buy: 99999 }, { id: "T7_ROCK", city: FS, buy: 500 }]);
  const t = getRawTransmuteSourcing("T8_ROCK", md, MARTLOCK);
  assert.strictEqual(t.startId, "T7_ROCK");
  assert.strictEqual(t.perUnit, 500 + STONE_T8);
});
test("refined ids never transmute", () => {
  const md = priceMap([{ id: "T8_LEATHER", city: FS, buy: 999999 }, { id: "T7_LEATHER", city: FS, buy: 1 }]);
  assert.strictEqual(getRawTransmuteSourcing("T8_LEATHER", md, MARTLOCK), null);
});

// ── station fee ──────────────────────────────────────────────────────────────
console.log("\n=== station usage fee ===");
test("each step charges the measured per-step grid fee", () => {
  __setStationRate(1000);                              // rate 1000, ref grid at 930
  const md = priceMap([
    { id: "T6_HIDE_LEVEL4@4", city: FS, buy: 9999999 },
    { id: "T6_HIDE_LEVEL3@3", city: FS, buy: 20000 },
  ]);
  const t = getRawTransmuteSourcing("T6_HIDE_LEVEL4@4", md, MARTLOCK);
  // Step 6.3->6.4 is an enchant-up to T6.e4: grid fee 12,489 at rate 930, scaled.
  const fee930 = M.TRANSMUTE_ENCHANTUP_STATIONFEE[6][4];
  const expectedStation = (1000 / 100) * (fee930 / (M.TRANSMUTE_STATION_FEE_REF_RATE / 100));
  assert.ok(Math.abs(t.steps[0].stationFee - expectedStation) < 1e-6, `${t.steps[0].stationFee} != ${expectedStation}`);
  assert.ok(Math.abs(t.perUnit - (20000 + ENCH_T6[4] + expectedStation)) < 1e-6);
});
test("a station fee can flip the cheapest start", () => {
  // With no fee, 6.2 (149,000) edges out 6.3 (149,200). A station fee charges the
  // 6.2 route one extra step, and that step's fee (~20,800) outweighs its 200 lead.
  const md = priceMap([
    { id: "T6_HIDE_LEVEL4@4", city: FS, buy: 9999999 },
    { id: "T6_HIDE_LEVEL3@3", city: FS, buy: 70000 },   // + 79,200 = 149,200
    { id: "T6_HIDE_LEVEL2@2", city: FS, buy: 50000 },   // + 19,800 + 79,200 = 149,000
  ]);
  assert.strictEqual(getRawTransmuteSourcing("T6_HIDE_LEVEL4@4", md, MARTLOCK).startId, "T6_HIDE_LEVEL2@2");
  __setStationRate(1000);                              // adds 10×nutPerSilver×fee to every step
  assert.strictEqual(getRawTransmuteSourcing("T6_HIDE_LEVEL4@4", md, MARTLOCK).startId, "T6_HIDE_LEVEL3@3");
});

// ── zone split + Brecilien exit fee ──────────────────────────────────────────
console.log("\n=== city rules ===");
test("BMR off: a Caerleon-only start is invisible to a royal refine", () => {
  const md = priceMap([
    { id: "T6_HIDE_LEVEL4@4", city: FS, buy: 300000 },
    { id: "T6_HIDE_LEVEL3@3", city: "Caerleon", buy: 1 },
  ]);
  assert.strictEqual(getRawTransmuteSourcing("T6_HIDE_LEVEL4@4", md, MARTLOCK), null);
  __setBMR(true);
  const t = getRawTransmuteSourcing("T6_HIDE_LEVEL4@4", md, MARTLOCK);
  assert.ok(t && t.startCity === "Caerleon");
});
test("Brecilien exit fee is folded into the start's per-unit cost", () => {
  __setBrecFee(5000);
  const md = priceMap([
    { id: "T6_HIDE_LEVEL4@4", city: FS, buy: 300000 },
    { id: "T6_HIDE_LEVEL3@3", city: "Brecilien", buy: 20000 },
    { id: "T6_HIDE_LEVEL3@3", city: FS, buy: 24000 },   // 24,000 < 20,000 + 5,000 fee → FS wins
  ]);
  const t = getRawTransmuteSourcing("T6_HIDE_LEVEL4@4", md, MARTLOCK);
  assert.strictEqual(t.startCity, FS);
  assert.strictEqual(t.perUnit, 24000 + ENCH_T6[4]);
});

// ── resolveRefineRawSource (market vs transmute pick) ────────────────────────
console.log("\n=== resolveRefineRawSource ===");
test("keeps the market raw when it is cheaper", () => {
  const md = priceMap([
    { id: "T6_HIDE_LEVEL4@4", city: FS, buy: 50000 },
    { id: "T6_HIDE_LEVEL3@3", city: FS, buy: 20000 },
  ]);
  const r = resolveRefineRawSource("T6_HIDE_LEVEL4@4", 50000, FS, MARTLOCK, md);
  assert.strictEqual(r.transmute, null);
  assert.strictEqual(r.perUnit, 50000);
});
test("switches to the transmute route when it is cheaper", () => {
  const md = priceMap([
    { id: "T6_HIDE_LEVEL4@4", city: FS, buy: 121995 },
    { id: "T6_HIDE_LEVEL3@3", city: FS, buy: 20000 },
  ]);
  const r = resolveRefineRawSource("T6_HIDE_LEVEL4@4", 121995, FS, MARTLOCK, md);
  assert.ok(r.transmute);
  assert.strictEqual(r.perUnit, 20000 + ENCH_T6[4]);
});
test("the market raw's own Brecilien exit fee counts in the comparison", () => {
  __setBrecFee(40000);
  const md = priceMap([
    { id: "T6_HIDE_LEVEL4@4", city: "Brecilien", buy: 95000 },  // 95,000 + 40,000 = 135,000
    { id: "T6_HIDE_LEVEL3@3", city: FS, buy: 20000 },           // 99,200
  ]);
  const r = resolveRefineRawSource("T6_HIDE_LEVEL4@4", 95000, "Brecilien", MARTLOCK, md);
  assert.ok(r.transmute, "transmute should beat the fee-laden Brecilien raw");
});
test("unpriced raw with a transmute path yields the transmute route", () => {
  const md = priceMap([{ id: "T6_HIDE_LEVEL3@3", city: FS, buy: 20000 }]);
  const r = resolveRefineRawSource("T6_HIDE_LEVEL4@4", 0, null, MARTLOCK, md);
  assert.ok(r.transmute && r.perUnit === 20000 + ENCH_T6[4]);
});
test("unpriced raw with no transmute path stays at 0", () => {
  const r = resolveRefineRawSource("T6_HIDE_LEVEL4@4", 0, null, MARTLOCK, priceMap([]));
  assert.strictEqual(r.transmute, null);
  assert.strictEqual(r.perUnit, 0);
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
