/**
 * Test: getFocusCost applies the Focus Cost Efficiency (FCE) reduction that the
 * item's Destiny Board nodes give at the levels in force for the table.
 *
 * Since the per-table ⚙ specialization settings landed, the reduction is DATA:
 * js/focus-spec-items.js lists the nodes covering each item and js/focus-spec.js
 * folds their levels into
 *   mult = 0.5 ^ (FCE / 10000).
 * Every anchor below is a MAX-SPEC reading, so this file sets every node to 100
 * explicitly — an untouched node is 0 now (100 only for a mastery), see
 * tests/focus-spec-default-levels.test.cjs.
 * The three old flat constants (refining ×0.0625, crafting ×0.0221, ingredient
 * ×0.125) are gone; `category` is still accepted by getFocusCost but ignored.
 *
 * What changed vs. those constants, and why the data wins:
 *   - refining still lands on exactly 0.0625 (40,000 FCE) — the in-game
 *     measurements that pinned this test before are reproduced unchanged.
 *   - GEAR is ~44,500 FCE → ~0.0457, not the 55,000/0.0221 that belongs to
 *     cooking & alchemy. Gear focus used to be understated ~2×.
 *   - cooking ingredients (flour/bread/butter) share the full 55,000 cooking
 *     tree → 0.0221, not the guessed 0.125.
 *   - capes, bags, satchels and siege hammers land on 40,000 FCE like a refine.
 *     They read 6,000/9,000 until 2026-08-19: their specialist's group bonus is
 *     spelled `mintier maxtier type bonus` in achievements.xml and the generator
 *     only matched `type bonus mintier maxtier`.
 *
 * Run: node tests/focus-cost-efficiency.test.cjs
 */

const assert = require("assert");
const { loadFocusSpecWithUtils } = require("./helpers/load-focus-spec.cjs");

const app = loadFocusSpecWithUtils();
// The ambient (unscoped) store these calls read, maxed: every figure here is an
// in-game reading taken at 100/100.
app.setAllSpecLevels("", 100);
const { getFocusCost, getBaseFocusCost } = app;

const MULT = {
  refine: Math.pow(0.5, 4.0),   // 40,000 FCE — verified in-game
  cooking: Math.pow(0.5, 5.5),  // 55,000 FCE — wiki (meals, potions, ingredients)
  gearHeads: Math.pow(0.5, 4.45), // 44,500 FCE — armor/weapon families
  cape: Math.pow(0.5, 4.0),     // 40,000 FCE — the Cape Tailoring Specialist
};
const expect = (base, mult) => Math.max(1, Math.round(base * mult));
// getFocusCost returns the EXACT fractional charge (the game itself bills
// fractions — a maxed T4 leather refine is 3.375 focus, and the client shows
// "3.38/ea"). Every anchor below was read off that rounded display, so the
// readings are compared against the rounded cost; the fraction is the thing
// under test in "the reduced cost is never pre-rounded" further down.
const shown = (...args) => Math.round(getFocusCost(...args));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Focus Cost Efficiency Tests\n");

// ── refining: FLAT 0.0625, VERIFIED IN-GAME (9 measurements) ───────────────
// Plain T4-T8 leather + all four T4 enchants + T7.4 (100 spec + bonus city) ALL
// land on 0.0625, and the node data reproduces every one of them.
const refiningCases = [
  ["T4_LEATHER", 4, 54, 3],            // 100 refines = 338 focus (3.38/ea → 3)
  ["T4_LEATHER_LEVEL1@1", 4, 94, 6],   //  17 refines = 100 focus (5.9/ea → 6)
  ["T4_LEATHER_LEVEL2@2", 4, 164, 10], //  14 refines = 144 focus (10.3/ea → 10)
  ["T4_LEATHER_LEVEL3@3", 4, 287, 18], //   3 refines =  54 focus (18/ea → 18)
  ["T5_LEATHER", 5, 94, 6],            //  18 refines = 106 focus (5.9/ea → 6)
  ["T6_LEATHER", 6, 164, 10],          //   3 refines =  31 focus (10.3/ea → 10)
  ["T7_LEATHER", 7, 287, 18],          //   3 refines =  54 focus (18/ea → 18)
  ["T7_LEATHER_LEVEL4@4", 7, 2694, 168], // 1 refine  = 168 focus
  ["T8_LEATHER", 8, 503, 31],          //   1 refine  =  31 focus
  ["T8_METALBAR", 8, 503, 31],         //   resource-agnostic (same base → same)
  ["T4_PLANKS", 4, 54, 3],
];
refiningCases.forEach(([id, tier, base, want]) => {
  test(`refining ${id} → round(${base}×0.0625)=${want}`, () => {
    assert.strictEqual(getBaseFocusCost(id), base, "base cost drifted");
    assert.strictEqual(shown(id, tier, "refining"), want);
  });
});

// The "deep" readings that once looked like overrides (T7.4=131, T8.0=27) were
// both bad data — re-measured to the flat default (168 and 31).
test("no phantom overrides: T7.4=168 and T8.0=31, both the flat 0.0625 default", () => {
  assert.strictEqual(shown("T7_LEATHER_LEVEL4@4", 7, "refining"), 168);
  assert.strictEqual(shown("T8_LEATHER", 8, "refining"), 31);
});

// ── gear: ~44,500 FCE, NOT the cooking 55,000 ──────────────────────────────
[
  ["T5_HEAD_PLATE_SET1", 5],
  ["T5_ARMOR_CLOTH_KEEPER", 5],
  ["T4_MAIN_SWORD", 4],
].forEach(([id, tier]) => {
  test(`gear ${id} → ~4.6% of base, not 2.21%`, () => {
    const base = getBaseFocusCost(id);
    const cost = getFocusCost(id, tier, "crafting");
    assert.ok(base > 0, "no base focus cost");
    assert.ok(Math.abs(cost - base * MULT.gearHeads) <= 1.5,
      `${id}: got ${cost}, expected ≈ ${(base * MULT.gearHeads).toFixed(1)}`);
    assert.ok(cost > expect(base, MULT.cooking), "gear must cost more than the cooking rate");
  });
});

// ── cooking, potions and their ingredients: the full 55,000 FCE tree ───────
[
  ["T5_MEAL_SOUP", 5],
  ["T4_POTION_HEAL", 4],
  ["T3_FLOUR", 3],
  ["T4_BREAD", 4],
  ["T4_BUTTER", 4],
  ["T8_BUTTER", 8],
].forEach(([id, tier]) => {
  test(`cooking/alchemy ${id} → round(base×0.0221)`, () => {
    const base = getBaseFocusCost(id);
    assert.strictEqual(shown(id, tier, "crafting"), expect(base, MULT.cooking));
  });
});

test("ingredients follow the cooking tree, not the old guessed 12.5%", () => {
  assert.strictEqual(shown("T3_FLOUR", 3, "ingredient"), 1); // round(38×0.0221)=1
  assert.notStrictEqual(shown("T3_FLOUR", 3, "ingredient"), 5);
});

// ── capes: mastery 0.3 + Cape Tailoring Specialist 0.3 + 3.4 = 40,000 FCE ──
// The specialist's 3.4 group bonus is spelled `mintier maxtier type bonus` in
// achievements.xml and used to be skipped by the generator, which left capes on
// 6,000 FCE (66% of base) — see tests/focus-spec-bonus-parse.test.cjs.
test("T5_CAPE pays the same 6.25% as any other maxed craft (40,000 FCE)", () => {
  const base = getBaseFocusCost("T5_CAPE");
  assert.strictEqual(shown("T5_CAPE", 5, "crafting"), expect(base, MULT.cape));
});

// ── items with no node at all → untouched base cost ────────────────────────
[
  ["T5_MOUNT_HORSE", "saddler/mounts are not spec-reducible"],
  ["T7_FURNITUREITEM_TABLE", "furniture has no focus spec (5,627 in-game)"],
  ["T3_METALBAR", "every dump bonus is mintier=4, so T2/T3 pay base"],
].forEach(([id, why]) => {
  test(`${id} → raw base cost (${why})`, () => {
    assert.strictEqual(getFocusCost(id, Number(id[1]), "crafting"), getBaseFocusCost(id));
  });
});

// ── the `category` argument no longer changes anything ────────────────────
test("category is vestigial: same item, same cost whatever is passed", () => {
  const variants = [undefined, "refining", "crafting", "ingredient"].map((c) =>
    shown("T8_METALBAR", 8, c)
  );
  assert.deepStrictEqual(variants, [31, 31, 31, 31]);
});

// ── the reduced cost is never pre-rounded ─────────────────────────────────
// Rounding here used to cascade into every consumer that divides the 10,000
// focus bar by the cost: T4 Avalonian Goat Stew is 58 × 0.0221 = 1.28, and
// round()→1 bought 10,000 crafts instead of 7,803 — Profit/10k Focus,
// Silver/Focus and Mats to Buy all overstated 28%.
[
  ["T4_MEAL_STEW_AVALON", 4, 58, MULT.cooking],   // 1.2816 — the reported bug
  ["T6_MEAL_STEW_AVALON", 6, 176, MULT.cooking],  // 3.8891
  ["T4_LEATHER", 4, 54, MULT.refine],             // 3.375
].forEach(([id, tier, base, mult]) => {
  test(`${id} keeps its fraction (${(base * mult).toFixed(4)}), not round()`, () => {
    const cost = getFocusCost(id, tier, "crafting");
    assert.ok(Math.abs(cost - base * mult) < 1e-9,
      `${id}: got ${cost}, expected ${base * mult}`);
    assert.notStrictEqual(cost, Math.round(cost), "cost was pre-rounded");
  });
});

test("a fraction under 1 stays a fraction — the old floor bought a 10k-craft bar", () => {
  // T1 Seaweed Salad, base 4 → 0.0884. The old Math.max(1, …) floor made this
  // exactly 1 focus, i.e. 10,000 crafts off a single bar.
  const cost = getFocusCost("T1_SALAD_SEAWEED", 1, "crafting");
  if (cost === 0) return; // item absent from the dump — nothing to pin
  assert.ok(cost > 0 && cost < 1, `expected a sub-1 fraction, got ${cost}`);
  assert.ok(Math.floor(10000 / cost) > 10000, "a sub-1 cost must buy MORE than 10k crafts");
});

// ── non-focus items stay at 0 ─────────────────────────────────────────────
test("items with no craftingfocus → 0", () => {
  assert.strictEqual(getFocusCost("T4_ORE", 4, "refining"), 0);
  assert.strictEqual(getFocusCost("NOT_AN_ITEM", 4, "crafting"), 0);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
