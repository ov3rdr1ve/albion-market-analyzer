/**
 * Test: consumables with CHAIN_RECIPES always render the chain breakdown.
 *
 * Bug repro: in the consumables table, "Raw Mutton [T6 Meat]" was showing
 * "Buy: Fort Sterling → Sell: Martlock" — i.e. a flip route — when the
 * cheap market sell of Mutton beat the breed→butcher chain cost. The user
 * isn't flipping raw meat; they want the chain (animal → butcher → meat)
 * to be visible regardless of which path is cheaper.
 *
 * The fix introduces `forceChainSourcing(matId, marketData, cities)` which
 * always returns the chain breakdown (or null when the chain itself is
 * unbuildable — e.g. missing baby/feed prices), bypassing the
 * market-vs-chain comparison in `getChainSourcing`.
 *
 * Scope of "always show chain": only items with a CHAIN_RECIPES entry —
 * raw meat T3-T8, T3_FLOUR, T4_BREAD, T4/T6/T8 BUTTER, T6/T7/T8 ALCOHOL.
 * These are all "I'm producing this", not "I'm arbitraging this".
 *
 * Run: node tests/consumables-chain-always.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// ── Sandbox identical to chain-pricing.test.cjs so getChainSourcing's
// dependencies (override/force/IQR helpers, getBuyPrice) are stubbed in.
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

// data-mounts + render-mounts (helpers only) supply breeding metadata so
// the butcher chain can resolve baby + feed.
const dataMountsSrc = loadFile("js/data-mounts.js");
const renderMountsSrc = loadFile("js/render-mounts.js") + loadFile("js/render-mounts-breeding-row.js") + loadFile("js/render-mounts-craft-row.js");
const helperBlock = renderMountsSrc.slice(
  0,
  renderMountsSrc.indexOf("function renderMountsTable")
);
const chainRecipesSrc = loadFile("js/chain-recipes.js");
const chainPricingSrc = loadFile("js/chain-pricing.js");

const mod = new Module("consumables-chain-always-test");
mod._compile(
  sandbox + dataMountsSrc + helperBlock + chainRecipesSrc + chainPricingSrc +
  "\nmodule.exports = { CHAIN_RECIPES, getChainSourcing, forceChainSourcing, __setTestOverrides, __setTestCityForce };",
  "consumables-chain-always.js"
);
const {
  getChainSourcing,
  forceChainSourcing,
  __setTestOverrides,
  __setTestCityForce,
} = mod.exports;

const ROYAL_CITIES = ["Bridgewatch", "Lymhurst", "Fort Sterling", "Martlock", "Thetford"];

function priceMap(entries) {
  const out = {};
  for (const e of entries) {
    if (!out[e.id]) out[e.id] = {};
    out[e.id][e.city] = { buy_price: e.buy, sell_price: e.buy + 1, volume_24h: 9999 };
  }
  return out;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── Public API exists ─────────────────────────────────────────────────────
console.log("\n=== forceChainSourcing surface ===");

test("forceChainSourcing is exported", () => {
  assert.strictEqual(typeof forceChainSourcing, "function",
    "forceChainSourcing must be defined for the consumables row-builder to call");
});

// ── Behavior: always returns chain when chain is buildable ────────────────
console.log("\n=== Always-chain behavior ===");

test("market is cheaper but chain is buildable → still returns chain (grown sheep input)", () => {
  __setTestOverrides({});
  __setTestCityForce({});
  // Raw mutton (T6_MEAT) chain prices the GROWN sheep directly off the
  // market — breeding is tracked in the dedicated mounts table, so the
  // butcher chain stops at "buy grown sheep". Per-meat cost = grown / 18
  // (every animal yields 18 raw meat per the butcher recipe, conservative
  // — city RRR adds extra meats on top but is applied later in the renderer).
  const md = priceMap([
    { id: "T6_MEAT", city: "Fort Sterling", buy: 50 },
    { id: "T6_FARM_SHEEP_GROWN", city: "Fort Sterling", buy: 86_000 },
  ]);
  const result = forceChainSourcing("T6_MEAT", md, ROYAL_CITIES);
  assert.ok(result, "expected a sourcing object, got null");
  assert.strictEqual(result.source, "chain",
    `expected source=chain even when market is cheaper, got ${result.source}`);
  assert.ok(result.chain, "chain breakdown must be present");
  assert.strictEqual(result.chain.station, "butcher");
  assert.strictEqual(result.chain.inputs.length, 1, "butcher chain has a single grown-animal input");
  assert.strictEqual(result.chain.inputs[0].matId, "T6_FARM_SHEEP_GROWN");
  // 86,000 / 18 = 4,777.78 per meat (yield is 18, not 20 — verified vs items.xml)
  assert.ok(Math.abs(result.perUnit - 86_000 / 18) < 1e-6,
    `expected ${86_000 / 18}, got ${result.perUnit}`);
});

test("contrast: getChainSourcing picks market in the same scenario", () => {
  // Sanity: confirms forceChainSourcing diverges from getChainSourcing.
  __setTestOverrides({});
  __setTestCityForce({});
  const md = priceMap([
    { id: "T6_MEAT", city: "Fort Sterling", buy: 50 },
    { id: "T6_FARM_SHEEP_GROWN", city: "Fort Sterling", buy: 86_000 },
  ]);
  const result = getChainSourcing("T6_MEAT", md, ROYAL_CITIES);
  assert.strictEqual(result.source, "market",
    "getChainSourcing should still pick the cheaper market — only the consumables row-builder needs forceChainSourcing");
  assert.strictEqual(result.perUnit, 50);
});

test("chain stays the choice when chain is genuinely cheaper too", () => {
  __setTestOverrides({});
  __setTestCityForce({});
  const md = priceMap([
    { id: "T3_MEAT", city: "Lymhurst", buy: 10_000 },
    { id: "T3_FARM_CHICKEN_GROWN", city: "Lymhurst", buy: 290 },  // 290/20 = 14.5
  ]);
  const result = forceChainSourcing("T3_MEAT", md, ROYAL_CITIES);
  assert.strictEqual(result.source, "chain");
  assert.ok(result.perUnit < 10_000);
  assert.ok(result.chain);
});

test("no grown price → returns skeleton chain (grown sheep listed, price 0)", () => {
  __setTestOverrides({});
  __setTestCityForce({});
  // The user wants to SEE the chain (Grown Sheep) even when nothing has
  // live market data, so they can override the price via click-to-edit.
  const md = priceMap([
    { id: "T6_MEAT", city: "Fort Sterling", buy: 50 },
  ]);
  const result = forceChainSourcing("T6_MEAT", md, ROYAL_CITIES);
  assert.ok(result, "expected skeleton chain, got null");
  assert.strictEqual(result.source, "chain");
  const chain = result.chain;
  assert.strictEqual(chain.station, "butcher");
  assert.strictEqual(chain.inputs.length, 1, "single grown-animal input");
  const grown = chain.inputs[0];
  assert.strictEqual(grown.matId, "T6_FARM_SHEEP_GROWN");
  assert.strictEqual(grown.sourcing.perUnit, 0, "grown price 0 when missing");
  assert.ok(grown.sourcing.city, "grown fallback city must be set so click-to-edit has a target");
  assert.ok(ROYAL_CITIES.includes(grown.sourcing.city), "fallback city should come from the search pool");
});

test("nothing priced → still returns skeleton (full editable shell)", () => {
  __setTestOverrides({});
  __setTestCityForce({});
  const md = priceMap([]);
  const result = forceChainSourcing("T6_MEAT", md, ROYAL_CITIES);
  assert.ok(result, "skeleton chain expected even when no prices anywhere");
  assert.strictEqual(result.chain.inputs.length, 1);
  assert.strictEqual(result.chain.inputs[0].matId, "T6_FARM_SHEEP_GROWN");
  assert.strictEqual(result.perUnit, 0);
});

test("item without CHAIN_RECIPES → returns null", () => {
  __setTestOverrides({});
  __setTestCityForce({});
  // T4_MILK has no chain recipe — nothing to build, so null is correct.
  // Caller is the consumables row-builder which only invokes this for
  // CHAIN_RECIPES items, but defensive null keeps behavior predictable.
  const md = priceMap([
    { id: "T4_MILK", city: "Lymhurst", buy: 100 },
  ]);
  const result = forceChainSourcing("T4_MILK", md, ROYAL_CITIES);
  assert.strictEqual(result, null);
});

test("recursive chain (T4_BREAD) builds skeleton when wheat missing", () => {
  __setTestOverrides({});
  __setTestCityForce({});
  // No price anywhere for bread, flour, or wheat. Chain should still
  // resolve through to the wheat leaf so the user can edit each stop.
  const md = priceMap([]);
  const result = forceChainSourcing("T4_BREAD", md, ROYAL_CITIES);
  assert.ok(result);
  assert.strictEqual(result.chain.station, "cook");
  // Walk the chain — wheat leaf must be present at depth 2 with city set.
  const flat = JSON.stringify(result.chain);
  assert.ok(flat.includes("T3_FLOUR"));
  assert.ok(flat.includes("T3_WHEAT"));
});

// ── Coverage: every consumables row that has a chain recipe ───────────────
console.log("\n=== Coverage: each chain-recipe consumable forces chain ===");

const chainConsumables = [
  // Raw meats — the original bug surface. Each meat tier butchers the
  // matching grown animal (no breed expansion in the consumables row).
  { id: "T3_MEAT", grownId: "T3_FARM_CHICKEN_GROWN" },
  { id: "T4_MEAT", grownId: "T4_FARM_GOAT_GROWN" },
  { id: "T5_MEAT", grownId: "T5_FARM_GOOSE_GROWN" },
  { id: "T6_MEAT", grownId: "T6_FARM_SHEEP_GROWN" },
  { id: "T7_MEAT", grownId: "T7_FARM_PIG_GROWN" },
  { id: "T8_MEAT", grownId: "T8_FARM_COW_GROWN" },
];

chainConsumables.forEach(({ id, grownId }) => {
  test(`${id} chain forced even when raw market is the cheapest path`, () => {
    __setTestOverrides({});
    __setTestCityForce({});
    const md = priceMap([
      { id,        city: "Fort Sterling", buy: 1 },          // dirt-cheap raw
      { id: grownId, city: "Fort Sterling", buy: 50_000 },   // expensive grown
    ]);
    const result = forceChainSourcing(id, md, ROYAL_CITIES);
    assert.ok(result, `${id}: expected chain object, got null`);
    assert.strictEqual(result.source, "chain", `${id}: expected source=chain`);
    assert.strictEqual(result.chain.station, "butcher");
    assert.strictEqual(result.chain.inputs[0].matId, grownId);
  });
});

test("T4_BREAD chain still resolves through flour & wheat", () => {
  __setTestOverrides({});
  __setTestCityForce({});
  const md = priceMap([
    { id: "T4_BREAD", city: "Lymhurst", buy: 1 },   // cheap raw flip
    { id: "T3_FLOUR", city: "Lymhurst", buy: 20 },
    { id: "T3_WHEAT", city: "Lymhurst", buy: 5 },
  ]);
  const result = forceChainSourcing("T4_BREAD", md, ROYAL_CITIES);
  assert.ok(result);
  assert.strictEqual(result.source, "chain");
  assert.strictEqual(result.chain.station, "cook");
});

test("T6_BUTTER chain forced through milk", () => {
  __setTestOverrides({});
  __setTestCityForce({});
  const md = priceMap([
    { id: "T6_BUTTER", city: "Lymhurst", buy: 10 },  // cheap raw butter
    { id: "T6_MILK",   city: "Lymhurst", buy: 1_000 },
  ]);
  const result = forceChainSourcing("T6_BUTTER", md, ROYAL_CITIES);
  assert.ok(result);
  assert.strictEqual(result.source, "chain");
  // Butter is churned at the Mill, like flour — not at the Cook station.
  assert.strictEqual(result.chain.station, "mill");
});

// Alcohol is brewed at the ALCHEMIST (buildings.xml lists it under the
// alchemist craftbuilding, not the mill), and the schnapps row must show the
// crop chain even when raw schnapps is listed for a pittance.
[
  { id: "T6_ALCOHOL", crop: "T6_POTATO" },
  { id: "T7_ALCOHOL", crop: "T7_CORN" },
  { id: "T8_ALCOHOL", crop: "T8_PUMPKIN" },
].forEach(({ id, crop }) => {
  test(`${id} chain forced through ${crop}`, () => {
    __setTestOverrides({});
    __setTestCityForce({});
    const md = priceMap([
      { id,      city: "Lymhurst", buy: 10 },     // cheap raw schnapps
      { id: crop, city: "Lymhurst", buy: 1_000 }, // expensive crop
    ]);
    const result = forceChainSourcing(id, md, ROYAL_CITIES);
    assert.ok(result);
    assert.strictEqual(result.source, "chain");
    assert.strictEqual(result.chain.station, "alchemist");
    assert.strictEqual(result.perUnit, 1_000);
  });
});

// ── Summary ──
console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
