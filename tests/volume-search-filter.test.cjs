/**
 * Test: the volume table's free-text search box.
 *
 * Motivation: enchanted refined resources (e.g. "4.2 planks",
 * id T4_PLANKS_LEVEL2@2) are scanned and rendered in the volume table, but the
 * table had no filter — so they were impossible to LOCATE in a long,
 * volume-sorted list. `filterVolumeRows` powers a search box that narrows the
 * rows by their visible text (name / tier / type / top city / raw id).
 *
 * Black-box & parameterized: we feed row objects + a query and assert which
 * rows survive, never reaching into the implementation. No DOM, no API.
 *
 * Run: node tests/volume-search-filter.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { filterVolumeRows } = require("../js/render-volume.js");
const { readIndexHtml } = require("./helpers/page-source.cjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Representative volume rows — mirrors the shape renderVolumeTable builds
// (the fields filterVolumeRows reads: name, tier, category, topCity, itemId).
// Resource names mirror the generic labels the app now renders (resource-names.js):
// "<tier>[.<enchant>] <word>". Gear keeps its proper name.
const ROWS = [
  { itemId: "T4_PLANKS",            name: "4 planks",               tier: 4, category: "Resource", topCity: "Caerleon" },
  { itemId: "T4_PLANKS_LEVEL2@2",   name: "4.2 planks",             tier: 4, category: "Resource", topCity: "Caerleon" },
  { itemId: "T5_PLANKS_LEVEL2@2",   name: "5.2 planks",             tier: 5, category: "Resource", topCity: "Lymhurst" },
  { itemId: "T4_CLOTH_LEVEL2@2",    name: "4.2 cloth",              tier: 4, category: "Resource", topCity: "Martlock" },
  { itemId: "T5_METALBAR_LEVEL1@1", name: "5.1 bar",                tier: 5, category: "Resource", topCity: "Martlock" },
  { itemId: "T6_2H_BOW@2",          name: "Master's Bow [T6] [.2]", tier: 6, category: "Gear",     topCity: "Caerleon" },
];

const idsOf = (rows) => rows.map((r) => r.itemId).slice().sort();
const sameSet = (a, b) => JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort());

// ── Parameterized query → expected surviving itemIds ──────────────────────────
const CASES = [
  // Empty / whitespace queries are a no-op: every row passes through.
  { q: "",            expect: ROWS.map((r) => r.itemId) },
  { q: "   ",         expect: ROWS.map((r) => r.itemId) },

  // The exact thing the user asked for: locate the T4.2 planks precisely.
  { q: "4.2 planks",  expect: ["T4_PLANKS_LEVEL2@2"] },

  // Tier.enchant token alone narrows to that enchant level within the tier.
  { q: "4.2",         expect: ["T4_PLANKS_LEVEL2@2", "T4_CLOTH_LEVEL2@2"] },

  // ".2" + a resource word — the bow ("[.2]") shares the ".2" token but lacks
  // "planks", proving multi-term AND semantics.
  { q: ".2 planks",   expect: ["T4_PLANKS_LEVEL2@2", "T5_PLANKS_LEVEL2@2"] },

  // Family name matches every tier/enchant of that refined resource.
  { q: "planks",      expect: ["T4_PLANKS", "T4_PLANKS_LEVEL2@2", "T5_PLANKS_LEVEL2@2"] },

  // Category column is searchable; gear is excluded.
  { q: "resource",    expect: ["T4_PLANKS", "T4_PLANKS_LEVEL2@2", "T5_PLANKS_LEVEL2@2", "T4_CLOTH_LEVEL2@2", "T5_METALBAR_LEVEL1@1"] },

  // Raw market id is searchable: "level2" hits _LEVEL2@2 ids but not BOW@2.
  { q: "level2",      expect: ["T4_PLANKS_LEVEL2@2", "T5_PLANKS_LEVEL2@2", "T4_CLOTH_LEVEL2@2"] },

  // Top-city column is searchable.
  { q: "caerleon",    expect: ["T4_PLANKS", "T4_PLANKS_LEVEL2@2", "T6_2H_BOW@2"] },

  // Bare tier token uses the synthetic "t5" haystack entry.
  { q: "t5",          expect: ["T5_PLANKS_LEVEL2@2", "T5_METALBAR_LEVEL1@1"] },

  // Case-insensitive.
  { q: "PLANKS",      expect: ["T4_PLANKS", "T4_PLANKS_LEVEL2@2", "T5_PLANKS_LEVEL2@2"] },

  // No matches → empty result (the UI renders an empty-state message).
  { q: "zzznomatch",  expect: [] },
];

console.log("\n=== filterVolumeRows — query → surviving rows ===");
CASES.forEach(({ q, expect }) => {
  test(`query ${JSON.stringify(q)} → ${expect.length} row(s)`, () => {
    const got = idsOf(filterVolumeRows(ROWS, q));
    assert.ok(
      sameSet(got, expect),
      `expected [${expect.slice().sort().join(", ")}] but got [${got.join(", ")}]`,
    );
  });
});

// ── Tier / enchant dropdowns (in-game-style pickers) ─────────────────────────
// filterVolumeRows(rows, query, tierSel, enchSel). Selects are raw values:
// ""=All, tier "1".."8", enchant "0".."4". They AND with the text query.
const TE_CASES = [
  // Tier alone.
  { q: "", tier: "4", ench: "", expect: ["T4_PLANKS", "T4_PLANKS_LEVEL2@2", "T4_CLOTH_LEVEL2@2"] },
  // Enchant alone — ".2" across all tiers; base (.0) is enchant 0.
  { q: "", tier: "", ench: "2", expect: ["T4_PLANKS_LEVEL2@2", "T5_PLANKS_LEVEL2@2", "T4_CLOTH_LEVEL2@2", "T6_2H_BOW@2"] },
  // Base enchant (0) picks only the un-enchanted id.
  { q: "", tier: "", ench: "0", expect: ["T4_PLANKS"] },
  // Tier AND enchant together.
  { q: "", tier: "4", ench: "2", expect: ["T4_PLANKS_LEVEL2@2", "T4_CLOTH_LEVEL2@2"] },
  // Tier + enchant + text term all AND.
  { q: "planks", tier: "4", ench: "2", expect: ["T4_PLANKS_LEVEL2@2"] },
  // Both empty = no-op passthrough.
  { q: "", tier: "", ench: "", expect: ROWS.map((r) => r.itemId) },
];

console.log("\n=== filterVolumeRows — tier/enchant pickers ===");
TE_CASES.forEach(({ q, tier, ench, expect }) => {
  test(`q=${JSON.stringify(q)} tier=${JSON.stringify(tier)} ench=${JSON.stringify(ench)} → ${expect.length}`, () => {
    const got = idsOf(filterVolumeRows(ROWS, q, tier, ench));
    assert.ok(
      sameSet(got, expect),
      `expected [${expect.slice().sort().join(", ")}] but got [${got.join(", ")}]`,
    );
  });
});

// ── Category / subcategory / city pickers ────────────────────────────────────
// Same in-game filters the other tables get, but re-implemented against the row
// OBJECTS because this table filters before it renders. Category comes from
// getMarketCategory (js/data-item-categories.js), so load it the way the browser
// does — as a global.
require("../js/data-item-categories.js");

const CS_CASES = [
  // Category alone.
  { cat: "refinedresources", sub: "", city: "", expect: [
    "T4_PLANKS", "T4_PLANKS_LEVEL2@2", "T5_PLANKS_LEVEL2@2", "T4_CLOTH_LEVEL2@2", "T5_METALBAR_LEVEL1@1",
  ] },
  { cat: "ranged", sub: "", city: "", expect: ["T6_2H_BOW@2"] },
  // Subcategory narrows within it — and works on its own.
  { cat: "refinedresources", sub: "planks", city: "", expect: ["T4_PLANKS", "T4_PLANKS_LEVEL2@2", "T5_PLANKS_LEVEL2@2"] },
  { cat: "", sub: "cloth", city: "", expect: ["T4_CLOTH_LEVEL2@2"] },
  // A category and a subcategory from different branches can never both hold.
  { cat: "ranged", sub: "planks", city: "", expect: [] },
  // City alone, then ANDed with a category.
  { cat: "", sub: "", city: "Martlock", expect: ["T4_CLOTH_LEVEL2@2", "T5_METALBAR_LEVEL1@1"] },
  { cat: "refinedresources", sub: "", city: "Caerleon", expect: ["T4_PLANKS", "T4_PLANKS_LEVEL2@2"] },
  // All empty = no-op passthrough.
  { cat: "", sub: "", city: "", expect: ROWS.map((r) => r.itemId) },
];

console.log("\n=== filterVolumeRows — category/subcategory/city pickers ===");
CS_CASES.forEach(({ cat, sub, city, expect }) => {
  test(`cat=${JSON.stringify(cat)} sub=${JSON.stringify(sub)} city=${JSON.stringify(city)} → ${expect.length}`, () => {
    const got = idsOf(filterVolumeRows(ROWS, "", "", "", cat, sub, city));
    assert.ok(
      sameSet(got, expect),
      `expected [${expect.slice().sort().join(", ")}] but got [${got.join(", ")}]`,
    );
  });
});

test("category ANDs with the text query and the tier picker", () => {
  const got = idsOf(filterVolumeRows(ROWS, "planks", "4", "", "refinedresources", "", ""));
  assert.ok(sameSet(got, ["T4_PLANKS", "T4_PLANKS_LEVEL2@2"]), `got [${got.join(", ")}]`);
});

test("an item items.xml has no shop category for is hidden by any category pick", () => {
  const rows = [{ itemId: "UNIQUE_UNLOCK_CAPE_VANITY_MADE_UP", name: "skin", tier: 4, topCity: "Caerleon" }];
  assert.strictEqual(filterVolumeRows(rows, "", "", "", "capes", "", "").length, 0);
  assert.strictEqual(filterVolumeRows(rows, "", "", "", "", "", "").length, 1);
});

console.log("\n=== filterVolumeRows — robustness ===");

test("empty query returns the SAME array reference (cheap no-op)", () => {
  assert.strictEqual(filterVolumeRows(ROWS, ""), ROWS);
});

test("does not mutate the input rows", () => {
  const snapshot = JSON.stringify(ROWS);
  filterVolumeRows(ROWS, "planks");
  assert.strictEqual(JSON.stringify(ROWS), snapshot, "input array must be untouched");
});

test("null/undefined query is treated as empty", () => {
  assert.strictEqual(filterVolumeRows(ROWS, null).length, ROWS.length);
  assert.strictEqual(filterVolumeRows(ROWS, undefined).length, ROWS.length);
});

test("rows with missing optional fields don't throw", () => {
  const sparse = [{ itemId: "T4_PLANKS_LEVEL2@2", tier: 4 }]; // no name/category/topCity
  // "planks" lives in the id, so it should still match via the raw id.
  assert.strictEqual(filterVolumeRows(sparse, "planks").length, 1);
  assert.strictEqual(filterVolumeRows(sparse, "nope").length, 0);
});

// ── Wiring checks: the box exists and is connected to the render path ─────────
console.log("\n=== wiring ===");

const html = readIndexHtml();
const scanHandlers = fs.readFileSync(path.join(__dirname, "..", "js", "scan-handlers.js"), "utf8");
const sorting = fs.readFileSync(path.join(__dirname, "..", "js", "sorting.js"), "utf8");

test("index.html has the #volume-search input", () => {
  assert.ok(/id="volume-search"/.test(html), "search input must exist in the volume heading");
});

test("scan-handlers.js re-renders the volume table on input", () => {
  assert.ok(
    /getElementById\("volume-search"\)/.test(scanHandlers),
    "must grab the #volume-search element",
  );
  assert.ok(
    /addEventListener\("input"[\s\S]{0,160}updateTableDisplay\("volume-table"\)/.test(scanHandlers),
    "input events must trigger a volume-table re-render",
  );
});

test("sorting.js applies the volume table's filters", () => {
  assert.ok(
    /tableId === "volume-table"[\s\S]{0,320}applyVolumeTableFilters\(/.test(sorting),
    "updateTableDisplay must filter the volume table by its search box and pickers",
  );
});

test("applyVolumeTableFilters reads every picker id the injector creates", () => {
  const renderVolume = fs.readFileSync(path.join(__dirname, "..", "js", "render-volume.js"), "utf8");
  ["volume-search", "tierfilter-volume-table", "enchfilter-volume-table",
   "catfilter-volume-table", "subcatfilter-volume-table", "cityfilter-volume-table",
  ].forEach((id) => {
    assert.ok(renderVolume.includes(`"${id}"`), `must read #${id}`);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
