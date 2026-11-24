/**
 * Test: specialization levels are stored PER TABLE (per "scope") and feed the
 * real getFocusCost pipeline in js/utils.js.
 *
 * Each table's ⚙ panel edits its own scope, so the Crafting table can model a
 * maxed crafter while Refining / Transports models a half-levelled refiner. The
 * renderers set the scope ambiently (withSpecScope) instead of threading an
 * extra argument through ~40 getFocusCost call sites.
 *
 * Run: node tests/spec-settings-scope.test.cjs
 */

const assert = require("assert");
const { loadFocusSpec, loadFocusSpecWithUtils } = require("./helpers/load-focus-spec.cjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Spec Settings Scope Tests\n");

// ── Scopes don't leak into each other. ──────────────────────────────────────
test("editing one scope leaves the others where they were", () => {
  const spec = loadFocusSpec();
  spec.setAllSpecLevels("craft-planner-table", 100);
  spec.setAllSpecLevels("transport-table", 100);
  spec.setAllSpecLevels("crafting-table", 0);
  assert.strictEqual(spec.getItemFCE("T5_HEAD_PLATE_SET1", "crafting-table"), 0);
  assert.strictEqual(spec.getItemFCE("T5_HEAD_PLATE_SET1", "craft-planner-table"), 44500);
  assert.strictEqual(spec.getItemFCE("T5_METALBAR", "transport-table"), 40000);
});

test("the same item costs different focus in two scopes", () => {
  const app = loadFocusSpecWithUtils();
  const base = app.getBaseFocusCost("T5_METALBAR");
  app.setAllSpecLevels("craft-planner-table", 100);
  app.setAllSpecLevels("transport-table", 0);

  const refiner = app.withSpecScope("transport-table", () => app.getFocusCost("T5_METALBAR", 5, "refining"));
  const planner = app.withSpecScope("craft-planner-table", () => app.getFocusCost("T5_METALBAR", 5, "refining"));

  assert.strictEqual(refiner, base, "unspecced scope pays the full base cost");
  // The reduced cost keeps its exact fraction — never pre-rounded.
  assert.ok(Math.abs(planner - base * 0.0625) < 1e-9, "maxed scope keeps 6.25%");
  assert.ok(refiner > planner);
});

// ── Persistence round-trips through localStorage, sparsely. ────────────────
test("levels survive a reload and only non-default ones are stored", () => {
  const store = {};
  const first = loadFocusSpec(store);
  first.setSpecLevel("crafting-table", "CRAFT_SWORDS_SWORD", 40);
  first.setSpecLevel("crafting-table", "CRAFT_AXES_AXE", 0); // its default → not stored

  const raw = JSON.parse(store["specLevels:crafting-table"]);
  assert.deepStrictEqual(raw, { CRAFT_SWORDS_SWORD: 40 });

  const reloaded = loadFocusSpec(store);
  assert.strictEqual(reloaded.getSpecLevel("crafting-table", "CRAFT_SWORDS_SWORD"), 40);
  assert.strictEqual(reloaded.getSpecLevel("crafting-table", "CRAFT_AXES_AXE"), 0);
});

test("resetting a scope drops its storage key entirely", () => {
  const store = {};
  const spec = loadFocusSpec(store);
  spec.setSpecLevel("consumable-table", "FARM_COOK_SOUP", 10);
  assert.ok(store["specLevels:consumable-table"]);
  spec.resetSpecLevels("consumable-table");
  assert.strictEqual(store["specLevels:consumable-table"], undefined);
});

test("corrupt storage is ignored, not thrown on", () => {
  const spec = loadFocusSpec({ "specLevels:crafting-table": "{not json" });
  assert.deepStrictEqual(spec.getSpecLevels("crafting-table"), {});
  assert.strictEqual(spec.getSpecLevel("crafting-table", "CRAFT_SWORDS_SWORD"), 0);
});

test("setSpecLevels replaces a scope in one write", () => {
  const spec = loadFocusSpec();
  spec.setSpecLevels("crafting-table", { CRAFT_SWORDS_SWORD: 20, CRAFT_AXES_AXE: 30 });
  assert.strictEqual(spec.getSpecLevel("crafting-table", "CRAFT_SWORDS_SWORD"), 20);
  spec.setSpecLevels("crafting-table", { CRAFT_AXES_AXE: 30 });
  assert.strictEqual(spec.getSpecLevel("crafting-table", "CRAFT_SWORDS_SWORD"), 0);
  assert.strictEqual(spec.getSpecLevel("crafting-table", "CRAFT_AXES_AXE"), 30);
});

// ── getFocusCost keeps its contract for the rest of the app. ───────────────
test("a level change is picked up immediately (no stale memo)", () => {
  const app = loadFocusSpecWithUtils();
  app.setAllSpecLevels("crafting-table", 100);
  const maxed = app.withSpecScope("crafting-table", () => app.getFocusCost("T5_HEAD_PLATE_SET1", 5, "crafting"));
  app.setSpecLevel("crafting-table", "CRAFT_PLATE_HEADS_SET1", 0);
  const after = app.withSpecScope("crafting-table", () => app.getFocusCost("T5_HEAD_PLATE_SET1", 5, "crafting"));
  assert.ok(after > maxed, `expected a costlier craft after dropping the spec (${after} vs ${maxed})`);
});

test("focus-craftable items never round down to 0 focus (chain-pricing gate)", () => {
  const app = loadFocusSpecWithUtils();
  ["T1_MEAL_SEAWEEDSALAD", "T1_MEAL_GRILLEDFISH", "T4_METALBAR"].forEach((id) => {
    const cost = app.withSpecScope("consumable-table", () => app.getFocusCost(id, Number(id[1]), "crafting"));
    if (app.getBaseFocusCost(id) > 0) assert.ok(cost >= 1, `${id} collapsed to ${cost}`);
  });
});

test("items with no spec nodes ignore the scope entirely", () => {
  const app = loadFocusSpecWithUtils();
  app.setAllSpecLevels("crafting-table", 0);
  ["T5_MOUNT_HORSE", "T7_FURNITUREITEM_TABLE"].forEach((id) => {
    const base = app.getBaseFocusCost(id);
    const cost = app.withSpecScope("crafting-table", () => app.getFocusCost(id, 5, "crafting"));
    assert.strictEqual(cost, base);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
