/**
 * Integration test: computeRefineRouteForCity (refining-route.js) end-to-end with
 * a TRANSMUTE substitution on the raw — buy a cheaper lower node of the same
 * resource family and transmute it up instead of buying the raw outright.
 *
 * Contract proved here:
 *  - the substitute fires only when it beats the raw's effective market buy;
 *  - it replaces ALL rawRatio units (unlike the heart, which replaces one);
 *  - a transmuted raw stays RRR-eligible (it is a raw), so the whole per-unit
 *    cost — start price + transmute silver + station fee — rides the (1-rrr) term;
 *  - it composes with the heart: the heart then competes against the CHEAPER
 *    transmuted unit cost, so it can win before and lose after the substitution;
 *  - a pristine (.4) raw, which has no faction-heart recipe, can still be reached
 *    by transmuting a .3 up — the case the heart cannot cover;
 *  - buy-leg display/override fields point at the node actually bought.
 *
 * Run: node tests/refining-transport-row-transmute.test.cjs
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
const CITY_REFINE_SPEC = { "Fort Sterling": "wood", Lymhurst: "fiber", Bridgewatch: "rock", Thetford: "ore", Martlock: "hide" };
const RESOURCE_DEFS = [
  { type: "fiber", raw: "FIBER", refined: "CLOTH", tiers: [[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];
let testOverrides = {};
function isBlackRedZoneEnabled() { return false; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function isFocusEnabled() { return false; }
function getOverridePrice(id, city) { return testOverrides[id + ":" + city] ?? null; }
function testOverridesSet(m) { testOverrides = m || {}; }
function getCityForce() { return null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city, b, id) { const ov = id?getOverridePrice(id,city):null; if (ov!==null) return ov; return (itemData && itemData[city] && itemData[city].buy_price) || 0; }
function getSellPrice(itemData, city, b, id) { return (itemData && itemData[city] && itemData[city].sell_price) || 0; }
function isInvalidCrossRoute() { return false; }
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getRefineRRR(city, t, f) { let b = BASE_CITY_BONUS; if (CITY_REFINE_SPEC[city]===t) b+=REFINE_SPEC_BONUS; if (f) b+=FOCUS_BONUS; return calcRRR(b); }
function getFocusCost(id, tier) { return 100; }
function getStationFeeInput() { return 0; }
function calcStationFeeSilver() { return 0; }
function refineStationFeeSilver() { return 0; }
function resourceShortName(id) { return id; }
function getTierFromId(id) { const m = id.match(/T(\\d+)/); return m ? parseInt(m[1],10) : 0; }
function calculateTransportMargin(buyCost, sellPrice, rrr=0, sec=0, station=0, travel=0, nonRet=0, exempt=0) {
  if (!buyCost || !sellPrice) return { profit: 0, margin: 0 };
  const eff = ((buyCost + sec - exempt) * (1 - rrr) + nonRet) * (1 + SETUP_FEE)
    + exempt * (1 - rrr) + station + travel;
  const rev = sellPrice * (1 - PREMIUM_TAX);
  return { profit: rev - eff, margin: (rev - eff) / eff * 100 };
}
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }
const mod = new Module("transport-row-transmute-test");
mod._compile(
  sandbox +
    loadFile("js/data-transmute.js") +
    loadFile("js/refining-chain-recipes.js") +
    loadFile("js/refining-chain-pricing.js") +
    loadFile("js/refining-transmute-substitute.js") +
    loadFile("js/refining-route.js") +
    "\nmodule.exports = { computeRefineRouteForCity, testOverridesSet };",
  "refining-route.js",
);
const { computeRefineRouteForCity, testOverridesSet } = mod.exports;

const LYM = "Lymhurst";                 // fiber spec → rrr = 0.58/1.58
const RRR = 0.58 / 1.58;
const VINEHEART = "T1_FACTION_SWAMP_TOKEN_1";

// Fees straight out of data-transmute.js.
const ENCH_T8_TO_4 = 784440;            // 8.3 → 8.4
const ENCH_T8_TO_1 = 14400;             // 8.0 → 8.1
const TIER_T8_E0 = 5000;                // 7.0 → 8.0

const buy = (p) => ({ [LYM]: { buy_price: p, volume_24h: 9999 } });
const sell = (p) => ({ [LYM]: { sell_price: p, volume_24h: 9999 } });

let passed = 0, failed = 0;
function test(name, fn) {
  try { testReset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
function testReset() { testOverridesSet({}); }

// ── Plain T8 fiber refine: 5x T8_FIBER + 1x T7_CLOTH → T8_CLOTH ──────────────
const plainRoute = {
  rawId: "T8_FIBER", refinedId: "T8_CLOTH",
  secondaryMatId: "T7_CLOTH", secondaryMatCount: 1, rawRatio: 5, resourceType: "fiber",
};

console.log("computeRefineRouteForCity × transmute (raw substitution)\n");

test("no substitution when the raw is the cheapest way to get a raw", () => {
  const md = {
    T8_FIBER: buy(5000),
    T7_FIBER: buy(1000),            // 1,000 + 5,000 fee = 6,000 > 5,000
    T7_CLOTH: buy(500),
    T8_CLOTH: sell(99999),
  };
  const r = computeRefineRouteForCity(LYM, plainRoute, md, "buy");
  assert.strictEqual(r.rawTransmute, null);
  assert.strictEqual(r.rawUnitCost, 5000);
  assert.strictEqual(r.buyRawId, "T8_FIBER");
  assert.strictEqual(r.totalRawCost, 5 * 5000 + 500);
});

test("substitutes when T7 + tier-up fee beats the T8 raw, replacing ALL raw units", () => {
  const md = {
    T8_FIBER: buy(9000),
    T7_FIBER: buy(1500),            // 1,500 + 5,000 = 6,500 < 9,000
    T7_CLOTH: buy(500),
    T8_CLOTH: sell(99999),
  };
  const r = computeRefineRouteForCity(LYM, plainRoute, md, "buy");
  assert.ok(r.rawTransmute, "transmute route chosen");
  assert.strictEqual(r.rawTransmute.startId, "T7_FIBER");
  assert.strictEqual(r.rawUnitCost, 1500 + TIER_T8_E0);
  // Heart absent from this market, so all 5 units come from the transmute route.
  assert.strictEqual(r.totalRawCost, 5 * (1500 + TIER_T8_E0) + 500);
});

test("buy-leg display + override fields point at the node actually bought", () => {
  const md = { T8_FIBER: buy(9000), T7_FIBER: buy(1500), T7_CLOTH: buy(500), T8_CLOTH: sell(99999) };
  const r = computeRefineRouteForCity(LYM, plainRoute, md, "buy");
  assert.strictEqual(r.buyRawId, "T7_FIBER");
  assert.strictEqual(r.bestRawPrice, 1500, "shows the start's market price, not the all-in unit cost");
  assert.strictEqual(r.bestRawCity, LYM);
});

test("the transmuted raw is RRR-eligible: profit matches the per-term formula", () => {
  const md = { T8_FIBER: buy(9000), T7_FIBER: buy(1500), T7_CLOTH: buy(500), T8_CLOTH: sell(99999) };
  const r = computeRefineRouteForCity(LYM, plainRoute, md, "buy");
  // Every raw unit costs 6,500 all-in and rides the (1-rrr) term, like the
  // secondary — but the 5,000 of transmute silver in each unit was never bought
  // at market, so it is held out of the setup fee.
  const exempt = 5 * TIER_T8_E0;
  const eff = ((5 * 6500 + 500 - exempt) * (1 - RRR)) * 1.025 + exempt * (1 - RRR);
  const expProfit = 99999 * (1 - 0.065) - eff;
  assert.ok(Math.abs(r.marginInfo.profit - expProfit) < 0.5,
    `profit ${r.marginInfo.profit} vs expected ${expProfit.toFixed(2)}`);
  assert.ok(Math.abs(r.setupExemptCost - exempt) < 1e-6,
    `setupExemptCost ${r.setupExemptCost} vs ${exempt}`);
});

test("a market-bought raw has nothing setup-exempt", () => {
  const md = { T8_FIBER: buy(6000), T7_FIBER: buy(5000), T7_CLOTH: buy(500), T8_CLOTH: sell(99999) };
  const r = computeRefineRouteForCity(LYM, plainRoute, md, "buy");
  assert.strictEqual(r.rawTransmute, null, "precondition: no substitution here");
  assert.strictEqual(r.setupExemptCost, 0);
});

test("in market mode a thin transmute start cannot trigger a substitution", () => {
  const thin = { [LYM]: { buy_price: 1500, volume_24h: 3 } };
  const md = { T8_FIBER: buy(9000), T7_FIBER: thin, T7_CLOTH: buy(500), T8_CLOTH: sell(99999) };
  // Instant mode gates on 0, so the thin start is still usable there.
  assert.ok(computeRefineRouteForCity(LYM, plainRoute, md, "instant").rawTransmute,
    "ungated order type keeps the route");
  assert.strictEqual(computeRefineRouteForCity(LYM, plainRoute, md, "market").rawTransmute, null,
    "a start too thin for the row's own raw buy must not become a transmute start");
});

test("a hand-edited price lets a thin start back in", () => {
  const thin = { [LYM]: { buy_price: 1500, volume_24h: 3 } };
  const md = { T8_FIBER: buy(9000), T7_FIBER: thin, T7_CLOTH: buy(500), T8_CLOTH: sell(99999) };
  testOverridesSet({ [`T7_FIBER:${LYM}`]: 1500 });
  assert.ok(computeRefineRouteForCity(LYM, plainRoute, md, "market").rawTransmute);
});

test("substitution raises profit vs the same market without the cheap T7", () => {
  const base = { T8_FIBER: buy(9000), T7_CLOTH: buy(500), T8_CLOTH: sell(99999) };
  const withT7 = computeRefineRouteForCity(LYM, plainRoute, { ...base, T7_FIBER: buy(1500) }, "buy");
  const noT7 = computeRefineRouteForCity(LYM, plainRoute, base, "buy");
  assert.ok(withT7.marginInfo.profit > noT7.marginInfo.profit,
    `transmute profit ${withT7.marginInfo.profit} should beat ${noT7.marginInfo.profit}`);
});

test("an unlisted raw still yields a route through the transmute path", () => {
  const md = { T7_FIBER: buy(1500), T7_CLOTH: buy(500), T8_CLOTH: sell(99999) };
  const r = computeRefineRouteForCity(LYM, plainRoute, md, "buy");
  assert.ok(r, "route computed with no T8_FIBER listing at all");
  assert.strictEqual(r.rawTransmute.startId, "T7_FIBER");
  assert.strictEqual(r.rawUnitCost, 6500);
});

test("still null when neither the raw nor any transmute start is priced", () => {
  const md = { T7_CLOTH: buy(500), T8_CLOTH: sell(99999) };
  assert.strictEqual(computeRefineRouteForCity(LYM, plainRoute, md, "buy"), null);
});

// ── Composition with the faction heart ───────────────────────────────────────
console.log("\n× faction heart composition");

test("heart competes against the TRANSMUTED unit cost, not the raw's sticker price", () => {
  // raw 9,000 (heart threshold 5,696) vs transmuted 6,500 (threshold 4,114).
  // A 5,000 heart would win against the raw but must LOSE against the transmute.
  const md = {
    T8_FIBER: buy(9000), T7_FIBER: buy(1500), T7_CLOTH: buy(500), T8_CLOTH: sell(99999),
    [VINEHEART]: buy(5000),
  };
  const r = computeRefineRouteForCity(LYM, plainRoute, md, "buy");
  assert.ok(r.rawTransmute, "transmute still chosen");
  assert.strictEqual(r.secHeart, null, "heart loses to the cheaper transmuted raw unit");
  assert.strictEqual(r.heartCost, 0);
});

test("a cheap enough heart still replaces one transmuted unit", () => {
  const md = {
    T8_FIBER: buy(9000), T7_FIBER: buy(1500), T7_CLOTH: buy(500), T8_CLOTH: sell(99999),
    [VINEHEART]: buy(1000),          // 1,000 < 6,500*(1-rrr) = 4,114
  };
  const r = computeRefineRouteForCity(LYM, plainRoute, md, "buy");
  assert.ok(r.rawTransmute && r.secHeart, "both substitutions apply");
  assert.strictEqual(r.heartCost, 1000);
  // 4 transmuted units + secondary + the RRR-exempt heart.
  assert.strictEqual(r.totalRawCost, 4 * 6500 + 500 + 1000);
});

// ── Pristine (.4): no heart recipe exists, but a transmute reaches it ────────
console.log("\n× pristine (.4) raws");

const pristineRoute = {
  rawId: "T8_FIBER_LEVEL4@4", refinedId: "T8_CLOTH_LEVEL4@4",
  secondaryMatId: "T7_CLOTH_LEVEL4@4", secondaryMatCount: 1, rawRatio: 5, resourceType: "fiber",
};

test(".4 raw: heart is barred, but a cheap .3 + enchant-up fee substitutes", () => {
  const md = {
    "T8_FIBER_LEVEL4@4": buy(1500000),
    "T8_FIBER_LEVEL3@3": buy(300000),       // 300,000 + 784,440 = 1,084,440 < 1,500,000
    "T7_CLOTH_LEVEL4@4": buy(500),
    "T8_CLOTH_LEVEL4@4": sell(9999999),
    [VINEHEART]: buy(1),                     // dirt cheap, must still be ignored at .4
  };
  const r = computeRefineRouteForCity(LYM, pristineRoute, md, "buy");
  assert.strictEqual(r.secHeart, null, "no heart recipe at .4");
  assert.ok(r.rawTransmute, "transmute covers the .4 raw");
  assert.strictEqual(r.rawTransmute.startId, "T8_FIBER_LEVEL3@3");
  assert.strictEqual(r.rawUnitCost, 300000 + ENCH_T8_TO_4);
  assert.strictEqual(r.totalRawCost, 5 * (300000 + ENCH_T8_TO_4) + 500);
});

test(".4 raw: an expensive .3 leaves the market raw in place", () => {
  const md = {
    "T8_FIBER_LEVEL4@4": buy(900000),
    "T8_FIBER_LEVEL3@3": buy(300000),       // 1,084,440 > 900,000
    "T7_CLOTH_LEVEL4@4": buy(500),
    "T8_CLOTH_LEVEL4@4": sell(9999999),
  };
  const r = computeRefineRouteForCity(LYM, pristineRoute, md, "buy");
  assert.strictEqual(r.rawTransmute, null);
  assert.strictEqual(r.rawUnitCost, 900000);
});

test("mixed path: an 8.1 raw reached from a cheap 7.0 via tier-up then enchant-up", () => {
  const enchRoute = {
    rawId: "T8_FIBER_LEVEL1@1", refinedId: "T8_CLOTH_LEVEL1@1",
    secondaryMatId: "T7_CLOTH_LEVEL1@1", secondaryMatCount: 1, rawRatio: 5, resourceType: "fiber",
  };
  const md = {
    "T8_FIBER_LEVEL1@1": buy(50000),
    T7_FIBER: buy(1000),                     // 1,000 + 5,000 + 14,400 = 20,400
    "T7_CLOTH_LEVEL1@1": buy(500),
    "T8_CLOTH_LEVEL1@1": sell(999999),
  };
  const r = computeRefineRouteForCity(LYM, enchRoute, md, "buy");
  assert.strictEqual(r.rawTransmute.startId, "T7_FIBER");
  assert.strictEqual(r.rawUnitCost, 1000 + TIER_T8_E0 + ENCH_T8_TO_1);
  assert.deepStrictEqual(r.rawTransmute.steps.map((s) => s.toId), ["T8_FIBER", "T8_FIBER_LEVEL1@1"]);
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
