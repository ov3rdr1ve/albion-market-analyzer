/**
 * Test: crafting's forced MATERIAL buy city is honored only when zone-compatible
 * with the craft city (royal vs Caerleon under BMR-off).
 *
 * Bug: render-crafting.js honored a per-item material buy-city force
 * unconditionally, so a force at a royal city also applied to the
 * Caerleon-craft row (and vice versa) — an impossible "buy royal, craft
 * Caerleon" cross-zone route. The mount MAIN craft loop already had this gate
 * (render-mounts.js, covered by city-force-respected.test.cjs); crafting did
 * not. This adds the same `matForceValid` zone-equality guard to crafting.
 *
 * The mount breeding *feed* and *saddler* material lookups are now section-
 * scoped too (a pin is honored only within its section): the feed cases live in
 * breeding-metadata-and-row.test.cjs, and the saddler shares the same
 * matCitySearch.includes guard exercised by section-force-guard.test.cjs.
 *
 * Run: node tests/craft-mat-zone-force.test.cjs
 */
const assert = require("assert");

// Mirror of crafting's main-loop guard (render-crafting.js):
//   matForceValid = forced && (BMR || (forced===Caerleon) === (craft===Caerleon))
function craftForceHonored(forced, craftCity, bmr) {
  return !!(
    forced &&
    (bmr || (forced === "Caerleon") === (craftCity === "Caerleon"))
  );
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.error(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Crafting material-buy force zone-gate:");
// [label, forced, craftCity, bmr, expectedHonored]
const cases = [
  ["royal force + royal craft (same zone) honored", "Lymhurst", "Bridgewatch", false, true],
  ["Caerleon force + Caerleon craft honored", "Caerleon", "Caerleon", false, true],
  ["royal force + Caerleon craft IGNORED (cross-zone)", "Lymhurst", "Caerleon", false, false],
  ["Caerleon force + royal craft IGNORED (cross-zone)", "Caerleon", "Lymhurst", false, false],
  ["BMR on: any force honored (one realm)", "Caerleon", "Lymhurst", true, true],
  ["no force → not honored", null, "Lymhurst", false, false],
];
for (const [label, forced, craft, bmr, exp] of cases) {
  test(label, () => assert.strictEqual(craftForceHonored(forced, craft, bmr), exp));
}

test("INVARIANT: a single royal force can't pin BOTH the royal and Caerleon craft rows", () => {
  const forced = "Martlock"; // royal
  assert.strictEqual(craftForceHonored(forced, "Lymhurst", false), true);   // royal craft honors it
  assert.strictEqual(craftForceHonored(forced, "Caerleon", false), false);  // Caerleon craft ignores it
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
