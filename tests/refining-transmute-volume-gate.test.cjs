/**
 * Test: the transmute substitute's market leaves obey the same volume gate the
 * Refining table already applies to its own raw leg.
 *
 * The row-level raw buy skips a city whose 24h volume is under MIN_VOLUME (25 in
 * market mode, 0 in instant), unless a price override says otherwise. Without the
 * same gate on the substitution DP, a thin listing the row would never buy could
 * still trigger "buy the node below and transmute it up".
 *
 * The gate is opt-in per caller: the Refining table passes its MIN_VOLUME, the
 * chain path (Crafting Planner) passes nothing and stays ungated, matching the
 * rest of that table's legs.
 *
 * Run: node tests/refining-transmute-volume-gate.test.cjs
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
let testCityForce = {}, testOverrides = {};
function isBlackRedZoneEnabled() { return false; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function getOverridePrice(itemId, city) { return testOverrides[itemId + ":" + city] ?? null; }
function getCityForce(itemId, side) { return testCityForce[itemId]?.[side] ?? null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function legBrecilienCost() { return 0; }
function resourceShortName(id) { return id; }
const REFINING_RECIPES = {};
const MIN_CHAIN_TIER = 4;
function getRefineRRR() { return 0; }
function getFocusCost() { return 0; }
function __setOverrides(m) { testOverrides = m || {}; }
function __setForce(m) { testCityForce = m || {}; }
function __reset() { __setOverrides({}); __setForce({}); }
`;

const load = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const mod = new Module("refining-transmute-volume-gate-test");
mod._compile(
  sandbox +
    load("js/data-transmute.js") +
    load("js/refining-chain-pricing.js") +
    load("js/refining-transmute-substitute.js") +
    "\nmodule.exports = { getRawTransmuteSourcing, resolveRefineRawSource, " +
    "findCheapestMarketBuyForRefine, TRANSMUTE_TIERUP_COST, " +
    "__setOverrides, __setForce, __reset };",
  "refining-transmute-substitute.js",
);
const {
  getRawTransmuteSourcing, resolveRefineRawSource, findCheapestMarketBuyForRefine,
  TRANSMUTE_TIERUP_COST, __setOverrides, __setForce, __reset,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { __reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
function priceMap(entries) {
  const out = {};
  for (const e of entries) {
    (out[e.id] ||= {})[e.city] = { buy_price: e.buy, volume_24h: e.vol ?? 9999 };
  }
  return out;
}

const FS = "Fort Sterling";
const TH = "Thetford";
const MARTLOCK = "Martlock";
const TIER8 = TRANSMUTE_TIERUP_COST[8][0];     // T7 ore → T8 ore

console.log("\n=== findCheapestMarketBuyForRefine minVolume ===");
test("thin city is skipped when a minVolume is given", () => {
  const md = priceMap([
    { id: "T8_ORE", city: FS, buy: 100, vol: 5 },
    { id: "T8_ORE", city: TH, buy: 900, vol: 500 },
  ]);
  assert.strictEqual(findCheapestMarketBuyForRefine("T8_ORE", md, MARTLOCK).city, FS);
  const gated = findCheapestMarketBuyForRefine("T8_ORE", md, MARTLOCK, { minVolume: 25 });
  assert.strictEqual(gated.city, TH);
  assert.strictEqual(gated.price, 900);
});

test("an override on the thin city lets it back in", () => {
  const md = priceMap([
    { id: "T8_ORE", city: FS, buy: 100, vol: 5 },
    { id: "T8_ORE", city: TH, buy: 900, vol: 500 },
  ]);
  __setOverrides({ "T8_ORE:Fort Sterling": 100 });
  assert.strictEqual(
    findCheapestMarketBuyForRefine("T8_ORE", md, MARTLOCK, { minVolume: 25 }).city, FS);
});

test("a pinned city ignores the gate — the user said source it here", () => {
  const md = priceMap([
    { id: "T8_ORE", city: FS, buy: 100, vol: 5 },
    { id: "T8_ORE", city: TH, buy: 900, vol: 500 },
  ]);
  __setForce({ T8_ORE: { buy: FS } });
  assert.strictEqual(
    findCheapestMarketBuyForRefine("T8_ORE", md, MARTLOCK, { minVolume: 25 }).city, FS);
});

test("no minVolume means no gate (unchanged for existing callers)", () => {
  const md = priceMap([{ id: "T8_ORE", city: FS, buy: 100, vol: 1 }]);
  assert.strictEqual(findCheapestMarketBuyForRefine("T8_ORE", md, MARTLOCK).city, FS);
  assert.strictEqual(
    findCheapestMarketBuyForRefine("T8_ORE", md, MARTLOCK, { minVolume: 0 }).city, FS);
});

console.log("\n=== transmute DP leaves ===");
test("a thin start node cannot trigger a substitution", () => {
  const md = priceMap([
    { id: "T8_ORE", city: TH, buy: 9000, vol: 500 },
    { id: "T7_ORE", city: FS, buy: 1500, vol: 3 },     // 1,500 + 5,000 < 9,000, but thin
  ]);
  assert.ok(getRawTransmuteSourcing("T8_ORE", md, MARTLOCK), "ungated: route exists");
  assert.strictEqual(
    getRawTransmuteSourcing("T8_ORE", md, MARTLOCK, { minVolume: 25 }), null);
});

test("a liquid start node still substitutes under the gate", () => {
  const md = priceMap([
    { id: "T8_ORE", city: TH, buy: 9000, vol: 500 },
    { id: "T7_ORE", city: FS, buy: 1500, vol: 500 },
  ]);
  const t = getRawTransmuteSourcing("T8_ORE", md, MARTLOCK, { minVolume: 25 });
  assert.ok(t);
  assert.strictEqual(t.startId, "T7_ORE");
  assert.strictEqual(t.perUnit, 1500 + TIER8);
});

test("the gate picks the next liquid start rather than dropping the route", () => {
  const md = priceMap([
    { id: "T8_ORE", city: TH, buy: 9000, vol: 500 },
    { id: "T7_ORE", city: FS, buy: 1, vol: 3 },        // cheapest but thin
    { id: "T7_ORE", city: TH, buy: 1500, vol: 500 },
  ]);
  const t = getRawTransmuteSourcing("T8_ORE", md, MARTLOCK, { minVolume: 25 });
  assert.ok(t);
  assert.strictEqual(t.startCity, TH);
  assert.strictEqual(t.perUnit, 1500 + TIER8);
});

test("the TARGET raw's own market option is gated too", () => {
  // 8.0 ore is cheap but thin, so the gated DP cannot 'buy' it; the transmute
  // route from a liquid T7 becomes the way to arrive at it.
  const md = priceMap([
    { id: "T8_ORE", city: FS, buy: 2000, vol: 3 },
    { id: "T7_ORE", city: TH, buy: 1500, vol: 500 },   // 1,500 + 5,000 = 6,500 > 2,000
  ]);
  assert.strictEqual(getRawTransmuteSourcing("T8_ORE", md, MARTLOCK), null, "ungated: buying wins");
  const t = getRawTransmuteSourcing("T8_ORE", md, MARTLOCK, { minVolume: 25 });
  assert.ok(t, "gated: the thin 8.0 is not buyable, so the route stands");
  assert.strictEqual(t.perUnit, 1500 + TIER8);
});

console.log("\n=== resolveRefineRawSource forwards the gate ===");
test("opts reach the DP through resolveRefineRawSource", () => {
  const md = priceMap([
    { id: "T8_ORE", city: TH, buy: 9000, vol: 500 },
    { id: "T7_ORE", city: FS, buy: 1500, vol: 3 },
  ]);
  const ungated = resolveRefineRawSource("T8_ORE", 9000, TH, MARTLOCK, md);
  assert.ok(ungated.transmute);
  const gated = resolveRefineRawSource("T8_ORE", 9000, TH, MARTLOCK, md, { minVolume: 25 });
  assert.strictEqual(gated.transmute, null);
  assert.strictEqual(gated.perUnit, 9000);
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
