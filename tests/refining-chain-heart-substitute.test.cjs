/**
 * Test: refining heart substitution — a faction "heart" stands in for ONE unit
 * of the biome RAW resource in a T4+ refine (wiki: "replace ... the main
 * resource of the Biome"; e.g. one expensive 8.2 fiber), of any tier/enchant.
 *
 * KEY RULES (wiki-confirmed):
 *  - The heart replaces the RAW, NOT the refined secondary (in a T4 refine the
 *    only Tier-4+ input is the raw; the secondary is Tier 3).
 *  - The heart is NOT returned by the resource return rate (fully consumed), so
 *    it wins only when  heartCost < rawUnitCost * (1 - rrr).
 *  - The refine-the-secondary chain stays heart-free BY DEFAULT (hearts are best
 *    spent on the top refine where the raw is most expensive). The Crafting
 *    Planner, which has no row-level raw, opts in with `opts.heartRaw` — that
 *    path is covered by tests/refining-chain-heart.test.cjs.
 *
 * Mirrors the sandbox/_compile/priceMap scaffold of refining-chain-pricing.test.cjs.
 *
 * Run: node tests/refining-chain-heart-substitute.test.cjs
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
const BASE_CITY_BONUS = 0.18;
const REFINE_SPEC_BONUS = 0.40;
const FOCUS_BONUS = 0.59;
const CITY_REFINE_SPEC = { "Fort Sterling": "wood", Lymhurst: "fiber", Bridgewatch: "rock", Thetford: "ore", Martlock: "hide" };
const RESOURCE_DEFS = [
  { type: "wood",  raw: "WOOD",  refined: "PLANKS",     tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "ore",   raw: "ORE",   refined: "METALBAR",   tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "hide",  raw: "HIDE",  refined: "LEATHER",    tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "fiber", raw: "FIBER", refined: "CLOTH",      tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "rock",  raw: "ROCK",  refined: "STONEBLOCK", tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];
let testBmrEnabled = false, testCityForce = {}, testOverrides = {};
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
function getRefineRRR(city, t, f) { let b = BASE_CITY_BONUS; if (CITY_REFINE_SPEC[city]===t) b+=REFINE_SPEC_BONUS; if (f) b+=FOCUS_BONUS; return calcRRR(b); }
function getFocusCost(id, tier) { return Math.round(30 * Math.pow(2, tier - 4)); }
let testStationFeePerTier = { 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };
function calcStationFeeSilver(tier) { return testStationFeePerTier[tier] || 0; }
function refineStationFeeSilver(id) { return testStationFeePerTier[parseInt(String(id).slice(1), 10)] || 0; }
function __setStationFee(map) { testStationFeePerTier = map || { 4:0,5:0,6:0,7:0,8:0 }; }
function __setBMR(v) { testBmrEnabled = !!v; }
function __setOverrides(map) { testOverrides = map || {}; }
function __setForce(map) { testCityForce = map || {}; }
function __reset() { __setBMR(false); __setOverrides({}); __setForce({}); __setStationFee(null); }
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }

const mod = new Module("refining-chain-heart-test");
mod._compile(
  sandbox + loadFile("js/refining-chain-recipes.js") + loadFile("js/refining-chain-pricing.js") +
    "\nmodule.exports = { REFINING_RECIPES, HEART_BY_RESOURCE, getRefiningSourcing, " +
    "buildRefiningChain, getRefiningChainIds, findCheapestMarketBuyForRefine, " +
    "getHeartSubstitute, chooseRawWithHeart, __setBMR, __setOverrides, __setForce, __setStationFee, __reset };",
  "refining-chain-pricing.js"
);
const M = mod.exports;
const { HEART_BY_RESOURCE, getRefiningSourcing, getRefiningChainIds, getHeartSubstitute, chooseRawWithHeart, __setBMR, __reset } = M;

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

const FS = "Fort Sterling";
const TREEHEART = "T1_FACTION_FOREST_TOKEN_1";
const RRR = 0.58 / 1.58;        // FS wood spec, no focus
const ONE_MINUS = 1 - RRR;

// ── The map ─────────────────────────────────────────────────────────────────
console.log("\n=== HEART_BY_RESOURCE map ===");
test("map has the 5 resource hearts (Shadowheart excluded)", () => {
  assert.deepStrictEqual(Object.keys(HEART_BY_RESOURCE).sort(), ["fiber","hide","ore","rock","wood"]);
  assert.strictEqual(HEART_BY_RESOURCE.wood, TREEHEART);
  assert.strictEqual(HEART_BY_RESOURCE.fiber, "T1_FACTION_SWAMP_TOKEN_1");
  assert.ok(!Object.values(HEART_BY_RESOURCE).some(id => /CAERLEON/.test(id)));
});

// ── getHeartSubstitute ──────────────────────────────────────────────────────
console.log("\n=== getHeartSubstitute ===");
test("prices the resource's heart at market", () => {
  const h = getHeartSubstitute("wood", priceMap([{ id: TREEHEART, city: FS, buy: 77 }]), FS);
  assert.ok(h && h.source === "heart" && h.heartId === TREEHEART && h.perUnit === 77);
});
test("null for unmapped resource / no price / zero price", () => {
  assert.strictEqual(getHeartSubstitute("caerleon", priceMap([]), FS), null);
  assert.strictEqual(getHeartSubstitute("wood", priceMap([]), FS), null);
  assert.strictEqual(getHeartSubstitute("wood", priceMap([{ id: TREEHEART, city: FS, buy: 0 }]), FS), null);
});

// ── chooseRawWithHeart (heart vs ONE raw unit, post-RRR) ─────────────────────
console.log("\n=== chooseRawWithHeart ===");
const heart = (p) => ({ perUnit: p, source: "heart", heartId: TREEHEART, city: FS, travelFeePerUnit: 0 });

test("heart wins when heartCost < rawPrice*(1-rrr): keeps rawRatio-1 raws", () => {
  // rawPrice 200, threshold 200*(1-rrr)=126.58 ; heart 120 < threshold → wins
  const c = chooseRawWithHeart(200, heart(120), 5, RRR);
  assert.strictEqual(c.usedHeart, true);
  assert.strictEqual(c.rawKeptCount, 4);          // 5 - 1
  assert.strictEqual(c.heartCost, 120);           // RRR-exempt, price only
  assert.ok(c.heart && c.heart.id === TREEHEART);
});
test("heart loses when heartCost >= rawPrice*(1-rrr), even if heart < raw sticker", () => {
  // heart 130 < raw 200, but 130 > threshold 126.58 → keep all raws
  const c = chooseRawWithHeart(200, heart(130), 5, RRR);
  assert.strictEqual(c.usedHeart, false);
  assert.strictEqual(c.rawKeptCount, 5);
  assert.strictEqual(c.heartCost, 0);
});
test("null heart or rawRatio<1 → no substitution", () => {
  assert.strictEqual(chooseRawWithHeart(200, null, 5, RRR).usedHeart, false);
  assert.strictEqual(chooseRawWithHeart(200, heart(1), 0, RRR).usedHeart, false);
});
test("heart travel fee counts toward the decision", () => {
  // perUnit 120 (would win) but +10 fee = 130 effective → loses
  const c = chooseRawWithHeart(200, { perUnit: 120, source: "heart", heartId: TREEHEART, city: FS, travelFeePerUnit: 10 }, 5, RRR);
  assert.strictEqual(c.usedHeart, false);
});

// ── The refine chain stays heart-free ────────────────────────────────────────
console.log("\n=== chain is heart-free without opts.heartRaw (heart handled at row level) ===");
test("getRefiningSourcing chain never contains a heart input, even with a cheap heart", () => {
  const md = priceMap([
    { id: "T5_PLANKS", city: FS, buy: 999999 }, // expensive market → chain wins
    { id: "T5_WOOD",   city: FS, buy: 100 },
    { id: "T4_PLANKS", city: FS, buy: 200 },
    { id: "T4_WOOD",   city: FS, buy: 999999 },
    { id: "T3_PLANKS", city: FS, buy: 999999 },
    { id: TREEHEART,   city: FS, buy: 1 },       // dirt cheap, but chain must ignore it
  ]);
  const r = getRefiningSourcing("T5_PLANKS", md, FS, false);
  assert.strictEqual(r.source, "chain");
  assert.strictEqual(r.chain.inputs.length, 2, "chain node has only raw + secondary, no heart");
  assert.strictEqual(r.chain.inputs[0].matId, "T5_WOOD");
  assert.strictEqual(r.chain.inputs[0].count, 3, "full raw count (heart not applied in chain)");
  assert.strictEqual(r.chain.inputs[1].matId, "T4_PLANKS");
  assert.ok(!r.chain.inputs.some(i => i.sourcing && i.sourcing.source === "heart"));
  // Legacy cost unchanged: (3*100 + 200)*(1-rrr)*1.025
  const legacy = (300 + 200) * ONE_MINUS * 1.025;
  assert.ok(Math.abs(r.perUnit - legacy) < 0.01, `chain cost ${r.perUnit} vs legacy ${legacy.toFixed(2)}`);
});

// ── Fetch id helper still pre-fetches the heart for the row ──────────────────
console.log("\n=== getRefiningChainIds includes the heart ===");
test("getRefiningChainIds(T5_PLANKS) includes the wood heart", () => {
  assert.ok(getRefiningChainIds("T5_PLANKS").has(TREEHEART));
});
test("getRefiningChainIds(T5_METALBAR) includes the ore heart, not the wood one", () => {
  const ids = getRefiningChainIds("T5_METALBAR");
  assert.ok(ids.has("T1_FACTION_MOUNTAIN_TOKEN_1"));
  assert.ok(!ids.has(TREEHEART));
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
