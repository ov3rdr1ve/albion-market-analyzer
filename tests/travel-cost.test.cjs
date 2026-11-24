/**
 * Test: Brecilien Travel Planner cost helper (js/travel-cost.js).
 *
 * Domain rule: the ONLY way to move tradeable goods OUT of Brecilien is the
 * Travel Planner, which charges silver by weight. Bringing goods INTO Brecilien
 * is free. So a transport leg incurs a fee only when its ORIGIN is Brecilien
 * and its DESTINATION is a different city.
 *
 * In-game formula (Albion wiki): cost = RATE * weight(kg) * fasttravelfactor * distance.
 * Brecilien counts as 2 city distances, then a Gold Market Stabilization
 * surcharge (1.156). The rate was 150 until the planner charge jumped ~33% at
 * a gold price that had barely moved; it is now pinned at 200 against the
 * observed 23.12 silver charge for 1 × T4_RELIC (read in-game 2026-07-29).
 * Every other in-game anchor below is rescaled by the same 200/150 — they were
 * all measured under the old rate. Non-tradable items are free (out of scope
 * here — the calculator only deals in tradeable market items).
 *
 * Verified items.xml facts used as fixtures:
 *   - Resource fasttravelfactor doubles with BOTH tier and enchant level,
 *     capped at 256: ftf = min(256, 2^(tier-3+enchant)). E.g. T4.0=2, T4.1=4,
 *     T4.2=8, T5.0=4, T6.1=16, T8.2=128 (uniform across every resource family).
 *     Weight is enchant-invariant (T4 = 0.51 at every enchant). Item quality
 *     affects neither weight nor TCM.
 *   - T5_MEAL_SOUP (food):        weight 7.56, fasttravelfactor 1 (absent attr).
 *
 * Pattern: black-box, parameterised. We exercise the public contract only
 * (no internals). Weight-table lookups are driven by injecting the same
 * globals the browser build defines (ITEM_WEIGHTS / ITEM_FT_FACTORS), then
 * the formula fallback is tested with those globals cleared.
 *
 * Run: node tests/travel-cost.test.cjs
 */

const assert = require("assert");

// ── module under test ───────────────────────────────────────────────────
const tc = require("../js/travel-cost.js");

const RATE = 200; // silver per kg (TRAVEL_PLANNER_RATE), was 150 before 2026-07-29
const DIST = 2; // Brecilien distance factor
const GMS = 1.156; // Gold Market Stabilization default (GOLD_MARKET_STABILIZATION)

// ── tiny harness (mirrors tests/brecilien-safe-route.test.cjs) ────────────
let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name} — ${e.message}`);
  }
}
function approx(actual, expected, eps = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${expected}, got ${actual}`,
  );
}

// Reset injected globals between groups.
function clearWeightGlobals() {
  delete global.ITEM_WEIGHTS;
  delete global.ITEM_FT_FACTORS;
}

console.log("Brecilien Travel Planner Cost Tests\n");

// ── constants ─────────────────────────────────────────────────────────────
test("exposes raw-formula constants (200/kg, distance 2, GMS 1.156)", () => {
  assert.strictEqual(tc.TRAVEL_PLANNER_RATE, RATE);
  assert.strictEqual(tc.BRECILIEN_DISTANCE, DIST);
  assert.strictEqual(tc.GOLD_MARKET_STABILIZATION, GMS);
});

// ── fasttravelfactor: enchant-0 baseline by tier (T2/T3=1, then doubling —
//    T4=2, T5=4, T6=8, T7=16, T8=32), finished goods = 1 ───────────────────
// Verified against items.xml; the schedule is uniform across every resource
// family. Enchant scaling is covered separately below.
clearWeightGlobals();
const RES_FT_BY_TIER = { 2: 1, 3: 1, 4: 2, 5: 4, 6: 8, 7: 16, 8: 32 };
[
  ["T2_ORE", 1], ["T3_PLANKS", 1], ["T4_ORE", 2], ["T4_METALBAR", 2], ["T4_STONEBLOCK", 2],
  ["T5_FIBER", 4], ["T5_LEATHER", 4], ["T6_WOOD", 8], ["T6_CLOTH", 8], ["T7_ROCK", 16],
  ["T8_HIDE", 32], ["T8_PLANKS", 32],
].forEach(([id, ftf]) => {
  test(`fasttravelfactor(${id}) = ${ftf} (resource per-tier schedule)`, () => {
    assert.strictEqual(tc.getItemFastTravelFactor(id), ftf);
  });
});

// Every resource family shares the same per-tier schedule.
["WOOD", "ORE", "FIBER", "HIDE", "ROCK", "PLANKS", "METALBAR", "CLOTH", "LEATHER", "STONEBLOCK"].forEach((fam) => {
  [2, 3, 4, 5, 6, 7, 8].forEach((tier) => {
    test(`fasttravelfactor(T${tier}_${fam}) = ${RES_FT_BY_TIER[tier]}`, () => {
      assert.strictEqual(tc.getItemFastTravelFactor(`T${tier}_${fam}`), RES_FT_BY_TIER[tier]);
    });
  });
});

["T5_CAPE", "T5_BAG", "T4_POTION_HEAL", "T5_MEAL_SOUP", "T4_MAIN_SWORD", "T6_CARROT"].forEach((id) => {
  test(`fasttravelfactor(${id}) = 1 (finished/default)`, () => {
    assert.strictEqual(tc.getItemFastTravelFactor(id), 1);
  });
});

// Enchant scales the TCM: ftf doubles per enchant level (read from @N / _LEVELN
// on the raw id), capped at 256. So T5.2 metalbar → 2^(5-3+2) = 16, NOT 4.
[
  ["T4_WOOD", 2], ["T4_WOOD_LEVEL1@1", 4], ["T4_WOOD_LEVEL2@2", 8],
  ["T4_WOOD_LEVEL3@3", 16], ["T4_WOOD_LEVEL4@4", 32],
  ["T5_METALBAR@2", 16], ["T5_METALBAR_LEVEL2@2", 16], ["T6_PLANKS_LEVEL1@1", 16],
  ["T8_ORE_LEVEL2@2", 128], ["T8_ORE_LEVEL3@3", 256], ["T8_ORE_LEVEL4@4", 256], // cap 256
].forEach(([id, ftf]) => {
  test(`fasttravelfactor(${id}) = ${ftf} (tier+enchant schedule)`, () => {
    assert.strictEqual(tc.getItemFastTravelFactor(id), ftf);
  });
});

// Weight is enchant-invariant — only the TCM moves with enchant.
test("resource weight ignores enchant (T4_WOOD_LEVEL2@2 == T4_WOOD == 0.51)", () => {
  approx(tc.getItemWeight("T4_WOOD_LEVEL2@2"), 0.51, 0.005);
  approx(tc.getItemWeight("T4_WOOD"), 0.51, 0.005);
});

// Regression (user-reported): the T4.2 plank Brecilien fee must reflect the .2
// enchant. One T4.2 log exits at 200*0.51*8*2*GMS ≈ 1887; refining one plank
// hauls 2 logs ≈ 2830. The old flat ftf=4 undercounted this (~707/log, so the
// 2-log haul read ~1422 instead of ~2830).
test("fasttravelfactor(T4_PLANKS_LEVEL2@2) = 8 (enchant 2, not base-tier 2)", () => {
  assert.strictEqual(tc.getItemFastTravelFactor("T4_PLANKS_LEVEL2@2"), 8);
});
test("brecilienExitCostPerUnit(T4_PLANKS) = 200*0.51*2*2*GMS ≈ 471.65 (enchant 0)", () => {
  approx(tc.brecilienExitCostPerUnit("T4_PLANKS"), RATE * 0.51 * 2 * 2 * GMS, 0.5);
});
test("brecilienExitCostPerUnit(T4_PLANKS_LEVEL2@2) = 200*0.51*8*2*GMS ≈ 1887 (enchant 2)", () => {
  approx(tc.brecilienExitCostPerUnit("T4_PLANKS_LEVEL2@2"), RATE * 0.51 * 8 * 2 * GMS, 0.5);
});

// ── weight: resource formula fallback matches items.xml (0.1*1.5^tier) ──────
clearWeightGlobals();
const RES_WEIGHTS = { 4: 0.51, 5: 0.76, 6: 1.14, 7: 1.71, 8: 2.56 };
Object.entries(RES_WEIGHTS).forEach(([tier, w]) => {
  test(`weight(T${tier}_ORE) ≈ ${w} (formula fallback)`, () => {
    approx(tc.getItemWeight(`T${tier}_ORE`), w, 0.005);
  });
});

// ── weight: trophy journals follow items.xml schedule 0.15 * 1.5^(tier-2) ──
// (rounded 2dp: T2=0.15, T3=0.23, T4=0.34, T5=0.51, T6=0.76, T7=1.14, T8=1.71)
clearWeightGlobals();
const JOURNAL_WEIGHTS = { 2: 0.15, 3: 0.23, 4: 0.34, 5: 0.51, 6: 0.76, 7: 1.14, 8: 1.71 };
Object.entries(JOURNAL_WEIGHTS).forEach(([tier, w]) => {
  test(`weight(T${tier}_JOURNAL_TROPHY_WOOD_FULL) ≈ ${w} (journal formula)`, () => {
    approx(tc.getItemWeight(`T${tier}_JOURNAL_TROPHY_WOOD_FULL`), w, 0.01);
  });
});
test("journal weight covers EMPTY/partial/FULL variants identically", () => {
  approx(tc.getItemWeight("T6_JOURNAL_TROPHY_WOOD_EMPTY"), 0.76, 0.01);
  approx(tc.getItemWeight("T6_JOURNAL_TROPHY_WOOD"),       0.76, 0.01);
  approx(tc.getItemWeight("T6_JOURNAL_TROPHY_WOOD_FULL"),  0.76, 0.01);
});
test("journal weight applies to resource-journal slugs too (T6_JOURNAL_WARRIOR_FULL)", () => {
  approx(tc.getItemWeight("T6_JOURNAL_WARRIOR_FULL"), 0.76, 0.01);
});
test("journal fasttravelfactor defaults to 1 (items.xml omits the attr)", () => {
  assert.strictEqual(tc.getItemFastTravelFactor("T6_JOURNAL_TROPHY_WOOD_FULL"), 1);
});

// ── weight: trophy furniture is a flat 3 kg across every tier ───────────────
clearWeightGlobals();
[2, 3, 4, 5, 6, 7, 8].forEach((tier) => {
  test(`weight(T${tier}_FURNITUREITEM_TROPHY_WOOD) = 3 (flat trophy weight)`, () => {
    assert.strictEqual(tc.getItemWeight(`T${tier}_FURNITUREITEM_TROPHY_WOOD`), 3);
  });
});
test("trophy weight applies to every slug (GENERAL, MERCENARY, FISH, ROCK, ORE, FIBER, HIDE)", () => {
  ["GENERAL", "MERCENARY", "FISH", "ROCK", "ORE", "FIBER", "HIDE"].forEach((slug) => {
    assert.strictEqual(tc.getItemWeight(`T5_FURNITUREITEM_TROPHY_${slug}`), 3);
  });
});

// ── weight: artifact crafting materials (RELIC/SOUL/RUNE/SHARD/ESSENCE) ─────
// items.xml uniformly schedules these by tier — same weight across every
// artifact-mat family. They aren't in ITEM_WEIGHTS (the extract scope skips
// them), so the formula must recognise them directly; otherwise they fall
// through to the gear-class fallback (0.5*1.8^tier ≈ 5.25 kg at T4 vs the
// real 0.05) and the Brecilien exit fee blows up ~100×.
clearWeightGlobals();
const ARTIFACT_MAT_WEIGHTS = { 4: 0.05, 5: 0.25, 6: 0.38, 7: 0.5, 8: 1 };
const ARTIFACT_MAT_FAMILIES = ["RELIC", "SOUL", "RUNE", "SHARD_AVALONIAN", "SHARD_CRYSTAL", "SHARD_FIRE_DRAGON", "ESSENCE", "ESSENCE_POTION"];
ARTIFACT_MAT_FAMILIES.forEach((fam) => {
  Object.entries(ARTIFACT_MAT_WEIGHTS).forEach(([tier, w]) => {
    test(`weight(T${tier}_${fam}) = ${w} (artifact-mat tier table)`, () => {
      assert.strictEqual(tc.getItemWeight(`T${tier}_${fam}`), w);
    });
  });
});
test("artifact-mat fasttravelfactor defaults to 1 (items.xml omits the attr)", () => {
  ARTIFACT_MAT_FAMILIES.forEach((fam) => {
    [4, 5, 6, 7, 8].forEach((tier) => {
      assert.strictEqual(tc.getItemFastTravelFactor(`T${tier}_${fam}`), 1);
    });
  });
});
test("artifact-mat weight strips enchant suffix (T4_RELIC@1 = 0.05)", () => {
  assert.strictEqual(tc.getItemWeight("T4_RELIC@1"), 0.05);
});
test("brecilienExitCostPerUnit(T4_RELIC) = 200*0.05*1*2*1.156 = 23.12 (matches in-game charge)", () => {
  approx(tc.brecilienExitCostPerUnit("T4_RELIC"), 23.12, 0.001);
});
test("brecilienExitCostPerUnit(T8_SOUL) = 200*1*1*2*1.156 = 462.4 (raw * GMS)", () => {
  approx(tc.brecilienExitCostPerUnit("T8_SOUL"), 462.4, 0.001);
});
test("ITEM_WEIGHTS override still wins over artifact-mat table", () => {
  global.ITEM_WEIGHTS = { T4_RELIC: 0.123 };
  approx(tc.getItemWeight("T4_RELIC"), 0.123);
  clearWeightGlobals();
});

// ── special tokens (Avalonian Energy / Siphoned Energy) ────────────────────
// items.xml lists both QUESTITEM_TOKEN_AVALON ("Avalonian Energy") and
// UNIQUE_GVGTOKEN_GENERIC ("Siphoned Energy") at weight 0.01 with no TCM, but
// in-game Avalonian Energy actually charges with a TCM of 16 (server-side, not
// dumped). Without the manual override map, both fall through to the gear-
// class fallback (5.25 kg) and the fee is wildly off. Verified against the
// in-game charges of 3.47 (Siphoned) and 55.49 (Avalonian), read under the
// old 150 rate and therefore rescaled here by 200/150.
clearWeightGlobals();
test("weight(UNIQUE_GVGTOKEN_GENERIC) = 0.01 (manual token override)", () => {
  assert.strictEqual(tc.getItemWeight("UNIQUE_GVGTOKEN_GENERIC"), 0.01);
});
test("weight(QUESTITEM_TOKEN_AVALON) = 0.01 (manual token override)", () => {
  assert.strictEqual(tc.getItemWeight("QUESTITEM_TOKEN_AVALON"), 0.01);
});
test("fasttravelfactor(UNIQUE_GVGTOKEN_GENERIC) = 1 (default, no TCM)", () => {
  assert.strictEqual(tc.getItemFastTravelFactor("UNIQUE_GVGTOKEN_GENERIC"), 1);
});
test("fasttravelfactor(QUESTITEM_TOKEN_AVALON) = 16 (calibrated, matches in-game)", () => {
  assert.strictEqual(tc.getItemFastTravelFactor("QUESTITEM_TOKEN_AVALON"), 16);
});
test("brecilienExitCostPerUnit(UNIQUE_GVGTOKEN_GENERIC) ≈ 4.63 silver (Siphoned Energy in-game, rescaled)", () => {
  approx(tc.brecilienExitCostPerUnit("UNIQUE_GVGTOKEN_GENERIC"), 4.624, 0.005);
});
test("brecilienExitCostPerUnit(QUESTITEM_TOKEN_AVALON) ≈ 73.99 silver (Avalonian Energy in-game, rescaled)", () => {
  approx(tc.brecilienExitCostPerUnit("QUESTITEM_TOKEN_AVALON"), 73.984, 0.005);
});

// ── weight: table lookup wins over formula ──────────────────────────────────
test("weight reads injected ITEM_WEIGHTS table (T5_MEAL_SOUP = 7.56)", () => {
  global.ITEM_WEIGHTS = { T5_MEAL_SOUP: 7.56 };
  approx(tc.getItemWeight("T5_MEAL_SOUP"), 7.56);
  clearWeightGlobals();
});

test("weight table lookup strips enchant suffix", () => {
  global.ITEM_WEIGHTS = { T5_CAPE: 1.5 };
  approx(tc.getItemWeight("T5_CAPE@3"), 1.5);
  clearWeightGlobals();
});

test("fasttravelfactor reads injected ITEM_FT_FACTORS override", () => {
  // A resource-related journal would carry a custom factor in the table.
  global.ITEM_FT_FACTORS = { T5_JOURNAL_FULL: 4 };
  assert.strictEqual(tc.getItemFastTravelFactor("T5_JOURNAL_FULL"), 4);
  clearWeightGlobals();
});

// ── per-unit exit cost = 200 * weight * factor * 2 * GMS ────────────────────
clearWeightGlobals();
test("brecilienExitCostPerUnit(T5_PLANKS) = 200*0.76*4*2*1.156 ≈ 1405.7", () => {
  approx(tc.brecilienExitCostPerUnit("T5_PLANKS"), RATE * 0.76 * 4 * 2 * GMS, 0.5);
});

test("brecilienExitCostPerUnit(T5_MEAL_SOUP) = 200*7.56*1*2*1.156 ≈ 3495.74 (table weight)", () => {
  global.ITEM_WEIGHTS = { T5_MEAL_SOUP: 7.56 };
  approx(tc.brecilienExitCostPerUnit("T5_MEAL_SOUP"), RATE * 7.56 * 1 * 2 * GMS, 0.5);
  clearWeightGlobals();
});

// ── legBrecilienCost is DISABLED: always returns 0 (applied fee removed) ─────
// The Brecilien Travel Planner exit fee was removed from every profit table.
// legBrecilienCost stays as the single choke point (so the call sites need no
// edits) but now returns 0 for all inputs. The real per-unit calculation lives
// on in brecilienExitCostPerUnit (tested above), which the reference table uses.
clearWeightGlobals();

test("OUT: Brecilien → Thetford → 0 (fee disabled)", () => {
  assert.strictEqual(tc.legBrecilienCost("Brecilien", "Thetford", "T5_PLANKS", 1), 0);
});

test("OUT: Brecilien → Caerleon → 0 (fee disabled)", () => {
  assert.strictEqual(tc.legBrecilienCost("Brecilien", "Caerleon", "T5_PLANKS", 1), 0);
});

test("IN: Thetford → Brecilien → 0", () => {
  assert.strictEqual(tc.legBrecilienCost("Thetford", "Brecilien", "T5_PLANKS", 1), 0);
});

test("SAME: Brecilien → Brecilien → 0", () => {
  assert.strictEqual(tc.legBrecilienCost("Brecilien", "Brecilien", "T5_PLANKS", 1), 0);
});

test("ELSEWHERE: Thetford → Lymhurst → 0", () => {
  assert.strictEqual(tc.legBrecilienCost("Thetford", "Lymhurst", "T5_PLANKS", 1), 0);
});

// ── quantity is ignored now (always 0) ──────────────────────────────────────
test("any quantity → 0 (fee disabled)", () => {
  assert.strictEqual(tc.legBrecilienCost("Brecilien", "Thetford", "T5_PLANKS", 5), 0);
  assert.strictEqual(tc.legBrecilienCost("Brecilien", "Thetford", "T5_PLANKS"), 0);
  assert.strictEqual(tc.legBrecilienCost("Brecilien", "Thetford", "T5_PLANKS", 0), 0);
});

// ── guard rails: missing/empty cities still 0 (no crash) ─────────────────────
test("missing origin/dest → 0 (no crash)", () => {
  assert.strictEqual(tc.legBrecilienCost(null, "Thetford", "T5_PLANKS", 1), 0);
  assert.strictEqual(tc.legBrecilienCost("Brecilien", null, "T5_PLANKS", 1), 0);
  assert.strictEqual(tc.legBrecilienCost("", "", "T5_PLANKS", 1), 0);
});

// ── independent of the Black/Red Zone Routes toggle (fee disabled either way) ─
test("BMR ON → 0 (fee disabled)", () => {
  global.isBlackRedZoneEnabled = () => true;
  try {
    assert.strictEqual(tc.legBrecilienCost("Brecilien", "Thetford", "T5_PLANKS", 1), 0);
  } finally {
    delete global.isBlackRedZoneEnabled;
  }
});

test("BMR OFF → 0 (fee disabled)", () => {
  global.isBlackRedZoneEnabled = () => false;
  try {
    assert.strictEqual(tc.legBrecilienCost("Brecilien", "Thetford", "T5_PLANKS", 1), 0);
  } finally {
    delete global.isBlackRedZoneEnabled;
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
