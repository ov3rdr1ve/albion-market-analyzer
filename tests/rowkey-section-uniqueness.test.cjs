/**
 * Test: getRowKey produces UNIQUE + STABLE keys for every table that renders a
 * royal/Caerleon section split (or otherwise duplicates a row along a hidden
 * dimension).
 *
 * Why this matters — the scroll-jump bug:
 *   Editing a price triggers a re-render. app.js's restoreAnchor then does
 *     querySelector(`#${tableId} tr[data-row-key="${key}"]`)
 *   to keep the edited row pinned in the viewport. querySelector returns the
 *   FIRST match, so if two coexisting rows share a data-row-key, editing the
 *   lower one snaps the viewport up to the first (usually top-of-table) row.
 *   _suppressSort (sorting.js) keys its order-preservation Map on getRowKey too,
 *   so collisions also corrupt row order on re-render.
 *
 * Tables that render the same logical item in BOTH a royal and a Caerleon
 * section therefore MUST fold `section` into the key. The rolling table also
 * renders each artifact under BOTH the "Any" category and its specific
 * category, so it needs `cat` as well.
 *
 * The two properties asserted per table:
 *   1. Uniqueness — rows that coexist in the DOM get distinct keys.
 *   2. Stability  — the same logical row keeps its key when price-derived fields
 *      (sell city, price, margin, route) change on override.
 *
 * Black-box: drives the real getRowKey extracted from sorting.js.
 *
 * Run: node tests/rowkey-section-uniqueness.test.cjs
 */

const assert = require("assert");

// ── The real getRowKey ──
// It now lives in js/sorting-row-key.js (split out of sorting.js for the 800-line
// cap) and exports itself, so no extraction harness is needed. Its only outside
// reference is getSortValue, used by the default branch alone — every table under
// test here has an explicit case that reads row fields directly.
const { getRowKey } = require("../js/sorting-row-key.js");

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
function assertAllUnique(label, keys) {
  const seen = new Set();
  for (const k of keys) {
    assert.ok(!seen.has(k), `${label}: duplicate key ${JSON.stringify(k)} in ${JSON.stringify(keys)}`);
    seen.add(k);
  }
}

console.log("Row-key section uniqueness + stability\n");

// ════════════════════════════════════════════════════════════════════════════
// ROLLING — section + cat + artId (the originally reported bug)
// ════════════════════════════════════════════════════════════════════════════
function rollingRow(o) {
  return {
    tier: 8, rollType: "Mage", artName: "Enigmatic Staff",
    artId: "T8_ARTEFACT_MAIN_ENIGMATICSTAFF", cat: "Any", section: "royal",
    bestSellCity: "Bridgewatch", bestSellPrice: 500000, margin: 42,
    fragBuyCity: "Martlock", fragBuyPrice: 1200, ...o,
  };
}
test("rolling: royal vs Caerleon distinct", () => {
  assert.notStrictEqual(
    getRowKey(rollingRow({ section: "royal" }), "rolling-table"),
    getRowKey(rollingRow({ section: "caerleon" }), "rolling-table"));
});
test("rolling: 'Any' vs specific category distinct (the jump-to-top cause)", () => {
  assert.notStrictEqual(
    getRowKey(rollingRow({ cat: "Any" }), "rolling-table"),
    getRowKey(rollingRow({ cat: "Mage" }), "rolling-table"));
});
test("rolling: all (section × cat) variants of one artifact unique", () => {
  const keys = [];
  for (const section of ["royal", "caerleon"])
    for (const cat of ["Any", "Mage"])
      keys.push(getRowKey(rollingRow({ section, cat }), "rolling-table"));
  assertAllUnique("rolling", keys);
});
test("rolling: key STABLE across an override re-render", () => {
  assert.strictEqual(
    getRowKey(rollingRow(), "rolling-table"),
    getRowKey(rollingRow({ bestSellCity: "Caerleon", bestSellPrice: 9, margin: -3, fragBuyCity: "Lymhurst", fragBuyPrice: 50 }), "rolling-table"));
});
test("rolling: BlackRedZone (no section) still splits Any vs category", () => {
  assert.notStrictEqual(
    getRowKey(rollingRow({ section: undefined, cat: "Any" }), "rolling-table"),
    getRowKey(rollingRow({ section: undefined, cat: "Mage" }), "rolling-table"));
});

// ════════════════════════════════════════════════════════════════════════════
// REROLLING — id + transitionLabel + section
// ════════════════════════════════════════════════════════════════════════════
function rerollingRow(o) {
  return {
    item: { id: "T6_2H_BOW", name: "Bow" }, transitionLabel: "Good → Outstanding",
    section: "royal", buyCity: "Lymhurst", sellCity: "Martlock",
    marginInfo: { margin: 12 }, ...o,
  };
}
test("rerolling: royal vs Caerleon distinct", () => {
  assert.notStrictEqual(
    getRowKey(rerollingRow({ section: "royal" }), "rerolling-table"),
    getRowKey(rerollingRow({ section: "caerleon" }), "rerolling-table"));
});
test("rerolling: different transitions distinct (regression)", () => {
  assert.notStrictEqual(
    getRowKey(rerollingRow({ transitionLabel: "Normal → Good" }), "rerolling-table"),
    getRowKey(rerollingRow({ transitionLabel: "Good → Outstanding" }), "rerolling-table"));
});
test("rerolling: key STABLE when buy/sell city + margin change", () => {
  assert.strictEqual(
    getRowKey(rerollingRow(), "rerolling-table"),
    getRowKey(rerollingRow({ buyCity: "Bridgewatch", sellCity: "Thetford", marginInfo: { margin: -5 } }), "rerolling-table"));
});

// ════════════════════════════════════════════════════════════════════════════
// FARMING — item.id + section
// ════════════════════════════════════════════════════════════════════════════
function farmingRow(o) {
  return {
    item: { id: "T5_CARROT", name: "Carrot", outputId: "T5_CARROT" },
    section: "royal", buySeed: { city: "Martlock", price: 100 },
    sellCrop: { city: "Martlock", price: 200 }, marginInfo: { margin: 30 }, ...o,
  };
}
test("farming: royal vs Caerleon distinct (same crop)", () => {
  assert.notStrictEqual(
    getRowKey(farmingRow({ section: "royal" }), "farming-table"),
    getRowKey(farmingRow({ section: "caerleon" }), "farming-table"));
});
test("farming: different crops distinct", () => {
  assert.notStrictEqual(
    getRowKey(farmingRow({ item: { id: "T5_CARROT" } }), "farming-table"),
    getRowKey(farmingRow({ item: { id: "T6_BEAN" } }), "farming-table"));
});
test("farming: key STABLE when seed/crop city + price change", () => {
  assert.strictEqual(
    getRowKey(farmingRow(), "farming-table"),
    getRowKey(farmingRow({ buySeed: { city: "Caerleon", price: 5 }, sellCrop: { city: "Black Market", price: 9 } }), "farming-table"));
});

// ════════════════════════════════════════════════════════════════════════════
// ENCHANTING — item.id + transitionLabel + section
// ════════════════════════════════════════════════════════════════════════════
function enchRow(o) {
  return {
    item: { id: "T6_2H_BOW", name: "Bow" }, transitionLabel: ".0 → .1",
    section: "royal", sourceCity: "Lymhurst", sellCity: "Martlock",
    marginInfo: { margin: 20 }, ...o,
  };
}
test("enchanting: royal vs Caerleon distinct (same item+transition)", () => {
  assert.notStrictEqual(
    getRowKey(enchRow({ section: "royal" }), "enchanting-table"),
    getRowKey(enchRow({ section: "caerleon" }), "enchanting-table"));
});
test("enchanting: different transitions of one item distinct", () => {
  assert.notStrictEqual(
    getRowKey(enchRow({ transitionLabel: ".0 → .1" }), "enchanting-table"),
    getRowKey(enchRow({ transitionLabel: ".1 → .2" }), "enchanting-table"));
});
test("enchanting: key STABLE when source/sell city + margin change", () => {
  assert.strictEqual(
    getRowKey(enchRow(), "enchanting-table"),
    getRowKey(enchRow({ sourceCity: "Caerleon", sellCity: "Black Market", marginInfo: { margin: -2 } }), "enchanting-table"));
});

// ════════════════════════════════════════════════════════════════════════════
// TRANSMUTE — tier + transition.label + section
// ════════════════════════════════════════════════════════════════════════════
function transmuteRow(o) {
  return {
    tier: 6, transition: { from: "RUNE", to: "SOUL", label: "Rune → Soul" },
    section: "royal", buyCity: "Lymhurst", sellCity: "Martlock",
    marginInfo: { margin: 15 }, ...o,
  };
}
test("transmute: royal vs Caerleon distinct (same tier+transition)", () => {
  assert.notStrictEqual(
    getRowKey(transmuteRow({ section: "royal" }), "transmute-table"),
    getRowKey(transmuteRow({ section: "caerleon" }), "transmute-table"));
});
test("transmute: different tiers distinct", () => {
  assert.notStrictEqual(
    getRowKey(transmuteRow({ tier: 6 }), "transmute-table"),
    getRowKey(transmuteRow({ tier: 7 }), "transmute-table"));
});
test("transmute: key STABLE when buy/sell city change", () => {
  assert.strictEqual(
    getRowKey(transmuteRow(), "transmute-table"),
    getRowKey(transmuteRow({ buyCity: "Caerleon", sellCity: "Black Market" }), "transmute-table"));
});

// ════════════════════════════════════════════════════════════════════════════
// CONSUMABLE — item.id + craftCity + section
//   The bug here is the NO-DATA rows: they carry `section` but NO `craftCity`,
//   so royal + Caerleon no-data rows for one item used to share `id|`.
// ════════════════════════════════════════════════════════════════════════════
function consNoData(o) {
  return { item: { id: "T6_MEAL_OMELETTE" }, marginInfo: { margin: -1 }, section: "royal", ...o };
}
function consData(o) {
  return {
    item: { id: "T6_MEAL_OMELETTE" }, craftCity: "Lymhurst", section: "royal",
    sellPot: { city: "Martlock", price: 500 }, marginInfo: { margin: 18 }, ...o,
  };
}
test("consumable: NO-DATA royal vs Caerleon distinct (the collision)", () => {
  assert.notStrictEqual(
    getRowKey(consNoData({ section: "royal" }), "consumable-table"),
    getRowKey(consNoData({ section: "caerleon" }), "consumable-table"));
});
test("consumable: DATA rows royal vs Caerleon distinct (already worked via craftCity)", () => {
  assert.notStrictEqual(
    getRowKey(consData({ craftCity: "Lymhurst", section: "royal" }), "consumable-table"),
    getRowKey(consData({ craftCity: "Caerleon", section: "caerleon" }), "consumable-table"));
});
test("consumable: a no-data row and its later data row keep one identity per section", () => {
  // royal no-data → royal data (override gives it a craftCity). They need NOT be
  // equal across that transition, but the two SECTIONS must never collide in
  // either state — that's what restoreAnchor / suppress-sort rely on.
  const keys = [
    getRowKey(consNoData({ section: "royal" }), "consumable-table"),
    getRowKey(consNoData({ section: "caerleon" }), "consumable-table"),
  ];
  assertAllUnique("consumable no-data pair", keys);
});

// ════════════════════════════════════════════════════════════════════════════
// REGRESSION GUARDS — tables that were already correct must stay byte-for-byte
// ════════════════════════════════════════════════════════════════════════════
test("crafting: unchanged format id|craftCity, sections distinct via craftCity", () => {
  assert.strictEqual(getRowKey({ item: { id: "T6_2H_BOW" }, craftCity: "Lymhurst" }, "crafting-table"), "T6_2H_BOW|Lymhurst");
  assert.notStrictEqual(
    getRowKey({ item: { id: "T6_2H_BOW" }, craftCity: "Lymhurst" }, "crafting-table"),
    getRowKey({ item: { id: "T6_2H_BOW" }, craftCity: "Caerleon" }, "crafting-table"));
});
test("flipping: unchanged format id|section, sections distinct", () => {
  assert.strictEqual(getRowKey({ item: { id: "T6_2H_BOW" }, section: "royal" }, "flipping-table"), "T6_2H_BOW|royal");
  assert.notStrictEqual(
    getRowKey({ item: { id: "T6_2H_BOW" }, section: "royal" }, "flipping-table"),
    getRowKey({ item: { id: "T6_2H_BOW" }, section: "caerleon" }, "flipping-table"));
});
test("transport: refineCity encodes section → royal-spec vs Caerleon distinct", () => {
  assert.notStrictEqual(
    getRowKey({ route: { rawId: "T6_ORE", refinedId: "T6_METALBAR" }, refineCity: "Fort Sterling" }, "transport-table"),
    getRowKey({ route: { rawId: "T6_ORE", refinedId: "T6_METALBAR" }, refineCity: "Caerleon" }, "transport-table"));
});
test("mounts breeding: section still distinguishes royal vs Caerleon (prior fix intact)", () => {
  assert.notStrictEqual(
    getRowKey({ isBreeding: true, item: { babyId: "T8_FARM_DIREBEAR_BABY" }, section: "royal" }, "mounts-table"),
    getRowKey({ isBreeding: true, item: { babyId: "T8_FARM_DIREBEAR_BABY" }, section: "caerleon" }, "mounts-table"));
});

// ════════════════════════════════════════════════════════════════════════════
// LABORERS — item.id (`${mode}|${filledId}`), STABLE across override re-renders
//   The bug: laborers-table had no case, so getRowKey fell to the default
//   (name|route) where route = `${buy.city}-${sell.city}`. Editing a price
//   shifts the winning city, re-keys the row, and _suppressSort treats it as a
//   brand-new row → appends it to the BOTTOM (looking like Profit/Cycle sort
//   broke — the highest-profit edited row stuck at the end of the table).
// ════════════════════════════════════════════════════════════════════════════
function laborerRow(o) {
  return {
    item: { id: "Resource|T8_JOURNAL_FISHING_FULL", name: "T8 Fisherman" },
    buy: { city: "Lymhurst", price: 175008 },
    sell: { city: "Lymhurst", price: 232686 },
    marginInfo: { margin: 50.47, profit: 90536 }, ...o,
  };
}
test("laborers: key STABLE when the winning buy/sell city shifts on override", () => {
  // This is the exact failure: an override moves the route, the default branch
  // would re-key it, but item.id must keep the row identity fixed.
  assert.strictEqual(
    getRowKey(laborerRow(), "laborers-table"),
    getRowKey(laborerRow({ buy: { city: "Martlock", price: 9 }, sell: { city: "Caerleon", price: 1 }, marginInfo: { margin: -3, profit: -50 } }), "laborers-table"));
});
test("laborers: distinct laborer/tier/mode rows get distinct keys", () => {
  const keys = [
    getRowKey(laborerRow({ item: { id: "Resource|T8_JOURNAL_FISHING_FULL" } }), "laborers-table"),
    getRowKey(laborerRow({ item: { id: "Resource|T7_JOURNAL_FISHING_FULL" } }), "laborers-table"),
    getRowKey(laborerRow({ item: { id: "Trophy|T8_JOURNAL_TROPHY_FISHING_FULL" } }), "laborers-table"),
    getRowKey(laborerRow({ item: { id: "Mercenary|T8_JOURNAL_MERCENARY_FULL" } }), "laborers-table"),
  ];
  assertAllUnique("laborers", keys);
});
test("laborers: key does NOT include the price-derived route (regression vs default branch)", () => {
  assert.strictEqual(getRowKey(laborerRow(), "laborers-table"), "Resource|T8_JOURNAL_FISHING_FULL");
});

// ════════════════════════════════════════════════════════════════════════════
// FACTION SPENDING — itemId, STABLE across override re-renders
//   The bug: faction-spending-table had no case, so getRowKey fell to the
//   default (name|route). Faction rows carry NO row.item and NO row.buy, so
//   both getSortValue("name") and getSortValue("route") returned "" (the route
//   branch throws on row.buy.city and is swallowed) → EVERY row collapsed to
//   "|". _suppressSort's order-preservation Map then mapped all rows to one
//   bucket, so an override re-render (editing a chest yield / token price)
//   reverted the user's chosen sort — e.g. S/Favor — back to the build's
//   silver/FP order. itemId is unique per row (crest/baby ids embed their city;
//   Favor rows are distinct ids) and never price-derived, so it both
//   distinguishes rows and stays stable across overrides.
// ════════════════════════════════════════════════════════════════════════════
function factionRow(o) {
  return {
    itemId: "T8_FARM_RAM_FW_MARTLOCK_BABY",
    name: "Saddled Winter Bear [T8]",
    currency: "FP",
    sellCity: "Martlock",
    sellPrice: 1200000,
    silverPerFp: 14.2,
    silverPerFavor: 0, ...o,
  };
}
test("faction-spending: every coexisting row gets a DISTINCT key (no '|' collapse)", () => {
  const keys = [
    getRowKey(factionRow({ itemId: "T1_FACTION_SWAMP_TOKEN_1" }), "faction-spending-table"),
    getRowKey(factionRow({ itemId: "T8_CAPEITEM_FW_MARTLOCK_BP" }), "faction-spending-table"),
    getRowKey(factionRow({ itemId: "T8_CAPEITEM_FW_THETFORD_BP" }), "faction-spending-table"),
    getRowKey(factionRow({ itemId: "T5_FARM_RAM_FW_MARTLOCK_BABY" }), "faction-spending-table"),
    getRowKey(factionRow({ itemId: "T8_RUNE", currency: "Favor", silverPerFavor: 22.5 }), "faction-spending-table"),
    getRowKey(factionRow({ itemId: "CONQUERORS_CHEST", currency: "Favor", silverPerFavor: 1.8 }), "faction-spending-table"),
  ];
  assertAllUnique("faction-spending", keys);
  assert.ok(!keys.includes("|"), `expected no "|" collapse, got ${JSON.stringify(keys)}`);
});
test("faction-spending: key STABLE when the price-derived sell city/price shifts on override", () => {
  assert.strictEqual(
    getRowKey(factionRow(), "faction-spending-table"),
    getRowKey(factionRow({ sellCity: "Caerleon", sellPrice: 9, silverPerFp: -3 }), "faction-spending-table"));
});
test("faction-spending: key is just the (stable, unique) itemId", () => {
  assert.strictEqual(
    getRowKey(factionRow({ itemId: "T8_RUNE", currency: "Favor" }), "faction-spending-table"),
    "T8_RUNE");
});

// ════════════════════════════════════════════════════════════════════════════
// CRAFT PLANNER — item id + zone section, both stable across a re-pricing
//   The planner renders one row per (item, section): each section's best
//   candidate under its own half of the board — the royal rows, then the
//   "Caerleon & Black Market Routes" divider and its rows (the farming-table
//   layout; sorting.js groups enchant variants by base|section for exactly
//   this). section is the candidate's fixed zone side — a royal city can never
//   become the Caerleon craft — so it is stable across an override re-render,
//   while the winning craft city WITHIN a section is price-derived and must
//   stay out of the key: including it re-keyed the surviving row whenever an
//   override flipped the winner, and the scroll anchor (js/scroll-anchor.js)
//   and the pending-edit mark lost the row while _suppressSort classified it
//   as fresh and spliced it into its sorted slot — the vertical jump on a
//   planner price edit.
// ════════════════════════════════════════════════════════════════════════════
function plannerRow(o) {
  return {
    item: { id: "T6_2H_AXE", name: "Great Axe" },
    craftCity: "Martlock", section: "royal",
    combinedProfit: 41000, totalInputCost: 250000,
    sellCity: "Caerleon", sellPrice: 320000, ...o,
  };
}
test("craft-planner: key is item id + section", () => {
  assert.strictEqual(getRowKey(plannerRow(), "craft-planner-table"), "T6_2H_AXE|royal");
  assert.strictEqual(
    getRowKey(plannerRow({ section: "caerleon", craftCity: "Caerleon" }), "craft-planner-table"),
    "T6_2H_AXE|caerleon");
});
test("craft-planner: key STABLE when the winning craft city flips within a section", () => {
  assert.strictEqual(
    getRowKey(plannerRow(), "craft-planner-table"),
    getRowKey(plannerRow({ craftCity: "Bridgewatch" }), "craft-planner-table"));
});
test("craft-planner: a section's row keeps its key when profit shifts between sections", () => {
  // A price edit can move the profit ranking across sections (the Caerleon
  // twin overtaking the royal winner); each section's row identity survives.
  assert.strictEqual(
    getRowKey(plannerRow({ combinedProfit: 52_000 }), "craft-planner-table"),
    getRowKey(plannerRow({ combinedProfit: 12_000 }), "craft-planner-table"));
});
test("craft-planner: key STABLE when a no-data row gains a craft city", () => {
  assert.strictEqual(
    getRowKey(plannerRow({ craftCity: undefined, section: "royal", noData: true }), "craft-planner-table"),
    getRowKey(plannerRow({ craftCity: "Thetford" }), "craft-planner-table"));
});
test("craft-planner: distinct items (and enchant variants) get distinct keys", () => {
  const keys = [
    getRowKey(plannerRow({ item: { id: "T6_2H_AXE" } }), "craft-planner-table"),
    getRowKey(plannerRow({ item: { id: "T7_2H_AXE" } }), "craft-planner-table"),
    getRowKey(plannerRow({ item: { id: "T6_2H_AXE@1" } }), "craft-planner-table"),
    getRowKey(plannerRow({ item: { id: "T6_2H_AXE@4" } }), "craft-planner-table"),
  ];
  assertAllUnique("craft-planner", keys);
});
test("craft-planner: the royal and Caerleon rows of one item get distinct keys", () => {
  const keys = [
    getRowKey(plannerRow(), "craft-planner-table"),
    getRowKey(plannerRow({ section: "caerleon", craftCity: "Caerleon" }), "craft-planner-table"),
  ];
  assertAllUnique("craft-planner", keys);
});

// ── Summary ──
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
