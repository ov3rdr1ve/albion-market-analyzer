/**
 * Test: focusSpecExplain / focusSpecTitle (js/focus-spec-explain.js).
 *
 * A Destiny Board node the user never typed reads a default (0, or 100 for the
 * mastery heading its group), and that is INVISIBLE: before 2026-08-04 the
 * default was 100 everywhere, so setting two nodes in a table's ⚙ panel left the
 * rest silently maxed and a partially-specced player read a focus number several
 * times too small with nothing on the row to explain it. The real case this was
 * written for:
 *
 *   T6 Avalonian Stew, base 176 (items.xml craftingfocus, per output unit)
 *   in-game Chef 100 / Stew Chef 17 / Butcher 100 / 19 levels over the rest
 *     → 11,326 FCE → 80 focus each
 *   app with only Chef and Stew Chef touched (8 siblings left at 100)
 *     → 31,760 FCE → 19 focus each
 *
 * Both numbers are "right"; only one matches the player. So the tooltip must
 * name the base, the FCE, the levels it used and — the whole point — how many
 * nodes are still sitting at the assumed 100.
 *
 * Black-box: pure input→output over the two exported functions, localStorage
 * stubbed by the shared loader.
 *
 * Run: node tests/focus-spec-explain.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadFocusSpecWithUtils } = require("./helpers/load-focus-spec.cjs");

const ROOT = path.join(__dirname, "..");

// The explainer is a plain browser script; compile it into the same scope as the
// focus-spec pipeline, exactly as index.html loads it.
function loadExplainer() {
  const api = loadFocusSpecWithUtils();
  const src = fs.readFileSync(path.join(ROOT, "js/focus-spec-explain.js"), "utf-8")
    .replace(/if \(typeof module[\s\S]*$/, "");
  const build = new Function(
    "FOCUS_SPEC_NODES", "specNodesForItem", "getSpecLevel", "getItemFCE",
    "focusSpecMultiplier", "getBaseFocusCost", "SPEC_LEVEL_MAX", "currentSpecScope",
    "defaultSpecLevel",
    `${src}\nreturn { focusSpecExplain, focusSpecTitle, focusSpecMark, FOCUS_SPEC_TOOLTIP_NODES };`
  );
  return Object.assign(api, build(
    api.FOCUS_SPEC_NODES, api.specNodesForItem, api.getSpecLevel, api.getItemFCE,
    api.focusSpecMultiplier, api.getBaseFocusCost, api.SPEC_LEVEL_MAX, api.currentSpecScope,
    api.defaultSpecLevel
  ));
}

// The reported in-game character: Chef 100, Stew Chef 17, Butcher 100 and 19
// levels spread over the seven remaining cooking specializations.
const REPORTED_COOK = {
  FARM_COOK: 100, FARM_COOK_MEAT: 100, FARM_COOK_STEW: 17,
  FARM_COOK_OMELETTE: 5, FARM_COOK_PIE: 5, FARM_COOK_ROAST: 5,
  FARM_COOK_SALAD: 2, FARM_COOK_SANDWICH: 1, FARM_COOK_SOUP: 1,
};

function withLevels(levels) {
  const api = loadExplainer();
  api.setAllSpecLevels("consumable-table", 0);
  Object.entries(levels).forEach(([node, level]) =>
    api.setSpecLevel("consumable-table", node, level));
  return api;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Focus Spec Explain Tests\n");

// ── The explained figure IS the figure on the row. ────────────────────────
test("cost equals getFocusCost for the same item and scope", () => {
  const api = withLevels(REPORTED_COOK);
  api.withSpecScope("consumable-table", () => {
    ["T6_MEAL_STEW_AVALON", "T8_MEAL_STEW", "T4_MEAL_SALAD"].forEach((id) => {
      const info = api.focusSpecExplain(id, { scope: "consumable-table" });
      // The explainer feeds a tooltip, so it reports the ROUNDED charge; the
      // arithmetic path (getFocusCost) keeps the exact fraction the game bills.
      assert.strictEqual(info.cost, api.getFocusCost(id, 6, "crafting"), id);
    });
  });
});

// The renderers call focusSpecTitle(item.id) from inside withSpecScope without
// naming a scope. Reading the levels off the empty scope there would print
// "every node at 100" beside an FCE computed from the table's real levels — the
// tooltip contradicting the number it exists to explain.
test("an omitted scope falls back to the ambient one, not the empty scope", () => {
  const api = withLevels(REPORTED_COOK);
  const named = api.focusSpecExplain("T6_MEAL_STEW_AVALON", { scope: "consumable-table" });
  const ambient = api.withSpecScope("consumable-table", () =>
    api.focusSpecExplain("T6_MEAL_STEW_AVALON"));
  assert.deepStrictEqual(ambient.nodes, named.nodes);
  assert.strictEqual(ambient.fce, named.fce);
  assert.strictEqual(ambient.cost, named.cost);
  const stew = ambient.nodes.find((n) => n.nodeId === "FARM_COOK_STEW");
  assert.strictEqual(stew.level, 17, "the ambient scope's real level must show");
});

test("base is items.xml craftingfocus, per output unit", () => {
  const api = loadExplainer();
  const info = api.focusSpecExplain("T6_MEAL_STEW_AVALON", {});
  assert.strictEqual(info.base, 176);
});

test("an explicit base overrides the per-unit one (butcher charges per animal)", () => {
  const api = loadExplainer();
  const info = api.focusSpecExplain("T5_MEAT", { base: 38 * 18 });
  assert.strictEqual(info.base, 684);
  assert.ok(Math.abs(info.cost - 684 * info.multiplier) < 1e-9);
});

// ── The reported reading is reproduced exactly. ───────────────────────────
test("the reported cook levels reproduce the in-game 80 focus/each stew", () => {
  const api = withLevels(REPORTED_COOK);
  const info = api.focusSpecExplain("T6_MEAL_STEW_AVALON", { scope: "consumable-table" });
  // 176 × 0.5^1.133 = 80.30 — the figure the game itself prints, to the decimal.
  assert.strictEqual(info.fce, 11330);
  assert.strictEqual(Math.round(info.cost), 80);
});

test("the old max-spec default reproduces the app's old 19", () => {
  const api = loadExplainer();
  api.setAllSpecLevels("consumable-table", 100); // what an untouched node used to read
  api.setSpecLevel("consumable-table", "FARM_COOK_STEW", 17);
  const info = api.focusSpecExplain("T6_MEAL_STEW_AVALON", { scope: "consumable-table" });
  assert.strictEqual(Math.round(info.cost), 19);
});

test("nothing typed at all → only the Cook mastery counts (143 focus)", () => {
  const api = loadExplainer();
  const info = api.focusSpecExplain("T6_MEAL_STEW_AVALON", { scope: "consumable-table" });
  assert.strictEqual(info.fce, 3000, "the mastery alone, at its 100 default");
  assert.strictEqual(Math.round(info.cost), 143);
  assert.strictEqual(info.atDefault, 10, "all ten cook nodes are untouched");
});

// ── atDefault is the count the tooltip exists to surface. ─────────────────
test("atDefault counts exactly the nodes still on their default level", () => {
  const api = withLevels({ FARM_COOK: 100, FARM_COOK_STEW: 100, FARM_COOK_MEAT: 50 });
  const info = api.focusSpecExplain("T6_MEAL_STEW_AVALON", { scope: "consumable-table" });
  // Chef 100 IS its default; Stew Chef 100 and Butcher 50 are not; the other
  // seven were set to 0, which is theirs.
  const onDefault = info.nodes.filter(
    (n) => n.level === api.defaultSpecLevel(n.nodeId)).length;
  assert.strictEqual(info.atDefault, onDefault);
  assert.strictEqual(info.atDefault, 8);
});

test("nodes come back heaviest-bonus first", () => {
  const api = loadExplainer();
  const info = api.focusSpecExplain("T6_MEAL_STEW_AVALON", { scope: "consumable-table" });
  assert.strictEqual(info.nodes[0].nodeId, "FARM_COOK_STEW");
  assert.strictEqual(info.nodes[0].bonus, 2.8);
  for (let i = 1; i < info.nodes.length; i++) {
    assert.ok(info.nodes[i - 1].bonus >= info.nodes[i].bonus, "bonus order");
  }
});

// ── Items with no specialization at all. ─────────────────────────────────
test("an item with no spec node reports hasSpec false and the base cost", () => {
  const api = loadExplainer();
  // Furniture genuinely has no Destiny Board focus node, so it pays base cost.
  const info = api.focusSpecExplain("T2_FURNITUREITEM_BED", {});
  assert.strictEqual(info.hasSpec, false);
  assert.strictEqual(info.multiplier, 1);
  assert.strictEqual(info.nodes.length, 0);
  assert.strictEqual(info.cost, info.base);
  assert.strictEqual(info.cost, 171);
});

test("an item with no focus cost at all returns a zero explanation, no throw", () => {
  const api = loadExplainer();
  ["T1_FISHCHOPS", "", null, undefined, "NOT_A_REAL_ID"].forEach((id) => {
    const info = api.focusSpecExplain(id, {});
    assert.strictEqual(info.base, 0);
    assert.strictEqual(info.cost, 0);
    assert.strictEqual(info.nodes.length, 0);
  });
});

// ── The title string. ────────────────────────────────────────────────────
test("the title names the cost, the base, the FCE and the default count", () => {
  const api = loadExplainer();
  api.setAllSpecLevels("consumable-table", 100);
  api.setSpecLevel("consumable-table", "FARM_COOK_STEW", 17);
  const title = api.focusSpecTitle("T6_MEAL_STEW_AVALON", { scope: "consumable-table" });
  // The tooltip prints the exact charge to two decimals, same as the cell.
  assert.ok(title.includes("19.47 focus"), title);
  assert.ok(title.includes("base 176"), title);
  assert.ok(title.includes("31,760 FCE"), title);
  assert.ok(title.includes("Stew Chef 17"), title);
  // Every node was typed to 100 except the Cook mastery, which sits on its own
  // default — so exactly one is still assumed.
  assert.ok(/1 node at their default/.test(title), title);
  assert.ok(/⚙ Specs/.test(title), title);
});

// Every cook node off its default: the mastery below 100 and Products above 0.
const FULLY_TYPED_COOK = Object.assign({}, REPORTED_COOK, {
  FARM_COOK: 99, FARM_COOK_PRODUCTS: 1,
});

test("the default clause disappears once every node is typed off its default", () => {
  const api = withLevels(FULLY_TYPED_COOK);
  const title = api.focusSpecTitle("T6_MEAL_STEW_AVALON", { scope: "consumable-table" });
  assert.ok(!/at their default/.test(title), title);
});

test("a node genuinely typed at its default level is still reported in the count", () => {
  // The level store is sparse — a typed default and an untouched node are the
  // same stored state. The clause counts both, and says so.
  const api = withLevels(REPORTED_COOK);
  const info = api.focusSpecExplain("T6_MEAL_STEW_AVALON", { scope: "consumable-table" });
  assert.strictEqual(info.atDefault, 2,
    "Cook was typed at its 100 default, Cook Products left at its 0 one");
  const title = api.focusSpecTitle("T6_MEAL_STEW_AVALON", { scope: "consumable-table" });
  assert.ok(title.includes("80.25 focus"), title);
  assert.ok(/2 nodes at their default/.test(title), title);
});

// ── The row's one-character mark. ────────────────────────────────────────
test("focusSpecMark flags a figure resting on untouched nodes, and only that", () => {
  const untouched = loadExplainer();
  assert.strictEqual(
    untouched.focusSpecMark("T6_MEAL_STEW_AVALON", { scope: "consumable-table" }), "*");

  const typed = withLevels(FULLY_TYPED_COOK);
  assert.strictEqual(
    typed.focusSpecMark("T6_MEAL_STEW_AVALON", { scope: "consumable-table" }), "");

  // No specialization at all (furniture) and no focus cost at all: nothing to mark.
  assert.strictEqual(untouched.focusSpecMark("T2_FURNITUREITEM_BED", {}), "");
  assert.strictEqual(untouched.focusSpecMark("T1_FISHCHOPS", {}), "");
});

test("the node list is capped, with the remainder summarised", () => {
  const api = loadExplainer();
  const title = api.focusSpecTitle("T6_MEAL_STEW_AVALON", { scope: "consumable-table" });
  const named = (title.match(/Cook/g) || []).length;
  assert.ok(named <= api.FOCUS_SPEC_TOOLTIP_NODES + 1, `too many nodes named: ${title}`);
  assert.ok(/\+\d+ more/.test(title), title);
});

test("an unspecced item says so instead of printing a bogus formula", () => {
  const api = loadExplainer();
  const title = api.focusSpecTitle("T2_FURNITUREITEM_BED", {});
  assert.ok(/no focus specialization/.test(title), title);
  assert.ok(!/FCE/.test(title), title);
});

test("an item with no focus cost yields an empty title", () => {
  const api = loadExplainer();
  assert.strictEqual(api.focusSpecTitle("T1_FISHCHOPS", {}), "");
  assert.strictEqual(api.focusSpecTitle(null, {}), "");
});

// ── It lands in a title="…" attribute, so it must be attribute-safe. ─────
test("the title never contains a raw quote or angle bracket", () => {
  const api = loadExplainer();
  ["T6_MEAL_STEW_AVALON", "T8_MEAL_STEW", "T5_MEAT", "T5_JOURNAL_ORE_EMPTY"].forEach((id) => {
    const title = api.focusSpecTitle(id, { scope: "consumable-table" });
    assert.ok(!/["<>]/.test(title), `${id}: ${title}`);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
