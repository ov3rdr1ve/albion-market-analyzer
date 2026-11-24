/**
 * Test: My Crafting List warns when the units the focus budget cannot fund lose
 * money (js/craft-list-focus-loss-warning.js).
 *
 * A row whose focused unit profit is positive but whose unfocused one is
 * negative, run at a Qty the budget cannot fund in full, folds the unfunded
 * loss silently into Total Profit. The helper says how many to run instead.
 *
 * Black box over the shipped module — synthetic numbers, no DOM, no market data.
 *
 * Run: node tests/craft-list-focus-loss-warning.test.cjs
 */
const assert = require("assert");
const path = require("path");

const { clFocusLossWarning, clFocusLossWarningHtml } =
  require(path.join(__dirname, "..", "js", "craft-list-focus-loss-warning.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

const base = { qty: 144, fundedQty: 13.33, unitProfit: 1312946, unitProfitNoFocus: -95000,
  isBreeding: true, growHours: 142 };
const mk = (over) => Object.assign({}, base, over);

// null cases: [label, overrides]
[
  ["unfocused profit is positive", { unitProfitNoFocus: 5000 }],
  ["unfocused profit is exactly zero", { unitProfitNoFocus: 0 }],
  ["focused profit is zero", { unitProfit: 0 }],
  ["focused profit is negative", { unitProfit: -10 }],
  ["qty equals the floored funded count", { qty: 13 }],
  ["qty below the funded count", { qty: 10, fundedQty: 13.33 }],
  ["funded count below one unit", { fundedQty: 0.9 }],
  ["nothing funded", { fundedQty: 0 }],
  ["unfocused profit missing", { unitProfitNoFocus: undefined }],
  ["unfocused profit not finite", { unitProfitNoFocus: NaN }],
  ["qty zero (parked)", { qty: 0 }],
].forEach(([label, over]) => {
  test(`null: ${label}`, () => assert.strictEqual(clFocusLossWarning(mk(over)), null));
});

test("null: no input", () => assert.strictEqual(clFocusLossWarning(), null));

// n is the funded count floored to a whole unit
[
  [13.33, 13], [13, 13], [13.999, 13], [1, 1], [57.5, 57],
].forEach(([funded, n]) => {
  test(`n = floor(${funded}) = ${n}`, () => {
    const w = clFocusLossWarning(mk({ fundedQty: funded, qty: 200 }));
    assert.ok(w);
    assert.strictEqual(w.n, n);
    assert.strictEqual(w.profitAtN, n * 1312946);
  });
});

test("screenshot case: figures", () => {
  const w = clFocusLossWarning(base);
  assert.strictEqual(w.n, 13);
  assert.strictEqual(w.lossEach, -95000);
  assert.strictEqual(w.lossTotal, -12413650);
  assert.strictEqual(w.profitAtN, 17068298);
  assert.ok(Math.abs(w.perDayAtN - 17068298 / (142 / 24)) < 1e-6);
});

test("screenshot case: exact text, short and no figures", () => {
  const w = clFocusLossWarning(base);
  assert.strictEqual(w.text, "Only nurture 13 babies — unfocused are a loss");
  assert.strictEqual(w.atText, undefined);
});

test("breeding wording, one baby is singular", () => {
  const w = clFocusLossWarning(mk({ fundedQty: 1.2 }));
  assert.strictEqual(w.text, "Only nurture 1 baby — unfocused are a loss");
});

test("non-breeding wording and no per-day", () => {
  const w = clFocusLossWarning(mk({ isBreeding: false }));
  assert.strictEqual(w.text, "Only focus-craft 13 — unfocused are a loss");
  assert.strictEqual(w.perDayAtN, undefined);
});

[undefined, null, 0, NaN, -5].forEach((hours) => {
  test(`breeding without usable growHours (${hours}): no per-day`, () => {
    const w = clFocusLossWarning(mk({ growHours: hours }));
    assert.ok(w);
    assert.strictEqual(w.perDayAtN, undefined);
  });
});

test("html: clickable button carrying n through data-cl-qty-focus", () => {
  const html = clFocusLossWarningHtml(base, { tableId: "mounts", rowKey: "k&1" });
  assert.ok(html.includes('data-cl-qty-focus="13"'), html);
  assert.ok(html.includes('data-table-id="mounts"'), html);
  assert.ok(html.includes('data-row-key="k&amp;1"'), html);
  assert.ok(html.includes('title="Set Qty to 13"'), html);
});

test("html: exact rendered markup, N=80 breeding", () => {
  const html = clFocusLossWarningHtml(mk({ fundedQty: 80.4, qty: 144 }), { tableId: "mounts", rowKey: "k1" });
  assert.strictEqual(html,
    '<button type="button" class="cl-row-focusloss" data-cl-qty-focus="80"'
    + ' data-table-id="mounts" data-row-key="k1" title="Set Qty to 80">'
    + 'Only nurture 80 babies — unfocused are a loss</button>');
});

test("html: no figures, no at-Qty line, no line break", () => {
  const html = clFocusLossWarningHtml(base, { tableId: "mounts", rowKey: "k" });
  assert.ok(!html.includes("ea,"), html);
  assert.ok(!html.includes("total)"), html);
  assert.ok(!html.includes("at Qty"), html);
  assert.ok(!html.includes("<br>"), html);
});

test("html: empty when there is no warning", () => {
  assert.strictEqual(clFocusLossWarningHtml(mk({ unitProfitNoFocus: 10 }), { tableId: "t", rowKey: "r" }), "");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
