/**
 * Test: refining chain respects the Caerleon ↔ Royal city split.
 *
 * In BMR-off mode: when refining at Caerleon, all chain leaves must be
 * sourced from Caerleon. When refining at a Royal city (e.g., Fort Sterling),
 * all chain leaves must be sourced from a Royal city — never Caerleon.
 *
 * In BMR-on mode (Black/Red Zone enabled): any city is valid at any tier.
 *
 * Run: node tests/refining-chain-caerleon.test.cjs
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

const mod = new Module("refining-chain-caerleon-test");
mod._compile(
  sandbox + recipesSrc + pricingSrc +
    "\nmodule.exports = { getRefiningSourcing, findCheapestMarketBuyForRefine, " +
    "__setBMR, __setOverrides, __setForce, __reset };",
  "refining-chain-caerleon.js"
);
const { getRefiningSourcing, findCheapestMarketBuyForRefine,
        __setBMR, __reset } = mod.exports;

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

// Walk the chain and collect every market-leaf city.
function collectMarketCities(chain) {
  const out = [];
  for (const inp of chain.inputs) {
    if (inp.sourcing.source === "market") out.push(inp.sourcing.city);
    else if (inp.sourcing.chain) out.push(...collectMarketCities(inp.sourcing.chain));
  }
  return out;
}

console.log("\n=== BMR off: refine at Fort Sterling → all leaves Royal ===");

test("Royal-side raw cheaper than Caerleon → Royal picked", () => {
  const md = priceMap([
    { id: "T5_PLANKS", city: FS,   buy: 999999 },
    { id: "T5_WOOD",   city: FS,   buy: 100 },
    { id: "T5_WOOD",   city: CAER, buy: 1 },     // cheaper but cross-zone
    { id: "T4_PLANKS", city: FS,   buy: 200 },
    { id: "T4_PLANKS", city: CAER, buy: 1 },
    { id: "T4_WOOD",   city: FS,   buy: 999999 },
    { id: "T3_PLANKS", city: FS,   buy: 999999 },
  ]);
  const r = getRefiningSourcing("T5_PLANKS", md, FS, false);
  assert.strictEqual(r.source, "chain");
  const cities = collectMarketCities(r.chain);
  assert.ok(cities.length > 0);
  for (const c of cities) {
    assert.notStrictEqual(c, CAER, `leaf city ${c} must not be Caerleon when refining at Fort Sterling`);
  }
});

console.log("\n=== BMR off: refine at Caerleon → all leaves Caerleon ===");

test("Caerleon raw used when refining at Caerleon, even if Royal is cheaper", () => {
  const md = priceMap([
    { id: "T5_PLANKS", city: CAER, buy: 999999 },
    { id: "T5_WOOD",   city: FS,   buy: 1 },     // cheap but cross-zone — must skip
    { id: "T5_WOOD",   city: CAER, buy: 100 },
    { id: "T4_PLANKS", city: FS,   buy: 1 },
    { id: "T4_PLANKS", city: CAER, buy: 200 },
    { id: "T4_WOOD",   city: CAER, buy: 999999 },
    { id: "T3_PLANKS", city: CAER, buy: 999999 },
  ]);
  const r = getRefiningSourcing("T5_PLANKS", md, CAER, false);
  assert.strictEqual(r.source, "chain");
  const cities = collectMarketCities(r.chain);
  assert.ok(cities.length > 0);
  for (const c of cities) {
    assert.strictEqual(c, CAER, `leaf city ${c} must be Caerleon when refining at Caerleon`);
  }
});

console.log("\n=== BMR on: any city allowed at any tier ===");

test("BMR enabled → cheapest globally is picked even across zones", () => {
  __setBMR(true);
  const md = priceMap([
    { id: "T5_PLANKS", city: FS,   buy: 999999 },
    { id: "T5_WOOD",   city: FS,   buy: 100 },
    { id: "T5_WOOD",   city: CAER, buy: 1 },     // global min
    { id: "T4_PLANKS", city: CAER, buy: 50 },
    { id: "T4_WOOD",   city: FS,   buy: 999999 },
    { id: "T3_PLANKS", city: FS,   buy: 999999 },
  ]);
  const r = getRefiningSourcing("T5_PLANKS", md, FS, false);
  assert.strictEqual(r.source, "chain");
  // T5_WOOD should resolve to Caerleon (cheapest global)
  assert.strictEqual(r.chain.inputs[0].sourcing.city, CAER);
});

console.log("\n=== findCheapestMarketBuyForRefine direct ===");

test("Helper excludes Caerleon when refineCity = Royal and BMR off", () => {
  const md = priceMap([
    { id: "T6_WOOD", city: FS,   buy: 100 },
    { id: "T6_WOOD", city: CAER, buy: 1 },
  ]);
  const r = findCheapestMarketBuyForRefine("T6_WOOD", md, FS);
  assert.strictEqual(r.city, FS);
  assert.strictEqual(r.price, 100);
});

test("Helper excludes Royals when refineCity = Caerleon and BMR off", () => {
  const md = priceMap([
    { id: "T6_WOOD", city: FS,   buy: 1 },
    { id: "T6_WOOD", city: CAER, buy: 100 },
  ]);
  const r = findCheapestMarketBuyForRefine("T6_WOOD", md, CAER);
  assert.strictEqual(r.city, CAER);
  assert.strictEqual(r.price, 100);
});

test("Helper allows global min when BMR is enabled", () => {
  __setBMR(true);
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
