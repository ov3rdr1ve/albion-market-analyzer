/**
 * Test: laborers profitability table — all four output modes plus
 * contract-amortisation breakeven.
 *
 * Covers:
 *   - ID helpers (filled/empty/trophy/contract/enchanted-resource patterns)
 *   - Slug mismatches: STONE↔ROCK, FISHING↔FISH, FISHING↔FISHERMAN (contract)
 *   - getLaborersItemIds returns the expected union of IDs across all modes
 *   - Per-mode payload revenue math (Trophy / Resource / Crafting / Mercenary)
 *   - Brecilien Travel Planner fee never charged (filled cost = price + setup fee)
 *   - Missing payload data → row reports "no data" (null route)
 *   - Contract amortisation: breakevenCycles = contractCost × (1+SETUP_FEE) / profit
 *   - Full-table assembly: every mode produces its expected row count
 *
 * Run: node --test tests/laborers-profitability-row-terms.test.cjs
 *
 * Per-cycle silver terms, breakeven, contract attribution, best journal to feed a laborer. Shared setup: tests/helpers/laborers-profitability-setup.cjs.
 */
const {
  assert, LABORER_MODE, LABORER_TIERS, getLaborerYield, getLaborerYieldFor,
  MERCENARY_SILVER_BY_TIER, computeBestLaborerRoute, buildLaborersRowData,
  _bestJournalForLaborer, SETUP_FEE, PREMIUM_TAX, test, approx, md, FS, mdSplit, finish,
} = require("./helpers/laborers-profitability-setup.cjs");

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Row exposes the per-cycle silver behind Profit / Cycle ===");

// The Filled Cost / Payload / Empty Sell cells are click-to-override UNIT
// prices, so reading them off the screen and adding them up never reaches
// Profit / Cycle. The row must therefore carry the per-cycle terms that DO add
// up, plus the yield the payload was multiplied by, for the profit tooltip.
test("payloadRevenue + emptyRevenue − totalInputCost = profit (identity holds)", () => {
  const market = mdSplit([
    { id: "T6_JOURNAL_TROPHY_WOOD_FULL",  city: FS, price: 242207 },
    { id: "T6_FURNITUREITEM_TROPHY_WOOD", city: FS, price: 284998 },
    { id: "T6_JOURNAL_TROPHY_WOOD_EMPTY", city: FS, price: 50988 },
  ]);
  const rows = buildLaborersRowData(market);
  const r = rows.find((x) => x.mode === "Trophy" && x.tier === 6 && x.laborerName === "Wood Trophy");
  assert.ok(r);
  approx(r.payloadRevenue + r.emptyRevenue - r.totalInputCost, r.marginInfo.profit, 0.01);
});

test("Row carries the play's yield and the fee-loaded filled cost, not the raw prices", () => {
  const FILLED = 242207, TROPHY = 284998, EMPTY = 50988;
  const market = mdSplit([
    { id: "T6_JOURNAL_TROPHY_WOOD_FULL",  city: FS, price: FILLED },
    { id: "T6_FURNITUREITEM_TROPHY_WOOD", city: FS, price: TROPHY },
    { id: "T6_JOURNAL_TROPHY_WOOD_EMPTY", city: FS, price: EMPTY },
  ]);
  const rows = buildLaborersRowData(market);
  const r = rows.find((x) => x.mode === "Trophy" && x.tier === 6 && x.laborerName === "Wood Trophy");
  assert.ok(r);
  // The cells still show raw prices (they are the override anchors) …
  assert.strictEqual(r.buy.price, FILLED);
  assert.strictEqual(r.sell.price, TROPHY);
  assert.strictEqual(r.emptyJournalPrice, EMPTY);
  // … while the profit terms carry yield, tax and setup fee.
  // The Wood Trophy line is worked by the Lumberjack, and wood trophies exist,
  // so this row reaches the 150% cap — not the general-only fallback.
  assert.strictEqual(r.playYield, getLaborerYieldFor("WOOD", 6));
  approx(r.totalInputCost, FILLED * (1 + SETUP_FEE), 0.01);
  approx(r.payloadRevenue, TROPHY * r.playYield * (1 - PREMIUM_TAX), 0.01);
  approx(r.emptyRevenue,   EMPTY * (1 - PREMIUM_TAX), 0.01);
});

test("Rows with no market data expose zeroed per-cycle terms (no NaN in the tooltip)", () => {
  const rows = buildLaborersRowData({});
  const r = rows.find((x) => x.mode === "Trophy");
  assert.ok(r);
  assert.strictEqual(r.payloadRevenue, 0);
  assert.strictEqual(r.emptyRevenue, 0);
  assert.strictEqual(r.totalInputCost, 0);
  assert.ok(r.playYield > 0, "yield must stay defined so the tooltip never prints NaN");
});

// ────────────────────────────────────────────────────────────────────────────
test("Breakeven cycles = T8 buyPrice × (1+SETUP_FEE) / per-cycle profit", () => {
  const market = mdSplit([
    { id: "T6_JOURNAL_TROPHY_WOOD_FULL",  city: FS, price: 1000 },
    { id: "T6_FURNITUREITEM_TROPHY_WOOD", city: FS, price: 10000 },
    { id: "T6_JOURNAL_TROPHY_WOOD_EMPTY", city: FS, price: 200 },
    { id: "T8_LABOURER_CONTRACT_WOOD",    city: FS, ask: 500000, bid: 420000 },
  ]);
  const rows = buildLaborersRowData(market);
  const t6 = rows.find((r) => r.mode === "Trophy" && r.tier === 6 && r.laborerName === "Wood Trophy");
  assert.ok(t6);
  const expected = 500000 * (1 + SETUP_FEE) / t6.marginInfo.profit;
  assert.ok(Math.abs(t6.breakevenCycles - expected) < 0.01,
    `breakeven: expected ${expected.toFixed(2)}, got ${t6.breakevenCycles.toFixed(2)}`);
});

test("Contract Buy reads sell_price (lowest ask); Contract Sell reads buy_price (highest bid)", () => {
  const market = mdSplit([
    { id: "T6_JOURNAL_TROPHY_WOOD_FULL",  city: FS, price: 1000 },
    { id: "T6_FURNITUREITEM_TROPHY_WOOD", city: FS, price: 10000 },
    { id: "T6_JOURNAL_TROPHY_WOOD_EMPTY", city: FS, price: 200 },
    { id: "T8_LABOURER_CONTRACT_WOOD",    city: FS, ask: 480000, bid: 420000 },
  ]);
  const rows = buildLaborersRowData(market);
  const t6 = rows.find((r) => r.mode === "Trophy" && r.tier === 6 && r.laborerName === "Wood Trophy");
  assert.ok(t6);
  assert.strictEqual(t6.contract.buyPrice,  480000, "buyPrice should equal the T8 ask");
  assert.strictEqual(t6.contract.sellPrice, 420000, "sellPrice should equal the T8 bid");
});

test("All seven tier rows of one laborer share the same T8 contract Buy/Sell", () => {
  // Verifies the T8-anchor is laborer-type-wide, not per-tier. Lumberjack
  // T2-T8 all read the same T8 contract value.
  const market = mdSplit([
    { id: "T8_LABOURER_CONTRACT_WOOD", city: FS, ask: 1000000, bid: 800000 },
    // Add a positive route for each tier so contract isn't masked by no-data
    ...[2,3,4,5,6,7,8].flatMap((t) => [
      { id: `T${t}_JOURNAL_WOOD_FULL`,  city: FS, price: 100 },
      { id: `T${t}_JOURNAL_WOOD_EMPTY`, city: FS, price: 50 },
      { id: `T${t}_WOOD`,               city: FS, price: 200 },
    ]),
  ]);
  const rows = buildLaborersRowData(market);
  const woodResource = rows.filter((r) => r.mode === "Resource" && r.laborerName === "Lumberjack");
  assert.strictEqual(woodResource.length, 7, "expected 7 tier rows for Lumberjack Resource mode");
  woodResource.forEach((r) => {
    assert.strictEqual(r.contract.buyPrice,  1000000, `T${r.tier} should still read the T8 ask`);
    assert.strictEqual(r.contract.sellPrice, 800000,  `T${r.tier} should still read the T8 bid`);
  });
});

test("rowContract reads THIS row's tier (editable Buy Contract cell), while contract stays T8", () => {
  // The Buy Contract column is per-tier so the user can override each tier's
  // contract price; the leveling-path all-tier scan reads those overrides back.
  // `contract` must remain the T8 anchor for breakeven.
  const market = mdSplit([
    { id: "T5_JOURNAL_TROPHY_WOOD_FULL",  city: FS, price: 800 },
    { id: "T5_FURNITUREITEM_TROPHY_WOOD", city: FS, price: 8000 },
    { id: "T5_JOURNAL_TROPHY_WOOD_EMPTY", city: FS, price: 150 },
    { id: "T8_LABOURER_CONTRACT_WOOD",    city: FS, ask: 1200000, bid: 900000 },
    { id: "T5_LABOURER_CONTRACT_WOOD",    city: FS, ask: 200000,  bid: 150000 },
  ]);
  const rows = buildLaborersRowData(market);
  const t5 = rows.find((r) => r.mode === "Trophy" && r.tier === 5 && r.laborerName === "Wood Trophy");
  assert.ok(t5);
  assert.strictEqual(t5.rowContract.id, "T5_LABOURER_CONTRACT_WOOD", "rowContract id should be the row's own tier");
  assert.strictEqual(t5.rowContract.buyPrice,  200000, "rowContract buyPrice should equal the T5 ask");
  assert.strictEqual(t5.rowContract.sellPrice, 150000, "rowContract sellPrice should equal the T5 bid");
  // Unchanged: contract still anchors on T8.
  assert.strictEqual(t5.contract.id, "T8_LABOURER_CONTRACT_WOOD", "contract stays T8");
});

test("rowContract id is non-null even when the row-tier price is missing (cell stays editable)", () => {
  // No market entry for the T6 contract → buyPrice 0, but id must still be set
  // so priceTd renders an editable 'no data — click to set' cell.
  const market = mdSplit([
    { id: "T6_JOURNAL_TROPHY_WOOD_FULL",  city: FS, price: 1000 },
    { id: "T6_FURNITUREITEM_TROPHY_WOOD", city: FS, price: 10000 },
    { id: "T6_JOURNAL_TROPHY_WOOD_EMPTY", city: FS, price: 200 },
  ]);
  const rows = buildLaborersRowData(market);
  const t6 = rows.find((r) => r.mode === "Trophy" && r.tier === 6 && r.laborerName === "Wood Trophy");
  assert.ok(t6);
  assert.strictEqual(t6.rowContract.id, "T6_LABOURER_CONTRACT_WOOD", "id present despite missing price");
  assert.strictEqual(t6.rowContract.buyPrice, 0, "buyPrice 0 when no market data");
});

test("No-data rows stay editable: rowContract id + anchor city populated (T2-T5 fix)", () => {
  // Empty market → every row is no-route. Previously these blanked the city and
  // all ids, so no price cell was clickable. Now they anchor to a default city
  // with real ids so the user can type prices in (esp. per-tier contracts).
  const rows = buildLaborersRowData({});
  const t3 = rows.find((r) => r.mode === "Resource" && r.laborerName === "Lumberjack" && r.tier === 3);
  assert.ok(t3);
  assert.strictEqual(t3.rowContract.id, "T3_LABOURER_CONTRACT_WOOD", "row-tier contract id present despite no data");
  assert.ok(t3.rowContract.city, "rowContract anchored to a real city");
  assert.strictEqual(t3.contract.id, "T8_LABOURER_CONTRACT_WOOD", "T8 anchor preserved on no-data rows");
  assert.ok(t3.buy.city, "filled buy cell carries an anchor city so the editor can commit");
  assert.strictEqual(t3.buy.city, t3.sell.city, "filled and sell anchored to the same city");
  assert.strictEqual(t3.rowContract.city, t3.buy.city, "contract and price cells share the anchor city");
});

test("No-data row anchors per-tier contracts to the group's route city when one tier has data", () => {
  // T8 Lumberjack Resource has data (route forms at FS); T3 has none. The T3
  // row's contract must anchor to FS so a price typed there feeds the
  // leveling-path all-tier scan (which reads the group's route city).
  const market = mdSplit([
    { id: "T8_JOURNAL_WOOD_FULL",  city: FS, price: 100 },
    { id: "T8_JOURNAL_WOOD_EMPTY", city: FS, price: 50 },
    { id: "T8_WOOD",               city: FS, price: 200 },
  ]);
  const rows = buildLaborersRowData(market);
  const t3 = rows.find((r) => r.mode === "Resource" && r.laborerName === "Lumberjack" && r.tier === 3);
  assert.ok(t3);
  assert.strictEqual(t3.rowContract.id, "T3_LABOURER_CONTRACT_WOOD");
  assert.strictEqual(t3.rowContract.city, FS, "T3 contract anchored to the group's route city");
});

test("GENERAL trophy rows have no rowContract attribution (id null)", () => {
  const market = mdSplit([
    { id: "T6_JOURNAL_TROPHY_GENERAL_FULL",  city: FS, price: 1000 },
    { id: "T6_FURNITUREITEM_TROPHY_GENERAL", city: FS, price: 5000 },
    { id: "T6_JOURNAL_TROPHY_GENERAL_EMPTY", city: FS, price: 100 },
  ]);
  const rows = buildLaborersRowData(market);
  const t6 = rows.find((r) => r.mode === "Trophy" && r.tier === 6 && r.laborerName === "General Trophy");
  assert.ok(t6);
  assert.strictEqual(t6.rowContract.id, null);
});

test("Breakeven = 0 when profit is negative (unprofitable route)", () => {
  const market = md([
    { id: "T6_JOURNAL_TROPHY_WOOD_FULL",  city: FS, price: 100000 },
    { id: "T6_FURNITUREITEM_TROPHY_WOOD", city: FS, price: 100   },
    { id: "T6_JOURNAL_TROPHY_WOOD_EMPTY", city: FS, price: 1     },
    { id: "T8_LABOURER_CONTRACT_WOOD",    city: FS, price: 500000 },
  ]);
  const rows = buildLaborersRowData(market);
  const t6 = rows.find((r) => r.mode === "Trophy" && r.tier === 6 && r.laborerName === "Wood Trophy");
  assert.ok(t6);
  assert.strictEqual(t6.breakevenCycles, 0);
});

test("Trophy GENERAL has no specific laborer → no contract attribution (Buy and Sell both 0)", () => {
  const market = md([
    { id: "T6_JOURNAL_TROPHY_GENERAL_FULL",  city: FS, price: 1000 },
    { id: "T6_FURNITUREITEM_TROPHY_GENERAL", city: FS, price: 5000 },
    { id: "T6_JOURNAL_TROPHY_GENERAL_EMPTY", city: FS, price: 100 },
  ]);
  const rows = buildLaborersRowData(market);
  const t6 = rows.find((r) => r.mode === "Trophy" && r.tier === 6 && r.laborerName === "General Trophy");
  assert.ok(t6);
  assert.strictEqual(t6.contract.id, null);
  assert.strictEqual(t6.contract.buyPrice,  0);
  assert.strictEqual(t6.contract.sellPrice, 0);
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Best journal to feed a laborer ===");

// _bestJournalForLaborer only reads `.tier` off the specs; routes are plain
// { profit } stand-ins. Specs are ascending-tier (index i = tier-2).
const SYNTH_SPECS = LABORER_TIERS.map((tier) => ({ tier }));
const synthRoutes = () => LABORER_TIERS.map(() => null);

test("spec.yield override values a journal at the boosted 150% (lower-tier feed)", () => {
  // A T6 mercenary journal fed to a higher laborer earns silver × 1.5,
  // not the same-tier × 1.125.
  const market = md([
    { id: "T6_JOURNAL_MERCENARY_FULL",  city: FS, price: 1000 },
    { id: "T6_JOURNAL_MERCENARY_EMPTY", city: FS, price: 100 },
  ]);
  const boosted = computeBestLaborerRoute({
    mode: LABORER_MODE.MERCENARY, tier: 6, yield: 1.5,
    filledId: "T6_JOURNAL_MERCENARY_FULL",
    emptyId:  "T6_JOURNAL_MERCENARY_EMPTY",
  }, market);
  assert.ok(boosted);
  assert.strictEqual(boosted.payloadRevenue, MERCENARY_SILVER_BY_TIER[6] * 1.5);
});

test("_bestJournalForLaborer: a lower-tier journal (150%) wins when it nets more", () => {
  const same = synthRoutes(), boost = synthRoutes();
  same[6] = { profit: 1000 };   // T8 same-tier (yield 1.175)
  boost[5] = { profit: 1400 };  // T7 journal at 1.5
  const bj = _bestJournalForLaborer(SYNTH_SPECS, same, boost, 6);
  assert.strictEqual(bj.journalTier, 7);
  assert.strictEqual(bj.yield, 1.5);
  assert.strictEqual(bj.profit, 1400);
  assert.strictEqual(bj.sameTierProfit, 1000, "carries same-tier profit for the ▲ delta");
});

test("_bestJournalForLaborer: same-tier wins → keeps its own ~1.175 yield, not 1.5", () => {
  const same = synthRoutes(), boost = synthRoutes();
  same[6] = { profit: 2000 };
  boost[5] = { profit: 1000 };
  boost[0] = { profit: 1500 };
  const bj = _bestJournalForLaborer(SYNTH_SPECS, same, boost, 6);
  assert.strictEqual(bj.journalTier, 8);
  assert.strictEqual(bj.yield, getLaborerYield(8));
  assert.strictEqual(bj.profit, 2000);
});

test("_bestJournalForLaborer: T2 laborer has no lower journal → always own tier", () => {
  const same = synthRoutes(), boost = synthRoutes();
  same[0] = { profit: 50 };
  const bj = _bestJournalForLaborer(SYNTH_SPECS, same, boost, 0);
  assert.strictEqual(bj.journalTier, 2);
  assert.strictEqual(bj.yield, getLaborerYield(2));
});

test("_bestJournalForLaborer: same-tier has no data but a lower journal does", () => {
  const same = synthRoutes(), boost = synthRoutes();
  boost[4] = { profit: 700 };   // T6 journal at 1.5
  const bj = _bestJournalForLaborer(SYNTH_SPECS, same, boost, 6);
  assert.strictEqual(bj.journalTier, 6);
  assert.strictEqual(bj.profit, 700);
  assert.strictEqual(bj.sameTierProfit, null);
});

test("_bestJournalForLaborer: no data anywhere → null", () => {
  assert.strictEqual(_bestJournalForLaborer(SYNTH_SPECS, synthRoutes(), synthRoutes(), 6), null);
});

test("buildLaborersRowData attaches a bestJournal whose tier never exceeds the laborer", () => {
  // Lumberjack resource market across all tiers with rising resource prices so
  // higher-tier loot is worth more — a real best-journal trade-off per row.
  const market = mdSplit([
    ...[2,3,4,5,6,7,8].flatMap((t) => [
      { id: `T${t}_JOURNAL_WOOD_FULL`,  city: FS, price: 100 },
      { id: `T${t}_JOURNAL_WOOD_EMPTY`, city: FS, price: 50 },
      { id: `T${t}_WOOD`,               city: FS, price: 100 * t },
    ]),
  ]);
  const rows = buildLaborersRowData(market);
  const wood = rows.filter((r) => r.mode === "Resource" && r.laborerName === "Lumberjack");
  assert.strictEqual(wood.length, 7);
  wood.forEach((r) => {
    assert.ok(r.bestJournal, `T${r.tier} should carry a bestJournal`);
    assert.ok(r.bestJournal.journalTier <= r.tier,
      `best journal T${r.bestJournal.journalTier} must not exceed laborer T${r.tier}`);
  });
  // T2 has no lower option → must be its own tier.
  const t2 = wood.find((r) => r.tier === 2);
  assert.strictEqual(t2.bestJournal.journalTier, 2);
});

test("Headline Profit/Cycle reflects the BEST journal play, not same-tier", () => {
  // T5 Gamekeeper: same-tier T5 journal is a loss (pricey filled, cheap hide),
  // but feeding a T4 journal at 150% yield nets a profit. The row's headline
  // profit + its Buy/Empty/Payload cells must describe the T4-journal play the
  // user actually runs, while the laborer identity (T5 Gamekeeper, contract)
  // stays put. This is the "T5 gamekeeper with T4 journals" reality.
  const market = md([
    { id: "T5_JOURNAL_HIDE_FULL",  city: FS, price: 30000 },
    { id: "T5_JOURNAL_HIDE_EMPTY", city: FS, price: 5000 },
    { id: "T5_HIDE",               city: FS, price: 500 },
    { id: "T4_JOURNAL_HIDE_FULL",  city: FS, price: 6000 },
    { id: "T4_JOURNAL_HIDE_EMPTY", city: FS, price: 3000 },
    { id: "T4_HIDE",               city: FS, price: 150 },
  ]);
  const rows = buildLaborersRowData(market);
  const t5 = rows.find((r) => r.mode === "Resource" && r.laborerName === "Gamekeeper" && r.tier === 5);
  assert.ok(t5);
  // Identity stays the laborer's.
  assert.strictEqual(t5.tier, 5);
  assert.strictEqual(t5.item.name, "T5 Gamekeeper");
  // Best journal is the lower T4 at 150%.
  assert.strictEqual(t5.bestJournal.journalTier, 4);
  assert.strictEqual(t5.bestJournal.yield, 1.5);
  // Headline profit == best journal profit, and it's the positive T4 play
  // (same-tier T5 would be negative).
  assert.strictEqual(t5.marginInfo.profit, t5.bestJournal.profit, "headline = best journal profit");
  assert.ok(t5.marginInfo.profit > 0, `T4 play is profitable, got ${t5.marginInfo.profit}`);
  // Journal cells describe the T4 play.
  assert.strictEqual(t5.filledId, "T4_JOURNAL_HIDE_FULL");
  assert.strictEqual(t5.emptyId,  "T4_JOURNAL_HIDE_EMPTY");
  assert.strictEqual(t5.buy.price, 6000, "Buy cell shows the T4 filled journal, not the T5 one");
  // Payload label shows the boosted quantity (48 × 1.5 = 72.0), not same-tier 51.6.
  assert.ok(t5.payloadLabel.includes("72.0 HIDE"), `payload label should show 72.0 HIDE, got "${t5.payloadLabel}"`);
});

finish();
