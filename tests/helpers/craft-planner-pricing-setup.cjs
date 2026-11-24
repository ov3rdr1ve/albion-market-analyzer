// Shared setup for tests/craft-planner-pricing-*.test.cjs (split from craft-planner-pricing.test.cjs).
// Each part requires this once; `test` and `finish` keep one pass/fail tally per part.

const assert = require("assert");
const M = require("./craft-planner-pricing-harness.cjs");
const { computeCraftPlannerRow, getRefineFocusValue, getRefineSellFocus,
  computeCraftPlannerGlobalFocus, __setOverrides, __setFocus, __setCraftFocus,
  __setCraftSpec, __setCrossRoute, __setForce, __setQualityMarketData, __reset } = M;

let passed = 0, failed = 0;
function test(name, fn) {
  try { __reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

function priceMap(entries) {
  const out = {};
  for (const e of entries) {
    if (!out[e.id]) out[e.id] = {};
    out[e.id][e.city] = { buy_price: e.buy || 0, sell_price: e.sell || 0, volume_24h: 9999 };
  }
  return out;
}

const FS = "Fort Sterling";

const TABLE = { id: "T8_FURNITUREITEM_TABLE", name: "Elder's Table", craftType: null };
const TABLE_MATS = [{ matId: "T8_PLANKS", count: 30 }];

function tableMarket(extra = []) {
  return priceMap([
    { id: "T8_PLANKS", city: FS, buy: 1000 },            // market plank (no raws listed → chain unavailable)
    { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 60000 },
    { id: "T8_JOURNAL_TOOLMAKER_EMPTY", city: FS, buy: 5000 },
    { id: "T8_JOURNAL_TOOLMAKER_FULL", city: FS, sell: 20000 },
    ...extra,
  ]);
}

// Pricey bar + cheap raws → self-refining planks is cheaper than buying, so the
// ladder is a live focus candidate alongside the craft step.
function refineWinsMarket() {
  return priceMap([
    { id: "T8_PLANKS", city: FS, buy: 5000 },   // pricey bar → self-refine is cheaper
    { id: "T8_WOOD",   city: FS, buy: 500 },
    { id: "T7_PLANKS", city: FS, buy: 500 },     // secondary from market
    { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 600000 },
    { id: "T8_JOURNAL_TOOLMAKER_EMPTY", city: FS, buy: 5000 },
    { id: "T8_JOURNAL_TOOLMAKER_FULL", city: FS, sell: 20000 },
  ]);
}

// Cheap bar + absurdly pricey raws: self-refining is far dearer than buying the
// bar, so refining is NOT a sensible play for the craft (it buys) even though the
// ladder's raw RRR-saving-per-focus is high in isolation.
function dominatedTableMarket() {
  return priceMap([
    { id: "T8_PLANKS", city: FS, buy: 500 },    // cheap bar → craft buys it
    { id: "T8_WOOD",   city: FS, buy: 50000 },  // absurd raw → self-refine is dearer than buying
    { id: "T7_PLANKS", city: FS, buy: 50000 },
    { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 60000 },
    { id: "T8_JOURNAL_TOOLMAKER_EMPTY", city: FS, buy: 5000 },
    { id: "T8_JOURNAL_TOOLMAKER_FULL", city: FS, sell: 20000 },
  ]);
}

// The Elder's Bed shape: the bar sits BETWEEN the focused refine (1,984) and the
// focus-off refine (2,725). The row buys the bar, so focus is only worth the
// 2,100 → 1,984 gap — a fraction of what a focus-off-refine baseline would claim.
function barBetweenMarket() {
  return priceMap([
    { id: "T8_PLANKS", city: FS, buy: 2100 },
    { id: "T8_WOOD",   city: FS, buy: 700 },
    { id: "T7_PLANKS", city: FS, buy: 700 },
    { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 600000 },
    { id: "T8_JOURNAL_TOOLMAKER_EMPTY", city: FS, buy: 5000 },
    { id: "T8_JOURNAL_TOOLMAKER_FULL", city: FS, sell: 20000 },
  ]);
}

// The craft buys the cheap bar (500) and the same bar carries a `plankSell` price
// somewhere. Refining it to SELL is a different business from this pipeline, so
// that price must not move the row: vary it and nothing about the focus decision
// or the cost may change.
function sellPlayMarket(plankSell = 2500) {
  return priceMap([
    { id: "T8_PLANKS", city: FS, buy: 500, sell: plankSell },
    { id: "T8_WOOD",   city: FS, buy: 700 },
    { id: "T7_PLANKS", city: FS, buy: 700 },
    { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 60000 },
    { id: "T8_JOURNAL_TOOLMAKER_EMPTY", city: FS, buy: 5000 },
    { id: "T8_JOURNAL_TOOLMAKER_FULL", city: FS, sell: 20000 },
  ]);
}

// A ladder whose secondary is itself refined (T8 planks ← T7 planks ← market
// T6 planks): the focus step lands on ONE tier of that ladder, and the row must
// name the item produced at that tier — not the material the ladder tops out
// at, which is the question "refine T7 or T8?" the column has to answer.
function deepLadderMarket() {
  return priceMap([
    { id: "T8_PLANKS", city: FS, buy: 50000 },   // bar dearer than refining
    { id: "T8_WOOD",   city: FS, buy: 300 },
    { id: "T7_PLANKS", city: FS, buy: 50000 },   // …at both tiers, so T7 is refined too
    { id: "T7_WOOD",   city: FS, buy: 300 },
    { id: "T6_PLANKS", city: FS, buy: 200 },     // ladder bottoms out on a market leaf
    { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 600000 },
    { id: "T8_JOURNAL_TOOLMAKER_EMPTY", city: FS, buy: 5000 },
    { id: "T8_JOURNAL_TOOLMAKER_FULL", city: FS, sell: 20000 },
  ]);
}


function finish() {
  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n--- ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);

}

module.exports = {
  assert, M, computeCraftPlannerRow, getRefineFocusValue, getRefineSellFocus, computeCraftPlannerGlobalFocus, __setOverrides, __setFocus, __setCraftFocus, __setCraftSpec, __setCrossRoute, __setForce, __setQualityMarketData, __reset, passed, failed, test, priceMap, FS, TABLE, TABLE_MATS, tableMarket, refineWinsMarket, dominatedTableMarket, barBetweenMarket, sellPlayMarket, deepLadderMarket, finish,
};
