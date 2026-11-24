/**
 * Test: js/focus-spec.js turns Destiny Board node levels into a focus multiplier.
 *
 * Game model (ao-bin-dumps achievements.xml, see scripts/gen-focus-spec-nodes.cjs):
 *   - a node at level L contributes  bonus × 100 × L  Focus Cost Efficiency points
 *   - focus cost is halved per 10,000 FCE →  mult = 0.5 ^ (FCE / 10000)
 *   - a node the user never typed reads its default: 0, or 100 for the mastery
 *     heading its group (see tests/focus-spec-default-levels.test.cjs). The
 *     max-spec anchors below therefore set every level to 100 first.
 *
 * Anchors verified in-game / on the wiki (all nodes at 100):
 *   refining        40,000 FCE → 6.25 %
 *   cooking/potions 55,000 FCE → 2.21 %
 *   meat, butcher node only 28,000 FCE → 14.35 % (540-ish base = the in-game 77)
 *   mounts / furniture / journals: no node at all → base cost (mult 1)
 *
 * Black-box: only the public focus-spec API, with a stubbed localStorage.
 *
 * Run: node tests/focus-spec-levels.test.cjs
 */

const assert = require("assert");
const { loadFocusSpec } = require("./helpers/load-focus-spec.cjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// A sandbox with `scope` fully maxed — the state every max-spec anchor assumes.
function maxed(scope) {
  const spec = loadFocusSpec();
  spec.setAllSpecLevels(scope, 100);
  return spec;
}

console.log("Focus Spec Levels Tests\n");

// ── Every node at 100 reproduces the documented max-spec figures. ───────────
const MAX_SPEC = [
  ["T5_METALBAR", 40000, 0.0625],
  ["T8_PLANKS", 40000, 0.0625],
  ["T5_PLANKS_LEVEL2@2", 40000, 0.0625],
  ["T5_MEAL_SOUP", 55000, 0.0221],
  ["T4_POTION_HEAL", 55000, 0.0221],
  ["T3_FLOUR", 55000, 0.0221],
  ["T5_MEAT", 55000, 0.0221],
  ["T5_HEAD_PLATE_SET1", 44500, 0.04575],
  ["T5_2H_TOOL_PICK", 40000, 0.0625],
  ["T4_CAPE", 40000, 0.0625],
  ["T8_FARM_HORSE_BABY", 30000, 0.125],
  ["T3_FARM_COMFREY_SEED", 30000, 0.125],
];

MAX_SPEC.forEach(([itemId, fce, mult]) => {
  test(`${itemId}: all nodes at 100 → ${fce.toLocaleString()} FCE, mult ≈ ${mult}`, () => {
    const spec = maxed("crafting-table");
    assert.strictEqual(spec.getItemFCE(itemId, "crafting-table"), fce);
    assert.ok(
      close(spec.focusSpecMultiplier(itemId, "crafting-table"), mult, 1e-4),
      `mult was ${spec.focusSpecMultiplier(itemId, "crafting-table")}`
    );
  });
});

// ── Items with no focus specialization keep their base cost. ────────────────
["T5_FURNITUREITEM_TABLE_A", "T5_MOUNT_HORSE", "T5_JOURNAL_WARRIOR_EMPTY",
 "T5_CAPEITEM_FW_MARTLOCK", "NOT_A_REAL_ITEM", "", null, undefined].forEach((itemId) => {
  test(`${itemId} → no nodes, FCE 0, mult 1`, () => {
    const spec = loadFocusSpec();
    assert.strictEqual(spec.getItemFCE(itemId, "crafting-table"), 0);
    assert.strictEqual(spec.focusSpecMultiplier(itemId, "crafting-table"), 1);
  });
});

// ── Levels scale linearly into FCE. ─────────────────────────────────────────
test("all nodes at 0 → 0 FCE, mult 1 (base cost, an unspecced player)", () => {
  const spec = loadFocusSpec();
  spec.setAllSpecLevels("crafting-table", 0);
  assert.strictEqual(spec.getItemFCE("T5_METALBAR", "crafting-table"), 0);
  assert.strictEqual(spec.focusSpecMultiplier("T5_METALBAR", "crafting-table"), 1);
});

test("all nodes at 50 → half the max FCE", () => {
  const spec = loadFocusSpec();
  spec.setAllSpecLevels("crafting-table", 50);
  assert.strictEqual(spec.getItemFCE("T5_METALBAR", "crafting-table"), 20000);
  assert.ok(close(spec.focusSpecMultiplier("T5_METALBAR", "crafting-table"), 0.25));
});

test("T5 ore node at 0, rest maxed → 40,000 − 2.5×100×100 = 12,000 lost", () => {
  const spec = maxed("transport-table");
  spec.setSpecLevel("transport-table", "CRAFT_REFINE_ORE_T5", 0);
  // T5 ore node carries the 0.3 category + 2.5 group bonus = 2.8 → 28,000 FCE.
  assert.strictEqual(spec.getItemFCE("T5_METALBAR", "transport-table"), 12000);
  // Its neighbours only lose their own 0.3 category bonus on T5 bars.
  assert.strictEqual(spec.getItemFCE("T6_METALBAR", "transport-table"), 37000);
  // Different resource, untouched.
  assert.strictEqual(spec.getItemFCE("T5_PLANKS", "transport-table"), 40000);
});

test("butcher node only (rest of cooking at 0) → 28,000 FCE", () => {
  const spec = loadFocusSpec();
  spec.setAllSpecLevels("consumable-table", 0);
  spec.setSpecLevel("consumable-table", "FARM_COOK_MEAT", 100);
  assert.strictEqual(spec.getItemFCE("T5_MEAT", "consumable-table"), 28000);
  assert.ok(close(spec.focusSpecMultiplier("T5_MEAT", "consumable-table"), 0.143587, 1e-5));
});

// ── Levels are clamped and sanitised. A cleared box (NaN/null) falls back to
//    the node's default, which is 0 for a specialization like this one. ──────
[[-10, 0], [0, 0], [37, 37], [100, 100], [250, 100], ["60", 60], [NaN, 0], [null, 0]]
  .forEach(([input, expected]) => {
    test(`setSpecLevel(${JSON.stringify(input)}) stores ${expected}`, () => {
      const spec = loadFocusSpec();
      spec.setSpecLevel("crafting-table", "CRAFT_PLATE_HEADS_SET1", input);
      assert.strictEqual(spec.getSpecLevel("crafting-table", "CRAFT_PLATE_HEADS_SET1"), expected);
    });
  });

test("setSpecLevelsFor sets one specialization group at a time", () => {
  const spec = maxed("transport-table");
  const fiber = [4, 5, 6, 7, 8].map((t) => `CRAFT_REFINE_FIBER_T${t}`);
  spec.setSpecLevelsFor("transport-table", fiber, 0);
  assert.strictEqual(spec.getItemFCE("T5_CLOTH", "transport-table"), 0);
  // Every other resource is untouched.
  assert.strictEqual(spec.getItemFCE("T5_METALBAR", "transport-table"), 40000);
  assert.strictEqual(spec.getItemFCE("T5_PLANKS", "transport-table"), 40000);
});

test("unknown node id reads as 0 (it heads no group, so it is no mastery)", () => {
  const spec = loadFocusSpec();
  assert.strictEqual(spec.getSpecLevel("crafting-table", "NO_SUCH_NODE"), 0);
});

// ── hasCustomSpec drives the ⚙ button's customised marker. ─────────────────
test("hasCustomSpec: false at defaults, true after an edit, false after reset", () => {
  const spec = loadFocusSpec();
  assert.strictEqual(spec.hasCustomSpec("crafting-table"), false);
  spec.setSpecLevel("crafting-table", "CRAFT_SWORDS_SWORD", 40);
  assert.strictEqual(spec.hasCustomSpec("crafting-table"), true);
  spec.resetSpecLevels("crafting-table");
  assert.strictEqual(spec.hasCustomSpec("crafting-table"), false);
  assert.strictEqual(spec.getSpecLevel("crafting-table", "CRAFT_SWORDS_SWORD"), 0);
});

test("setting a level back to its default clears it from storage (sparse map)", () => {
  const spec = loadFocusSpec();
  spec.setSpecLevel("crafting-table", "CRAFT_SWORDS_SWORD", 40);
  spec.setSpecLevel("crafting-table", "CRAFT_SWORDS_SWORD", 0);
  assert.deepStrictEqual(spec.getSpecLevels("crafting-table"), {});
  assert.strictEqual(spec.hasCustomSpec("crafting-table"), false);
});

// ── Ambient scope: renderers set it once instead of threading an argument. ──
test("withSpecScope makes the scope implicit for focusSpecMultiplier", () => {
  const spec = loadFocusSpec();
  spec.setAllSpecLevels("crafting-table", 0);
  spec.setAllSpecLevels("", 100); // the unscoped store, maxed
  assert.strictEqual(spec.currentSpecScope(), null);
  spec.withSpecScope("crafting-table", () => {
    assert.strictEqual(spec.currentSpecScope(), "crafting-table");
    assert.strictEqual(spec.focusSpecMultiplier("T5_HEAD_PLATE_SET1"), 1);
  });
  assert.strictEqual(spec.currentSpecScope(), null);
  // Outside the scope we read the unscoped store, not the table's zeros.
  assert.ok(close(spec.focusSpecMultiplier("T5_HEAD_PLATE_SET1"), 0.04575, 1e-4));
});

test("withSpecScope restores the previous scope even when fn throws", () => {
  const spec = loadFocusSpec();
  assert.throws(() => spec.withSpecScope("crafting-table", () => { throw new Error("boom"); }));
  assert.strictEqual(spec.currentSpecScope(), null);
});

test("withSpecScope returns the callback's value and nests", () => {
  const spec = loadFocusSpec();
  const seen = [];
  const out = spec.withSpecScope("a", () => {
    spec.withSpecScope("b", () => seen.push(spec.currentSpecScope()));
    seen.push(spec.currentSpecScope());
    return 42;
  });
  assert.strictEqual(out, 42);
  assert.deepStrictEqual(seen, ["b", "a"]);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
