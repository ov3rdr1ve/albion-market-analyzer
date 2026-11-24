/**
 * Test: the Refining/Transport "Profit Gathered / 10k Focus" column.
 *
 * The column answers "what do I make refining a full focus bar when I GATHER the
 * raws myself instead of buying them?". Model:
 *   - every RAW resource is free (cost 0) — at the row's own refine AND inside a
 *     secondary refining chain (those chains eat raws too);
 *   - a market-bought refined SECONDARY is still paid for (a bar is not gatherable);
 *   - station fee, setup fee and sales tax all still apply; the setup fee rides on
 *     whatever material cost remains (RRR-discounted, same as the buy path);
 *   - a faction heart is bought, so it never beats a free raw — the gathered path
 *     ignores it (no heart cost, all raws kept);
 *   - the raw's market price is irrelevant: a row whose raw has no listing still
 *     has a valid gathered profit.
 *
 * Black-box: load the REAL refining-chain-pricing.js + refining-route.js, drive
 * computeRefineRouteForCity / computeRefineGatheredProfit and check the profit
 * against independently computed expectations.
 *
 * Run: node tests/refining-gathered-profit.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
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
let __TEST_STATION_FEE = 0;
function isBlackRedZoneEnabled() { return false; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function isFocusEnabled() { return globalThis.__TEST_FOCUS__; }
function getOverridePrice() { return null; }
function getCityForce() { return null; }
function isInvalidCrossRoute() { return false; }
function getIQRBounds() { return { upper: Infinity }; }
function legBrecilienCost() { return 0; }
function getBuyPrice(itemData, city, bounds, itemId) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function getSellPrice(itemData, city, bounds, itemId) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || 0;
}
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getRefineRRR(city, type, useFocus) {
  let bonus = BASE_CITY_BONUS;
  if (CITY_REFINE_SPEC[city] === type) bonus += REFINE_SPEC_BONUS;
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}
function getFocusCost(id, t) { return Math.round(30 * Math.pow(2, t-4)); }
function calcStationFeeSilver() { return __TEST_STATION_FEE; }
function refineStationFeeSilver() { return __TEST_STATION_FEE; }
function __setStationFee(v) { __TEST_STATION_FEE = v; }
function getTierFromId(id) { const m = id.match(/^T(\\d+)/); return m ? parseInt(m[1], 10) : 4; }
function matsNeededFor10kFocus() { return 0; }
function calculateTransportMargin(buyCost, sellPrice, rrr = 0, secondaryMatCost = 0, stationFee = 0, travelCost = 0, nonReturnableMatCost = 0) {
  if (!buyCost || !sellPrice) return { profit: 0, margin: 0 };
  const effectiveCost = ((buyCost + secondaryMatCost) * (1 - rrr) + nonReturnableMatCost) * (1 + SETUP_FEE) + stationFee + travelCost;
  const totalRevenue = sellPrice * (1 - PREMIUM_TAX);
  const profit = totalRevenue - effectiveCost;
  return { profit, margin: (profit / effectiveCost) * 100 };
}
function calculateProfitPer10kFocus(profitPerCraft, focusCostPerCraft) {
  if (!focusCostPerCraft || focusCostPerCraft <= 0) return 0;
  return profitPerCraft * Math.floor(10000 / focusCostPerCraft);
}
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }

const mod = new Module("refining-gathered-profit-test");
mod._compile(
  sandbox +
    loadFile("js/refining-chain-recipes.js") +
    loadFile("js/refining-chain-pricing.js") +
    loadFile("js/refining-route.js") +
    "\nmodule.exports = { computeRefineRouteForCity, computeRefineGatheredProfit, chainSilverCostGathered, __setStationFee };",
  "refining-gathered-profit.js",
);
const {
  computeRefineRouteForCity,
  computeRefineGatheredProfit,
  chainSilverCostGathered,
  __setStationFee,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg} (got ${a}, want ${b})`);

const FS = "Fort Sterling";
const SETUP_FEE = 0.025;
const PREMIUM_TAX = 0.065;
const rrrOf = (bonus) => bonus / (1 + bonus);

function set(md, id, buy, sell) {
  md[id] = { [FS]: { buy_price: buy, sell_price: sell, volume_24h: 9999 } };
}

// ── Fixture 1: single-tier row, secondary bought at market ───────────────────
const MARKET_ROUTE = {
  mat: "Planks [T4]", rawId: "T4_WOOD", refinedId: "T4_PLANKS",
  rawRatio: 2, resourceType: "wood", secondaryMatId: "T3_PLANKS", secondaryMatCount: 1,
};
function marketFixture() {
  const md = {};
  set(md, "T4_PLANKS", 999999, 4000);
  set(md, "T4_WOOD", 1000, 1100);
  set(md, "T3_PLANKS", 200, 220);   // cheap market secondary => no chain
  return md;
}

console.log("\n=== Market secondary: raws free, secondary still paid ===");

test("gathered profit charges only the secondary + fees", () => {
  globalThis.__TEST_FOCUS__ = false;
  __setStationFee(0);
  const md = marketFixture();
  const r = computeRefineRouteForCity(FS, MARKET_ROUTE, md, "instant");
  assert.ok(r && !r.secondaryChain, "route priced, secondary from market");
  const rrr = rrrOf(0.18 + 0.40);
  const expected = 4000 * (1 - PREMIUM_TAX) - 200 * 1 * (1 - rrr) * (1 + SETUP_FEE);
  near(computeRefineGatheredProfit(r, MARKET_ROUTE), expected, "gathered profit");
});

test("gathered profit beats the bought-raw profit by the raw's discounted cost", () => {
  globalThis.__TEST_FOCUS__ = false;
  __setStationFee(0);
  const md = marketFixture();
  const r = computeRefineRouteForCity(FS, MARKET_ROUTE, md, "instant");
  const rrr = rrrOf(0.18 + 0.40);
  const rawSaving = 1000 * 2 * (1 - rrr) * (1 + SETUP_FEE);
  near(
    computeRefineGatheredProfit(r, MARKET_ROUTE) - r.marginInfo.profit,
    rawSaving,
    "gathered − bought = the raws' effective cost",
  );
});

test("station fee is still charged on the gathered path", () => {
  globalThis.__TEST_FOCUS__ = false;
  __setStationFee(0);
  const md = marketFixture();
  const r0 = computeRefineRouteForCity(FS, MARKET_ROUTE, md, "instant");
  const free = computeRefineGatheredProfit(r0, MARKET_ROUTE);
  __setStationFee(500);
  const r1 = computeRefineRouteForCity(FS, MARKET_ROUTE, md, "instant");
  near(computeRefineGatheredProfit(r1, MARKET_ROUTE), free - 500, "fee subtracted once");
  __setStationFee(0);
});

test("gathered profit tracks the focus checkbox RRR (like the profit column)", () => {
  __setStationFee(0);
  const md = marketFixture();
  globalThis.__TEST_FOCUS__ = false;
  const off = computeRefineGatheredProfit(computeRefineRouteForCity(FS, MARKET_ROUTE, md, "instant"), MARKET_ROUTE);
  globalThis.__TEST_FOCUS__ = true;
  const on = computeRefineGatheredProfit(computeRefineRouteForCity(FS, MARKET_ROUTE, md, "instant"), MARKET_ROUTE);
  const rrrOff = rrrOf(0.18 + 0.40), rrrOn = rrrOf(0.18 + 0.40 + 0.59);
  near(on - off, 200 * (rrrOn - rrrOff) * (1 + SETUP_FEE), "focus returns part of the secondary");
});

// ── Fixture 2: chain secondary — raws inside the chain are gathered too ──────
const CHAIN_ROUTE = {
  mat: "Planks [T8]", rawId: "T8_WOOD", refinedId: "T8_PLANKS",
  rawRatio: 5, resourceType: "wood", secondaryMatId: "T7_PLANKS", secondaryMatCount: 1,
};
function chainFixture() {
  const md = {};
  set(md, "T8_PLANKS", 999999, 30000);
  set(md, "T7_PLANKS", 999999, 999999); set(md, "T6_PLANKS", 999999, 999999);
  set(md, "T5_PLANKS", 999999, 999999); set(md, "T4_PLANKS", 999999, 999999);
  set(md, "T3_PLANKS", 50, 60);
  set(md, "T8_WOOD", 1500, 1600); set(md, "T7_WOOD", 800, 900); set(md, "T6_WOOD", 400, 500);
  set(md, "T5_WOOD", 150, 200); set(md, "T4_WOOD", 80, 120);
  return md;
}

console.log("\n=== Chain secondary: chain raws are gathered too ===");

test("chain gathered cost drops the raws but keeps the market leaf + fees", () => {
  globalThis.__TEST_FOCUS__ = false;
  __setStationFee(0);
  const r = computeRefineRouteForCity(FS, CHAIN_ROUTE, chainFixture(), "instant");
  assert.ok(r && r.secondaryChain, "secondary is chain-sourced");
  const rrr = rrrOf(0.18 + 0.40);
  // T4 plank = 2x T4 wood (free) + 1x T3 plank @50 market; each tier above adds
  // only its (free) raw, so the T3 leaf is the sole silver, RRR-discounted once
  // per refine step up the chain.
  let cost = 50 * (1 - rrr) * (1 + SETUP_FEE);          // T4_PLANKS
  for (let t = 5; t <= 7; t++) cost = cost * (1 - rrr) * (1 + SETUP_FEE); // T5..T7
  near(chainSilverCostGathered(r.secondaryChain), cost, "gathered chain cost per T7 plank");
});

test("chain gathered cost is strictly below the bought-raw chain cost", () => {
  globalThis.__TEST_FOCUS__ = false;
  __setStationFee(0);
  const r = computeRefineRouteForCity(FS, CHAIN_ROUTE, chainFixture(), "instant");
  assert.ok(
    chainSilverCostGathered(r.secondaryChain) < r.secondaryChain.costPerOutput,
    "free raws must make the chain cheaper",
  );
});

test("row gathered profit uses the gathered chain cost", () => {
  globalThis.__TEST_FOCUS__ = false;
  __setStationFee(0);
  const r = computeRefineRouteForCity(FS, CHAIN_ROUTE, chainFixture(), "instant");
  const rrr = rrrOf(0.18 + 0.40);
  const secUnit = chainSilverCostGathered(r.secondaryChain);
  const expected = 30000 * (1 - PREMIUM_TAX) - secUnit * 1 * (1 - rrr) * (1 + SETUP_FEE);
  near(computeRefineGatheredProfit(r, CHAIN_ROUTE), expected, "gathered profit (chain row)");
});

// ── Fixture 3: faction heart — bought, so it loses to a free raw ─────────────
const HEART_ROUTE = {
  mat: "Planks [T4]", rawId: "T4_WOOD", refinedId: "T4_PLANKS",
  rawRatio: 2, resourceType: "wood", secondaryMatId: "T3_PLANKS", secondaryMatCount: 1,
};
function heartFixture() {
  const md = {};
  set(md, "T4_PLANKS", 999999, 4000);
  set(md, "T4_WOOD", 1000, 1100);
  set(md, "T3_PLANKS", 200, 220);
  set(md, "T1_FACTION_FOREST_TOKEN_1", 100, 110); // cheap heart: wins on the buy path
  return md;
}

console.log("\n=== Faction heart: never charged on the gathered path ===");

test("a heart that wins on the buy path costs nothing when gathering", () => {
  globalThis.__TEST_FOCUS__ = false;
  __setStationFee(0);
  const r = computeRefineRouteForCity(FS, HEART_ROUTE, heartFixture(), "instant");
  assert.ok(r.heartCost > 0, "fixture must use the heart on the buy path");
  const rrr = rrrOf(0.18 + 0.40);
  const expected = 4000 * (1 - PREMIUM_TAX) - 200 * (1 - rrr) * (1 + SETUP_FEE);
  near(computeRefineGatheredProfit(r, HEART_ROUTE), expected, "no heart silver in the gathered profit");
});

// ── Fixture 4: unpriced raw & missing data ───────────────────────────────────
console.log("\n=== Pricing edges ===");

test("gathered profit needs no raw price", () => {
  globalThis.__TEST_FOCUS__ = false;
  __setStationFee(0);
  const rrr = rrrOf(0.18 + 0.40);
  const expected = 4000 * (1 - PREMIUM_TAX) - 200 * (1 - rrr) * (1 + SETUP_FEE);
  // Route shape as the renderer's no-data fallback builds it: raw unpriced.
  const fallbackShape = {
    refineCity: FS, rrr, sellCity: FS, sellPrice: 4000,
    secPrice: 200, secCity: FS, secondaryChain: null,
  };
  near(computeRefineGatheredProfit(fallbackShape, MARKET_ROUTE), expected, "gathered profit without a raw price");
});

test("no sell price => null (nothing to value)", () => {
  const shape = { refineCity: FS, rrr: 0.3, sellCity: FS, sellPrice: 0, secPrice: 200, secCity: FS, secondaryChain: null };
  assert.strictEqual(computeRefineGatheredProfit(shape, MARKET_ROUTE), null, "unpriced sale => null");
});

test("secondary with no price and no chain => null (would look free)", () => {
  const shape = { refineCity: FS, rrr: 0.3, sellCity: FS, sellPrice: 4000, secPrice: 0, secCity: null, secondaryChain: null };
  assert.strictEqual(computeRefineGatheredProfit(shape, MARKET_ROUTE), null, "unpriced secondary => null");
});

test("recipe with no secondary at all prices fine", () => {
  const noSec = { mat: "Blocks [T4]", rawId: "T4_ROCK", refinedId: "T4_STONEBLOCK", rawRatio: 2, resourceType: "rock" };
  __setStationFee(300);
  const shape = { refineCity: "Bridgewatch", rrr: 0.4, sellCity: "Bridgewatch", sellPrice: 1000, secPrice: 0, secCity: null, secondaryChain: null };
  near(computeRefineGatheredProfit(shape, noSec), 1000 * (1 - PREMIUM_TAX) - 300, "revenue minus the station fee");
  __setStationFee(0);
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
