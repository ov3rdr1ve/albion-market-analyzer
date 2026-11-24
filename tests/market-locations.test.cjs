/**
 * Tests for mapping the game's own location ids onto the app's city names.
 *
 * The wire reports the cluster you are standing in ("3005", "0007",
 * "3013-Auction2"), never a display name. The Albion Online Data Project
 * canonicalises those before storing them, and the app has to agree with that
 * mapping or a sniffed price would land in a different city bucket than the
 * scanned price for the same market.
 *
 * Rules pinned here come from ao-data/albiondata-models-dotNet Locations.cs and
 * albiondata-deduper-dotNet Program.cs:
 *   - the five "Into the Fray" portal towns share their city's market,
 *   - Caerleon2 (3013) is the same market as Caerleon (3005),
 *   - anything that is not a royal/Brecilien market has no app city.
 *
 * Run: node tests/market-locations.test.cjs
 */

const assert = require("assert");
const {
  normalizeMarketLocationId, marketCityName, AODP_LOCATIONS,
} = require("../js/market-locations.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// ── canonical id ───────────────────────────────────────────────────────────
const NORMALIZE_CASES = [
  ["0007", 7],          // zero-padded on the wire
  ["7", 7],
  [7, 7],
  ["1002", 1002],
  ["2004", 2004],
  ["3005", 3005],
  ["3008", 3008],
  ["4002", 4002],
  ["5003", 5003],
  ["3003", 3003],       // Black Market
  ["3013", 3005],       // Caerleon 2 is the same market
  ["3013-Auction2", 3005],
  ["0301", 7],          // Thetford Portal town
  ["1301", 1002],       // Lymhurst Portal
  ["2301", 2004],       // Bridgewatch Portal
  ["3301", 3008],       // Martlock Portal
  ["4301", 4002],       // Fort Sterling Portal
  ["TNL-022", null],    // a roads zone is not a market
  ["BLACKBANK-3005", null],
  ["", null],
  [null, null],
  [undefined, null],
];
NORMALIZE_CASES.forEach(([input, want]) => {
  test(`normalizeMarketLocationId(${JSON.stringify(input)}) = ${want}`, () => {
    assert.strictEqual(normalizeMarketLocationId(input), want);
  });
});

// ── city name ──────────────────────────────────────────────────────────────
const CITY_CASES = [
  ["0007", "Thetford"],
  ["1002", "Lymhurst"],
  ["2004", "Bridgewatch"],
  ["3005", "Caerleon"],
  ["3013-Auction2", "Caerleon"],
  ["3008", "Martlock"],
  ["4002", "Fort Sterling"],
  ["5003", "Brecilien"],
  ["3003", "Black Market"],
  ["4301", "Fort Sterling"],
  ["0004", null],          // Swamp Cross — a rest, not a city the app prices
  ["TNL-022", null],
  ["9999", null],
  [null, null],
];
CITY_CASES.forEach(([input, want]) => {
  test(`marketCityName(${JSON.stringify(input)}) = ${JSON.stringify(want)}`, () => {
    assert.strictEqual(marketCityName(input), want);
  });
});

test("every mapped city name is one the app already prices", () => {
  const appCities = [
    "Caerleon", "Black Market", "Lymhurst", "Fort Sterling", "Thetford",
    "Martlock", "Bridgewatch", "Brecilien",
  ];
  Object.values(AODP_LOCATIONS).forEach((name) => {
    assert.ok(appCities.includes(name), `unexpected city: ${name}`);
  });
});

test("the mapping covers all eight priced markets", () => {
  const names = new Set(Object.values(AODP_LOCATIONS));
  assert.strictEqual(names.size, 8);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
