/**
 * My Crafting List — per-table row extraction + material aggregation
 * (js/craft-list-materials.js).
 *
 * Black-box: one synthetic row per source table (shapes copied from the real
 * row builders), asserting the normalized {itemId, inputCost, unitProfit,
 * materials[]} the list panel consumes, then the pure aggregator that turns
 * entries × quantity into a shopping list.
 *
 * Run: node --test tests/craft-list-materials-extraction.test.cjs
 *
 * Per-table row extraction, building fittings, edge rows. Shared setup: tests/helpers/craft-list-materials-setup.cjs.
 */
const {
  assert, CRAFT_LIST_EXTRACTORS, extractCraftListRow, test, finish,
} = require("./helpers/craft-list-materials-setup.cjs");

// ── one synthetic row per table ─────────────────────────────────────────────

const ROWS = {
  "craft-planner-table": {
    row: {
      item: { id: "T6_BAG", name: "Bag [T6]" },
      craftCity: "Martlock",
      sellCity: "Caerleon",
      sellPrice: 30000,
      refineCraftCost: 20000,
      combinedProfit: 6000,
      focusPerCraft: 12.5,
      sourcing: [
        { matId: "T6_CLOTH", count: 8, sourcing: { city: "Martlock", perUnit: 1500 } },
        { matId: "T6_LEATHER", count: 4, sourcing: { city: "Lymhurst", perUnit: 1200 } },
      ],
    },
    expect: {
      itemId: "T6_BAG", inputCost: 20000, unitProfit: 6000, sellPrice: 30000,
      focusCost: 12.5,
      materials: [
        { matId: "T6_CLOTH", count: 8, city: "Martlock", perUnit: 1500 },
        { matId: "T6_LEATHER", count: 4, city: "Lymhurst", perUnit: 1200 },
      ],
    },
  },

  "crafting-table": {
    row: {
      item: { id: "T5_HEAD_PLATE_SET1", name: "Plate Helmet [T5]" },
      materials: [{ matId: "T5_METALBAR", count: 8 }],
      matBestPrices: { T5_METALBAR: { city: "Thetford", price: 900 } },
      craftCity: "Thetford",
      sellGear: { city: "Caerleon", price: 12000 },
      totalInputCost: 7200,
      focusCost: 1200,
      marginInfo: { profit: 3000, margin: 41 },
    },
    expect: {
      itemId: "T5_HEAD_PLATE_SET1", inputCost: 7200, unitProfit: 3000, sellPrice: 12000,
      focusCost: 1200,
      materials: [{ matId: "T5_METALBAR", count: 8, city: "Thetford", perUnit: 900 }],
    },
  },

  "consumable-table": {
    row: {
      item: { id: "T6_MEAL_STEW", name: "Beef Stew [T6]" },
      recipe: [
        { matId: "T6_MEAT", count: 6 },
        { matId: "T5_FISH_FRESHWATER_ALL", count: 2 },
      ],
      matBestPrices: {
        T6_MEAT: { city: "Bridgewatch", price: 400 },
        T5_FISH_FRESHWATER_ALL: { city: null, price: 250 },
      },
      craftCity: "Bridgewatch",
      sellPot: { city: "Martlock", price: 5000 },
      totalInputCost: 2900,
      marginInfo: { profit: 1500, margin: 51 },
    },
    expect: {
      itemId: "T6_MEAL_STEW", inputCost: 2900, unitProfit: 1500, sellPrice: 5000,
      materials: [
        { matId: "T6_MEAT", count: 6, city: "Bridgewatch", perUnit: 400 },
        // no market city (self-made chain) → falls back to the craft city
        { matId: "T5_FISH_FRESHWATER_ALL", count: 2, city: "Bridgewatch", perUnit: 250 },
      ],
    },
  },

  "mounts-table": {
    row: {
      item: { id: "T5_MOUNT_HORSE", name: "Riding Horse", materials: [{ matId: "T5_LEATHER", count: 16 }] },
      matBestPrices: { T5_LEATHER: { city: "Lymhurst", price: 700 } },
      craftCity: "Lymhurst",
      sellPot: { city: "Caerleon", price: 20000 },
      totalInputCost: 11200,
      marginInfo: { profit: 4000, margin: 35 },
    },
    expect: {
      itemId: "T5_MOUNT_HORSE", inputCost: 11200, unitProfit: 4000, sellPrice: 20000,
      materials: [{ matId: "T5_LEATHER", count: 16, city: "Lymhurst", perUnit: 700 }],
    },
  },

  "transport-table": {
    row: {
      route: { rawId: "T5_ORE", refinedId: "T5_METALBAR", rawRatio: 2, secondaryMatId: "T4_METALBAR", secondaryMatCount: 1 },
      buyRaw: { city: "Thetford", price: 300 },
      sellRefined: { city: "Martlock", price: 1400 },
      secondaryMat: { id: "T4_METALBAR", count: 1, price: 500, city: "Thetford" },
      totalRawCost: 1100,
      refineCity: "Thetford",
      marginInfo: { profit: 200, margin: 18 },
    },
    expect: {
      itemId: "T5_METALBAR", inputCost: 1100, unitProfit: 200, sellPrice: 1400,
      materials: [
        { matId: "T5_ORE", count: 2, city: "Thetford", perUnit: 300 },
        { matId: "T4_METALBAR", count: 1, city: "Thetford", perUnit: 500 },
      ],
    },
  },

  "transmute-table": {
    row: {
      tier: 5,
      transition: { label: "T4 → T5" },
      sourceId: "T4_RUNE", sourceCount: 5,
      buyCity: "Caerleon", buyPrice: 800,
      targetId: "T5_RUNE", sellCity: "Caerleon", sellPrice: 6000,
      totalInputCost: 4600,
      marginInfo: { profit: 900, margin: 19 },
    },
    expect: {
      itemId: "T5_RUNE", inputCost: 4600, unitProfit: 900, sellPrice: 6000,
      materials: [{ matId: "T4_RUNE", count: 5, city: "Caerleon", perUnit: 800 }],
    },
  },

  "enchanting-table": {
    row: {
      item: { id: "T6_2H_AXE", name: "Great Axe [T6]" },
      sourceId: "T6_2H_AXE", targetId: "T6_2H_AXE@1",
      enchantMatId: "T6_RUNE", matCount: 24,
      sourceCity: "Martlock", sourcePrice: 40000,
      matCity: "Caerleon", matPrice: 900,
      sellCity: "Caerleon", sellPrice: 90000,
      totalInputCost: 62000,
      marginInfo: { profit: 15000, margin: 24 },
    },
    expect: {
      itemId: "T6_2H_AXE@1", inputCost: 62000, unitProfit: 15000, sellPrice: 90000,
      materials: [
        { matId: "T6_2H_AXE", count: 1, city: "Martlock", perUnit: 40000 },
        { matId: "T6_RUNE", count: 24, city: "Caerleon", perUnit: 900 },
      ],
    },
  },

  "rerolling-table": {
    row: {
      item: { id: "T7_ARMOR_LEATHER_SET2", name: "Assassin Jacket [T7]" },
      buyCity: "Bridgewatch", buyPrice: 150000,
      sellCity: "Caerleon", sellPrice: 260000,
      totalInputCost: 190000,
      marginInfo: { profit: 40000, margin: 21 },
    },
    expect: {
      itemId: "T7_ARMOR_LEATHER_SET2", inputCost: 190000, unitProfit: 40000, sellPrice: 260000,
      materials: [{ matId: "T7_ARMOR_LEATHER_SET2", count: 1, city: "Bridgewatch", perUnit: 150000 }],
    },
  },

  "flipping-table": {
    row: {
      item: { id: "T4_ORE", name: "Ore [T4]" },
      buy: { city: "Fort Sterling", price: 120 },
      sell: { city: "Caerleon", price: 210 },
      marginInfo: { profit: 60, margin: 50 },
    },
    expect: {
      itemId: "T4_ORE", inputCost: 120, unitProfit: 60, sellPrice: 210,
      materials: [{ matId: "T4_ORE", count: 1, city: "Fort Sterling", perUnit: 120 }],
    },
  },

  "skins-trading-table": {
    row: {
      item: { id: "UNIQUE_UNLOCK_CAPE_VANITY", name: "Cape Skin" },
      buy: { city: "Martlock", price: 900000 },
      sell: { city: "Caerleon", price: 1400000 },
      marginInfo: { profit: 300000, margin: 33 },
    },
    expect: {
      itemId: "UNIQUE_UNLOCK_CAPE_VANITY", inputCost: 900000, unitProfit: 300000, sellPrice: 1400000,
      materials: [{ matId: "UNIQUE_UNLOCK_CAPE_VANITY", count: 1, city: "Martlock", perUnit: 900000 }],
    },
  },

  "rolling-table": {
    row: {
      artId: "T6_ARTEFACT_2H_AXE", artName: "Realmbreaker fragment", tier: 6,
      fragmentId: "T6_FRAGMENT", fragLabel: "T6 fragments",
      fragBuyCity: "Caerleon", fragBuyPrice: 1000,
      rollCost: 36, rollCostSilver: 36000,
      bestSellCity: "Caerleon", bestSellPrice: 90000,
      sellRevenue: 82000,
    },
    expect: {
      itemId: "T6_ARTEFACT_2H_AXE", inputCost: 36000, unitProfit: 46000, sellPrice: 90000,
      materials: [{ matId: "T6_FRAGMENT", count: 36, city: "Caerleon", perUnit: 1000 }],
    },
  },

  "buildings-table": {
    row: {
      building: { id: "HUNTER_LODGE_T6", name: "Hunter Lodge" },
      variant: "shell",
      materials: [
        { matId: "T6_PLANKS", count: 100, price: 800, city: "Fort Sterling" },
        { matId: "T6_STONEBLOCK", count: 60, price: 500, city: "Bridgewatch" },
      ],
      totalCost: 140000,
    },
    expect: {
      itemId: "HUNTER_LODGE_T6", inputCost: 140000, unitProfit: 0, sellPrice: 0,
      materials: [
        { matId: "T6_PLANKS", count: 100, city: "Fort Sterling", perUnit: 800 },
        { matId: "T6_STONEBLOCK", count: 60, city: "Bridgewatch", perUnit: 500 },
      ],
    },
  },

  "laborers-table": {
    row: {
      item: { id: "T5_LABORER", name: "Lumberjack" },
      filledId: "T5_JOURNAL_WARRIOR_FULL",
      buy: { city: "Martlock", price: 9000 },
      sell: { city: "Martlock", price: 22000 },
      totalInputCost: 9225,
      marginInfo: { profit: 8000, margin: 86 },
    },
    expect: {
      itemId: "T5_LABORER", inputCost: 9225, unitProfit: 8000, sellPrice: 22000,
      materials: [{ matId: "T5_JOURNAL_WARRIOR_FULL", count: 1, city: "Martlock", perUnit: 9000 }],
    },
  },

  "journal-filling-table": {
    row: {
      fullId: "T6_JOURNAL_HUNTER_FULL", emptyId: "T6_JOURNAL_HUNTER_EMPTY",
      name: "Fletcher T6", label: "Fletcher T6",
      fullCity: "Caerleon", fullGross: 22000,
      emptyCity: "Martlock", emptyCost: 9000,
      marginPerJournal: 12000,
    },
    expect: {
      itemId: "T6_JOURNAL_HUNTER_FULL", inputCost: 9000, unitProfit: 12000, sellPrice: 22000,
      materials: [{ matId: "T6_JOURNAL_HUNTER_EMPTY", count: 1, city: "Martlock", perUnit: 9000 }],
    },
  },

  // The list counts CROPS, not cycles: money, focus and the seed line all have
  // to be per harvested output. `focusCost` on the source row is the whole
  // cycle's watering focus and `seedsPerOutput` the net seed one crop costs,
  // so the extractor reads the per-output siblings instead.
  "farming-table": {
    row: {
      item: { id: "T5_CARROT_SEED", name: "Carrot Seed", outputId: "T5_CARROT" },
      buySeed: { city: "Lymhurst", price: 500 },
      sellCrop: { city: "Lymhurst", price: 900 },
      totalInputCost: 500,
      marginInfo: { profit: 250, margin: 50 },
      focusCost: 200,
      outputsPerCycle: 40,
      focusPerOutput: 5,
      seedsPerOutput: 0.05,
    },
    expect: {
      itemId: "T5_CARROT", inputCost: 500, unitProfit: 250, sellPrice: 900,
      focusCost: 5,
      materials: [{ matId: "T5_CARROT_SEED", count: 0.05, city: "Lymhurst", perUnit: 500 }],
    },
  },

  "gathering-table": {
    row: { id: "T6_HIDE", name: "Hide [T6]", sellCity: "Martlock", sellPrice: 1400, silverPerHour: 400000 },
    expect: { itemId: "T6_HIDE", inputCost: 0, unitProfit: 0, sellPrice: 1400, materials: [] },
  },

  "faction-spending-table": {
    row: { itemId: "T6_FACTION_CREST", name: "Crest", sellCity: "Caerleon", sellPrice: 40000, netSilver: 38000, fpCost: 500 },
    expect: { itemId: "T6_FACTION_CREST", inputCost: 0, unitProfit: 38000, sellPrice: 40000, materials: [] },
  },
};

Object.entries(ROWS).forEach(([tableId, { row, expect }]) => {
  test(`${tableId} → normalized row`, () => {
    const got = extractCraftListRow(tableId, row);
    assert.ok(got, "extractor returned null");
    Object.entries(expect).forEach(([field, want]) => {
      if (field === "materials") {
        assert.deepStrictEqual(
          got.materials.map((m) => ({ matId: m.matId, count: m.count, city: m.city, perUnit: m.perUnit })),
          want,
        );
      } else {
        assert.strictEqual(got[field], want, `${field}: ${got[field]} != ${want}`);
      }
    });
  });
});

// ── which tables carry focus into the footer total ──────────────────────────
//
// The footer sums focusCost × qty (summarizeCraftList), so an extractor that
// drops the field under-counts the whole basket: a list holding two farming
// rows at 200 focus/cycle read "19 focus" because only the two consumables
// reached the sum. Every focus-spending table must hand its focus over, and
// every focus-free one must stay at a true 0 rather than a guess.
[
  ["crafting-table", { item: { id: "T5_HEAD_PLATE_SET1" }, focusCost: 1200 }, 1200],
  ["consumable-table", { item: { id: "T6_MEAL_STEW" }, focusCost: 3.89 }, 3.89],
  ["mounts-table", { item: { id: "T5_MOUNT_HORSE" }, focusCost: 600 }, 600],
  ["transport-table", { route: { refinedId: "T5_METALBAR" }, focusCost: 45 }, 45],
  // The winning water/nurture play's focus for one cycle, divided down to the
  // ONE CROP the list counts: 200 focus over a 40-output cycle is 5 a crop.
  ["farming-table", {
    item: { id: "T5_CARROT_SEED", outputId: "T5_CARROT" },
    focusCost: 200, outputsPerCycle: 40, focusPerOutput: 5,
  }, 5],
  // A pasture row has no watering play at all - 0, never a guess.
  ["farming-table", {
    item: { id: "T6_POTATO", outputId: "T6_MILK" },
    focusCost: 0, outputsPerCycle: 9, focusPerOutput: 0, seedsPerOutput: 1,
  }, 0],
  // The planner names it focusPerCraft: a refine play is already scaled from
  // one refine to the refines one craft needs (js/craft-planner-pricing.js).
  ["craft-planner-table", { item: { id: "T6_BAG" }, focusPerCraft: 12.5 }, 12.5],
  // Focus-free plays. Gathering spends time; flipping and transmuting spend
  // silver; a faction row's netSilver is the direct FP→sale, and the breeding
  // play's nurture focus belongs to the mounts row, not this one.
  ["gathering-table", { id: "T6_HIDE" }, 0],
  ["flipping-table", { item: { id: "T6_BAG" } }, 0],
  ["transmute-table", { targetId: "T6_RUNE" }, 0],
  ["faction-spending-table", { itemId: "T8_BABY_BOAR", netSilver: 709791 }, 0],
].forEach(([tableId, row, want]) => {
  test(`${tableId} → focusCost ${want}`, () => {
    const got = extractCraftListRow(tableId, row);
    assert.ok(got, "extractor returned null");
    assert.strictEqual(got.focusCost, want);
  });
});

// ── a building's fitting: contracts + furniture ─────────────────────────────
//
// A building row's Total Cost is shell + laborers + furniture, so the shopping
// list has to carry all three. It used to carry the shell alone: adding a house
// put its blocks and logs on the board and no beds, tables or contracts.

// A furnished house: 2 laborers, a bed and a table each, two trophy blocks.
const HOUSE_ROW = {
  building: { id: "T5_PLAYERHOUSE", name: "House" },
  materials: [{ matId: "T5_STONEBLOCK", count: 40, price: 300, city: "Bridgewatch" }],
  totalCost: 500000,
  laborers: { id: "T5_LABOURER_CONTRACT_LUMBERJACK", count: 2, price: 12000, city: "Martlock" },
  plan: {
    beds: { id: "T5_FURNITUREITEM_BED", count: 2, price: 9000, city: "Lymhurst" },
    tables: { id: "T5_FURNITUREITEM_TABLE", count: 1, price: 15000, city: "Lymhurst" },
    trophies: [
      { id: "T5_FURNITUREITEM_TROPHY_WOOD", copies: 2, price: 40000, city: "Fort Sterling" },
      { id: "T3_FURNITUREITEM_TROPHY_GENERAL", copies: 1, price: 7000, city: "Caerleon" },
    ],
    bedsAndTablesFit: true,
  },
};

const FITTING_CASES = [
  {
    name: "a furnished house shops its contract, beds, tables and trophies",
    row: HOUSE_ROW,
    want: [
      { matId: "T5_STONEBLOCK", count: 40, city: "Bridgewatch", perUnit: 300 },
      { matId: "T5_LABOURER_CONTRACT_LUMBERJACK", count: 2, city: "Martlock", perUnit: 12000 },
      { matId: "T5_FURNITUREITEM_BED", count: 2, city: "Lymhurst", perUnit: 9000 },
      { matId: "T5_FURNITUREITEM_TABLE", count: 1, city: "Lymhurst", perUnit: 15000 },
      // trophies are bought in whole blocks — `copies`, not 1
      { matId: "T5_FURNITUREITEM_TROPHY_WOOD", count: 2, city: "Fort Sterling", perUnit: 40000 },
      { matId: "T3_FURNITUREITEM_TROPHY_GENERAL", count: 1, city: "Caerleon", perUnit: 7000 },
    ],
  },
  {
    name: "a furnishing that cannot fit contributes no furniture, only the crew",
    row: { ...HOUSE_ROW, plan: { ...HOUSE_ROW.plan, bedsAndTablesFit: false } },
    want: [
      { matId: "T5_STONEBLOCK", count: 40, city: "Bridgewatch", perUnit: 300 },
      { matId: "T5_LABOURER_CONTRACT_LUMBERJACK", count: 2, city: "Martlock", perUnit: 12000 },
    ],
  },
  {
    name: "no trophies fit → beds and tables still shop",
    row: { ...HOUSE_ROW, plan: { ...HOUSE_ROW.plan, trophies: [] } },
    want: [
      { matId: "T5_STONEBLOCK", count: 40, city: "Bridgewatch", perUnit: 300 },
      { matId: "T5_LABOURER_CONTRACT_LUMBERJACK", count: 2, city: "Martlock", perUnit: 12000 },
      { matId: "T5_FURNITUREITEM_BED", count: 2, city: "Lymhurst", perUnit: 9000 },
      { matId: "T5_FURNITUREITEM_TABLE", count: 1, city: "Lymhurst", perUnit: 15000 },
    ],
  },
  {
    name: "a slot-less station is construction only",
    row: { ...HOUSE_ROW, laborers: null, plan: null },
    want: [{ matId: "T5_STONEBLOCK", count: 40, city: "Bridgewatch", perUnit: 300 }],
  },
  {
    name: "an unpriced contract is still listed — it is what the user must go buy",
    row: { ...HOUSE_ROW, laborers: { id: "T5_LABOURER_CONTRACT_LUMBERJACK", count: 1 }, plan: null },
    want: [
      { matId: "T5_STONEBLOCK", count: 40, city: "Bridgewatch", perUnit: 300 },
      { matId: "T5_LABOURER_CONTRACT_LUMBERJACK", count: 1, city: "", perUnit: 0 },
    ],
  },
  {
    name: "a zero-count line is dropped rather than shopped",
    row: {
      ...HOUSE_ROW,
      laborers: { id: "T5_LABOURER_CONTRACT_LUMBERJACK", count: 0, price: 12000, city: "Martlock" },
      plan: { ...HOUSE_ROW.plan, tables: { id: "T5_FURNITUREITEM_TABLE", count: 0 }, trophies: [] },
    },
    want: [
      { matId: "T5_STONEBLOCK", count: 40, city: "Bridgewatch", perUnit: 300 },
      { matId: "T5_FURNITUREITEM_BED", count: 2, city: "Lymhurst", perUnit: 9000 },
    ],
  },
];

FITTING_CASES.forEach(({ name, row, want }) => {
  test(`buildings-table — ${name}`, () => {
    const got = extractCraftListRow("buildings-table", row);
    assert.deepStrictEqual(
      got.materials.map((m) => ({ matId: m.matId, count: m.count, city: m.city, perUnit: m.perUnit })),
      want,
    );
  });
});

test("buildings-table — fitting lines are plain buys, never tagged as self-made", () => {
  const got = extractCraftListRow("buildings-table", HOUSE_ROW);
  got.materials.forEach((m) => assert.strictEqual(m.note, "", `${m.matId} carries a note`));
});

test("every wired table has an extractor", () => {
  const wired = Object.keys(ROWS);
  wired.forEach((t) => assert.ok(typeof CRAFT_LIST_EXTRACTORS[t] === "function", `missing ${t}`));
  // and no extractor is registered without a test row
  Object.keys(CRAFT_LIST_EXTRACTORS).forEach((t) => assert.ok(wired.includes(t), `untested ${t}`));
});

test("unknown table id → null", () => {
  assert.strictEqual(extractCraftListRow("volume-table", { item: { id: "X" } }), null);
});

test("null row → null", () => {
  assert.strictEqual(extractCraftListRow("crafting-table", null), null);
});

test("a row missing its price fields still extracts (zeros, no throw)", () => {
  const got = extractCraftListRow("crafting-table", { item: { id: "T4_BAG" } });
  assert.strictEqual(got.inputCost, 0);
  assert.strictEqual(got.unitProfit, 0);
  assert.deepStrictEqual(got.materials, []);
});

test("materials with no price are kept — they are what the user must go buy", () => {
  const got = extractCraftListRow("crafting-table", {
    item: { id: "T4_BAG" },
    materials: [{ matId: "T4_CLOTH", count: 8 }],
    matBestPrices: {},
  });
  assert.deepStrictEqual(got.materials, [{ matId: "T4_CLOTH", count: 8, city: "", perUnit: 0, note: "" }]);
});

finish();
