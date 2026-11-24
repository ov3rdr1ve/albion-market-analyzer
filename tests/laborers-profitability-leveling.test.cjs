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
 * Run: node --test tests/laborers-profitability-leveling.test.cjs
 *
 * Full-table assembly, leveling paths, Fisherman, global-scope safety, self-fill column. Shared setup: tests/helpers/laborers-profitability-setup.cjs.
 */
const {
  assert, Module, sandbox, loadFile, dataSrc, pricingSrc, renderSrc, M, LABORER_MODE,
  LABORERS, getLaborerYield, FISH_LABORER_BASELOOT, FISH_JOURNAL_LOOTLIST, getFishResourceIds,
  _fishResourceRevenue, buildLaborersRowData, computeBestLevelingPath,
  getLaborerUpgradeJournals, LABORER_FAME_PER_JOURNAL, LABORER_FAME_TO_UPGRADE, HIRE_COST,
  SETUP_FEE, PREMIUM_TAX, test, FS, mdSplit, finish,
} = require("./helpers/laborers-profitability-setup.cjs");

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Full-table assembly ===");

test("buildLaborersRowData generates expected row count across all modes", () => {
  const rows = buildLaborersRowData({});
  // Trophy: 8 lines × 7 tiers = 56
  // Resource: 6 gatherers (incl. fisherman's fish mix) × 7 = 42
  // Crafting: 4 crafters × 7 = 28
  // Mercenary: 1 × 7 = 7
  // Total: 133
  assert.strictEqual(rows.length, 56 + 42 + 28 + 7, `expected 133 rows, got ${rows.length}`);
});

test("Mode distribution: 56 Trophy / 42 Resource / 28 Crafting / 7 Mercenary", () => {
  const rows = buildLaborersRowData({});
  const counts = {};
  rows.forEach((r) => { counts[r.mode] = (counts[r.mode] || 0) + 1; });
  assert.strictEqual(counts.Trophy,    56);
  assert.strictEqual(counts.Resource,  42);
  assert.strictEqual(counts.Crafting,  28);
  assert.strictEqual(counts.Mercenary, 7);
});

test("Fisherman is present in Resource mode (fish-mix special case)", () => {
  const rows = buildLaborersRowData({});
  const fishermanResource = rows.filter((r) => r.mode === "Resource" && r.laborerName === "Fisherman");
  assert.strictEqual(fishermanResource.length, 7, "Fisherman should have 7 Resource rows (one per tier)");
});

test("Empty market → every row is no-data with margin -1", () => {
  const rows = buildLaborersRowData({});
  rows.forEach((r) => {
    assert.strictEqual(r.marginInfo.margin, -1, `${r.item.id} should be no-data`);
  });
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Leveling upgrade journal counts ===");

test("getLaborerUpgradeJournals = ceil(fameNeeded / (famePerJournal × same-tier yield))", () => {
  // Leveling runs same-tier journals, so yield = getLaborerYield(tier) — 1.5 at
  // the default max happiness. Fame scales with yield, so a happier laborer
  // needs fewer journals to level.
  // T2 gatherer: ceil(75 / (76 × 1.5)) = ceil(0.66) = 1
  assert.strictEqual(getLaborerUpgradeJournals("GATHERING", "GATHER_CRAFT", 2), 1);
  // T7 gatherer: ceil(36480 / (1920 × 1.5)) = ceil(12.67) = 13
  assert.strictEqual(getLaborerUpgradeJournals("GATHERING", "GATHER_CRAFT", 7), 13);
  // T6 gatherer: ceil(12480 / (960 × 1.5)) = ceil(8.67) = 9
  assert.strictEqual(getLaborerUpgradeJournals("GATHERING", "GATHER_CRAFT", 6), 9);
  // T7 mercenary: ceil(30286 / (1594 × 1.5)) = ceil(12.67) = 13
  assert.strictEqual(getLaborerUpgradeJournals("MERCENARY", "MERCENARY", 7), 13);
  // An explicit yield still overrides — a house with no trophies at all runs
  // every journal at 100% and levels slower: ceil(36480 / 1920) = 19.
  assert.strictEqual(getLaborerUpgradeJournals("GATHERING", "GATHER_CRAFT", 7, 1.0), 19);
});

test("getLaborerUpgradeJournals returns 0 for max tier (8) and unknown keys", () => {
  assert.strictEqual(getLaborerUpgradeJournals("GATHERING", "GATHER_CRAFT", 8), 0, "T8 is max, no upgrade");
  assert.strictEqual(getLaborerUpgradeJournals("NOPE", "GATHER_CRAFT", 5), 0);
  assert.strictEqual(getLaborerUpgradeJournals("GATHERING", "NOPE", 5), 0);
});

test("fame tables cover every tier with monotonic upgrade costs", () => {
  [2, 3, 4, 5, 6, 7, 8].forEach((t) => {
    assert.ok(LABORER_FAME_PER_JOURNAL.GATHERING[t] > 0, `gathering fame/journal T${t}`);
    assert.ok(LABORER_FAME_PER_JOURNAL.MERCENARY[t] > 0, `mercenary fame/journal T${t}`);
  });
  [2, 3, 4, 5, 6, 7].forEach((t) => {
    assert.ok(LABORER_FAME_TO_UPGRADE.GATHER_CRAFT[t] < LABORER_FAME_TO_UPGRADE.GATHER_CRAFT[t + 1] || t === 7,
      `upgrade cost rises with tier (T${t})`);
  });
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Best leveling path search ===");

const GATHER_KEYS = { fameType: "GATHERING", upgradeCat: "GATHER_CRAFT" };

test("HIRE_COST is the free-ish T2 apprentice acquisition cost", () => {
  assert.strictEqual(HIRE_COST, 1000);
});

test("Stopping at T6 wins when leveling past it is deeply unprofitable", () => {
  // Leveling tiers 2-5 is free (profit 0); crossing T6/T7 loses 100k/cycle.
  // Selling the T6 contract therefore beats grinding on to T7/T8.
  const path = computeBestLevelingPath({
    profitByTier: { 2: 0, 3: 0, 4: 0, 5: 0, 6: -100000, 7: -100000, 8: 0 },
    contractPrices: {
      2: { buy: 0, sell: 0 }, 3: { buy: 0, sell: 0 }, 4: { buy: 0, sell: 0 },
      5: { buy: 0, sell: 0 }, 6: { buy: 0, sell: 1000000 },
      7: { buy: 0, sell: 1050000 }, 8: { buy: 0, sell: 1100000 },
    },
    fameKeys: GATHER_KEYS,
  });
  assert.ok(path, "expected a path");
  assert.strictEqual(path.startTier, 2);
  assert.strictEqual(path.endTier, 6);
  // net = 1,000,000 × (1-tax) - HIRE_COST + 0
  const expected = 1000000 * (1 - PREMIUM_TAX) - HIRE_COST;
  assert.ok(Math.abs(path.netProfit - expected) < 1, `net: expected ${expected}, got ${path.netProfit}`);
});

test("Buying a T7 contract and leveling only T7→T8 wins when low tiers bleed silver", () => {
  const cBuy7 = 100000;
  const path = computeBestLevelingPath({
    profitByTier: { 2: -50000, 3: -50000, 4: -50000, 5: -50000, 6: -50000, 7: 0, 8: 0 },
    contractPrices: {
      2: { buy: 0, sell: 0 }, 3: { buy: 0, sell: 0 }, 4: { buy: 0, sell: 0 },
      5: { buy: 0, sell: 0 }, 6: { buy: 0, sell: 0 },
      7: { buy: cBuy7, sell: 0 }, 8: { buy: 0, sell: 500000 },
    },
    fameKeys: GATHER_KEYS,
  });
  assert.ok(path, "expected a path");
  assert.strictEqual(path.startTier, 7);
  assert.strictEqual(path.endTier, 8);
  // net = 500,000 × (1-tax) - cBuy7 × (1+SETUP_FEE) + 0 (profit[7] = 0)
  const expected = 500000 * (1 - PREMIUM_TAX) - cBuy7 * (1 + SETUP_FEE);
  assert.ok(Math.abs(path.netProfit - expected) < 1, `net: expected ${expected}, got ${path.netProfit}`);
});

test("A tier with no market data (null profit) blocks paths that cross it", () => {
  // profit[5] is null → a T2 start can't level past T5; only a T6-bought start
  // can reach the (only) sellable T8 contract.
  const path = computeBestLevelingPath({
    profitByTier: { 2: 0, 3: 0, 4: 0, 5: null, 6: 0, 7: 0, 8: 0 },
    contractPrices: {
      2: { buy: 0, sell: 0 }, 3: { buy: 0, sell: 0 }, 4: { buy: 0, sell: 0 },
      5: { buy: 0, sell: 0 }, 6: { buy: 10000, sell: 0 },
      7: { buy: 0, sell: 0 }, 8: { buy: 0, sell: 200000 },
    },
    fameKeys: GATHER_KEYS,
  });
  assert.ok(path, "expected the T6-start fallback path");
  assert.strictEqual(path.startTier, 6, "must not start at T2 — that crosses the null T5");
  assert.strictEqual(path.endTier, 8);
});

test("No sellable exit anywhere → null path", () => {
  const path = computeBestLevelingPath({
    profitByTier: { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 },
    contractPrices: Object.fromEntries([2,3,4,5,6,7,8].map((t) => [t, { buy: 0, sell: 0 }])),
    fameKeys: GATHER_KEYS,
  });
  assert.strictEqual(path, null);
});

test("Null fameKeys (e.g. GENERAL trophy) → null path", () => {
  const path = computeBestLevelingPath({
    profitByTier: { 2: 0, 8: 0 },
    contractPrices: { 8: { buy: 0, sell: 999999 } },
    fameKeys: null,
  });
  assert.strictEqual(path, null);
});

test("Leveling gain (positive per-cycle profit) is added to the exit value", () => {
  // profit[7] = +1000/cycle, 13 journals to go T7→T8 → +13,000 leveling gain.
  const path = computeBestLevelingPath({
    profitByTier: { 7: 1000 },
    contractPrices: {
      2: { buy: 0, sell: 0 }, 3: { buy: 0, sell: 0 }, 4: { buy: 0, sell: 0 },
      5: { buy: 0, sell: 0 }, 6: { buy: 0, sell: 0 },
      7: { buy: 50000, sell: 0 }, 8: { buy: 0, sell: 300000 },
    },
    fameKeys: GATHER_KEYS,
  });
  assert.ok(path);
  assert.strictEqual(path.startTier, 7);
  assert.strictEqual(path.totalCycles, 13, "T7→T8 takes 13 gathering journals (same-tier yield 1.5)");
  const expected = 300000 * (1 - PREMIUM_TAX) - 50000 * (1 + SETUP_FEE) + 13 * 1000;
  assert.ok(Math.abs(path.netProfit - expected) < 1, `net: expected ${expected}, got ${path.netProfit}`);
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Leveling path wired into rows ===");

test("Same leveling path is attached identically to all of a laborer's tier rows", () => {
  // Multi-tier journals + contracts for the Lumberjack (Resource mode).
  const market = mdSplit([
    ...[2,3,4,5,6,7,8].flatMap((t) => [
      { id: `T${t}_JOURNAL_WOOD_FULL`, city: FS, price: 100 },
      { id: `T${t}_JOURNAL_WOOD_EMPTY`, city: FS, price: 50 },
      { id: `T${t}_WOOD`,               city: FS, price: 500 },
      { id: `T${t}_LABOURER_CONTRACT_WOOD`, city: FS, ask: t * 100000, bid: t * 90000 },
    ]),
  ]);
  const rows = buildLaborersRowData(market);
  const wood = rows.filter((r) => r.mode === "Resource" && r.laborerName === "Lumberjack");
  assert.strictEqual(wood.length, 7);
  wood.forEach((r) => assert.ok(r.levelingPath, `T${r.tier} should carry a leveling path`));
  const ref = wood[0].levelingPath;
  wood.forEach((r) => {
    assert.strictEqual(r.levelingPath.startTier, ref.startTier, "same start tier on every row");
    assert.strictEqual(r.levelingPath.endTier, ref.endTier, "same end tier on every row");
    assert.ok(Math.abs(r.levelingPath.netProfit - ref.netProfit) < 1, "same net profit on every row");
  });
  assert.ok(ref.startTier < ref.endTier, "path levels upward");
});

test("GENERAL trophy rows have no leveling path (no contract attribution)", () => {
  const market = mdSplit([
    { id: "T6_JOURNAL_TROPHY_GENERAL_FULL", city: FS, price: 1000 },
    { id: "T6_FURNITUREITEM_TROPHY_GENERAL", city: FS, ask: 5000, bid: 5000 },
    { id: "T6_JOURNAL_TROPHY_GENERAL_EMPTY", city: FS, price: 100 },
  ]);
  const rows = buildLaborersRowData(market);
  const gen = rows.find((r) => r.mode === "Trophy" && r.laborerName === "General Trophy");
  assert.ok(gen);
  assert.strictEqual(gen.levelingPath, null);
});

test("_levelingFameKeys maps each mode to the right fame tables", () => {
  const woodLab = LABORERS.find((l) => l.slug === "WOOD");
  const mercLab = LABORERS.find((l) => l.slug === "MERCENARY");
  const warLab  = LABORERS.find((l) => l.slug === "WARRIOR");
  assert.deepStrictEqual(M._levelingFameKeys({ mode: LABORER_MODE.RESOURCE, laborer: woodLab }),
    { fameType: "GATHERING", upgradeCat: "GATHER_CRAFT" });
  assert.deepStrictEqual(M._levelingFameKeys({ mode: LABORER_MODE.CRAFTING, laborer: warLab }),
    { fameType: "CRAFTING", upgradeCat: "GATHER_CRAFT" });
  assert.deepStrictEqual(M._levelingFameKeys({ mode: LABORER_MODE.MERCENARY, laborer: mercLab }),
    { fameType: "MERCENARY", upgradeCat: "MERCENARY" });
  // Fisherman trophy → fisherman fame tables
  const fishLab = LABORERS.find((l) => l.slug === "FISHING");
  assert.deepStrictEqual(M._levelingFameKeys({ mode: LABORER_MODE.TROPHY, laborer: fishLab }),
    { fameType: "FISHERMAN_TROPHY", upgradeCat: "FISHERMAN" });
  // GENERAL trophy (no laborer) → null
  assert.strictEqual(M._levelingFameKeys({ mode: LABORER_MODE.TROPHY, laborer: null }), null);
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Fisherman Resource mode (fish profit/cycle) ===");

// Detailed lootlist-EV behavior lives in laborers-fishing-lootlist.test.cjs;
// these cover the integration surface used by the rest of this file.

test("getFishResourceIds returns the journal lootlist's distinct ids (deduped)", () => {
  // T2 — seaweed + T1/T2 fresh & salt commons (no rares below the T3 band).
  assert.deepStrictEqual(new Set(getFishResourceIds(2)), new Set([
    "T1_SEAWEED",
    "T1_FISH_FRESHWATER_ALL_COMMON", "T2_FISH_FRESHWATER_ALL_COMMON",
    "T1_FISH_SALTWATER_ALL_COMMON", "T2_FISH_SALTWATER_ALL_COMMON",
  ]));
  // T6 — commons across the tier band + rares spread over the T3 AND T5 bands.
  const t6 = getFishResourceIds(6);
  assert.ok(t6.includes("T6_FISH_FRESHWATER_ALL_COMMON"));
  assert.ok(t6.includes("T6_FISH_SALTWATER_ALL_COMMON"));
  assert.ok(t6.includes("T5_FISH_FRESHWATER_FOREST_RARE"));
  assert.ok(t6.includes("T3_FISH_FRESHWATER_FOREST_RARE"), "cheap T3-band rares included too");
  assert.ok(t6.includes("T5_FISH_SALTWATER_ALL_RARE"));
  assert.strictEqual(new Set(t6).size, t6.length, "ids are unique");
});

// The weight share is taken over the lines that PRICE, not the whole lootlist —
// an unpriced line is a draw we cannot value, not a draw worth nothing. See
// tests/laborers-fishing-lootlist.test.cjs for the full argument.
function fishEvPerDraw(tier, prices) {
  const ll = FISH_JOURNAL_LOOTLIST[tier].filter((l) => prices[l[0]] > 0);
  const w = ll.reduce((s, l) => s + l[2], 0);
  return w > 0 ? ll.reduce((s, [id, amount, weight]) => s + (weight / w) * amount * prices[id], 0) : 0;
}

test("_fishResourceRevenue = weight-share EV over the PRICED lootlist lines, post-tax", () => {
  // Price every common at 300; no rares/seaweed priced. The priced lines are all
  // commons at 300, so the weighted average is 300 flat.
  const ll = FISH_JOURNAL_LOOTLIST[6];
  const prices = {};
  ll.filter((l) => l[0].includes("_COMMON")).forEach((l) => { prices[l[0]] = 300; });
  const market = mdSplit(Object.entries(prices).map(([id, price]) => ({ id, city: FS, price })));
  const r = _fishResourceRevenue(6, market, FS);
  assert.ok(r.hasData);
  const expectedPerDraw = fishEvPerDraw(6, prices);
  assert.ok(Math.abs(expectedPerDraw - 300) < 1e-9, "sanity: all priced lines are 300");
  assert.ok(Math.abs(r.payloadPrice - expectedPerDraw) < 1e-6, `EV/draw: expected ${expectedPerDraw}, got ${r.payloadPrice}`);
  const expected = FISH_LABORER_BASELOOT[6] * getLaborerYield(6) * expectedPerDraw * (1 - PREMIUM_TAX);
  assert.ok(Math.abs(r.revenue - expected) < 1, `rev: expected ${expected}, got ${r.revenue}`);
});

test("_fishResourceRevenue: a single expensive rare contributes only its weight share", () => {
  // T5 Forest rare @ 5000 is 1 of the T6 journal's equally-weighted rare lines,
  // so it adds its (10 / priced weight) share to EV/draw — NOT 15% of it.
  const ll = FISH_JOURNAL_LOOTLIST[6];
  const prices = {};
  ll.filter((l) => l[0].includes("_COMMON")).forEach((l) => { prices[l[0]] = 300; });
  prices["T5_FISH_FRESHWATER_FOREST_RARE"] = 5000;
  const market = mdSplit(Object.entries(prices).map(([id, price]) => ({ id, city: FS, price })));
  const r = _fishResourceRevenue(6, market, FS);
  const expectedPerDraw = fishEvPerDraw(6, prices);
  assert.ok(Math.abs(r.payloadPrice - expectedPerDraw) < 1e-6, `EV/draw: expected ${expectedPerDraw}, got ${r.payloadPrice}`);
  assert.ok(r.payloadPrice < 0.15 * 5000, "still far below the old flat 15%-of-the-spike heuristic");
});

test("_fishResourceRevenue → no data when no common fish price is available", () => {
  const r = _fishResourceRevenue(6, mdSplit([]), FS);
  assert.strictEqual(r.hasData, false);
  assert.strictEqual(r.revenue, 0);
});

test("Fisherman is back in the table as a Resource laborer with profit/cycle", () => {
  const market = mdSplit([2,3,4,5,6,7,8].flatMap((t) => [
    { id: `T${t}_JOURNAL_FISHING_FULL`, city: FS, price: 200 },
    { id: `T${t}_JOURNAL_FISHING_EMPTY`, city: FS, price: 50 },
    { id: `T${t}_FISH_FRESHWATER_ALL_COMMON`, city: FS, price: 400 },
    { id: `T${t}_FISH_SALTWATER_ALL_COMMON`, city: FS, price: 350 },
  ]));
  const rows = buildLaborersRowData(market);
  const fish = rows.filter((r) => r.mode === "Resource" && r.laborerName === "Fisherman");
  assert.strictEqual(fish.length, 7, "one Resource row per tier");
  fish.forEach((r) => {
    assert.ok(r.payloadRevenue > 0, `T${r.tier} should have a fish payload`);
    assert.notStrictEqual(r.marginInfo.profit, 0, `T${r.tier} should have a profit/cycle`);
  });
});

test("Fisherman Resource leveling path uses FISHERMAN (fishing) fame, not GATHERING", () => {
  const fishLab = LABORERS.find((l) => l.slug === "FISHING");
  assert.deepStrictEqual(M._levelingFameKeys({ mode: LABORER_MODE.RESOURCE, laborer: fishLab }),
    { fameType: "FISHERMAN", upgradeCat: "FISHERMAN" });
  // Land gatherers still use the gathering fame tables.
  const woodLab = LABORERS.find((l) => l.slug === "WOOD");
  assert.deepStrictEqual(M._levelingFameKeys({ mode: LABORER_MODE.RESOURCE, laborer: woodLab }),
    { fameType: "GATHERING", upgradeCat: "GATHER_CRAFT" });
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Browser global-scope safety (no duplicate top-level declarations) ===");

test("data-gathering + data-laborers + render-laborers share global scope without collisions", () => {
  // In the browser these load as separate classic <script>s into ONE global
  // lexical scope, so any duplicate top-level `const`/`let` (e.g. two
  // FISH_RARE_BIOMES) aborts a whole script with "Identifier already declared"
  // — which is exactly how getLaborersItemIds silently went undefined and broke
  // "Scan Laborers". The main test sandbox never loads data-gathering.js, so it
  // can't see that class of bug. Concatenating the three real files into one
  // compile reproduces it: a duplicate top-level declaration becomes a
  // SyntaxError HERE (failing this test) instead of only in the browser console.
  const combined =
    loadFile("js/data-gathering.js") + "\n" +
    loadFile("js/data-laborers.js")  + "\n" +
    loadFile("js/laborers-pricing.js") +
    loadFile("js/render-laborers.js") + "\n" +
    "module.exports = {" +
    "  hasLaborerIds:   typeof getLaborersItemIds === 'function'," +
    "  hasFishResource: typeof getFishResourceIds === 'function'," +
    "  gatheringFish:   typeof FISH_RARE_BIOMES !== 'undefined'," +
    "};";
  const m = new Module("laborers-browser-scope-test");
  // _compile throws SyntaxError("Identifier 'X' has already been declared")
  // the moment two of these scripts declare the same top-level const/let.
  m._compile(combined, "laborers-browser-scope.js");
  assert.strictEqual(m.exports.hasLaborerIds, true,
    "getLaborersItemIds must still be defined after both fish-owning scripts load");
  assert.strictEqual(m.exports.hasFishResource, true, "getFishResourceIds must be defined");
  assert.strictEqual(m.exports.gatheringFish, true,
    "data-gathering.js keeps its own FISH_RARE_BIOMES (laborers must not clobber/collide)");
});

// ── the self-fill column never touches Profit / Cycle ──────────────────────
// Filling your own journal is an ALTERNATIVE play to this row, not an addition
// to it: the row buys the journal full and sells the empty back, the self-fill
// loop does neither. So loading js/laborer-self-fill.js must leave every silver
// figure on the row byte-identical. This is the guard against the column ever
// being folded into marginInfo or the Pure Profit breakdown.
test("loading the self-fill column leaves every per-cycle figure unchanged", () => {
  function buildRowsWith(extraSources) {
    const m = new Module("laborers-selffill-parity-" + extraSources.length);
    m._compile(
      sandbox + extraSources.map(loadFile).join("\n") + dataSrc + pricingSrc + renderSrc +
        "\nmodule.exports = { buildLaborersRowData, getLaborersItemIds, " +
        "hasSelfFill: typeof computeLaborerSelfFill === 'function' };",
      "laborers-selffill-parity.js",
    );
    return m.exports;
  }
  // data-journals + journal-fill-speed + laborer-journal-value are what
  // laborer-self-fill.js leans on; they load BEFORE the laborers files in the
  // browser too, so this is the real script order.
  const withCol = buildRowsWith([
    "js/data-gathering.js", "js/gather-fame-rates.js",
    "js/data-journals.js", "js/journal-fill-speed.js", "js/laborer-journal-value.js",
    "js/laborer-self-fill.js",
  ]);
  const without = buildRowsWith([]);
  assert.strictEqual(withCol.hasSelfFill, true, "the self-fill module must actually be loaded");
  assert.strictEqual(without.hasSelfFill, false, "the control build must not have it");

  const md = {};
  const cities = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
  let seed = 7;
  withCol.getLaborersItemIds().forEach((id) => {
    md[id] = {};
    cities.forEach((c) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const price = 50 + (seed % 8000);
      md[id][c] = { buy_price: price, sell_price: Math.round(price * 1.12), volume_24h: 5000 };
    });
  });

  const a = withCol.buildLaborersRowData(md);
  const b = without.buildLaborersRowData(md);
  assert.strictEqual(a.length, b.length, "row count changed");
  const MONEY = ["totalInputCost", "payloadRevenue", "emptyRevenue", "emptyJournalPrice", "breakevenCycles", "playYield"];
  a.forEach((rowA, i) => {
    const rowB = b[i];
    assert.strictEqual(rowA.item.id, rowB.item.id, `row ${i}: different row`);
    assert.deepStrictEqual(rowA.marginInfo, rowB.marginInfo, `${rowA.item.id}: marginInfo changed`);
    MONEY.forEach((k) => assert.strictEqual(rowA[k], rowB[k], `${rowA.item.id}: ${k} changed`));
    assert.deepStrictEqual(rowA.bestJournal, rowB.bestJournal, `${rowA.item.id}: Best Journal verdict changed`);
  });
  // …and the column really did produce something, so the parity above is not
  // trivially true because everything came back null.
  assert.ok(a.some((r) => r.selfFill && r.selfFill.found && r.selfFillPerHour > 0),
    "no row produced a self-fill play — the parity check would prove nothing");
});

finish();
