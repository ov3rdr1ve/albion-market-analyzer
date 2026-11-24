/**
 * Test: chain-craft rows claim their city production bonus.
 *
 * The consumables chain-craft branch used to call getCraftRRR(city, null, …) —
 * craftType hard-coded null — so a mill/cook/alchemist row never picked up any
 * CITY_CRAFT_SPEC bonus. Flour, bread and butter are craftingcategory="food"
 * and ride Caerleon's +15% "food" bonus.
 *
 * ALCOHOL rides nothing. Its Destiny Board node (FARM_ALCHEMIST_ALCOHOL,
 * "Bootlegger", ring 9) is on the POTION branch, yet Brecilien's potion +15%
 * does not apply: verified in-game 2026-08-26, brewing Potato Schnapps in
 * Brecilien reads the base 15.2% RRR (18 PB). A potion-branch item has no claim
 * on Caerleon's "food" bonus either, so alchemist maps to null — claiming an
 * unobserved bonus would overstate every schnapps row.
 *
 * Butcher rows are excluded for a different reason — they carry their own
 * per-meat spec through CITY_BUTCHER_SPEC/getButcherRRR.
 *
 * Black box over js/calculations.js: getChainCraftType maps a CHAIN_RECIPES
 * station to a CITY_CRAFT_SPEC category, getOptimalCraftCity picks the city in
 * the pool that pays for it (mirroring getOptimalButcherCity), and getCraftRRR
 * turns that into a higher return rate.
 *
 * Run: node tests/chain-craft-city-bonus.test.cjs
 */

const assert = require("assert");
const {
  getChainCraftType,
  getOptimalCraftCity,
  getOptimalButcherCity,
  getCraftRRR,
} = require("../js/calculations.js");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

const ROYAL_CITIES = [
  "Lymhurst", "Bridgewatch", "Martlock", "Thetford", "Fort Sterling", "Caerleon", "Brecilien",
];
const NO_BONUS_CITY = "Lymhurst"; // specializes in neither "food" nor "potion"

// station → { craftType it crafts under, city that pays the +15% }
const STATION_CASES = [
  { station: "alchemist", craftType: null,     bonusCity: null },
  { station: "mill",      craftType: "food",   bonusCity: "Caerleon" },
  { station: "cook",      craftType: "food",   bonusCity: "Caerleon" },
  { station: "butcher",   craftType: null,     bonusCity: null },
  { station: undefined,   craftType: null,     bonusCity: null },
];

console.log("\n=== getChainCraftType ===");
STATION_CASES.forEach(({ station, craftType }) => {
  test(`${String(station)} → ${String(craftType)}`, () => {
    assert.strictEqual(getChainCraftType(station), craftType);
  });
});

console.log("\n=== getOptimalCraftCity ===");
STATION_CASES.filter((c) => c.bonusCity).forEach(({ station, craftType, bonusCity }) => {
  test(`${station}: picks ${bonusCity} out of the full royal pool`, () => {
    assert.strictEqual(
      getOptimalCraftCity(craftType, ROYAL_CITIES, NO_BONUS_CITY),
      bonusCity,
    );
  });

  test(`${station}: falls back when ${bonusCity} is not reachable`, () => {
    const pool = ROYAL_CITIES.filter((c) => c !== bonusCity);
    assert.strictEqual(
      getOptimalCraftCity(craftType, pool, NO_BONUS_CITY),
      NO_BONUS_CITY,
    );
  });
});

test("alcohol pays base RRR in EVERY city — no bonus anywhere", () => {
  // The exact in-game regression: schnapps brewed in Brecilien pays base 18 PB
  // despite sitting on the potion branch of the Destiny Board.
  const ct = getChainCraftType("alchemist");
  assert.strictEqual(ct, null);
  ROYAL_CITIES.forEach((city) => {
    [true, false].forEach((useFocus) => {
      assert.strictEqual(
        getCraftRRR(city, ct, useFocus),
        getCraftRRR(NO_BONUS_CITY, ct, useFocus),
        `${city} must not beat ${NO_BONUS_CITY} on alcohol (focus ${useFocus})`,
      );
    });
  });
});

test("mill/cook still ride Caerleon; alchemist does not", () => {
  assert.strictEqual(getOptimalCraftCity(getChainCraftType("mill"), ROYAL_CITIES, NO_BONUS_CITY), "Caerleon");
  assert.strictEqual(getOptimalCraftCity(getChainCraftType("cook"), ROYAL_CITIES, NO_BONUS_CITY), "Caerleon");
  assert.strictEqual(getOptimalCraftCity(getChainCraftType("alchemist"), ROYAL_CITIES, NO_BONUS_CITY), NO_BONUS_CITY);
});

test("a null craftType (butcher) always falls back", () => {
  assert.strictEqual(getOptimalCraftCity(null, ROYAL_CITIES, NO_BONUS_CITY), NO_BONUS_CITY);
});

test("an empty city pool falls back", () => {
  assert.strictEqual(getOptimalCraftCity("food", [], NO_BONUS_CITY), NO_BONUS_CITY);
});

console.log("\n=== the bonus actually raises the return rate ===");
STATION_CASES.filter((c) => c.bonusCity).forEach(({ station, craftType, bonusCity }) => {
  [true, false].forEach((useFocus) => {
    test(`${station} in ${bonusCity} beats ${NO_BONUS_CITY} (focus ${useFocus ? "on" : "off"})`, () => {
      const bonus = getCraftRRR(bonusCity, craftType, useFocus);
      const plain = getCraftRRR(NO_BONUS_CITY, craftType, useFocus);
      assert.ok(bonus > plain, `${bonus} should exceed ${plain}`);
    });
  });

  test(`${station}: dropping the craftType loses the ${bonusCity} bonus`, () => {
    // The exact regression: craftType null → the bonus city reads like any other.
    assert.strictEqual(
      getCraftRRR(bonusCity, null, false),
      getCraftRRR(NO_BONUS_CITY, null, false),
    );
  });
});

console.log("\n=== butcher rows are untouched by this path ===");
test("meat still routes through getOptimalButcherCity, not getOptimalCraftCity", () => {
  // T6_MEAT's spec city is a butcher spec, invisible to CITY_CRAFT_SPEC.
  const viaCraft = getOptimalCraftCity(getChainCraftType("butcher"), ROYAL_CITIES, NO_BONUS_CITY);
  assert.strictEqual(viaCraft, NO_BONUS_CITY);
  const viaButcher = getOptimalButcherCity("T6_MEAT", ROYAL_CITIES, NO_BONUS_CITY);
  assert.notStrictEqual(viaButcher, NO_BONUS_CITY);
});

// ── Summary ──
console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
