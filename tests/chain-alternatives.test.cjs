/**
 * Test: getChainAlternatives — both sourcing legs, not just the winner.
 *
 * getChainSourcing collapses "buy it" vs "make it yourself" to whichever is
 * cheaper and throws the loser away. The Consumables table now prices its
 * ingredients at MARKET and shows the chain as an alternative underneath, so it
 * needs both legs back. getChainAlternatives returns them; getChainSourcing is
 * a thin pick-the-cheaper wrapper over it and must not change behavior.
 *
 * Black-box: only the two public functions are called. Shape under test:
 *   { market: { perUnit, city }, chain: { perUnit, chain } | null }
 *
 * Run: node tests/chain-alternatives.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

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

const renderMountsSrc = loadFile("js/render-mounts.js")
  + loadFile("js/render-mounts-breeding-row.js")
  + loadFile("js/render-mounts-craft-row.js");
const helperBlock = renderMountsSrc.slice(0, renderMountsSrc.indexOf("function renderMountsTable"));

const mod = new Module("chain-alternatives-test");
mod._compile(
  sandbox
    + loadFile("js/data-mounts.js")
    + helperBlock
    + loadFile("js/data-farming.js")
    + loadFile("js/chain-recipes.js")
    + loadFile("js/pasture-econ.js")
    + loadFile("js/chain-pricing.js")
    + "\nmodule.exports = { CHAIN_RECIPES, getChainSourcing, getChainAlternatives, __setTestOverrides, __setTestCityForce };",
  "chain-pricing.js"
);
const {
  CHAIN_RECIPES,
  getChainSourcing,
  getChainAlternatives,
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
}

// ── Parameterized cases ─────────────────────────────────────────────────────
// Each case names the market data, the ingredient, and what each leg must be.
// `chainWins` states which leg getChainSourcing is expected to return, so the
// delegation is checked against the very same fixture as the split.
const CASES = [
  {
    name: "both legs priced, chain cheaper (T3_MEAT from a cheap grown chicken)",
    matId: "T3_MEAT",
    data: [
      { id: "T3_MEAT", city: "Lymhurst", buy: 1000 },
      { id: "T3_FARM_CHICKEN_GROWN", city: "Bridgewatch", buy: 100 },
    ],
    market: { perUnit: 1000, city: "Lymhurst" },
    chainExists: true,
    chainCheaper: true,
  },
  {
    name: "both legs priced, market cheaper (grown animal costs more than meat)",
    matId: "T3_MEAT",
    data: [
      { id: "T3_MEAT", city: "Martlock", buy: 5 },
      { id: "T3_FARM_CHICKEN_GROWN", city: "Bridgewatch", buy: 9000 },
    ],
    market: { perUnit: 5, city: "Martlock" },
    chainExists: true,
    chainCheaper: false,
  },
  {
    name: "chain only — the ingredient is not listed anywhere",
    matId: "T3_MEAT",
    data: [{ id: "T3_FARM_CHICKEN_GROWN", city: "Thetford", buy: 180 }],
    market: { perUnit: 0, city: null },
    chainExists: true,
    chainCheaper: true,
  },
  {
    name: "market only — no CHAIN_RECIPES entry for a raw crop",
    matId: "T3_WHEAT",
    data: [{ id: "T3_WHEAT", city: "Fort Sterling", buy: 42 }],
    market: { perUnit: 42, city: "Fort Sterling" },
    chainExists: false,
    chainCheaper: false,
  },
  {
    name: "unbuildable chain — the grown animal has no price either",
    matId: "T3_MEAT",
    data: [{ id: "T3_MEAT", city: "Lymhurst", buy: 700 }],
    market: { perUnit: 700, city: "Lymhurst" },
    chainExists: false,
    chainCheaper: false,
  },
  {
    name: "nothing priced at all — both legs empty",
    matId: "T3_MEAT",
    data: [],
    market: { perUnit: 0, city: null },
    chainExists: false,
    chainCheaper: false,
  },
];

console.log("\n=== getChainAlternatives returns both legs ===");
CASES.forEach((c) => {
  test(c.name, () => {
    reset();
    const md = priceMap(c.data);
    const alt = getChainAlternatives(c.matId, md, ROYAL_CITIES);
    assert.ok(alt && alt.market, "result must always carry a market leg");
    assert.strictEqual(alt.market.perUnit, c.market.perUnit, "market perUnit");
    assert.strictEqual(alt.market.city, c.market.city, "market city");
    if (c.chainExists) {
      assert.ok(alt.chain, "expected a chain leg");
      assert.ok(alt.chain.perUnit > 0, "chain leg must be priced");
      assert.ok(alt.chain.chain && alt.chain.chain.produces === c.matId,
        "chain leg must carry the ChainNode it priced");
    } else {
      assert.strictEqual(alt.chain, null, "expected no chain leg");
    }
  });
});

console.log("\n=== getChainSourcing still picks the cheaper leg ===");
CASES.forEach((c) => {
  test(`delegation: ${c.name}`, () => {
    reset();
    const md = priceMap(c.data);
    const alt = getChainAlternatives(c.matId, md, ROYAL_CITIES);
    const won = getChainSourcing(c.matId, md, ROYAL_CITIES);
    if (c.chainExists && c.chainCheaper) {
      assert.strictEqual(won.source, "chain");
      assert.strictEqual(won.perUnit, alt.chain.perUnit);
    } else {
      assert.strictEqual(won.source, "market");
      assert.strictEqual(won.perUnit, alt.market.perUnit);
      assert.strictEqual(won.city, alt.market.city);
    }
  });
});

console.log("\n=== forcedChainOnly is never offered as an ingredient alternative ===");

test("a forcedChainOnly recipe reports chain: null", () => {
  reset();
  const forced = Object.keys(CHAIN_RECIPES).filter((k) => CHAIN_RECIPES[k].forcedChainOnly);
  assert.ok(forced.length > 0, "fixture assumes at least one forcedChainOnly recipe exists");
  const matId = forced[0];
  const md = priceMap([{ id: matId, city: "Thetford", buy: 250 }]);
  const alt = getChainAlternatives(matId, md, ROYAL_CITIES);
  assert.strictEqual(alt.chain, null, `${matId} must not offer a chain alternative`);
  assert.strictEqual(alt.market.perUnit, 250);
  assert.strictEqual(getChainSourcing(matId, md, ROYAL_CITIES).source, "market");
});

console.log("\n=== Overrides and city forces reach both legs ===");

test("a price override sets the market leg", () => {
  reset();
  __setTestOverrides({ "T3_MEAT:Martlock": 33 });
  const md = priceMap([{ id: "T3_FARM_CHICKEN_GROWN", city: "Thetford", buy: 180 }]);
  const alt = getChainAlternatives("T3_MEAT", md, ROYAL_CITIES);
  assert.strictEqual(alt.market.perUnit, 33);
  assert.strictEqual(alt.market.city, "Martlock");
  assert.ok(alt.chain, "the chain leg stays available alongside the override");
});

test("a buy-city force pins the market leg without touching the chain leg", () => {
  reset();
  __setTestCityForce({ T3_MEAT: { buy: "Fort Sterling" } });
  const md = priceMap([
    { id: "T3_MEAT", city: "Lymhurst", buy: 100 },
    { id: "T3_MEAT", city: "Fort Sterling", buy: 900 },
    { id: "T3_FARM_CHICKEN_GROWN", city: "Thetford", buy: 180 },
  ]);
  const alt = getChainAlternatives("T3_MEAT", md, ROYAL_CITIES);
  assert.strictEqual(alt.market.city, "Fort Sterling");
  assert.strictEqual(alt.market.perUnit, 900);
  assert.ok(alt.chain && alt.chain.perUnit > 0);
});

console.log("\n=== The chain leg keeps its full breakdown ===");

test("pasture leg carries yieldMult, pastureCity and the priced leaves", () => {
  reset();
  const md = priceMap([
    { id: "T8_MILK", city: "Lymhurst", buy: 400 },
    { id: "T8_PUMPKIN", city: "Lymhurst", buy: 373 },
    { id: "T8_FARM_COW_GROWN", city: "Lymhurst", buy: 12000 },
  ]);
  const alt = getChainAlternatives("T8_MILK", md, ROYAL_CITIES);
  assert.ok(alt.chain, "milk must offer a pasture chain");
  const node = alt.chain.chain;
  assert.strictEqual(node.station, "pasture");
  assert.ok(node.yieldMult > 0, "pasture node must carry its batch multiplier");
  assert.ok(Array.isArray(node.inputs) && node.inputs.length > 0);
  assert.ok(JSON.stringify(node).includes("Lymhurst"), "leaves keep their buy city");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
