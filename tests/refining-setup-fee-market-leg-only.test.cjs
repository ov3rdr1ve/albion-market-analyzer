/**
 * Test: SETUP_FEE rides the MARKET leg only.
 *
 * The 2.5% setup fee is a buy-order cost. Silver that was never a market
 * purchase — a sub-chain's refining station fee, a transmute step's fixed silver
 * and its station fee — must sit OUTSIDE the (1 + SETUP_FEE) multiplier while
 * still getting the (1 - rrr) discount (fewer units consumed means fewer units
 * to make or buy).
 *
 * Every sourcing object therefore carries `feePerUnit`: the part of `perUnit`
 * that is not a market purchase. Market leaves report 0, so a market-only chain
 * must price exactly as it did before this split existed.
 *
 * Run: node tests/refining-setup-fee-market-leg-only.test.cjs
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
const PREMIUM_TAX = 0.065;
const BASE_CITY_BONUS = 0.18;
const REFINE_SPEC_BONUS = 0.40;
const FOCUS_BONUS = 0.59;
const CITY_REFINE_SPEC = {
  "Fort Sterling": "wood", Lymhurst: "fiber", Bridgewatch: "rock",
  Thetford: "ore", Martlock: "hide",
};
const RESOURCE_DEFS = [
  { type: "wood",  raw: "WOOD",  refined: "PLANKS",
    tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "hide",  raw: "HIDE",  refined: "LEATHER",
    tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];
let testBmrEnabled = false, testCityForce = {}, testOverrides = {};
let testStationFeePerTier = { 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };
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
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getRefineRRR(city, resourceType, useFocus) {
  let bonus = BASE_CITY_BONUS;
  if (CITY_REFINE_SPEC[city] === resourceType) bonus += REFINE_SPEC_BONUS;
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}
function getFocusCost(itemId, tier) { return Math.round(30 * Math.pow(2, tier - 4)); }
// Flat per-tier station fee for BOTH refines and transmute steps, so expected
// values stay readable arithmetic instead of the measured nutrition grid.
function calcStationFeeSilver(tier) { return testStationFeePerTier[tier] || 0; }
function refineStationFeeSilver(id) { return testStationFeePerTier[parseInt(String(id).slice(1), 10)] || 0; }
function legBrecilienCost() { return 0; }
function resourceShortName(id) { return id; }
function __setStationFee(map) { testStationFeePerTier = map || { 3:0,4:0,5:0,6:0,7:0,8:0 }; }
function __setBMR(v) { testBmrEnabled = !!v; }
function __setOverrides(m) { testOverrides = m || {}; }
function __setForce(m) { testCityForce = m || {}; }
function __reset() { __setBMR(false); __setOverrides({}); __setForce({}); __setStationFee(null); }
`;

const load = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const mod = new Module("refining-setup-fee-test");
mod._compile(
  sandbox +
    load("js/data-transmute.js") +
    load("js/refining-chain-recipes.js") +
    load("js/refining-chain-pricing.js") +
    load("js/refining-transmute-substitute.js") +
    "\nmodule.exports = { buildRefiningChain, getRefiningSourcing, " +
    "chainSilverCostWithFocusAtTier, chainSilverCostGathered, getRefineRRR, " +
    "TRANSMUTE_TIERUP_COST, __setStationFee, __setBMR, __setOverrides, __setForce, __reset };",
  "refining-chain-pricing.js",
);
const M = mod.exports;
const {
  buildRefiningChain, getRefiningSourcing, chainSilverCostWithFocusAtTier,
  chainSilverCostGathered, getRefineRRR, TRANSMUTE_TIERUP_COST,
  __setStationFee, __reset,
} = M;

let passed = 0, failed = 0;
function test(name, fn) {
  try { __reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
function near(a, b, msg) {
  assert.ok(Math.abs(a - b) < 1e-6, `${msg || ""} expected ${b}, got ${a}`);
}
function priceMap(entries) {
  const out = {};
  for (const e of entries) {
    (out[e.id] ||= {})[e.city] = { buy_price: e.buy, volume_24h: e.vol ?? 9999 };
  }
  return out;
}

// Anchor the chain in a city with no hide spec. Every tier still shares one RRR
// — the hide one — because a chain refines at the resource's spec city wherever
// the caller stands (getRefineCityFor); Bridgewatch stays the buy side.
const CITY = "Bridgewatch";
const REFINE_AT = "Martlock";  // hide spec, per CITY_REFINE_SPEC above
const RRR = getRefineRRR(REFINE_AT, "hide", false);
const S = { 3: 0, 4: 400, 5: 500, 6: 600, 7: 700, 8: 800 };

// T3 leather is below MIN_CHAIN_TIER, so it is always a market leaf.
const BASE = [
  { id: "T3_LEATHER", city: CITY, buy: 2000 },
  { id: "T4_HIDE", city: CITY, buy: 500 },
  { id: "T5_HIDE", city: CITY, buy: 1000 },
  { id: "T4_LEATHER", city: CITY, buy: 999999 },   // chain must beat the bar
  { id: "T5_LEATHER", city: CITY, buy: 999999 },
];

// Expected T4 leather chain: 2× T4 hide + 1× T3 leather, all market.
function cost4() { return ((2 * 500 + 2000) * (1 - RRR)) * (1 + 0.025) + S[4]; }

console.log("\n=== market-only chains are untouched ===");
test("no station fee, no transmute: cost is the plain (mats)*(1-rrr)*(1+setup)", () => {
  const md = priceMap(BASE);
  const c = buildRefiningChain("T4_LEATHER", md, CITY, false, 0, {});
  near(c.costPerOutput, ((2 * 500 + 2000) * (1 - RRR)) * 1.025, "T4 chain");
  near(c.feePerOutput, 0, "no fee component");
});

test("a market-only chain reports feePerUnit 0 through getRefiningSourcing", () => {
  const md = priceMap(BASE);
  const s = getRefiningSourcing("T4_LEATHER", md, CITY, false, 0, {});
  assert.strictEqual(s.source, "chain");
  near(s.feePerUnit || 0, 0);
});

test("a market leaf reports feePerUnit 0", () => {
  const md = priceMap(BASE);
  const s = getRefiningSourcing("T3_LEATHER", md, CITY, false, 0, {});
  assert.strictEqual(s.source, "market");
  near(s.feePerUnit || 0, 0);
});

console.log("\n=== a sub-chain's station fee escapes the parent's setup fee ===");
test("parent charges setup on the market part only", () => {
  __setStationFee(S);
  const md = priceMap(BASE);
  const c4 = cost4();
  const fee4 = S[4];                       // the T4 refine's own station fee
  const c = buildRefiningChain("T5_LEATHER", md, CITY, false, 0, {});
  const expected =
    ((3 * 1000 + (c4 - fee4)) * (1 - RRR)) * 1.025 + fee4 * (1 - RRR) + S[5];
  near(c.costPerOutput, expected, "T5 chain");
  near(c.feePerOutput, fee4 * (1 - RRR) + S[5], "fee propagated up");
});

test("the split is exactly 2.5% of the inherited fee cheaper than charging setup on it", () => {
  __setStationFee(S);
  const md = priceMap(BASE);
  const c = buildRefiningChain("T5_LEATHER", md, CITY, false, 0, {});
  const chargedOnEverything = ((3 * 1000 + cost4()) * (1 - RRR)) * 1.025 + S[5];
  near(chargedOnEverything - c.costPerOutput, S[4] * (1 - RRR) * 0.025, "delta");
});

console.log("\n=== transmute silver escapes the setup fee ===");
test("only the transmute route's START price pays setup", () => {
  __setStationFee(S);
  // T6 hide is unlisted; T5 hide at 1,000 transmutes up for 1,250 + station 600.
  const md = priceMap(BASE.concat([
    { id: "T6_LEATHER", city: CITY, buy: 999999 },
    { id: "T5_LEATHER", city: CITY, buy: 3000 },     // cheap bar → market secondary
  ]));
  const c = buildRefiningChain("T6_LEATHER", md, CITY, false, 0, { transmuteRaw: true });
  const stepSilver = TRANSMUTE_TIERUP_COST[6][0];
  const transmuteFee = stepSilver + S[6];            // silver + step station fee
  const rawUnit = 1000 + transmuteFee;
  const rawCount = 4;                                // T6 rawRatio
  const expected =
    ((rawCount * rawUnit + 3000 - rawCount * transmuteFee) * (1 - RRR)) * 1.025
    + rawCount * transmuteFee * (1 - RRR) + S[6];
  near(c.costPerOutput, expected, "T6 chain with transmuted raw");
  near(c.feePerOutput, rawCount * transmuteFee * (1 - RRR) + S[6], "fee component");
});

test("a market-sourced raw keeps feePerOutput at the chain's own station fee", () => {
  __setStationFee(S);
  const md = priceMap(BASE.concat([
    { id: "T6_HIDE", city: CITY, buy: 1 },
    { id: "T5_LEATHER", city: CITY, buy: 3000 },     // cheap bar → market secondary
  ]));
  const c = buildRefiningChain("T6_LEATHER", md, CITY, false, 0, { transmuteRaw: true });
  near(c.feePerOutput, S[6], "no transmute → only this refine's station fee");
});

console.log("\n=== the same split holds in the focus-tier and gathered models ===");
test("chainSilverCostWithFocusAtTier keeps inherited fees out of setup", () => {
  __setStationFee(S);
  const md = priceMap(BASE);
  const c = buildRefiningChain("T5_LEATHER", md, CITY, false, 0, {});
  const rrrF = getRefineRRR(REFINE_AT, "hide", true);
  const c4 = cost4();
  const expected =
    ((3 * 1000 + (c4 - S[4])) * (1 - rrrF)) * 1.025 + S[4] * (1 - rrrF) + S[5];
  near(chainSilverCostWithFocusAtTier(c, 5), expected, "focus at T5");
});

test("chainSilverCostWithFocusAtTier at a LOWER tier re-prices the sub-chain and its fee", () => {
  __setStationFee(S);
  const md = priceMap(BASE);
  const c = buildRefiningChain("T5_LEATHER", md, CITY, false, 0, {});
  const rrrF = getRefineRRR(REFINE_AT, "hide", true);
  const c4f = ((2 * 500 + 2000) * (1 - rrrF)) * 1.025 + S[4];
  const expected =
    ((3 * 1000 + (c4f - S[4])) * (1 - RRR)) * 1.025 + S[4] * (1 - RRR) + S[5];
  near(chainSilverCostWithFocusAtTier(c, 4), expected, "focus at T4");
});

test("chainSilverCostGathered keeps the sub-chain's station fee out of setup", () => {
  __setStationFee(S);
  const md = priceMap(BASE);
  const c = buildRefiningChain("T5_LEATHER", md, CITY, false, 0, {});
  const g4 = (2000 * (1 - RRR)) * 1.025 + S[4];      // raws free, T3 bar still bought
  const expected = ((g4 - S[4]) * (1 - RRR)) * 1.025 + S[4] * (1 - RRR) + S[5];
  near(chainSilverCostGathered(c), expected, "gathered T5");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
