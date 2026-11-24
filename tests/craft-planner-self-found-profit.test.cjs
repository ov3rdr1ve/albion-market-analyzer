/**
 * Test: the Crafting Planner's Pure Profit twin — plan.md step 1 (TDD red).
 *
 * The planner's craft profit subtracts every material at its sourced price
 * (market bar or self-refine chain — the chain's own resource base included),
 * plus station fee, recipe silver and the sell travel leg. The twin prices the
 * SAME route with every GATHERABLE input at zero — raw resources, refined bars
 * and the self-refine chain's resource base alike — keeping the non-gatherable
 * silver (plan.md per-table rules):
 *
 *   selfFoundProfit = sellPrice × (1 − PREMIUM_TAX)
 *                     − (artifact cost ×(1 + SETUP_FEE)   [bought, not gatherable]
 *                        + station fee                     [flat silver]
 *                        + recipe silver                   [flat silver]
 *                        + sell travel leg                 [kept]
 *                       )
 *
 * Black-box: drive the REAL computeCraftPlannerRow through the shared harness
 * tests/helpers/craft-planner-pricing-harness.cjs (exactly what
 * tests/craft-planner-pricing.test.cjs drives) with injected prices, and assert
 * the twin on the returned row. Exact silver values by hand below.
 *
 * Tax getter control: the shared planner harness fixes PREMIUM_TAX at 0.065 and
 * SETUP_FEE at 0.025 (its sandbox convention — it stubs the getters as
 * constants); the station fee is injectable via __setStationFee. The LIVE
 * getter behaviour is pinned by tests/self-found-profit-core, tests/crafting-
 * self-found-profit and tests/transport-self-found-profit; this file holds the
 * planner's own arithmetic to the same 0.065 basis.
 *
 * RED BY DESIGN: no planner code writes selfFoundProfit yet, so the twin
 * assertions fail on the missing field. The primary-profit assertions are
 * regressions and pass before AND after.
 *
 * All prices simulated; no live API.
 *
 * Run: node --test tests/craft-planner-self-found-profit.test.cjs
 */

const assert = require("assert");
const { test } = require("node:test");
const M = require("./helpers/craft-planner-pricing-harness.cjs");
const { computeCraftPlannerRow, getCraftRRR, __setStationFee, __setFocus, __reset } = M;

const FS = "Fort Sterling";
const STATION_FEE = 500;

// Elder's Table: 30x T8_PLANKS, no artifacts, no recipe silver.
const TABLE = { id: "T8_FURNITUREITEM_TABLE", name: "Elder's Table", craftType: null };
const TABLE_MATS = [{ matId: "T8_PLANKS", count: 30 }];

function priceMap(entries) {
  const out = {};
  for (const e of entries) {
    if (!out[e.id]) out[e.id] = {};
    out[e.id][e.city] = { buy_price: e.buy || 0, sell_price: e.sell || 0, volume_24h: 9999 };
  }
  return out;
}

function tableMarket({ planks = 1000, artifact = null } = {}) {
  return priceMap([
    { id: "T8_PLANKS", city: FS, buy: planks },          // market bar (no raws listed → chain unavailable)
    { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 60000 },
    { id: "T8_JOURNAL_TOOLMAKER_EMPTY", city: FS, buy: 5000 },
    { id: "T8_JOURNAL_TOOLMAKER_FULL", city: FS, sell: 20000 },
    ...(artifact ? [{ id: artifact.id, city: FS, buy: artifact.price }] : []),
  ]);
}

function rowWith(market, item = TABLE, mats = TABLE_MATS) {
  const row = computeCraftPlannerRow(item, mats, market, FS);
  assert.ok(!row.noData, `the fixture row must price (noData: ${row.noData && row.noDataMats})`);
  return row;
}

const sfOf = (row) => (row.selfFoundProfit !== undefined ? row.selfFoundProfit
  : (row.marginInfo && row.marginInfo.selfFoundProfit));

const near = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9);

/** The primary craft profit, recomputed by hand from the injected prices. */
function primaryCraftProfit(row, market, mats, item = TABLE) {
  const rrr = item.noReturn ? 0 : getCraftRRR(FS, item.craftType, false);
  let matsCost = 0;
  mats.forEach((m) => {
    const isArtifact = /ARTEFACT/.test(m.matId);
    const price = market[m.matId][FS].buy_price;
    const eff = isArtifact ? m.count : m.count * (1 - rrr);
    matsCost += price * eff * 1.025;
  });
  const inputCost = matsCost + STATION_FEE + (item.silverCost || 0);
  return row.sellPrice * 0.935 - (inputCost + row.brecilienFee);
}

test("fixture sanity: the table row prices all-market with a real station fee", () => {
  __reset();
  __setStationFee(STATION_FEE);
  const row = rowWith(tableMarket());
  assert.strictEqual(row.sourcing[0].sourcing.source, "market", "the bar is bought");
  assert.strictEqual(row.sellCity, FS, "the table sells where it crafts (no haul)");
  assert.strictEqual(row.brecilienFee, 0, "no haul leg in this fixture");
});

test("gatherable-only recipe: twin keeps ONLY the station fee", () => {
  __reset();
  __setStationFee(STATION_FEE);
  const row = rowWith(tableMarket());
  assert.strictEqual(typeof sfOf(row), "number",
    "selfFoundProfit missing on the planner row (feature not implemented)");
  // 60,000 x 0.935 - 500 = 55,600. The 30 planks (market bar OR self-refine
  // chain — both are gatherable) and their setup fee leave together.
  const want = 60000 * 0.935 - STATION_FEE;
  assert.ok(near(sfOf(row), want), `twin ${sfOf(row)} != ${want}`);
  assert.ok(row.craftProfit < sfOf(row),
    `twin ${sfOf(row)} must exceed the bought profit ${row.craftProfit}`);
});

test("the twin is INDEPENDENT of the bar price and of the market-vs-self-refine choice", () => {
  __reset();
  __setStationFee(STATION_FEE);
  const a = rowWith(tableMarket({ planks: 1000 }));
  const b = rowWith(tableMarket({ planks: 4000 }));
  assert.ok(near(sfOf(b), sfOf(a)),
    `twin moved with the bar price (${sfOf(a)} → ${sfOf(b)})`);
  assert.ok(b.craftProfit < a.craftProfit, "the primary profit must track the bar price");
});

test("artifact input is NOT gatherable: its cost and setup fee are kept", () => {
  __reset();
  __setStationFee(STATION_FEE);
  const ART = { id: "T6_ARTEFACT_X", price: 10000 };
  const mats = [...TABLE_MATS, { matId: ART.id, count: 1 }];
  const row = rowWith(tableMarket({ artifact: ART }), TABLE, mats);
  assert.strictEqual(typeof sfOf(row), "number", "selfFoundProfit missing (artifact recipe)");
  // 60,000 x 0.935 - (10,000 x 1.025 + 500) = 56,100 - 10,750 = 45,350.
  const want = 60000 * 0.935 - (ART.price * 1.025 + STATION_FEE);
  assert.ok(near(sfOf(row), want), `twin ${sfOf(row)} != ${want}`);
});

test("the twin does not move when Use Focus re-prices the winning craft", () => {
  __reset();
  __setStationFee(STATION_FEE);
  const off = rowWith(tableMarket());
  __setFocus(true);
  try {
    const on = rowWith(tableMarket());
    assert.strictEqual(typeof sfOf(on), "number", "selfFoundProfit missing (focus-on)");
    assert.ok(near(sfOf(on), sfOf(off)),
      `twin moved with the focus toggle (${sfOf(off)} → ${sfOf(on)}) — focus only shifts RRR, and a zero-cost input has no RRR slice`);
    assert.ok(on.craftProfit >= off.craftProfit,
      "fixture precondition: focusing the craft must not lose silver");
  } finally {
    __setFocus(false);
  }
});

test("regression: the planner's primary craft profit keeps today's formula", () => {
  __reset();
  __setStationFee(STATION_FEE);
  const ART = { id: "T6_ARTEFACT_X", price: 10000 };
  const mats = [...TABLE_MATS, { matId: ART.id, count: 1 }];
  const market = tableMarket({ artifact: ART });
  const row = rowWith(market, TABLE, mats);
  assert.ok(near(row.craftProfit, primaryCraftProfit(row, market, mats)),
    `primary profit ${row.craftProfit} drifted from the hand formula`);
  assert.ok(near(row.refineCraftCost,
      30 * 1000 * (1 - getCraftRRR(FS, null, false)) * 1.025 + ART.price * 1.025 + STATION_FEE),
    `refineCraftCost ${row.refineCraftCost} drifted from the hand formula`);
});

// ── Profit / 10k Focus gathered line ────────────────────────────────────────

test("gathered per-10k: the self-gathered craft plus the bar's journal play × crafts per bar", () => {
  __reset();
  __setStationFee(STATION_FEE);
  const row = rowWith(tableMarket());
  assert.ok(row.focusPerCraft > 0, "fixture precondition: the table is focus-craftable");
  const journal = row.focusCombinedProfit - row.focusCraftProfit;
  assert.ok(near(row.profitFocusOnGathered, sfOf(row) + journal),
    `profitFocusOnGathered ${row.profitFocusOnGathered} != twin ${sfOf(row)} + journal ${journal}`);
  assert.ok(near(row.profitPer10kFocusGathered, row.profitFocusOnGathered * row.craftsPer10kFocus),
    "profitPer10kFocusGathered is not the gathered craft × crafts per bar");
  assert.ok(row.profitPer10kFocusGathered > row.profitPer10kFocus,
    "with the planks priced, the gathered bar must beat the bought bar");
});

test("gathered per-10k: does not move with Use Focus", () => {
  __reset();
  __setStationFee(STATION_FEE);
  const off = rowWith(tableMarket());
  __setFocus(true);
  try {
    const on = rowWith(tableMarket());
    assert.ok(near(on.profitPer10kFocusGathered, off.profitPer10kFocusGathered),
      `gathered bar moved with the toggle (${off.profitPer10kFocusGathered} → ${on.profitPer10kFocusGathered})`);
  } finally {
    __setFocus(false);
  }
});
