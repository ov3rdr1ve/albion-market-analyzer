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
 * Run: node --test tests/laborers-profitability-city-force.test.cjs
 *
 * Brecilien fee, city force on journals, contract amortisation. Shared setup: tests/helpers/laborers-profitability-setup.cjs.
 */
const {
  assert, LABORER_MODE, computeBestLaborerRoute, buildLaborersRowData, __setBMR, __setOverride,
  __setCityForce, SETUP_FEE, PREMIUM_TAX, test, approx, md, FS, LY, BR, mdSplit, finish,
} = require("./helpers/laborers-profitability-setup.cjs");

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Brecilien Travel Planner fee — never charged ===");

// The fee was removed from every profit table: Brecilien is reachable through
// safe-zone Avalonian portals in the Mists, so a journal bought there carries no
// haul-out cost. Filled cost is price × (1 + SETUP_FEE), nothing else.
const _brJournalMarket = () => md([
  { id: "T6_JOURNAL_TROPHY_WOOD_FULL",  city: BR, price: 800 },
  { id: "T6_JOURNAL_TROPHY_WOOD_FULL",  city: FS, price: 950 },
  { id: "T6_FURNITUREITEM_TROPHY_WOOD", city: FS, price: 10000 },
  { id: "T6_JOURNAL_TROPHY_WOOD_EMPTY", city: FS, price: 200 },
]);
const _brJournalSpec = {
  mode: LABORER_MODE.TROPHY, tier: 6,
  filledId: "T6_JOURNAL_TROPHY_WOOD_FULL",
  emptyId:  "T6_JOURNAL_TROPHY_WOOD_EMPTY",
  trophyId: "T6_FURNITUREITEM_TROPHY_WOOD",
};

[false, true].forEach((bmr) => {
  test(`Brecilien-sourced filled journal pays no exit fee (BMR ${bmr ? "on" : "off"})`, () => {
    __setBMR(bmr);
    const r = computeBestLaborerRoute(_brJournalSpec, _brJournalMarket());
    assert.ok(r);
    assert.strictEqual(r.buyCity, BR);            // cheapest wins outright
    assert.strictEqual(r.filledPrice, 800);
    approx(r.filledCost, 800 * (1 + SETUP_FEE));  // no travel term
  });
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== City force on filled journal restricts laborer iteration ===");

test("Force+override at a Royal-only buy city makes Caerleon laborer ineligible (no stale-cheap escape)", () => {
  // Without the fix: Caerleon laborer (buyCities=["Caerleon"]) drops the
  // Lymhurst force silently, scans Caerleon at the stale-fallback 46k price,
  // wins on profit, and the user's 730k override at Lymhurst has no visible
  // effect. With the fix: Caerleon laborer is skipped, the route picker is
  // forced to use a Royal laborer city sourcing from Lymhurst at 730k.
  __setOverride("T8_JOURNAL_HIDE_FULL", "Lymhurst", 730000);
  __setCityForce("T8_JOURNAL_HIDE_FULL", "buy", "Lymhurst");
  // Resource ids: T8_HIDE base + enchant levels. Use only base to keep math
  // simple; just need at least one enchant level with data so the route
  // reports hasData=true.
  const market = md([
    { id: "T8_JOURNAL_HIDE_FULL",  city: LY, price: 46000 },
    { id: "T8_JOURNAL_HIDE_FULL",  city: "Caerleon", price: 46000 },
    { id: "T8_JOURNAL_HIDE_EMPTY", city: LY, price: 5000 },
    { id: "T8_JOURNAL_HIDE_EMPTY", city: "Caerleon", price: 5000 },
    { id: "T8_HIDE", city: LY, price: 8000 },
    { id: "T8_HIDE", city: "Caerleon", price: 8000 },
  ]);
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.RESOURCE, tier: 8,
    filledId: "T8_JOURNAL_HIDE_FULL",
    emptyId:  "T8_JOURNAL_HIDE_EMPTY",
    resourceSlug: "HIDE",
  }, market);
  assert.ok(r, "expected a valid route");
  assert.strictEqual(r.buyCity, LY, "buy city must be the forced Lymhurst, not Caerleon");
  assert.strictEqual(r.filledPrice, 730000, "filled price must be the user's override, not the stale 46k");
  assert.notStrictEqual(r.laborerCity, "Caerleon", "Caerleon laborer must be skipped while the Royal-only force is active");
});

test("Force=Caerleon makes Royal laborer cities ineligible (mirror case)", () => {
  __setOverride("T8_JOURNAL_HIDE_FULL", "Caerleon", 800000);
  __setCityForce("T8_JOURNAL_HIDE_FULL", "buy", "Caerleon");
  const market = md([
    { id: "T8_JOURNAL_HIDE_FULL",  city: LY, price: 46000 },
    { id: "T8_JOURNAL_HIDE_FULL",  city: "Caerleon", price: 46000 },
    { id: "T8_JOURNAL_HIDE_EMPTY", city: LY, price: 5000 },
    { id: "T8_JOURNAL_HIDE_EMPTY", city: "Caerleon", price: 5000 },
    { id: "T8_HIDE", city: LY, price: 8000 },
    { id: "T8_HIDE", city: "Caerleon", price: 8000 },
  ]);
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.RESOURCE, tier: 8,
    filledId: "T8_JOURNAL_HIDE_FULL",
    emptyId:  "T8_JOURNAL_HIDE_EMPTY",
    resourceSlug: "HIDE",
  }, market);
  assert.ok(r, "expected a valid route");
  assert.strictEqual(r.laborerCity, "Caerleon", "Royal laborers must be skipped when Caerleon is force-pinned");
  assert.strictEqual(r.buyCity, "Caerleon");
  assert.strictEqual(r.filledPrice, 800000);
});

test("Lingering city force with NO matching override does NOT restrict iteration (no regression)", () => {
  // Force is set, but no override at that city → fix must be inert and let
  // the route picker scan freely. Otherwise stale forces from cleared
  // overrides would silently hide rows.
  __setCityForce("T8_JOURNAL_HIDE_FULL", "buy", "Lymhurst");
  const market = md([
    { id: "T8_JOURNAL_HIDE_FULL",  city: "Caerleon", price: 46000 },
    { id: "T8_JOURNAL_HIDE_EMPTY", city: "Caerleon", price: 5000 },
    { id: "T8_HIDE", city: "Caerleon", price: 8000 },
  ]);
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.RESOURCE, tier: 8,
    filledId: "T8_JOURNAL_HIDE_FULL",
    emptyId:  "T8_JOURNAL_HIDE_EMPTY",
    resourceSlug: "HIDE",
  }, market);
  assert.ok(r, "lingering force without override must not hide the row");
  assert.strictEqual(r.buyCity, "Caerleon");
  assert.strictEqual(r.laborerCity, "Caerleon");
});

test("Override-backed empty-sell force prices the empty journal at that city WITHOUT pinning the laborer", () => {
  // User clicks Empty Sell, switches dropdown to Lymhurst, sets 70000.
  // The empty journal is weightless + fungible, so it's priced at the pinned
  // city — but it must NOT drag the laborer there. The route stays free to pick
  // the best payload city (Brecilien: hide 9000 > Lymhurst 8000). Previously the
  // empty-sell force pinned the laborer to Lymhurst (and could collapse the
  // route entirely — see the "non-viable city" regression below).
  __setOverride("T8_JOURNAL_HIDE_EMPTY", "Lymhurst", 70000);
  __setCityForce("T8_JOURNAL_HIDE_EMPTY", "sell", "Lymhurst");
  const market = md([
    { id: "T8_JOURNAL_HIDE_FULL",  city: LY, price: 46000 },
    { id: "T8_JOURNAL_HIDE_FULL",  city: BR, price: 46000 },
    { id: "T8_JOURNAL_HIDE_EMPTY", city: LY, price: 5000 },
    { id: "T8_JOURNAL_HIDE_EMPTY", city: BR, price: 6000 },
    { id: "T8_HIDE",                city: LY, price: 8000 },
    { id: "T8_HIDE",                city: BR, price: 9000 },
  ]);
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.RESOURCE, tier: 8,
    filledId: "T8_JOURNAL_HIDE_FULL",
    emptyId:  "T8_JOURNAL_HIDE_EMPTY",
    resourceSlug: "HIDE",
  }, market);
  assert.ok(r, "expected a valid route");
  assert.strictEqual(r.laborerCity, BR, "laborer city follows the best payload, not the empty-sell pin");
  assert.strictEqual(r.emptyCity, LY, "empty journal priced at the user-pinned city");
  assert.strictEqual(r.emptyPrice, 70000, "empty journal uses the override value");
});

test("Empty-sell pinned to a NON-VIABLE laborer city still shows the price (no route collapse / no reset)", () => {
  // The reported bug: switching the Empty Sell cell to a city where the laborer
  // can't actually run (no filled journal + no payload there) used to pin the
  // laborer to that city, collapse the route to null, and snap the cell back to
  // "no data". Now the empty sell is decoupled — the route forms at the only
  // viable city (Lymhurst) and the empty price shows at the pinned city.
  __setOverride("T8_JOURNAL_HIDE_EMPTY", "Martlock", 70000);
  __setCityForce("T8_JOURNAL_HIDE_EMPTY", "sell", "Martlock");
  const market = md([
    { id: "T8_JOURNAL_HIDE_FULL", city: LY, price: 46000 },
    { id: "T8_HIDE",              city: LY, price: 8000 },
    // empty journal does NOT trade at Lymhurst — only the user's Martlock override
  ]);
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.RESOURCE, tier: 8,
    filledId: "T8_JOURNAL_HIDE_FULL",
    emptyId:  "T8_JOURNAL_HIDE_EMPTY",
    resourceSlug: "HIDE",
  }, market);
  assert.ok(r, "route must still form at the viable laborer city");
  assert.strictEqual(r.laborerCity, LY, "laborer runs where it can, not at the empty-sell pin");
  assert.strictEqual(r.emptyCity, "Martlock", "empty journal priced at the user-pinned city");
  assert.strictEqual(r.emptyPrice, 70000, "empty-sell override honored — not reset to no-data");
});

test("Empty journal surfaces its best-available price when the laborer city itself has none", () => {
  // No override/force at all. Laborer runs at Lymhurst (filled + payload there),
  // but the empty journal only trades at Bridgewatch. Previously the Empty Sell
  // cell showed "no data" (locked to the laborer city); now it surfaces the
  // Bridgewatch price so the user sees a real number.
  const market = md([
    { id: "T8_JOURNAL_HIDE_FULL",  city: LY, price: 46000 },
    { id: "T8_HIDE",               city: LY, price: 8000 },
    { id: "T8_JOURNAL_HIDE_EMPTY", city: "Bridgewatch", price: 6000 },
  ]);
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.RESOURCE, tier: 8,
    filledId: "T8_JOURNAL_HIDE_FULL",
    emptyId:  "T8_JOURNAL_HIDE_EMPTY",
    resourceSlug: "HIDE",
  }, market);
  assert.ok(r);
  assert.strictEqual(r.laborerCity, LY, "laborer city driven by payload, not the empty journal");
  assert.strictEqual(r.emptyCity, "Bridgewatch", "empty journal valued at its best-available city");
  assert.strictEqual(r.emptyPrice, 6000, "best-available empty price surfaced instead of no-data");
});

test("Bogus high empty-journal listing is capped at the filled-journal price", () => {
  // Real bug: a troll/mislisted empty stone journal (199,999) while the FILLED
  // one sells for 2,400 produced ~187k phantom profit. An empty journal can
  // never be worth more than the filled one it came from (filled = empty +
  // filling cost), so a market-scanned empty sell is capped at the filled price.
  const market = md([
    { id: "T4_JOURNAL_STONE_FULL",  city: FS, price: 2400 },
    { id: "T4_JOURNAL_STONE_EMPTY", city: FS, price: 199999 }, // bogus
    { id: "T4_ROCK",                city: FS, price: 10 },
  ]);
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.RESOURCE, tier: 4,
    filledId: "T4_JOURNAL_STONE_FULL",
    emptyId:  "T4_JOURNAL_STONE_EMPTY",
    resourceSlug: "ROCK",
  }, market);
  assert.ok(r);
  assert.strictEqual(r.emptyPrice, 2400, "empty sell capped at the filled-journal price");
  assert.ok(Math.abs(r.emptyRevenue - 2400 * (1 - PREMIUM_TAX)) < 1, "empty revenue uses the capped price");
  assert.ok(r.profit < 5000, `profit must be sane (not ~187k), got ${r.profit}`);
});

test("A legitimate empty price below the filled price is NOT capped", () => {
  const market = md([
    { id: "T8_JOURNAL_HIDE_FULL",  city: FS, price: 46000 },
    { id: "T8_JOURNAL_HIDE_EMPTY", city: FS, price: 5000 },
    { id: "T8_HIDE",               city: FS, price: 8000 },
  ]);
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.RESOURCE, tier: 8,
    filledId: "T8_JOURNAL_HIDE_FULL",
    emptyId:  "T8_JOURNAL_HIDE_EMPTY",
    resourceSlug: "HIDE",
  }, market);
  assert.ok(r);
  assert.strictEqual(r.emptyPrice, 5000, "empty below filled is left untouched");
});

test("A user-pinned empty override above the filled price is respected (not capped)", () => {
  // The cap only guards market-scanned prices; an explicit user override wins.
  __setOverride("T8_JOURNAL_HIDE_EMPTY", "Martlock", 70000);
  __setCityForce("T8_JOURNAL_HIDE_EMPTY", "sell", "Martlock");
  const market = md([
    { id: "T8_JOURNAL_HIDE_FULL", city: LY, price: 46000 },
    { id: "T8_HIDE",              city: LY, price: 8000 },
  ]);
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.RESOURCE, tier: 8,
    filledId: "T8_JOURNAL_HIDE_FULL",
    emptyId:  "T8_JOURNAL_HIDE_EMPTY",
    resourceSlug: "HIDE",
  }, market);
  assert.ok(r);
  assert.strictEqual(r.emptyPrice, 70000, "user override above filled price is honored");
});

test("Override-backed sell force on trophy id (trophy mode) pins laborer city", () => {
  __setOverride("T8_FURNITUREITEM_TROPHY_HIDE", "Lymhurst", 5000000);
  __setCityForce("T8_FURNITUREITEM_TROPHY_HIDE", "sell", "Lymhurst");
  const market = md([
    { id: "T8_JOURNAL_TROPHY_HIDE_FULL",   city: LY, price: 100000 },
    { id: "T8_JOURNAL_TROPHY_HIDE_FULL",   city: FS, price: 100000 },
    { id: "T8_FURNITUREITEM_TROPHY_HIDE",  city: LY, price: 1000000 },
    { id: "T8_FURNITUREITEM_TROPHY_HIDE",  city: FS, price: 8000000 }, // higher non-forced city
    { id: "T8_JOURNAL_TROPHY_HIDE_EMPTY",  city: LY, price: 5000 },
    { id: "T8_JOURNAL_TROPHY_HIDE_EMPTY",  city: FS, price: 5000 },
  ]);
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.TROPHY, tier: 8,
    filledId: "T8_JOURNAL_TROPHY_HIDE_FULL",
    emptyId:  "T8_JOURNAL_TROPHY_HIDE_EMPTY",
    trophyId: "T8_FURNITUREITEM_TROPHY_HIDE",
  }, market);
  assert.ok(r);
  // Trophy force pins laborer to Lymhurst even though FS has higher trophy price.
  assert.strictEqual(r.laborerCity, LY);
  assert.strictEqual(r.payloadPrice, 5000000, "trophy payload must use the override value");
});

test("Lingering empty-sell force without override does NOT pin laborer city (no regression)", () => {
  // Force exists but no override — fix must be inert.
  __setCityForce("T8_JOURNAL_HIDE_EMPTY", "sell", "Lymhurst");
  const market = md([
    { id: "T8_JOURNAL_HIDE_FULL",  city: BR, price: 46000 },
    { id: "T8_JOURNAL_HIDE_EMPTY", city: BR, price: 6000 },
    { id: "T8_HIDE",                city: BR, price: 9000 },
  ]);
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.RESOURCE, tier: 8,
    filledId: "T8_JOURNAL_HIDE_FULL",
    emptyId:  "T8_JOURNAL_HIDE_EMPTY",
    resourceSlug: "HIDE",
  }, market);
  assert.ok(r);
  assert.strictEqual(r.laborerCity, BR, "stale sell force must not hide rows when no override backs it");
});

test("BMR-on (splitCaerleon=false) keeps all laborer cities eligible regardless of force", () => {
  // With BMR on, buyCities = CITIES for every laborerCity, so the force is
  // always reachable. The fix's skip condition (force ∉ buyCities) is never
  // true, so behavior is identical to pre-fix BMR-on logic.
  __setBMR(true);
  __setOverride("T8_JOURNAL_HIDE_FULL", "Lymhurst", 730000);
  __setCityForce("T8_JOURNAL_HIDE_FULL", "buy", "Lymhurst");
  const market = md([
    { id: "T8_JOURNAL_HIDE_FULL",  city: LY, price: 46000 },
    { id: "T8_JOURNAL_HIDE_FULL",  city: "Caerleon", price: 46000 },
    { id: "T8_JOURNAL_HIDE_EMPTY", city: LY, price: 5000 },
    { id: "T8_JOURNAL_HIDE_EMPTY", city: "Caerleon", price: 5000 },
    { id: "T8_HIDE", city: LY, price: 8000 },
    { id: "T8_HIDE", city: "Caerleon", price: 100000 }, // Caerleon hide payload much better
  ]);
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.RESOURCE, tier: 8,
    filledId: "T8_JOURNAL_HIDE_FULL",
    emptyId:  "T8_JOURNAL_HIDE_EMPTY",
    resourceSlug: "HIDE",
  }, market);
  assert.ok(r);
  // The route picker is still free to choose Caerleon as the laborer city
  // (since it can also source the filled journal from Lymhurst under BMR-on).
  assert.strictEqual(r.buyCity, LY, "filled journal must still be sourced from forced Lymhurst");
  assert.strictEqual(r.filledPrice, 730000);
  assert.strictEqual(r.laborerCity, "Caerleon", "BMR-on lets Caerleon laborer remain in the running");
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Contract amortisation ===");
test("Contract lookups always reference T8 regardless of the row's journal tier", () => {
  // Row is T5 (mid-tier journal) but the contract Buy/Sell must read from
  // the T8 contract — that's the only economically relevant tier per the
  // user's model (level-and-sell at T8; buy-T8-to-skip-leveling).
  const market = mdSplit([
    { id: "T5_JOURNAL_TROPHY_WOOD_FULL",  city: FS, price: 800 },
    { id: "T5_FURNITUREITEM_TROPHY_WOOD", city: FS, price: 8000 },
    { id: "T5_JOURNAL_TROPHY_WOOD_EMPTY", city: FS, price: 150 },
    // T8 contract is what we expect to be queried (NOT T5).
    { id: "T8_LABOURER_CONTRACT_WOOD",    city: FS, ask: 1200000, bid: 900000 },
    // T5 contract is present too — must be IGNORED to prove we anchor on T8.
    { id: "T5_LABOURER_CONTRACT_WOOD",    city: FS, ask: 200000,  bid: 150000 },
  ]);
  const rows = buildLaborersRowData(market);
  const t5 = rows.find((r) => r.mode === "Trophy" && r.tier === 5 && r.laborerName === "Wood Trophy");
  assert.ok(t5);
  assert.strictEqual(t5.contract.id, "T8_LABOURER_CONTRACT_WOOD", "contract id should reference T8");
  assert.strictEqual(t5.contract.buyPrice,  1200000, "buyPrice should equal the T8 ask, not the T5 ask");
  assert.strictEqual(t5.contract.sellPrice, 900000,  "sellPrice should equal the T8 bid, not the T5 bid");
});

finish();
