/**
 * Test: which crafts get a Focus Cost Efficiency reduction is decided by the
 * Destiny Board node data (js/focus-spec-items.js), not by id regexes.
 *
 *   • Furniture (tables/beds/chests/repair kits) has NO focus node → the BASE
 *     cost applies in full. Verified in-game: T7 Grandmaster's Table = 5,627
 *     focus EACH (2 for 11,254), i.e. ~1 craft per 10k focus, not ~80.
 *   • Gathering TOOLS (`_2H_TOOL_`) DO have one (CRAFT_TOOL_*, 40,000 FCE at max
 *     spec → 6.25%). utils.js used to exempt them by regex alongside furniture;
 *     the dump says that was wrong, so they now get the same reduction as a
 *     refine. (The ×0.0221 that exemption was written to avoid was the cooking
 *     multiplier being misapplied to gear — a separate, now-fixed bug.)
 *   • Gathering GEAR shares those tool nodes and keeps its reduction.
 *
 * Run: node tests/furniture-focus-no-spec.test.cjs
 */

const assert = require("assert");
const { loadFocusSpecWithUtils } = require("./helpers/load-focus-spec.cjs");

const app = loadFocusSpecWithUtils();
// The tool figures below are max-spec readings, so max the ambient store these
// calls read (an untouched node is 0 now — tests/focus-spec-default-levels).
app.setAllSpecLevels("", 100);
const { getFocusCost, getCraftFocusCost, getBaseFocusCost } = app;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Furniture / Tools Focus Spec Tests\n");

test("getCraftFocusCost is exported from utils", () => {
  assert.strictEqual(typeof getCraftFocusCost, "function");
});

// ── Furniture → base focus cost, no reduction at any spec level. ───────────
const furniture = [
  ["T4_FURNITUREITEM_TABLE", 1050],
  ["T5_FURNITUREITEM_TABLE", 1838],
  ["T6_FURNITUREITEM_TABLE", 3216],
  ["T7_FURNITUREITEM_TABLE", 5627],
  ["T8_FURNITUREITEM_TABLE", 9848],
  ["T8_FURNITUREITEM_BED", null],
  ["T4_FURNITUREITEM_CHEST", null],
  ["T8_FURNITUREITEM_REPAIRKIT", null],
];
furniture.forEach(([id, expected]) => {
  const tier = parseInt(id[1], 10);
  test(`${id} uses base focus (no spec node)`, () => {
    const base = getBaseFocusCost(id);
    assert.ok(base > 0, "furniture should be focus-craftable");
    if (expected != null) assert.strictEqual(base, expected);
    assert.strictEqual(getCraftFocusCost(id, tier), base);
    assert.strictEqual(getFocusCost(id, tier, "crafting"), base);
  });
});

test("T7 table → ~1 craft per 10k focus (not ~80)", () => {
  assert.strictEqual(Math.floor(10000 / getCraftFocusCost("T7_FURNITUREITEM_TABLE", 7)), 1);
});

// ── Gathering tools DO have a specialization: 6.25% at max spec. ───────────
// Gathering tools: 40,000 FCE (0.6 tree + 2.5 specialization + 3×0.3 gear
// siblings) → 6.25%. The siege hammer lands on the same 40,000 by a different
// split (0.3 tree + 0.3 sibling + 3.4 own specialist). It used to read 9,000
// here, which was a parser bug, not the game: its specialist's 3.1 group bonus
// is written `mintier maxtier type bonus` in achievements.xml and was skipped
// (see tests/focus-spec-bonus-parse.test.cjs).
const tools = [
  ["T4_2H_TOOL_PICK", 429, 27],
  ["T4_2H_TOOL_PICK_AVALON", 429, 27],
  ["T8_2H_TOOL_PICK", 4021, 251],
  ["T7_2H_TOOL_FISHINGROD", 2298, 144],
  ["T4_2H_TOOL_SIEGEHAMMER", 858, 54],
];
tools.forEach(([id, base, want]) => {
  const tier = parseInt(id[1], 10);
  test(`${id} → ${want} focus at max tool spec (base ${base})`, () => {
    assert.strictEqual(getBaseFocusCost(id), base);
    // The reduced cost keeps its fraction (the game bills fractions); these
    // anchors are the figure a row prints, i.e. the rounded charge.
    assert.strictEqual(Math.round(getCraftFocusCost(id, tier)), want);
  });
});

test("dropping the pickaxe node to 0 puts a tool back on its base cost", () => {
  const scoped = loadFocusSpecWithUtils();
  scoped.setSpecLevel("crafting-table", "CRAFT_TOOL_PICK", 0);
  const cost = scoped.withSpecScope("crafting-table", () =>
    scoped.getCraftFocusCost("T4_2H_TOOL_PICK", 4)
  );
  // Only the sibling category bonuses (armor/head/shoes nodes) remain.
  assert.ok(cost > 27 && cost <= 429, `expected a costlier craft, got ${cost}`);
});

// ── Gear and gathering gear keep a reduction. ──────────────────────────────
["T4_MAIN_SWORD", "T8_ARMOR_PLATE_SET1", "T5_CAPE", "T8_ARMOR_GATHERER_WOOD"].forEach((id) => {
  const tier = parseInt(id[1], 10);
  test(`${id} still gets a focus reduction`, () => {
    assert.strictEqual(getCraftFocusCost(id, tier), getFocusCost(id, tier, "crafting"));
    assert.ok(getCraftFocusCost(id, tier) < getBaseFocusCost(id));
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
