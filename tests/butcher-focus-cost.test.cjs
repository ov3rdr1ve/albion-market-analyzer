/**
 * Test: getButcherFocusCost prices butchering one animal into raw meat.
 *
 * The charge is NOT a hand-tuned constant. items.xml gives every meat tier the
 * same block —
 *
 *   <craftingrequirements amountcrafted="18" craftingfocus="38"
 *                         returnproductnotresource="true">
 *
 * — and craftingfocus is per OUTPUT UNIT ([[project_craftingfocus_is_per_output_unit]]),
 * so one animal costs 38 × 18 = 684 focus at zero specialization, identically at
 * T3-T8. That base is then scaled by the cooking specialization levels in force,
 * exactly like every other craft.
 *
 * Two independent in-game readings fall out of that base, which is what pins it:
 *
 *   Chef 100 + Butcher 100 + 17 sibling levels  → 31,510 FCE → 77 focus
 *       (verified 2026-06-26 with 100/100 butcher: T3 Chicken and T6 Sheep both 77)
 *   Chef 100 + Butcher 100 + Stew Chef 17
 *     + 19 levels over the other siblings          → 32,080 FCE → 74 focus
 *       (verified 2026-08-03 butchering a goose; the SAME character's T6
 *        Avalonian Stew reads 80.3/each, which back-solves to those levels)
 *
 * The old model back-solved a 536.6 base from the 77 reading while assuming the
 * siblings sat at 0, and so understated the charge ~21% at every spec level.
 *
 * Fish chops (the butcher's other product) carry no craftingfocus → 0.
 *
 * Run: node tests/butcher-focus-cost.test.cjs
 */

const assert = require("assert");
const { loadFocusSpecWithUtils } = require("./helpers/load-focus-spec.cjs");

const MEAT_TIERS = ["T3_MEAT", "T4_MEAT", "T5_MEAT", "T6_MEAT", "T7_MEAT", "T8_MEAT"];

// items.xml: craftingfocus × amountcrafted, the same for every meat tier.
const BASE = 38 * 18;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// A sandbox with the cooking branch zeroed, then `levels` applied. (Zeroing is
// also the default for every specialization now — it stays explicit so the
// cases read as complete boards.)
function withLevels(levels) {
  const api = loadFocusSpecWithUtils();
  api.setAllSpecLevels("consumable-table", 0);
  Object.entries(levels).forEach(([node, level]) =>
    api.setSpecLevel("consumable-table", node, level));
  return api;
}

console.log("Butcher Focus Cost Tests\n");

// ── Every node at max spec → 15 focus, flat across tiers. ─────────────────
const app = loadFocusSpecWithUtils();
app.setAllSpecLevels("", 100);
MEAT_TIERS.forEach((id) => {
  test(`${id} → 15 focus with the whole cooking tree maxed`, () => {
    assert.strictEqual(app.getButcherFocusCost(id), 15);
  });
});

// ── No specialization at all → the raw items.xml charge. ──────────────────
test("no cooking spec at all → the full 684 base (38 × 18)", () => {
  const unspecced = withLevels({});
  unspecced.withSpecScope("consumable-table", () => {
    MEAT_TIERS.forEach((id) =>
      assert.strictEqual(unspecced.getButcherFocusCost(id), BASE, `${id} should be ${BASE}`));
  });
});

// ── The two verified in-game readings. ────────────────────────────────────
test("Chef 100 + Butcher 100 + 17 sibling levels → 77 (verified 2026-06-26)", () => {
  const api = withLevels({
    FARM_COOK: 100, FARM_COOK_MEAT: 100, FARM_COOK_STEW: 17,
  });
  api.withSpecScope("consumable-table", () => {
    MEAT_TIERS.forEach((id) =>
      assert.strictEqual(api.getButcherFocusCost(id), 77, `${id} should be flat at 77`));
  });
});

test("Chef 100 / Butcher 100 / Stew Chef 17 / 19 sibling levels → 74 (goose, 2026-08-03)", () => {
  const api = withLevels({
    FARM_COOK: 100, FARM_COOK_MEAT: 100, FARM_COOK_STEW: 17,
    FARM_COOK_OMELETTE: 5, FARM_COOK_PIE: 5, FARM_COOK_ROAST: 5,
    FARM_COOK_SALAD: 2, FARM_COOK_SANDWICH: 1, FARM_COOK_SOUP: 1,
  });
  api.withSpecScope("consumable-table", () => {
    assert.strictEqual(api.getButcherFocusCost("T5_MEAT"), 74);
  });
});

// ── Monotonic in specialization, bounded by the two extremes. ─────────────
test("cost falls monotonically as the butcher node levels up", () => {
  let previous = Infinity;
  [0, 25, 50, 75, 100].forEach((level) => {
    const api = withLevels({ FARM_COOK_MEAT: level });
    const cost = api.withSpecScope("consumable-table", () =>
      api.getButcherFocusCost("T5_MEAT"));
    assert.ok(cost < previous, `level ${level}: expected ${cost} < ${previous}`);
    assert.ok(cost >= 1 && cost <= BASE, `level ${level}: ${cost} out of range`);
    previous = cost;
  });
});

// ── Every tier moves together — the flatness is derived, not asserted. ────
test("all six meat tiers agree at a half-levelled butcher", () => {
  const api = withLevels({ FARM_COOK: 50, FARM_COOK_MEAT: 50 });
  api.withSpecScope("consumable-table", () => {
    const costs = MEAT_TIERS.map((id) => api.getButcherFocusCost(id));
    assert.strictEqual(new Set(costs).size, 1, `expected one value, got ${costs.join("/")}`);
  });
});

// ── It must never collapse to the old bogus per-unit 38 → 1 path. ────────
test("does not regress to the per-unit craftingfocus=38 path (1 focus)", () => {
  assert.notStrictEqual(app.getButcherFocusCost("T3_MEAT"), 1);
  assert.ok(app.getButcherFocusCost("T3_MEAT") >= 15);
});

// ── Non-meat butcher products carry no focus. ─────────────────────────────
["T1_FISHCHOPS", "T4_FISH_FRESHWATER_ALL", "T8_FARM_COW_GROWN"].forEach((id) => {
  test(`${id} → 0 (not a raw-meat butcher charge)`, () => {
    assert.strictEqual(app.getButcherFocusCost(id), 0);
  });
});

test("null / undefined / empty → 0, no throw", () => {
  assert.strictEqual(app.getButcherFocusCost(null), 0);
  assert.strictEqual(app.getButcherFocusCost(undefined), 0);
  assert.strictEqual(app.getButcherFocusCost(""), 0);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
