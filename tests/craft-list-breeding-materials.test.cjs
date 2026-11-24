/**
 * My Crafting List — a breeding row's inputs reach the "Materials to Buy" board.
 *
 * A breeding row carries no `materials` array and no `matBestPrices`: its
 * inputs live in three separate fields (js/render-mounts.js breedingRowFor), so
 * the generic _clRecipeMats path returned nothing for it. A list of 144 moose
 * showed a 43M cost line over "No purchasable materials on the list yet."
 *
 * One cycle buys the BABY, `feed.pieces` of feed, and the saddler craft's
 * materials net of the saddler return rate — never the GROWN mount, which the
 * breeder produces in-house.
 *
 * Black box over the shipped modules — synthetic rows, no DOM, no market data.
 *
 * Run: node tests/craft-list-breeding-materials.test.cjs
 */
const assert = require("assert");
const path = require("path");

const {
  extractCraftListRow,
  aggregateCraftListMaterials,
} = require(path.join(__dirname, "..", "js", "craft-list-materials.js"));
const {
  allocateCraftListFocus,
} = require(path.join(__dirname, "..", "js", "craft-list-focus-budget.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// The reported row: T6 Moose bought in Brecilien, fed 69 comfrey, saddled in
// Thetford out of 20 leather at a 43.5% focused return rate.
function mooseRow(over) {
  return Object.assign({
    isBreeding: true,
    item: {
      babyId: "T6_FARM_GIANTSTAG_MOOSE_BABY",
      grownId: "T6_FARM_GIANTSTAG_MOOSE_GROWN",
      id: "T6_MOUNT_GIANTSTAG_MOOSE",
      name: "Moose [T6]",
    },
    meta: { maxNurtures: 4, focusPerNurture: 125, totalNurtureFocus: 500, piecesNeeded: 69 },
    buyMat: { city: "Brecilien", price: 200019 },
    feed: { id: "T3_COMFREY", price: 256, city: "Brecilien", pieces: 69 },
    recipe: {
      id: "T6_MOUNT_GIANTSTAG_MOOSE",
      materials: [
        { matId: "T6_FARM_GIANTSTAG_MOOSE_GROWN", count: 1 },
        { matId: "T6_LEATHER", count: 20 },
      ],
    },
    saddlerMatPrices: {
      T6_FARM_GIANTSTAG_MOOSE_GROWN: { price: 0, city: "Thetford", isProduced: true },
      T6_LEATHER: { price: 4717, city: "Thetford" },
    },
    saddlerCity: "Thetford",
    saddlerRrr: 0.435,
    saddlerRrrNoFocus: 0.152,
    sellPot: { city: "Lymhurst", price: 469899 },
    totalInputCost: 277757,
    marginInfo: { profit: 209603 },
    focusCost: 500,
    focusProfitDelta: 48005,
    bestFocusPlay: { kind: "nurture", focusCost: 500, profitDelta: 48005 },
    rrr: 0,
  }, over || {});
}

const byId = (mats) => Object.fromEntries(mats.map((m) => [m.matId, m]));

console.log("Craft List — breeding materials\n");

// ── one cycle's three input lines ──────────────────────────────────────────

test("a breeding cycle buys the baby, the feed and the saddler materials", () => {
  const mats = byId(extractCraftListRow("mounts-table", mooseRow()).materials);
  assert.deepStrictEqual(Object.keys(mats).sort(),
    ["T3_COMFREY", "T6_FARM_GIANTSTAG_MOOSE_BABY", "T6_LEATHER"]);
});

[
  // [name, matId, count, city, perUnit]
  ["the baby is one, at the row's buy city", "T6_FARM_GIANTSTAG_MOOSE_BABY", 1, "Brecilien", 200019],
  ["the feed line is feed.pieces of the cheapest food", "T3_COMFREY", 69, "Brecilien", 256],
  ["saddler leather is net of the return rate", "T6_LEATHER", 20 * (1 - 0.435), "Thetford", 4717],
].forEach(([name, matId, count, city, perUnit]) => {
  test(name, () => {
    const line = byId(extractCraftListRow("mounts-table", mooseRow()).materials)[matId];
    assert.ok(line, `${matId} missing`);
    assert.strictEqual(Math.round(line.count * 1000) / 1000, Math.round(count * 1000) / 1000);
    assert.strictEqual(line.city, city);
    assert.strictEqual(line.perUnit, perUnit);
  });
});

test("the grown mount is produced in-house, never bought", () => {
  const mats = extractCraftListRow("mounts-table", mooseRow()).materials;
  assert.ok(!mats.some((m) => m.matId === "T6_FARM_GIANTSTAG_MOOSE_GROWN"));
});

// ── the tail past the focus budget ─────────────────────────────────────────

test("an unfunded NURTURE buys exactly the same materials", () => {
  const e = extractCraftListRow("mounts-table", mooseRow());
  assert.deepStrictEqual(e.materialsNoFocus, e.materials,
    "not nurturing costs offspring, not leather");
});

test("an unfunded SADDLER craft buys more leather", () => {
  const e = extractCraftListRow("mounts-table", mooseRow({
    focusCost: 3283,
    focusProfitDelta: 23164,
    bestFocusPlay: { kind: "saddler", focusCost: 3283, profitDelta: 23164 },
  }));
  const on = byId(e.materials).T6_LEATHER.count;
  const off = byId(e.materialsNoFocus).T6_LEATHER.count;
  assert.strictEqual(Math.round(on * 1000) / 1000, Math.round(20 * (1 - 0.435) * 1000) / 1000);
  assert.strictEqual(Math.round(off * 1000) / 1000, Math.round(20 * (1 - 0.152) * 1000) / 1000);
  assert.ok(off > on, "the base return rate buys strictly more");
});

test("a row with no published base rate keeps its focused counts", () => {
  const e = extractCraftListRow("mounts-table", mooseRow({
    saddlerRrrNoFocus: undefined,
    bestFocusPlay: { kind: "saddler", focusCost: 3283, profitDelta: 23164 },
  }));
  assert.deepStrictEqual(e.materialsNoFocus, e.materials);
});

// ── degenerate rows still produce a board, never a crash ───────────────────

[
  ["no feed priced yet", { feed: null }, ["T6_FARM_GIANTSTAG_MOOSE_BABY", "T6_LEATHER"]],
  ["no saddler stage at all", { recipe: null, saddlerMatPrices: null },
    ["T3_COMFREY", "T6_FARM_GIANTSTAG_MOOSE_BABY"]],
  ["a feed with no pieces is not a purchase", { feed: { id: "T3_COMFREY", price: 256, city: "Brecilien", pieces: 0 } },
    ["T6_FARM_GIANTSTAG_MOOSE_BABY", "T6_LEATHER"]],
].forEach(([name, over, expected]) => {
  test(name, () => {
    const mats = extractCraftListRow("mounts-table", mooseRow(over)).materials;
    assert.deepStrictEqual(mats.map((m) => m.matId).sort(), expected);
  });
});

// ── the reported basket ────────────────────────────────────────────────────

test("144 moose put three lines on the board, summing to the row's cost", () => {
  const entries = [Object.assign(extractCraftListRow("mounts-table", mooseRow()), { qty: 144 })];
  const agg = aggregateCraftListMaterials(entries, allocateCraftListFocus(entries, 10000));
  const lines = byId(agg.lines);
  assert.strictEqual(Math.round(lines.T6_FARM_GIANTSTAG_MOOSE_BABY.count), 144);
  assert.strictEqual(Math.round(lines.T3_COMFREY.count), 69 * 144);
  assert.strictEqual(Math.round(lines.T6_LEATHER.count), Math.round(20 * (1 - 0.435) * 144));
  // The row's own Cost column adds the 2.5% setup fee on top of these inputs,
  // so the board lands just under it rather than on it.
  const withSetup = agg.grandTotal * 1.025;
  assert.ok(Math.abs(withSetup - 277757 * 144) / (277757 * 144) < 0.01,
    `board ${Math.round(agg.grandTotal)} does not reconcile with the row cost`);
});

test("a mounts CRAFT row still uses the recipe path", () => {
  const e = extractCraftListRow("mounts-table", {
    isBreeding: false,
    item: { id: "T5_MOUNT_HORSE", name: "Riding Horse [T5]", materials: [{ matId: "T5_LEATHER", count: 16 }] },
    matBestPrices: { T5_LEATHER: { price: 900, city: "Martlock" } },
    craftCity: "Martlock",
    rrr: 0,
    focusCost: 600,
    sellPot: { city: "Caerleon", price: 40000 },
    marginInfo: { profit: 5000 },
    totalInputCost: 14400,
  });
  assert.deepStrictEqual(e.materials.map((m) => [m.matId, m.count, m.city]),
    [["T5_LEATHER", 16, "Martlock"]]);
  assert.strictEqual(e.focusCost, 600, "a craft row is never spread over days");
  assert.strictEqual(e.focusDays, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
