/**
 * My Crafting List — per-table row extraction + material aggregation
 * (js/craft-list-materials.js).
 *
 * Black-box: one synthetic row per source table (shapes copied from the real
 * row builders), asserting the normalized {itemId, inputCost, unitProfit,
 * materials[]} the list panel consumes, then the pure aggregator that turns
 * entries × quantity into a shopping list.
 *
 * Run: node --test tests/craft-list-materials-totals.test.cjs
 *
 * Cost / profit / focus totals, laborer-journal play, journals to laborers, headcount back-solve. Shared setup: tests/helpers/craft-list-materials-setup.cjs.
 */
const {
  assert, extractCraftListRow, aggregateCraftListMaterials, summarizeCraftList,
  scaleCraftListToLaborers, test, finish,
} = require("./helpers/craft-list-materials-setup.cjs");

// ── totals ──────────────────────────────────────────────────────────────────

test("summarize scales cost, revenue and profit by quantity", () => {
  const s = summarizeCraftList([
    { inputCost: 1000, sellPrice: 1500, unitProfit: 400, focusCost: 100, qty: 10 },
    { inputCost: 200, sellPrice: 300, unitProfit: 50, focusCost: 0, qty: 4 },
  ]);
  assert.strictEqual(s.count, 2);
  assert.strictEqual(s.totalCost, 10800);
  assert.strictEqual(s.totalRevenue, 16200);
  assert.strictEqual(s.totalProfit, 4200);
  assert.strictEqual(s.totalFocus, 1000);
});

// The reported basket: two watered farming rows plus one stew. The farming
// focus used to vanish on the way in, footering 3.89 instead of 403.89.
test("summarize counts a farming row's focus, not just the crafts", () => {
  const s = summarizeCraftList([
    extractCraftListRow("farming-table", {
      item: { id: "T5_CARROT_SEED", outputId: "T5_CARROT" },
      focusCost: 200, outputsPerCycle: 1, focusPerOutput: 200,
      totalInputCost: 500, marginInfo: { profit: 250 },
    }),
    extractCraftListRow("consumable-table", {
      item: { id: "T6_MEAL_STEW" }, focusCost: 3.89,
      totalInputCost: 2900, marginInfo: { profit: 1500 },
    }),
  ].map((row, i) => ({ ...row, qty: i === 0 ? 2 : 1 })));
  assert.strictEqual(Math.round(s.totalFocus * 100) / 100, 403.89);
});

// -- farming speaks ONE unit: the harvested crop -----------------------------
//
// The reported basket: 15,000 potatoes at 125 focus a watered 81-crop cycle.
// Billing the CYCLE's focus per crop footered 1,875,000 focus - 187 days of a
// 10,000/day bar - for a basket that really spends ~23,148.
test("a farming basket's focus is per crop, not per cycle", () => {
  const potato = extractCraftListRow("farming-table", {
    item: { id: "T6_FARM_POTATO_SEED", outputId: "T6_POTATO" },
    buySeed: { city: "Fort Sterling", price: 16000 },
    sellCrop: { city: "Thetford", price: 438 },
    totalInputCost: 37.4,
    marginInfo: { profit: 368.1 },
    focusCost: 125, outputsPerCycle: 81,
    focusPerOutput: 125 / 81, seedsPerOutput: 0.00367,
  });
  const s = summarizeCraftList([{ ...potato, qty: 15000 }]);
  assert.strictEqual(Math.round(s.totalFocus), 23148);
});

// A plot at or above 100% seed yield re-seeds itself: there is nothing to buy,
// and a "0x seed" line on the shopping board is noise, not information.
test("a surplus farming row lists no seed to buy", () => {
  const got = extractCraftListRow("farming-table", {
    item: { id: "T8_FARM_PUMPKIN_SEED", outputId: "T8_PUMPKIN" },
    buySeed: { city: "Fort Sterling", price: 30000 },
    sellCrop: { city: "Martlock", price: 402 },
    marginInfo: { profit: 300 },
    focusCost: 125, outputsPerCycle: 81, focusPerOutput: 125 / 81,
    seedsPerOutput: 0,
  });
  assert.deepStrictEqual(got.materials, []);
  const agg = aggregateCraftListMaterials([{ ...got, qty: 5000 }]);
  assert.deepStrictEqual(agg.lines, []);
});

// The seed count scales by quantity like any other material - net of the seed
// return, the same convention _clEffCount uses for a craft's return rate.
test("the seed line is net per crop and scales by quantity", () => {
  const got = extractCraftListRow("farming-table", {
    item: { id: "T6_FARM_POTATO_SEED", outputId: "T6_POTATO" },
    buySeed: { city: "Fort Sterling", price: 16000 },
    sellCrop: { city: "Thetford", price: 438 },
    marginInfo: { profit: 368.1 },
    focusCost: 125, outputsPerCycle: 81, focusPerOutput: 125 / 81,
    seedsPerOutput: 0.00367,
  });
  const agg = aggregateCraftListMaterials([{ ...got, qty: 15000 }]);
  assert.strictEqual(agg.lines.length, 1);
  assert.strictEqual(agg.lines[0].matId, "T6_FARM_POTATO_SEED");
  assert.strictEqual(Math.round(agg.lines[0].count), 55);
});

// A pasture row buys FEED, not seed: the same per-output line, and its focus
// play lives on the baby in the Mounts table, so this row spends none.
test("a pasture row lists its feed per output and no focus", () => {
  const got = extractCraftListRow("farming-table", {
    item: { id: "T6_POTATO", outputId: "T6_MILK" },
    buySeed: { city: "Martlock", price: 400 },
    sellCrop: { city: "Martlock", price: 900 },
    marginInfo: { profit: 500 },
    focusCost: 0, outputsPerCycle: 9, focusPerOutput: 0, seedsPerOutput: 1,
  });
  assert.strictEqual(got.focusCost, 0);
  assert.deepStrictEqual(
    got.materials.map((m) => ({ matId: m.matId, count: m.count })),
    [{ matId: "T6_POTATO", count: 1 }],
  );
});

// An older row shape (no per-output fields) must not fall back to the CYCLE
// figure - that is the bug. Missing means 0, and a missing seed count lists
// nothing rather than one seed a crop.
test("a farming row without per-output fields contributes no focus", () => {
  const got = extractCraftListRow("farming-table", {
    item: { id: "T5_CARROT_SEED", outputId: "T5_CARROT" },
    focusCost: 200, marginInfo: { profit: 250 },
  });
  assert.strictEqual(got.focusCost, 0);
  assert.deepStrictEqual(got.materials, []);
});

test("summarize of an empty list is all zeros", () => {
  assert.deepStrictEqual(summarizeCraftList([]), {
    count: 0, totalCost: 0, totalRevenue: 0, totalProfit: 0,
    totalFp: 0, totalFavor: 0,
    totalLaborerProfit: 0, laborerRows: 0,
    totalJournals: 0, journalGroups: [], totalFocus: 0,
    // With no focus budget passed, the basket is uncapped: what it needs is
    // what it spends, and nothing is short.
    focusNeeded: 0, focusUnfunded: 0, focusBudget: Infinity, focusCapped: false,
    // Nothing on the list spends its focus in instalments, so the focus
    // figures are a one-sitting spend (see the breeding rows below).
    focusDays: 1,
  });
});

test("summarize treats missing fields as zero", () => {
  const s = summarizeCraftList([{ qty: 5 }]);
  assert.strictEqual(s.totalCost, 0);
  assert.strictEqual(s.totalProfit, 0);
});

// ── totals: the laborer-journal play ────────────────────────────────────────

test("summarize scales the laborer profit by quantity and counts the row", () => {
  const s = summarizeCraftList([
    { unitProfit: 400, laborerProfit: 450, hasLaborerPlay: true, qty: 10 },
  ]);
  assert.strictEqual(s.totalProfit, 4000);
  assert.strictEqual(s.totalLaborerProfit, 4500);
  assert.strictEqual(s.laborerRows, 1);
});

test("an entry with no laborer play falls back to its plain profit", () => {
  const s = summarizeCraftList([{ unitProfit: 400, qty: 10 }]);
  assert.strictEqual(s.totalLaborerProfit, 4000, "same basket, same silver");
  assert.strictEqual(s.laborerRows, 0);
});

test("mixed basket: only the craftable row switches play", () => {
  const s = summarizeCraftList([
    { unitProfit: 17195, laborerProfit: 17454, hasLaborerPlay: true, qty: 233 },
    { unitProfit: 1000, qty: 5 },
  ]);
  assert.strictEqual(s.totalProfit, 17195 * 233 + 5000);
  assert.strictEqual(s.totalLaborerProfit, 17454 * 233 + 5000);
  assert.strictEqual(s.laborerRows, 1);
});

test("a negative laborer play still totals", () => {
  const s = summarizeCraftList([
    { unitProfit: 100, laborerProfit: -250, hasLaborerPlay: true, qty: 3 },
  ]);
  assert.strictEqual(s.totalLaborerProfit, -750);
});

[
  ["craft-planner-table", "laborerCombinedProfit", "combinedProfit", {
    item: { id: "T5_BAG_INSIGHT", name: "Satchel" },
    craftCity: "Caerleon", sellCity: "Black Market",
    sellPrice: 57639, refineCraftCost: 40073, sourcing: [],
  }],
  ["crafting-table", "profitWithLaborer", "marginInfoProfit", {
    item: { id: "T5_BAG", name: "Bag" },
    craftCity: "Caerleon", sellGear: { city: "Caerleon", price: 5000 },
    totalInputCost: 3000, focusCost: 0, materials: [], matBestPrices: {},
  }],
].forEach(([tableId, laborerField, plainField, base]) => {
  const withPlain = (row, v) => (plainField === "marginInfoProfit"
    ? { ...row, marginInfo: { profit: v } }
    : { ...row, [plainField]: v });

  test(`${tableId}: ${laborerField} reaches the list as laborerProfit`, () => {
    const out = extractCraftListRow(tableId, withPlain({ ...base, [laborerField]: 17454 }, 17195));
    assert.strictEqual(out.unitProfit, 17195);
    assert.strictEqual(out.laborerProfit, 17454);
    assert.strictEqual(out.hasLaborerPlay, true);
  });

  test(`${tableId}: no ${laborerField} means no laborer play`, () => {
    const out = extractCraftListRow(tableId, withPlain({ ...base }, 17195));
    assert.strictEqual(out.laborerProfit, 17195, "falls back to the plain profit");
    assert.strictEqual(out.hasLaborerPlay, false);
  });
});

// ── totals: journals filled → laborers needed ───────────────────────────────

const fill = (slug, tier, craftsPerJournal) => ({ slug, tier, craftsPerJournal });
const TINKER5 = fill("TOOLMAKER", 5, 2.5);

test("233 crafts at 2.5 crafts/journal fill 93 journals", () => {
  const s = summarizeCraftList([
    { unitProfit: 17195, laborerProfit: 17454, hasLaborerPlay: true, laborerFill: TINKER5, qty: 233 },
  ]);
  assert.strictEqual(s.totalJournals, 93, "233 / 2.5 = 93.2, floored");
  assert.deepStrictEqual(s.journalGroups, [{ slug: "TOOLMAKER", tier: 5, journals: 93 }]);
});

test("two partial fills of the SAME journal add up to one", () => {
  const s = summarizeCraftList([
    { laborerFill: TINKER5, qty: 2 },   // 0.8
    { laborerFill: TINKER5, qty: 1 },   // 0.4
  ]);
  assert.strictEqual(s.totalJournals, 1);
});

test("partial fills of DIFFERENT journals never merge", () => {
  const s = summarizeCraftList([
    { laborerFill: TINKER5, qty: 2 },                        // 0.8 Tinker T5
    { laborerFill: fill("WARRIOR", 4, 2.5), qty: 2 },        // 0.8 Blacksmith T4
  ]);
  assert.strictEqual(s.totalJournals, 0, "0.8 + 0.8 is not one journal of either");
  assert.deepStrictEqual(s.journalGroups, []);
});

test("the same profession at DIFFERENT tiers stays apart", () => {
  const s = summarizeCraftList([
    { laborerFill: TINKER5, qty: 2 },
    { laborerFill: fill("TOOLMAKER", 6, 2.5), qty: 2 },
  ]);
  assert.strictEqual(s.totalJournals, 0);
});

test("a laborer profit with no fill rate counts no journals", () => {
  const s = summarizeCraftList([
    { unitProfit: 100, laborerProfit: 150, hasLaborerPlay: true, qty: 10 },
  ]);
  assert.strictEqual(s.totalJournals, 0);
  assert.strictEqual(s.totalLaborerProfit, 1500, "the profit play is unaffected");
});

test("journal groups come back biggest first", () => {
  const s = summarizeCraftList([
    { laborerFill: fill("WARRIOR", 4, 1), qty: 5 },
    { laborerFill: TINKER5, qty: 250 },
  ]);
  assert.deepStrictEqual(s.journalGroups.map((g) => g.journals), [100, 5]);
});

[
  ["craft-planner-table", {
    item: { id: "T6_BAG" }, craftCity: "Martlock", sellCity: "Caerleon",
    sellPrice: 30000, refineCraftCost: 20000, combinedProfit: 6000,
    laborerCombinedProfit: 6200, sourcing: [],
  }],
  ["crafting-table", {
    item: { id: "T5_BAG" }, craftCity: "Thetford", sellGear: { city: "Caerleon", price: 12000 },
    totalInputCost: 7200, marginInfo: { profit: 400 }, profitWithLaborer: 650,
    materials: [], matBestPrices: {},
  }],
].forEach(([tableId, base]) => {
  test(`${tableId}: the journal fill rate reaches the list`, () => {
    const out = extractCraftListRow(tableId, {
      ...base,
      laborerJournal: { slug: "TOOLMAKER", famePerCraft: 200, bestJournal: { tier: 5, maxfame: 500 } },
    });
    assert.deepStrictEqual(out.laborerFill, { slug: "TOOLMAKER", tier: 5, craftsPerJournal: 2.5 });
  });

  test(`${tableId}: no winning journal means no fill rate`, () => {
    const out = extractCraftListRow(tableId, {
      ...base,
      laborerJournal: { slug: "TOOLMAKER", famePerCraft: 200, bestJournal: null },
    });
    assert.strictEqual(out.laborerFill, null);
  });

  test(`${tableId}: zero fame per craft means no fill rate`, () => {
    const out = extractCraftListRow(tableId, {
      ...base,
      laborerJournal: { slug: "TOOLMAKER", famePerCraft: 0, bestJournal: { tier: 5, maxfame: 500 } },
    });
    assert.strictEqual(out.laborerFill, null);
  });
});

// ── back-solving quantities from a laborer headcount ────────────────────────

const solverRow = (rowKey, qty, laborerFill) =>
  ({ tableId: "craft-planner-table", rowKey, qty, laborerFill });

test("doubling the laborers doubles the quantity", () => {
  const out = scaleCraftListToLaborers([solverRow("a", 233, TINKER5)], 186);
  assert.deepStrictEqual(out, [{ tableId: "craft-planner-table", rowKey: "a", qty: 466 }]);
});

test("retyping the count already shown changes nothing", () => {
  assert.deepStrictEqual(scaleCraftListToLaborers([solverRow("a", 233, TINKER5)], 93), []);
});

test("every laborer row scales by the same factor, keeping the mix", () => {
  const out = scaleCraftListToLaborers([
    solverRow("a", 100, fill("TOOLMAKER", 5, 2)),   // 50 journals
    solverRow("b", 100, fill("WARRIOR", 4, 2)),     // 50 journals
  ], 200);
  assert.deepStrictEqual(out.map((c) => c.qty), [200, 200]);
});

test("a row with no laborer play is never touched", () => {
  const out = scaleCraftListToLaborers([
    solverRow("a", 233, TINKER5),
    solverRow("b", 50, null),
  ], 186);
  assert.deepStrictEqual(out.map((c) => c.rowKey), ["a"]);
});

[
  ["zero", 0], ["blank", ""], ["negative", -5], ["not a number", "abc"], ["null", null],
].forEach(([label, target]) => {
  test(`a ${label} target changes nothing`, () => {
    assert.deepStrictEqual(scaleCraftListToLaborers([solverRow("a", 233, TINKER5)], target), []);
  });
});

test("a list with no laborer play at all solves to nothing", () => {
  assert.deepStrictEqual(scaleCraftListToLaborers([solverRow("a", 10, null)], 5), []);
});

test("scaling down never drops a row to zero crafts", () => {
  const out = scaleCraftListToLaborers([
    solverRow("a", 1000, fill("TOOLMAKER", 5, 1)),
    solverRow("b", 4, fill("TOOLMAKER", 5, 1)),
  ], 2);
  assert.deepStrictEqual(out.map((c) => c.qty), [2, 1], "b rounds to 0.008 but floors at 1 craft");
});

test("a basket too small to fill one journal still scales up", () => {
  // 1 craft of a 2.5-crafts/journal row floors to 0 journals — the solver falls
  // back to the fractional fill so the box is not a dead control.
  const out = scaleCraftListToLaborers([solverRow("a", 1, TINKER5)], 10);
  assert.deepStrictEqual(out, [{ tableId: "craft-planner-table", rowKey: "a", qty: 25 }]);
});

finish();
