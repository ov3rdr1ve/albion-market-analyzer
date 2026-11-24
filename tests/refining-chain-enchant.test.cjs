/**
 * Test: refining chain handles the T4 enchant boundary correctly.
 *
 * Per items.xml: T4 enchanted refining (e.g. T4_PLANKS_LEVEL1@1) consumes
 * a PLAIN T3_PLANKS, not an enchanted one. T5 and above inherit the
 * enchant level on the secondary input.
 *
 * Verifies that getRefiningSourcing builds chain trees with the correct
 * enchant on every step.
 *
 * Run: node tests/refining-chain-enchant.test.cjs
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
const CITY_REFINE_SPEC = {
  "Fort Sterling": "wood", Lymhurst: "fiber", Bridgewatch: "rock",
  Thetford: "ore", Martlock: "hide",
};
const RESOURCE_DEFS = [
  { type: "wood", raw: "WOOD", refined: "PLANKS",
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
function getOverridePrice(itemId, city) { return testOverrides[itemId+":"+city] ?? null; }
function getCityForce(itemId, side) { return testCityForce[itemId]?.[side] ?? null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getRefineRRR(city, type, useFocus) {
  let bonus = BASE_CITY_BONUS;
  if (CITY_REFINE_SPEC[city] === type) bonus += REFINE_SPEC_BONUS;
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}
function getFocusCost(id, t) { return Math.round(30 * Math.pow(2, t-4)); }
function calcStationFeeSilver() { return 0; }
function refineStationFeeSilver() { return 0; }
function __reset() { testBmrEnabled = false; testOverrides = {}; testCityForce = {}; }
`;

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}
const recipesSrc = loadFile("js/refining-chain-recipes.js");
const pricingSrc = loadFile("js/refining-chain-pricing.js");

const mod = new Module("refining-chain-enchant-test");
mod._compile(
  sandbox + recipesSrc + pricingSrc +
    "\nmodule.exports = { getRefiningSourcing, __reset };",
  "refining-chain-enchant.js"
);
const { getRefiningSourcing, __reset } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { __reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

function priceMap(entries) {
  const out = {};
  for (const e of entries) {
    if (!out[e.id]) out[e.id] = {};
    out[e.id][e.city] = { buy_price: e.buy, sell_price: (e.buy||0)+1, volume_24h: 9999 };
  }
  return out;
}

const FS = "Fort Sterling";

console.log("\n=== Enchant boundary at T4 ===");

test("T4.1 chain root inputs include plain T3_PLANKS as secondary", () => {
  const md = priceMap([
    { id: "T4_PLANKS_LEVEL1@1", city: FS, buy: 999999 },
    { id: "T4_WOOD_LEVEL1@1",   city: FS, buy: 1 },
    { id: "T3_PLANKS",          city: FS, buy: 1 },
    { id: "T3_PLANKS_LEVEL1@1", city: FS, buy: 999999 },  // wrong one — must NOT be picked
  ]);
  const r = getRefiningSourcing("T4_PLANKS_LEVEL1@1", md, FS, false);
  assert.strictEqual(r.source, "chain");
  assert.strictEqual(r.chain.inputs[0].matId, "T4_WOOD_LEVEL1@1");
  assert.strictEqual(r.chain.inputs[1].matId, "T3_PLANKS",
    "T4 enchanted secondary must be plain T3, not enchanted");
});

test("T5.1 chain root inputs include T4_PLANKS_LEVEL1@1 (enchant inherits)", () => {
  const md = priceMap([
    { id: "T5_PLANKS_LEVEL1@1", city: FS, buy: 999999 },
    { id: "T5_WOOD_LEVEL1@1",   city: FS, buy: 1 },
    { id: "T4_PLANKS_LEVEL1@1", city: FS, buy: 1 },
    { id: "T4_PLANKS",          city: FS, buy: 999999 },  // wrong one
  ]);
  const r = getRefiningSourcing("T5_PLANKS_LEVEL1@1", md, FS, false);
  assert.strictEqual(r.source, "chain");
  assert.strictEqual(r.chain.inputs[1].matId, "T4_PLANKS_LEVEL1@1",
    "T5+ secondary inherits the enchant suffix");
});

test("T6.3 → T5.3 → T4.3 → plain T3 (full enchant chain ending at T3)", () => {
  // All enchanted markets expensive, raws cheap → full chain wins.
  const md = priceMap([
    { id: "T6_PLANKS_LEVEL3@3", city: FS, buy: 999999 },
    { id: "T5_PLANKS_LEVEL3@3", city: FS, buy: 999999 },
    { id: "T4_PLANKS_LEVEL3@3", city: FS, buy: 999999 },
    { id: "T6_WOOD_LEVEL3@3",   city: FS, buy: 1 },
    { id: "T5_WOOD_LEVEL3@3",   city: FS, buy: 1 },
    { id: "T4_WOOD_LEVEL3@3",   city: FS, buy: 1 },
    { id: "T3_PLANKS",          city: FS, buy: 1 },
  ]);
  const r = getRefiningSourcing("T6_PLANKS_LEVEL3@3", md, FS, false);
  assert.strictEqual(r.source, "chain");

  // Walk: T6.3 → T5.3 → T4.3 → market T3 plain
  const t6 = r.chain;
  assert.strictEqual(t6.inputs[0].matId, "T6_WOOD_LEVEL3@3");
  assert.strictEqual(t6.inputs[1].matId, "T5_PLANKS_LEVEL3@3");
  assert.strictEqual(t6.inputs[1].sourcing.source, "chain");

  const t5 = t6.inputs[1].sourcing.chain;
  assert.strictEqual(t5.inputs[0].matId, "T5_WOOD_LEVEL3@3");
  assert.strictEqual(t5.inputs[1].matId, "T4_PLANKS_LEVEL3@3");
  assert.strictEqual(t5.inputs[1].sourcing.source, "chain");

  const t4 = t5.inputs[1].sourcing.chain;
  assert.strictEqual(t4.inputs[0].matId, "T4_WOOD_LEVEL3@3");
  assert.strictEqual(t4.inputs[1].matId, "T3_PLANKS",
    "T4 enchanted secondary must be plain T3");
  assert.strictEqual(t4.inputs[1].sourcing.source, "market");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
