/**
 * Test: a forced buy/sell city is honored only within its own section.
 *
 * Shared invariant for the two-section (royal vs Caerleon) profit tables that
 * each hand-roll their city selection: Quality Rerolling, Transmute,
 * Enchanting, and Consumables (breeding). They all use the same idiom — a
 * per-item city force is honored only when the forced city belongs to the
 * section currently being rendered. Royal and Caerleon city sets are disjoint,
 * so an edit in one section can no longer bleed into the other.
 *
 * (The rolling table has its own dedicated test, rolling-section-independence.)
 *
 * Run: node tests/section-force-guard.test.cjs
 */
const assert = require("assert");

const ROYAL = ["Thetford", "Fort Sterling", "Lymhurst", "Bridgewatch", "Martlock"];
const CAERLEON_BUY = ["Caerleon"];
const CAERLEON_SELL = ["Caerleon", "Black Market"];

// Mirror of the FIXED idioms used by the renderers:
//   buy:  if (forced && buyCities.includes(forced)) {…} else { scan buyCities }
//   sell: effectiveSellCities = forced && sellCities.includes(forced) ? [forced] : sellCities
// Both reduce to "consider only the forced city if it's in this section, else
// the section's full list".
function buyConsiders(forced, buyCities) {
  return forced && buyCities.includes(forced) ? [forced] : buyCities;
}
function sellConsiders(forced, sellCities) {
  return forced && sellCities.includes(forced) ? [forced] : sellCities;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.error(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Section force guard (rerolling / transmute / enchanting / consumables):");

// table-driven: [label, fn, forced, sectionCities, expected]
const cases = [
  // In-section force → pins to that one city
  ["buy: royal force honored in royal section", buyConsiders, "Martlock", ROYAL, ["Martlock"]],
  ["sell: Caerleon force honored in Caerleon section", sellConsiders, "Black Market", CAERLEON_SELL, ["Black Market"]],
  // Out-of-section force → IGNORED, falls back to the section's own cities
  ["buy: Caerleon force ignored in royal section", buyConsiders, "Caerleon", ROYAL, ROYAL],
  ["buy: royal force ignored in Caerleon section", buyConsiders, "Martlock", CAERLEON_BUY, CAERLEON_BUY],
  ["sell: royal force ignored in Caerleon section", sellConsiders, "Martlock", CAERLEON_SELL, CAERLEON_SELL],
  ["sell: Black Market force ignored in royal section", sellConsiders, "Black Market", ROYAL, ROYAL],
  // No force → full section list
  ["buy: no force → full royal list", buyConsiders, null, ROYAL, ROYAL],
  ["sell: no force → full Caerleon list", sellConsiders, null, CAERLEON_SELL, CAERLEON_SELL],
];
for (const [label, fn, forced, section, expected] of cases) {
  test(label, () => assert.deepStrictEqual(fn(forced, section), expected));
}

test("INVARIANT: one global force cannot pin BOTH sections to the same city", () => {
  const forced = "Martlock"; // a royal city
  assert.deepStrictEqual(sellConsiders(forced, ROYAL), ["Martlock"]); // royal honors it
  const cae = sellConsiders(forced, CAERLEON_SELL);
  assert.ok(!cae.includes("Martlock"), "Caerleon section must not pick up the royal force");
  assert.deepStrictEqual(cae, CAERLEON_SELL); // Caerleon keeps its own cities
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
