/**
 * Test: the Crafting Planner spends focus in exactly ONE place per row, and the
 * row it prints is priced at that place — the same invariant the Refining table
 * now holds (tests/refining-chain-single-tier-focus).
 *
 * Focus is a per-ACTION charge and the daily bar is small, so a row that priced
 * itself with the focus bonus on the craft AND on every rung of every material's
 * refining ladder would be quoting a play nobody can run. The planner's model:
 *
 *   • _cpPriceMaterials(item, mats, md, city, focus) takes ONE directive —
 *     {kind:"craft"} or {kind:"refine", matId, tier} — and everything it does not
 *     name is priced focus-off.
 *   • computeCraftPlannerRow re-prices the whole row once per candidate placement
 *     and keeps the one that leaves the end product most profitable, so
 *     bestFocusStep and the headline cost are the same evaluation by construction.
 *   • Inside the chosen material's ladder, focus lands on one tier
 *     (_cpRefineFocusedSourcing -> _chainCostWithFocusAtTier).
 *
 * These are the properties a future edit could quietly break — a `useFocus` flag
 * threaded one level too deep is exactly how the Refining table lost them.
 *
 * Black-box over the REAL planner via the shared sandbox harness. No live data.
 *
 * Run: node tests/craft-planner-single-focus-place.test.cjs
 */

const assert = require("assert");
const M = require("./helpers/craft-planner-pricing-harness.cjs");
const {
  computeCraftPlannerRow, getCraftRRR, getRefineRRR,
  _chainCostWithFocusAtTier, refinesPerOutputAtTier, computeCraftPlannerGlobalFocus,
  findCheapestMarketBuyForRefine, __reset, __setFocus, __setCraftFocus, __setCraftSpec,
} = M;

// Put the row in a state where focusing a REFINE beats focusing the craft. Focus
// adds a flat +59 production bonus, so a craft that is already deep in mastery
// gains almost no return rate from it, while a refine at base spec gains a lot.
// That, not a dear focus cost, is what decides the contest (pickBestFocusPlay
// ranks on absolute silver saved).
const HIGH_CRAFT_SPEC = 4;

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

// A plank-hungry furniture craft. No plank bar below T8 is listed, so every
// material reaches the planner through a full refining ladder — the shape where
// a "focus at every rung" leak would show up.
const TABLE = { id: "T8_FURNITUREITEM_TABLE", name: "Elder's Table", craftType: null };
const TABLE_MATS = [{ matId: "T8_PLANKS", count: 30 }];

function ladderMarket(extra = []) {
  return priceMap([
    { id: "T8_WOOD", city: FS, buy: 1400 },
    { id: "T7_WOOD", city: FS, buy: 640 },
    { id: "T6_WOOD", city: FS, buy: 290 },
    { id: "T5_WOOD", city: FS, buy: 130 },
    { id: "T4_WOOD", city: FS, buy: 60 },
    { id: "T3_PLANKS", city: FS, buy: 40 },
    { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 900000 },
    { id: "T8_JOURNAL_TOOLMAKER_EMPTY", city: FS, buy: 5000 },
    { id: "T8_JOURNAL_TOOLMAKER_FULL", city: FS, sell: 20000 },
    ...extra,
  ]);
}

// Two materials from different families, so "only one of them is focused" is a
// real assertion rather than a tautology.
const PLATE = { id: "T8_HEAD_PLATE_SET1", name: "Guardian Helmet", craftType: "plate_armor" };
const PLATE_MATS = [{ matId: "T8_METALBAR", count: 16 }, { matId: "T8_LEATHER", count: 8 }];

function twoMatMarket() {
  return priceMap([
    { id: "T8_ORE", city: FS, buy: 1400 }, { id: "T7_ORE", city: FS, buy: 640 },
    { id: "T6_ORE", city: FS, buy: 290 }, { id: "T5_ORE", city: FS, buy: 130 },
    { id: "T4_ORE", city: FS, buy: 60 }, { id: "T3_METALBAR", city: FS, buy: 40 },
    { id: "T8_HIDE", city: FS, buy: 1200 }, { id: "T7_HIDE", city: FS, buy: 560 },
    { id: "T6_HIDE", city: FS, buy: 250 }, { id: "T5_HIDE", city: FS, buy: 110 },
    { id: "T4_HIDE", city: FS, buy: 50 }, { id: "T3_LEATHER", city: FS, buy: 35 },
    { id: "T8_HEAD_PLATE_SET1", city: FS, sell: 900000 },
  ]);
}

// Materials whose sourcing carries a focused refine.
function focusedMats(row) {
  return row.sourcing.filter((s) => s.sourcing && s.sourcing.focusTier !== undefined);
}
// Every ChainNode under a material's sourcing, root first.
function chainNodes(src) {
  const out = [];
  for (let n = (src && src.chain) || null; n; ) {
    out.push(n);
    const sec = n.inputs[1];
    n = (sec && sec.sourcing.source === "chain") ? sec.sourcing.chain : null;
  }
  return out;
}

console.log("\n=== One focus placement per row ===");

[
  { name: "craft wins", craftFocus: 200, spec: 0, want: "craft", market: ladderMarket, item: TABLE, mats: TABLE_MATS },
  { name: "a refine wins", craftFocus: 8000, spec: HIGH_CRAFT_SPEC, want: "refine", market: ladderMarket, item: TABLE, mats: TABLE_MATS },
  { name: "two refinable materials", craftFocus: 8000, spec: HIGH_CRAFT_SPEC, want: "refine", market: twoMatMarket, item: PLATE, mats: PLATE_MATS },
].forEach(({ name, craftFocus, spec, want, market, item, mats }) => {
  test(`At most one material is focus-refined — ${name}`, () => {
    __setFocus(true);
    __setCraftFocus(craftFocus);
    __setCraftSpec(spec);
    const row = computeCraftPlannerRow(item, mats, market(), FS);
    assert.ok(!row.noData, "row must price");
    assert.strictEqual(row.focusWin, want, "fixture must land the focus where it says");
    const f = focusedMats(row);
    assert.ok(f.length <= 1, `${f.length} materials were focus-refined`);
    if (row.focusWin === "refine") {
      assert.strictEqual(f.length, 1, "a refine win must focus exactly one material");
      assert.strictEqual(f[0].matId, row.bestFocusStep.matId,
        "the focused material must be the one Best Focus names");
    } else {
      assert.strictEqual(f.length, 0,
        `focusWin=${row.focusWin} must leave every material focus-off`);
    }
  });

  test(`The craft step is focused only when it WON — ${name}`, () => {
    __setFocus(true);
    __setCraftFocus(craftFocus);
    __setCraftSpec(spec);
    const row = computeCraftPlannerRow(item, mats, market(), FS);
    const want = getCraftRRR(FS, item.craftType, row.focusWin === "craft");
    assert.ok(Math.abs(row.rrr - want) < 1e-9,
      `focusWin=${row.focusWin}: craft RRR ${row.rrr} != ${want} — focus must not be spent twice`);
  });

  test(`Unfocused ladders stay at base refine RRR — ${name}`, () => {
    __setFocus(true);
    __setCraftFocus(craftFocus);
    __setCraftSpec(spec);
    const row = computeCraftPlannerRow(item, mats, market(), FS);
    row.sourcing.forEach((s) => {
      chainNodes(s.sourcing).forEach((n) => {
        const base = getRefineRRR(n.refineCity, n.resourceType, false);
        assert.ok(Math.abs(n.rrr - base) < 1e-9,
          `${n.produces} was BUILT at ${n.rrr}, not base ${base}`);
      });
    });
  });
});

console.log("\n=== The focused material is priced at ONE ladder tier ===");

test("Its per-unit cost is the ladder focused at exactly that tier (or the bar, if cheaper)", () => {
  __setFocus(true);
  __setCraftFocus(8000);
  __setCraftSpec(HIGH_CRAFT_SPEC);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, ladderMarket(), FS);
  assert.strictEqual(row.focusWin, "refine", "fixture must land the focus on a refine");
  const s = focusedMats(row)[0].sourcing;
  const focused = _chainCostWithFocusAtTier(s.chain, s.focusTier);
  const bar = findCheapestMarketBuyForRefine("T8_PLANKS", ladderMarket(), FS, {});
  const barEff = bar && bar.price > 0 ? bar.price + (bar.travelFeePerUnit || 0) : Infinity;
  assert.ok(Math.abs(s.perUnit - Math.min(focused.cost, barEff)) < 1e-6,
    `perUnit ${s.perUnit} is neither the focused ladder ${focused.cost} nor the bar ${barEff}`);
  assert.strictEqual(s.focusTier, row.bestFocusStep.tier,
    "the priced tier must be the tier Best Focus names");
});

test("Focusing that tier is strictly cheaper than focusing nowhere", () => {
  __setFocus(true);
  __setCraftFocus(8000);
  __setCraftSpec(HIGH_CRAFT_SPEC);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, ladderMarket(), FS);
  const s = focusedMats(row)[0].sourcing;
  const off = _chainCostWithFocusAtTier(s.chain, -1);
  const on = _chainCostWithFocusAtTier(s.chain, s.focusTier);
  assert.ok(on.cost < off.cost, `focused ${on.cost} should beat focus-off ${off.cost}`);
});

console.log("\n=== The focus bill matches the play ===");

test("focusPerCraft = focusCost × refines-per-unit × units the craft consumes", () => {
  __setFocus(true);
  __setCraftFocus(8000);
  __setCraftSpec(HIGH_CRAFT_SPEC);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, ladderMarket(), FS);
  const play = row.bestFocusStep;
  assert.strictEqual(play.kind, "refine");
  const perUnit = refinesPerOutputAtTier(play.chain, play.tier);
  const units = TABLE_MATS[0].count * (1 - row.rrr);
  assert.ok(Math.abs(row.focusPerCraft - play.focusCost * perUnit * units) < 1e-6,
    `focusPerCraft ${row.focusPerCraft} != ${play.focusCost} × ${perUnit} × ${units}`);
  assert.strictEqual(row.craftsPer10kFocus, Math.floor(10000 / row.focusPerCraft));
});

test("A craft win bills the craft's own focus once", () => {
  __setFocus(true);
  __setCraftFocus(200);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, ladderMarket(), FS);
  assert.strictEqual(row.focusWin, "craft");
  assert.strictEqual(row.focusPerCraft, 200);
});

console.log("\n=== The checkbox moves the headline, never the advice ===");

[
  { name: "craft win", craftFocus: 200, spec: 0 },
  { name: "refine win", craftFocus: 8000, spec: HIGH_CRAFT_SPEC },
].forEach(({ name, craftFocus, spec }) => {
  test(`Best Focus, focus bill and the 10k column are toggle-invariant — ${name}`, () => {
    __setCraftFocus(craftFocus); __setCraftSpec(spec);
    __setFocus(true);
    const on = computeCraftPlannerRow(TABLE, TABLE_MATS, ladderMarket(), FS);
    __reset(); __setCraftFocus(craftFocus); __setCraftSpec(spec); __setFocus(false);
    const off = computeCraftPlannerRow(TABLE, TABLE_MATS, ladderMarket(), FS);
    assert.strictEqual(on.focusWin, off.focusWin);
    assert.strictEqual(on.bestFocusStep.tier, off.bestFocusStep.tier);
    assert.ok(Math.abs(on.bestFocusStep.silverPerFocus - off.bestFocusStep.silverPerFocus) < 1e-6,
      "Silver/Focus is a benchmark, not a toggle");
    assert.ok(Math.abs(on.focusPerCraft - off.focusPerCraft) < 1e-6);
    assert.ok(Math.abs(on.profitPer10kFocus - off.profitPer10kFocus) < 1e-6,
      "a whole focus bar IS focus-on play either way");
  });
});

test("With focus OFF the priced row spends none: base craft RRR, no focused ladder", () => {
  __setFocus(false);
  __setCraftFocus(8000);
  __setCraftSpec(HIGH_CRAFT_SPEC);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, ladderMarket(), FS);
  assert.strictEqual(focusedMats(row).length, 0);
  assert.ok(Math.abs(row.rrr - getCraftRRR(FS, TABLE.craftType, false)) < 1e-9);
  assert.ok(row.bestFocusStep, "…but the column still reports the play as advice");
});

test("With focus ON the headline cost IS the winning candidate's", () => {
  __setCraftFocus(8000); __setCraftSpec(HIGH_CRAFT_SPEC);
  __setFocus(false);
  const off = computeCraftPlannerRow(TABLE, TABLE_MATS, ladderMarket(), FS);
  __reset(); __setCraftFocus(8000); __setCraftSpec(HIGH_CRAFT_SPEC); __setFocus(true);
  const on = computeCraftPlannerRow(TABLE, TABLE_MATS, ladderMarket(), FS);
  assert.ok(on.refineCraftCost < off.refineCraftCost, "focus must lower the input cost");
  // profitDelta is the per-CRAFT figure the Best Focus cell prints (`+N /craft`);
  // the step's own `silverSaved` is per unit of MATERIAL and is not it.
  assert.ok(Math.abs((off.refineCraftCost - on.refineCraftCost)
    - on.bestFocusStep.profitDelta) < 1e-6,
    "the saving is exactly the delta Best Focus reports");
});

console.log("\n=== The /focus rate divides by the focus a CRAFT burns ===");

// A refine play's own focusCost is one refine of one unit, but a craft runs that
// step once per ladder step per unit it consumes. profitDelta/focusCost therefore
// overstates the rate by exactly that multiple — the trap the Best Focus cell
// avoids by passing row.focusPerCraft as focusPerExecution.
test("focusPerCraft, not play.focusCost, is the honest denominator", () => {
  __setFocus(true);
  __setCraftFocus(8000);
  __setCraftSpec(HIGH_CRAFT_SPEC);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, ladderMarket(), FS);
  const play = row.bestFocusStep;
  assert.strictEqual(play.kind, "refine");
  const refinesPerCraft = row.focusPerCraft / play.focusCost;
  assert.ok(refinesPerCraft > 1,
    `fixture must need more than one refine per craft, got ${refinesPerCraft}`);
  // What the cell renders (focusPlayCell with focusPerExecution) vs the raw field.
  const honest = play.profitDelta / row.focusPerCraft;
  assert.ok(Math.abs(play.silverPerFocus / honest - refinesPerCraft) < 1e-6,
    "the raw play.silverPerFocus is the per-refine reading, kept for the shared shape");
  assert.ok(honest > 0);
});

test("A craft play needs no correction — the two denominators are the same", () => {
  __setFocus(true);
  __setCraftFocus(200);
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, ladderMarket(), FS);
  assert.strictEqual(row.bestFocusStep.kind, "craft");
  assert.strictEqual(row.focusPerCraft, row.bestFocusStep.focusCost);
  assert.ok(Math.abs(row.bestFocusStep.silverPerFocus
    - row.bestFocusStep.profitDelta / row.focusPerCraft) < 1e-6);
});

test("The table-wide headline ranks on that honest rate, not the raw field", () => {
  __setFocus(true);
  __setCraftFocus(200);
  const craftRow = computeCraftPlannerRow(TABLE, TABLE_MATS, ladderMarket(), FS);
  __reset(); __setFocus(true); __setCraftFocus(8000); __setCraftSpec(HIGH_CRAFT_SPEC);
  const refineRow = computeCraftPlannerRow(TABLE, TABLE_MATS, ladderMarket(), FS);
  assert.strictEqual(craftRow.focusWin, "craft");
  assert.strictEqual(refineRow.focusWin, "refine");
  const rate = (r) => r.bestFocusStep.profitDelta / r.focusPerCraft;
  const winner = computeCraftPlannerGlobalFocus([craftRow, refineRow], ladderMarket());
  const expect = rate(craftRow) >= rate(refineRow) ? craftRow : refineRow;
  assert.strictEqual(winner, expect.bestFocusStep,
    `ranked on the raw field a refine play would win on inflated units`);
  // …and the raw field would have picked the other one, which is the point.
  assert.ok(refineRow.bestFocusStep.silverPerFocus > craftRow.bestFocusStep.silverPerFocus);
  assert.ok(rate(craftRow) > rate(refineRow));
});

console.log("\n=== The top of the ladder always takes the focus ===");

// Same structural result as the Refining table: a saving at a lower rung reaches
// the top attenuated by exactly the factor that rung's output is discounted by,
// so focusing the top saves that plus the return on the root's own raw. The
// refines-per-unit divisor keeps the focus bill right regardless; it is 1 here.
[
  { name: "dear top raw", px: { T8_WOOD: 9000, T7_WOOD: 20 } },
  { name: "cheap top raw", px: { T8_WOOD: 5, T7_WOOD: 4000 } },
  { name: "flat ladder", px: { T8_WOOD: 500, T7_WOOD: 500 } },
].forEach(({ name, px }) => {
  test(`Best Focus names the material's own tier — ${name}`, () => {
    __setFocus(true);
    __setCraftFocus(8000);
    __setCraftSpec(HIGH_CRAFT_SPEC);
    const md = priceMap([
      { id: "T8_WOOD", city: FS, buy: px.T8_WOOD }, { id: "T7_WOOD", city: FS, buy: px.T7_WOOD },
      { id: "T6_WOOD", city: FS, buy: 100 }, { id: "T5_WOOD", city: FS, buy: 100 },
      { id: "T4_WOOD", city: FS, buy: 100 }, { id: "T3_PLANKS", city: FS, buy: 40 },
      { id: "T8_FURNITUREITEM_TABLE", city: FS, sell: 3000000 },
    ]);
    const row = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
    assert.strictEqual(row.focusWin, "refine");
    assert.strictEqual(row.bestFocusStep.tier, 8);
    assert.strictEqual(
      refinesPerOutputAtTier(row.bestFocusStep.chain, row.bestFocusStep.tier), 1);
  });
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
