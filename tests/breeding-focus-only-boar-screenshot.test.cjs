/**
 * Test: the user's 2026-10-07 Crafting List screenshot, 5 x Elite Wild Boar [T8]
 * (Breeding -> Saddled), Use Focus on. He asked that
 *
 *   "profit/10k focus should show only additional profit from focus usage and
 *    when use focus checkbox enabled should be included in total profit"
 *
 * The screenshot showed Profit / 10k Focus 18,074,323 / 27,481,157 /
 * 30,512,474 (Total Profit + a whole bar of cycles) and Total Profit 4,557,030:
 * the list funded the SADDLER play there, which bills ~10,000 focus for ONE
 * boar, so almost none of the focus gain reached Total Profit.
 *
 * Inputs, all from the screenshot:
 *
 *   Baby Elite Wild Boar T8  460,020  (Lymhurst)
 *   380x Raw Goat T4             178  (Fort Sterling) = 67,640 feed
 *   20x T8 Fortified Leather  32,001  (Brecilien), 15.25% base return rate
 *   20x Treeheart             30,007  (Brecilien), no return
 *   Elite Wild Boar T8 sell 2,797,980 (Bridgewatch)
 *   nurture  6 x 125 = 750 focus/baby -> 13 whole babies per 10k bar
 *   offspring 0% base, +15% fully nurtured
 *
 * Worked by hand:
 *
 *   leather consumed  20 x 50/59 = 16.949 x 32,001             =   542,389.83
 *   unfocused inputs  (460,020 + 67,640 + 542,389.83 + 600,140)
 *                     x 1.025                                   = 1,711,944.58
 *   revenue           2,797,980 x 0.935                          = 2,616,111.30
 *   unfocused cycle   2,616,111.30 - 1,711,944.58                =   904,166.72
 *
 *   line 1 (all bought)   15% x max(460,020, 904,166.72)  = 135,625.01 x 13 = 1,763,125
 *   line 2 (self-found)   cycle + 460,020 x 1.025 = 1,375,687.22
 *                         15% x 1,375,687.22               = 206,353.08 x 13 = 2,682,590
 *   line 3 (gathered)     cycle + (67,640 + 542,389.83) x 1.025 = 1,529,447.30
 *                         15% x 1,529,447.30               = 229,417.10 x 13 = 2,982,422
 *
 *   Total Profit, 5 boars, Use Focus on: 5 x (904,166.72 + 135,625.01) = 5,198,959
 *   (nurture bills 125 focus a day per boar: 625 of the 10,000 budget)
 *   Total Profit, Use Focus off:          5 x 904,166.72               = 4,520,834
 *
 * Run: node tests/breeding-focus-only-boar-screenshot.test.cjs
 */
const assert = require("assert");
const { X } = require("./helpers/moose-screenshot-row.cjs");
const { allocateCraftListFocus } = require("../js/craft-list-focus-budget.js");

const BABY = "T8_FARM_DIREBOAR_FW_LYMHURST_BABY";
const HEART = "T1_FACTION_FOREST_TOKEN_1";
const priced = (b, sl, v) => ({ buy_price: b, sell_price: sl, volume_24h: v });
const MD = {
  [BABY]: { Lymhurst: priced(460020, 749994, 51) },
  T4_MEAT: { "Fort Sterling": priced(178, 190, 50000) },
  T8_LEATHER: { Brecilien: priced(32001, 33000, 5000) },
  [HEART]: { Brecilien: priced(30007, 44922, 10419) },
  T8_MOUNT_DIREBOAR_FW_LYMHURST_ELITE: { Bridgewatch: priced(2797980, 2797980, 52) },
};
const QTY = 5;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); passed++; }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); failed++; }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

function boar(focusOn) {
  X._els["use-focus"].checked = focusOn;
  X.renderMountsTable(MD);
  const data = X.tableState["mounts-table"].data;
  const i = data.findIndex((r) => r.isBreeding && r.item && r.item.babyId === BABY && r.buyMat && r.buyMat.price > 0);
  return { row: data[i], html: X.tableState["mounts-table"].html[i] };
}

/** Total Profit exactly as the list computes it: allocate, then funded + unfunded. */
function listTotal(row, budget) {
  const ex = X.extractCraftListRow("mounts-table", row);
  const focusEnabled = X._els["use-focus"].checked;
  const { splits } = allocateCraftListFocus([Object.assign({}, ex, { qty: QTY })], budget, { focusEnabled });
  const off = Number.isFinite(ex.unitProfitNoFocus) ? ex.unitProfitNoFocus : ex.unitProfit;
  return ex.unitProfit * splits[0].fundedQty + off * splits[0].unfundedQty;
}

console.log("\n=== 5 x Elite Wild Boar [T8]: focus-only Profit / 10k Focus ===");

test("the row reproduces the screenshot's Cost 1,526,628 and Profit 1,252,906", () => {
  const { row } = boar(true);
  assert.ok(row, "no priced T8 boar breeding row");
  assert.strictEqual(Math.round(row.totalInputCost), 1526628);
  assert.strictEqual(Math.round(row.marginInfo.profit), 1252906);
  assert.strictEqual(row.focusCost, 750);
});

test("Profit / 10k Focus shows only what the focus adds: 1,763,125 / 2,682,590 / 2,982,422", () => {
  const { row, html } = boar(true);
  assert.ok(near(row.profitNoFocus, 904166.72, 0.01), `unfocused cycle ${row.profitNoFocus}`);
  assert.ok(near(row.profitFocusGain, 135625.01, 0.01), `gain/baby ${row.profitFocusGain}`);
  assert.strictEqual(Math.round(row.profitPer10kFocus), 1763125);
  assert.strictEqual(Math.round(row.profitPer10kFocusSelfFound), 2682590);
  assert.strictEqual(Math.round(row.profitPer10kFocusGathered), 2982422);
  ["1,763,125", "2,682,590", "2,982,422"].forEach((v) => assert.ok(String(html).includes(v), `cell lost ${v}`));
});

test("the bars do not move with the Use Focus checkbox", () => {
  const on = boar(true).row, off = boar(false).row;
  ["profitPer10kFocus", "profitPer10kFocusSelfFound", "profitPer10kFocusGathered"].forEach((k) =>
    assert.ok(near(on[k], off[k], 1e-6), `${k} moved: ${on[k]} -> ${off[k]}`));
});

test("Use Focus on: Total Profit for 5 boars includes the nurture gain, 5,198,959", () => {
  const { row } = boar(true);
  assert.strictEqual(Math.round(listTotal(row, 10000)), 5198959);
  // Only 625 focus is needed, so even the ~1,960 the screenshot's budget had
  // left covers every boar (it used to buy 0.2 of one saddle craft).
  assert.strictEqual(Math.round(listTotal(row, 1964)), 5198959);
});

test("Use Focus off: Total Profit is the unfocused cycle, 4,520,834", () => {
  const { row } = boar(false);
  assert.strictEqual(Math.round(listTotal(row, 10000)), 4520834);
});

test("Total Profit gain over unfocused = the bar's per-baby gain x 5", () => {
  const on = listTotal(boar(true).row, 10000);
  const off = listTotal(boar(false).row, 10000);
  assert.ok(near(on - off, QTY * 135625.01, 0.1), `gain ${on - off}`);
});

X._els["use-focus"].checked = false;
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
