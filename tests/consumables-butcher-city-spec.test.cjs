/**
 * Test: butcher city specialization adds +10 PB for the bonus meat.
 *
 * Source: Albion Wiki "Local Production Bonus" (verified 2026-05-17 against
 * in-game tooltip at Elder's Butcher in Thetford):
 *   - Fort Sterling: Raw Chicken (T3) + Raw Mutton (T6)
 *   - Bridgewatch:   Raw Goat    (T4)
 *   - Lymhurst:      Raw Goose   (T5)
 *   - Thetford:      Raw Pork    (T7)   in-game: 21.8% RRR (no focus)
 *   - Martlock:      Raw Beef    (T8)
 *
 * Each bonus = +10 to Production Bonus -> RRR = PB / (100 + PB).
 * Cross-check: Raw Beef in Thetford (no bonus) shows 15.2% RRR in-game,
 * matching base PB=18 -> 0.18/1.18 = 0.15254.
 *
 * Run: node tests/consumables-butcher-city-spec.test.cjs
 */

const assert = require("assert");
const {
  CITY_BUTCHER_SPEC,
  BUTCHER_SPEC_BONUS,
  getButcherRRR,
  getCraftRRR,
  calcRRR,
  BASE_CITY_BONUS,
  FOCUS_BONUS,
  getOptimalButcherCity,
} = require("../js/calculations.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

console.log("\n=== Butcher city spec table ===");

const EXPECTED = {
  T3_MEAT: "Fort Sterling",
  T4_MEAT: "Bridgewatch",
  T5_MEAT: "Lymhurst",
  T6_MEAT: "Fort Sterling",
  T7_MEAT: "Thetford",
  T8_MEAT: "Martlock",
};

Object.entries(EXPECTED).forEach(([meatId, expectedCity]) => {
  test(`CITY_BUTCHER_SPEC[${expectedCity}] includes ${meatId}`, () => {
    const specs = CITY_BUTCHER_SPEC[expectedCity];
    assert.ok(
      Array.isArray(specs) && specs.includes(meatId),
      `expected ${expectedCity} -> includes ${meatId}; got ${JSON.stringify(specs)}`,
    );
  });
});

const ROYALS = ["Fort Sterling", "Bridgewatch", "Lymhurst", "Thetford", "Martlock", "Caerleon", "Brecilien"];
Object.entries(EXPECTED).forEach(([meatId, expectedCity]) => {
  ROYALS.forEach((c) => {
    if (c === expectedCity) return;
    test(`${c} does NOT boost ${meatId}`, () => {
      const specs = CITY_BUTCHER_SPEC[c] || [];
      assert.ok(!specs.includes(meatId),
        `${c} should not boost ${meatId}; got ${JSON.stringify(specs)}`);
    });
  });
});

test("BUTCHER_SPEC_BONUS = 0.10 (per wiki +10 PB)", () => {
  assert.strictEqual(BUTCHER_SPEC_BONUS, 0.10);
});

test("Caerleon and Brecilien have no butcher specs", () => {
  assert.ok(!CITY_BUTCHER_SPEC.Caerleon || CITY_BUTCHER_SPEC.Caerleon.length === 0);
  assert.ok(!CITY_BUTCHER_SPEC.Brecilien || CITY_BUTCHER_SPEC.Brecilien.length === 0);
});

console.log("\n=== getButcherRRR formula ===");

test("Thetford + T7_MEAT, no focus -> RRR 21.875% (matches in-game 21.8%)", () => {
  const rrr = getButcherRRR("Thetford", "T7_MEAT", false);
  assert.ok(Math.abs(rrr - calcRRR(BASE_CITY_BONUS + BUTCHER_SPEC_BONUS)) < 1e-9,
    `formula mismatch; got ${rrr}`);
  assert.ok(Math.abs(rrr - 0.21875) < 1e-4, `expected ~0.21875, got ${rrr}`);
});

test("Thetford + T8_MEAT (no spec), no focus -> base RRR 15.25% (matches in-game 15.2%)", () => {
  const rrr = getButcherRRR("Thetford", "T8_MEAT", false);
  assert.ok(Math.abs(rrr - calcRRR(BASE_CITY_BONUS)) < 1e-9);
  assert.ok(Math.abs(rrr - 0.18 / 1.18) < 1e-9);
});

test("Martlock + T8_MEAT, no focus -> RRR 21.875% (cow bonus)", () => {
  const rrr = getButcherRRR("Martlock", "T8_MEAT", false);
  assert.ok(Math.abs(rrr - calcRRR(BASE_CITY_BONUS + BUTCHER_SPEC_BONUS)) < 1e-9);
});

test("Bridgewatch + T4_MEAT, no focus -> RRR 21.875% (goat bonus)", () => {
  const rrr = getButcherRRR("Bridgewatch", "T4_MEAT", false);
  assert.ok(Math.abs(rrr - calcRRR(BASE_CITY_BONUS + BUTCHER_SPEC_BONUS)) < 1e-9);
});

test("Lymhurst + T5_MEAT, no focus -> RRR 21.875% (goose bonus)", () => {
  const rrr = getButcherRRR("Lymhurst", "T5_MEAT", false);
  assert.ok(Math.abs(rrr - calcRRR(BASE_CITY_BONUS + BUTCHER_SPEC_BONUS)) < 1e-9);
});

test("Fort Sterling + T3_MEAT, no focus -> RRR 21.875% (chicken bonus)", () => {
  const rrr = getButcherRRR("Fort Sterling", "T3_MEAT", false);
  assert.ok(Math.abs(rrr - calcRRR(BASE_CITY_BONUS + BUTCHER_SPEC_BONUS)) < 1e-9);
});

test("Fort Sterling + T6_MEAT, no focus -> RRR 21.875% (mutton bonus - FS has two)", () => {
  const rrr = getButcherRRR("Fort Sterling", "T6_MEAT", false);
  assert.ok(Math.abs(rrr - calcRRR(BASE_CITY_BONUS + BUTCHER_SPEC_BONUS)) < 1e-9);
});

test("Fort Sterling + T8_MEAT (no FS bonus), no focus -> base RRR only", () => {
  const rrr = getButcherRRR("Fort Sterling", "T8_MEAT", false);
  assert.ok(Math.abs(rrr - calcRRR(BASE_CITY_BONUS)) < 1e-9);
});

console.log("\n=== With focus (+59 PB) ===");

test("Thetford + T7_MEAT, focus on -> RRR 46.5% (PB 87)", () => {
  const rrr = getButcherRRR("Thetford", "T7_MEAT", true);
  assert.ok(Math.abs(rrr - calcRRR(BASE_CITY_BONUS + BUTCHER_SPEC_BONUS + FOCUS_BONUS)) < 1e-9);
  assert.ok(Math.abs(rrr - 87 / 187) < 1e-9, `expected 87/187, got ${rrr}`);
});

test("Thetford + T8_MEAT (no spec), focus on -> RRR 43.5% (base+focus only, PB 77)", () => {
  const rrr = getButcherRRR("Thetford", "T8_MEAT", true);
  assert.ok(Math.abs(rrr - calcRRR(BASE_CITY_BONUS + FOCUS_BONUS)) < 1e-9);
  assert.ok(Math.abs(rrr - 77 / 177) < 1e-9);
});

test("Martlock + T8_MEAT, focus on -> RRR 46.5%", () => {
  const rrr = getButcherRRR("Martlock", "T8_MEAT", true);
  assert.ok(Math.abs(rrr - 87 / 187) < 1e-9);
});

console.log("\n=== Edge cases ===");

test("non-meat id (fish chops) -> base RRR only", () => {
  const rrr = getButcherRRR("Lymhurst", "T1_FISHCHOPS", false);
  assert.ok(Math.abs(rrr - calcRRR(BASE_CITY_BONUS)) < 1e-9);
});

test("synthetic fishchops sub-id -> base RRR only (no spec match)", () => {
  const rrr = getButcherRRR("Lymhurst", "T1_FISHCHOPS__T7_FISH_FRESHWATER_FOREST_RARE", false);
  assert.ok(Math.abs(rrr - calcRRR(BASE_CITY_BONUS)) < 1e-9);
});

test("null meatId -> base RRR only (no crash)", () => {
  const rrr = getButcherRRR("Lymhurst", null, false);
  assert.ok(Math.abs(rrr - calcRRR(BASE_CITY_BONUS)) < 1e-9);
});

test("undefined city -> base RRR (no crash)", () => {
  const rrr = getButcherRRR(undefined, "T7_MEAT", false);
  assert.ok(Math.abs(rrr - calcRRR(BASE_CITY_BONUS)) < 1e-9);
});

test("Unknown city -> base RRR only (no crash)", () => {
  const rrr = getButcherRRR("Atlantis", "T7_MEAT", false);
  assert.ok(Math.abs(rrr - calcRRR(BASE_CITY_BONUS)) < 1e-9);
});

console.log("\n=== getButcherRRR vs getCraftRRR — divergence ===");

test("butcher in bonus city > craft RRR (which can't see meat spec)", () => {
  const butcher = getButcherRRR("Thetford", "T7_MEAT", false);
  const craft = getCraftRRR("Thetford", null, false);
  assert.ok(butcher > craft,
    `butcher (${butcher}) should exceed plain craft (${craft}) when meat spec applies`);
});

test("butcher in non-bonus city == craft RRR (no spec applies)", () => {
  const butcher = getButcherRRR("Thetford", "T8_MEAT", false);
  const craft = getCraftRRR("Thetford", null, false);
  assert.strictEqual(butcher, craft,
    "without a meat spec match, butcher RRR should equal the base craft RRR");
});

console.log("\n=== getOptimalButcherCity ===");

const ROYAL = ["Fort Sterling", "Bridgewatch", "Lymhurst", "Thetford", "Martlock"];

test("T7 pork in royal pool -> Thetford (spec city wins over buy city)", () => {
  assert.strictEqual(getOptimalButcherCity("T7_MEAT", ROYAL, "Bridgewatch"), "Thetford");
});

test("T5 goose in royal pool -> Lymhurst", () => {
  assert.strictEqual(getOptimalButcherCity("T5_MEAT", ROYAL, "Bridgewatch"), "Lymhurst");
});

test("T3 chicken in royal pool -> Fort Sterling (FS owns chicken even though it also owns mutton)", () => {
  assert.strictEqual(getOptimalButcherCity("T3_MEAT", ROYAL, "Lymhurst"), "Fort Sterling");
});

test("T6 mutton in royal pool -> Fort Sterling (FS's second meat)", () => {
  assert.strictEqual(getOptimalButcherCity("T6_MEAT", ROYAL, "Thetford"), "Fort Sterling");
});

test("Caerleon-only pool -> fallback (no royal spec city available)", () => {
  assert.strictEqual(getOptimalButcherCity("T7_MEAT", ["Caerleon"], "Caerleon"), "Caerleon");
});

test("Fish chops (non-meat) -> fallback (no spec exists)", () => {
  assert.strictEqual(getOptimalButcherCity("T1_FISHCHOPS", ROYAL, "Lymhurst"), "Lymhurst");
});

test("Spec city not in pool -> fallback (e.g. pork but Thetford excluded)", () => {
  const noThetford = ["Fort Sterling", "Bridgewatch", "Lymhurst", "Martlock"];
  assert.strictEqual(getOptimalButcherCity("T7_MEAT", noThetford, "Lymhurst"), "Lymhurst");
});

test("null meatId -> fallback (no crash)", () => {
  assert.strictEqual(getOptimalButcherCity(null, ROYAL, "Lymhurst"), "Lymhurst");
});

test("Empty city pool -> fallback (no crash)", () => {
  assert.strictEqual(getOptimalButcherCity("T7_MEAT", [], "Lymhurst"), "Lymhurst");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
