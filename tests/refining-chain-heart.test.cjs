/**
 * Test: opt-in faction-heart substitution INSIDE a refining chain
 * (buildRefiningChain with `opts.heartRaw`).
 *
 * Background. A heart stands in for ONE unit of the biome RAW resource in a T4+
 * refine and is RRR-EXEMPT (fully consumed), so it wins only when
 *   heartEff < rawEff * (1 - rrr).
 * The Refining / Transports table applies this at ROW level
 * (resolveRefineRawHeart, js/refining-route.js). The Crafting Planner has no
 * row-level raw at all — the chain IS how it reaches one — so without an opt-in
 * here the planner could never use a heart, and its "best path" panel would name
 * a route the game does not consider best.
 *
 * RULES LOCKED IN HERE:
 *  - Off by default: no `opts.heartRaw`, no heart (the Refining table's chain is
 *    only the refine-the-secondary sub-tree and must not change).
 *  - Root refine only: a heart is scarce and worth most where the raw is
 *    dearest, so depth > 0 nodes stay heart-free even with the flag on.
 *  - Never at .4 / pristine (items.xml gives T*_<REFINED>_LEVEL4 a single
 *    craftingrequirements block — no heart variant).
 *  - Never on enchanted raw rock (the Rockheart recipe exists only for plain rock).
 *  - Cost: ((rawKept*rawEff + secCost) * (1 - rrr) + heartCost) * (1 + SETUP_FEE)
 *    + stationFee  — the heart sits OUTSIDE the (1-rrr) discount but still pays
 *    the buy-side setup fee, matching calculations.js.
 *
 * Sandbox mirrors tests/refining-chain-heart-substitute.test.cjs.
 *
 * Run: node tests/refining-chain-heart.test.cjs
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
function refineStationFeeSilver(id) { return testStationFeePerTier[parseInt(String(id).slice(1), 10)] || 0; }
function __setStationFee(map) { testStationFeePerTier = map || { 4:0,5:0,6:0,7:0,8:0 }; }
function __setBMR(v) { testBmrEnabled = !!v; }
function __setOverrides(map) { testOverrides = map || {}; }
function __setForce(map) { testCityForce = map || {}; }
function __reset() { __setBMR(false); __setOverrides({}); __setForce({}); __setStationFee(null); }
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }

const mod = new Module("refining-chain-heart-optin-test");
mod._compile(
  sandbox + loadFile("js/refining-chain-recipes.js") + loadFile("js/refining-chain-pricing.js") +
    "\nmodule.exports = { REFINING_RECIPES, HEART_BY_RESOURCE, buildRefiningChain, " +
    "heartAllowedForRaw, __setStationFee, __reset };",
  "refining-chain-pricing.js"
);
const {
  buildRefiningChain, heartAllowedForRaw, __setStationFee, __reset,
} = mod.exports;

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
const HEART_ON = { heartRaw: true };
const RRR = 0.58 / 1.58;          // Fort Sterling wood spec, focus off
const ONE_MINUS = 1 - RRR;

// T5 plank: 3x T5_WOOD + 1x T4_PLANKS. The T4 plank is priced at market so the
// chain is exactly one level deep unless a test says otherwise.
function woodMarket({ raw = 200, sec = 500, heart = null }) {
  const rows = [
    { id: "T5_WOOD", city: FS, buy: raw },
    { id: "T4_PLANKS", city: FS, buy: sec },
    { id: "T4_WOOD", city: FS, buy: 999999 },
    { id: "T3_PLANKS", city: FS, buy: 999999 },
  ];
  if (heart !== null) rows.push({ id: TREEHEART, city: FS, buy: heart });
  return priceMap(rows);
}
const heartInput = (node) => node.inputs.find((i) => i.sourcing && i.sourcing.source === "heart");
const rawInput = (node) => node.inputs.find((i) => i.matId === "T5_WOOD");

// ── Off by default ──────────────────────────────────────────────────────────
console.log("\n=== Off unless opts.heartRaw ===");
[undefined, {}, { transmuteRaw: true }, { heartRaw: false }].forEach((opts, i) => {
  test(`opts #${i} leaves the chain heart-free even with a 1-silver heart`, () => {
    const node = buildRefiningChain("T5_PLANKS", woodMarket({ heart: 1 }), FS, false, 0, opts);
    assert.strictEqual(node.inputs.length, 2);
    assert.strictEqual(rawInput(node).count, 3, "full raw count");
    assert.strictEqual(heartInput(node), undefined);
  });
});

// ── The decision threshold ──────────────────────────────────────────────────
console.log("\n=== heartEff < rawEff * (1 - rrr) ===");
// raw 200 → threshold 200 * (1 - 0.367...) = 126.58
[
  ["well under the threshold", 60, true],
  ["just under the threshold", 126, true],
  ["just over the threshold", 127, false],
  ["cheaper than the raw sticker but over the threshold", 190, false],
  ["dearer than the raw", 400, false],
].forEach(([label, heartPrice, expected]) => {
  test(`heart at ${heartPrice} — ${label} → used=${expected}`, () => {
    const node = buildRefiningChain(
      "T5_PLANKS", woodMarket({ heart: heartPrice }), FS, false, 0, HEART_ON);
    assert.strictEqual(!!heartInput(node), expected);
  });
});

test("no heart on the market at all → chain unchanged", () => {
  const node = buildRefiningChain("T5_PLANKS", woodMarket({}), FS, false, 0, HEART_ON);
  assert.strictEqual(node.inputs.length, 2);
  assert.strictEqual(rawInput(node).count, 3);
});

// ── Shape of the substituted node ───────────────────────────────────────────
console.log("\n=== inputs[] shape when the heart wins ===");
test("raw drops to rawRatio-1 and a 1x heart input is appended", () => {
  const node = buildRefiningChain("T5_PLANKS", woodMarket({ heart: 60 }), FS, false, 0, HEART_ON);
  assert.strictEqual(node.inputs.length, 3);
  assert.strictEqual(rawInput(node).count, 2, "3 - 1");
  const h = heartInput(node);
  assert.strictEqual(h.matId, TREEHEART);
  assert.strictEqual(h.count, 1);
  assert.strictEqual(h.noReturn, true, "a heart is fully consumed — RRR must not refund it");
  assert.strictEqual(h.sourcing.perUnit, 60);
  assert.strictEqual(h.sourcing.city, FS);
  assert.strictEqual(h.replacesMatId, "T5_WOOD", "the tree names the raw it stands in for");
});

// ── Cost math ───────────────────────────────────────────────────────────────
console.log("\n=== costPerOutput ===");
[
  ["no station fee", 0],
  ["with station fee", 1200],
].forEach(([label, fee]) => {
  test(`heart cost sits outside (1-rrr) but inside the setup fee — ${label}`, () => {
    __setStationFee({ 4: fee, 5: fee, 6: fee, 7: fee, 8: fee });
    const node = buildRefiningChain(
      "T5_PLANKS", woodMarket({ raw: 200, sec: 500, heart: 60 }), FS, false, 0, HEART_ON);
    const expected = ((2 * 200 + 1 * 500) * ONE_MINUS + 60) * 1.025 + fee;
    assert.ok(Math.abs(node.costPerOutput - expected) < 0.01,
      `${node.costPerOutput} vs ${expected.toFixed(2)}`);
  });
});

test("a losing heart leaves costPerOutput byte-identical to the flag-off chain", () => {
  const md = woodMarket({ heart: 400 });
  const withFlag = buildRefiningChain("T5_PLANKS", md, FS, false, 0, HEART_ON);
  const without = buildRefiningChain("T5_PLANKS", md, FS, false, 0, undefined);
  assert.strictEqual(withFlag.costPerOutput, without.costPerOutput);
});

test("taking the heart must actually be cheaper than not taking it", () => {
  const md = woodMarket({ heart: 60 });
  const withHeart = buildRefiningChain("T5_PLANKS", md, FS, false, 0, HEART_ON);
  const noHeart = buildRefiningChain("T5_PLANKS", md, FS, false, 0, undefined);
  assert.ok(withHeart.costPerOutput < noHeart.costPerOutput);
});

// ── Root refine only ────────────────────────────────────────────────────────
console.log("\n=== root refine only ===");
test("the nested secondary chain stays heart-free", () => {
  // T4_PLANKS priced out of reach so the T5 chain refines it itself.
  const md = priceMap([
    { id: "T5_WOOD", city: FS, buy: 200 },
    { id: "T4_PLANKS", city: FS, buy: 999999 },
    { id: "T4_WOOD", city: FS, buy: 200 },
    { id: "T3_PLANKS", city: FS, buy: 100 },
    { id: TREEHEART, city: FS, buy: 60 },
  ]);
  const node = buildRefiningChain("T5_PLANKS", md, FS, false, 0, HEART_ON);
  assert.ok(heartInput(node), "root refine takes the heart");
  const inner = node.inputs.find((i) => i.matId === "T4_PLANKS").sourcing.chain;
  assert.ok(inner, "the T4 plank is chain-sourced");
  assert.strictEqual(inner.inputs.length, 2, "inner refine has raw + secondary only");
  assert.ok(!inner.inputs.some((i) => i.sourcing && i.sourcing.source === "heart"));
});

test("calling buildRefiningChain at depth>0 directly takes no heart", () => {
  const node = buildRefiningChain("T5_PLANKS", woodMarket({ heart: 60 }), FS, false, 1, HEART_ON);
  assert.strictEqual(node.inputs.length, 2);
});

// ── Enchant gates ───────────────────────────────────────────────────────────
console.log("\n=== enchant gates ===");
[1, 2, 3].forEach((ench) => {
  test(`.${ench} enchanted refine still allows the heart`, () => {
    const suffix = `_LEVEL${ench}@${ench}`;
    const md = priceMap([
      { id: `T5_WOOD${suffix}`, city: FS, buy: 200 },
      { id: `T4_PLANKS${suffix}`, city: FS, buy: 500 },
      { id: TREEHEART, city: FS, buy: 60 },
    ]);
    const node = buildRefiningChain(`T5_PLANKS${suffix}`, md, FS, false, 0, HEART_ON);
    assert.ok(heartInput(node));
  });
});

test(".4 / pristine refine never takes a heart (no heart recipe variant exists)", () => {
  const md = priceMap([
    { id: "T5_WOOD_LEVEL4@4", city: FS, buy: 200 },
    { id: "T4_PLANKS_LEVEL4@4", city: FS, buy: 500 },
    { id: TREEHEART, city: FS, buy: 1 },
  ]);
  const node = buildRefiningChain("T5_PLANKS_LEVEL4@4", md, FS, false, 0, HEART_ON);
  assert.strictEqual(node.inputs.length, 2);
  assert.strictEqual(heartInput(node), undefined);
});

console.log("\n=== heartAllowedForRaw predicate (shared with refining-route.js) ===");
[
  ["wood", "T5_WOOD", true],
  ["wood", "T5_WOOD_LEVEL3@3", true],
  ["wood", "T5_WOOD_LEVEL4@4", false],
  ["hide", "T8_HIDE_LEVEL4@4", false],
  ["rock", "T5_ROCK", true],
  ["rock", "T5_ROCK_LEVEL1@1", false],
  ["rock", "T5_ROCK_LEVEL3@3", false],
  ["rock", "T5_ROCK_LEVEL4@4", false],
].forEach(([type, rawId, expected]) => {
  test(`heartAllowedForRaw("${type}", "${rawId}") === ${expected}`, () => {
    assert.strictEqual(heartAllowedForRaw(type, rawId), expected);
  });
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
