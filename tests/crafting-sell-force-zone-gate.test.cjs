/**
 * Test: the crafting table renders each item in TWO independent zone sections
 * (Caerleon-craft and royal-craft), but the sell-city force is a single global
 * per (itemId, side). A force must only be honoured by the section whose craft
 * city can actually haul to it — otherwise the two sections are coupled.
 *
 * Bug (reported): editing the sell price / city on a ROYAL row sets a global
 * sell-city force to that royal city. The Caerleon row then read the same force,
 * found the royal city unreachable from Caerleon (red-zone routes off), and
 * collapsed to a dead "no-data" row at that royal city — instead of keeping its
 * real best route, Caerleon → Black Market. So a Satchel of Insight crafted in
 * Caerleon stopped showing its Black Market sale the moment the royal row was
 * touched.
 *
 * Fix: gate the forced sell city by isInvalidCrossRoute(craftCity, forced).
 * When the force is unreachable from THIS craft city, ignore it and fall back to
 * the full SELL_CITIES search. Mirrors the mount material-buy zone gate
 * (tests/city-force-respected). Black-box: feed synthetic marketData straight to
 * the real computeCraftRoutesForCity and assert on the returned routes.
 *
 * Run: node tests/crafting-sell-force-zone-gate.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const _els = {};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { _s: {}, getItem(k){ return this._s[k] ?? null; }, setItem(k,v){ this._s[k]=v; }, removeItem(k){ delete this._s[k]; } };
const window = { addEventListener: () => {} };
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const FOCUS_COSTS = {};      // getFocusCost -> 0 (focus column irrelevant here)
let recipeCache = {};
let lastMarketData = null;
`;

const sources =
  J("data-city-bonuses.js") +
  (J("calculations.js") + J("calculations-margins.js")) +
  J("travel-cost.js") +
  (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  J("render-crafting.js");

const mod = new Module("crafting-sell-force-zone-gate");
mod._compile(
  stubs +
    sources +
    "\nmodule.exports = { computeCraftRoutesForCity, setCityForce, clearCityForce, isBlackRedZoneEnabled };",
  "crafting-sell-force-zone-gate.js",
);
const X = mod.exports;

// Sanity: these tests model the red-zone-routes-OFF world (the only one that
// splits an item into a Caerleon section + a royal section).
assert.ok(
  !X.isBlackRedZoneEnabled(),
  "test harness must run with red-zone routes OFF",
);

// Synthetic market: one material present at every city (so both the Caerleon
// craft and a royal craft can source it), and one output whose best sale from
// Caerleon is the Black Market and whose best royal sale is Martlock.
const MAT = "T4_MAT_A";
const OUT = "T4_TESTBAG";
const ALL_CITIES = [
  "Caerleon",
  "Lymhurst",
  "Fort Sterling",
  "Thetford",
  "Martlock",
  "Bridgewatch",
  "Brecilien",
];
function freshMarket() {
  const md = {};
  const put = (id, c, b, s, v) => {
    (md[id] = md[id] || {})[c] = { buy_price: b, sell_price: s, volume_24h: v };
  };
  ALL_CITIES.forEach((c) => put(MAT, c, 1000, 1100, 500));
  // Output asks (sell_price) per royal city, plus the Black Market book. The
  // Black Market follows the Pricing Model like any city (bid under Instant,
  // its own sell order under Market Orders — the default here), so it carries
  // both fields; see tests/black-market-order-type.test.cjs.
  put(OUT, "Caerleon", 49000, 50000, 60);
  put(OUT, "Lymhurst", 47000, 48000, 60);
  put(OUT, "Martlock", 59000, 60000, 60); // best royal
  put(OUT, "Fort Sterling", 41000, 42000, 60);
  put(OUT, "Thetford", 43000, 44000, 60);
  put(OUT, "Bridgewatch", 45000, 46000, 60);
  put(OUT, "Black Market", 68000, 70000, 90); // best sale in the game either way
  return md;
}

const item = {
  id: OUT,
  name: "Test Satchel",
  craftType: null, // non-spec, non-focus → isolates the sell-force gate
  materials: [{ matId: MAT, count: 8 }],
};

function bestSell(craftCity, md) {
  const routes = X.computeCraftRoutesForCity(craftCity, item, item.materials, md);
  return routes.length ? routes[0].sellCity : null;
}

let passed = 0,
  failed = 0;
function test(name, fn) {
  X.clearCityForce(OUT, "sell"); // isolate each case
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

console.log("Crafting sell-force zone gate tests\n");

test("baseline: no force — Caerleon section sells to Black Market", () => {
  assert.strictEqual(bestSell("Caerleon", freshMarket()), "Black Market");
});

test("baseline: no force — royal section sells to best royal (Martlock)", () => {
  assert.strictEqual(bestSell("Lymhurst", freshMarket()), "Martlock");
});

test("royal sell force (Lymhurst) is HONOURED by the royal section", () => {
  X.setCityForce(OUT, "sell", "Lymhurst");
  assert.strictEqual(bestSell("Lymhurst", freshMarket()), "Lymhurst");
});

test("royal sell force (Lymhurst) is IGNORED by the Caerleon section — stays on Black Market", () => {
  // This is the reported bug: touching the royal row must NOT drag the Caerleon
  // row off its Black Market sale.
  X.setCityForce(OUT, "sell", "Lymhurst");
  assert.strictEqual(bestSell("Caerleon", freshMarket()), "Black Market");
});

test("Black Market force is HONOURED by the Caerleon section", () => {
  X.setCityForce(OUT, "sell", "Black Market");
  assert.strictEqual(bestSell("Caerleon", freshMarket()), "Black Market");
});

test("Black Market force is IGNORED by the royal section — falls back to best royal", () => {
  X.setCityForce(OUT, "sell", "Black Market");
  assert.strictEqual(bestSell("Lymhurst", freshMarket()), "Martlock");
});

test("Caerleon force is HONOURED by the Caerleon section (local AH over Black Market)", () => {
  X.setCityForce(OUT, "sell", "Caerleon");
  assert.strictEqual(bestSell("Caerleon", freshMarket()), "Caerleon");
});

test("Caerleon force is IGNORED by the royal section — falls back to best royal", () => {
  X.setCityForce(OUT, "sell", "Caerleon");
  assert.strictEqual(bestSell("Lymhurst", freshMarket()), "Martlock");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
