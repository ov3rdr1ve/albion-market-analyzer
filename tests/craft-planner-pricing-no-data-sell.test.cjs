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
 * Run: node --test tests/craft-planner-pricing-no-data-sell.test.cjs
 *
 * No-data reasons, quality references on no-sell rows, quality-tiered sell fallback, enchant acquisition route. Shared setup: tests/helpers/craft-planner-pricing-setup.cjs.
 */
const {
  assert, computeCraftPlannerRow, __setCrossRoute, __setForce, __setQualityMarketData, test,
  priceMap, FS, TABLE, TABLE_MATS, tableMarket, finish,
} = require("./helpers/craft-planner-pricing-setup.cjs");

// ── No-data reason: WHAT blocked the route ─────────────────────────────────
// A no-data candidate used to dead-end silently: the "other craft cities" block
// could not say WHY the Caerleon twin never priced, and the dedupe dropped it
// from the board entirely. The row now names its blocker — the materials with
// no quote in the craft city's zone pool, or the absence of any reachable sell
// market — so the alternatives block can print it
// (js/craft-planner-dedupe.js, js/render-craft-planner-paths.js).

// The real zone rule (js/utils.js isInvalidCrossRoute): the Black Market sits
// inside Caerleon; royal<->Caerleon legs need Black/Red Zone Routes on.
const REAL_CROSS_ROUTE = (bmrOn) => (buyCity, sellCity) => {
  if (!buyCity || !sellCity) return true;
  const eff = sellCity === "Black Market" ? "Caerleon" : sellCity;
  if (bmrOn) return false;
  if (buyCity !== "Caerleon" && eff === "Caerleon") return true;
  if (buyCity === "Caerleon" && eff !== "Caerleon") return true;
  return false;
};

test("an unpriced material names itself in noDataMats", () => {
  // Plank priced only in Fort Sterling (royal side); a Caerleon craft's buy
  // pool is {Caerleon}, so the plank has no quote there and the row dead-ends.
  __setCrossRoute(REAL_CROSS_ROUTE(false));
  const md = priceMap([
    { id: "T8_PLANKS", city: FS, buy: 1000 },
    { id: "T8_FURNITUREITEM_TABLE", city: "Caerleon", sell: 60000 },
  ]);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, md, "Caerleon");
  assert.ok(row.noData, "fixture sanity: expected the no-data branch");
  assert.deepStrictEqual(row.noDataMats, ["T8_PLANKS"]);
  assert.strictEqual(row.noDataNoSell, false);
  assert.strictEqual(row.refineCraftCost, undefined,
    "a missing-material row carries no cost — the sum is incomplete");
});

test("all materials priced but no reachable sell quotes: noDataNoSell that still carries its cost", () => {
  // The item sells only in Fort Sterling, unreachable from a Caerleon craft
  // with Black/Red Zone Routes off — so no honest sale exists. The input cost
  // is still fully computable (the fee model needs no product price), so the
  // row keeps its no-data markers AND carries refineCraftCost = inputCost:
  // no sell leg, so no sell travel on top of the material sum.
  __setCrossRoute(REAL_CROSS_ROUTE(false));
  const md = priceMap([
    { id: "T8_PLANKS", city: "Caerleon", buy: 1000 },
    { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 60000 },
  ]);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, md, "Caerleon");
  assert.ok(row.noData, "fixture sanity: expected the no-data branch");
  assert.deepStrictEqual(row.noDataMats, []);
  assert.strictEqual(row.noDataNoSell, true);
  // Self-documented arithmetic off the same fixture data: 30 planks at the
  // Caerleon bar (1,000), Caerleon's base craft return rate 0.18/(1+0.18)
  // hands that share back, market buys pay the 2.5% SETUP_FEE on the rest,
  // and the sandbox prices neither a station fee nor recipe silver.
  const craftRRR = 0.18 / (1 + 0.18);
  const effectiveUnits = 30 * (1 - craftRRR);
  const expectedCost = 1000 * effectiveUnits * (1 + 0.025);
  assert.strictEqual(typeof row.refineCraftCost, "number",
    "a fully-priced no-sell row must carry its computable input cost");
  assert.ok(Math.abs(row.refineCraftCost - expectedCost) < 1e-9,
    `expected ${expectedCost}, got ${row.refineCraftCost}`);
});

test("missing material price + no sell quote: no-data row carries no cost", () => {
  // Both sides dark, but the materials dead-end FIRST: an incomplete sum must
  // never display, so this row carries no refineCraftCost even though the sell
  // side is empty too — keeping the two no-data kinds distinguishable.
  __setCrossRoute(REAL_CROSS_ROUTE(false));
  const md = priceMap([
    { id: "T8_PLANKS", city: FS, buy: 1000 },                 // unreachable from Caerleon
    { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 60000 },  // …and so is the sale
  ]);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, md, "Caerleon");
  assert.ok(row.noData, "fixture sanity: expected the no-data branch");
  assert.deepStrictEqual(row.noDataMats, ["T8_PLANKS"]);
  assert.strictEqual(row.noDataNoSell, false);
  assert.strictEqual(row.refineCraftCost, undefined,
    "an incomplete material sum must not be carried, let alone displayed");
});

test("a priced row carries neither no-data marker", () => {
  __setCrossRoute(REAL_CROSS_ROUTE(false));
  const md = priceMap([
    { id: "T8_PLANKS", city: "Caerleon", buy: 1000 },
    { id: "T8_FURNITUREITEM_TABLE", city: "Caerleon", sell: 60000 },
  ]);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, md, "Caerleon");
  assert.ok(!row.noData);
  assert.strictEqual(row.noDataMats, undefined);
  assert.strictEqual(row.noDataNoSell, undefined);
});

// ── No-sell rows carry quality references (WHY the Sell cell is empty) ──────
// All materials priced but no reachable ask at ANY quality → the row stays
// noDataNoSell (a Good ask is not a Normal sale — documented, test-locked in
// tests/captured-buy-any-quality.test.cjs — but since the sell-fallback round
// below a Good+ ask PRICES the row, so a row still carrying references had no
// ask anywhere searched). The full quality book the renderer holds as the
// global lastQualityMarketData (map[itemId][quality][city]) can then still say
// WHY the cell is empty: a q1 buy order. The no-sell row carries those
// references, restricted to the SAME sell cities the sell loop just searched,
// so the Sell cell can explain itself (plan.md).

// A quality book for the fixture item. Keys are the game's quality ints
// 1..5; every cell carries both order books, as a real capture does.
function qualityBook(byQuality) {
  const book = {};
  for (const [q, cities] of Object.entries(byQuality)) {
    book[q] = {};
    for (const [city, cell] of Object.entries(cities)) {
      book[q][city] = { buy_price: cell.buy || 0, sell_price: cell.sell || 0 };
    }
  }
  return { T8_FURNITUREITEM_TABLE: book };
}

// The materials priced, the product with NO flat (quality-1) sell quote
// anywhere → the row can only dead-end on its sell side.
const noSellFlatMarket = () => priceMap([{ id: "T8_PLANKS", city: FS, buy: 1000 }]);

test("the plan's fixture PRICES now: the q3 ask wins and the references hint steps aside", () => {
  // The plan's fixture: Lymhurst has no Normal asks at all — a 1,070,000 buy
  // order at q1 and an Outstanding ask at 6,498,970. The fallback (below) prices
  // the row off that ask, so this is no longer a no-sell row: it must NOT carry
  // noSellRefs — the hint exists to explain an EMPTY cell, and a priced row's
  // cell is not empty.
  __setQualityMarketData(qualityBook({
    1: { Lymhurst: { buy: 1070000 } },
    3: { Lymhurst: { sell: 6498970 } },
  }));
  try {
    const row = computeCraftPlannerRow(TABLE, TABLE_MATS, noSellFlatMarket(), FS);
    assert.ok(!row.noData, "the Outstanding ask in a searched city prices the row");
    assert.strictEqual(row.sellCity, "Lymhurst");
    assert.strictEqual(row.sellPrice, 6498970);
    assert.strictEqual(row.sellQuality, 3);
    assert.strictEqual(row.noSellRefs, undefined,
      "a priced row carries no references — the hint is a no-data-only feature");
  } finally { __setQualityMarketData({}); }
});

test("within one quality tier the best MARGIN wins, not the cheapest ask", () => {
  // An Excellent ask in Lymhurst and a far cheaper Excellent ask in
  // Bridgewatch: both cities sit in the SAME tier (4 — the lowest quality with
  // an ask anywhere), so within the tier the cities compete on margin like any
  // other pair — the dearer Lymhurst ask (6,398,972 × 0.935 = 5,983,038.82)
  // beats Bridgewatch's 900,000 × 0.935 = 841,500 even though Bridgewatch
  // quotes less. (Had Bridgewatch's ask been a q2, its tier would win outright
  // instead — the tier decides before the margin does.)
  __setQualityMarketData(qualityBook({
    4: { Lymhurst: { sell: 6398972 }, Bridgewatch: { sell: 900000 } },
  }));
  try {
    const row = computeCraftPlannerRow(TABLE, TABLE_MATS, noSellFlatMarket(), FS);
    assert.ok(!row.noData, "a Good+ ask in a searched city prices the row");
    assert.strictEqual(row.sellCity, "Lymhurst", "the higher net margin wins within the tier");
    assert.strictEqual(row.sellPrice, 6398972);
    assert.strictEqual(row.sellQuality, 4);
    assert.strictEqual(typeof row.sellQuality, "number", "the quality is an integer tag");
  } finally { __setQualityMarketData({}); }
});

test("quality references outside the searched sell cities are ignored", () => {
  // The sell pin narrows the sell search to Fort Sterling; the quality book
  // only has Lymhurst data — a market the row never searched is not a
  // reference. Both fields null → the key is omitted entirely.
  __setForce({ T8_FURNITUREITEM_TABLE: { sell: FS } });
  __setQualityMarketData(qualityBook({
    1: { Lymhurst: { buy: 1070000 } },
    3: { Lymhurst: { sell: 6498970 } },
  }));
  try {
    const row = computeCraftPlannerRow(TABLE, TABLE_MATS, noSellFlatMarket(), FS);
    assert.ok(row.noData && row.noDataNoSell, "fixture sanity: expected the no-sell branch");
    assert.strictEqual(row.noSellRefs, undefined,
      "both references null → no noSellRefs key at all");
  } finally { __setQualityMarketData({}); __setForce({}); }
});

test("an all-empty quality book carries no noSellRefs key at all", () => {
  __setQualityMarketData({});
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, noSellFlatMarket(), FS);
  assert.ok(row.noData && row.noDataNoSell, "fixture sanity: expected the no-sell branch");
  assert.strictEqual(row.noSellRefs, undefined,
    "an empty book says nothing, so the row shape is exactly today's");
});

test("missing-material no-data row: no cost AND no quality references", () => {
  // The missing-material branch returns before any sell logic runs, so even a
  // populated quality book in a searchable city must not put references on an
  // incomplete row — keeping the two no-data kinds distinguishable.
  __setCrossRoute(REAL_CROSS_ROUTE(false));
  __setQualityMarketData(qualityBook({
    1: { Caerleon: { buy: 1070000 } },
    3: { Caerleon: { sell: 6498970 } },
  }));
  try {
    const md = priceMap([
      { id: "T8_PLANKS", city: FS, buy: 1000 },                 // unreachable from Caerleon
      { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 60000 },  // …and so is the sale
    ]);
    const row = computeCraftPlannerRow(TABLE, TABLE_MATS, md, "Caerleon");
    assert.ok(row.noData, "fixture sanity: expected a no-data row");
    assert.strictEqual(row.noDataNoSell, false);
    assert.strictEqual(row.refineCraftCost, undefined,
      "an incomplete material sum must not be carried");
    assert.strictEqual(row.noSellRefs, undefined,
      "no references on an incomplete row either");
  } finally { __setQualityMarketData({}); __setCrossRoute(null); }
});

// ── Sell pricing falls back to any available quality ask, TIERED (plan.md) ──
// The sell loop prices a city by its Normal (q1) ask, or — when that city has
// none — by its cheapest Good+ ask (q2-5). Selection is TIERED: tier 1 is the
// cities with a real Normal ask, and if ANY exist the winner is the best margin
// among tier 1 alone (sellQuality null) — a dearer Good+ ask in another city
// never competes. Only when NO searched city has a Normal ask does the fallback
// choose the LOWEST quality q in 2..5 with an ask anywhere (the tier) and pick
// the best margin WITHIN that tier, tagging the row `sellQuality: q`; higher
// tiers never compete with lower ones. getSellPrice itself stays quality-1
// pure — the tiering lives only in this planner's sell loop.

test("no Normal ask anywhere: a q3 ask in Lymhurst PRICES the row (the plan's fixture)", () => {
  // Flat book: the product has no q1 ask in any city (only the material is
  // priced). The quality book holds Lymhurst's 1,070,000 q1 BUY order and its
  // 6,498,970 Outstanding ask — the ask is a real sale, so the row prices.
  __setQualityMarketData(qualityBook({
    1: { Lymhurst: { buy: 1070000 } },
    3: { Lymhurst: { sell: 6498970 } },
  }));
  try {
    const row = computeCraftPlannerRow(TABLE, TABLE_MATS, noSellFlatMarket(), FS);
    assert.ok(!row.noData, "an Outstanding ask in a searched city must price the row");
    assert.strictEqual(row.sellCity, "Lymhurst");
    assert.strictEqual(row.sellPrice, 6498970);
    assert.strictEqual(row.sellQuality, 3);
    // The priced-row cost basis, from the fixture alone: 30 planks at the
    // 1,000 bar, the base craft RRR 0.18/(1+0.18) handing that share back,
    // +2.5% setup on the rest — plus the sell-travel leg (0 in this sandbox:
    // it defines no legBrecilienCost, so every priced row adds no travel).
    const craftRRR = 0.18 / (1 + 0.18);
    const sellTravel = 0;
    const expectedCost = 1000 * 30 * (1 - craftRRR) * (1 + 0.025) + sellTravel;
    assert.ok(Math.abs(row.refineCraftCost - expectedCost) < 1e-9,
      `expected ${expectedCost}, got ${row.refineCraftCost}`);
    // No journal is priced in this market, so the combined figure is the bare
    // craft: the sale after the 6.5% tax minus that cost.
    assert.ok(Math.abs(row.combinedProfit - (6498970 * (1 - 0.065) - expectedCost)) < 0.01,
      `expected ${6498970 * (1 - 0.065) - expectedCost}, got ${row.combinedProfit}`);
  } finally { __setQualityMarketData({}); }
});

test("one city, several Good+ asks: the MINIMUM ask prices the row", () => {
  __setQualityMarketData(qualityBook({
    4: { Lymhurst: { sell: 5000000 } },
    2: { Lymhurst: { sell: 7000000 } },
  }));
  try {
    const row = computeCraftPlannerRow(TABLE, TABLE_MATS, noSellFlatMarket(), FS);
    assert.ok(!row.noData, "a Good+ ask in a searched city must price the row");
    assert.strictEqual(row.sellCity, "Lymhurst");
    assert.strictEqual(row.sellPrice, 5000000, "the cheapest ask across q2-5 wins");
    assert.strictEqual(row.sellQuality, 4);
  } finally { __setQualityMarketData({}); }
});

test("a real Normal ask anywhere beats a higher-quality ask anywhere", () => {
  // Fort Sterling has a real Normal ask at 8,000,000; Lymhurst only an
  // Excellent ask at 12,000,000. The sandbox defines no sell travel, so raw
  // margins would be ask × (1 − 0.065): 7,480,000 vs 11,220,000 — but tiers
  // decide first: tier 1 (the Normal-ask cities) is non-empty, so Lymhurst's
  // dearer Excellent ask never competes and Fort Sterling wins outright.
  const md = priceMap([
    { id: "T8_PLANKS", city: FS, buy: 1000 },
    { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 8000000 },
  ]);
  __setQualityMarketData(qualityBook({ 4: { Lymhurst: { sell: 12000000 } } }));
  try {
    const row = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
    assert.ok(!row.noData);
    assert.strictEqual(row.sellCity, FS, "tier 1 alone: the Normal-ask city wins");
    assert.strictEqual(row.sellPrice, 8000000);
    assert.ok(!row.sellQuality, "a Normal-ask sale carries no quality (null/absent)");
  } finally { __setQualityMarketData({}); }
});

test("the Stalker Hood shape: a flat Normal ask beats a Masterpiece ask elsewhere", () => {
  // The reported bug's exact shape: Lymhurst quotes a real Normal ask at 3,393
  // (flat book) while another searched city only has a Masterpiece ask at
  // 25,000 (quality book). Masterpiece nets 23,375 vs Normal's 3,172.46, so on
  // raw margin the Masterpiece city used to win the row; tier 1 exists, so
  // Lymhurst wins and the sale stays quality-less.
  const md = priceMap([
    { id: "T8_PLANKS", city: FS, buy: 1000 },
    { id: "T8_FURNITUREITEM_TABLE", city: "Lymhurst", sell: 3393 },
  ]);
  __setQualityMarketData(qualityBook({ 5: { Bridgewatch: { sell: 25000 } } }));
  try {
    const row = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
    assert.ok(!row.noData);
    assert.strictEqual(row.sellCity, "Lymhurst", "tier 1 alone: the Normal-ask city wins");
    assert.strictEqual(row.sellPrice, 3393);
    assert.ok(!row.sellQuality, "a Normal-ask sale carries no quality (null/absent)");
  } finally { __setQualityMarketData({}); }
});

test("no Normal ask anywhere: the LOWEST quality tier wins — q3 beats a richer q5", () => {
  // No Normal ask exists in any searched city. Lymhurst offers an Outstanding
  // ask at 6,498,970 and Bridgewatch a Masterpiece ask at 14,999,497 — the
  // Masterpiece would net 14,024,529.70 vs Outstanding's 6,076,536.95, but the
  // tier is the LOWEST quality with an ask anywhere (3): higher tiers never
  // compete with lower ones, so the Elder's Shadowcaller shape keeps selling at
  // the Outstanding ask even though the Masterpiece pays better.
  __setQualityMarketData(qualityBook({
    3: { Lymhurst: { sell: 6498970 } },
    5: { Bridgewatch: { sell: 14999497 } },
  }));
  try {
    const row = computeCraftPlannerRow(TABLE, TABLE_MATS, noSellFlatMarket(), FS);
    assert.ok(!row.noData, "a Good+ ask in a searched city prices the row");
    assert.strictEqual(row.sellCity, "Lymhurst", "the lowest quality tier wins outright");
    assert.strictEqual(row.sellPrice, 6498970);
    assert.strictEqual(row.sellQuality, 3);
  } finally { __setQualityMarketData({}); }
});

test("a better Normal ask still beats a fallback city — and stays quality-less", () => {
  // Same tiering as the case above, with the margins agreeing: Fort Sterling's
  // Normal ask also pays more (12,000,000 × 0.935 vs Lymhurst's 8,000,000 ×
  // 0.935), so the row sells there and must carry NO quality — a fallback that
  // exists but loses never tags the row.
  const md = priceMap([
    { id: "T8_PLANKS", city: FS, buy: 1000 },
    { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 12000000 },
  ]);
  __setQualityMarketData(qualityBook({ 4: { Lymhurst: { sell: 8000000 } } }));
  try {
    const row = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
    assert.ok(!row.noData);
    assert.strictEqual(row.sellCity, FS);
    assert.strictEqual(row.sellPrice, 12000000);
    assert.ok(!row.sellQuality, "a Normal-ask sale carries no quality (null/absent)");
  } finally { __setQualityMarketData({}); }
});

test("a plain Normal-ask row is untouched: same fields, no quality", () => {
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, tableMarket(), FS);
  assert.ok(!row.noData);
  assert.strictEqual(row.sellCity, FS);
  assert.strictEqual(row.sellPrice, 60000);
  assert.ok(!row.sellQuality, "no quality book in play → no quality on the row");
  assert.ok(Math.abs(row.combinedProfit - (row.craftProfit + row.journal.extraSilverPerCraft)) < 0.01);
});

test("no ask at ANY quality anywhere: still the no-sell row with cost + references", () => {
  // A 1,070,000 q1 BUY order is not an ask — with no q2-5 ask in any searched
  // city the row keeps every marker the previous rounds gave it: noDataNoSell,
  // its computable input cost (no sale → no travel leg on top), and the
  // noSellRefs that explain the empty Sell cell.
  __setQualityMarketData(qualityBook({ 1: { Lymhurst: { buy: 1070000 } } }));
  try {
    const row = computeCraftPlannerRow(TABLE, TABLE_MATS, noSellFlatMarket(), FS);
    assert.ok(row.noData && row.noDataNoSell, "a buy order alone never prices a row");
    const craftRRR = 0.18 / (1 + 0.18);
    const expectedCost = 1000 * 30 * (1 - craftRRR) * (1 + 0.025);
    assert.ok(Math.abs(row.refineCraftCost - expectedCost) < 1e-9,
      `expected ${expectedCost}, got ${row.refineCraftCost}`);
    assert.deepStrictEqual(row.noSellRefs.normalBuy, { price: 1070000, city: "Lymhurst" });
    assert.strictEqual(row.noSellRefs.higherAsk, null);
  } finally { __setQualityMarketData({}); }
});

// ── Enchant acquisition route (js/craft-planner-enchant-route.js) ──────────
// A .1-.3 equipment row can also be acquired by BUYING the @(n-1) item and
// enchanting it up (base + rune/soul/relic × slot count, both × (1+SETUP_FEE)).
// Full gating/city-pick coverage: tests/craft-planner-enchant-route.test.cjs.
console.log("\n=== Enchant acquisition route ===");

const SWORD1 = { id: "T5_MAIN_SWORD@1", name: "Adept's Sword", craftType: "sword" };
const enchMarket = (runeBuy) => priceMap([
  { id: "T5_METALBAR@1", city: FS, buy: 9000 },
  { id: "T5_MAIN_SWORD@1", city: FS, sell: 50000 },
  { id: "T5_MAIN_SWORD", city: FS, buy: 1000 },
  { id: "T5_RUNE", city: FS, buy: runeBuy },
]);

test("enchant wins: input cost is the enchant cost, journal/refine/focus zeroed", () => {
  const row = computeCraftPlannerRow(SWORD1, [{ matId: "T5_METALBAR@1", count: 16 }],
    enchMarket(100), FS);
  const cost = (1000 + 288 * 100) * 1.025;
  assert.ok(row.enchantedVia, "expected the enchant route to win");
  assert.ok(Math.abs(row.refineCraftCost - cost) < 1e-9);
  assert.strictEqual(row.refineSavings, 0);
  assert.strictEqual(row.journal, null);
  assert.strictEqual(row.laborerJournal, null);
  assert.strictEqual(row.bestFocusStep, null);
  assert.strictEqual(row.focusPerCraft, 0);
  assert.strictEqual(row.profitPer10kFocus, null);
});

test("enchant loses: the row is byte-identical to no route at all", () => {
  const args = [SWORD1, [{ matId: "T5_METALBAR@1", count: 16 }]];
  const dear = computeCraftPlannerRow(...args, enchMarket(9000), FS);
  const none = computeCraftPlannerRow(...args, priceMap([
    { id: "T5_METALBAR@1", city: FS, buy: 9000 },
    { id: "T5_MAIN_SWORD@1", city: FS, sell: 50000 },
  ]), FS);
  assert.strictEqual(dear.enchantedVia, undefined);
  assert.strictEqual(JSON.stringify(dear), JSON.stringify(none));
});

finish();
