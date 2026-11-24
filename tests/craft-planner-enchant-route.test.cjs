/**
 * Test: the Crafting Planner's enchant acquisition route (js/craft-planner-enchant-route.js).
 *
 * An @n enchanted equipment item (n=1..3) can be obtained two ways: craft it
 * from enchanted resources (what the planner always did), or BUY the @(n-1)
 * item and enchant it up at a crafting station, consuming a fixed rune/soul/
 * relic count by slot (twohand 384, onehand 288, armor 192, small 96). .3→.4
 * does not exist, so @4 rows never get the route.
 *
 * Economics mirror js/render-enchanting.js:43-78:
 *   cost = buyPrice(@(n-1)) × (1 + SETUP_FEE)
 *        + slotCount × buyPrice(rune/soul/relic) × (1 + SETUP_FEE)
 * with no station fee, no RRR return and no journal fill — those are craft-route
 * concepts. Buy-city selection mirrors the planner's material sourcing: the
 * cheapest priced city in the row's buy-city scope (table Buy-City pick), a
 * city force honored when it is in that scope, and both buy legs must pass
 * isInvalidCrossRoute against the row's chosen sell city.
 *
 * Black-box: the REAL modules over synthetic prices in the shared pricing
 * sandbox. No live API or DB.
 *
 * Run: node tests/craft-planner-enchant-route.test.cjs
 */

const assert = require("assert");
const M = require("./helpers/craft-planner-pricing-harness.cjs");
const {
  computeCraftPlannerRow, computeEnchantAcquisition,
  getEnchantedItemId, getEnchantMatId,
  __setOverrides, __setForce, __setCrossRoute, __reset,
  setTableBuyCity,
} = M;

let passed = 0, failed = 0;
function test(name, fn) {
  try { __reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

function priceMap(entries) {
  const out = {};
  for (const e of entries) {
    if (!out[e.id]) out[e.id] = {};
    out[e.id][e.city || "Fort Sterling"] = { buy_price: e.buy || 0, sell_price: e.sell || 0, volume_24h: 9999 };
  }
  return out;
}

const FS = "Fort Sterling";
const SWORD1 = { id: "T5_MAIN_SWORD@1", name: "Adept's Sword", craftType: "sword" };
const BOW3 = { id: "T6_2H_BOW@3", name: "Elder's Bow", craftType: "bow" };

// ── Gating: which rows get the route at all ─────────────────────────────────
console.log("\n=== Route gating ===");

test("a .0 base row gets no enchant route", () => {
  const md = priceMap([{ id: "T5_MAIN_SWORD", buy: 100 }, { id: "T5_RUNE", buy: 10 }]);
  assert.strictEqual(computeEnchantAcquisition({ id: "T5_MAIN_SWORD" }, md, {}), null);
});

test("a @4 row gets no route (.3→.4 does not exist)", () => {
  const md = priceMap([
    { id: "T5_MAIN_SWORD@3", buy: 100 }, { id: "T5_RUNE", buy: 10 },
    { id: "T5_SOUL", buy: 10 }, { id: "T5_RELIC", buy: 10 },
  ]);
  assert.strictEqual(computeEnchantAcquisition({ id: "T5_MAIN_SWORD@4" }, md, {}), null);
});

test("a non-equipment row (furniture) gets no route", () => {
  const md = priceMap([
    { id: "T6_FURNITUREITEM_CHEST", buy: 100 }, { id: "T6_RUNE", buy: 10 },
  ]);
  assert.strictEqual(computeEnchantAcquisition({ id: "T6_FURNITUREITEM_CHEST@1" }, md, {}), null);
});

test("an unpriced @(n-1) base → route unavailable", () => {
  const md = priceMap([{ id: "T5_RUNE", buy: 10 }]);
  assert.strictEqual(computeEnchantAcquisition(SWORD1, md, {}), null);
});

test("an unpriced enchant mat → route unavailable", () => {
  const md = priceMap([{ id: "T5_MAIN_SWORD", buy: 100 }]);
  assert.strictEqual(computeEnchantAcquisition(SWORD1, md, {}), null);
});

// ── Economics ───────────────────────────────────────────────────────────────
console.log("\n=== Cost formula ===");

test("cost = base×(1+fee) + slotCount×mat×(1+fee), onehand 288", () => {
  const md = priceMap([{ id: "T5_MAIN_SWORD", buy: 1000 }, { id: "T5_RUNE", buy: 100 }]);
  const r = computeEnchantAcquisition(SWORD1, md, {});
  assert.ok(r, "route should exist");
  assert.strictEqual(r.baseId, "T5_MAIN_SWORD");
  assert.strictEqual(r.matId, "T5_RUNE");
  assert.strictEqual(r.matCount, 288);
  const expected = (1000 + 288 * 100) * 1.025;
  assert.ok(Math.abs(r.cost - expected) < 1e-9, `expected ${expected}, got ${r.cost}`);
});

const SLOT_CASES = [
  // [item id @1, slot count] — twohand 384, onehand 288, armor 192, small 96
  ["T6_2H_BOW@1", "T6_RUNE", 384],
  ["T5_MAIN_DAGGER@1", "T5_RUNE", 288],
  ["T5_ARMOR_LEATHER_SET1@1", "T5_RUNE", 192],
  ["T5_HEAD_CLOTH_SET1@1", "T5_RUNE", 96],
  ["T5_OFF_SHIELD@1", "T5_RUNE", 96],
  ["T5_BAG@1", "T5_RUNE", 192],
];
SLOT_CASES.forEach(([id, matId, count]) => {
  test(`mat count by slot: ${id} → ${count}`, () => {
    const md = priceMap([{ id: getEnchantedItemId(id, 0), buy: 1 }, { id: matId, buy: 1 }]);
    const r = computeEnchantAcquisition({ id }, md, {});
    assert.ok(r, "route should exist");
    assert.strictEqual(r.matId, matId);
    assert.strictEqual(r.matCount, count);
  });
});

test("the .2→.3 step buys the @(n-1) item and a RELIC", () => {
  const md = priceMap([{ id: "T6_2H_BOW@2", buy: 5000 }, { id: "T6_RELIC", buy: 2000 }]);
  const r = computeEnchantAcquisition(BOW3, md, {});
  assert.strictEqual(r.baseId, "T6_2H_BOW@2");
  assert.strictEqual(r.matId, getEnchantMatId(6, "RELIC"));
  assert.strictEqual(r.matCount, 384);
  assert.ok(Math.abs(r.cost - (5000 + 384 * 2000) * 1.025) < 1e-9);
});

// ── The rune/soul/relic leg may be transmuted up ────────────────────────────
console.log("\n=== Transmuted enchant mat ===");

const SOUL_RELIC_T6 = M.TRANSMUTE_SILVER_COST.SOUL_RELIC[6];

test("a dear Relic is reached from a cheaper Soul: cost bills setup on the bought part only", () => {
  const md = priceMap([
    { id: "T6_2H_BOW@2", buy: 5000 },
    { id: "T6_RELIC", buy: 90_000 },
    { id: "T6_SOUL", buy: 1000 },
  ]);
  const r = computeEnchantAcquisition(BOW3, md, {});
  assert.ok(r, "route should exist");
  assert.strictEqual(r.matId, "T6_RELIC", "the enchant still consumes relics");
  assert.strictEqual(r.matCity, FS);
  assert.strictEqual(r.matPrice, 1000, "matPrice is the bought Soul");
  assert.ok(r.matSourcing, "matSourcing must carry the route");
  assert.strictEqual(r.matSourcing.buyId, "T6_SOUL");
  const expected = (5000 + 384 * 1000) * 1.025 + 384 * SOUL_RELIC_T6;
  assert.ok(Math.abs(r.cost - expected) < 1e-6, `expected ${expected}, got ${r.cost}`);
});

test("a straight market mat carries no matSourcing", () => {
  const md = priceMap([{ id: "T6_2H_BOW@2", buy: 5000 }, { id: "T6_RELIC", buy: 2000 }, { id: "T6_SOUL", buy: 1900 }]);
  const r = computeEnchantAcquisition(BOW3, md, {});
  assert.strictEqual(r.matSourcing, undefined);
  assert.strictEqual(r.matPrice, 2000);
});

test("a Relic nobody lists can still be reached by transmute", () => {
  const md = priceMap([{ id: "T6_2H_BOW@2", buy: 5000 }, { id: "T6_SOUL", buy: 1000 }]);
  const r = computeEnchantAcquisition(BOW3, md, {});
  assert.ok(r && r.matSourcing, "route via transmute expected");
  assert.strictEqual(r.matSourcing.buyId, "T6_SOUL");
});

test("an override on the bought Soul marks the row for the overrides-only filter", () => {
  const BOW3_MATS = [{ matId: "T6_PLANKS@3", count: 20 }];
  const md = priceMap([
    // Crafting from .3 planks (20 × 1M) must lose to base + 384 transmuted relics (~4.8M).
    { id: "T6_PLANKS@3", buy: 1_000_000 },
    { id: "T6_2H_BOW@3", sell: 9_000_000 },
    { id: "T6_2H_BOW@2", buy: 5000 },
    { id: "T6_RELIC", buy: 90_000 },
  ]);
  __setOverrides({ "T6_SOUL:Fort Sterling": 1000 });
  const row = computeCraftPlannerRow(BOW3, BOW3_MATS, md, FS);
  assert.ok(row.enchantedVia && row.enchantedVia.matSourcing, "fixture: transmuted enchant must win");
  assert.strictEqual(row.hasOverride, true);
});

console.log("\n=== Buy-city selection ===");

test("cheapest priced city wins for both legs", () => {
  const md = priceMap([
    { id: "T5_MAIN_SWORD", city: "Caerleon", buy: 1200 },
    { id: "T5_MAIN_SWORD", city: FS, buy: 1000 },
    { id: "T5_MAIN_SWORD", city: "Lymhurst", buy: 1100 },
    { id: "T5_RUNE", city: "Caerleon", buy: 90 },
    { id: "T5_RUNE", city: "Lymhurst", buy: 80 },
    // FS rune unpriced → mat leg must land on Lymhurst, not FS
  ]);
  const r = computeEnchantAcquisition(SWORD1, md, {});
  assert.strictEqual(r.baseCity, FS);
  assert.strictEqual(r.basePrice, 1000);
  assert.strictEqual(r.matCity, "Lymhurst");
  assert.strictEqual(r.matPrice, 80);
});

test("a city force on the base is honored even when dearer (in scope)", () => {
  const md = priceMap([
    { id: "T5_MAIN_SWORD", city: "Caerleon", buy: 1200 },
    { id: "T5_MAIN_SWORD", city: FS, buy: 9999 },
    { id: "T5_RUNE", city: FS, buy: 10 },
  ]);
  __setForce({ "T5_MAIN_SWORD": { buy: "Caerleon" } });
  const r = computeEnchantAcquisition(SWORD1, md, {});
  assert.strictEqual(r.baseCity, "Caerleon");
  assert.strictEqual(r.basePrice, 1200);
});

test("a city force on the mat leg is honored too", () => {
  const md = priceMap([
    { id: "T5_MAIN_SWORD", city: FS, buy: 100 },
    { id: "T5_RUNE", city: "Caerleon", buy: 50 },
    { id: "T5_RUNE", city: FS, buy: 500 },
  ]);
  __setForce({ "T5_RUNE": { buy: FS } });
  const r = computeEnchantAcquisition(SWORD1, md, {});
  assert.strictEqual(r.matCity, FS);
  assert.strictEqual(r.matPrice, 500);
});

test("a force onto an unpriced city kills the leg — force means source it THERE", () => {
  const md = priceMap([
    { id: "T5_MAIN_SWORD", city: FS, buy: 100 },
    { id: "T5_RUNE", city: "Caerleon", buy: 50 },
  ]);
  __setForce({ "T5_RUNE": { buy: FS } });
  assert.strictEqual(computeEnchantAcquisition(SWORD1, md, {}), null);
});

test("a price override counts as a price at that city", () => {
  const md = priceMap([{ id: "T5_RUNE", buy: 1 }]);
  __setOverrides({ "T5_MAIN_SWORD:Bridgewatch": 700 });
  const r = computeEnchantAcquisition(SWORD1, md, {});
  assert.strictEqual(r.baseCity, "Bridgewatch");
  assert.strictEqual(r.basePrice, 700);
});

// ── Buy-city scope mirrors the planner's material sourcing ──────────────────
console.log("\n=== Buy-city scope (table Buy-City pick) ===");

test("a Buy-City pick narrows both legs to that city", () => {
  const md = priceMap([
    { id: "T5_MAIN_SWORD", city: "Caerleon", buy: 1000 },  // cheaper, but not picked
    { id: "T5_MAIN_SWORD", city: FS, buy: 1500 },
    { id: "T5_RUNE", city: "Caerleon", buy: 50 },
  ]);
  setTableBuyCity("craft-planner-table", FS);
  // The rune is unpriced at the picked city → that leg is dead → no route
  // (an empty pool never falls back to a city the pick did not name).
  assert.strictEqual(computeEnchantAcquisition(SWORD1, md, { craftCity: FS }), null);
  const r = computeEnchantAcquisition(SWORD1, priceMap([
    { id: "T5_MAIN_SWORD", city: "Caerleon", buy: 1000 },
    { id: "T5_MAIN_SWORD", city: FS, buy: 1500 },
    { id: "T5_RUNE", city: FS, buy: 50 },
  ]), { craftCity: FS });
  assert.strictEqual(r.baseCity, FS, "the pick excludes the cheaper Caerleon base");
  assert.strictEqual(r.matCity, FS);
});

// ── Cross-route validity against the row's sell city ────────────────────────
console.log("\n=== Cross-route exclusion ===");

// The real zone rule (js/utils.js): the Black Market is sellable from Caerleon
// alone; royal<->Caerleon hauling needs Black/Red Zone Routes on.
const REAL_CROSS_ROUTE = (bmrOn) => (buyCity, sellCity) => {
  if (!buyCity || !sellCity) return true;
  const eff = sellCity === "Black Market" ? "Caerleon" : sellCity;
  if (bmrOn) return false;
  if (buyCity !== "Caerleon" && eff === "Caerleon") return true;
  if (buyCity === "Caerleon" && eff !== "Caerleon") return true;
  return false;
};

test("a sell city unreachable from the cheapest buy city is skipped", () => {
  __setCrossRoute(REAL_CROSS_ROUTE(false));
  const md = priceMap([
    { id: "T5_MAIN_SWORD", city: FS, buy: 1000 },        // royal, cannot feed a BM sale
    { id: "T5_MAIN_SWORD", city: "Caerleon", buy: 1200 },
    { id: "T5_RUNE", city: "Caerleon", buy: 50 },
  ]);
  const r = computeEnchantAcquisition(SWORD1, md, { sellCity: "Black Market" });
  assert.strictEqual(r.baseCity, "Caerleon", "the royal city must be excluded");
  assert.strictEqual(r.basePrice, 1200);
});

test("no city survives the cross-route filter → route unavailable", () => {
  __setCrossRoute(REAL_CROSS_ROUTE(false));
  const md = priceMap([
    { id: "T5_MAIN_SWORD", city: FS, buy: 1000 },
    { id: "T5_RUNE", city: FS, buy: 50 },
  ]);
  assert.strictEqual(
    computeEnchantAcquisition(SWORD1, md, { sellCity: "Black Market" }), null);
});

// ── Row integration: enchant wins / loses ───────────────────────────────────
console.log("\n=== Row integration (computeCraftPlannerRow) ===");

const SWORD1_MATS = [{ matId: "T5_METALBAR@1", count: 16 }];
const SELL = 50_000;

// Craft route: buy the enchanted bar dear. Enchant route: base + rune cheap.
function swordMarket(extra = []) {
  return priceMap([
    { id: "T5_METALBAR@1", buy: 9000 },
    { id: "T5_MAIN_SWORD@1", sell: SELL },
    ...extra,
  ]);
}
const ENCHANT_LEGS = [
  { id: "T5_MAIN_SWORD", buy: 1000 },
  { id: "T5_RUNE", buy: 100 },
];
const ENCHANT_COST = (1000 + 288 * 100) * 1.025;

test("cheap runes → the row is booked as bought-then-enchanted", () => {
  const row = computeCraftPlannerRow(SWORD1, SWORD1_MATS, swordMarket(ENCHANT_LEGS), FS);
  assert.ok(!row.noData);
  assert.ok(row.enchantedVia, "expected enchantedVia");
  assert.deepStrictEqual(row.enchantedVia, {
    baseId: "T5_MAIN_SWORD", baseCity: FS, basePrice: 1000,
    matId: "T5_RUNE", matCount: 288, matCity: FS, matPrice: 100,
    cost: ENCHANT_COST,
  });
  // Input cost follows the enchant cost; profit formula unchanged.
  assert.ok(Math.abs(row.refineCraftCost - ENCHANT_COST) < 1e-9);
  assert.ok(Math.abs(row.craftProfit - (SELL * (1 - 0.065) - ENCHANT_COST)) < 1e-9);
});

test("enchant-wins rows zero every craft-route extra (journal, laborer, focus, savings)", () => {
  const md = swordMarket([
    ...ENCHANT_LEGS,
    { id: "T5_JOURNAL_WARRIOR_EMPTY", buy: 4000 },
    { id: "T5_JOURNAL_WARRIOR_FULL", sell: 18000 },
  ]);
  const row = computeCraftPlannerRow(SWORD1, SWORD1_MATS, md, FS);
  assert.ok(row.enchantedVia, "fixture sanity: enchant must win here");
  assert.strictEqual(row.refineSavings, 0);
  assert.strictEqual(row.journal, null);
  assert.strictEqual(row.laborerJournal, null);
  assert.strictEqual(row.bestFocusStep, null);
  assert.strictEqual(row.focusWin, null);
  assert.strictEqual(row.focusPerCraft, 0);
  assert.strictEqual(row.craftsPer10kFocus, 0);
  assert.strictEqual(row.profitPer10kFocus, null);
  assert.strictEqual(row.combinedProfit, row.craftProfit);
  assert.strictEqual(row.noFocusCraftProfit, row.craftProfit);
});

test("expensive runes → craft wins and the row is byte-identical to no route at all", () => {
  const withDear = computeCraftPlannerRow(SWORD1, SWORD1_MATS, swordMarket([
    { id: "T5_MAIN_SWORD", buy: 1000 },
    { id: "T5_RUNE", buy: 9000 },          // 288×9000×1.025 ≫ the crafted bar
  ]), FS);
  const without = computeCraftPlannerRow(SWORD1, SWORD1_MATS, swordMarket(), FS);
  assert.strictEqual(withDear.enchantedVia, undefined, "no route booked");
  assert.strictEqual(JSON.stringify(withDear), JSON.stringify(without),
    "a losing enchant candidate must not change the row in any way");
});

test("an unpriced base leaves the craft row untouched", () => {
  const without = computeCraftPlannerRow(SWORD1, SWORD1_MATS, swordMarket(), FS);
  const row = computeCraftPlannerRow(SWORD1, SWORD1_MATS, swordMarket([
    { id: "T5_RUNE", buy: 10 },            // mat alone priced — base missing
  ]), FS);
  assert.strictEqual(row.enchantedVia, undefined);
  assert.strictEqual(JSON.stringify(row), JSON.stringify(without));
});

test("a @4 row never books the route, however cheap its legs are", () => {
  const item = { id: "T5_MAIN_SWORD@4", name: "Elder's Sword", craftType: "sword" };
  const mats = [{ matId: "T5_METALBAR@4", count: 16 }];
  const md = priceMap([
    { id: "T5_METALBAR@4", buy: 9000 },
    { id: "T5_MAIN_SWORD@4", sell: SELL },
    { id: "T5_MAIN_SWORD@3", buy: 100 },
    { id: "T5_RELIC", buy: 10 },
  ]);
  const row = computeCraftPlannerRow(item, mats, md, FS);
  assert.ok(!row.noData);
  assert.strictEqual(row.enchantedVia, undefined);
});

test("an override on an enchant leg marks the row for the overrides-only filter", () => {
  const row = computeCraftPlannerRow(SWORD1, SWORD1_MATS, swordMarket(ENCHANT_LEGS), FS);
  assert.ok(row.enchantedVia, "fixture sanity");
  assert.strictEqual(row.hasOverride, false);
  __setOverrides({ "T5_RUNE:Fort Sterling": 60 });
  const row2 = computeCraftPlannerRow(SWORD1, SWORD1_MATS, swordMarket(ENCHANT_LEGS), FS);
  assert.strictEqual(row2.hasOverride, true, "the rune override must be seen");
  __setOverrides({ "T5_MAIN_SWORD:Fort Sterling": 900 });
  const row3 = computeCraftPlannerRow(SWORD1, SWORD1_MATS, swordMarket(ENCHANT_LEGS), FS);
  assert.strictEqual(row3.hasOverride, true, "the base override must be seen");
});

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
