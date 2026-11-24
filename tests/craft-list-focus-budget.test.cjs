/**
 * My Crafting List — the focus budget (js/craft-list-focus-budget.js).
 *
 * Focus is a finite resource: Premium regenerates ~10,000/day, so a basket that
 * needs more than the budget cannot run every unit focused. The allocator hands
 * the budget to the units that buy the most silver per focus point and reports
 * everything past that as unfunded — those units are priced at the BASE return
 * rate by the totals (js/craft-list-materials.js).
 *
 * Black-box: synthetic entries in the shape summarizeCraftList already takes
 * ({unitProfit, unitProfitNoFocus, focusCost, qty}), asserting the split, never
 * the internals.
 *
 * Run: node tests/craft-list-focus-budget.test.cjs
 */
const assert = require("assert");
const path = require("path");

const {
  rrrWithoutFocus,
  craftListFocusRate,
  allocateCraftListFocus,
} = require(path.join(__dirname, "..", "js", "craft-list-focus-budget.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

/** One entry: `gain` is the silver focus buys on ONE execution of the row. */
function entry(focusCost, qty, gain, extra) {
  return {
    tableId: "crafting-table",
    unitProfit: 1000,
    unitProfitNoFocus: 1000 - (gain || 0),
    focusProfitDelta: gain || 0,
    focusCost,
    qty,
    ...(extra || {}),
  };
}

const splitOf = (alloc) => alloc.splits.map((s) => [s.fundedQty, s.unfundedQty]);

// ── the rate an entry is ranked by ──────────────────────────────────────────

test("the focus rate is the silver one focus point buys", () => {
  assert.strictEqual(craftListFocusRate(entry(100, 5, 2500)), 25);
});

test("an entry with no focus cost has no rate", () => {
  assert.strictEqual(craftListFocusRate(entry(0, 5, 900)), 0);
});

test("an entry focus does nothing for has a zero rate, not a negative one", () => {
  assert.strictEqual(craftListFocusRate(entry(100, 5, 0)), 0);
  assert.strictEqual(craftListFocusRate(null), 0);
});

// ── the base return rate, focus removed ─────────────────────────────────────
//
// rrr = PB/(1+PB), so PB = rrr/(1-rrr) and the focus bonus comes straight back
// off the production bonus. 0.18 + 0.15 + 0.59 = 0.92 → 0.479…, and without the
// focus bonus 0.33 → 0.248…

test("rrrWithoutFocus un-applies the focus bonus", () => {
  const on = 0.92 / 1.92;
  const off = 0.33 / 1.33;
  assert.ok(Math.abs(rrrWithoutFocus(on) - off) < 1e-12);
});

test("a no-return craft stays at zero", () => {
  assert.strictEqual(rrrWithoutFocus(0), 0);
});

test("a rate that is already at or below the focus bonus floors at zero", () => {
  // 0.59 alone → 0.371…; nothing but focus, so removing it leaves nothing.
  assert.strictEqual(rrrWithoutFocus(0.59 / 1.59), 0);
  assert.strictEqual(rrrWithoutFocus(0.2), 0);
});

test("rrrWithoutFocus tolerates junk", () => {
  assert.strictEqual(rrrWithoutFocus(null), 0);
  assert.strictEqual(rrrWithoutFocus(NaN), 0);
  assert.strictEqual(rrrWithoutFocus(1), 0);
  assert.strictEqual(rrrWithoutFocus(2), 0);
});

// ── allocation: the budget covers everything ────────────────────────────────

test("a budget bigger than the need funds every unit", () => {
  const alloc = allocateCraftListFocus([entry(100, 5, 2500), entry(50, 4, 400)], 10000);
  assert.deepStrictEqual(splitOf(alloc), [[5, 0], [4, 0]]);
  assert.strictEqual(alloc.focusNeeded, 700);
  assert.strictEqual(alloc.focusUsed, 700);
  assert.strictEqual(alloc.focusUnfunded, 0);
  assert.strictEqual(alloc.capped, false);
});

test("an omitted budget means no cap at all", () => {
  const alloc = allocateCraftListFocus([entry(100, 5, 2500)]);
  assert.deepStrictEqual(splitOf(alloc), [[5, 0]]);
  assert.strictEqual(alloc.focusUsed, 500);
  assert.strictEqual(alloc.capped, false);
});

test("an infinite budget funds everything", () => {
  const alloc = allocateCraftListFocus([entry(100, 5, 2500)], Infinity);
  assert.deepStrictEqual(splitOf(alloc), [[5, 0]]);
  assert.strictEqual(alloc.focusUnfunded, 0);
});

// ── allocation: the budget runs out ─────────────────────────────────────────

test("a zero budget funds nothing", () => {
  const alloc = allocateCraftListFocus([entry(100, 5, 2500)], 0);
  assert.deepStrictEqual(splitOf(alloc), [[0, 5]]);
  assert.strictEqual(alloc.focusUsed, 0);
  assert.strictEqual(alloc.focusNeeded, 500);
  assert.strictEqual(alloc.focusUnfunded, 500);
  assert.strictEqual(alloc.capped, true);
});

test("the leftover past the whole units funds part of the next one", () => {
  // 250 focus buys 2 whole crafts of a 100-focus row and half of the third:
  // the bar is a daily pool, so the 50 left over is not stranded.
  const alloc = allocateCraftListFocus([entry(100, 5, 2500)], 250);
  assert.deepStrictEqual(splitOf(alloc), [[2.5, 2.5]]);
  assert.strictEqual(alloc.focusUsed, 250);
  assert.strictEqual(alloc.focusUnfunded, 250);
});

test("a budget smaller than one unit still funds that fraction of it", () => {
  const alloc = allocateCraftListFocus([entry(100, 5, 2500)], 99);
  assert.deepStrictEqual(splitOf(alloc), [[0.99, 4.01]]);
  assert.strictEqual(alloc.focusUsed, 99);
});

test("The user's footer: 7,911 / 10,000 used with 50,265 unfocused uses the whole bar", () => {
  // 2026-10-05 screenshot: every row still waiting cost more than the 2,089
  // left after the whole units, so the footer read 7,911 / 10,000 and 50,265
  // unfocused. The leftover now funds part of the best waiting row.
  const alloc = allocateCraftListFocus([
    entry(7911, 1, 400000),   // best rate, fits whole
    entry(16755, 3, 300000),  // 50,265 focus, no whole unit fits 2,089
  ], 10000);
  assert.strictEqual(alloc.focusNeeded, 7911 + 50265);
  assert.ok(Math.abs(alloc.focusUsed - 10000) < 1e-6, `used ${alloc.focusUsed}`);
  assert.ok(Math.abs(alloc.focusUnfunded - 48176) < 1e-6, `unfocused ${alloc.focusUnfunded}`);
  assert.strictEqual(alloc.splits[0].fundedQty, 1);
  assert.ok(Math.abs(alloc.splits[1].fundedQty - 2089 / 16755) < 1e-12);
});

test("a negative or unreadable budget is treated as zero", () => {
  [-100, NaN, "abc"].forEach((b) => {
    const alloc = allocateCraftListFocus([entry(100, 5, 2500)], b);
    assert.deepStrictEqual(splitOf(alloc), [[0, 5]], `budget ${b}`);
  });
});

// ── allocation: the ORDER is silver per focus, not list order ───────────────

test("the budget goes to the best silver-per-focus row first", () => {
  // list order is worst → best; the budget must still find the best.
  const alloc = allocateCraftListFocus([
    entry(100, 10, 200),   // rate 2
    entry(100, 10, 5000),  // rate 50
    entry(100, 10, 900),   // rate 9
  ], 1000);
  assert.deepStrictEqual(splitOf(alloc), [[0, 10], [10, 0], [0, 10]]);
  assert.strictEqual(alloc.focusUsed, 1000);
});

test("the budget spills from the best row into the next best", () => {
  const alloc = allocateCraftListFocus([
    entry(100, 10, 200),   // rate 2  — last
    entry(100, 10, 5000),  // rate 50 — first, 1000 focus
    entry(100, 10, 900),   // rate 9  — second, 500 of its 1000
  ], 1500);
  assert.deepStrictEqual(splitOf(alloc), [[0, 10], [10, 0], [5, 5]]);
  assert.strictEqual(alloc.focusUsed, 1500);
  assert.strictEqual(alloc.focusNeeded, 3000);
  assert.strictEqual(alloc.focusUnfunded, 1500);
});

test("a tie on rate goes to the cheaper focus first", () => {
  // Same rate (10 silver/focus); the 20-focus row is the finer grain, so it is
  // the one a 20-focus budget can actually buy a whole unit of.
  const alloc = allocateCraftListFocus([
    entry(200, 3, 2000),
    entry(20, 3, 200),
  ], 20);
  assert.deepStrictEqual(splitOf(alloc), [[0, 3], [1, 2]]);
});

// ── entries the budget must not touch ───────────────────────────────────────

test("a row with no focus cost never consumes budget and is never unfunded", () => {
  const alloc = allocateCraftListFocus([entry(0, 7, 0), entry(100, 2, 5000)], 100);
  assert.deepStrictEqual(splitOf(alloc), [[7, 0], [1, 1]]);
  assert.strictEqual(alloc.focusNeeded, 200);
  assert.strictEqual(alloc.focusUsed, 100);
});

test("a parked row (quantity 0) needs nothing and gets nothing", () => {
  const alloc = allocateCraftListFocus([entry(100, 0, 5000), entry(100, 2, 4000)], 10000);
  assert.deepStrictEqual(splitOf(alloc), [[0, 0], [2, 0]]);
  assert.strictEqual(alloc.focusNeeded, 200);
});

test("a row focus buys nothing for sinks to the back of the queue", () => {
  // Same focus cost, but the second row gains nothing from spending it — the
  // budget must not be burned on it while a paying row goes unfunded.
  const alloc = allocateCraftListFocus([
    entry(100, 5, 0),
    entry(100, 5, 3000),
  ], 500);
  assert.deepStrictEqual(splitOf(alloc), [[0, 5], [5, 0]]);
});

// ── the global Use Focus toggle ─────────────────────────────────────────────

test("with focus disabled nothing is funded and nothing is needed", () => {
  const alloc = allocateCraftListFocus([entry(100, 5, 2500)], 10000, { focusEnabled: false });
  assert.deepStrictEqual(splitOf(alloc), [[0, 5]]);
  assert.strictEqual(alloc.focusUsed, 0);
  assert.strictEqual(alloc.focusNeeded, 0);
  assert.strictEqual(alloc.focusUnfunded, 0);
  assert.strictEqual(alloc.capped, false);
});

test("focus is enabled unless the caller says otherwise", () => {
  const alloc = allocateCraftListFocus([entry(100, 5, 2500)], 10000, {});
  assert.deepStrictEqual(splitOf(alloc), [[5, 0]]);
});

// ── shape + edges ───────────────────────────────────────────────────────────

test("the splits line up with the entries by position", () => {
  const alloc = allocateCraftListFocus([entry(100, 5, 2500), entry(100, 5, 100)], 300);
  assert.strictEqual(alloc.splits.length, 2);
  assert.deepStrictEqual(alloc.splits.map((s) => s.index), [0, 1]);
});

test("every split accounts for the whole quantity", () => {
  const entries = [entry(100, 5, 2500), entry(37, 9, 400), entry(0, 3, 0), entry(100, 0, 900)];
  const alloc = allocateCraftListFocus(entries, 333);
  alloc.splits.forEach((s, i) => {
    const qty = Math.max(0, entries[i].qty);
    assert.strictEqual(s.fundedQty + s.unfundedQty, qty, `entry ${i}`);
  });
});

test("an empty list allocates nothing", () => {
  const alloc = allocateCraftListFocus([], 10000);
  assert.deepStrictEqual(alloc.splits, []);
  assert.strictEqual(alloc.focusUsed, 0);
  assert.strictEqual(alloc.focusNeeded, 0);
  assert.strictEqual(alloc.capped, false);
});

test("a missing list allocates nothing", () => {
  assert.strictEqual(allocateCraftListFocus(null, 10000).splits.length, 0);
});

test("fractional focus costs are never rounded away", () => {
  // 3.89 focus a stew (a real consumable figure): 100 focus buys 25 whole
  // stews and 0.707 of the 26th — all 100 spent.
  const alloc = allocateCraftListFocus([entry(3.89, 40, 50)], 100);
  assert.ok(Math.abs(alloc.splits[0].fundedQty - 100 / 3.89) < 1e-9);
  assert.ok(Math.abs(alloc.focusUsed - 100) < 1e-9);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
