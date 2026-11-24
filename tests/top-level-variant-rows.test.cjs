/**
 * Test: a catalog row whose id ends in @n but that is NOT an enchant variant.
 *
 * Crafting, Consumables and the Craft Planner collapse enchant variants under
 * their base item: updateTableDisplay hides any row whose id contains "@"
 * unless the base is expanded or the enchant picker asks for that level. That
 * rule assumes "@" always means "the .1/.2/.3 form of a base row that also
 * exists in the same table".
 *
 * Dragon Sanctuary Waystones (Dragonfire, 2026-08-31) break the assumption.
 * items.xml carries their difficulty D1–D4 as enchantment levels 1–4, so their
 * marketplace ids genuinely end in @1…@4 — but there is no base T{n}_…_D1 row
 * to nest under, and each difficulty is a separate craft with its own recipe.
 * Under the id-sniffing rule all twelve rows are permanently invisible.
 *
 * The fix follows the pattern the Flipping table already documents for its
 * resource _LEVELn@n rows: ask the ROW, not the id. A catalog entry that is a
 * top-level row despite its @n suffix carries `topLevelVariant: true`.
 *
 * Black-box: drives the real updateTableDisplay against a tiny fake DOM and a
 * formatter that just prints the id. No live API or DB.
 *
 * Run: node tests/top-level-variant-rows.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function load(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// ── Fake DOM: a tbody per table, plus the "Show All" checkbox. ──────────────
function makeTbody() {
  return { innerHTML: "", offsetHeight: 0, style: {} };
}
const tbodies = {};
const showAllBox = { checked: false };

const fakeDocument = {
  querySelector(sel) {
    const m = sel.match(/^#([\w-]+) tbody$/);
    if (m) return (tbodies[m[1]] ||= makeTbody());
    return null;
  },
  querySelectorAll() { return []; },
  getElementById(id) {
    if (id === "show-all-items") return showAllBox;
    return null;
  },
};

const stubs = [
  "function tx(s) { return s; }",
  "function isBlackRedZoneEnabled() { return true; }",
  "function isTableHidden() { return false; }",
  "function activeEnchantFilterStub() { return null; }",
  "",
].join("\n");

const mod = new Module("top-level-variant-test");
mod._compile(
  stubs +
    load("js/data-waystones.js") +
    load("js/sorting-row-key.js") +
    load("js/sorting.js") +
    "\nmodule.exports = { WAYSTONES, updateTableDisplay, tableState, expandedCraftItems, expandedCraftItemsFor, COLLAPSE_VARIANT_TABLES };",
  "top-level-variant-test.js"
);

// sorting.js reaches for these as globals at call time.
global.document = fakeDocument;
global.window = { scrollY: 0, scrollTo() {} };

const { WAYSTONES, updateTableDisplay, tableState, expandedCraftItems, expandedCraftItemsFor, COLLAPSE_VARIANT_TABLES } =
  mod.exports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

const profitable = (item) => ({ item, marginInfo: { margin: 25 }, hasData: true });

/** Render `rows` into `tableId` and return the ids that actually painted. */
function render(tableId, rows) {
  tbodies[tableId] = makeTbody();
  tableState[tableId] = {
    data: rows,
    sortCol: "margin",
    sortDir: "desc",
    formatter: (r) => "<tr data-id=\"" + r.item.id + "\"></tr>",
  };
  showAllBox.checked = false;
  updateTableDisplay(tableId);
  return [...tbodies[tableId].innerHTML.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
}

console.log("\n=== The catalog marks Waystones as top-level ===");
test("every Waystone carries topLevelVariant", () => {
  for (const w of WAYSTONES) {
    assert.strictEqual(w.topLevelVariant, true, w.id + " is missing topLevelVariant");
  }
});
test("their ids really do end in @n", () => {
  for (const w of WAYSTONES) assert.ok(/@\d$/.test(w.id), w.id + " has no @n suffix");
});

console.log("\n=== The variant collapse keeps them, and still hides real variants ===");
for (const tableId of [...COLLAPSE_VARIANT_TABLES]) {
  test(tableId + ": all 12 flagged @n rows paint with nothing expanded", () => {
    expandedCraftItems.clear();
    const ids = render(tableId, WAYSTONES.map(profitable));
    assert.strictEqual(ids.length, 12, "painted " + ids.length + " rows");
    assert.deepStrictEqual(ids.slice().sort(), WAYSTONES.map((w) => w.id).sort());
  });
  test(tableId + ": an ordinary enchant variant is still hidden", () => {
    expandedCraftItems.clear();
    const ids = render(tableId, [
      profitable({ id: "T8_HEAD_LEATHER_DRAGON", isGearRecipe: true }),
      profitable({ id: "T8_HEAD_LEATHER_DRAGON@1", isGearRecipe: true }),
    ]);
    assert.deepStrictEqual(ids, ["T8_HEAD_LEATHER_DRAGON"],
      "the .1 variant must stay collapsed under its base");
  });
  test(tableId + ": expanding the base still reveals its real variant", () => {
    expandedCraftItemsFor(tableId).clear();
    expandedCraftItemsFor(tableId).add("T8_HEAD_LEATHER_DRAGON");
    const ids = render(tableId, [
      profitable({ id: "T8_HEAD_LEATHER_DRAGON", isGearRecipe: true }),
      profitable({ id: "T8_HEAD_LEATHER_DRAGON@1", isGearRecipe: true }),
    ]);
    assert.deepStrictEqual(ids, ["T8_HEAD_LEATHER_DRAGON", "T8_HEAD_LEATHER_DRAGON@1"]);
    expandedCraftItemsFor(tableId).clear();
  });
}

console.log("\n=== Flagged rows are not nested under a phantom base ===");
test("a mixed crafting table paints the map row and both Waystones", () => {
  expandedCraftItems.clear();
  const ids = render("crafting-table", [
    profitable({ id: "T6_CORRUPTED_LETHAL_MAP" }),
    ...WAYSTONES.slice(0, 2).map(profitable),
  ]);
  assert.strictEqual(ids.length, 3, "painted " + ids.join(", "));
  assert.ok(ids.includes("T6_CORRUPTED_LETHAL_MAP"));
  assert.ok(ids.includes(WAYSTONES[0].id) && ids.includes(WAYSTONES[1].id));
});

console.log("\n" + "=".repeat(50));
console.log("Total: " + (passed + failed) + " | Passed: " + passed + " | Failed: " + failed);
if (failed > 0) process.exit(1);
