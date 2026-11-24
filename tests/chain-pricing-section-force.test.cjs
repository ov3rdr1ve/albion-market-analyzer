/**
 * Test: a city force never crosses a section boundary in chain pricing.
 *
 * A price edit writes TWO things: the price itself, filed per (itemId, city),
 * and a city FORCE, which is one global slot per (itemId, side)
 * (js/utils.js setCityForce, written from js/app.js on every commit). The price
 * is rightly shared — Caerleon has one order book — but the force is not: the
 * royal and the Caerleon section of a split table each price against their own
 * city list, and honouring a force from the other list pins both sections to
 * the same city. Editing a Caerleon ingredient price then visibly changed the
 * royal row too, because both rows had been dragged onto the same cell.
 *
 * findCheapestMarketBuy (js/chain-pricing.js) was the last sourcing helper
 * without the membership guard every sibling carries (js/utils.js
 * findBestBuyCity, js/flip-route.js flipCandidateCities, …). This pins it:
 *
 *   forced IS in `cities`  → that city, exactly (the pin still works)
 *   forced NOT in `cities` → ignored, cheapest of `cities` instead
 *
 * Black-box over the real findCheapestMarketBuy. Simulated prices only.
 *
 * Run: node tests/chain-pricing-section-force.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const sandbox = `
let testCityForce = {};
function getIQRBounds() { return { upper: Infinity }; }
function getOverridePrice() { return null; }
function getCityForce(itemId, side) { return testCityForce[itemId]?.[side] ?? null; }
function getBuyPrice(itemData, city) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function __setTestCityForce(map) { testCityForce = map || {}; }
const SETUP_FEE = 0;
`;

const loadFile = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const mod = new Module("chain-pricing-section-force-test");
mod._compile(
  sandbox + loadFile("js/chain-pricing.js") +
  "\nmodule.exports = { findCheapestMarketBuy, __setTestCityForce };",
  "chain-pricing.js",
);
const { findCheapestMarketBuy, __setTestCityForce } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const ROYAL = ["Bridgewatch", "Lymhurst", "Fort Sterling", "Martlock", "Thetford"];
const CAERLEON = ["Caerleon"];
const MAT = "T4_BUTTER";

// Caerleon is the cheapest book anywhere, so a leaking force is unmistakable:
// the royal row would report Caerleon at 100 instead of Martlock at 300.
const MARKET = {
  [MAT]: {
    Caerleon: { buy_price: 100 },
    Martlock: { buy_price: 300 },
    Thetford: { buy_price: 450 },
    Lymhurst: { buy_price: 900 },
  },
};

console.log("\n=== chain pricing: city force is section-scoped ===");

// [label, forcedCity, cities, expected {city, price}]
const cases = [
  ["no force, royal section → cheapest royal", null, ROYAL, { city: "Martlock", price: 300 }],
  ["no force, Caerleon section → Caerleon", null, CAERLEON, { city: "Caerleon", price: 100 }],
  ["in-section force is honoured (royal)", "Thetford", ROYAL, { city: "Thetford", price: 450 }],
  ["in-section force is honoured (Caerleon)", "Caerleon", CAERLEON, { city: "Caerleon", price: 100 }],
  ["Caerleon force IGNORED by the royal section", "Caerleon", ROYAL, { city: "Martlock", price: 300 }],
  ["royal force IGNORED by the Caerleon section", "Martlock", CAERLEON, { city: "Caerleon", price: 100 }],
  ["a force at a city with no book still ignored out of section", "Smuggler's Den", ROYAL, { city: "Martlock", price: 300 }],
];

for (const [label, forced, cities, expected] of cases) {
  test(label, () => {
    __setTestCityForce(forced ? { [MAT]: { buy: forced } } : {});
    assert.deepStrictEqual(findCheapestMarketBuy(MAT, MARKET, cities), expected);
  });
}

test("INVARIANT: one global force cannot pin BOTH sections to the same city", () => {
  __setTestCityForce({ [MAT]: { buy: "Caerleon" } });
  const cae = findCheapestMarketBuy(MAT, MARKET, CAERLEON);
  const royal = findCheapestMarketBuy(MAT, MARKET, ROYAL);
  assert.strictEqual(cae.city, "Caerleon");
  assert.notStrictEqual(royal.city, "Caerleon");
});

test("an in-section force with no book reports that city at price 0, not a fallback", () => {
  // The pin is the user's explicit pick, so it must not silently re-route; the
  // 0 is what makes the empty cell clickable to fix.
  __setTestCityForce({ [MAT]: { buy: "Bridgewatch" } });
  assert.deepStrictEqual(
    findCheapestMarketBuy(MAT, MARKET, ROYAL), { city: "Bridgewatch", price: 0 });
});

test("nothing priced in this section → no city", () => {
  __setTestCityForce({});
  assert.deepStrictEqual(
    findCheapestMarketBuy(MAT, MARKET, ["Smuggler's Den"]), { city: null, price: 0 });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
