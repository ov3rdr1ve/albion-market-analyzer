/**
 * Test: craft-planner-pricing — end-to-end economics for the Crafting Planner.
 *
 * Black-box: feed synthetic market data + an item recipe, assert the combined
 * (refine + craft + journal-fill) profit, the refining savings vs buying mats,
 * the journal-fill silver per craft, and the single best focus step.
 *
 * Loads the REAL refining-chain + data-craft-planner modules (the planner is a
 * thin orchestration over them) plus a sandbox of the craft-side stubs.
 *
 * Run: node --test tests/craft-planner-pricing-refine-10k.test.cjs
 *
 * Refine-focus valuation, global best focus, laborer-fed journal, Profit / 10k Focus. Shared setup: tests/helpers/craft-planner-pricing-setup.cjs.
 */
const {
  assert, computeCraftPlannerRow, getRefineFocusValue, getRefineSellFocus,
  computeCraftPlannerGlobalFocus, __setFocus, __setCraftFocus, __setCraftSpec, test, priceMap,
  FS, TABLE, TABLE_MATS, tableMarket, refineWinsMarket, barBetweenMarket, deepLadderMarket,
  finish,
} = require("./helpers/craft-planner-pricing-setup.cjs");

// ── Refine-focus valuation + global best focus ──────────────────────────────
console.log("\n=== Refine-focus valuation + global best focus ===");

test("refine step names the item produced at ITS tier, not the ladder's top", () => {
  const step = getRefineFocusValue("T8_PLANKS", deepLadderMarket(), FS);
  assert.ok(step, "a refine focus play should exist on a priced ladder");
  assert.strictEqual(step.matId, "T8_PLANKS", "the material is still the ladder root");
  assert.strictEqual(step.focusItemId, `T${step.tier}_PLANKS`,
    `focusItemId should be the T${step.tier} output, got ${step.focusItemId}`);
});

test("single-node ladder → focusItemId is the material itself", () => {
  const step = getRefineFocusValue("T8_PLANKS", refineWinsMarket(), FS);
  assert.strictEqual(step.tier, 8);
  assert.strictEqual(step.focusItemId, "T8_PLANKS");
});

test("the row's best focus step carries focusItemId too", () => {
  __setCraftSpec(0.40);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, deepLadderMarket(), "Martlock");
  assert.strictEqual(row.bestFocusStep.kind, "refine");
  assert.strictEqual(row.bestFocusStep.focusItemId, `T${row.bestFocusStep.tier}_PLANKS`);
});

test("getRefineFocusValue → null when the ladder has no priced raw", () => {
  // Only the bar is priced, no raws → chain can't build.
  const md = priceMap([{ id: "T8_PLANKS", city: FS, buy: 500 }]);
  assert.strictEqual(getRefineFocusValue("T8_PLANKS", md, FS), null);
  assert.strictEqual(getRefineSellFocus("T8_PLANKS", md, FS), null); // legacy alias
});

test("getRefineFocusValue with an explicit baselineUnit prices against THAT cost", () => {
  const md = barBetweenMarket();
  // Told the row pays 2,100 (the bar) → small gain. Told it pays 2,600 → bigger.
  const cheap = getRefineFocusValue("T8_PLANKS", md, FS, { baselineUnit: 2100 });
  const dear = getRefineFocusValue("T8_PLANKS", md, FS, { baselineUnit: 2600 });
  assert.ok(cheap.silverPerFocus > 0 && dear.silverPerFocus > cheap.silverPerFocus,
    `dear baseline should pay more per focus (${cheap.silverPerFocus} vs ${dear.silverPerFocus})`);
  // A baseline below the focused refine leaves nothing for focus to buy in the
  // craft; with no sell price on the bar there is no fallback play either.
  assert.strictEqual(getRefineFocusValue("T8_PLANKS", md, FS, { baselineUnit: 1000 }), null);
});

test("no baselineUnit → the cheaper of the market bar and a focus-off refine", () => {
  // Same market, called the way the Refining-side callers do (no opts): the
  // function works out for itself what the bar would otherwise cost.
  const implicit = getRefineFocusValue("T8_PLANKS", barBetweenMarket(), FS);
  const explicit = getRefineFocusValue("T8_PLANKS", barBetweenMarket(), FS, { baselineUnit: 2100 });
  assert.ok(Math.abs(implicit.silverPerFocus - explicit.silverPerFocus) < 1e-9);
});

test("getRefineFocusValue → positive refine step when the ladder is priced", () => {
  const step = getRefineFocusValue("T8_PLANKS", refineWinsMarket(), FS);
  assert.ok(step, "a refine step should be returned");
  assert.strictEqual(step.kind, "refine");
  assert.strictEqual(step.matId, "T8_PLANKS");
  assert.strictEqual(step.resourceType, "wood");
  assert.ok(step.chain, "carries the ladder chain for re-pricing");
  assert.ok(step.silverPerFocus > 0);
  assert.ok(step.focusCost > 0);
});

test("global best focus = the max silver/focus over rows' bestFocusStep", () => {
  __setFocus(true);
  const rRefine = computeCraftPlannerRow(TABLE, TABLE_MATS, refineWinsMarket(), FS);
  __setFocus(false);
  const global = computeCraftPlannerGlobalFocus([rRefine], refineWinsMarket());
  assert.ok(global, "global present");
  assert.strictEqual(global.kind, rRefine.bestFocusStep.kind);
  assert.ok(Math.abs(global.silverPerFocus - rRefine.bestFocusStep.silverPerFocus) < 1e-6);
});

test("global best focus ignores no-data rows", () => {
  const noData = computeCraftPlannerRow(TABLE, TABLE_MATS,
    priceMap([{ id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 60000 }]), FS);
  assert.ok(noData.noData);
  assert.strictEqual(computeCraftPlannerGlobalFocus([noData], {}), null);
});

// ── Laborer-fed journal (work the journal instead of selling it) ───────────
console.log("\n=== Laborer-fed journal: profit when your own laborer works it ===");

// Tinker (TOOLMAKER) returns PLANKS .4444 / METALBAR .2222 / CLOTH .2222 / LEATHER .1112.
function laborerMarket(extra = []) {
  return priceMap([
    { id: "T8_PLANKS", city: FS, buy: 1000, sell: 1000 },
    { id: "T8_METALBAR", city: FS, sell: 2000 },
    { id: "T8_CLOTH", city: FS, sell: 1500 },
    { id: "T8_LEATHER", city: FS, sell: 1800 },
    { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 60000 },
    { id: "T8_JOURNAL_TOOLMAKER_EMPTY", city: FS, buy: 5000 },
    { id: "T8_JOURNAL_TOOLMAKER_FULL", city: FS, sell: 20000 },
    ...extra,
  ]);
}

test("row carries the laborer-worked journal value alongside the market one", () => {
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, laborerMarket(), FS);
  assert.ok(row.laborerJournal, "laborerJournal present");
  assert.strictEqual(row.laborerJournal.slug, "TOOLMAKER");
  assert.ok(row.laborerJournal.extraSilverPerCraft > 0);
  // Same fame source as the sell-the-journal model — only the payout differs.
  assert.strictEqual(row.laborerJournal.famePerCraft, row.journal.famePerCraft);
});

test("laborerCombinedProfit = craft profit + laborer value (never both journal plays)", () => {
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, laborerMarket(), FS);
  const expected = row.craftProfit + row.laborerJournal.extraSilverPerCraft;
  assert.ok(Math.abs(row.laborerCombinedProfit - expected) < 0.01);
  // The market-journal headline must stay untouched by the laborer column.
  assert.ok(Math.abs(row.combinedProfit - (row.craftProfit + row.journal.extraSilverPerCraft)) < 0.01);
});

test("journal market prices do not move the laborer figure", () => {
  const a = computeCraftPlannerRow(TABLE, TABLE_MATS, laborerMarket(), FS);
  const b = computeCraftPlannerRow(TABLE, TABLE_MATS, laborerMarket([
    { id: "T8_JOURNAL_TOOLMAKER_EMPTY", city: FS, buy: 400000 },
    { id: "T8_JOURNAL_TOOLMAKER_FULL", city: FS, sell: 1 },
  ]), FS);
  assert.ok(Math.abs(a.laborerJournal.extraSilverPerCraft - b.laborerJournal.extraSilverPerCraft) < 1e-9);
  assert.ok(a.combinedProfit !== b.combinedProfit, "the market model DOES move with them");
});

test("no priced refined output → no laborer journal, headline falls back to craft profit", () => {
  const md = priceMap([
    { id: "T8_PLANKS", city: FS, buy: 1000 },
    { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 60000 },
  ]);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
  assert.strictEqual(row.laborerJournal.bestJournal, null);
  assert.strictEqual(row.laborerCombinedProfit, row.craftProfit);
});

// ── Profit / 10k focus (a whole focus bar spent on this row) ───────────────
// The figure multiplies `focusCombinedProfit`, the FOCUS-ON profit per craft —
// spending a bar is focus-on play by definition, so the column is a benchmark
// and must not follow the "Use Focus" checkbox. `combinedProfit` is the
// headline and equals it only while the checkbox is on.
console.log("\n=== Profit / 10k Focus ===");

// Cheap bar → buying beats self-refining, so the craft step is the only focus
// candidate and the row burns exactly the craft's focus cost per craft.
test("craft-focus row: focus per craft = the craft's focus cost", () => {
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, tableMarket(), FS);
  assert.strictEqual(row.bestFocusStep.kind, "craft");
  assert.strictEqual(row.focusPerCraft, 8000);
  assert.strictEqual(row.craftsPer10kFocus, 1);
  assert.ok(Math.abs(row.profitPer10kFocus - row.focusCombinedProfit * 1) < 0.01);
});

test("a cheaper craft focus buys more whole crafts per bar (floor, no partials)", () => {
  __setCraftFocus(3000);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, tableMarket(), FS);
  assert.strictEqual(row.focusPerCraft, 3000);
  assert.strictEqual(row.craftsPer10kFocus, 3, "10000/3000 floors to 3");
  assert.ok(Math.abs(row.profitPer10kFocus - row.focusCombinedProfit * 3) < 0.01);
});

// A T8 artifact craft can cost more focus than a whole bar. Flooring read 0
// crafts there, so the column printed 0 on a craft that earns 264k.
[
  [13066, 10000 / 13066],
  [10001, 10000 / 10001],
  [20000, 0.5],
].forEach(([focus, crafts]) => {
  test(`a craft costing ${focus} focus (> the bar) buys a fraction of one craft`, () => {
    __setCraftFocus(focus);
    const row = computeCraftPlannerRow(TABLE, TABLE_MATS, tableMarket(), FS);
    assert.strictEqual(row.focusPerCraft, focus);
    assert.ok(Math.abs(row.craftsPer10kFocus - crafts) < 1e-9, `crafts ${row.craftsPer10kFocus}`);
    assert.ok(row.profitPer10kFocus > 0, "must not floor to 0");
    assert.ok(Math.abs(row.profitPer10kFocus - row.focusCombinedProfit * crafts) < 0.01);
  });
});

// When focus goes on a material's REFINE, one craft needs one focused refine per
// unit of that material it actually consumes — so the bar buys far fewer crafts
// than the single refine's focus cost suggests.
test("refine-focus row: focus per craft scales with the units the craft consumes", () => {
  __setCraftSpec(0.40);          // shrinks what focusing the craft buys
  __setCraftFocus(8000);
  const md = priceMap([
    { id: "T8_PLANKS", city: FS, buy: 5000 },
    { id: "T8_WOOD",   city: FS, buy: 10 },
    { id: "T7_PLANKS", city: FS, buy: 50 },
    { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 600000 },
    { id: "T8_JOURNAL_TOOLMAKER_EMPTY", city: FS, buy: 5000 },
    { id: "T8_JOURNAL_TOOLMAKER_FULL", city: FS, sell: 20000 },
  ]);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, md, "Lymhurst"); // no wood spec
  assert.strictEqual(row.bestFocusStep.kind, "refine");
  // 24 focus per T8 plank refine × the planks one craft eats (30 net of craft RRR).
  const expected = 24 * 30 * (1 - row.rrr);
  assert.ok(Math.abs(row.focusPerCraft - expected) < 1e-6,
    `focus/craft ${row.focusPerCraft}, expected ${expected}`);
  assert.strictEqual(row.craftsPer10kFocus, Math.floor(10000 / expected));
  assert.ok(Math.abs(row.profitPer10kFocus - row.focusCombinedProfit * row.craftsPer10kFocus) < 0.01);
});

test("profit per 10k focus is the focus-ON profit, journal fill included", () => {
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, tableMarket(), FS);
  assert.ok(row.profitPer10kFocus !== row.craftProfit * row.craftsPer10kFocus,
    "must be the combined (craft + journal) figure, not the bare craft profit");
  assert.ok(Math.abs(row.profitPer10kFocus - row.focusCombinedProfit * row.craftsPer10kFocus) < 0.01);
});

// focusCraftProfit is the focus-ON craft profit with NO journal silver in it.
// The laborer-fed play is the OTHER journal play, so its own 10k-focus figure has
// to start from the bare craft rather than from focusCombinedProfit, which
// already carries the sell-the-journal silver.
test("focusCraftProfit is the focus-ON craft profit, journal excluded", () => {
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, tableMarket(), FS);
  const journalExtra = row.journal ? row.journal.extraSilverPerCraft : 0;
  assert.ok(journalExtra > 0, "fixture sanity: this craft fills a priced journal");
  assert.ok(Math.abs(row.focusCombinedProfit - (row.focusCraftProfit + journalExtra)) < 0.01,
    `${row.focusCombinedProfit} != ${row.focusCraftProfit} + ${journalExtra}`);
});

test("focusCraftProfit is invariant to the Use Focus checkbox", () => {
  __setFocus(true);
  const on = computeCraftPlannerRow(TABLE, TABLE_MATS, tableMarket(), FS);
  __setFocus(false);
  const off = computeCraftPlannerRow(TABLE, TABLE_MATS, tableMarket(), FS);
  assert.ok(Math.abs(on.craftProfit - off.craftProfit) > 1e-6,
    "fixture sanity: the headline craft profit must react to the checkbox");
  assert.ok(Math.abs(on.focusCraftProfit - off.focusCraftProfit) < 1e-6,
    `focus-on operand must not move (on=${on.focusCraftProfit}, off=${off.focusCraftProfit})`);
  __setFocus(true);
});

test("with focus ON the headline craft profit IS the focus-on one", () => {
  __setFocus(true);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, tableMarket(), FS);
  assert.ok(Math.abs(row.craftProfit - row.focusCraftProfit) < 1e-6,
    "focus-on headline and focus-on operand must agree");
});

test("no focus play at all → no 10k figure (null, not a fake zero)", () => {
  __setCraftFocus(0);            // combine-style craft: no focus cost
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, tableMarket(), FS);
  assert.strictEqual(row.bestFocusStep, null);
  assert.strictEqual(row.focusPerCraft, 0);
  assert.strictEqual(row.profitPer10kFocus, null);
});

// The column prices a focus bar, so BOTH its operands are focus-on: flipping
// the checkbox must not move it, even though the headline profit does move.
test("Profit / 10k Focus is invariant to the Use Focus checkbox", () => {
  __setFocus(true);
  const on = computeCraftPlannerRow(TABLE, TABLE_MATS, tableMarket(), FS);
  __setFocus(false);
  const off = computeCraftPlannerRow(TABLE, TABLE_MATS, tableMarket(), FS);
  assert.ok(Math.abs(on.combinedProfit - off.combinedProfit) > 1e-6,
    "fixture sanity: the headline profit must react to the checkbox");
  assert.ok(Math.abs(on.profitPer10kFocus - off.profitPer10kFocus) < 1e-6,
    `Profit / 10k Focus must be invariant (on=${on.profitPer10kFocus}, off=${off.profitPer10kFocus})`);
  assert.strictEqual(on.craftsPer10kFocus, off.craftsPer10kFocus,
    "crafts a bar buys is a focus-on count too");
  assert.ok(Math.abs(on.focusCombinedProfit - off.focusCombinedProfit) < 1e-6);
});

test("with focus OFF the 10k figure is the focus-ON profit, not the headline", () => {
  __setFocus(false);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, tableMarket(), FS);
  assert.ok(row.focusCombinedProfit > row.combinedProfit,
    "focus lowers input cost, so the focus-on profit is the higher one");
  assert.ok(Math.abs(row.profitPer10kFocus - row.combinedProfit * row.craftsPer10kFocus) > 1e-6,
    "the checkbox profit must not be what the column multiplies");
});

test("no-data rows carry no 10k figure", () => {
  const md = priceMap([{ id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 60000 }]);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
  assert.ok(row.noData);
  assert.strictEqual(row.profitPer10kFocus, undefined);
});

finish();
