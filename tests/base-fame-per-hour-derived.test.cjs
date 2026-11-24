/**
 * Test: base fame per hour is DERIVED, not guessed (js/gather-fame-rates.js).
 *
 * The repo already tunes how much you gather per hour (GATHER_UNITS_PER_HOUR /
 * FISH_UNITS_PER_HOUR). How much FAME that is per hour is then arithmetic, not a
 * second free guess — items.xml publishes the fame each unit/catch is worth:
 *
 *   land  <… famevalue="…">      T2 1.5 · T3 3 · T4 7.5 · T5 22.5 · T6 45
 *                                T7 75 · T8 150, doubling per enchant level
 *                                (T7_ORE 75/150/300/600/1200)
 *   fish  <… fishingfame="…">    T7 common 100, T7 rare 300, T8 common 140
 *
 * Both match the Albion wiki tables ("Journal" fame-per-resource; the fishing
 * values × 1.5 premium reproduce a player's logged in-game readings exactly),
 * so items.xml is taken as truth here.
 *
 * THE RULE THAT IS ALWAYS MISREAD: fishing fame is awarded PER CATCH, not per
 * fish — one catch of Danglemouth Catfish is 100 base fame whether it lands one
 * fish or five. FISH_UNITS_PER_HOUR counts FISH, so it has to be divided by
 * FISH_PER_CATCH before multiplying by the per-catch fame.
 *
 * Anchor: a forum fill-rate log (2.5 h of black-zone T5-T7 fishing filled 36
 * T2 Fisherman's Journals = 25,920 base fame) puts real throughput at ~10,368
 * base fame/hour, which the derived high-tier fishing rates must bracket.
 *
 * Black-box: pure input→output over the exported tables, no DOM, no live API.
 *
 * Run: node tests/base-fame-per-hour-derived.test.cjs
 */

const assert = require("assert");

const {
  GATHER_UNITS_PER_HOUR,
  FISH_UNITS_PER_HOUR,
  FISH_RARE_SHARE,
  ZONE_ENCHANT_RATE,
  getEnchantDist,
  fishingRareTier,
} = require("../js/data-gathering.js");

const {
  GATHER_FAME_PER_UNIT,
  FISH_FAME_PER_CATCH_COMMON,
  FISH_FAME_PER_CATCH_RARE,
  FISH_PER_CATCH,
  enchantFameMultiplier,
  GATHER_BASE_FAME_PER_HOUR,
  FISH_BASE_FAME_PER_HOUR,
} = require("../js/gather-fame-rates.js");

// data-journals.js must keep serving the same two tables under the same names.
const journals = require("../js/data-journals.js");

const TIERS = [2, 3, 4, 5, 6, 7, 8];
// items.xml famevalue, cross-checked identical for ORE / WOOD / HIDE / FIBER / ROCK.
const ITEMS_XML_FAME_PER_UNIT = { 2: 1.5, 3: 3, 4: 7.5, 5: 22.5, 6: 45, 7: 75, 8: 150 };
// items.xml fishingfame on T{n}_FISH_{FRESH,SALT}WATER_ALL_COMMON.
const ITEMS_XML_FISHING_FAME = { 2: 20, 3: 30, 4: 40, 5: 60, 6: 80, 7: 100, 8: 140 };
// items.xml fishingfame on the biome rares (they only exist at T3/T5/T7).
const ITEMS_XML_FISHING_FAME_RARE = { 3: 100, 5: 200, 7: 300 };
// Forum measurement, base fame per hour (premium excluded).
const MEASURED_FISH_FAME_PER_HOUR = 10368;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
function approx(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label || ""} expected ~${expected}, got ${actual} (tolerance ${tolerance})`);
}

console.log("Derived Base Fame Per Hour Tests\n");

// ── The per-unit tables are items.xml verbatim. ───────────────────────────
TIERS.forEach((tier) => {
  test(`T${tier} land fame/unit matches items.xml famevalue`, () => {
    assert.strictEqual(GATHER_FAME_PER_UNIT[tier], ITEMS_XML_FAME_PER_UNIT[tier]);
  });
  test(`T${tier} common fish fame/catch matches items.xml fishingfame`, () => {
    assert.strictEqual(FISH_FAME_PER_CATCH_COMMON[tier], ITEMS_XML_FISHING_FAME[tier]);
  });
});

[3, 5, 7].forEach((tier) => {
  test(`T${tier} RARE fish fame/catch matches items.xml fishingfame`, () => {
    assert.strictEqual(FISH_FAME_PER_CATCH_RARE[tier], ITEMS_XML_FISHING_FAME_RARE[tier]);
  });
});

// ── Enchant multiplier: fame doubles per enchant level. ───────────────────
test("below the enchant tier the multiplier is exactly 1", () => {
  [2, 3].forEach((tier) => assert.strictEqual(enchantFameMultiplier(tier), 1));
});

test("enchant multiplier = Σ share × 2^level, flat share included", () => {
  [4, 5, 6, 7, 8].forEach((tier) => {
    const dist = getEnchantDist(tier);
    const enchanted = [1, 2, 3, 4].reduce((sum, k) => sum + dist[k], 0);
    const expected = (1 - enchanted)
      + [1, 2, 3, 4].reduce((sum, k) => sum + dist[k] * Math.pow(2, k), 0);
    approx(enchantFameMultiplier(tier), expected, 1e-9, `T${tier}`);
  });
});

test("at the default black-zone rate the multiplier is ~1.277", () => {
  assert.strictEqual(ZONE_ENCHANT_RATE, 0.20);
  approx(enchantFameMultiplier(8), 1.277, 0.001);
});

// ── Land: units/hour × fame/unit × enchant multiplier. ────────────────────
TIERS.forEach((tier) => {
  test(`T${tier} land fame/hour = units × fame/unit × enchant mix`, () => {
    const expected = GATHER_UNITS_PER_HOUR[tier]
      * GATHER_FAME_PER_UNIT[tier]
      * enchantFameMultiplier(tier);
    approx(GATHER_BASE_FAME_PER_HOUR[tier], expected, 1, `T${tier}`);
  });
});

test("land fame/hour rises monotonically with tier", () => {
  for (let i = 1; i < TIERS.length; i++) {
    const lo = GATHER_BASE_FAME_PER_HOUR[TIERS[i - 1]];
    const hi = GATHER_BASE_FAME_PER_HOUR[TIERS[i]];
    assert.ok(hi > lo, `T${TIERS[i]} (${hi}) should exceed T${TIERS[i - 1]} (${lo})`);
  }
});

// ── Fish: fame is PER CATCH, so divide the fish rate by FISH_PER_CATCH. ───
test("FISH_PER_CATCH is the fish-per-landed-catch figure, not 1", () => {
  assert.ok(FISH_PER_CATCH >= 2 && FISH_PER_CATCH <= 4,
    `expected 2-4 fish per catch, got ${FISH_PER_CATCH}`);
});

TIERS.forEach((tier) => {
  test(`T${tier} fish fame/hour = catches × blended per-catch fame`, () => {
    const rareTier = fishingRareTier(tier);
    const rareFame = rareTier ? FISH_FAME_PER_CATCH_RARE[rareTier] : 0;
    const share = rareTier ? FISH_RARE_SHARE : 0;
    const perCatch = (1 - share) * FISH_FAME_PER_CATCH_COMMON[tier] + share * rareFame;
    const expected = (FISH_UNITS_PER_HOUR[tier] / FISH_PER_CATCH) * perCatch;
    approx(FISH_BASE_FAME_PER_HOUR[tier], expected, 1, `T${tier}`);
  });
});

test("T2 fishing has no rare band, so its rate is the flat common fame", () => {
  assert.strictEqual(fishingRareTier(2), null);
  const expected = (FISH_UNITS_PER_HOUR[2] / FISH_PER_CATCH) * FISH_FAME_PER_CATCH_COMMON[2];
  approx(FISH_BASE_FAME_PER_HOUR[2], expected, 1);
});

test("high-tier fishing brackets the measured 10,368 base fame/hour", () => {
  const high = [7, 8].map((t) => FISH_BASE_FAME_PER_HOUR[t]);
  high.forEach((rate, i) => {
    const tier = [7, 8][i];
    const drift = Math.abs(rate - MEASURED_FISH_FAME_PER_HOUR) / MEASURED_FISH_FAME_PER_HOUR;
    assert.ok(drift <= 0.15,
      `T${tier} ${rate}/h drifts ${(drift * 100).toFixed(1)}% from the measured ${MEASURED_FISH_FAME_PER_HOUR}/h`);
  });
});

test("fishing is slower per hour than land gathering at every tier ≥ 5", () => {
  [5, 6, 7, 8].forEach((tier) => {
    assert.ok(FISH_BASE_FAME_PER_HOUR[tier] < GATHER_BASE_FAME_PER_HOUR[tier],
      `T${tier}: fish ${FISH_BASE_FAME_PER_HOUR[tier]} should be under land ${GATHER_BASE_FAME_PER_HOUR[tier]}`);
  });
});

// ── data-journals.js keeps serving them under the same names. ─────────────
test("data-journals re-exports the derived tables unchanged", () => {
  TIERS.forEach((tier) => {
    assert.strictEqual(journals.GATHER_BASE_FAME_PER_HOUR[tier], GATHER_BASE_FAME_PER_HOUR[tier]);
    assert.strictEqual(journals.FISH_BASE_FAME_PER_HOUR[tier], FISH_BASE_FAME_PER_HOUR[tier]);
  });
});

test("getBaseFamePerHour routes fish to the fish table, everything else to land", () => {
  TIERS.forEach((tier) => {
    assert.strictEqual(journals.getBaseFamePerHour("fish", tier), FISH_BASE_FAME_PER_HOUR[tier]);
    ["ore", "wood", "hide", "fiber", "rock", "general"].forEach((type) =>
      assert.strictEqual(journals.getBaseFamePerHour(type, tier), GATHER_BASE_FAME_PER_HOUR[tier]));
  });
});

test("unknown tiers return 0, never NaN or undefined", () => {
  [0, 1, 9, null, undefined].forEach((tier) => {
    assert.strictEqual(journals.getBaseFamePerHour("ore", tier), 0);
    assert.strictEqual(journals.getBaseFamePerHour("fish", tier), 0);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
