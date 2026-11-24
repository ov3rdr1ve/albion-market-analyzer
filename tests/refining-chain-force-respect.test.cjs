/**
 * Test: refining chain honors city-force overrides only when compatible
 * with the refine city (matches render-transport.js:30-31 rule).
 *
 *   - Force on a chain leaf to a compatible city → honored
 *   - Force to an incompatible city (e.g. Caerleon while refining at Fort
 *     Sterling, BMR off) → ignored, falls back to the normal lookup
 *   - BMR on → any force is honored
 *
 * Run: node tests/refining-chain-force-respect.test.cjs
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
function __setBMR(v) { testBmrEnabled = !!v; }
function __setOverrides(m) { testOverrides = m || {}; }
function __setForce(m) { testCityForce = m || {}; }
function __reset() { __setBMR(false); __setOverrides({}); __setForce({}); }
`;

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const recipesSrc = loadFile("js/refining-chain-recipes.js");
const pricingSrc = loadFile("js/refining-chain-pricing.js");

const mod = new Module("refining-chain-force-test");
mod._compile(
  sandbox + recipesSrc + pricingSrc +
    "\nmodule.exports = { findCheapestMarketBuyForRefine, getRefiningSourcing, " +
    "__setBMR, __setOverrides, __setForce, __reset };",
  "refining-chain-force.js"
);
const { findCheapestMarketBuyForRefine, __setBMR, __setForce, __reset } = mod.exports;

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
const CAER = "Caerleon";
const BW = "Bridgewatch";

console.log("\n=== Compatible force is honored ===");

test("Force T6_WOOD to Bridgewatch while refining at Fort Sterling (both Royal) → honored", () => {
  __setForce({ T6_WOOD: { buy: BW } });
  const md = priceMap([
    { id: "T6_WOOD", city: FS, buy: 1 },     // cheaper
    { id: "T6_WOOD", city: BW, buy: 100 },   // forced
  ]);
  const r = findCheapestMarketBuyForRefine("T6_WOOD", md, FS);
  assert.strictEqual(r.city, BW);
  assert.strictEqual(r.price, 100);
});

console.log("\n=== Incompatible force is ignored ===");

test("Force to Caerleon while refining at Fort Sterling, BMR off → ignored", () => {
  __setForce({ T6_WOOD: { buy: CAER } });
  const md = priceMap([
    { id: "T6_WOOD", city: FS,   buy: 100 },
    { id: "T6_WOOD", city: CAER, buy: 1 },
  ]);
  const r = findCheapestMarketBuyForRefine("T6_WOOD", md, FS);
  assert.strictEqual(r.city, FS, "force to Caerleon should be ignored cross-zone");
  assert.strictEqual(r.price, 100);
});

test("Force to Royal while refining at Caerleon, BMR off → ignored", () => {
  __setForce({ T6_WOOD: { buy: FS } });
  const md = priceMap([
    { id: "T6_WOOD", city: FS,   buy: 1 },
    { id: "T6_WOOD", city: CAER, buy: 100 },
  ]);
  const r = findCheapestMarketBuyForRefine("T6_WOOD", md, CAER);
  assert.strictEqual(r.city, CAER, "force to Royal should be ignored when refining at Caerleon");
  assert.strictEqual(r.price, 100);
});

console.log("\n=== BMR on: any force honored ===");

test("BMR on: force to Caerleon honored even when refining at FS", () => {
  __setBMR(true);
  __setForce({ T6_WOOD: { buy: CAER } });
  const md = priceMap([
    { id: "T6_WOOD", city: FS,   buy: 100 },
    { id: "T6_WOOD", city: CAER, buy: 1 },
  ]);
  const r = findCheapestMarketBuyForRefine("T6_WOOD", md, FS);
  assert.strictEqual(r.city, CAER);
  assert.strictEqual(r.price, 1);
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
