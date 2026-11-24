/**
 * Integration test: computeRefineRouteForCity (render-transport.js) end-to-end
 * with a faction heart replacing ONE raw unit. Proves the wiring: the kept raw
 * count is rawRatio-1, the heart flows in as an RRR-exempt cost, secHeart is
 * surfaced, and a winning heart raises profit vs. the no-heart case.
 *
 * Compiles recipes + pricing + render-transport with leaf stubs (incl. a
 * calculateTransportMargin stub mirroring the real RRR-exempt formula).
 *
 * Run: node tests/refining-transport-row-heart.test.cjs
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
function getCityForce() { return null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city, b, id) { const ov = id?getOverridePrice(id,city):null; if (ov!==null) return ov; return (itemData && itemData[city] && itemData[city].buy_price) || 0; }
function getSellPrice(itemData, city, b, id) { return (itemData && itemData[city] && itemData[city].sell_price) || 0; }
function isInvalidCrossRoute() { return false; }
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getRefineRRR(city, t, f) { let b = BASE_CITY_BONUS; if (CITY_REFINE_SPEC[city]===t) b+=REFINE_SPEC_BONUS; if (f) b+=FOCUS_BONUS; return calcRRR(b); }
function getFocusCost(id, tier) { return 100; }
function calcStationFeeSilver() { return 0; }
function refineStationFeeSilver() { return 0; }
function getTierFromId(id) { const m = id.match(/T(\\d+)/); return m ? parseInt(m[1],10) : 0; }
// Mirrors the real calculateTransportMargin incl. RRR-exempt nonReturnableMatCost.
function calculateTransportMargin(buyCost, sellPrice, rrr=0, sec=0, station=0, travel=0, nonRet=0) {
  if (!buyCost || !sellPrice) return { profit: 0, margin: 0 };
  const eff = ((buyCost + sec) * (1 - rrr) + nonRet) * (1 + SETUP_FEE) + station + travel;
  const rev = sellPrice * (1 - PREMIUM_TAX);
  return { profit: rev - eff, margin: (rev - eff) / eff * 100 };
}
`;

function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }
const mod = new Module("transport-row-heart-test");
mod._compile(
  sandbox + loadFile("js/refining-chain-recipes.js") + loadFile("js/refining-chain-pricing.js") +
    loadFile("js/refining-route.js") + loadFile("js/render-transport.js") + "\nmodule.exports = { computeRefineRouteForCity };",
  "render-transport.js"
);
const { computeRefineRouteForCity } = mod.exports;

const LYM = "Lymhurst";  // fiber spec → rrr = 0.58/1.58 ≈ 0.36709
const VINEHEART = "T1_FACTION_SWAMP_TOKEN_1";
const RRR = 0.58 / 1.58;
const routeItem = { rawId: "T8_FIBER", refinedId: "T8_CLOTH", secondaryMatId: "T7_CLOTH", secondaryMatCount: 1, rawRatio: 5, resourceType: "fiber" };

function md(heartBuy) {
  const m = {
    T8_FIBER: { Lymhurst: { buy_price: 1000, volume_24h: 9999 } },
    T7_CLOTH: { Lymhurst: { buy_price: 500, volume_24h: 9999 } },
    T8_CLOTH: { Lymhurst: { sell_price: 99999, volume_24h: 9999 } },
  };
  if (heartBuy != null) m[VINEHEART] = { Lymhurst: { buy_price: heartBuy, volume_24h: 9999 } };
  return m;
}

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log(`  PASS: ${name}`); passed++; } catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; } }

console.log("computeRefineRouteForCity × heart (raw substitution) tests\n");

test("cheap heart replaces 1 raw: secHeart set, heartCost, display total = 4 raw + sec + heart", () => {
  // threshold = 1000*(1-rrr) ≈ 633 ; heart 100 wins
  const r = computeRefineRouteForCity(LYM, routeItem, md(100), "buy");
  assert.ok(r, "route computed");
  assert.ok(r.secHeart && r.secHeart.id === VINEHEART, "Vineheart surfaced");
  assert.strictEqual(r.heartCost, 100);
  // display total = keptRaw(4*1000) + secondary(500) + heart(100)
  assert.strictEqual(r.totalRawCost, 4 * 1000 + 500 + 100);
  assert.strictEqual(r.totalSecondaryCost, 500, "secondary stays a normal returnable cost");
});

test("expensive heart loses: all 5 raws kept, no secHeart", () => {
  // heart 700 > threshold 633 → loses
  const r = computeRefineRouteForCity(LYM, routeItem, md(700), "buy");
  assert.ok(r);
  assert.strictEqual(r.secHeart, null);
  assert.strictEqual(r.heartCost, 0);
  assert.strictEqual(r.totalRawCost, 5 * 1000 + 500); // full raw + secondary
});

test("winning heart raises profit vs no heart (heart cheaper than a raw unit)", () => {
  const withHeart = computeRefineRouteForCity(LYM, routeItem, md(100), "buy");
  const noHeart = computeRefineRouteForCity(LYM, routeItem, md(null), "buy");
  assert.ok(withHeart.marginInfo.profit > noHeart.marginInfo.profit,
    `heart profit ${withHeart.marginInfo.profit} should beat no-heart ${noHeart.marginInfo.profit}`);
});

test("heart is RRR-exempt: profit matches the per-term formula", () => {
  const r = computeRefineRouteForCity(LYM, routeItem, md(100), "buy");
  // effectiveCost = ((keptRaw + sec)*(1-rrr) + heart)*(1+SETUP) ; keptRaw=4000, sec=500, heart=100
  const eff = ((4000 + 500) * (1 - RRR) + 100) * 1.025;
  const expProfit = 99999 * (1 - 0.065) - eff;
  assert.ok(Math.abs(r.marginInfo.profit - expProfit) < 0.5, `profit ${r.marginInfo.profit} vs expected ${expProfit.toFixed(2)}`);
});

// ── Enchant gate: hearts substitute a raw only up to .3 (no .4 heart recipe). ──
// Build a market for an enchant-N fiber refine with a cheap (always-winning) heart.
function mdEnch(ench) {
  const suffix = ench ? `_LEVEL${ench}@${ench}` : "";
  const m = {
    [`T8_FIBER${suffix}`]: { Lymhurst: { buy_price: 1000, volume_24h: 9999 } },
    [`T7_CLOTH${suffix}`]: { Lymhurst: { buy_price: 500, volume_24h: 9999 } },
    [`T8_CLOTH${suffix}`]: { Lymhurst: { sell_price: 99999, volume_24h: 9999 } },
    [VINEHEART]: { Lymhurst: { buy_price: 100, volume_24h: 9999 } }, // 100 < threshold 633
  };
  return m;
}
function routeEnch(ench) {
  const suffix = ench ? `_LEVEL${ench}@${ench}` : "";
  const secSuffix = ench ? `_LEVEL${ench}@${ench}` : ""; // T8 secondary inherits enchant
  return {
    rawId: `T8_FIBER${suffix}`, refinedId: `T8_CLOTH${suffix}`,
    secondaryMatId: `T7_CLOTH${secSuffix}`, secondaryMatCount: 1, rawRatio: 5, resourceType: "fiber",
  };
}

[1, 2, 3].forEach((ench) => {
  test(`.${ench} refine still uses a winning heart`, () => {
    const r = computeRefineRouteForCity(LYM, routeEnch(ench), mdEnch(ench), "buy");
    assert.ok(r, `route computed for .${ench}`);
    assert.ok(r.secHeart && r.secHeart.id === VINEHEART, `heart applied at .${ench}`);
    assert.strictEqual(r.heartCost, 100, `heart cost charged at .${ench}`);
  });
});

test(".4 (pristine) refine never uses a heart, even when it would win", () => {
  const r = computeRefineRouteForCity(LYM, routeEnch(4), mdEnch(4), "buy");
  assert.ok(r, "route computed for .4");
  assert.strictEqual(r.secHeart, null, "no heart at .4");
  assert.strictEqual(r.heartCost, 0, "no heart cost at .4");
  assert.strictEqual(r.totalRawCost, 5 * 1000 + 500, "all 5 raws kept at .4 (raw + secondary)");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
