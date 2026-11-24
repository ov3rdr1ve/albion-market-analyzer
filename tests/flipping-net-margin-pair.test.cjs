/**
 * Test: findBestFlipPair ranks pairs by NET margin, not the raw spread.
 *
 * The fees are multiplicative (buy × (1+SETUP_FEE), sell × (1-PREMIUM_TAX))
 * while the Brecilien exit fee is flat silver charged per leg. A raw
 * `sell - buy - travel` score therefore orders pairs differently from the
 * profit the row actually reports: a fatter gross spread can lose once the
 * sell-side tax is taken off the larger number and the flat fee is added.
 *
 * (With travel = 0 the two orderings agree — the objective separates into an
 * independent max over sell cities and min over buy cities. The exit fee is
 * what couples the legs, so that is what this exercises.)
 *
 * Black-box: real js/calculations.js + js/utils.js + js/flip-route.js compiled
 * with stubs, fed synthetic market data. No DOM, no live API.
 *
 * Run: node tests/flipping-net-margin-pair.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
let _instant = false;
let _bmr = true;
let _premium = true;
let _exit = () => 0;
const _els = {
  "sort-instant": { get checked() { return _instant; } },
  "include-caerleon": { get checked() { return _bmr; } },
  "premium-account": { get checked() { return _premium; } },
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
function legBrecilienCost(buyCity, sellCity, itemId, qty) { return _exit(buyCity, sellCity); }
function setInstant(on) { _instant = !!on; }
function setExitFee(fn) { _exit = fn; }
`;

const mod = new Module("flipping-net-margin-pair");
mod._compile(
  stubs + J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) + J("flip-route.js") +
    "\nmodule.exports = { findBestFlipPair, calculateFlipMargin, setInstant, setExitFee };",
  "flipping-net-margin-pair.js",
);
const X = mod.exports;

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const entry = (bid, ask, vol = 5000) => ({
  buy_price: bid, sell_price: ask, volume_24h: vol,
  buy_date: "2026-08-19T12:00:00Z", sell_date: "2026-08-19T12:00:00Z", used_fallback: false,
});

// Market-orders mode: a buy leg reads the bid, a sell leg reads the ask.
//   Lymhurst is the only sensible buy at 1,000.
//   Martlock  sells at 1,300 with no exit fee   → raw 300, net 190.5
//   Thetford  sells at 1,600 with a 285 exit fee → raw 315, net 186.0
// The raw spread prefers Thetford; the profit the row prints prefers Martlock.
const ITEM = "T4_TEST";
const BOOK = {
  [ITEM]: {
    Lymhurst: entry(1000, 1100),
    Martlock: entry(9000, 1300),
    Thetford: entry(9000, 1600),
  },
};
const CITY_LIST = ["Lymhurst", "Martlock", "Thetford"];
const withFee = () => X.setExitFee((b, s) => (s === "Thetford" ? 285 : 0));

console.log("net margin decides the pair");
test("the flat exit fee flips the winner away from the widest spread", () => {
  withFee();
  const raw = { Martlock: 1300 - 1000 - 0, Thetford: 1600 - 1000 - 285 };
  assert.ok(raw.Thetford > raw.Martlock, "fixture: Thetford must win on raw spread");
  const netM = X.calculateFlipMargin(1000, 1300, 0).profit;
  const netT = X.calculateFlipMargin(1000, 1600, 285).profit;
  assert.ok(netM > netT, `fixture: Martlock must win on net (${netM} vs ${netT})`);

  const r = X.findBestFlipPair(BOOK, ITEM, CITY_LIST, CITY_LIST);
  assert.strictEqual(r.buyCity, "Lymhurst");
  assert.strictEqual(r.sellCity, "Martlock");
});

test("with no exit fee the widest spread wins, as before", () => {
  X.setExitFee(() => 0);
  const r = X.findBestFlipPair(BOOK, ITEM, CITY_LIST, CITY_LIST);
  assert.strictEqual(r.buyCity, "Lymhurst");
  assert.strictEqual(r.sellCity, "Thetford");
});

console.log("existing gates survive");
test("an outlier ask is still fenced out by the IQR bound", () => {
  X.setExitFee(() => 0);
  const book = {
    [ITEM]: {
      Lymhurst: entry(1000, 1100),
      Martlock: entry(1050, 1300),
      Thetford: entry(1020, 1200),
      Bridgewatch: entry(1010, 900000),
    },
  };
  const r = X.findBestFlipPair(book, ITEM, [...CITY_LIST, "Bridgewatch"], [...CITY_LIST, "Bridgewatch"]);
  assert.notStrictEqual(r.sellCity, "Bridgewatch");
  assert.strictEqual(r.sellCity, "Martlock");
});

test("a fully liquid pair still outranks a fatter thin pair", () => {
  X.setExitFee(() => 0);
  const book = {
    [ITEM]: {
      Lymhurst: entry(1000, 1100, 5000),
      Martlock: entry(1050, 1300, 5000),
      Thetford: entry(1020, 1400, 0),   // thin: no 24h volume
    },
  };
  const r = X.findBestFlipPair(book, ITEM, CITY_LIST, CITY_LIST, { minVolume: 25 });
  assert.strictEqual(r.sellCity, "Martlock");
});

test("no priced leg yields the empty route", () => {
  const r = X.findBestFlipPair({ [ITEM]: { Lymhurst: entry(0, 0) } }, ITEM, ["Lymhurst"], ["Lymhurst"]);
  assert.strictEqual(r.buyCity, null);
  assert.strictEqual(r.sellCity, null);
});

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
