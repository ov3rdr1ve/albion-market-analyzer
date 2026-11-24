/**
 * My Crafting List — per-table row extraction + material aggregation
 * (js/craft-list-materials.js).
 *
 * Black-box: one synthetic row per source table (shapes copied from the real
 * row builders), asserting the normalized {itemId, inputCost, unitProfit,
 * materials[]} the list panel consumes, then the pure aggregator that turns
 * entries × quantity into a shopping list.
 *
 * Run: node --test tests/craft-list-materials-sourcing-aggregate.test.cjs
 *
 * Substituted materials, planner sourcing lines, return rate, aggregation. Shared setup: tests/helpers/craft-list-materials-setup.cjs.
 */
const {
  assert, path, extractCraftListRow, aggregateCraftListMaterials, test, finish,
} = require("./helpers/craft-list-materials-setup.cjs");

// ── substituted materials ───────────────────────────────────────────────────
// A row may buy something OTHER than the id the recipe names: the Crafting
// table fills an artifact slot with a cheaper Crystallized token, and a refine
// route may buy a lower node and transmute it up. In both cases the row's
// price/city already describe the substitute, and the source table's own cell
// renders the substituted id. The shopping list has to agree, or it shows the
// substitute's price under the recipe's name — and a price edit on that line
// writes an override the recompute never reads back.

test("a token substitute is shopped under the id actually BOUGHT", () => {
  const got = extractCraftListRow("crafting-table", {
    item: { id: "T5_HEAD_PLATE_HELL" },
    materials: [{ matId: "T5_ARTEFACT_ARMOR_PLATE_HELL", count: 1 }],
    matBestPrices: {
      T5_ARTEFACT_ARMOR_PLATE_HELL: {
        id: "T5_ARTEFACT_TOKEN_FAVOR_1", city: "Brecilien", price: 4200,
      },
    },
    craftCity: "Martlock",
  });
  assert.deepStrictEqual(got.materials, [
    { matId: "T5_ARTEFACT_TOKEN_FAVOR_1", count: 1, city: "Brecilien", perUnit: 4200, note: "" },
  ]);
});

test("the substituted line still nets its count against the RECIPE slot's return rate", () => {
  // Eligibility follows the slot, which is how the table costs it — keying it on
  // the substitute would let the shopping list and Input Cost drift apart.
  const got = extractCraftListRow("crafting-table", {
    item: { id: "T5_BAG" },
    materials: [{ matId: "T5_CLOTH", count: 8 }],
    matBestPrices: { T5_CLOTH: { id: "T5_CLOTH_LEVEL1@1", city: "Thetford", price: 300 } },
    rrr: 0.5,
  });
  assert.strictEqual(got.materials[0].matId, "T5_CLOTH_LEVEL1@1");
  assert.strictEqual(got.materials[0].count, 4);
});

// ── the planner's own sourcing lines ────────────────────────────────────────
//
// The Crafting Planner hands the list a `sourcing[]` that already carries what
// it PAID: the id it bought (matId), the recipe slot that id fills (origMatId),
// the per-unit price and, on a market leg, the haul fee folded into the row's
// Input Cost. All three have to survive into the shopping line or the board and
// the row disagree about the same craft.

/** Run `fn` with the app's real RRR classifier installed (js/rrr-eligible.js). */
function withRealRrr(fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "isRrrEligible");
  const prev = globalThis.isRrrEligible;
  globalThis.isRrrEligible = require(path.join(__dirname, "..", "js", "rrr-eligible.js")).isRrrEligible;
  try { fn(); } finally {
    if (had) globalThis.isRrrEligible = prev; else delete globalThis.isRrrEligible;
  }
}

test("an ENCHANTED refined bar is netted against the return rate like a plain one", () => {
  withRealRrr(() => {
    const got = extractCraftListRow("craft-planner-table", {
      item: { id: "T6_BAG_INSIGHT@2" },
      craftCity: "Martlock",
      rrr: 0.5,
      sourcing: [
        { matId: "T6_CLOTH_LEVEL2@2", origMatId: "T6_CLOTH_LEVEL2@2", count: 8,
          sourcing: { city: "Martlock", perUnit: 4000, source: "market" } },
        { matId: "T4_SKILLBOOK_STANDARD", origMatId: "T4_SKILLBOOK_STANDARD", count: 1,
          sourcing: { city: "Martlock", perUnit: 9000, source: "market" } },
      ],
    });
    assert.strictEqual(got.materials[0].count, 4, "the enchanted bar returns like T6_CLOTH");
    assert.strictEqual(got.materials[1].count, 1, "the tome is consumed 1:1");
  });
});

test("a market leg's haul fee is part of the line's per-unit price", () => {
  // The planner costs a market leg at perUnit + travelFeePerUnit; a line without
  // the fee understates the board against the row's own Input Cost.
  const got = extractCraftListRow("craft-planner-table", {
    item: { id: "T6_BAG" },
    craftCity: "Martlock",
    sourcing: [
      { matId: "T6_CLOTH", count: 8,
        sourcing: { city: "Brecilien", perUnit: 4000, travelFeePerUnit: 120, source: "market" } },
    ],
  });
  assert.strictEqual(got.materials[0].perUnit, 4120);
});

test("a self-refined line carries no haul fee — nothing was bought at a market", () => {
  const got = extractCraftListRow("craft-planner-table", {
    item: { id: "T6_BAG" },
    craftCity: "Martlock",
    sourcing: [
      { matId: "T6_CLOTH", count: 8,
        sourcing: { city: "Martlock", perUnit: 3000, travelFeePerUnit: 500, source: "chain" } },
    ],
  });
  assert.strictEqual(got.materials[0].perUnit, 3000);
  assert.strictEqual(got.materials[0].note, "refine");
});

test("a planner substitution counts on the RECIPE slot and shops the bought id", () => {
  // Same rule as the crafting table's substituted line: the planner itself
  // decides return eligibility from origMatId (_cpNonReturnable), so the list
  // must not read it off the substitute.
  withRealRrr(() => {
    const got = extractCraftListRow("craft-planner-table", {
      item: { id: "T5_HEAD_PLATE_HELL" },
      craftCity: "Martlock",
      rrr: 0.5,
      sourcing: [
        { matId: "T5_CLOTH", origMatId: "T5_ARTEFACT_ARMOR_PLATE_HELL", count: 2,
          sourcing: { city: "Brecilien", perUnit: 4200, source: "market" } },
      ],
    });
    assert.strictEqual(got.materials[0].matId, "T5_CLOTH", "the line shops what was bought");
    assert.strictEqual(got.materials[0].count, 2, "the artifact SLOT returns nothing");
  });
});

test("no substitute recorded → the recipe id is used, unchanged", () => {
  const got = extractCraftListRow("crafting-table", {
    item: { id: "T5_BAG" },
    materials: [{ matId: "T5_CLOTH", count: 8 }],
    matBestPrices: { T5_CLOTH: { city: "Martlock", price: 100 } },
  });
  assert.strictEqual(got.materials[0].matId, "T5_CLOTH");
});

test("a transmute refine route shops the START node, not the raw it becomes", () => {
  const got = extractCraftListRow("transport-table", {
    route: { rawId: "T6_ORE_LEVEL2@2", refinedId: "T6_METALBAR_LEVEL2@2", rawRatio: 2 },
    buyRawId: "T6_ORE_LEVEL1@1",
    buyRaw: { city: "Fort Sterling", price: 250 },
    sellRefined: { city: "Martlock", price: 1400 },
    totalRawCost: 500,
    marginInfo: { profit: 200, margin: 18 },
  });
  assert.deepStrictEqual(got.materials, [
    { matId: "T6_ORE_LEVEL1@1", count: 2, city: "Fort Sterling", perUnit: 250, note: "" },
  ]);
});

test("a plain refine route with no transmute keeps the raw id", () => {
  const got = extractCraftListRow("transport-table", {
    route: { rawId: "T5_ORE", refinedId: "T5_METALBAR", rawRatio: 2 },
    buyRaw: { city: "Thetford", price: 300 },
    sellRefined: { city: "Martlock", price: 1400 },
    totalRawCost: 600,
    marginInfo: { profit: 200, margin: 18 },
  });
  assert.strictEqual(got.materials[0].matId, "T5_ORE");
});

// ── the resource return rate ────────────────────────────────────────────────
// The tables cost materials net of the return rate (m.count * (1 - rrr)), so the
// shopping list has to net them too or it reads ~2× the row's Input Cost.

[
  ["crafting-table", { item: { id: "T5_BAG" }, materials: [{ matId: "T5_CLOTH", count: 8 }], matBestPrices: {}, rrr: 0.5 }, 4],
  ["consumable-table", { item: { id: "T5_MEAL" }, recipe: [{ matId: "T5_MEAT", count: 10 }], matBestPrices: {}, rrr: 0.2 }, 8],
  ["craft-planner-table", { item: { id: "T5_BAG" }, sourcing: [{ matId: "T5_CLOTH", count: 8, sourcing: {} }], rrr: 0.25 }, 6],
  ["transport-table", { route: { rawId: "T5_ORE", refinedId: "T5_METALBAR", rawRatio: 2 }, rrr: 0.5 }, 1],
].forEach(([tableId, row, expectCount]) => {
  test(`${tableId} nets its material count against the return rate`, () => {
    const got = extractCraftListRow(tableId, row);
    assert.strictEqual(got.materials[0].count, expectCount);
  });
});

test("no return rate on the row leaves the recipe count untouched", () => {
  const got = extractCraftListRow("crafting-table", {
    item: { id: "T5_BAG" }, materials: [{ matId: "T5_CLOTH", count: 8 }], matBestPrices: {},
  });
  assert.strictEqual(got.materials[0].count, 8);
});

// ── aggregation ─────────────────────────────────────────────────────────────

const line = (matId, count, city, perUnit, note) => ({ matId, count, city, perUnit, note: note || "" });

test("aggregate multiplies each entry by its quantity", () => {
  const out = aggregateCraftListMaterials([
    { materials: [line("T5_CLOTH", 8, "Martlock", 100)], qty: 10 },
  ]);
  assert.deepStrictEqual(out.lines, [
    { matId: "T5_CLOTH", city: "Martlock", note: "", count: 80, perUnit: 100, total: 8000 },
  ]);
  assert.strictEqual(out.grandTotal, 8000);
});

test("aggregate merges the same material at the same city", () => {
  const out = aggregateCraftListMaterials([
    { materials: [line("T5_CLOTH", 8, "Martlock", 100)], qty: 2 },
    { materials: [line("T5_CLOTH", 4, "Martlock", 100)], qty: 3 },
  ]);
  assert.strictEqual(out.lines.length, 1);
  assert.strictEqual(out.lines[0].count, 28);
  assert.strictEqual(out.lines[0].total, 2800);
});

test("aggregate keeps the same material at different cities apart", () => {
  const out = aggregateCraftListMaterials([
    { materials: [line("T5_CLOTH", 8, "Martlock", 100)], qty: 1 },
    { materials: [line("T5_CLOTH", 8, "Caerleon", 120)], qty: 1 },
  ]);
  assert.strictEqual(out.lines.length, 2);
  assert.strictEqual(out.grandTotal, 8 * 100 + 8 * 120);
});

test("a crafting row and a planner row buying the SAME substitute merge into one line", () => {
  // Both tables now name the bought id, so the board shows one shopping line for
  // the token instead of two under two different names.
  const crafting = extractCraftListRow("crafting-table", {
    item: { id: "T5_HEAD_PLATE_HELL" },
    materials: [{ matId: "T5_ARTEFACT_ARMOR_PLATE_HELL", count: 1 }],
    matBestPrices: {
      T5_ARTEFACT_ARMOR_PLATE_HELL: { id: "T5_ARTEFACT_TOKEN_FAVOR_1", city: "Brecilien", price: 4200 },
    },
  });
  const planner = extractCraftListRow("craft-planner-table", {
    item: { id: "T5_ARMOR_PLATE_HELL" },
    sourcing: [{
      matId: "T5_ARTEFACT_TOKEN_FAVOR_1", origMatId: "T5_ARTEFACT_ARMOR_PLATE_HELL",
      count: 1, sourcing: { city: "Brecilien", perUnit: 4200 },
    }],
  });
  const out = aggregateCraftListMaterials([
    { ...crafting, qty: 2 },
    { ...planner, qty: 3 },
  ]);
  assert.strictEqual(out.lines.length, 1, "one token line, not two");
  assert.strictEqual(out.lines[0].matId, "T5_ARTEFACT_TOKEN_FAVOR_1");
  assert.strictEqual(out.lines[0].count, 5);
  assert.strictEqual(out.lines[0].total, 5 * 4200);
});

test("aggregate sorts by total spend, biggest first", () => {
  const out = aggregateCraftListMaterials([
    { materials: [line("CHEAP", 1, "A", 10), line("PRICEY", 1, "A", 5000), line("MID", 1, "A", 700)], qty: 1 },
  ]);
  assert.deepStrictEqual(out.lines.map((l) => l.matId), ["PRICEY", "MID", "CHEAP"]);
});

test("aggregate takes the first known price when one line is unpriced", () => {
  const out = aggregateCraftListMaterials([
    { materials: [line("T5_CLOTH", 4, "Martlock", 0)], qty: 1 },
    { materials: [line("T5_CLOTH", 4, "Martlock", 100)], qty: 1 },
  ]);
  assert.strictEqual(out.lines[0].perUnit, 100);
  assert.strictEqual(out.lines[0].total, 800);
});

test("a self-refined planner material is tagged, and never merged with a bought one", () => {
  const got = extractCraftListRow("craft-planner-table", {
    item: { id: "T6_BAG" },
    sourcing: [{ matId: "T6_CLOTH", count: 8, sourcing: { source: "chain", city: "Martlock", perUnit: 900 } }],
  });
  assert.strictEqual(got.materials[0].note, "refine");
  const out = aggregateCraftListMaterials([
    { materials: got.materials, qty: 1 },
    { materials: [line("T6_CLOTH", 8, "Martlock", 1500)], qty: 1 },
  ]);
  assert.strictEqual(out.lines.length, 2, "refined and bought lines stay separate");
});

test("aggregate of nothing is empty", () => {
  const out = aggregateCraftListMaterials([]);
  assert.deepStrictEqual(out.lines, []);
  assert.strictEqual(out.grandTotal, 0);
});

test("aggregate tolerates entries with no materials", () => {
  const out = aggregateCraftListMaterials([{ qty: 3 }, { materials: null, qty: 2 }]);
  assert.deepStrictEqual(out.lines, []);
});

finish();
