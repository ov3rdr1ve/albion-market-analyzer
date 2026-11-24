/**
 * Test: resolveRefineRawHeart (render-transport.js) — the row-level glue that
 * decides whether a faction heart replaces ONE raw unit in a refine, returning
 * the kept market-raw count, the heart's non-returnable cost, and display info.
 * Compiles recipes + pricing + render so the real getHeartSubstitute /
 * chooseRawWithHeart drive the decision.
 *
 * Run: node tests/refining-heart-row-resolution.test.cjs
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
const BASE_CITY_BONUS = 0.18;
const REFINE_SPEC_BONUS = 0.40;
const FOCUS_BONUS = 0.59;
const CITY_REFINE_SPEC = { "Fort Sterling": "wood", Lymhurst: "fiber", Bridgewatch: "rock", Thetford: "ore", Martlock: "hide" };
const RESOURCE_DEFS = [
  { type: "wood",  raw: "WOOD",  refined: "PLANKS",     tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "fiber", raw: "FIBER", refined: "CLOTH",      tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];
function isBlackRedZoneEnabled() { return false; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function getOverridePrice() { return null; }
function getCityForce() { return null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].buy_price) || 0; }
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getRefineRRR(city, t, f) { let b = BASE_CITY_BONUS; if (CITY_REFINE_SPEC[city]===t) b+=REFINE_SPEC_BONUS; if (f) b+=FOCUS_BONUS; return calcRRR(b); }
function getFocusCost(id, tier) { return Math.round(30 * Math.pow(2, tier - 4)); }
function calcStationFeeSilver() { return 0; }
function refineStationFeeSilver() { return 0; }
function getItemDisplayName(id){ return id; }
function matPriceSpan(){ return ""; }
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }

const mod = new Module("heart-row-resolution-test");
mod._compile(
  sandbox + loadFile("js/refining-chain-recipes.js") + loadFile("js/refining-chain-pricing.js") +
    loadFile("js/refining-route.js") + loadFile("js/render-transport.js") + "\nmodule.exports = { resolveRefineRawHeart };",
  "render-transport.js"
);
const { resolveRefineRawHeart } = mod.exports;

const FS = "Fort Sterling";
const TREEHEART = "T1_FACTION_FOREST_TOKEN_1";
const RRR = 0.58 / 1.58;
function md(entries) {
  const out = {};
  for (const e of entries) { (out[e.id] ||= {})[e.city] = { buy_price: e.buy, volume_24h: 9999 }; }
  return out;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("resolveRefineRawHeart tests\n");

test("cheap heart wins: keeps rawRatio-1 raws, heartCost set, secHeart populated", () => {
  // rawPrice 200, threshold 200*(1-rrr)=126.58 ; heart 50 wins
  const r = resolveRefineRawHeart("wood", 5, 200, RRR, md([{ id: TREEHEART, city: FS, buy: 50 }]), FS, "T7_WOOD");
  assert.strictEqual(r.usedHeart, true);
  assert.strictEqual(r.rawKeptCount, 4);
  assert.strictEqual(r.heartCost, 50);
  assert.ok(r.secHeart && r.secHeart.id === TREEHEART && r.secHeart.price === 50 && r.secHeart.count === 1);
});

test("heart pricier than one RRR-discounted raw → keep all raws", () => {
  // heart 130 > threshold 126.58 (even though 130 < raw 200) → loses
  const r = resolveRefineRawHeart("wood", 5, 200, RRR, md([{ id: TREEHEART, city: FS, buy: 130 }]), FS, "T7_WOOD");
  assert.strictEqual(r.usedHeart, false);
  assert.strictEqual(r.rawKeptCount, 5);
  assert.strictEqual(r.heartCost, 0);
  assert.strictEqual(r.secHeart, null);
});

test("no heart in market → keep all raws", () => {
  const r = resolveRefineRawHeart("wood", 5, 200, RRR, md([]), FS, "T7_WOOD");
  assert.strictEqual(r.usedHeart, false);
  assert.strictEqual(r.rawKeptCount, 5);
});

test("uses the resource's own heart (fiber→Vineheart, not Treeheart)", () => {
  const r = resolveRefineRawHeart("fiber", 5, 200, RRR,
    md([{ id: "T1_FACTION_SWAMP_TOKEN_1", city: FS, buy: 1 }]), FS, "T7_FIBER");
  assert.strictEqual(r.usedHeart, true);
  assert.strictEqual(r.secHeart.id, "T1_FACTION_SWAMP_TOKEN_1");
});

// The token swap exists only in the "Tier 4 and above" refining recipes, so the
// T2/T3 steps at the bottom of the ladder buy their raw outright even when a
// heart would be cheaper.
test("a T2/T3 refine never takes a heart, however cheap it is", () => {
  for (const rawId of ["T2_WOOD", "T3_WOOD"]) {
    const r = resolveRefineRawHeart("wood", 2, 200, RRR, md([{ id: TREEHEART, city: FS, buy: 1 }]), FS, rawId);
    assert.strictEqual(r.usedHeart, false, `${rawId} took a heart`);
    assert.strictEqual(r.rawKeptCount, 2);
    assert.strictEqual(r.secHeart, null);
  }
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
