/**
 * Test: the user's 1,440 x Moose [T6] Crafting List row, end to end, with the
 * prices from his screenshot. The three lines of "Profit / 10k Focus" are:
 *
 *   1. all mats bought                          (the headline)
 *   2. babies self-found, other mats bought     ("self-found")
 *   3. babies bought, gatherable mats gathered  ("gathered")
 *
 * Since 2026-10-07 each line is ONLY the extra profit the focus adds (the user:
 * "profit/10k focus should show only additional profit from focus usage"):
 * one bar of nurtures = 20 babies, each with +24% offspring, each extra baby
 * worth the baby price or that plan's unfocused cycle, whichever is higher.
 * The cycle's own margin needs no focus and is not in it. The Crafting List
 * prints the same three bars (the planned qty does not change them), and with
 * Use Focus on its Total Profit adds the nurture gain on every funded baby.
 *
 * Every expected number below is worked out by hand from the screenshot's
 * inputs, not read back from the code:
 *
 *   Baby Moose T6   233,619   (Thetford)
 *   69x Beans T2        374   (Thetford) = 25,806 feed
 *   20x T6 Leather    4,602   (Thetford), 15.2% base return rate
 *   Moose T6 sell   529,993   (Brecilien)
 *   nurture         4 x 125 = 500 focus/baby -> 20 babies per 10k bar
 *   offspring       0% base, +24% fully nurtured
 *   fees            2.5% buy setup fee; 4% premium tax + 2.5% sell setup
 *
 * Run: node tests/breeding-per10k-moose-screenshot.test.cjs
 */
const assert = require("assert");
const { X, row } = require("./helpers/moose-screenshot-row.cjs");
const QTY = 1440;

// ── Hand-worked expectations (see the header for the inputs) ───────────────
// leather consumed: 20 x (1 - 0.152542) = 16.949 -> 16.949 x 4,602 = 78,000
// cycle inputs:     (233,619 + 25,806 + 78,000) x 1.025 = 345,860.63
// revenue:          529,993 x (1 - 0.065)               = 495,543.46
// cycle profit:     495,543.46 - 345,860.63             = 149,682.83
// focus gain/baby:  24% x max(baby price, that plan's cycle)  (cents rounded,
//                   so the bars are checked to 0.1 silver)
//
// line 1  24% x max(233,619, 149,682.83) = 56,068.56 x 20 = 1,121,371.20
// line 2  cycle + 233,619 x 1.025 = 389,142.31 (beats the baby price)
//         24% x 389,142.31 = 93,394.15 x 20                = 1,867,883.09
// line 3  cycle + (25,806 + 78,000) x 1.025 = 256,083.98 (beats the baby)
//         24% x 256,083.98 = 61,460.16 x 20                = 1,229,203.10
// Total Profit, 1,440 planned, Use Focus on:
//   all funded   (149,682.83 + 56,068.56) x 1440 = 296,282,001.6
//   none funded   149,682.83 x 1440              = 215,543,275.2
const EXPECT = {
  unitProfit: 149682.83,
  gain: 56068.56,
  bar: { bought: 1121371.2, self: 1867883.088, gathered: 1229203.104 },
  total: { funded: 296282001.6, unfunded: 215543275.2 },
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); passed++; }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); failed++; }
}
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;


console.log("\n=== 1,440 x Moose [T6]: the three Profit / 10k Focus lines ===");

test("the row reproduces the screenshot's Cost and Profit", () => {
  assert.ok(row, "no priced Moose breeding row");
  assert.ok(near(row.totalInputCost, 345860.625), `cost ${row.totalInputCost}`);
  assert.ok(near(row.marginInfo.profit, EXPECT.unitProfit), `profit ${row.marginInfo.profit}`);
  assert.strictEqual(row.focusCost, 500);
});

test("breeding table: the three focus-only bars (line 3 keeps babies BOUGHT)", () => {
  assert.ok(near(row.profitFocusGain, EXPECT.gain), `gain ${row.profitFocusGain}`);
  assert.ok(near(row.profitPer10kFocus, EXPECT.bar.bought, 0.1), `bought bar ${row.profitPer10kFocus}`);
  assert.ok(near(row.profitPer10kFocusSelfFound, EXPECT.bar.self, 0.1), `self bar ${row.profitPer10kFocusSelfFound}`);
  assert.ok(near(row.profitPer10kFocusGathered, EXPECT.bar.gathered, 0.1),
    `gathered bar ${row.profitPer10kFocusGathered}`);
});

test("breeding table: the cell prints the three bars", () => {
  const html = X.tableState["mounts-table"].html[X.tableState["mounts-table"].data.indexOf(row)];
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  const has = (n) => String(html).includes(String(Math.round(n))) || String(html).includes(fmt(n));
  for (const k of ["bought", "self", "gathered"]) assert.ok(has(EXPECT.bar[k]), `cell lost the ${k} bar`);
});

[[QTY, 0, "funded"], [0, QTY, "unfunded"]].forEach(([fundedQty, unfundedQty, k]) => {
  test(`crafting list, qty 1440 ${k}, Use Focus on: Total Profit ${k === "funded" ? "adds" : "leaves out"} the nurture gain`, () => {
    X._els["use-focus"].checked = true;
    try {
      const ex = X.extractCraftListRow("mounts-table", row);
      assert.ok(near(ex.unitProfit, EXPECT.unitProfit + EXPECT.gain), `funded unit ${ex.unitProfit}`);
      assert.ok(near(ex.unitProfitNoFocus, EXPECT.unitProfit), `unfunded unit ${ex.unitProfitNoFocus}`);
      const total = ex.unitProfit * fundedQty + ex.unitProfitNoFocus * unfundedQty;
      assert.ok(Math.abs(total - EXPECT.total[k]) <= 1, `Total Profit ${total} != ${EXPECT.total[k]}`);
      // The list bills nurture per day: 500 focus over 4 days.
      assert.strictEqual(ex.focusCost, 125);
    } finally {
      X._els["use-focus"].checked = false;
    }
  });
});

test("crafting list, Use Focus off: Total Profit is the unfocused cycle", () => {
  const ex = X.extractCraftListRow("mounts-table", row);
  assert.ok(near(ex.unitProfit, EXPECT.unitProfit), `unit ${ex.unitProfit}`);
  assert.strictEqual(ex.focusProfitDelta, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
