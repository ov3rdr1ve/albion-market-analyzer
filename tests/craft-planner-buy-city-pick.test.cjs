/**
 * Test: the Crafting Planner's "Buy City" pick SOURCES the materials there.
 *
 * The picker used to be dead weight on this table — nothing read
 * getTableBuyCity except Flipping, rowPassesBuyCity stands down for a
 * re-pricing table, and yet every change paid a full recompute. It now means
 * what it says: while a pick is active every material (and the journal empty
 * the row buys) comes from that city, and a city the craft city cannot reach
 * leaves no honest row at all — the same rule the Sell City pick already
 * follows (js/table-sell-city.js).
 *
 * Black-box over the real pricing module with synthetic prices. No market API,
 * no DOM.
 *
 * Run: node tests/craft-planner-buy-city-pick.test.cjs
 */

const assert = require("assert");
const {
  computeCraftPlannerRow, effectiveBuyCities,
  setTableBuyCity, getTableBuyCity, clearTableSellCities,
  __setCrossRoute, __setBMR, __reset,
} = require("./helpers/craft-planner-pricing-harness.cjs");

const PLANNER = "craft-planner-table";
const FS = "Fort Sterling";
const LY = "Lymhurst";
const ML = "Martlock";
const ROYAL = ["Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
const CITIES = ["Caerleon", ...ROYAL];

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    __reset(); clearTableSellCities();
    fn();
    console.log(`  PASS: ${name}`); passed++;
  } catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

function priceMap(entries) {
  const out = {};
  for (const e of entries) {
    if (!out[e.id]) out[e.id] = {};
    out[e.id][e.city] = { buy_price: e.buy || 0, sell_price: e.sell || 0, volume_24h: 9999 };
  }
  return out;
}

// One material, listed in two royal cities at different prices, so "where did
// this row buy" is a single readable answer. No raws are listed, so the plank
// can only come from the market (the chain has nothing to refine from).
const ITEM = { id: "T8_FURNITUREITEM_TABLE", name: "Elder's Table", craftType: null };
const MATS = [{ matId: "T8_PLANKS", count: 30 }];

function market(extra = []) {
  return priceMap([
    { id: "T8_PLANKS", city: LY, buy: 800 },
    { id: "T8_PLANKS", city: FS, buy: 1000 },
    { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 90000 },
    { id: "T8_JOURNAL_TOOLMAKER_EMPTY", city: LY, buy: 4000 },
    { id: "T8_JOURNAL_TOOLMAKER_EMPTY", city: FS, buy: 5000 },
    { id: "T8_JOURNAL_TOOLMAKER_FULL", city: FS, sell: 20000 },
    ...extra,
  ]);
}

// ── effectiveBuyCities ──────────────────────────────────────────────────────
console.log("\n=== effectiveBuyCities ===");

test("no pick — the caller's full list, unchanged", () => {
  assert.deepStrictEqual(effectiveBuyCities(PLANNER, FS, CITIES), CITIES);
});

test("a pick narrows the pool to that one city", () => {
  setTableBuyCity(PLANNER, LY);
  assert.deepStrictEqual(effectiveBuyCities(PLANNER, FS, CITIES), [LY]);
});

test("a pick the craft city cannot source from yields no city at all", () => {
  // BMR off: royal <-> Caerleon hauling is dead (isValidSourceCity).
  __setBMR(false);
  setTableBuyCity(PLANNER, LY);
  assert.deepStrictEqual(effectiveBuyCities(PLANNER, "Caerleon", CITIES), []);
});

test("with Black/Red Zone Routes on the same pick is reachable", () => {
  __setBMR(true);
  setTableBuyCity(PLANNER, LY);
  assert.deepStrictEqual(effectiveBuyCities(PLANNER, "Caerleon", CITIES), [LY]);
});

test("a pick outside the caller's list yields no city", () => {
  setTableBuyCity(PLANNER, "Smuggler's Den");
  assert.deepStrictEqual(effectiveBuyCities(PLANNER, FS, CITIES), []);
});

test("the pick is per table — another table's pick is not read", () => {
  setTableBuyCity("flipping-table", LY);
  assert.deepStrictEqual(effectiveBuyCities(PLANNER, FS, CITIES), CITIES);
});

// ── the row ─────────────────────────────────────────────────────────────────
console.log("\n=== planner rows under a Buy City pick ===");

test("no pick — materials come from the cheapest city", () => {
  const row = computeCraftPlannerRow(ITEM, MATS, market(), FS);
  assert.ok(!row.noData, "row should price");
  assert.strictEqual(row.sourcing[0].sourcing.city, LY);
});

test("a pick moves the buy to that city even when it is dearer", () => {
  setTableBuyCity(PLANNER, FS);
  const row = computeCraftPlannerRow(ITEM, MATS, market(), FS);
  assert.ok(!row.noData, "row should still price");
  assert.strictEqual(row.sourcing[0].sourcing.city, FS);
  assert.strictEqual(row.sourcing[0].sourcing.perUnit, 1000);
});

test("the dearer pick really costs more than the free-choice row", () => {
  const free = computeCraftPlannerRow(ITEM, MATS, market(), FS);
  setTableBuyCity(PLANNER, FS);
  const pinned = computeCraftPlannerRow(ITEM, MATS, market(), FS);
  assert.ok(pinned.refineCraftCost > free.refineCraftCost,
    `pinned ${pinned.refineCraftCost} should exceed free ${free.refineCraftCost}`);
});

test("the journal empty is bought at the pick too", () => {
  setTableBuyCity(PLANNER, FS);
  const row = computeCraftPlannerRow(ITEM, MATS, market(), FS);
  assert.strictEqual(row.journal.bestJournal.emptyCity, FS);
  assert.strictEqual(row.journal.bestJournal.emptyCost, 5000);
});

test("a pick with no listing for the material leaves a no-data row", () => {
  setTableBuyCity(PLANNER, ML); // no T8_PLANKS listed there
  const row = computeCraftPlannerRow(ITEM, MATS, market(), FS);
  assert.strictEqual(row.noData, true);
});

test("a pick the craft city cannot reach leaves a no-data row", () => {
  __setBMR(false);
  __setCrossRoute((buy, sell) => {
    if (sell === "Black Market" && buy !== "Caerleon") return true;
    return false;
  });
  setTableBuyCity(PLANNER, LY);
  const md = market([{ id: "T8_FURNITUREITEM_TABLE", city: "Caerleon", sell: 90000 }]);
  const row = computeCraftPlannerRow(ITEM, MATS, md, "Caerleon");
  assert.strictEqual(row.noData, true);
});

test("clearing the pick restores the free-choice sourcing exactly", () => {
  const before = computeCraftPlannerRow(ITEM, MATS, market(), FS);
  setTableBuyCity(PLANNER, FS);
  computeCraftPlannerRow(ITEM, MATS, market(), FS);
  setTableBuyCity(PLANNER, "");
  const after = computeCraftPlannerRow(ITEM, MATS, market(), FS);
  assert.strictEqual(getTableBuyCity(PLANNER), null);
  assert.strictEqual(after.sourcing[0].sourcing.city, before.sourcing[0].sourcing.city);
  assert.strictEqual(after.refineCraftCost, before.refineCraftCost);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
