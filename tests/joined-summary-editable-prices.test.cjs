/**
 * Top-10 boards — the price cells are click-to-edit.
 *
 * A board cell is editable when it carries `class="price-editable"` plus
 * data-item-id / data-city / data-city-list; one delegated handler in js/app.js
 * picks it up wherever it sits (the same contract My Crafting List relies on).
 * For that to work `normalize()` has to carry the item identity through — it
 * used to publish only `itemName`, an already-localized display string.
 *
 * Two things are pinned here:
 *
 *   1. normalize() publishes sellItemId / sellQuality / sellSideOverride, keyed
 *      EXACTLY as the feeder's own table keys the same number. A board cell that
 *      writes a different key than the table its Jump link lands on would store
 *      an override the user can see in one place and not the other.
 *   2. Aggregate Input Cost stays non-editable. It is a SUM (materials × count
 *      plus fees) for ten of the twelve feeders — see aggregateCostTd in
 *      js/app.js and tests/aggregate-cost-cell-not-editable.test.cjs. Flipping
 *      is the exception: its "input cost" IS a per-unit buy price.
 *
 * Run: node tests/joined-summary-editable-prices.test.cjs
 */

const assert = require("assert");
const path = require("path");

// ── Browser-side helpers the sources + formatters call ──────────────────────
globalThis.getRowKey = function (row, tableId) {
  const part = row?.item?.id || row?.item?.name || row?.itemId || row?.artId || row?.name || "?";
  return `${tableId}|${part}`;
};
// The city constants the renderer falls back on when a row names no city.
globalThis.SELL_CITIES = globalThis.SELL_CITIES || [
  "Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock",
  "Bridgewatch", "Brecilien", "Black Market",
];
globalThis.tx = globalThis.tx || ((en) => en);
globalThis.dispName = globalThis.dispName || ((id, fallback) => fallback);
globalThis.formatSilver = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
globalThis.formatFocusCost = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
globalThis.getProfitClass = (m) => (m >= 20 ? "profit-high" : m > 0 ? "profit-low" : "profit-negative");
// The Laborers source asks the real enum whether a row is in trophy mode.
globalThis.LABORER_MODE = { TROPHY: "Trophy", RESOURCE: "Resource", CRAFTING: "Crafting", MERCENARY: "Mercenary" };

// Faithful-enough priceTd: emits the real attribute contract and records the
// arguments, so the formatter's argument order can be asserted directly.
const priceTdCalls = [];
globalThis.priceTd = function (price, itemId, city, side = "sell", extraClass = "silver-val",
                               showCity = false, quality = null, sideOverride = false, note = "") {
  priceTdCalls.push({ price, itemId, city, side, extraClass, showCity, quality, sideOverride, note });
  const q = quality != null ? ` data-quality="${quality}"` : "";
  return `<td class="${extraClass} cell-num price-editable" data-item-id="${itemId}"`
    + ` data-city="${city}" data-raw-price="${price}" data-city-list="${side}"${q}>`
    + `${globalThis.formatSilver(price)}</td>`;
};
globalThis.aggregateCostTd = function (cost, extraClass = "silver-val cell-num") {
  const n = Number(cost);
  if (!isFinite(n) || n <= 0) return `<td class="${extraClass}" style="font-style:italic">—</td>`;
  return `<td class="${extraClass}" title="Materials column">${globalThis.formatSilver(n)}</td>`;
};

const { JOINED_SOURCES } =
  require(path.join(__dirname, "..", "js", "joined-summary-sources.js"));
const { formatJoinedRow, formatJoinedFocusRow } =
  require(path.join(__dirname, "..", "js", "render-joined-summary.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const margin = (profit, m = 30) => ({ profit, margin: m });

/**
 * One representative source row per feeder, plus what normalize() must publish.
 * `sellItemId`/`sellQuality`/`sellSideOverride` are copied from the feeder's OWN
 * priceTd call for the same number — the file:line is on each case.
 */
const CASES = [
  {
    tableId: "flipping-table",                      // render-flipping.js:116
    row: {
      item: { id: "T4_BAG", name: "Bag" }, tier: 4,
      buy: { city: "Bridgewatch", price: 1000 },
      sell: { city: "Martlock", price: 2000 },
      marginInfo: margin(800, 40), dailyVol: 10,
    },
    sellItemId: "T4_BAG", sellCity: "Martlock",
    sellQuality: null, sellSideOverride: true,
    // Flipping's inputCost IS r.buy.price — a per-unit buy price, so editable.
    editableInput: { itemId: "T4_BAG", city: "Bridgewatch" },
  },
  {
    // A flip the quality-aware router won at Good (js/render-flipping.js:328):
    // the board must key the same number under the same quality key its own
    // table does, and the Bid Age column must read that quality's book.
    tableId: "flipping-table", label: "quality trade",
    row: {
      item: { id: "T7_2H_SHAPESHIFTER_SET2", name: "Shapeshifter Staff" }, tier: 7,
      buy: { city: "Caerleon", price: 1000 },
      sell: { city: "Black Market", price: 12000 },
      marginInfo: margin(11000, 45), dailyVol: 10,
      quality: 2,
    },
    sellItemId: "T7_2H_SHAPESHIFTER_SET2", sellCity: "Black Market",
    sellQuality: 2, sellSideOverride: true,
    editableInput: { itemId: "T7_2H_SHAPESHIFTER_SET2", city: "Caerleon" },
  },
  {
    // Normal stays null on purpose: quality 1 IS the flat book, and publishing
    // it would retarget every flat-book consumer (overrides, dating) at the
    // usually-missing [1] shelf of the quality map.
    tableId: "flipping-table", label: "Normal-quality trade",
    row: {
      item: { id: "T5_BAG", name: "Bag" }, tier: 5,
      buy: { city: "Martlock", price: 500 },
      sell: { city: "Caerleon", price: 900 },
      marginInfo: margin(400, 30), dailyVol: 10,
      quality: 1,
    },
    sellItemId: "T5_BAG", sellCity: "Caerleon",
    sellQuality: null, sellSideOverride: true,
    editableInput: { itemId: "T5_BAG", city: "Martlock" },
  },
  {
    tableId: "crafting-table",                      // render-crafting.js:735
    row: {
      item: { id: "T6_BAG" }, craftCity: "Lymhurst",
      sellGear: { city: "Martlock", price: 5000 },
      totalInputCost: 3000, marginInfo: margin(1500), sellVol: 5,
      focusCost: 500, profitPer10kFocus: 30000,
    },
    sellItemId: "T6_BAG", sellCity: "Martlock",
    sellQuality: null, sellSideOverride: false,
  },
  {
    tableId: "transport-table",                     // render-transport.js:565
    row: {
      route: { refinedId: "T5_PLANKS", rawId: "T5_WOOD" },
      buyRaw: { city: "Fort Sterling" }, refineCity: "Fort Sterling",
      sellRefined: { city: "Martlock", price: 900 },
      totalRawCost: 500, marginInfo: margin(200, 20),
      focusCost: 100, profitPer10kFocus: 20000,
    },
    sellItemId: "T5_PLANKS", sellCity: "Martlock",
    sellQuality: null, sellSideOverride: false,
  },
  {
    tableId: "consumable-table",                    // render-consumables.js:689
    row: {
      item: { id: "T5_MEAL_STEW", name: "Stew" }, craftCity: "Martlock",
      buyMat: { city: "Martlock" }, sellPot: { city: "Caerleon", price: 800 },
      totalInputCost: 500, marginInfo: margin(250),
      focusCost: 80, profitPer10kFocus: 31000,
    },
    sellItemId: "T5_MEAL_STEW", sellCity: "Caerleon",
    sellQuality: null, sellSideOverride: false,
  },
  {
    tableId: "mounts-table",                        // render-mounts.js:757
    row: {
      item: { id: "T5_MOUNT_HORSE", name: "Horse" }, craftCity: "Martlock",
      sellPot: { city: "Caerleon", price: 200000 },
      totalInputCost: 100000, marginInfo: margin(50000),
      focusCost: 900, profitPer10kFocus: 550000, isBreeding: false,
    },
    sellItemId: "T5_MOUNT_HORSE", sellCity: "Caerleon",
    sellQuality: null, sellSideOverride: false,
  },
  {
    tableId: "farming-table",                       // render-farming.js:152
    row: {
      // item.id is the SEED; the crop that is sold is item.outputId.
      item: { id: "T5_CARROT_SEED", outputId: "T5_CARROT", name: "Carrot" },
      buySeed: { city: "Martlock" }, sellCrop: { city: "Martlock", price: 300 },
      totalInputCost: 100, marginInfo: margin(150),
    },
    sellItemId: "T5_CARROT", sellCity: "Martlock",
    sellQuality: null, sellSideOverride: false,
  },
  {
    tableId: "enchanting-table",                    // render-enchanting.js:194
    row: {
      item: { id: "T5_BAG", name: "Bag" }, targetId: "T5_BAG@2",
      sourceCity: "Martlock", sellCity: "Caerleon", sellPrice: 9000,
      totalInputCost: 5000, marginInfo: margin(2000), transitionLabel: ".1 → .2",
    },
    sellItemId: "T5_BAG@2", sellCity: "Caerleon",
    sellQuality: null, sellSideOverride: false, showCity: true,
  },
  {
    tableId: "transmute-table",                     // render-transmute.js:349
    row: {
      tier: 5, transition: { from: "Rune", to: "Soul" }, targetId: "T5_SOUL",
      buyCity: "Martlock", sellCity: "Caerleon", sellPrice: 400,
      totalInputCost: 200, marginInfo: margin(150),
    },
    sellItemId: "T5_SOUL", sellCity: "Caerleon",
    sellQuality: null, sellSideOverride: false, showCity: true,
  },
  {
    tableId: "rerolling-table",                     // render-rerolling.js:181
    row: {
      item: { id: "T5_BAG", name: "Bag" }, transition: { from: 1, to: 3 },
      transitionLabel: "Normal → Excellent",
      buyCity: "Martlock", sellCity: "Caerleon", sellPrice: 7000,
      totalInputCost: 4000, marginInfo: margin(2500),
    },
    sellItemId: "T5_BAG", sellCity: "Caerleon",
    sellQuality: 3, sellSideOverride: false, showCity: true,
  },
  {
    tableId: "rolling-table",                       // render-rolling.js:465
    row: {
      artId: "T5_ARTEFACT_CAPE", artName: "Cape", tier: 5, cat: "cape", rollType: "melt",
      fragBuyCity: "Caerleon", bestSellCity: "Martlock", bestSellPrice: 5000,
      sellRevenue: 6000, rollCostSilver: 3000, margin: 25,
    },
    sellItemId: "T5_ARTEFACT_CAPE", sellCity: "Martlock",
    sellQuality: null, sellSideOverride: false,
  },
  {
    tableId: "faction-spending-table",              // render-faction-spending.js:511
    row: {
      itemId: "T5_CREST", name: "Crest", tradeable: true, fpCost: 100,
      sellCity: "Martlock", sellPrice: 1000, netSilver: 900,
    },
    sellItemId: "T5_CREST", sellCity: "Martlock",
    sellQuality: null, sellSideOverride: false,
  },
  {
    tableId: "laborers-table",                      // render-laborers.js:494-500
    label: "trophy mode",
    row: {
      item: { id: "T5_LABORER", name: "Laborer" }, mode: "Trophy",
      trophyId: "T5_TROPHY_GENERAL",
      buy: { city: "Martlock", price: 1 }, sell: { city: "Martlock", price: 2000 },
      totalInputCost: 500, marginInfo: margin(300, 10),
    },
    sellItemId: "T5_TROPHY_GENERAL", sellCity: "Martlock",
    sellQuality: null, sellSideOverride: false,
  },
];

const normalizeOf = (c) => JOINED_SOURCES[c.tableId].normalize(c.row);

console.log("\n=== normalize() carries the item identity ===");

for (const c of CASES) {
  const label = c.label ? `${c.tableId} (${c.label})` : c.tableId;

  test(`${label} publishes the sell item id its own table keys on`, () => {
    assert.strictEqual(normalizeOf(c).sellItemId, c.sellItemId);
  });

  test(`${label} publishes the matching sell city`, () => {
    assert.strictEqual(normalizeOf(c).sellCity, c.sellCity);
  });

  test(`${label} publishes sellQuality=${c.sellQuality}`, () => {
    assert.strictEqual(normalizeOf(c).sellQuality ?? null, c.sellQuality);
  });

  test(`${label} publishes sellSideOverride=${c.sellSideOverride}`, () => {
    assert.strictEqual(!!normalizeOf(c).sellSideOverride, c.sellSideOverride);
  });
}

// Named lookups for the cases other tests spread or re-price. The array grew
// when the flipping source learned to publish a quality — positional indices
// would have silently repointed every one of these at the wrong feeder.
const craftingCase = () => CASES.find((c) => c.tableId === "crafting-table" && !c.label);
const transportCase = () => CASES.find((c) => c.tableId === "transport-table");

// The one place the sell number is NOT a per-unit market price: outside trophy
// mode a laborer's payload is a multi-item mix, and the feeder deliberately
// renders it as a plain per-cycle cell (render-laborers.js:496-500).
for (const mode of ["Resource", "Crafting", "Mercenary"]) {
  test(`laborers-table in ${mode} mode publishes NO sell item id`, () => {
    const row = { ...CASES[CASES.length - 1].row, mode, trophyId: null };
    assert.strictEqual(JOINED_SOURCES["laborers-table"].normalize(row).sellItemId, null);
  });
}

test("laborers-table in trophy mode but without a trophyId publishes no id", () => {
  const row = { ...CASES[CASES.length - 1].row, trophyId: null };
  assert.strictEqual(JOINED_SOURCES["laborers-table"].normalize(row).sellItemId, null);
});

// render-transport.js:565 keeps this fallback; the board must key identically.
test("transport-table falls back to rawId + '_refined' exactly as its own table does", () => {
  const row = { ...transportCase().row, route: { rawId: "T5_WOOD" } };
  assert.strictEqual(
    JOINED_SOURCES["transport-table"].normalize(row).sellItemId, "T5_WOOD_refined");
});

console.log("\n=== the Best Sell Price cell is editable ===");

for (const c of CASES) {
  const label = c.label ? `${c.tableId} (${c.label})` : c.tableId;

  test(`${label} renders a price-editable sell cell`, () => {
    priceTdCalls.length = 0;
    const html = formatJoinedRow(normalizeOf(c), 0);
    assert.ok(html.includes("price-editable"), "no editable cell rendered");
    assert.ok(html.includes(`data-item-id="${c.sellItemId}"`),
      `expected data-item-id="${c.sellItemId}"`);
    assert.ok(html.includes(`data-city="${c.sellCity}"`),
      `expected data-city="${c.sellCity}"`);
  });

  test(`${label} passes the sell side and its own flags to priceTd`, () => {
    priceTdCalls.length = 0;
    formatJoinedRow(normalizeOf(c), 0);
    const call = priceTdCalls.find((x) => x.itemId === c.sellItemId && x.side === "sell");
    assert.ok(call, "no sell-side priceTd call");
    assert.strictEqual(call.quality, c.sellQuality);
    assert.strictEqual(call.sideOverride, c.sellSideOverride);
    assert.strictEqual(call.note || "", "",
      "a note under the sell price is the Black Market board's ladder, not a feeder's");
    if (c.showCity) assert.strictEqual(call.showCity, true, "expected the (City) badge");
  });
}

test("the focus board renders the same editable sell cell", () => {
  const c = craftingCase(); // crafting — a focus feeder
  const html = formatJoinedFocusRow(normalizeOf(c), 0);
  assert.ok(html.includes("price-editable"));
  assert.ok(html.includes('data-item-id="T6_BAG"'));
});

test("rerolling's sell cell is quality-keyed", () => {
  const c = CASES.find((x) => x.tableId === "rerolling-table");
  assert.ok(formatJoinedRow(normalizeOf(c), 0).includes('data-quality="3"'));
});

console.log("\n=== an unpriced sell cell is still editable ===");

// The behaviour this section pins CHANGED: joinedSellCell used to gate priceTd
// on `sellPrice > 0`, so a board row whose feeder had no listing printed a dead
// number — the editor disappeared in the one case it exists for. `sellItemId`
// is the only opt-out now (a Laborers row outside trophy mode, asserted above).

test("sellPrice 0 with a sellItemId still renders a price-editable cell", () => {
  const c = CASES[0];
  const row = { ...normalizeOf(c), sellPrice: 0 };
  const html = formatJoinedRow(row, 0);
  assert.ok(html.includes("price-editable"), "the editor vanished at price 0");
  assert.ok(html.includes(`data-item-id="${c.sellItemId}"`), "wrong item key");
});

test("sellPrice 0 WITHOUT a sellItemId stays inert", () => {
  // Scoped to the sell side: this feeder's Input Cost is a per-unit buy price
  // and is editable in its own right.
  const row = { ...normalizeOf(craftingCase()), sellPrice: 0, sellItemId: null };
  assert.ok(!/data-city-list="sell"/.test(formatJoinedRow(row, 0)),
    "a row with no per-unit item must not offer an override key nothing reads");
});

test("a missing sell city falls back to a real one, never null", () => {
  const row = { ...normalizeOf(CASES[0]), sellPrice: 0, sellCity: null, buyCity: "Martlock" };
  const html = formatJoinedRow(row, 0);
  assert.ok(html.includes('data-city="Martlock"'),
    "expected the row's own buy city as the fallback");
  assert.ok(!html.includes('data-city="null"'), "editor would open on a city that does not exist");
});

test("with neither city known the sell cell still names some city", () => {
  const row = { ...normalizeOf(craftingCase()), sellPrice: 0, sellCity: null, buyCity: null };
  const html = formatJoinedRow(row, 0);
  const m = html.match(/data-city="([^"]*)"[^>]*data-city-list="sell"/);
  assert.ok(m, "no sell cell at all");
  assert.ok(m[1] !== "null" && m[1] !== "undefined" && m[1] !== "",
    `bad fallback city "${m[1]}"`);
});

test("a live price is untouched by the ungating", () => {
  const c = CASES[0];
  const html = formatJoinedRow(normalizeOf(c), 0);
  assert.ok(html.includes(`data-item-id="${c.sellItemId}"`));
  assert.ok(html.includes(`data-city="${c.sellCity}"`), "a priced row must keep its own city");
});

test("a laborers row outside trophy mode renders an INERT sell cell", () => {
  const row = { ...CASES[CASES.length - 1].row, mode: "Mercenary", trophyId: null };
  const html = formatJoinedRow(JOINED_SOURCES["laborers-table"].normalize(row), 0);
  assert.ok(!html.includes("price-editable"),
    "a per-cycle payload is not a per-unit price and must not be editable");
  assert.ok(html.includes("2,000"), "the number itself must still be shown");
});

test("a zero sell price is editable — that is the price the user came to set", () => {
  // Was the opposite assertion. A board row whose feeder has no listing is the
  // one row the override exists for, and priceTd already renders
  // "no data — click to set" at price 0.
  const row = { ...craftingCase().row, sellGear: { city: "Martlock", price: 0 } };
  const html = formatJoinedRow(JOINED_SOURCES["crafting-table"].normalize(row), 0);
  assert.ok(/data-city-list="sell"/.test(html), "the editor vanished at price 0");
  assert.ok(html.includes('data-item-id="T6_BAG"'), "wrong override key");
});

console.log("\n=== Input Cost: aggregates stay read-only ===");

// Ten of the twelve feeders publish a SUM here. Typing a per-unit price into it
// could only ever be wrong — see js/app.js aggregateCostTd.
for (const c of CASES.filter((x) => !x.editableInput && x.tableId !== "faction-spending-table")) {
  test(`${c.tableId} renders a NON-editable Input Cost`, () => {
    priceTdCalls.length = 0;
    formatJoinedRow(normalizeOf(c), 0);
    const buySide = priceTdCalls.filter((x) => x.side === "buy");
    assert.deepStrictEqual(buySide, [],
      `${c.tableId} must not route its aggregate cost through priceTd`);
  });

  test(`${c.tableId}'s Input Cost points at the Materials column`, () => {
    assert.ok(formatJoinedRow(normalizeOf(c), 0).includes("Materials column"),
      "expected aggregateCostTd's explanatory tooltip");
  });
}

test("flipping-table's Input Cost IS editable — it is a per-unit buy price", () => {
  const c = CASES[0];
  priceTdCalls.length = 0;
  const html = formatJoinedRow(normalizeOf(c), 0);
  const call = priceTdCalls.find((x) => x.side === "buy");
  assert.ok(call, "expected a buy-side priceTd call");
  assert.strictEqual(call.itemId, c.editableInput.itemId);
  assert.strictEqual(call.city, c.editableInput.city);
  assert.strictEqual(call.sideOverride, true, "the ⚡ must track the buy field, not the active pick");
  assert.ok(html.includes('data-city-list="buy"'));
});

test("faction spending still renders (FP), never a price cell", () => {
  const c = CASES.find((x) => x.tableId === "faction-spending-table");
  const html = formatJoinedRow(normalizeOf(c), 0);
  assert.ok(html.includes("(FP)"), "FP-gated input must stay labelled");
  assert.ok(!html.includes('data-city-list="buy"'), "there is no buy side to edit");
});

console.log("\n=== degrades without the editor ===");

test("with priceTd unavailable the cells render as plain silver, no throw", () => {
  const real = globalThis.priceTd;
  const realAgg = globalThis.aggregateCostTd;
  delete globalThis.priceTd;
  delete globalThis.aggregateCostTd;
  try {
    const html = formatJoinedRow(normalizeOf(CASES[0]), 0);
    assert.ok(html.includes("2,000"), "the sell price must still be shown");
    assert.ok(!html.includes("price-editable"));
  } finally {
    globalThis.priceTd = real;
    globalThis.aggregateCostTd = realAgg;
  }
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
