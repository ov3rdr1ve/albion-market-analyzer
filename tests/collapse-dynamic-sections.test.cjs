/**
 * Test: collapse state on blocks that JS builds after setupCollapsibleTables
 * runs — each one folds its own block, under a state key of its own, with its
 * ▶/▼ arrow in step with what is shown.
 *
 * The blocks:
 *   - the enchant-variant ▶/▼ on a base row in Crafting, Consumables, the Craft
 *     Planner and Flipping (rows rebuilt on every render);
 *   - the Rolling table's category and roll-type group rows;
 *   - the Top-10 boards' detail rows (scoped per board already — pinned here).
 *
 * Bug: the four tables shared ONE expand set keyed by base id. Expanding
 * T4_MAIN_SWORD's .1–.4 in Crafting also opened them in the Craft Planner and
 * Flipping on their next render — and the planner's rows came up unpriced,
 * because only the clicked table fetches its variants.
 *
 * Black-box over the real js/sorting.js (updateTableDisplay with a fake tbody),
 * js/flip-enchant-variants.js + js/flip-auto-reveal.js, js/joined-summary-jump.js,
 * js/joined-summary-detail.js and the Rolling collapse in js/app-row-overrides.js.
 * Simulated rows, no live APIs.
 *
 * Run: node tests/collapse-dynamic-sections.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── updateTableDisplay over a fake tbody ─────────────────────────────────────
const tbodies = {};
global.document = {
  querySelector(sel) {
    const m = sel.match(/^#([\w-]+) tbody$/);
    return m ? (tbodies[m[1]] ||= { innerHTML: "", style: {} }) : null;
  },
  querySelectorAll: () => [],
  getElementById: (id) => (id === "show-all-items" ? { checked: false } : null),
};
global.window = { scrollY: 0, scrollTo() {} };
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const sortingMod = new Module("collapse-dynamic-sorting");
sortingMod._compile(
  [
    "function tx(s) { return s; }",
    "function isBlackRedZoneEnabled() { return true; }",
    "function isTableHidden() { return false; }",
    J("sorting-row-key.js"),
    J("sorting.js"),
    "module.exports = { updateTableDisplay, tableState, expandedCraftItems, COLLAPSE_VARIANT_TABLES,"
      + " expandedCraftItemsFor: typeof expandedCraftItemsFor === 'function' ? expandedCraftItemsFor : null };",
  ].join("\n"),
  "collapse-dynamic-sorting.js",
);
const S = sortingMod.exports;

const BASE = "T4_MAIN_SWORD";
const row = (id) => ({ item: { id, isGearRecipe: true }, marginInfo: { margin: 25 }, hasData: true });

function painted(tableId) {
  tbodies[tableId] = { innerHTML: "", style: {} };
  S.tableState[tableId] = {
    data: [row(BASE), row(`${BASE}@1`)],
    sortCol: "margin",
    sortDir: "desc",
    formatter: (r) => `<tr data-id="${r.item.id}"></tr>`,
  };
  S.updateTableDisplay(tableId);
  return [...tbodies[tableId].innerHTML.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
}

/** Forget every table's expansions. */
function resetExpanded() {
  S.expandedCraftItems.clear();
  if (S.expandedCraftItemsFor) [...S.COLLAPSE_VARIANT_TABLES, "flipping-table"].forEach((t) => S.expandedCraftItemsFor(t).clear());
}

const VARIANT_TABLES = [...S.COLLAPSE_VARIANT_TABLES];

console.log("\n=== enchant-variant expand: one state per table ===");

test("each table has an expand set of its own", () => {
  assert.ok(S.expandedCraftItemsFor, "expandedCraftItemsFor(tableId) exists");
  const sets = [...VARIANT_TABLES, "flipping-table"].map((t) => S.expandedCraftItemsFor(t));
  assert.strictEqual(new Set(sets).size, sets.length, "no two tables share a set");
  assert.strictEqual(S.expandedCraftItemsFor("crafting-table"), S.expandedCraftItems,
    "Crafting keeps the original set");
});

for (const opened of VARIANT_TABLES) {
  for (const other of VARIANT_TABLES.filter((t) => t !== opened)) {
    test(`expanding ${BASE} in ${opened} does not open it in ${other}`, () => {
      resetExpanded();
      S.expandedCraftItemsFor(opened).add(BASE);
      assert.deepStrictEqual(painted(opened), [BASE, `${BASE}@1`], `${opened} shows its variant`);
      assert.deepStrictEqual(painted(other), [BASE], `${other} keeps it collapsed`);
    });
  }
}

// ── Flipping: its own set, plus the auto-reveal pass ─────────────────────────
const flipMod = new Module("collapse-dynamic-flip");
flipMod._compile(
  [
    "function activeEnchantFilter() { return ''; }",
    "function hasEnchantVariants() { return true; }",
    `const expandedCraftItems = new Set();`,
    "const __sets = new Map([['crafting-table', expandedCraftItems]]);",
    "function expandedCraftItemsFor(t) { if (!__sets.has(t)) __sets.set(t, new Set()); return __sets.get(t); }",
    J("flip-enchant-variants.js"),
    J("flip-auto-reveal.js"),
    "module.exports = { expandFlipItems, flipToggleExpand, isFlipExpanded, expandedCraftItems, expandedCraftItemsFor };",
  ].join("\n"),
  "collapse-dynamic-flip.js",
);
const F = flipMod.exports;

test("Flipping: a base expanded in Crafting stays collapsed on the Flipping board", () => {
  F.expandedCraftItems.add(BASE);
  const ids = F.expandFlipItems([{ id: BASE }], { autoLevels: () => [] }).map((i) => i.id);
  assert.deepStrictEqual(ids, [BASE]);
  assert.strictEqual(F.isFlipExpanded(BASE), false, "the Flipping arrow reads ▶");
  F.expandedCraftItems.clear();
});

test("Flipping: its own ▶ click opens only Flipping's state", () => {
  assert.strictEqual(F.flipToggleExpand(BASE), true);
  assert.ok(F.expandedCraftItemsFor("flipping-table").has(BASE));
  assert.ok(!F.expandedCraftItems.has(BASE), "Crafting is untouched");
  assert.strictEqual(F.flipToggleExpand(BASE), false, "and closes again");
  assert.ok(!F.expandedCraftItemsFor("flipping-table").has(BASE));
});

// ── Arrows read the same per-table state the row filter reads ────────────────
const ARROWS = [
  ["render-consumables-row.js", "consumable-table"],
  ["render-craft-planner.js", "craft-planner-table"],
];
for (const [file, tableId] of ARROWS) {
  test(`${file}: its ▶/▼ reads ${tableId}'s own expand state`, () => {
    const src = J(file);
    const arrow = src.split("\n").find((l) => l.includes(`data-expand-craft=`) && l.includes(`data-expand-table="${tableId}"`));
    assert.ok(arrow, "has a toggle for this table");
    assert.ok(arrow.includes(`expandedCraftItemsFor("${tableId}")`)
      || /_\w*Expanded\(item\.id\)/.test(arrow), `arrow reads ${tableId}'s set`);
  });
}

test("the [data-expand-craft] click toggles the clicked table's set", () => {
  const src = J("app-scan-controls.js");
  const handler = src.slice(src.indexOf('closest("[data-expand-craft]")'), src.indexOf("jbOpenDetailRows"));
  assert.match(handler, /expandedCraftItemsFor\(tableId\)/);
});

// ── Top-10 jump: reveals the variant in its own table only ───────────────────
const jumpMod = new Module("collapse-dynamic-jump");
jumpMod._compile(J("joined-summary-jump.js") + "\nmodule.exports = { jbRevealVariant };", "jump.js");
test("Top-10 jump to an @n row expands the base in that row's table only", () => {
  const seen = {};
  const d = {
    collapseVariantTables: new Set(VARIANT_TABLES),
    expandedFor: (t) => (seen[t] ||= new Set()),
    updateTableDisplay() {},
  };
  assert.ok(jumpMod.exports.jbRevealVariant("consumable-table", "T6_MEAL_STEW@2", d));
  assert.deepStrictEqual(Object.keys(seen), ["consumable-table"]);
  assert.ok(seen["consumable-table"].has("T6_MEAL_STEW"));
});

// ── Top-10 detail rows: already per board ────────────────────────────────────
const detailMod = new Module("collapse-dynamic-detail");
detailMod._compile(J("joined-summary-detail.js") + "\nmodule.exports = { jbDetailKey };", "detail.js");
test("Top-10 detail rows: the same play on two boards has two keys", () => {
  const r = { tableId: "crafting-table", rowKey: "k" };
  const a = detailMod.exports.jbDetailKey("joined-profit-table", r);
  const b = detailMod.exports.jbDetailKey("joined-focus-table", r);
  assert.notStrictEqual(a, b);
});

// ── Rolling group rows ───────────────────────────────────────────────────────
function rollingRow(data) {
  const ind = { textContent: "" };
  return { dataset: data, style: {}, querySelector: (s) => (s === ".cind" ? ind : null), ind };
}
const rows = [
  rollingRow({ headerCat: "Rune" }),
  rollingRow({ headerRoll: "Any", rollCat: "Rune" }),
  rollingRow({ cat: "Rune", rollKey: "Rune:Any" }),
  rollingRow({ headerCat: "Soul" }),
  rollingRow({ headerRoll: "Any", rollCat: "Soul" }),
  rollingRow({ cat: "Soul", rollKey: "Soul:Any" }),
];
const rollMod = new Module("collapse-dynamic-rolling");
global.__rollingRows = rows;
rollMod._compile(
  "const document = { querySelector: (s) => (s === '#rolling-table tbody' ? { rows: global.__rollingRows } : null) };\n"
    + J("app-row-overrides.js")
    + "\nmodule.exports = { rollingCatCollapsed, rollingRollCollapsed, applyRollingCollapsed };",
  "rolling.js",
);
const R = rollMod.exports;

test("Rolling: the same roll type in two categories folds independently", () => {
  R.rollingRollCollapsed.add("Rune:Any");
  R.applyRollingCollapsed();
  assert.strictEqual(rows[2].style.display, "none", "Rune › Any rows hidden");
  assert.strictEqual(rows[5].style.display, "", "Soul › Any rows still shown");
  assert.strictEqual(rows[1].ind.textContent, " ▶");
  assert.strictEqual(rows[4].ind.textContent, " ▼");
  R.rollingRollCollapsed.clear();
});

test("Rolling: folding a category hides its rows and flips only its arrow", () => {
  R.rollingCatCollapsed.add("Soul");
  R.applyRollingCollapsed();
  assert.strictEqual(rows[0].ind.textContent, " ▼");
  assert.strictEqual(rows[3].ind.textContent, " ▶");
  assert.strictEqual(rows[4].style.display, "none");
  assert.strictEqual(rows[5].style.display, "none");
  assert.strictEqual(rows[2].style.display, "");
  R.rollingCatCollapsed.clear();
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
