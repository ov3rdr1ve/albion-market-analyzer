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
 * Run: node --test tests/laborers-profitability-modes.test.cjs
 *
 * ID helpers, data shape and the Trophy / Resource / Crafting / Mercenary revenue modes. Shared setup: tests/helpers/laborers-profitability-setup.cjs.
 */
const {
  assert, LABORER_MODE, LABORERS, TROPHY_LABORERS, LABORER_TIERS, getLaborerYield,
  getLaborerYieldFor, GATHERER_BASELOOT, CRAFTING_BASELOOT, MERCENARY_SILVER_BY_TIER,
  ENCHANT_DISTRIBUTION, getLaborerEnchantDistribution, getLaborerFilledJournalId,
  getLaborerEmptyJournalId, getLaborerTrophyId, getLaborerContractId, getEnchantedResourceId,
  getLaborersItemIds, computeBestLaborerRoute, SETUP_FEE, PREMIUM_TAX, test, md, FS, finish,
} = require("./helpers/laborers-profitability-setup.cjs");

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== ID helpers + data shape ===");

test("Filled / empty / trophy / contract / enchanted-resource ID patterns", () => {
  assert.strictEqual(getLaborerFilledJournalId("TROPHY_WOOD", 6), "T6_JOURNAL_TROPHY_WOOD_FULL");
  assert.strictEqual(getLaborerEmptyJournalId("WOOD", 6),         "T6_JOURNAL_WOOD_EMPTY");
  assert.strictEqual(getLaborerTrophyId("WOOD", 6),               "T6_FURNITUREITEM_TROPHY_WOOD");
  assert.strictEqual(getLaborerContractId("WOOD", 6),             "T6_LABOURER_CONTRACT_WOOD");
  assert.strictEqual(getEnchantedResourceId("WOOD", 6, 0),        "T6_WOOD");
  assert.strictEqual(getEnchantedResourceId("WOOD", 6, 1),        "T6_WOOD_LEVEL1@1");
  assert.strictEqual(getEnchantedResourceId("WOOD", 6, 3),        "T6_WOOD_LEVEL3@3");
});

test("Slug mismatches: STONE journal → ROCK trophy/resource, FISHING → FISH/FISHERMAN", () => {
  const stoneTrophy = TROPHY_LABORERS.find((l) => l.journalSlug === "TROPHY_STONE");
  assert.strictEqual(stoneTrophy.trophySlug, "ROCK");
  const stoneLab = LABORERS.find((l) => l.slug === "STONE");
  assert.strictEqual(stoneLab.resourceSlug, "ROCK", "Stonecutter produces T?_ROCK");
  assert.strictEqual(stoneLab.contractSlug, "STONE", "Stonecutter contract uses STONE suffix");
  const fishLab = LABORERS.find((l) => l.slug === "FISHING");
  assert.strictEqual(fishLab.contractSlug, "FISHERMAN", "Fisherman contract uses FISHERMAN");
});

test("getLaborersItemIds includes every needed market query", () => {
  const ids = getLaborersItemIds();
  // Trophy journals (full+empty) — 8 lines × 7 tiers × 2 states = 112
  assert.ok(ids.includes("T6_JOURNAL_TROPHY_WOOD_FULL"));
  assert.ok(ids.includes("T6_JOURNAL_TROPHY_WOOD_EMPTY"));
  // Trophy furniture — 8 slugs × 7 tiers = 56
  assert.ok(ids.includes("T6_FURNITUREITEM_TROPHY_WOOD"));
  assert.ok(ids.includes("T6_FURNITUREITEM_TROPHY_ROCK"));
  // Resource journals — 11 laborers × 7 tiers × 2 states
  assert.ok(ids.includes("T6_JOURNAL_WOOD_FULL"));
  assert.ok(ids.includes("T6_JOURNAL_MERCENARY_FULL"));
  assert.ok(ids.includes("T6_JOURNAL_WARRIOR_FULL"));
  // Enchanted resources (only for gather laborers with resource mode)
  assert.ok(ids.includes("T6_WOOD"));
  assert.ok(ids.includes("T6_WOOD_LEVEL1@1"));
  assert.ok(ids.includes("T6_WOOD_LEVEL3@3"));
  assert.ok(ids.includes("T6_ROCK"), "Stonecutter resource slug is ROCK");
  // Enchanted raw rock is real & traded, so the Stonecutter queries it too —
  // up to .3 only (the distribution caps at .3, matching stone's real cap).
  assert.ok(ids.includes("T6_ROCK_LEVEL2@2"), "Stonecutter queries enchanted rock (.1–.3)");
  assert.ok(!ids.includes("T6_ROCK_LEVEL4@4"), "no pristine (.4) rock exists");
  // Refined resources from crafting mix — base + the enchant ids (T4+), since
  // crafting journals return an enchant-spread mix just like raw gathers.
  assert.ok(ids.includes("T6_METALBAR"));
  assert.ok(ids.includes("T6_PLANKS"));
  assert.ok(ids.includes("T6_CLOTH"));
  assert.ok(ids.includes("T6_LEATHER"));
  assert.ok(ids.includes("T6_METALBAR_LEVEL1@1"), "crafting output enchant ids are scanned");
  assert.ok(ids.includes("T8_CLOTH_LEVEL3@3"), "crafting output enchant ids include @3");
  assert.ok(!ids.includes("T3_METALBAR_LEVEL1@1"), "no enchant ids below T4 (enchanting starts at T4)");
  // Contracts — all tiers are fetched (the Best Leveling Path column compares
  // buy/sell prices at every start/end tier, not just T8).
  assert.ok(ids.includes("T8_LABOURER_CONTRACT_WOOD"));
  assert.ok(ids.includes("T8_LABOURER_CONTRACT_FISHERMAN"));
  assert.ok(ids.includes("T8_LABOURER_CONTRACT_WARRIOR"));
  assert.ok(ids.includes("T8_LABOURER_CONTRACT_MERCENARY"));
  assert.ok(ids.includes("T2_LABOURER_CONTRACT_WOOD"), "intermediate-tier contracts are now fetched");
  assert.ok(ids.includes("T6_LABOURER_CONTRACT_WOOD"), "intermediate-tier contracts are now fetched");
  assert.ok(ids.includes("T7_LABOURER_CONTRACT_MERCENARY"), "intermediate-tier contracts are now fetched");
  // Fisherman Resource mode scans every id in the journal's lootlist (commons
  // across the tier band, biome rares, seaweed), but never the fictional flat
  // "T6_FISH" or enchant ids.
  assert.ok(ids.includes("T6_FISH_FRESHWATER_ALL_COMMON"), "fisherman resource scans fresh common");
  assert.ok(ids.includes("T6_FISH_SALTWATER_ALL_COMMON"), "fisherman resource scans salt common");
  assert.ok(ids.includes("T5_FISH_FRESHWATER_FOREST_RARE"), "T6 fisherman scans T5-band biome rares");
  assert.ok(ids.includes("T3_FISH_FRESHWATER_MOUNTAIN_RARE"), "T6 fisherman scans cheap T3-band rares too");
  assert.ok(ids.includes("T1_SEAWEED"), "fisherman scans the seaweed byproduct");
  assert.ok(!ids.includes("T6_FISH"), "no fictional flat fish id");
  assert.ok(!ids.includes("T6_FISH_LEVEL1@1"), "fish have no enchant ids");
});

test("getLaborerYield is the happiness curve, max by default; LABORER_TIERS covers T2-T8", () => {
  // Same-tier yield = 100% + 0.5% per point of happiness above base, capped at
  // 150%. With no stored preference the app assumes max happiness, so the tier
  // itself is not in the arithmetic (base happiness cancels) — only which
  // trophies reach that laborer. Unnamed = the general trophies alone (+40 =
  // 120%), which is what every laborer gets; a gatherer adds its own +70 and
  // hits the cap. See tests/laborer-happiness-yield.test.cjs.
  assert.strictEqual(getLaborerYield(2), 1.2);
  assert.strictEqual(getLaborerYield(6), 1.2);
  assert.strictEqual(getLaborerYieldFor("WOOD", 6), 1.5);
  assert.strictEqual(getLaborerYieldFor("TOOLMAKER", 6), 1.2);
  assert.strictEqual(getLaborerYield(8, 40), 1.2, "840 happiness on a T8 laborer");
  assert.strictEqual(getLaborerYield(8, 0), 1.0, "beds and tables only, no trophies");
  assert.deepStrictEqual(LABORER_TIERS, [2, 3, 4, 5, 6, 7, 8]);
});

test("ENCHANT_DISTRIBUTION probabilities sum to 1.0", () => {
  const total = ENCHANT_DISTRIBUTION.reduce((a, b) => a + b.prob, 0);
  assert.ok(Math.abs(total - 1.0) < 1e-9, `expected 1.0, got ${total}`);
});

test("getLaborerEnchantDistribution: full .1-.3 split at T4+, base-only below T4", () => {
  // Enchanting starts at T4; T2/T3 journals are 100% base (no _LEVELn lines), so
  // applying the split there would drop ~5.55% of output to priceless ids.
  ["ROCK", "WOOD", "ORE", "FIBER", "HIDE"].forEach((slug) => {
    assert.strictEqual(getLaborerEnchantDistribution(slug, 8), ENCHANT_DISTRIBUTION, `${slug} T8 full split`);
    assert.strictEqual(getLaborerEnchantDistribution(slug, 4), ENCHANT_DISTRIBUTION, `${slug} T4 full split (enchanting starts)`);
    const t3 = getLaborerEnchantDistribution(slug, 3);
    assert.strictEqual(t3.length, 1, `${slug} T3 base-only`);
    assert.deepStrictEqual(t3[0], { level: 0, prob: 1 }, `${slug} T3 is 100% base`);
  });
  // Slug-only (no tier) defaults to the full split (enchantable tier).
  assert.strictEqual(getLaborerEnchantDistribution("WOOD"), ENCHANT_DISTRIBUTION);
  // Enchanted raw rock is real & traded, so stone enchants like the rest — and the
  // distribution naturally tops out at .3, matching stone's real cap (no .4 rock).
  assert.ok(!ENCHANT_DISTRIBUTION.some((e) => e.level === 4), "distribution caps at .3 (no pristine rock)");
});

test("Crafting mixes sum to 1.0 for every crafter", () => {
  ["WARRIOR", "HUNTER", "MAGE", "TOOLMAKER"].forEach((slug) => {
    const lab = LABORERS.find((l) => l.slug === slug);
    const sum = Object.values(lab.craftingMix).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-3, `${slug} mix sums to ${sum}, expected 1.0`);
  });
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Trophy mode — formula sanity ===");

test("Trophy: revenue = trophyPrice × YIELD × (1-tax); profit accounts for empty + cost", () => {
  const FILLED = 1000, TROPHY = 10000, EMPTY = 200;
  const market = md([
    { id: "T6_JOURNAL_TROPHY_WOOD_FULL",  city: FS, price: FILLED },
    { id: "T6_FURNITUREITEM_TROPHY_WOOD", city: FS, price: TROPHY },
    { id: "T6_JOURNAL_TROPHY_WOOD_EMPTY", city: FS, price: EMPTY },
  ]);
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.TROPHY, tier: 6,
    filledId: "T6_JOURNAL_TROPHY_WOOD_FULL",
    emptyId:  "T6_JOURNAL_TROPHY_WOOD_EMPTY",
    trophyId: "T6_FURNITUREITEM_TROPHY_WOOD",
  }, market);
  assert.ok(r);
  const expectedCost   = FILLED * (1 + SETUP_FEE);
  const expectedRev    = TROPHY * getLaborerYield(6) * (1 - PREMIUM_TAX) + EMPTY * (1 - PREMIUM_TAX);
  const expectedProfit = expectedRev - expectedCost;
  assert.ok(Math.abs(r.profit - expectedProfit) < 0.01, `expected ${expectedProfit}, got ${r.profit}`);
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Resource mode — enchant distribution ===");

test("Resource: revenue = Σ enchant_prob × baseloot × YIELD × price × (1-tax)", () => {
  // T6 lumberjack → baseloot 32 × 1.125 (same-tier yield) = 36 units, spread over enchants.
  // Prices: base=100, @1=500, @2=2000, @3=10000.
  const baseloot = GATHERER_BASELOOT[6]; // 32
  const total = baseloot * getLaborerYield(6); // 36
  const FILLED = 100, EMPTY = 50;
  const market = md([
    { id: "T6_JOURNAL_WOOD_FULL",  city: FS, price: FILLED },
    { id: "T6_JOURNAL_WOOD_EMPTY", city: FS, price: EMPTY },
    { id: "T6_WOOD",         city: FS, price: 100  },
    { id: "T6_WOOD_LEVEL1@1",city: FS, price: 500  },
    { id: "T6_WOOD_LEVEL2@2",city: FS, price: 2000 },
    { id: "T6_WOOD_LEVEL3@3",city: FS, price: 10000 },
  ]);
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.RESOURCE, tier: 6,
    filledId: "T6_JOURNAL_WOOD_FULL",
    emptyId:  "T6_JOURNAL_WOOD_EMPTY",
    resourceSlug: "WOOD",
  }, market);
  assert.ok(r);
  const expectedPayload =
      (total * 0.9445 * 100   * (1 - PREMIUM_TAX))
    + (total * 0.05   * 500   * (1 - PREMIUM_TAX))
    + (total * 0.005  * 2000  * (1 - PREMIUM_TAX))
    + (total * 0.0005 * 10000 * (1 - PREMIUM_TAX));
  assert.ok(Math.abs(r.payloadRevenue - expectedPayload) < 0.1,
    `payload: expected ${expectedPayload.toFixed(2)}, got ${r.payloadRevenue.toFixed(2)}`);
});

test("Resource: missing base resource price still has data if any enchant level has data", () => {
  const market = md([
    { id: "T6_JOURNAL_WOOD_FULL",  city: FS, price: 100 },
    { id: "T6_JOURNAL_WOOD_EMPTY", city: FS, price: 50 },
    // Only @1 price; base + others missing
    { id: "T6_WOOD_LEVEL1@1", city: FS, price: 500 },
  ]);
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.RESOURCE, tier: 6,
    filledId: "T6_JOURNAL_WOOD_FULL",
    emptyId:  "T6_JOURNAL_WOOD_EMPTY",
    resourceSlug: "WOOD",
  }, market);
  assert.ok(r, "expected a route with partial enchant data");
  // Only @1 contributes: 32 * 1.125 * 0.05 * 500 * (1 - 0.065) = 842
  const expectedPayload = 32 * getLaborerYield(6) * 0.05 * 500 * (1 - 0.065);
  assert.ok(Math.abs(r.payloadRevenue - expectedPayload) < 0.5);
});

test("Resource: no enchant data at all → null route", () => {
  const market = md([
    { id: "T6_JOURNAL_WOOD_FULL",  city: FS, price: 100 },
    { id: "T6_JOURNAL_WOOD_EMPTY", city: FS, price: 50 },
  ]);
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.RESOURCE, tier: 6,
    filledId: "T6_JOURNAL_WOOD_FULL",
    emptyId:  "T6_JOURNAL_WOOD_EMPTY",
    resourceSlug: "WOOD",
  }, market);
  assert.strictEqual(r, null);
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Crafting mode — refined mix ===");

test("Crafting: blacksmith revenue spreads each material's mix across the enchant levels (T4+)", () => {
  // Crafting journals return refined goods with the 1889/100/10/1 enchant split.
  // Revenue must price each _LEVELn@n id and weight by ENCHANT_DISTRIBUTION, so a
  // priced enchant premium lifts revenue above the old base-only valuation.
  const lab = LABORERS.find((l) => l.slug === "WARRIOR");
  const total = CRAFTING_BASELOOT[6] * getLaborerYield(6);
  const basePrice = { METALBAR: 800, PLANKS: 600, CLOTH: 500 };
  const lvlMult = { 0: 1, 1: 3, 2: 8, 3: 24 }; // refined enchant premium
  const entries = [
    { id: "T6_JOURNAL_WARRIOR_FULL",  city: FS, price: 1000 },
    { id: "T6_JOURNAL_WARRIOR_EMPTY", city: FS, price: 100 },
  ];
  Object.entries(basePrice).forEach(([m, bp]) => {
    ENCHANT_DISTRIBUTION.forEach((e) => {
      entries.push({ id: getEnchantedResourceId(m, 6, e.level), city: FS, price: bp * lvlMult[e.level] });
    });
  });
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.CRAFTING, tier: 6,
    filledId: "T6_JOURNAL_WARRIOR_FULL",
    emptyId:  "T6_JOURNAL_WARRIOR_EMPTY",
    craftingMix: lab.craftingMix,
  }, md(entries));
  assert.ok(r);
  let expected = 0, baseOnly = 0;
  Object.entries(lab.craftingMix).forEach(([m, frac]) => {
    baseOnly += total * frac * basePrice[m] * (1 - PREMIUM_TAX);
    ENCHANT_DISTRIBUTION.forEach((e) => {
      expected += total * frac * e.prob * (basePrice[m] * lvlMult[e.level]) * (1 - PREMIUM_TAX);
    });
  });
  assert.ok(Math.abs(r.payloadRevenue - expected) < 0.5,
    `expected ${expected.toFixed(2)}, got ${r.payloadRevenue.toFixed(2)}`);
  assert.ok(r.payloadRevenue > baseOnly, "enchant-aware revenue must exceed the base-only valuation");
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Mercenary mode — flat silver ===");

test("Mercenary: revenue = silverPerTier × YIELD, no tax", () => {
  // T6: 2690 silver × 1.125 (same-tier yield) = 3026.25 silver per cycle (untaxed)
  const market = md([
    { id: "T6_JOURNAL_MERCENARY_FULL",  city: FS, price: 1000 },
    { id: "T6_JOURNAL_MERCENARY_EMPTY", city: FS, price: 100 },
  ]);
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.MERCENARY, tier: 6,
    filledId: "T6_JOURNAL_MERCENARY_FULL",
    emptyId:  "T6_JOURNAL_MERCENARY_EMPTY",
  }, market);
  assert.ok(r);
  const expectedPayload = MERCENARY_SILVER_BY_TIER[6] * getLaborerYield(6);
  assert.strictEqual(r.payloadRevenue, expectedPayload);
});

test("Mercenary: works even with no empty-journal listing (empty revenue degrades to 0)", () => {
  const market = md([
    { id: "T6_JOURNAL_MERCENARY_FULL", city: FS, price: 1000 },
  ]);
  const r = computeBestLaborerRoute({
    mode: LABORER_MODE.MERCENARY, tier: 6,
    filledId: "T6_JOURNAL_MERCENARY_FULL",
    emptyId:  "T6_JOURNAL_MERCENARY_EMPTY",
  }, market);
  assert.ok(r);
  assert.strictEqual(r.emptyPrice, 0);
});

finish();
