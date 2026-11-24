/**
 * Test: pasture byproducts (milk, eggs) are a PRODUCTION chain, not a flip.
 *
 * A grown animal standing on a pasture slot eats `feedCount` favorite crops per
 * 22h cycle and hands back `produceBase` eggs/milk (doubled by Premium, +10% in
 * the city that specializes in that byproduct). The animal survives the harvest,
 * so it is reusable CAPITAL: priced for display, never charged to the cycle.
 *
 * These assertions are black-box over the pasture chain:
 *   - CHAIN_RECIPES carries one entry per FARMING_PRODUCTION byproduct
 *   - cost per output = feed cost / (output x yield multiplier)
 *   - the grown animal never moves the cost
 *   - milk/eggs compete pasture-vs-market like any other chain leaf
 *   - butter sources its milk through the pasture when that is cheaper
 *
 * Run: node tests/consumable-pasture-chain.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// -- Sandbox: market plumbing + the two knobs the pasture yield depends on --
const sandbox = `
let testCityForce = {};
let testOverrides = {};
let testPremium = false;
let testFarmBonus = {};
function getOrderType() { return "market"; }
function getIQRBounds() { return { upper: Infinity }; }
function getOverridePrice(itemId, city) { return testOverrides[itemId + ":" + city] ?? null; }
function getCityForce(itemId, side) { return testCityForce[itemId]?.[side] ?? null; }
function getBuyPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function isPremiumEnabled() { return testPremium; }
function getFarmingYieldBonus(city, outputId) { return testFarmBonus[city + ":" + outputId] || 0; }
function __setTestOverrides(map) { testOverrides = map || {}; }
function __setTestCityForce(map) { testCityForce = map || {}; }
function __setPremium(v) { testPremium = !!v; }
function __setFarmBonus(map) { testFarmBonus = map || {}; }
const SETUP_FEE = 0;
`;

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const mod = new Module("consumable-pasture-chain-test");
mod._compile(
  sandbox
    + loadFile("js/data-farming.js")
    + loadFile("js/chain-recipes.js")
    + loadFile("js/pasture-econ.js")
    + loadFile("js/chain-pricing.js")
    + "\nmodule.exports = { CHAIN_RECIPES, FARMING_PRODUCTION, getChainSourcing, forceChainSourcing,"
    + " getPastureYieldMultiplier, getOptimalPastureCity,"
    + " __setTestOverrides, __setTestCityForce, __setPremium, __setFarmBonus };",
  "consumable-pasture-chain.js"
);
const {
  CHAIN_RECIPES, FARMING_PRODUCTION, getChainSourcing, forceChainSourcing,
  getPastureYieldMultiplier, getOptimalPastureCity,
  __setTestOverrides, __setTestCityForce, __setPremium, __setFarmBonus,
} = mod.exports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const ROYAL_CITIES = ["Bridgewatch", "Lymhurst", "Fort Sterling", "Martlock", "Thetford"];

function priceMap(entries) {
  const out = {};
  for (const e of entries) {
    if (!out[e.id]) out[e.id] = {};
    out[e.id][e.city] = { buy_price: e.buy, sell_price: e.buy + 1, volume_24h: 9999 };
  }
  return out;
}

function reset() {
  __setTestOverrides({});
  __setTestCityForce({});
  __setPremium(false);
  __setFarmBonus({});
}

// The five pasture byproducts, read back from the farming catalog so the two
// tables can never drift apart.
const BYPRODUCTS = FARMING_PRODUCTION.filter((r) => r.type === "byproduct");

// -- Static data --
console.log("\n=== CHAIN_RECIPES - pasture entries ===");

test("every FARMING_PRODUCTION byproduct has a pasture chain", () => {
  assert.strictEqual(BYPRODUCTS.length, 5, "expected 5 byproducts (3 milk + 2 egg)");
});

BYPRODUCTS.forEach((b) => {
  test(`${b.outputId} from ${b.feedCount}x ${b.feedId}, output ${b.produceBase}, capital ${b.animalId}`, () => {
    const r = CHAIN_RECIPES[b.outputId];
    assert.ok(r, `${b.outputId} chain recipe missing`);
    assert.strictEqual(r.station, "pasture");
    assert.strictEqual(r.output, b.produceBase);
    assert.deepStrictEqual(r.inputs, [{ matId: b.feedId, count: b.feedCount, noReturn: true }]);
    assert.deepStrictEqual(r.capital, { matId: b.animalId, count: 1 });
    assert.ok(!r.forcedChainOnly, "pasture chains stay available to parent recipes");
  });
});

test("T7 pig has no byproduct chain (meat only)", () => {
  assert.ok(!CHAIN_RECIPES.T7_MILK);
  assert.ok(!CHAIN_RECIPES.T7_EGG);
});

test("crops and herbs are still leaves, not chains", () => {
  ["T4_TURNIP", "T6_POTATO", "T8_PUMPKIN", "T8_YARROW"].forEach((id) => {
    assert.ok(!CHAIN_RECIPES[id], `${id} must stay a market leaf`);
  });
});

test("butter still mills from milk 1:1", () => {
  assert.deepStrictEqual(CHAIN_RECIPES.T4_BUTTER.inputs, [{ matId: "T4_MILK", count: 1 }]);
  assert.strictEqual(CHAIN_RECIPES.T4_BUTTER.station, "mill");
});

// -- Yield multiplier --
console.log("\n=== getPastureYieldMultiplier ===");

const MULT_CASES = [
  { premium: false, bonus: 0,    expected: 1,   label: "free account, no spec city" },
  { premium: true,  bonus: 0,    expected: 2,   label: "Premium doubles the produce" },
  { premium: false, bonus: 0.10, expected: 1.1, label: "spec city adds +10%" },
  { premium: true,  bonus: 0.10, expected: 2.1, label: "Premium and spec city sum once" },
];

MULT_CASES.forEach((c) => {
  test(`multiplier - ${c.label} = x${c.expected}`, () => {
    reset();
    __setPremium(c.premium);
    __setFarmBonus(c.bonus > 0 ? { "Martlock:T4_MILK": c.bonus } : {});
    const mult = getPastureYieldMultiplier("T4_MILK", "Martlock");
    assert.ok(Math.abs(mult - c.expected) < 1e-9, `got ${mult}, want ${c.expected}`);
  });
});

test("getOptimalPastureCity picks the spec city out of the pool", () => {
  reset();
  __setFarmBonus({ "Thetford:T4_MILK": 0.10 });
  assert.strictEqual(getOptimalPastureCity("T4_MILK", ROYAL_CITIES, "Lymhurst"), "Thetford");
});

test("getOptimalPastureCity falls back when no pool city specializes", () => {
  reset();
  assert.strictEqual(getOptimalPastureCity("T4_MILK", ROYAL_CITIES, "Lymhurst"), "Lymhurst");
});

// -- Cost per output --
console.log("\n=== pasture cost per output ===");

// 9 turnips at 100 = 900 silver of feed per cycle, 9 milk out.
const COST_CASES = [
  { premium: false, bonus: 0,    expected: 100,  label: "free account" },
  { premium: true,  bonus: 0,    expected: 50,   label: "Premium (18 milk per cycle)" },
  { premium: true,  bonus: 0.10, expected: 900 / (9 * 2.1), label: "Premium in the spec city" },
];

COST_CASES.forEach((c) => {
  test(`T4_MILK - ${c.label} = ${c.expected.toFixed(2)} per milk`, () => {
    reset();
    __setPremium(c.premium);
    __setFarmBonus(c.bonus > 0 ? { "Thetford:T4_MILK": c.bonus } : {});
    const md = priceMap([{ id: "T4_TURNIP", city: "Lymhurst", buy: 100 }]);
    const sourcing = forceChainSourcing("T4_MILK", md, ROYAL_CITIES);
    assert.ok(sourcing, "pasture chain must build");
    assert.ok(
      Math.abs(sourcing.perUnit - c.expected) < 1e-9,
      `got ${sourcing.perUnit}, want ${c.expected}`
    );
  });
});

test("the grown animal is capital: its price never moves the cost", () => {
  reset();
  const feedOnly = priceMap([{ id: "T4_TURNIP", city: "Lymhurst", buy: 100 }]);
  const withAnimal = priceMap([
    { id: "T4_TURNIP", city: "Lymhurst", buy: 100 },
    { id: "T4_FARM_GOAT_GROWN", city: "Lymhurst", buy: 250000 },
  ]);
  const a = forceChainSourcing("T4_MILK", feedOnly, ROYAL_CITIES);
  const b = forceChainSourcing("T4_MILK", withAnimal, ROYAL_CITIES);
  assert.strictEqual(a.perUnit, 100);
  assert.strictEqual(b.perUnit, 100);
});

test("the chain node carries the capital, the pasture city and the yield", () => {
  reset();
  __setPremium(true);
  __setFarmBonus({ "Thetford:T4_MILK": 0.10 });
  const md = priceMap([{ id: "T4_TURNIP", city: "Lymhurst", buy: 100 }]);
  const chain = forceChainSourcing("T4_MILK", md, ROYAL_CITIES).chain;
  assert.deepStrictEqual(chain.capital, { matId: "T4_FARM_GOAT_GROWN", count: 1 });
  assert.strictEqual(chain.pastureCity, "Thetford");
  assert.ok(Math.abs(chain.yieldMult - 2.1) < 1e-9);
  // The printed batch stays the real per-cycle one: 9 turnips in, 9 milk out.
  assert.strictEqual(chain.output, 9);
  assert.strictEqual(chain.inputs[0].count, 9);
});

// -- Pasture vs market --
console.log("\n=== getChainSourcing - pasture competes with the market ===");

test("pasture wins when the feed is cheaper than listed milk", () => {
  reset();
  const md = priceMap([
    { id: "T4_MILK",   city: "Lymhurst", buy: 400 },
    { id: "T4_TURNIP", city: "Lymhurst", buy: 100 }, // 100 per milk
  ]);
  const result = getChainSourcing("T4_MILK", md, ROYAL_CITIES);
  assert.strictEqual(result.source, "chain");
  assert.strictEqual(result.perUnit, 100);
});

test("market wins when listed milk undercuts the feed", () => {
  reset();
  const md = priceMap([
    { id: "T4_MILK",   city: "Lymhurst", buy: 40 },
    { id: "T4_TURNIP", city: "Lymhurst", buy: 100 },
  ]);
  const result = getChainSourcing("T4_MILK", md, ROYAL_CITIES);
  assert.strictEqual(result.source, "market");
  assert.strictEqual(result.perUnit, 40);
});

test("eggs behave the same as milk", () => {
  reset();
  const md = priceMap([
    { id: "T3_EGG",   city: "Lymhurst", buy: 500 },
    { id: "T3_WHEAT", city: "Lymhurst", buy: 60 },
  ]);
  const result = getChainSourcing("T3_EGG", md, ROYAL_CITIES);
  assert.strictEqual(result.source, "chain");
  assert.strictEqual(result.perUnit, 60);
});

test("no feed listed - pasture unbuildable, market stands", () => {
  reset();
  const md = priceMap([{ id: "T4_MILK", city: "Lymhurst", buy: 400 }]);
  const result = getChainSourcing("T4_MILK", md, ROYAL_CITIES);
  assert.strictEqual(result.source, "market");
  assert.strictEqual(result.perUnit, 400);
});

// -- Butter through the pasture --
console.log("\n=== butter sources milk through the pasture ===");

test("T4_BUTTER chains into the pasture when that beats listed milk", () => {
  reset();
  const md = priceMap([
    { id: "T4_BUTTER", city: "Lymhurst", buy: 900 },
    { id: "T4_MILK",   city: "Lymhurst", buy: 400 },
    { id: "T4_TURNIP", city: "Lymhurst", buy: 100 },
  ]);
  const result = getChainSourcing("T4_BUTTER", md, ROYAL_CITIES);
  assert.strictEqual(result.source, "chain");
  assert.strictEqual(result.perUnit, 100, "butter costs one pasture milk");
  assert.strictEqual(result.chain.inputs[0].sourcing.source, "chain");
});

test("T4_BUTTER keeps buying milk when the market is cheaper", () => {
  reset();
  const md = priceMap([
    { id: "T4_BUTTER", city: "Lymhurst", buy: 900 },
    { id: "T4_MILK",   city: "Lymhurst", buy: 40 },
    { id: "T4_TURNIP", city: "Lymhurst", buy: 100 },
  ]);
  const result = getChainSourcing("T4_BUTTER", md, ROYAL_CITIES);
  assert.strictEqual(result.source, "chain");
  assert.strictEqual(result.perUnit, 40);
  assert.strictEqual(result.chain.inputs[0].sourcing.source, "market");
});

// -- Summary --
console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
