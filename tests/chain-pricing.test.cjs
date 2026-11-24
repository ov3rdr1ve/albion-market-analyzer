/**
 * Test: chain pricing for consumable ingredients.
 *
 * Verifies the auto-pick-cheaper logic that resolves a leaf ingredient (e.g.
 * T3_MEAT, T4_BREAD, T4_BUTTER) to either a direct market buy or a recursive
 * chain craft — whichever is cheaper. Chains supported:
 *   - Mill: T3_FLOUR ← T3_WHEAT
 *   - Bakery: T4_BREAD ← T3_FLOUR
 *   - Dairy: T4/T6/T8_BUTTER ← matching MILK
 *   - Alchemist: T6/T7/T8_ALCOHOL ← POTATO / CORN / PUMPKIN
 *   - Butcher: T3-T8_MEAT ← FARM_X_GROWN (output 18 per animal, no return)
 *   - Breeding: FARM_X_GROWN ← FARM_X_BABY + nutrition feed
 *
 * Run: node tests/chain-pricing.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// ── Load chain-recipes.js + chain-pricing.js + dependencies ──
const sandbox = `
let testCityForce = {};
let testOverrides = {};
function getOrderType() { return "market"; }
function isPriceOutlier() { return false; }
function getIQRBounds() { return { upper: Infinity }; }
function getOverridePrice(itemId, city) { return testOverrides[itemId + ":" + city] ?? null; }
function getCityForce(itemId, side) { return testCityForce[itemId]?.[side] ?? null; }
function getBuyPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function __setTestOverrides(map) { testOverrides = map || {}; }
function __setTestCityForce(map) { testCityForce = map || {}; }
const SETUP_FEE = 0;
`;

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const dataMountsSrc = loadFile("js/data-mounts.js");
const renderMountsSrc = loadFile("js/render-mounts.js") + loadFile("js/render-mounts-breeding-row.js") + loadFile("js/render-mounts-craft-row.js");
// Pull out helper functions defined before renderMountsTable (getBreedingMeta,
// findCheapestFeed, FOOD_ITEMS, etc.) so chain-pricing can reuse breeding meta.
const helperBlock = renderMountsSrc.slice(
  0,
  renderMountsSrc.indexOf("function renderMountsTable")
);

// data-farming.js first: chain-recipes.js derives the pasture chains (eggs,
// milk) from FARMING_PRODUCTION, and pasture-econ.js scales their batch.
const dataFarmingSrc = loadFile("js/data-farming.js");
const pastureEconSrc = loadFile("js/pasture-econ.js");
const chainRecipesSrc = loadFile("js/chain-recipes.js");
const chainPricingSrc = loadFile("js/chain-pricing.js");

const mod = new Module("chain-pricing-test");
mod._compile(
  sandbox + dataMountsSrc + helperBlock + dataFarmingSrc + chainRecipesSrc
    + pastureEconSrc + chainPricingSrc +
  "\nmodule.exports = { CHAIN_RECIPES, getChainSourcing, computeMatUnitCost, __setTestOverrides, __setTestCityForce };",
  "chain-pricing.js"
);
const {
  CHAIN_RECIPES,
  getChainSourcing,
  __setTestOverrides,
  __setTestCityForce,
} = mod.exports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const ROYAL_CITIES = ["Bridgewatch", "Lymhurst", "Fort Sterling", "Martlock", "Thetford"];

function priceMap(entries) {
  // entries: [{ id, city, buy }] -> { id: { city: { buy_price, volume_24h: 9999 } } }
  const out = {};
  for (const e of entries) {
    if (!out[e.id]) out[e.id] = {};
    out[e.id][e.city] = { buy_price: e.buy, sell_price: e.buy + 1, volume_24h: 9999 };
  }
  return out;
}

// ── Static data sanity ──
console.log("\n=== CHAIN_RECIPES coverage ===");
test("Meat T3-T8 entries exist with output 18 and noReturn", () => {
  for (let t = 3; t <= 8; t++) {
    const r = CHAIN_RECIPES[`T${t}_MEAT`];
    assert.ok(r, `T${t}_MEAT recipe missing`);
    assert.strictEqual(r.output, 18, `T${t}_MEAT output must be 18`);
    assert.strictEqual(r.station, "butcher");
    assert.strictEqual(r.inputs.length, 1);
    assert.strictEqual(r.inputs[0].noReturn, true, "butcher input must not refund");
  }
});

test("Mill recipe T3_FLOUR ← 1 T3_WHEAT", () => {
  const r = CHAIN_RECIPES.T3_FLOUR;
  assert.ok(r);
  assert.deepStrictEqual(r.inputs, [{ matId: "T3_WHEAT", count: 1 }]);
  assert.strictEqual(r.output, 1);
});

test("Bakery T4_BREAD ← 1 T3_FLOUR", () => {
  const r = CHAIN_RECIPES.T4_BREAD;
  assert.ok(r);
  assert.deepStrictEqual(r.inputs, [{ matId: "T3_FLOUR", count: 1 }]);
});

test("Dairy T4/T6/T8 BUTTER recipes exist", () => {
  assert.ok(CHAIN_RECIPES.T4_BUTTER);
  assert.ok(CHAIN_RECIPES.T6_BUTTER);
  assert.ok(CHAIN_RECIPES.T8_BUTTER);
  assert.deepStrictEqual(CHAIN_RECIPES.T4_BUTTER.inputs, [{ matId: "T4_MILK", count: 1 }]);
});

// Alchemist alcohol. The station matters: buildings.xml files T6/T7/T8_ALCOHOL
// under the ALCHEMIST craftbuilding, not the mill (which lists only flour and
// the butters), and the row's city bonus is picked from that station.
const ALCOHOL_CASES = [
  { id: "T6_ALCOHOL", crop: "T6_POTATO" },
  { id: "T7_ALCOHOL", crop: "T7_CORN" },
  { id: "T8_ALCOHOL", crop: "T8_PUMPKIN" },
];
ALCOHOL_CASES.forEach(({ id, crop }) => {
  test(`Alchemist ${id} ← 1 ${crop}`, () => {
    const r = CHAIN_RECIPES[id];
    assert.ok(r, `${id} missing from CHAIN_RECIPES`);
    assert.deepStrictEqual(r.inputs, [{ matId: crop, count: 1 }]);
    assert.strictEqual(r.output, 1);
    assert.strictEqual(r.station, "alchemist");
    assert.ok(!r.forcedChainOnly, `${id} must chain inside potion recipes too`);
  });
});

test("Butcher recipes reference the correct GROWN animal per tier", () => {
  const expected = {
    T3_MEAT: "T3_FARM_CHICKEN_GROWN",
    T4_MEAT: "T4_FARM_GOAT_GROWN",
    T5_MEAT: "T5_FARM_GOOSE_GROWN",
    T6_MEAT: "T6_FARM_SHEEP_GROWN",
    T7_MEAT: "T7_FARM_PIG_GROWN",
    T8_MEAT: "T8_FARM_COW_GROWN",
  };
  for (const [meat, grown] of Object.entries(expected)) {
    assert.strictEqual(CHAIN_RECIPES[meat].inputs[0].matId, grown);
  }
});

// ── Pricing behavior ──
console.log("\n=== getChainSourcing — meat ===");

test("market is cheaper → picks market", () => {
  __setTestOverrides({});
  __setTestCityForce({});
  const md = priceMap([
    { id: "T3_MEAT", city: "Lymhurst", buy: 100 },
    { id: "T3_FARM_CHICKEN_GROWN", city: "Lymhurst", buy: 5000 }, // grown=5000 → 250 per meat (expensive)
  ]);
  const result = getChainSourcing("T3_MEAT", md, ROYAL_CITIES);
  assert.strictEqual(result.source, "market");
  assert.strictEqual(result.perUnit, 100);
  assert.strictEqual(result.city, "Lymhurst");
});

test("chain is cheaper → picks chain (low grown price)", () => {
  __setTestOverrides({});
  __setTestCityForce({});
  // Grown = 290 → per meat = 290/20 = 14.5
  // Market T3_MEAT at 1000 → chain wins.
  const md = priceMap([
    { id: "T3_MEAT", city: "Lymhurst", buy: 1000 },
    { id: "T3_FARM_CHICKEN_GROWN", city: "Lymhurst", buy: 290 },
  ]);
  const result = getChainSourcing("T3_MEAT", md, ROYAL_CITIES);
  assert.strictEqual(result.source, "chain", `expected chain, got ${result.source}`);
  assert.ok(result.perUnit < 1000, "chain perUnit should beat market 1000");
  assert.ok(result.chain, "chain breakdown should be present");
});

test("missing both → returns market 0 fallback", () => {
  __setTestOverrides({});
  __setTestCityForce({});
  const md = priceMap([]);
  const result = getChainSourcing("T3_MEAT", md, ROYAL_CITIES);
  assert.strictEqual(result.source, "market");
  assert.strictEqual(result.perUnit, 0);
});

console.log("\n=== getChainSourcing — flour/bread (recursive) ===");

test("T3_FLOUR uses T3_WHEAT chain when wheat is cheaper", () => {
  __setTestOverrides({});
  __setTestCityForce({});
  // Wheat 50, market flour 100 → chain wins (50 < 100)
  const md = priceMap([
    { id: "T3_FLOUR", city: "Lymhurst", buy: 100 },
    { id: "T3_WHEAT", city: "Lymhurst", buy: 50 },
  ]);
  const result = getChainSourcing("T3_FLOUR", md, ROYAL_CITIES);
  assert.strictEqual(result.source, "chain");
  assert.strictEqual(result.perUnit, 50);
});

test("T4_BREAD recursively chains through flour and wheat", () => {
  __setTestOverrides({});
  __setTestCityForce({});
  // wheat 5 → flour 5 → bread 5; market bread 50
  const md = priceMap([
    { id: "T4_BREAD", city: "Lymhurst", buy: 50 },
    { id: "T3_FLOUR", city: "Lymhurst", buy: 30 },  // make T4_BREAD via T3_FLOUR=30
    { id: "T3_WHEAT", city: "Lymhurst", buy: 5 },   // OR make T3_FLOUR via wheat=5
  ]);
  const result = getChainSourcing("T4_BREAD", md, ROYAL_CITIES);
  assert.strictEqual(result.source, "chain");
  // Best chain: bread ← flour ← wheat = 5
  assert.strictEqual(result.perUnit, 5);
  // Make sure the chain breakdown contains the wheat leaf
  const flat = JSON.stringify(result.chain);
  assert.ok(flat.includes("T3_WHEAT"), "chain breakdown should contain T3_WHEAT");
});

console.log("\n=== getChainSourcing — butter ===");

test("T4_BUTTER chains through milk", () => {
  __setTestOverrides({});
  __setTestCityForce({});
  const md = priceMap([
    { id: "T4_BUTTER", city: "Lymhurst", buy: 500 },
    { id: "T4_MILK", city: "Lymhurst", buy: 200 },
  ]);
  const result = getChainSourcing("T4_BUTTER", md, ROYAL_CITIES);
  assert.strictEqual(result.source, "chain");
  assert.strictEqual(result.perUnit, 200);
});

console.log("\n=== getChainSourcing — alcohol ===");

// Parameterized both ways: the crop wins when it is cheaper than listed
// schnapps, the market wins when it is not.
ALCOHOL_CASES.forEach(({ id, crop }) => {
  test(`${id} chains through ${crop} when the crop is cheaper`, () => {
    __setTestOverrides({});
    __setTestCityForce({});
    const md = priceMap([
      { id, city: "Lymhurst", buy: 500 },
      { id: crop, city: "Lymhurst", buy: 200 },
    ]);
    const result = getChainSourcing(id, md, ROYAL_CITIES);
    assert.strictEqual(result.source, "chain");
    assert.strictEqual(result.perUnit, 200);
  });

  test(`${id} buys off the market when the crop costs more`, () => {
    __setTestOverrides({});
    __setTestCityForce({});
    const md = priceMap([
      { id, city: "Lymhurst", buy: 150 },
      { id: crop, city: "Lymhurst", buy: 900 },
    ]);
    const result = getChainSourcing(id, md, ROYAL_CITIES);
    assert.strictEqual(result.source, "market");
    assert.strictEqual(result.perUnit, 150);
  });
});

console.log("\n=== getChainSourcing — pasture byproducts ===");

// Milk and eggs stopped being non-chained leaves: a grown animal on a pasture
// slot eats 9 favorite crops per 22h cycle and hands back 9 of them, so they now
// compete pasture-vs-market like any other chain product. The cycle itself is
// covered by tests/consumable-pasture-chain.test.cjs; here we only assert that
// the leaf resolver sees the chain. isPremiumEnabled is absent from this
// sandbox, so the pasture prices at the Premium default (x2).
test("T4_MILK stays a market buy when listed milk undercuts the feed", () => {
  __setTestOverrides({});
  __setTestCityForce({});
  const md = priceMap([
    { id: "T4_MILK",   city: "Lymhurst", buy: 100 },
    { id: "T4_TURNIP", city: "Lymhurst", buy: 900 },
  ]);
  const result = getChainSourcing("T4_MILK", md, ROYAL_CITIES);
  assert.strictEqual(result.source, "market");
  assert.strictEqual(result.perUnit, 100);
});

test("T4_MILK takes the pasture when the feed is cheaper", () => {
  __setTestOverrides({});
  __setTestCityForce({});
  const md = priceMap([
    { id: "T4_MILK",   city: "Lymhurst", buy: 900 },
    { id: "T4_TURNIP", city: "Lymhurst", buy: 100 },
  ]);
  const result = getChainSourcing("T4_MILK", md, ROYAL_CITIES);
  assert.strictEqual(result.source, "chain");
  assert.strictEqual(result.chain.station, "pasture");
});

test("T3_EGG is chained from its feed too", () => {
  __setTestOverrides({});
  __setTestCityForce({});
  const r = CHAIN_RECIPES.T3_EGG;
  assert.ok(r, "T3_EGG should have a pasture chain");
  assert.strictEqual(r.inputs[0].matId, "T3_WHEAT");
  assert.strictEqual(r.station, "pasture");
});

console.log("\n=== Override prices respected in chain ===");

test("override on grown animal pulls chain cost down", () => {
  __setTestOverrides({
    "T3_FARM_CHICKEN_GROWN:Lymhurst": 19, // override grown to 19 silver
  });
  __setTestCityForce({});
  const md = priceMap([
    { id: "T3_MEAT", city: "Lymhurst", buy: 1000 },
  ]);
  const result = getChainSourcing("T3_MEAT", md, ROYAL_CITIES);
  assert.strictEqual(result.source, "chain");
  // grown=19; per meat=19/20≈0.95
  assert.ok(result.perUnit < 5, `expected very small chain cost, got ${result.perUnit}`);
});

console.log("\n=== Returns city info from chain ===");

test("chain result includes which city the leaves were sourced from", () => {
  __setTestOverrides({});
  __setTestCityForce({});
  const md = priceMap([
    { id: "T3_MEAT", city: "Lymhurst", buy: 1000 },
    { id: "T3_FARM_CHICKEN_GROWN", city: "Bridgewatch", buy: 100 },
  ]);
  const result = getChainSourcing("T3_MEAT", md, ROYAL_CITIES);
  assert.strictEqual(result.source, "chain");
  // Walk the chain — the grown leaf must be sourced from Bridgewatch
  const flat = JSON.stringify(result.chain);
  assert.ok(flat.includes("Bridgewatch"));
});

// ── Summary ──
console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
