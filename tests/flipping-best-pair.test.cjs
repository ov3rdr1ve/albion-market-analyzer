/**
 * Test: the Flipping table picks the best (buy city, sell city) PAIR.
 *
 * Bug (reported): "flipping table doesnt pick cheapest - most expensive
 * flipping opportunities".
 *
 * Root cause: buildFlipRoute was GREEDY. findBestBuyCity resolved the buy city
 * over the whole list, then findBestSellCity picked a sell city *conditioned on
 * that buy city*. Two candidates were lost that way:
 *   - the Black Market zone rule (isInvalidCrossRoute: the BM's book sits inside
 *     Caerleon, so with Black/Red Zone Routes OFF a sale there requires buying
 *     in Caerleon) is evaluated AFTER the buy city is locked in, so the fattest
 *     bid in the game was discarded whenever the cheapest buy happened to land
 *     in a royal city,
 *   - the Brecilien exit fee is charged per LEG, so the cheapest buy is not
 *     always the cheapest buy *for the sell city that pays most*.
 *
 * Fix: js/flip-route.js findBestFlipPair scores every allowed pair by
 * `sellPrice - buyPrice - exitFee` and keeps the maximum. The IQR outlier fence
 * and the soft volume preference both survive — the latter becomes pair-wise
 * (a pair whose BOTH legs are liquid outranks any thin pair; thin pairs are
 * only consulted when no fully-liquid pair exists).
 *
 * Black-box: real js/utils.js + js/flip-route.js + js/render-flipping.js
 * compiled with stubs, fed synthetic market data. No DOM, no live API.
 *
 * Run: node tests/flipping-best-pair.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
let _instant = false;
let _bmr = false;
const _els = {
  "sort-instant": { get checked() { return _instant; } },
  "include-caerleon": { get checked() { return _bmr; } },
};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const FOCUS_COSTS = {};
let recipeCache = {};
let lastMarketData = null;
function setInstant(on) { _instant = !!on; }
function setRoutes(on) { _bmr = !!on; }
`;

const sources =
  J("data-city-bonuses.js") +
  (J("calculations.js") + J("calculations-margins.js")) + J("travel-cost.js") + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  J("flip-route.js") + J("render-flipping.js");

const mod = new Module("flipping-best-pair");
mod._compile(
  stubs + sources +
    "\nmodule.exports = { findBestFlipPair, buildFlipRoute, setInstant, setRoutes, setCityForce, clearCityForce, setOverrideVolume };",
  "flipping-best-pair.js",
);
const X = mod.exports;

const CAE = "Caerleon";
const LYM = "Lymhurst";
const MAR = "Martlock";
const FS = "Fort Sterling";
const THE = "Thetford";
const BM = "Black Market";

const ALL_BUY = CAE_LIST();
function CAE_LIST() {
  return ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
}
const ALL_SELL = [...CAE_LIST(), BM];

const MIN_VOL = 25;
const V_HI = 100;
const V_LO = 3;

/** Synthetic order book: city -> [buy_price, sell_price, volume_24h]. */
function md(entries) {
  const out = { ITEM: {} };
  Object.entries(entries).forEach(([city, [buy, sell, vol]]) => {
    out.ITEM[city] = { buy_price: buy, sell_price: sell, volume_24h: vol || 0 };
  });
  return out;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    X.setInstant(false);
    X.setRoutes(true);
    X.clearCityForce("ITEM", "buy");
    X.clearCityForce("ITEM", "sell");
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

console.log("Flipping best-pair tests\n");

// ── The reported regression ──────────────────────────────────────────────
test("routes OFF: Black Market bid is reachable when Caerleon is not the cheapest buy", () => {
  // Greedy picks the globally cheapest buy (Lymhurst) and is then barred from
  // the Black Market, settling for a royal sale. The pair scan must see that
  // buying slightly dearer in Caerleon unlocks a far fatter bid.
  //
  // Routes OFF, because that is the setting where the Caerleon-only rule bites:
  // the Black Market's book sits inside Caerleon, so a royal origin can only
  // reach it once the black/red haul is opted into (js/utils.js
  // isInvalidCrossRoute, tests/cross-route-black-market.test.cjs).
  X.setRoutes(false);
  const data = md({
    [LYM]: [1000, 1400, V_HI],   // cheapest bid to buy from
    [CAE]: [1100, 1500, V_HI],
    [MAR]: [1200, 1600, V_HI],   // best royal ask
    // The Black Market follows the Pricing Model like any city: market orders
    // list a sell order at 3000, instant fills its 2800 bid.
    [BM]:  [2800, 3000, V_HI],
  });
  const r = X.findBestFlipPair(data, "ITEM", ALL_BUY, ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  assert.strictEqual(r.buyCity, CAE, "must buy in Caerleon to reach the Black Market");
  assert.strictEqual(r.sellCity, BM, "Black Market pays 3000 — the best sale in the game");
  assert.strictEqual(r.buyPrice, 1100);
  assert.strictEqual(r.sellPrice, 3000);
});

test("routes ON: a royal buy hauls straight to the Black Market", () => {
  // Same book. With the haul opted into, the Caerleon detour is pointless — the
  // cheapest buy anywhere wins, because every origin reaches the bid.
  const data = md({
    [LYM]: [1000, 1400, V_HI],
    [CAE]: [1100, 1500, V_HI],
    [MAR]: [1200, 1600, V_HI],
    [BM]:  [2800, 3000, V_HI],
  });
  const r = X.findBestFlipPair(data, "ITEM", ALL_BUY, ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  assert.strictEqual(r.buyCity, LYM, "cheapest buy in the game, now reachable to the BM");
  assert.strictEqual(r.sellCity, BM);
  assert.strictEqual(r.sellPrice - r.buyPrice, 2000, "beats Caerleon's 1900");
});

test("routes OFF: a royal pair still wins when the Black Market detour does not pay", () => {
  X.setRoutes(false);
  const data = md({
    [LYM]: [1000, 1400, V_HI],
    [CAE]: [1900, 1500, V_HI],   // Caerleon buy is far too dear
    [MAR]: [1200, 1800, V_HI],
    [BM]:  [1900, 2000, V_HI],   // 2000 - 1900 = 100 < 1800 - 1000 = 800
  });
  const r = X.findBestFlipPair(data, "ITEM", ALL_BUY, ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  assert.strictEqual(r.buyCity, LYM);
  assert.strictEqual(r.sellCity, MAR);
});

test("the Black Market is never a buy city, however it is offered", () => {
  // BM is not in CITIES, but a caller passing it in must still never buy there.
  const data = md({
    [BM]:  [200, 300, V_HI],     // absurdly cheap, and unbuyable
    [LYM]: [1000, 1400, V_HI],
    [MAR]: [1200, 1800, V_HI],
  });
  const r = X.findBestFlipPair(data, "ITEM", [...ALL_BUY, BM], ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  assert.notStrictEqual(r.buyCity, BM);
  assert.strictEqual(r.buyCity, LYM);
});

// ── Global maximum, not per-side extremes ────────────────────────────────
test("best pair need not contain the global-min buy", () => {
  // Routes OFF splits the world: Caerleon holds the cheapest buy in the game
  // but cannot sell into a royal city, so the winner is a royal pair. Greedy
  // locked onto Caerleon here and then had only Caerleon left to sell into.
  X.setRoutes(false);
  const data = md({
    [CAE]: [500, 600, V_HI],     // global-min buy, royal-unreachable
    [LYM]: [1000, 1100, V_HI],
    [FS]:  [900, 1050, V_HI],
    [MAR]: [1200, 1800, V_HI],   // dearest royal sale
  });
  const r = X.findBestFlipPair(data, "ITEM", ALL_BUY, ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  assert.strictEqual(r.buyCity, FS, "cheapest reachable buy, not the global 500");
  assert.strictEqual(r.sellCity, MAR, "dearest reachable sell");
  assert.strictEqual(r.sellPrice - r.buyPrice, 900, "beats Caerleon→Caerleon's 100");
});

test("routes OFF: a royal buy never pairs with Caerleon", () => {
  X.setRoutes(false);
  const data = md({
    [LYM]: [1000, 1100, V_HI],
    [CAE]: [1200, 9000, V_HI],
  });
  const r = X.findBestFlipPair(data, "ITEM", [LYM, CAE], [LYM, CAE], { minVolume: MIN_VOL, sideMode: true });
  assert.strictEqual(r.buyCity, CAE, "Caerleon→Caerleon is the only valid profitable pair");
  assert.strictEqual(r.sellCity, CAE);
});

// ── Volume preference is pair-wise ───────────────────────────────────────
test("a fully-liquid pair beats a thin pair with a fatter margin", () => {
  const data = md({
    [LYM]: [1000, 1200, V_HI],
    [MAR]: [1100, 1400, V_HI],
    [THE]: [900, 5000, V_LO],    // huge margin, but nobody trades there
  });
  const r = X.findBestFlipPair(data, "ITEM", ALL_BUY, ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  assert.strictEqual(r.buyCity, LYM);
  assert.strictEqual(r.sellCity, MAR, "liquid pair wins over the thin 4100 margin");
});

test("no liquid pair anywhere still returns the best thin pair", () => {
  const data = md({
    [LYM]: [3510, 4000, 0],
    [MAR]: [3000, 5200, 0],
  });
  const r = X.findBestFlipPair(data, "ITEM", ALL_BUY, ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  assert.strictEqual(r.buyCity, MAR);
  assert.strictEqual(r.sellCity, MAR);
  assert.strictEqual(r.sellPrice - r.buyPrice, 2200);
});

test("half-liquid pairs count as thin — both legs must clear the gate", () => {
  const data = md({
    [LYM]: [1000, 1200, V_HI],   // liquid
    [MAR]: [1100, 1300, V_LO],   // thin
  });
  // LYM→LYM (200) is the only fully-liquid pair; LYM→MAR (300) is half-thin.
  const r = X.findBestFlipPair(data, "ITEM", ALL_BUY, ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  assert.strictEqual(r.buyCity, LYM);
  assert.strictEqual(r.sellCity, LYM, "the fully-liquid pair outranks the fatter half-thin one");
});

test("a manual volume override qualifies a leg", () => {
  const data = md({
    [LYM]: [1000, 1200, V_HI],
    [MAR]: [1100, 1300, 0],
  });
  X.setOverrideVolume("ITEM", MAR, 400);
  const r = X.findBestFlipPair(data, "ITEM", ALL_BUY, ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  X.setOverrideVolume("ITEM", MAR, 0);
  assert.strictEqual(r.sellCity, MAR, "hand-typed volume makes the fatter pair liquid");
});

// ── City forces ──────────────────────────────────────────────────────────
test("a forced BUY city pins that leg but the sell leg is still scanned", () => {
  const data = md({
    [LYM]: [1000, 1200, V_HI],
    [MAR]: [1100, 1800, V_HI],
    [FS]:  [800, 1300, V_HI],
  });
  X.setCityForce("ITEM", "buy", MAR);
  const r = X.findBestFlipPair(data, "ITEM", ALL_BUY, ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  assert.strictEqual(r.buyCity, MAR, "forced buy city honoured even though FS is cheaper");
  assert.strictEqual(r.sellCity, MAR, "sell leg still maximised");
});

test("a forced SELL city pins that leg but the buy leg is still scanned", () => {
  const data = md({
    [LYM]: [1000, 1200, V_HI],
    [MAR]: [1100, 1800, V_HI],
    [FS]:  [800, 1300, V_HI],
  });
  X.setCityForce("ITEM", "sell", LYM);
  const r = X.findBestFlipPair(data, "ITEM", ALL_BUY, ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  assert.strictEqual(r.sellCity, LYM, "forced sell city honoured");
  assert.strictEqual(r.buyCity, FS, "buy leg still minimised");
});

test("a force outside the caller's city list is ignored, not fatal", () => {
  const data = md({ [LYM]: [1000, 1200, V_HI] });
  X.setCityForce("ITEM", "buy", "Smuggler's Den");
  const r = X.findBestFlipPair(data, "ITEM", [LYM], [LYM], { minVolume: MIN_VOL, sideMode: true });
  assert.strictEqual(r.buyCity, LYM);
});

// ── Degenerate input ─────────────────────────────────────────────────────
test("no priced city yields no route (no invented prices)", () => {
  const data = md({ [LYM]: [0, 0, 0] });
  const r = X.findBestFlipPair(data, "ITEM", ALL_BUY, ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  assert.strictEqual(r.buyCity, null);
  assert.strictEqual(r.buyPrice, 0);
  assert.strictEqual(r.sellCity, null);
  assert.strictEqual(r.sellPrice, 0);
});

test("an item absent from marketData yields no route", () => {
  const r = X.findBestFlipPair({}, "MISSING", ALL_BUY, ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  assert.strictEqual(r.buyCity, null);
  assert.strictEqual(r.sellCity, null);
});

test("a loss-making book still returns its least-bad pair (the row shows the loss)", () => {
  // Rows with a negative margin are filtered at display time, not here — the
  // picker must not silently swallow them or the Show All view goes blank.
  const data = md({ [LYM]: [1000, 900, V_HI] });
  const r = X.findBestFlipPair(data, "ITEM", ALL_BUY, ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  assert.strictEqual(r.buyCity, LYM);
  assert.strictEqual(r.sellCity, LYM);
  assert.strictEqual(r.sellPrice - r.buyPrice, -100);
});

test("ties keep the first pair scanned, so sort order is stable", () => {
  const data = md({
    [LYM]: [1000, 1200, V_HI],
    [MAR]: [1000, 1200, V_HI],
  });
  const a = X.findBestFlipPair(data, "ITEM", ALL_BUY, ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  const b = X.findBestFlipPair(data, "ITEM", ALL_BUY, ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  assert.strictEqual(a.buyCity, b.buyCity);
  assert.strictEqual(a.sellCity, b.sellCity);
});

// ── buildFlipRoute delegates ─────────────────────────────────────────────
test("buildFlipRoute returns the pair-scanned route", () => {
  const data = md({
    [LYM]: [1000, 1400, V_HI],
    [CAE]: [1100, 1500, V_HI],
    [BM]:  [2800, 3000, V_HI],
  });
  // Routes are ON here (the per-test default), so the cheapest buy reaches the
  // Black Market directly — no Caerleon detour to pay for.
  const r = X.buildFlipRoute(data, "ITEM", ALL_BUY, ALL_SELL);
  assert.strictEqual(r.buyCity, LYM);
  assert.strictEqual(r.sellCity, BM);
  assert.strictEqual(r.travelCost, 0, "Brecilien Travel Planner fee is disabled in profit tables");
});

test("the Black Market sale follows the Pricing Model, like every other city", () => {
  // It used to be pinned to its bid in both models, which quoted a Grandmaster's
  // Bag sale at 87,147 instead of the 140,986 sell order the user was placing.
  const data = md({
    [LYM]: [1000, 1400, V_HI],
    [BM]:  [2800, 3000, V_HI],
  });
  const market = X.findBestFlipPair(data, "ITEM", ALL_BUY, ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  assert.strictEqual(market.sellCity, BM);
  assert.strictEqual(market.sellPrice, 3000, "market orders list a sell order at the BM");
  X.setInstant(true);
  const instant = X.findBestFlipPair(data, "ITEM", ALL_BUY, ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  assert.strictEqual(instant.sellCity, BM);
  assert.strictEqual(instant.sellPrice, 2800, "instant fills the BM bid");
});

test("a Black Market with no sell order drops out under Market Orders", () => {
  // No silent fallback to the bid: the leg is dropped and the row falls back to
  // the best royal sale (or reads no-data and is hand-priceable).
  const data = md({
    [LYM]: [1000, 1400, V_HI],
    [CAE]: [1100, 1500, V_HI],
    [FS]:  [1150, 1600, V_HI],
    [BM]:  [9000, 0, V_HI],
  });
  const r = X.findBestFlipPair(data, "ITEM", ALL_BUY, ALL_SELL, { minVolume: MIN_VOL, sideMode: true });
  assert.notStrictEqual(r.sellCity, BM, "a 9000 bid is worth nothing when you are listing, not filling");
  assert.strictEqual(r.sellCity, FS, "falls back to the dearest reachable ask");
  assert.strictEqual(r.sellPrice, 1600);
});

test("instant mode reads the opposite fields and still pairs exhaustively", () => {
  X.setInstant(true);
  // instant: buy at the ask (sell_price), sell at the bid (buy_price)
  const data = md({
    [LYM]: [1500, 1000, V_HI],   // ask 1000
    [MAR]: [1800, 1200, V_HI],   // bid 1800
  });
  const r = X.findBestFlipPair(data, "ITEM", ALL_BUY, ALL_SELL, { minVolume: 0, sideMode: true });
  assert.strictEqual(r.buyCity, LYM, "cheapest ask");
  assert.strictEqual(r.buyPrice, 1000);
  assert.strictEqual(r.sellCity, MAR, "fattest bid");
  assert.strictEqual(r.sellPrice, 1800);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
