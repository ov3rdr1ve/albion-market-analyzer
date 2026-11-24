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
 * Run: node --test tests/craft-planner-pricing-journal-focus.test.cjs
 *
 * Furniture journal fill, refine-vs-buy, best focus play, Use Focus toggle, journal mapping, no-data rows. Shared setup: tests/helpers/craft-planner-pricing-setup.cjs.
 */
const {
  assert, computeCraftPlannerRow, getRefineFocusValue, __setFocus, __setCraftFocus,
  __setCraftSpec, test, priceMap, FS, TABLE, TABLE_MATS, tableMarket, refineWinsMarket,
  dominatedTableMarket, barBetweenMarket, sellPlayMarket, finish,
} = require("./helpers/craft-planner-pricing-setup.cjs");

// ── Furniture: market-sourced mats + Toolmaker journal fill ─────────────────
console.log("\n=== Furniture row: market mats + journal fill ===");

test("furniture maps to TOOLMAKER journal and fills positive silver/craft", () => {
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, tableMarket(), FS);
  assert.ok(!row.noData, "should have data");
  assert.strictEqual(row.sourcing[0].sourcing.source, "market");
  assert.ok(row.journal, "journal present");
  assert.strictEqual(row.journal.slug, "TOOLMAKER");
  // fame = 30 mats × 1395 = 41850; silverPerFame = (20000×0.935 − 5000)/58590
  assert.strictEqual(row.journal.famePerCraft, 30 * 1395);
  const expectedSpf = (20000 * (1 - 0.065) - 5000) / 58590;
  assert.ok(Math.abs(row.journal.bestJournal.silverPerFame - expectedSpf) < 1e-6);
  assert.ok(row.journal.extraSilverPerCraft > 0);
});

test("combined profit = craft profit + journal extra", () => {
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, tableMarket(), FS);
  assert.ok(Math.abs(row.combinedProfit - (row.craftProfit + row.journal.extraSilverPerCraft)) < 0.01);
});

test("journal extra = famePerCraft × silverPerFame", () => {
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, tableMarket(), FS);
  const expect = row.journal.famePerCraft * row.journal.bestJournal.silverPerFame;
  assert.ok(Math.abs(row.journal.extraSilverPerCraft - expect) < 0.01);
});

test("only the craft's OWN journal tier counts — a richer T7 is ignored", () => {
  // A T7 journal priced far better on silver/fame than the T8 one. A T8 craft
  // cannot fill it (items.xml lists only T7 items under the T7 journal), so the
  // row must stay on T8 rather than quote a journal it can never fill.
  const md = tableMarket([
    { id: "T7_JOURNAL_TOOLMAKER_EMPTY", city: FS, buy: 1000 },
    { id: "T7_JOURNAL_TOOLMAKER_FULL", city: FS, sell: 20000 },
  ]);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
  assert.strictEqual(row.journal.bestJournal.tier, 8);
});

test("the row reports how many crafts fill one journal", () => {
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, tableMarket(), FS);
  // 58590 fame ÷ 41850 fame per craft ≈ 1.4 crafts.
  const expected = 58590 / (30 * 1395);
  assert.ok(Math.abs(row.journal.craftsToFill - expected) < 1e-9);
  // …and the per-craft silver is the journal margin split across exactly that
  // many crafts — the division the column exists to make.
  const margin = 20000 * (1 - 0.065) - 5000;
  assert.ok(Math.abs(row.journal.extraSilverPerCraft - margin / expected) < 0.01);
});

// ── Refining cheaper than buying → captured as savings, higher profit ───────
console.log("\n=== Refining vs buying refined mat ===");

test("when refining beats buying, sourcing is a chain and refineSavings > 0", () => {
  // Expensive market plank, cheap raws → chain wins.
  const md = priceMap([
    { id: "T8_PLANKS", city: FS, buy: 5000 },
    { id: "T8_WOOD",   city: FS, buy: 10 },
    { id: "T7_PLANKS", city: FS, buy: 50 },     // secondary from market
    { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 60000 },
    { id: "T8_JOURNAL_TOOLMAKER_EMPTY", city: FS, buy: 5000 },
    { id: "T8_JOURNAL_TOOLMAKER_FULL", city: FS, sell: 20000 },
  ]);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
  assert.strictEqual(row.sourcing[0].sourcing.source, "chain");
  assert.ok(row.refineSavings > 0, `refineSavings should be > 0, got ${row.refineSavings}`);
  // Refining lowers input cost vs an all-market sourcing of the same item.
  assert.ok(row.refineCraftCost < 5000 * 30, "input cost reflects cheaper refined mats");
});

// ── Best focus play (craft vs refining a material the craft uses) ───────────
console.log("\n=== Best focus play (single winner: craft vs refine-a-material) ===");

test("all-market mats (no ladder) → best focus play is the craft itself", () => {
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, tableMarket(), FS);
  assert.ok(row.bestFocusStep, "a focus play should be recommended");
  assert.strictEqual(row.bestFocusStep.kind, "craft");
  assert.ok(row.bestFocusStep.silverPerFocus > 0);
});

test("the craft step wins when it removes the most cost — even at 300x the focus", () => {
  // The rule is "which single placement leaves the END PRODUCT most profitable",
  // not "which returns the most per focus point". Here the refine is far the more
  // efficient play (24 focus vs 8,000) but focusing the craft raises the return
  // rate on the whole basket and takes more silver out of the craft, so it wins.
  __setFocus(true);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, refineWinsMarket(), FS);
  __setFocus(false);
  assert.strictEqual(row.bestFocusStep.kind, "craft");
  assert.strictEqual(row.focusWin, "craft");
  assert.ok(row.bestFocusStep.profitDelta > 0);
  // The refine it beat was a genuine candidate — cheaper than the bar — and more
  // focus-efficient; it lost purely on silver removed from the craft.
  const refine = getRefineFocusValue("T8_PLANKS", refineWinsMarket(), FS);
  assert.ok(refine && refine.silverPerFocus > row.bestFocusStep.silverPerFocus,
    "the refine should still be the more focus-efficient play it lost with");
});

test("a refine wins when it removes more cost than the craft step can", () => {
  // Craft at Martlock with full craft spec: the base return rate is already high,
  // so +59 focus buys comparatively little there. The planks have no Martlock
  // refine spec, so the same +59 buys much more on the ladder — and the refine
  // becomes the placement that leaves the finished item most profitable.
  __setCraftSpec(0.40);
  __setFocus(true);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, refineWinsMarket(), "Martlock");
  __setFocus(false);
  assert.strictEqual(row.bestFocusStep.kind, "refine");
  assert.strictEqual(row.bestFocusStep.matId, "T8_PLANKS");
  assert.strictEqual(row.bestFocusStep.resourceType, "wood");
  assert.strictEqual(row.focusWin, "refine");
  assert.ok(row.bestFocusStep.profitDelta > 0);
  // The winning play always feeds this craft: the material is self-refined (chain)
  // with focus applied at that tier — never a "refine it and sell it" play.
  assert.strictEqual(row.sourcing[0].sourcing.source, "chain");
  assert.strictEqual(row.sourcing[0].sourcing.focusTier, 8);
});

test("a refine nobody would run (dearer than the bar, unsellable) is not a focus play", () => {
  // Cheap bar + absurdly pricey raws. Focusing the refine still saves a lot vs
  // refining it WITHOUT focus — but that is a comparison against a play nobody
  // makes: the row buys the bar. Measured against the bar, the focused refine is
  // far dearer, and the plank has no sell price, so there is nothing to sell
  // either → the refine must not be offered at all.
  __setFocus(true);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, dominatedTableMarket(), FS);
  __setFocus(false);
  assert.strictEqual(row.bestFocusStep.kind, "craft");
  assert.strictEqual(row.focusWin, "craft");
  assert.strictEqual(row.sourcing[0].sourcing.source, "market");
});

test("a refine's value is measured against what the row would otherwise PAY", () => {
  // Focus buys the gap between what this row pays for the material today and
  // what the focused refine costs — not the gap against a focus-OFF self-refine
  // the row would never run. Both per-unit figures are observable on the row, so
  // the expectation is derived from it rather than from the pricing internals.
  __setCraftSpec(0.40);
  const md = refineWinsMarket();
  const off = computeCraftPlannerRow(TABLE, TABLE_MATS, md, "Martlock");
  __setFocus(true);
  const on = computeCraftPlannerRow(TABLE, TABLE_MATS, md, "Martlock");
  __setFocus(false);
  const step = off.bestFocusStep;
  assert.strictEqual(step.kind, "refine");
  const paidUnit = off.sourcing[0].sourcing.perUnit;     // what the row pays today
  const focusedUnit = on.sourcing[0].sourcing.perUnit;   // …with focus on that refine
  assert.ok(focusedUnit < paidUnit, "focus must make the material cheaper");
  // Per-unit basis of the candidate: the gap against what the row PAYS, plus setup.
  const expectedUnit = (paidUnit - focusedUnit) * (1 + 0.025);
  assert.ok(Math.abs(step.silverSaved - expectedUnit) < 1e-6,
    `per-unit saving should be ${expectedUnit.toFixed(2)}, got ${step.silverSaved.toFixed(2)}`);
  // Standardized rate (js/focus-play.js): what the play adds to the END PRODUCT
  // per focus point — the per-craft delta, not the per-unit saving.
  assert.ok(Math.abs(step.silverPerFocus - step.profitDelta / step.focusCost) < 1e-9,
    "silverPerFocus must be profitDelta / focusCost");
  assert.ok(Math.abs(step.profitDelta - (off.refineCraftCost - on.refineCraftCost)) < 1e-6,
    "profitDelta must be the input cost the play removes from this craft");
  assert.ok(step.profitDelta > expectedUnit,
    "a recipe using several units of the material must add more than one unit's saving");
});

test("the winner does not move with the craft's focus COST — only with profit", () => {
  // Profit is the objective, so how many focus points a placement costs cannot
  // change which one is chosen; it only breaks exact ties. A craft that wins at
  // 8,000 focus still wins at 1,000, with the identical profit delta.
  const md = barBetweenMarket();
  const dear = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
  __setCraftFocus(1000);
  const cheap = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
  assert.strictEqual(dear.bestFocusStep.kind, "craft");
  assert.strictEqual(cheap.bestFocusStep.kind, "craft");
  assert.ok(Math.abs(dear.bestFocusStep.profitDelta - cheap.bestFocusStep.profitDelta) < 0.01);
  // The silver/focus figure still reports the efficiency difference.
  assert.ok(cheap.bestFocusStep.silverPerFocus > dear.bestFocusStep.silverPerFocus);
});

test("a rich sell price elsewhere never changes the focus play — the screenshot bug", () => {
  // The craft buys the cheap bar (500) and the same bar sells for 25,000 in
  // another city. Refining it to SELL is a different business: it must not win
  // this column, must not re-source the material, and must not credit the row.
  __setFocus(true);
  const rich = computeCraftPlannerRow(TABLE, TABLE_MATS, sellPlayMarket(25000), FS);
  const poor = computeCraftPlannerRow(TABLE, TABLE_MATS, sellPlayMarket(1), FS);
  __setFocus(false);
  assert.strictEqual(rich.bestFocusStep.kind, "craft");
  assert.strictEqual(poor.bestFocusStep.kind, "craft");
  // Identical rows: the bar's sell price is not an input to the decision at all.
  assert.ok(Math.abs(rich.bestFocusStep.profitDelta - poor.bestFocusStep.profitDelta) < 1e-9);
  assert.ok(Math.abs(rich.refineCraftCost - poor.refineCraftCost) < 1e-9);
  // The craft still buys the bar; no refine is captured in its cost.
  assert.strictEqual(rich.sourcing[0].sourcing.source, "market");
  assert.ok(!rich.sourcing[0].sourcing.focusTier, "no focus captured in the craft cost");
});

test("every candidate feeds the craft — a refine winner IS the row's sourcing", () => {
  __setCraftSpec(0.40);
  __setFocus(true);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, refineWinsMarket(), "Martlock");
  __setFocus(false);
  assert.strictEqual(row.bestFocusStep.kind, "refine");
  assert.strictEqual(row.sourcing[0].matId, row.bestFocusStep.matId);
  assert.strictEqual(row.sourcing[0].sourcing.focusTier, row.bestFocusStep.tier);
});

test("profitDelta is exactly the cost the winning play removes", () => {
  const md = refineWinsMarket();
  const off = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
  __setFocus(true);
  const on = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
  __setFocus(false);
  assert.ok(Math.abs((off.refineCraftCost - on.refineCraftCost) - on.bestFocusStep.profitDelta) < 0.01);
  // Same revenue either way, so the cost removed is the profit added.
  assert.ok(Math.abs((on.craftProfit - off.craftProfit) - on.bestFocusStep.profitDelta) < 0.01);
});

// ── Use Focus toggle ────────────────────────────────────────────────────────
console.log("\n=== Use Focus toggle (focus applied to ONE winning play) ===");

test("craft-wins row: focus ON discounts the craft, exactly its silverSaved", () => {
  // All-market mats (no ladder) → the craft is the only focus play → craft wins.
  const md = tableMarket();
  __setFocus(false);
  const off = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
  __setFocus(true);
  const on = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
  __setFocus(false);
  assert.strictEqual(on.bestFocusStep.kind, "craft");
  assert.ok(on.refineCraftCost < off.refineCraftCost,
    `focus-on cost (${on.refineCraftCost.toFixed(0)}) should be < focus-off (${off.refineCraftCost.toFixed(0)})`);
  // The discount is EXACTLY the craft step's silverSaved (focus applied only there).
  assert.ok(Math.abs((off.refineCraftCost - on.refineCraftCost) - on.bestFocusStep.silverSaved) < 0.01,
    `discount should equal craft silverSaved (${on.bestFocusStep.silverSaved.toFixed(1)})`);
  assert.ok(on.combinedProfit > off.combinedProfit);
  assert.strictEqual(on.focusOn, true);
  assert.strictEqual(off.focusOn, false);
});

test("refine-wins row: focus ON self-refines the winning mat cheaper → lower cost", () => {
  // Focus goes on refining the material the craft uses → that bar is cheaper →
  // the craft's headline cost drops (focus is USED in the craft, never sold).
  __setCraftSpec(0.40);
  const md = refineWinsMarket();
  __setFocus(false);
  const off = computeCraftPlannerRow(TABLE, TABLE_MATS, md, "Martlock");
  __setFocus(true);
  const on = computeCraftPlannerRow(TABLE, TABLE_MATS, md, "Martlock");
  __setFocus(false);
  assert.strictEqual(on.bestFocusStep.kind, "refine");
  assert.ok(on.refineCraftCost < off.refineCraftCost,
    `focus on the refine should lower cost (off ${off.refineCraftCost.toFixed(0)}, on ${on.refineCraftCost.toFixed(0)})`);
  assert.strictEqual(on.sourcing[0].sourcing.focusTier, 8);
});

test("focus play is unchanged by the toggle (stable, cost-basis derived)", () => {
  const md = tableMarket();
  __setFocus(false);
  const off = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
  __setFocus(true);
  const on = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
  __setFocus(false);
  // Same recommended play + same silver/focus regardless of the headline toggle.
  assert.strictEqual(on.bestFocusStep.kind, off.bestFocusStep.kind);
  assert.ok(Math.abs(on.bestFocusStep.silverPerFocus - off.bestFocusStep.silverPerFocus) < 1e-6);
});

// ── Gear without a journal mapping ──────────────────────────────────────────
console.log("\n=== Gear with no mapped journal ===");

test("a craft that fills no journal → no journal, combined profit == craft profit", () => {
  // A faction cape: a COMBINE craft, absent from every journal's validitem list.
  const item = { id: "T8_CAPEITEM_AVALON", name: "Elder's Avalonian Cape", craftType: "cape" };
  const mats = [{ matId: "T8_LEATHER", count: 16 }];
  const md = priceMap([
    { id: "T8_LEATHER", city: FS, buy: 1500 },
    { id: "T8_CAPEITEM_AVALON", city: FS, sell: 90000 },
  ]);
  const row = computeCraftPlannerRow(item, mats, md, FS);
  assert.ok(!row.noData);
  assert.strictEqual(row.journal, null);
  assert.ok(Math.abs(row.combinedProfit - row.craftProfit) < 0.01);
});

// ── Mapped gear journal (plate → WARRIOR) ───────────────────────────────────
console.log("\n=== Gear journal mapping ===");

test("plate armor fills WARRIOR journal", () => {
  const item = { id: "T8_ARMOR_PLATE_SET1", name: "Soldier Armor", craftType: "plate_armor" };
  const mats = [{ matId: "T8_METALBAR", count: 16 }];
  const md = priceMap([
    { id: "T8_METALBAR", city: FS, buy: 1200 },
    { id: "T8_ARMOR_PLATE_SET1", city: FS, sell: 80000 },
    { id: "T8_JOURNAL_WARRIOR_EMPTY", city: FS, buy: 4000 },
    { id: "T8_JOURNAL_WARRIOR_FULL", city: FS, sell: 18000 },
  ]);
  const row = computeCraftPlannerRow(item, mats, md, FS);
  assert.strictEqual(row.journal.slug, "WARRIOR");
  assert.ok(row.journal.extraSilverPerCraft > 0);
});

// ── No data ─────────────────────────────────────────────────────────────────
console.log("\n=== No data ===");

test("unpriced material → no-data row", () => {
  const md = priceMap([{ id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 60000 }]);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
  assert.ok(row.noData, "should be a no-data row when a material has no price");
});

test("no sell price → no-data row", () => {
  const md = priceMap([{ id: "T8_PLANKS", city: FS, buy: 1000 }]);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
  assert.ok(row.noData);
});

finish();
