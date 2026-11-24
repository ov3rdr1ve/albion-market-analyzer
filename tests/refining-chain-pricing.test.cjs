/**
 * Test: refining-chain-pricing — recursive market-vs-chain sourcing for
 * refined materials (T4-T8 plank/bar/cloth/leather/stoneblock × enchants).
 *
 * Mirrors the consumables chain-pricing test pattern but with refining
 * specifics: RRR multiplier on input cost, per-step station fee, secondary
 * material that recurses to lower tiers.
 *
 * Run: node tests/refining-chain-pricing.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// ── Sandbox: minimum scaffolding the pricing module needs ────────────────
// Stubs for: market data lookup, override/force, IQR, RRR, station fee,
// focus cost, BMR toggle, RESOURCE_DEFS, CITIES.
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
  "Fort Sterling": "wood",
  Lymhurst: "fiber",
  Bridgewatch: "rock",
  Thetford: "ore",
  Martlock: "hide",
};
const RESOURCE_DEFS = [
  { type: "wood",  raw: "WOOD",  refined: "PLANKS",
    tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "ore",   raw: "ORE",   refined: "METALBAR",
    tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "hide",  raw: "HIDE",  refined: "LEATHER",
    tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "fiber", raw: "FIBER", refined: "CLOTH",
    tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "rock",  raw: "ROCK",  refined: "STONEBLOCK",
    tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];

let testBmrEnabled = false;
let testCityForce = {};
let testOverrides = {};
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
function getFocusCost(itemId, tier) {
  return Math.round(30 * Math.pow(2, tier - 4));
}
// Tests pin the station fee at 0 so chain math is purely (raw+sec)*(1-rrr)*(1+SETUP).
// Per-step station-fee accounting is verified separately by overriding this.
let testStationFeePerTier = { 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };
function calcStationFeeSilver(tier) { return testStationFeePerTier[tier] || 0; }
function refineStationFeeSilver(id) { return testStationFeePerTier[parseInt(String(id).slice(1), 10)] || 0; }
function __setStationFee(map) { testStationFeePerTier = map || { 4:0,5:0,6:0,7:0,8:0 }; }
function __setBMR(v) { testBmrEnabled = !!v; }
function __setOverrides(map) { testOverrides = map || {}; }
function __setForce(map) { testCityForce = map || {}; }
function __reset() { __setBMR(false); __setOverrides({}); __setForce({}); __setStationFee(null); }
`;

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const recipesSrc = loadFile("js/refining-chain-recipes.js");
const pricingSrc = loadFile("js/refining-chain-pricing.js");

const mod = new Module("refining-chain-pricing-test");
mod._compile(
  sandbox + recipesSrc + pricingSrc +
    "\nmodule.exports = { REFINING_RECIPES, MIN_CHAIN_TIER, getRefiningSourcing, " +
    "buildRefiningChain, chainSilverCostWithFocusAtTier, chainHasOverride, " +
    "getRefiningChainIds, findCheapestMarketBuyForRefine, " +
    "__setBMR, __setOverrides, __setForce, __setStationFee, __reset };",
  "refining-chain-pricing.js"
);
const M = mod.exports;
const {
  getRefiningSourcing,
  chainSilverCostWithFocusAtTier,
  chainHasOverride,
  getRefiningChainIds,
  __setBMR,
  __setOverrides,
  __setForce,
  __setStationFee,
  __reset,
} = M;

let passed = 0, failed = 0;
function test(name, fn) {
  try { __reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Build a marketData blob from a flat list of {id, city, buy} entries.
function priceMap(entries) {
  const out = {};
  for (const e of entries) {
    if (!out[e.id]) out[e.id] = {};
    out[e.id][e.city] = { buy_price: e.buy, sell_price: (e.buy || 0) + 1, volume_24h: 9999 };
  }
  return out;
}

const FS = "Fort Sterling";  // wood spec city — used as refineCity in most tests

// ── No-recipe / negative cases ────────────────────────────────────────────
console.log("\n=== Non-refinable ids → market only ===");

// This sandbox's RESOURCE_DEFS is T4-T8 only, so T3_PLANKS has no recipe here
// and must fall back to market. The real T2/T3 ladder is covered by
// tests/refining-chain-low-tier.test.cjs.
test("id with no recipe in the catalogue returns market sourcing only", () => {
  const md = priceMap([{ id: "T3_PLANKS", city: FS, buy: 500 }]);
  const r = getRefiningSourcing("T3_PLANKS", md, FS, false);
  assert.strictEqual(r.source, "market");
  assert.strictEqual(r.perUnit, 500);
});

test("Raw id has no recipe → market only", () => {
  const md = priceMap([{ id: "T6_WOOD", city: FS, buy: 800 }]);
  const r = getRefiningSourcing("T6_WOOD", md, FS, false);
  assert.strictEqual(r.source, "market");
  assert.strictEqual(r.perUnit, 800);
});

test("Unknown id → market only with perUnit 0", () => {
  const r = getRefiningSourcing("T6_BREAD", priceMap([]), FS, false);
  assert.strictEqual(r.source, "market");
  assert.strictEqual(r.perUnit, 0);
});

// ── Market vs chain comparison ────────────────────────────────────────────
console.log("\n=== Market vs chain selection ===");

test("market is cheaper → picks market (T5 plank)", () => {
  // Cheap market, expensive raw materials → chain loses
  const md = priceMap([
    { id: "T5_PLANKS", city: FS, buy: 100 },
    { id: "T5_WOOD",   city: FS, buy: 10000 },  // 3 logs × 10000 = 30000 raw cost
    { id: "T4_PLANKS", city: FS, buy: 200 },    // secondary
  ]);
  const r = getRefiningSourcing("T5_PLANKS", md, FS, false);
  assert.strictEqual(r.source, "market");
  assert.strictEqual(r.perUnit, 100);
});

test("chain is cheaper → picks chain (T5 plank)", () => {
  // Cheap raws → chain wins. Compute expected cost:
  //   raw = 3 × 10 = 30, sec = 50 (T4 market) → total inputs = 80
  //   rrr at FS spec wood, no focus = calcRRR(0.18+0.40) = 0.367
  //   chainCost = 80 × (1-0.367) × 1.025 + 0 = 80 × 0.633 × 1.025 ≈ 51.9
  const md = priceMap([
    { id: "T5_PLANKS", city: FS, buy: 1000 },   // expensive market
    { id: "T5_WOOD",   city: FS, buy: 10 },
    { id: "T4_PLANKS", city: FS, buy: 50 },
    { id: "T4_WOOD",   city: FS, buy: 999999 }, // make T4 chain unattractive
    { id: "T3_PLANKS", city: FS, buy: 999999 },
  ]);
  const r = getRefiningSourcing("T5_PLANKS", md, FS, false);
  assert.strictEqual(r.source, "chain");
  assert.ok(r.perUnit < 1000, `chain perUnit should beat market 1000, got ${r.perUnit}`);
  assert.ok(r.chain);
  assert.strictEqual(r.chain.tier, 5);
  assert.strictEqual(r.chain.inputs.length, 2);
  assert.strictEqual(r.chain.inputs[0].matId, "T5_WOOD");
  assert.strictEqual(r.chain.inputs[1].matId, "T4_PLANKS");
  // T4_PLANKS sourced from market here (T4 chain too expensive)
  assert.strictEqual(r.chain.inputs[1].sourcing.source, "market");
});

test("market price 0 → chain wins by default", () => {
  // No T6 market price; cheap raws → chain available.
  const md = priceMap([
    { id: "T6_WOOD",   city: FS, buy: 50 },
    { id: "T5_PLANKS", city: FS, buy: 100 },
    // Make sure T5_PLANKS chain is more expensive than T5 market so secondary
    // resolves to market — keeps the test's expected node count tight.
    { id: "T5_WOOD",   city: FS, buy: 999999 },
  ]);
  const r = getRefiningSourcing("T6_PLANKS", md, FS, false);
  assert.strictEqual(r.source, "chain");
  assert.ok(r.chain);
});

// ── Recursive multi-tier ──────────────────────────────────────────────────
console.log("\n=== Recursive multi-tier ===");

test("T8 chain recurses through T7→T6→T5→T4 when each step beats market", () => {
  // Make markets expensive at every tier, raws cheap → full chain wins.
  const md = priceMap([
    { id: "T8_PLANKS", city: FS, buy: 999999 },
    { id: "T7_PLANKS", city: FS, buy: 999999 },
    { id: "T6_PLANKS", city: FS, buy: 999999 },
    { id: "T5_PLANKS", city: FS, buy: 999999 },
    { id: "T4_PLANKS", city: FS, buy: 999999 },
    { id: "T8_WOOD",   city: FS, buy: 1 },
    { id: "T7_WOOD",   city: FS, buy: 1 },
    { id: "T6_WOOD",   city: FS, buy: 1 },
    { id: "T5_WOOD",   city: FS, buy: 1 },
    { id: "T4_WOOD",   city: FS, buy: 1 },
    { id: "T3_PLANKS", city: FS, buy: 1 },     // chain floor
  ]);
  const r = getRefiningSourcing("T8_PLANKS", md, FS, false);
  assert.strictEqual(r.source, "chain");
  // Walk the chain: T8 → T7 → T6 → T5 → T4 → market T3
  let node = r.chain;
  const tiers = [];
  while (node) {
    tiers.push(node.tier);
    const sec = node.inputs[1];
    node = (sec && sec.sourcing.source === "chain") ? sec.sourcing.chain : null;
  }
  assert.deepStrictEqual(tiers, [8, 7, 6, 5, 4],
    `expected full chain T8→T4, got tiers ${tiers}`);
  // Last node's secondary should be plain T3_PLANKS from market
  let last = r.chain;
  while (last.inputs[1].sourcing.source === "chain") last = last.inputs[1].sourcing.chain;
  assert.strictEqual(last.inputs[1].matId, "T3_PLANKS");
  assert.strictEqual(last.inputs[1].sourcing.source, "market");
});

test("Partial chain T6→T7→T8 when T6 plank cheaper to buy than make", () => {
  const md = priceMap([
    { id: "T8_PLANKS", city: FS, buy: 999999 },
    { id: "T7_PLANKS", city: FS, buy: 999999 },
    { id: "T6_PLANKS", city: FS, buy: 1 },     // cheap T6 market — chain stops here
    { id: "T8_WOOD",   city: FS, buy: 1 },
    { id: "T7_WOOD",   city: FS, buy: 1 },
    { id: "T6_WOOD",   city: FS, buy: 999999 }, // make T6 chain expensive
    { id: "T5_PLANKS", city: FS, buy: 999999 },
  ]);
  const r = getRefiningSourcing("T8_PLANKS", md, FS, false);
  assert.strictEqual(r.source, "chain");
  // T8 → T7 → T6(market, NOT chain)
  const t8 = r.chain;
  assert.strictEqual(t8.tier, 8);
  assert.strictEqual(t8.inputs[1].sourcing.source, "chain");
  const t7 = t8.inputs[1].sourcing.chain;
  assert.strictEqual(t7.tier, 7);
  assert.strictEqual(t7.inputs[1].sourcing.source, "market",
    "T6 should resolve to market when buying is cheaper than refining");
  assert.strictEqual(t7.inputs[1].matId, "T6_PLANKS");
});

// ── RRR math ──────────────────────────────────────────────────────────────
console.log("\n=== RRR math ===");

test("Chain silver cost matches (rawCost*ratio + secCost) × (1-rrr) × (1+SETUP)", () => {
  // Pin station fee to 0; deterministic RRR via spec city, no focus.
  // T5_PLANKS: 3 × T5_WOOD + 1 × T4_PLANKS at FS (wood spec)
  //   bonus = 0.18 + 0.40 = 0.58, rrr = 0.58/1.58 ≈ 0.36709
  //   raw = 3×100=300, sec = 200 (T4 from market here)
  //   chainCost = (300+200) × (1-0.36709) × 1.025 = 500 × 0.63291 × 1.025 ≈ 324.367
  const md = priceMap([
    { id: "T5_PLANKS", city: FS, buy: 999999 },
    { id: "T5_WOOD",   city: FS, buy: 100 },
    { id: "T4_PLANKS", city: FS, buy: 200 },
    { id: "T4_WOOD",   city: FS, buy: 999999 },  // force T4 to market
    { id: "T3_PLANKS", city: FS, buy: 999999 },
  ]);
  const r = getRefiningSourcing("T5_PLANKS", md, FS, false);
  const expectedRrr = 0.58 / 1.58;
  const expectedCost = (300 + 200) * (1 - expectedRrr) * 1.025;
  assert.strictEqual(r.source, "chain");
  assert.ok(Math.abs(r.perUnit - expectedCost) < 0.01,
    `expected chain cost ≈ ${expectedCost.toFixed(3)}, got ${r.perUnit}`);
});

test("Focus on → higher RRR → cheaper chain", () => {
  const md = priceMap([
    { id: "T5_PLANKS", city: FS, buy: 999999 },
    { id: "T5_WOOD",   city: FS, buy: 100 },
    { id: "T4_PLANKS", city: FS, buy: 200 },
    { id: "T4_WOOD",   city: FS, buy: 999999 },
    { id: "T3_PLANKS", city: FS, buy: 999999 },
  ]);
  const noFocus = getRefiningSourcing("T5_PLANKS", md, FS, false);
  const withFocus = getRefiningSourcing("T5_PLANKS", md, FS, true);
  assert.strictEqual(noFocus.source, "chain");
  assert.strictEqual(withFocus.source, "chain");
  assert.ok(withFocus.perUnit < noFocus.perUnit,
    `focus chain (${withFocus.perUnit}) should beat no-focus (${noFocus.perUnit})`);
});

test("Station fee adds per step (each chain tier pays its fee)", () => {
  // Pin all station fees deterministic; verify total includes per-step fees.
  __setStationFee({ 4: 1000, 5: 2000, 6: 4000, 7: 8000, 8: 16000 });
  const md = priceMap([
    { id: "T5_PLANKS", city: FS, buy: 999999 },
    { id: "T5_WOOD",   city: FS, buy: 1 },
    { id: "T4_PLANKS", city: FS, buy: 1 },
    { id: "T4_WOOD",   city: FS, buy: 999999 },
    { id: "T3_PLANKS", city: FS, buy: 999999 },
  ]);
  const r = getRefiningSourcing("T5_PLANKS", md, FS, false);
  // T5 chain pays T5 station fee. T4 secondary is market (T4 chain too expensive),
  // so only T5's 2000 fee is added on top of (1-rrr)*1.025*tinyInputs.
  // chainCost ≈ (3*1 + 1) * (1-0.367) * 1.025 + 2000 ≈ 2.6 + 2000 ≈ 2002.6
  assert.ok(r.perUnit > 2000, `expected cost > 2000 (T5 station fee), got ${r.perUnit}`);
  assert.ok(r.perUnit < 2010, `expected cost < 2010, got ${r.perUnit}`);
});

// ── Missing data ──────────────────────────────────────────────────────────
console.log("\n=== Missing data ===");

test("Missing raw → chain unbuildable → falls back to market", () => {
  const md = priceMap([
    { id: "T5_PLANKS", city: FS, buy: 100 },
    // T5_WOOD not listed → chain can't price → market wins
    { id: "T4_PLANKS", city: FS, buy: 50 },
  ]);
  const r = getRefiningSourcing("T5_PLANKS", md, FS, false);
  assert.strictEqual(r.source, "market");
  assert.strictEqual(r.perUnit, 100);
});

test("Missing both market and chain → market with 0", () => {
  const r = getRefiningSourcing("T5_PLANKS", priceMap([]), FS, false);
  assert.strictEqual(r.source, "market");
  assert.strictEqual(r.perUnit, 0);
});

// ── Helpers ───────────────────────────────────────────────────────────────
console.log("\n=== chainHasOverride helper ===");

test("chainHasOverride detects override on a market leaf", () => {
  __setOverrides({ "T4_PLANKS:Fort Sterling": 999 });
  const md = priceMap([
    { id: "T5_PLANKS", city: FS, buy: 999999 },
    { id: "T5_WOOD",   city: FS, buy: 100 },
    { id: "T4_PLANKS", city: FS, buy: 200 },
    { id: "T4_WOOD",   city: FS, buy: 999999 },
    { id: "T3_PLANKS", city: FS, buy: 999999 },
  ]);
  const r = getRefiningSourcing("T5_PLANKS", md, FS, false);
  assert.strictEqual(r.source, "chain");
  assert.strictEqual(chainHasOverride(r.chain), true);
});

test("chainHasOverride returns false when no leaf is overridden", () => {
  const md = priceMap([
    { id: "T5_PLANKS", city: FS, buy: 999999 },
    { id: "T5_WOOD",   city: FS, buy: 100 },
    { id: "T4_PLANKS", city: FS, buy: 200 },
    { id: "T4_WOOD",   city: FS, buy: 999999 },
    { id: "T3_PLANKS", city: FS, buy: 999999 },
  ]);
  const r = getRefiningSourcing("T5_PLANKS", md, FS, false);
  assert.strictEqual(chainHasOverride(r.chain), false);
});

console.log("\n=== getRefiningChainIds helper ===");

test("getRefiningChainIds collects all intermediate raws and refined ids for T8", () => {
  const ids = getRefiningChainIds("T8_PLANKS");
  // Should include: T8_WOOD, T7_PLANKS, T7_WOOD, T6_PLANKS, T6_WOOD,
  //                 T5_PLANKS, T5_WOOD, T4_PLANKS, T4_WOOD, T3_PLANKS
  assert.ok(ids.has("T8_WOOD"));
  assert.ok(ids.has("T7_PLANKS"));
  assert.ok(ids.has("T7_WOOD"));
  assert.ok(ids.has("T4_WOOD"));
  assert.ok(ids.has("T3_PLANKS"));
});

test("getRefiningChainIds for T4 includes raw and T3 secondary only", () => {
  const ids = getRefiningChainIds("T4_PLANKS");
  assert.ok(ids.has("T4_WOOD"));
  assert.ok(ids.has("T3_PLANKS"));
  assert.ok(!ids.has("T2_PLANKS"));  // chain stops at T4 → no recursion below
});

test("getRefiningChainIds for non-recipe id is empty", () => {
  const ids = getRefiningChainIds("T3_PLANKS");
  assert.strictEqual(ids.size, 0);
});

console.log("\n=== chainSilverCostWithFocusAtTier ===");

test("Cost with focus at root tier T5 < cost with focus at T4 (since root has bigger inputs)", () => {
  __setStationFee({ 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 });
  const md = priceMap([
    { id: "T5_PLANKS", city: FS, buy: 999999 },
    { id: "T5_WOOD",   city: FS, buy: 100 },
    { id: "T4_PLANKS", city: FS, buy: 999999 },
    { id: "T4_WOOD",   city: FS, buy: 100 },
    { id: "T3_PLANKS", city: FS, buy: 100 },
  ]);
  const r = getRefiningSourcing("T5_PLANKS", md, FS, false);
  assert.strictEqual(r.source, "chain");
  const costAtT5 = chainSilverCostWithFocusAtTier(r.chain, 5);
  const costAtT4 = chainSilverCostWithFocusAtTier(r.chain, 4);
  // T5 has 3 logs + 1 secondary; T4 has 2 logs + 1 secondary (deeper).
  // Focus on T5 reduces a larger absolute pile → lower total.
  assert.ok(costAtT5 < costAtT4,
    `cost at T5 (${costAtT5.toFixed(2)}) should be less than at T4 (${costAtT4.toFixed(2)})`);
});

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
