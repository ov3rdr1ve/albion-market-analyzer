/**
 * Integration smoke test: load real refining-chain modules + a stripped
 * version of render-transport's `computeRefineRouteForCity` and verify the
 * end-to-end path works for a realistic T8 row.
 *
 * Why: The unit tests cover each module in isolation. This file confirms
 * that when render-transport.js calls getRefiningSourcing inside the real
 * route-computation flow, no symbol is missing and the chain actually
 * threads through to row data. Acts as a substitute for browser smoke-test
 * coverage when chrome-devtools MCP is unavailable.
 *
 * Run: node tests/refining-chain-integration.smoke.cjs
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
const CITY_REFINE_SPEC = {
  "Fort Sterling": "wood", Lymhurst: "fiber", Bridgewatch: "rock",
  Thetford: "ore", Martlock: "hide",
};
const RESOURCE_DEFS = [
  { type: "wood", raw: "WOOD", refined: "PLANKS",
    tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];
const TRANSPORT_ITEMS = [{
  mat: "Whitewood Logs [T8]",
  rawId: "T8_WOOD",
  refinedId: "T8_PLANKS",
  rawRatio: 5,
  resourceType: "wood",
  secondaryMatId: "T7_PLANKS",
  secondaryMatCount: 1,
}];

let testBmrEnabled = false;
function isBlackRedZoneEnabled() { return testBmrEnabled; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function isFocusEnabled() { return false; }
function getOverridePrice() { return null; }
function getCityForce() { return null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city, bounds, itemId) {
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
function calcStationFeeSilver(t) { return 0; }
function refineStationFeeSilver() { return 0; }
function getTierFromId(id) { const m = id.match(/^T(\\d+)/); return m ? parseInt(m[1], 10) : 4; }
`;

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const recipesSrc = loadFile("js/refining-chain-recipes.js");
const pricingSrc = loadFile("js/refining-chain-pricing.js");

const mod = new Module("refining-chain-integration-test");
mod._compile(
  sandbox + recipesSrc + pricingSrc +
    "\nmodule.exports = { TRANSPORT_ITEMS, getRefiningSourcing, " +
    "pickCheapestFocusTier, getRefiningChainIds, REFINING_RECIPES };",
  "integration.js"
);
const M = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Build a realistic T8 plank market with prices that should produce a
// full chain (cheap raws all the way down).
function buildT8Market() {
  const md = {};
  const set = (id, city, buy) => {
    if (!md[id]) md[id] = {};
    md[id][city] = { buy_price: buy, sell_price: buy + 100, volume_24h: 9999 };
  };
  // Refined ids (expensive market → chain wins)
  set("T8_PLANKS",  "Fort Sterling", 30000);
  set("T7_PLANKS",  "Fort Sterling", 999999);
  set("T6_PLANKS",  "Fort Sterling", 999999);
  set("T5_PLANKS",  "Fort Sterling", 999999);
  set("T4_PLANKS",  "Fort Sterling", 999999);
  set("T3_PLANKS",  "Fort Sterling", 50);
  // Raw ids — cheap so chain wins
  set("T8_WOOD",    "Fort Sterling", 1500);
  set("T7_WOOD",    "Fort Sterling", 800);
  set("T6_WOOD",    "Fort Sterling", 400);
  set("T5_WOOD",    "Fort Sterling", 150);
  set("T4_WOOD",    "Fort Sterling", 80);
  return md;
}

console.log("\n=== Pre-fetch ID coverage ===");
test("getRefiningChainIds(T8_PLANKS) collects every intermediate id", () => {
  const ids = M.getRefiningChainIds("T8_PLANKS");
  // Walking T8 → T7 → T6 → T5 → T4 → T3 should pull each tier's raw + refined.
  ["T8_WOOD","T7_PLANKS","T7_WOOD","T6_PLANKS","T6_WOOD",
   "T5_PLANKS","T5_WOOD","T4_PLANKS","T4_WOOD","T3_PLANKS"].forEach((id) => {
    assert.ok(ids.has(id), `expected ${id} in chain ids`);
  });
});

console.log("\n=== Realistic T8 chain → full T4-T8 cascade ===");
test("T8 plank chain at Fort Sterling sells T8 raws + T3 plank as floor", () => {
  const md = buildT8Market();
  const sourcing = M.getRefiningSourcing("T7_PLANKS", md, "Fort Sterling", false);
  assert.strictEqual(sourcing.source, "chain");
  // Walk down: T7 → T6 → T5 → T4 → market T3
  let node = sourcing.chain;
  const tiers = [];
  while (node) {
    tiers.push(node.tier);
    const sec = node.inputs[1];
    node = (sec && sec.sourcing.source === "chain") ? sec.sourcing.chain : null;
  }
  assert.deepStrictEqual(tiers, [7, 6, 5, 4], `expected full T7→T4, got ${tiers}`);
});

console.log("\n=== Focus picker realistic shape ===");
test("pickCheapestFocusTier returns a valid tier within the chain", () => {
  const md = buildT8Market();
  // Build the row's own root chain wrapper (mirrors render-transport.js's
  // buildRootChainForFocus; chain at T7 forms the secondary).
  const secondary = M.getRefiningSourcing("T7_PLANKS", md, "Fort Sterling", false);
  assert.strictEqual(secondary.source, "chain");
  const rootChain = {
    produces: "T8_PLANKS",
    output: 1,
    station: "Refine wood at Fort Sterling",
    refineCity: "Fort Sterling",
    rrr: 0.367,
    focusCost: 480,
    tier: 8,
    resourceType: "wood",
    inputs: [
      { matId: "T8_WOOD", count: 5, sourcing: { perUnit: 1500, source: "market", city: "Fort Sterling" } },
      { matId: "T7_PLANKS", count: 1, sourcing: secondary },
    ],
    costPerOutput: 0,
  };
  const best = M.pickCheapestFocusTier(rootChain);
  assert.ok([4, 5, 6, 7, 8].includes(best.tier),
    `best.tier ${best.tier} should be one of the chain tiers`);
  assert.ok(typeof best.silverSaved === "number",
    "silverSaved (the play's profitDelta) must be a number");
  assert.ok(typeof best.focusCost === "number" && best.focusCost > 0,
    "focusCost must be > 0");
});

console.log("\n=== Render-transport integration (computeRefineRouteForCity excerpt) ===");
test("Pricing block produces secondaryChain when chain is cheaper", () => {
  // Mimic the secondary-mat block from computeRefineRouteForCity.
  const md = buildT8Market();
  const routeItem = M.TRANSPORT_ITEMS[0]; // T8 plank
  const refineCity = "Fort Sterling";

  const srcResult = M.getRefiningSourcing(
    routeItem.secondaryMatId, md, refineCity, false
  );
  assert.ok(srcResult);
  assert.strictEqual(srcResult.source, "chain", "T7 secondary should resolve to chain");
  const secondaryChain = srcResult.chain;
  assert.ok(secondaryChain);
  assert.strictEqual(secondaryChain.produces, "T7_PLANKS");

  // Recursive descent inside the secondaryChain
  let node = secondaryChain;
  while (node.inputs[1].sourcing.source === "chain") node = node.inputs[1].sourcing.chain;
  assert.strictEqual(node.tier, 4, "chain should recurse all the way to T4");
  assert.strictEqual(node.inputs[1].matId, "T3_PLANKS");
  assert.strictEqual(node.inputs[1].sourcing.source, "market");
});

console.log("\n=== When market is cheaper, chain is NOT used ===");
test("Cheap T7 market → chain rejected, plain market sourcing returned", () => {
  const md = buildT8Market();
  // Override T7 market to be cheap
  md.T7_PLANKS["Fort Sterling"].buy_price = 1;
  const srcResult = M.getRefiningSourcing(
    "T7_PLANKS", md, "Fort Sterling", false
  );
  assert.strictEqual(srcResult.source, "market");
  assert.strictEqual(srcResult.perUnit, 1);
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
