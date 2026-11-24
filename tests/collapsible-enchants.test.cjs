/**
 * Test: Collapsible enchant variants in the crafting table.
 * Variant rows (@1-@4) are hidden by default, shown when base item is expanded.
 *
 * Run: node tests/collapsible-enchants.test.cjs
 */

const fs = require("fs");
const { appSource } = require("./helpers/app-source.cjs");
const path = require("path");
const assert = require("assert");

const sortingSrc = fs.readFileSync(path.join(__dirname, "..", "js/sorting.js"), "utf-8");
// The crafting rows live in two files (the no-data row was split out of
// render-crafting.js at the 800-line cap). Read the whole family, so a split
// never reads as a missing feature.
const craftSrc = ["js/render-crafting.js", "js/render-crafting-no-data-row.js"]
  .map((f) => fs.readFileSync(path.join(__dirname, "..", f), "utf-8")).join("\n");
const appSrc = appSource();

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

console.log("Collapsible Enchant Variants Tests\n");

// -- expandedCraftItems Set exists --
test("expandedCraftItems Set is defined in sorting.js", () => {
  assert.ok(sortingSrc.includes("const expandedCraftItems = new Set()"));
});

// -- Variant filtering in updateTableDisplay --
test("updateTableDisplay filters @-variants for crafting-table", () => {
  assert.ok(sortingSrc.includes('tableId === "crafting-table"'));
  // Expansion is per table (expandedCraftItemsFor), not one set for all.
  assert.ok(sortingSrc.includes("expandedCraftItemsFor(tableId).has(baseId)"));
});

test("variant filter extracts baseId by removing @N suffix", () => {
  assert.ok(sortingSrc.includes('.replace(/@\\d+$/, "")'));
});

test("base items (no @) always pass the filter", () => {
  // The gate now asks the ROW, not the id: isEnchantVariantRow answers false
  // for a base item AND for a row flagged topLevelVariant (a Waystone's @n is
  // a difficulty, not an enchant). See tests/top-level-variant-rows.test.cjs.
  assert.ok(sortingSrc.includes("function isEnchantVariantRow(row)"));
  assert.ok(sortingSrc.includes("if (item.topLevelVariant) return false;"));
  assert.ok(sortingSrc.includes("if (!isEnchantVariantRow(row)) return true;"));
});

// -- Expand toggle in crafting formatter --
test("crafting formatter adds data-expand-craft attribute for base gear items", () => {
  assert.ok(craftSrc.includes("data-expand-craft="));
});

test("crafting formatter checks isGearRecipe && !includes(@) for expand toggle", () => {
  assert.ok(craftSrc.includes('item.isGearRecipe && !item.id.includes("@")'));
});

test("crafting formatter indents variant rows", () => {
  assert.ok(craftSrc.includes("padding-left:1.5em"));
});

test("expand icon shows ▶ when collapsed and ▼ when expanded", () => {
  assert.ok(craftSrc.includes('"▼"') || craftSrc.includes("'▼'"));
  assert.ok(craftSrc.includes('"▶"') || craftSrc.includes("'▶'"));
});

// -- Click handler in app.js --
test("app.js has click handler for [data-expand-craft]", () => {
  assert.ok(appSrc.includes("[data-expand-craft]"));
  assert.ok(appSrc.includes("expandedCraftItemsFor(tableId).delete(baseId)"));
  assert.ok(appSrc.includes("expandedCraftItemsFor(tableId).add(baseId)"));
});

test("click handler refreshes the originating table", () => {
  // The toggle's data-expand-table attribute selects which table to refresh,
  // defaulting to crafting-table when omitted (legacy behavior). This lets
  // the same handler power both gear and consumables expansion.
  assert.ok(
    appSrc.includes('toggle.dataset.expandTable || "crafting-table"'),
    "expected click handler to read data-expand-table with crafting-table fallback"
  );
  assert.ok(appSrc.includes("updateTableDisplay(tableId)"));
});

test("consumables formatter wires data-expand-table to consumable-table", () => {
  const consumablesSrc = ["render-consumables", "render-consumables-row"].map((n) => fs.readFileSync(path.join(__dirname, "..", "js/" + n + ".js"), "utf-8")).join("\n");
  assert.ok(
    consumablesSrc.includes('data-expand-table="consumable-table"'),
    "expected consumables renderer to set data-expand-table='consumable-table'"
  );
});

test("sorting filter applies @-variant collapse to consumable-table", () => {
  assert.ok(
    sortingSrc.includes('tableId === "crafting-table" || tableId === "consumable-table"'),
    "consumable-table should also gate variant rows on expandedCraftItems"
  );
});

test("sorting filter applies @-variant collapse to craft-planner-table", () => {
  assert.ok(
    sortingSrc.includes('tableId === "craft-planner-table"'),
    "craft-planner-table should also gate/group variant rows on expandedCraftItems"
  );
});

test("craft-planner renderer wires data-expand-table to craft-planner-table", () => {
  const plannerSrc = fs.readFileSync(
    path.join(__dirname, "..", "js/render-craft-planner.js"),
    "utf-8"
  );
  assert.ok(
    plannerSrc.includes('data-expand-table="craft-planner-table"'),
    "expected the craft-planner renderer to set data-expand-table='craft-planner-table'"
  );
});

// -- Both no-data and normal formatters have expand logic --
test("both no-data and normal row formatters have expand toggle", () => {
  const expandCount = (craftSrc.match(/data-expand-craft=/g) || []).length;
  assert.ok(expandCount >= 2, `Expected at least 2 expand-craft attrs, found ${expandCount}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
