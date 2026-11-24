/**
 * Audit: every Crafting List extractor prices an unfunded unit with exactly ONE
 * focus play removed — never a headline that still holds a second focus effect.
 *
 * The mounts-table breeding bug: the headline held TWO focus effects (saddler
 * leather RRR + nurture offspring) while only the winning play's delta was
 * subtracted, so unfunded units kept the other effect. The audit of every other
 * extractor (results below) found a single focus effect per headline, so for
 * them `unitProfit − unitProfitNoFocus` must equal the one play's delta; tables
 * focus cannot touch must report the same figure twice.
 *
 *   crafting-table        one effect: craft RRR on eligible mats (render-crafting.js)
 *   consumable-table      one effect: cook / chain-craft RRR; the chain bonus is
 *                         not in the headline; pastures spend no focus
 *   transport-table       one effect: the refine at the picked ladder tier
 *                         (refining-route.js prices the route at that tier only)
 *   farming-table         one effect: watering (yield + seed return of one play)
 *   craft-planner-table   publishes its focus-off twin outright (exact)
 *   mounts-table (craft)  one effect: craft RRR
 *   mounts-table (breed)  TWO effects — split from the published unfocused twin
 *   journal-filling, laborers, gathering, buildings, rolling, transmute,
 *   enchanting, rerolling, flipping, skins-trading, faction-spending
 *                         no focus play: funded = unfunded
 *
 * Black box over the shipped extractor module with synthetic rows; no DOM, no
 * market data, no live APIs.
 *
 * Run: node tests/craft-list-extractor-focus-audit.test.cjs
 */
const assert = require("assert");
const path = require("path");

const { extractCraftListRow } = require(path.join(__dirname, "..", "js", "craft-list-materials.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const HEADLINE = 50000;
const DELTA = 8000;

// [tableId, label, synthetic row, expected per-unit delta between funded and unfunded]
const CASES = [
  ["crafting-table", "focused craft", {
    item: { id: "T6_MAIN_SWORD" }, materials: [], matBestPrices: {}, craftCity: "Martlock",
    rrr: 0.435, baseRrr: 0.152, focusCost: 900, focusProfitDelta: DELTA,
    marginInfo: { profit: HEADLINE }, totalInputCost: 100000,
  }, DELTA],
  ["consumable-table", "focused cook", {
    item: { id: "T6_MEAL_STEW" }, recipe: [], matBestPrices: {}, craftCity: "Caerleon",
    rrr: 0.435, baseRrr: 0.152, focusCost: 300, focusProfitPerOutput: DELTA,
    marginInfo: { profit: HEADLINE }, totalInputCost: 20000,
  }, DELTA],
  ["transport-table", "focused refine", {
    route: { refinedId: "T6_PLANKS" }, rrr: 0.435, baseRrr: 0.152,
    focusCost: 200, refinesPerOutput: 1, focusProfitDelta: DELTA,
    marginInfo: { profit: HEADLINE }, totalRawCost: 30000,
  }, DELTA],
  ["farming-table", "watered crop", {
    item: { id: "T5_FARM_CABBAGE_SEED", outputId: "T5_CABBAGE" },
    focusPerOutput: 10, focusProfitPerOutput: DELTA,
    marginInfo: { profit: HEADLINE }, totalInputCost: 500,
    seedsPerOutput: 0, seedsPerOutputNoFocus: 0.1,
  }, DELTA],
  ["craft-planner-table", "planner with its own focus-off twin", {
    item: { id: "T6_MAIN_SWORD" }, combinedProfit: HEADLINE, noFocusCombinedProfit: HEADLINE - DELTA,
    noFocusLaborerCombinedProfit: HEADLINE - DELTA, focusPerCraft: 900, sourcing: [], rrr: 0.435,
  }, DELTA],
  ["mounts-table", "mount craft", {
    isBreeding: false, item: { id: "T5_MOUNT_HORSE", materials: [] }, matBestPrices: {},
    craftCity: "Martlock", rrr: 0.435, baseRrr: 0.152, focusCost: 600, focusProfitDelta: DELTA,
    marginInfo: { profit: HEADLINE }, totalInputCost: 14400,
  }, DELTA],
  ["mounts-table", "breeding row with two focus effects in the headline", {
    isBreeding: true, item: { babyId: "T6_FARM_OX_BABY", id: "T6_MOUNT_OX" },
    meta: { maxNurtures: 4 }, saddlerRrr: 0.435, saddlerRrrNoFocus: 0.152,
    marginInfo: { profit: HEADLINE + 30000 }, profitNoFocus: HEADLINE - DELTA,
    totalInputCost: 100000, totalInputCostNoFocus: 120000,
    focusCost: 500, focusProfitDelta: DELTA,
    bestFocusPlay: { kind: "nurture", focusCost: 500, profitDelta: DELTA },
  }, DELTA],
  ["journal-filling-table", "journal (no focus)", {
    fullId: "T6_JOURNAL_FULL", emptyId: "T6_JOURNAL_EMPTY", emptyCost: 1000, marginPerJournal: HEADLINE,
  }, 0],
  ["laborers-table", "laborer (no focus)", {
    item: { id: "T6_LABORER" }, filledId: "T6_JOURNAL_FULL", marginInfo: { profit: HEADLINE },
  }, 0],
  ["gathering-table", "gathering (no focus)", { id: "T6_WOOD", sellPrice: 100 }, 0],
];

console.log("\n=== unfunded = funded − exactly one focus play ===");

CASES.forEach(([tableId, label, row, delta]) => {
  test(`${tableId} — ${label}`, () => {
    const e = extractCraftListRow(tableId, row);
    assert.ok(e, "extractor returned nothing");
    assert.strictEqual(e.unitProfit - e.unitProfitNoFocus, delta,
      `funded ${e.unitProfit} − unfunded ${e.unitProfitNoFocus} ≠ one play (${delta})`);
  });
});

test("breeding: the unfunded unit is the published unfocused twin, not headline − delta", () => {
  const [, , row] = CASES.find((c) => c[1].startsWith("breeding"));
  const e = extractCraftListRow("mounts-table", row);
  assert.strictEqual(e.unitProfitNoFocus, HEADLINE - DELTA);
  assert.notStrictEqual(e.unitProfitNoFocus, row.marginInfo.profit - DELTA);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
