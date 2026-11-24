/**
 * Test: the level a Destiny Board node reads when the user never typed one.
 *
 * The app used to default EVERY node to 100 (max spec). That is invisible: set
 * two cooking nodes in a table's ⚙ panel and the other eight silently stay
 * maxed, which is 24,000 FCE and prices the craft ~4× too cheap. Reported case
 * (2026-08-04), Chef 100 / Butcher 100 / Stew Chef 17 in game:
 *
 *   T6 Avalonian Stew   app 19 focus/each   game 80.3/each
 *   one butchered goose app 14-18 focus     game 74
 *
 * The arithmetic was never wrong — the eight untouched nodes were. So a node
 * the user has not set now reads 0, EXCEPT the mastery heading its own group
 * (Chef, Alchemist, Animals…), which anybody who crafts at all has maxed and
 * which is ten numbers rather than 367.
 *
 * Black-box over the public focus-spec / focus-cost API with a stubbed
 * localStorage; every case states the levels it sets, so the expectations read
 * as "this board pays this much".
 *
 * Run: node tests/focus-spec-default-levels.test.cjs
 */

const assert = require("assert");
const { loadFocusSpec, loadFocusSpecWithUtils } = require("./helpers/load-focus-spec.cjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const SCOPE = "consumable-table";

// A sandbox with `levels` typed into the Consumables panel and nothing else.
function withLevels(levels) {
  const api = loadFocusSpecWithUtils();
  Object.entries(levels || {}).forEach(([node, level]) =>
    api.setSpecLevel(SCOPE, node, level));
  return api;
}

// The focus a row would print: meat is charged per ANIMAL (craftingfocus × 18).
// getFocusCost keeps the exact fraction the game bills (a stew reads 80.3/each
// in-game), so the anchors below — all read off the rounded client display —
// are compared against the rounded cost.
function costOf(api, itemId) {
  return Math.round(api.withSpecScope(SCOPE, () => (
    /^T[3-8]_MEAT$/.test(itemId)
      ? api.getButcherFocusCost(itemId)
      : api.getFocusCost(itemId, 0, "crafting")
  )));
}

console.log("Focus Spec Default Levels Tests\n");

// ── defaultSpecLevel: mastery 100, everything else 0. ──────────────────────
[
  ["FARM_COOK", 100, "cooking mastery (Chef)"],
  ["FARM_ALCHEMIST", 100, "alchemy mastery"],
  ["FARM_ANIMALS", 100, "breeding mastery"],
  ["CRAFT_SWORDS", 100, "a weapon-line mastery"],
  ["FARM_COOK_MEAT", 0, "a specialization (Butcher)"],
  ["FARM_COOK_STEW", 0, "a specialization (Stew Chef)"],
  ["CRAFT_REFINE_ORE_T5", 0, "a refining tier — its group has no mastery node"],
  ["NO_SUCH_NODE", 0, "an unknown node id"],
  ["", 0, "the empty node id"],
].forEach(([nodeId, expected, why]) => {
  test(`defaultSpecLevel(${JSON.stringify(nodeId)}) → ${expected} — ${why}`, () => {
    const spec = loadFocusSpec();
    assert.strictEqual(spec.defaultSpecLevel(nodeId), expected);
    assert.strictEqual(spec.getSpecLevel(SCOPE, nodeId), expected);
  });
});

// ── An untouched table prices a masteries-only character. ──────────────────
[
  ["T6_MEAL_STEW_AVALON", 3000, 143],
  ["T5_MEAT", 3000, 556],
  ["T5_MEAL_SOUP", 3000, 409],
].forEach(([itemId, fce, cost]) => {
  test(`${itemId}: nothing typed → ${fce.toLocaleString()} FCE, ${cost} focus`, () => {
    const api = withLevels({});
    assert.strictEqual(api.getItemFCE(itemId, SCOPE), fce);
    assert.strictEqual(costOf(api, itemId), cost);
  });
});

// ── The reported board, typed exactly as the user described it. ────────────
const REPORTED = { FARM_COOK: 100, FARM_COOK_MEAT: 100, FARM_COOK_STEW: 17 };

test("Chef 100 + Butcher 100 + Stew Chef 17 → stew 83 (game 80.3)", () => {
  const api = withLevels(REPORTED);
  assert.strictEqual(api.getItemFCE("T6_MEAL_STEW_AVALON", SCOPE), 10760);
  assert.strictEqual(costOf(api, "T6_MEAL_STEW_AVALON"), 83);
});

test("Chef 100 + Butcher 100 + Stew Chef 17 → goose 77 (game 74)", () => {
  const api = withLevels(REPORTED);
  assert.strictEqual(api.getItemFCE("T5_MEAT", SCOPE), 31510);
  assert.strictEqual(costOf(api, "T5_MEAT"), 77);
});

// The last ~4% is the seven other cooking specializations, which are not 0 in
// game either. Typed in, the same board reproduces BOTH readings exactly.
const REAL_BOARD = Object.assign({}, REPORTED, {
  FARM_COOK_OMELETTE: 5, FARM_COOK_PIE: 5, FARM_COOK_ROAST: 5,
  FARM_COOK_SALAD: 2, FARM_COOK_SANDWICH: 1, FARM_COOK_SOUP: 1,
});

test("the full board → stew 80 and goose 74, the two in-game readings", () => {
  const api = withLevels(REAL_BOARD);
  assert.strictEqual(costOf(api, "T6_MEAL_STEW_AVALON"), 80);
  assert.strictEqual(costOf(api, "T5_MEAT"), 74);
});

// ── "All 100 (max spec)" is still one click away. ──────────────────────────
test("all nodes at 100 → the 55,000 FCE cooking anchor (stew 4, goose 15)", () => {
  const api = loadFocusSpecWithUtils();
  api.setAllSpecLevels(SCOPE, 100);
  assert.strictEqual(api.getItemFCE("T6_MEAL_STEW_AVALON", SCOPE), 55000);
  assert.strictEqual(costOf(api, "T6_MEAL_STEW_AVALON"), 4);
  assert.strictEqual(costOf(api, "T5_MEAT"), 15);
});

test("reset drops back to masteries-only, not to max spec", () => {
  const api = loadFocusSpecWithUtils();
  api.setAllSpecLevels(SCOPE, 100);
  api.resetSpecLevels(SCOPE);
  assert.strictEqual(api.getSpecLevel(SCOPE, "FARM_COOK"), 100);
  assert.strictEqual(api.getSpecLevel(SCOPE, "FARM_COOK_MEAT"), 0);
  assert.strictEqual(costOf(api, "T5_MEAT"), 556);
});

// ── Storage stays sparse around the NEW defaults, in both directions. ──────
[
  ["FARM_COOK_STEW", 0, "a specialization at its 0 default"],
  ["FARM_COOK", 100, "a mastery at its 100 default"],
].forEach(([nodeId, level, why]) => {
  test(`storing ${why} keeps the map empty`, () => {
    const spec = loadFocusSpec();
    spec.setSpecLevel(SCOPE, nodeId, level);
    assert.deepStrictEqual(spec.getSpecLevels(SCOPE), {});
    assert.strictEqual(spec.hasCustomSpec(SCOPE), false);
  });
});

[
  ["FARM_COOK_STEW", 100, "a maxed specialization"],
  ["FARM_COOK", 0, "a mastery the user has not levelled"],
].forEach(([nodeId, level, why]) => {
  test(`${why} IS stored — it differs from the default`, () => {
    const spec = loadFocusSpec();
    spec.setSpecLevel(SCOPE, nodeId, level);
    assert.deepStrictEqual(spec.getSpecLevels(SCOPE), { [nodeId]: level });
    assert.strictEqual(spec.getSpecLevel(SCOPE, nodeId), level);
    assert.strictEqual(spec.hasCustomSpec(SCOPE), true);
  });
});

// A cleared input box means "leave it at the default", whatever that node's is.
[
  ["FARM_COOK_STEW", 0],
  ["FARM_COOK", 100],
].forEach(([nodeId, expected]) => {
  [null, "", undefined, NaN].forEach((input) => {
    test(`setSpecLevel(${nodeId}, ${JSON.stringify(input)}) → ${expected}`, () => {
      const spec = loadFocusSpec();
      spec.setSpecLevel(SCOPE, nodeId, 42);
      spec.setSpecLevel(SCOPE, nodeId, input);
      assert.strictEqual(spec.getSpecLevel(SCOPE, nodeId), expected);
    });
  });
});

test("export/import round-trips an explicit 0 and an explicit 100", () => {
  const spec = loadFocusSpec();
  spec.setSpecLevel(SCOPE, "FARM_COOK", 0);          // mastery below default
  spec.setSpecLevel(SCOPE, "FARM_COOK_STEW", 100);   // specialization above it
  const bundle = spec.exportSpecLevels();
  assert.deepStrictEqual(bundle[SCOPE], { FARM_COOK: 0, FARM_COOK_STEW: 100 });

  const other = loadFocusSpec();
  other.importSpecLevels(bundle);
  assert.strictEqual(other.getSpecLevel(SCOPE, "FARM_COOK"), 0);
  assert.strictEqual(other.getSpecLevel(SCOPE, "FARM_COOK_STEW"), 100);
  assert.strictEqual(other.getSpecLevel(SCOPE, "FARM_COOK_MEAT"), 0);
});

// ── Items with no specialization at all are untouched by any of this. ──────
["T5_FURNITUREITEM_TABLE_A", "T5_MOUNT_HORSE", "T5_JOURNAL_WARRIOR_EMPTY"].forEach((id) => {
  test(`${id} → no nodes, mult 1, base cost regardless of defaults`, () => {
    const spec = loadFocusSpec();
    assert.strictEqual(spec.getItemFCE(id, SCOPE), 0);
    assert.strictEqual(spec.focusSpecMultiplier(id, SCOPE), 1);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
