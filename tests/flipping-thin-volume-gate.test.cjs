/**
 * Test: a thinly-traded item must still produce a Flipping route.
 *
 * Bug (reported): "Avalonian Energy" (and every other item whose prices came
 * from a live monitor capture, where volume_24h is always 0 by design — see
 * js/market-price-store.js) rendered as a blank row: "Buy: -> Sell:" with
 * "no data — click to set" in both price cells, even though the price-edit
 * dropdown showed a real order book ("Lymhurst — 4,000 · 3,510").
 *
 * Root cause: in market-order mode findBestBuyCity/findBestSellCity required
 * volume_24h >= 25 at a city before it could be picked. When NO city cleared
 * the bar, the whole route was discarded and the row collapsed to "no data" —
 * the same class of bug already fixed for crafting, enchanting and mounts
 * (tests/crafting-thin-volume-gate.test.cjs).
 *
 * Fix: the volume gate becomes a PREFERENCE, not a hard filter. Cities that
 * clear minVolume still win outright; only when none does do we fall back to
 * the best-priced city among the thin ones. The Vol/24h column surfaces the
 * thinness. The gate is also override-aware (getOverrideVolume) so a manually
 * entered volume qualifies a city the same way live volume does.
 *
 * Black-box: real js/utils.js + js/render-flipping.js compiled with stubs, fed
 * synthetic market data. No DOM, no live API.
 *
 * The harness stubs the PRE-SPLIT #sort-instant radio, which drives both legs
 * together — that fallback is deliberate and load-bearing, so this file is also
 * the proof it still works. Mixed Buy/Sell modes, where the two legs gate on
 * different numbers, are covered in tests/order-type-side-volume-gate.test.cjs.
 *
 * Run: node tests/flipping-thin-volume-gate.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
let _instant = false;
const _els = { "sort-instant": { get checked() { return _instant; } } };
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
`;

const sources = J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + J("travel-cost.js") + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) + J("flip-route.js") + J("render-flipping.js");

const mod = new Module("flipping-thin-gate");
mod._compile(
  stubs + sources +
    "\nmodule.exports = { findBestBuyCity, findBestSellCity, buildFlipRoute, setOverrideVolume, setInstant, getOrderType };",
  "flipping-thin-gate.js",
);
const X = mod.exports;

const LYM = "Lymhurst";
const MAR = "Martlock";
const FS = "Fort Sterling";
const CITY_LIST = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];

// Synthetic order book. volume_24h defaults to 0 — the monitor-capture case.
function md(entries) {
  const out = { ITEM: {} };
  Object.entries(entries).forEach(([city, [buy, sell, vol]]) => {
    out.ITEM[city] = { buy_price: buy, sell_price: sell, volume_24h: vol || 0 };
  });
  return out;
}

const V_HI = 100; // clears the old gate
const V_LO = 3;   // below the old MIN_VOLUME (25)
const MIN_VOL = 25;

let passed = 0, failed = 0;
function test(name, fn) {
  try { X.setInstant(false); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Flipping thin-volume gate tests\n");

// ── The reported bug: zero volume everywhere ─────────────────────────────
test("zero-volume order book still resolves a BUY city (market mode)", () => {
  const data = md({ [LYM]: [3510, 4000, 0] });
  const buy = X.findBestBuyCity(data, "ITEM", CITY_LIST, MIN_VOL, undefined, true);
  assert.strictEqual(buy.city, LYM, "expected the only priced city to be picked");
  assert.strictEqual(buy.price, 3510, "buy-order price must be used");
});

test("zero-volume order book still resolves a SELL city (market mode)", () => {
  const data = md({ [LYM]: [3510, 4000, 0] });
  const sell = X.findBestSellCity(data, "ITEM", CITY_LIST, MIN_VOL, undefined, undefined, true);
  assert.strictEqual(sell.city, LYM);
  assert.strictEqual(sell.price, 4000, "sell-order price must be used");
});

test("buildFlipRoute yields a full route for a zero-volume item", () => {
  const data = md({ [LYM]: [3510, 4000, 0], [MAR]: [3000, 5200, 0] });
  const r = X.buildFlipRoute(data, "ITEM", CITY_LIST, CITY_LIST);
  assert.strictEqual(r.buyCity, MAR, "cheapest buy city");
  assert.strictEqual(r.buyPrice, 3000);
  assert.strictEqual(r.sellCity, MAR, "highest sell city");
  assert.strictEqual(r.sellPrice, 5200);
});

// ── The gate survives as a PREFERENCE ────────────────────────────────────
test("a liquid city beats a cheaper THIN city on the buy side", () => {
  const data = md({ [LYM]: [3000, 3500, V_LO], [MAR]: [3200, 3800, V_HI] });
  const buy = X.findBestBuyCity(data, "ITEM", CITY_LIST, MIN_VOL, undefined, true);
  assert.strictEqual(buy.city, MAR, "liquid city wins even though Lymhurst is cheaper");
  assert.strictEqual(buy.price, 3200);
});

test("a liquid city beats a higher-priced THIN city on the sell side", () => {
  const data = md({ [LYM]: [3000, 9000, V_LO], [MAR]: [3200, 3800, V_HI] });
  const sell = X.findBestSellCity(data, "ITEM", CITY_LIST, MIN_VOL, undefined, undefined, true);
  assert.strictEqual(sell.city, MAR, "liquid city wins even though Lymhurst pays more");
});

test("among liquid cities the best price still wins — regression guard", () => {
  const data = md({ [LYM]: [3000, 3500, V_HI], [MAR]: [3200, 3800, V_HI], [FS]: [2800, 3300, V_HI] });
  const buy = X.findBestBuyCity(data, "ITEM", CITY_LIST, MIN_VOL, undefined, true);
  assert.strictEqual(buy.city, FS, "cheapest liquid city");
  const sell = X.findBestSellCity(data, "ITEM", CITY_LIST, MIN_VOL, undefined, undefined, true);
  assert.strictEqual(sell.city, MAR, "highest-paying liquid city");
});

test("among thin cities only, the best price wins", () => {
  const data = md({ [LYM]: [3000, 3500, V_LO], [MAR]: [3200, 3800, 0], [FS]: [2800, 3300, 1] });
  const buy = X.findBestBuyCity(data, "ITEM", CITY_LIST, MIN_VOL, undefined, true);
  assert.strictEqual(buy.city, FS, "cheapest thin city");
  const sell = X.findBestSellCity(data, "ITEM", CITY_LIST, MIN_VOL, undefined, undefined, true);
  assert.strictEqual(sell.city, MAR, "highest-paying thin city");
});

// ── Manual volume entries qualify a city ─────────────────────────────────
test("an override VOLUME qualifies a city with zero live volume", () => {
  const data = md({ [LYM]: [3000, 3500, 0], [MAR]: [3200, 3800, 0] });
  X.setOverrideVolume("ITEM", MAR, 400);
  const buy = X.findBestBuyCity(data, "ITEM", CITY_LIST, MIN_VOL, undefined, true);
  X.setOverrideVolume("ITEM", MAR, 0);
  assert.strictEqual(buy.city, MAR, "manually entered volume must qualify the city");
});

// ── Instant mode and the no-data case are unchanged ──────────────────────
test("instant mode (minVolume 0) picks the best price outright", () => {
  X.setInstant(true);
  const data = md({ [LYM]: [3000, 3500, 0], [MAR]: [3200, 3800, V_HI] });
  // instant: buy at the ask, sell at the bid
  const buy = X.findBestBuyCity(data, "ITEM", CITY_LIST, 0, undefined, true);
  assert.strictEqual(buy.city, LYM, "cheapest ask");
  assert.strictEqual(buy.price, 3500);
});

test("no priced city anywhere still yields no route (no invented prices)", () => {
  const data = md({ [LYM]: [0, 0, 0] });
  const buy = X.findBestBuyCity(data, "ITEM", CITY_LIST, MIN_VOL, undefined, true);
  const sell = X.findBestSellCity(data, "ITEM", CITY_LIST, MIN_VOL, undefined, undefined, true);
  assert.strictEqual(buy.city, null);
  assert.strictEqual(buy.price, 0);
  assert.strictEqual(sell.city, null);
  assert.strictEqual(sell.price, 0);
});

test("an item absent from marketData yields no route", () => {
  const buy = X.findBestBuyCity({}, "MISSING", CITY_LIST, MIN_VOL, undefined, true);
  assert.strictEqual(buy.city, null);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
