/**
 * allocateCraftListFocusStandalone (js/craft-list-focus-budget.js): every row is
 * priced as if it alone had the whole budget. Black-box, parameterized.
 *
 * Run: node tests/craft-list-focus-standalone.test.cjs
 */
const assert = require("assert");
const path = require("path");
const mod = require(path.join(__dirname, "..", "js", "craft-list-focus-budget.js"));
const { allocateCraftListFocus, allocateCraftListFocusStandalone } = mod;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

const e = (qty, focusCost, delta = 1000) => ({ qty, focusCost, focusProfitDelta: delta });

test("function is exported", () => {
  assert.strictEqual(typeof allocateCraftListFocusStandalone, "function");
});

// [name, entries, budget, opts, expected [fundedQty, unfundedQty] per row]
const cases = [
  ["two rows each needing exactly the budget both fully funded",
    [e(80, 125), e(40, 250)], 10000, undefined, [[80, 0], [40, 0]]],
  ["row above budget: funded 80, unfunded 20",
    [e(100, 125)], 10000, undefined, [[80, 20]]],
  ["fractional remainder: qty 3 cost 4000 budget 10k funds 2.5",
    [e(3, 4000)], 10000, undefined, [[2.5, 0.5]]],
  ["undefined budget = no cap", [e(100, 125)], undefined, undefined, [[100, 0]]],
  ["null budget = no cap", [e(100, 125)], null, undefined, [[100, 0]]],
  ["budget 0 funds none", [e(10, 125)], 0, undefined, [[0, 10]]],
  ["negative budget funds none", [e(10, 125)], -5, undefined, [[0, 10]]],
  ["junk budget funds none", [e(10, 125)], "abc", undefined, [[0, 10]]],
  ["focusEnabled false funds none", [e(10, 125), e(5, 50)], 10000, { focusEnabled: false },
    [[0, 10], [0, 5]]],
  ["focusCost 0 row is fully funded",
    [e(7, 0), e(100, 125)], 10000, undefined, [[7, 0], [80, 20]]],
  ["qty 0 row stays 0/0", [e(0, 125)], 10000, undefined, [[0, 0]]],
];

cases.forEach(([name, entries, budget, opts, expected]) => {
  test(name, () => {
    const { splits } = allocateCraftListFocusStandalone(entries, budget, opts);
    assert.strictEqual(splits.length, entries.length);
    expected.forEach(([funded, unfunded], i) => {
      assert.ok(Math.abs(splits[i].fundedQty - funded) < 1e-9, `row ${i} funded ${splits[i].fundedQty} != ${funded}`);
      assert.ok(Math.abs(splits[i].unfundedQty - unfunded) < 1e-9, `row ${i} unfunded ${splits[i].unfundedQty} != ${unfunded}`);
    });
  });
});

test("contrast: shared allocator funds only one of the two exact-budget rows", () => {
  const rows = [e(80, 125), e(40, 250)];
  const shared = allocateCraftListFocus(rows, 10000).splits;
  assert.ok(shared[0].unfundedQty > 0 || shared[1].unfundedQty > 0);
});

test("null/undefined entry: split present, index kept, no throw", () => {
  const { splits } = allocateCraftListFocusStandalone([e(80, 125), null, undefined], 10000);
  assert.strictEqual(splits.length, 3);
  splits.forEach((s, i) => assert.strictEqual(s.index, i));
  assert.strictEqual(splits[1].fundedQty, 0);
  assert.strictEqual(splits[1].unfundedQty, 0);
});

test("positional index and order independence", () => {
  const a = e(80, 125), b = e(40, 250), c = e(100, 125);
  const fwd = allocateCraftListFocusStandalone([a, b, c], 10000).splits;
  const rev = allocateCraftListFocusStandalone([c, b, a], 10000).splits;
  fwd.forEach((s, i) => assert.strictEqual(s.index, i));
  assert.strictEqual(fwd[0].fundedQty, rev[2].fundedQty);
  assert.strictEqual(fwd[1].fundedQty, rev[1].fundedQty);
  assert.strictEqual(fwd[2].fundedQty, rev[0].fundedQty);
});

test("non-array input yields empty splits", () => {
  assert.deepStrictEqual(allocateCraftListFocusStandalone(null, 10000).splits, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
