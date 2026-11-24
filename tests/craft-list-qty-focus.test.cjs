/**
 * My Crafting List — the "10k" quantity button (js/craft-list-qty-focus.js).
 *
 * The button fills a row's quantity with what ONE 10,000-focus bar buys:
 * floor(10000 / focusCost), never below 1, and absent altogether on a row that
 * cannot spend focus.
 *
 * Black box: the module is pure — numbers and an HTML string in, no DOM, no
 * market data, no source table.
 *
 * Run: node tests/craft-list-qty-focus.test.cjs
 */
const assert = require("assert");
const path = require("path");

globalThis.tx = (en) => en;
globalThis.formatSilver = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");

const { CL_FOCUS_BAR, qtyForFocusBar, clQtyFocusBtnHtml } =
  require(path.join(__dirname, "..", "js", "craft-list-qty-focus.js"));

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log("qtyForFocusBar — how many executions one bar buys");
[
  ["a clean divisor", 125, 80],
  ["floors, never rounds up", 300, 33],
  ["exactly one bar per execution", 10000, 1],
  ["one execution costs more than a bar", 50000, 1],
  ["a fractional cost", 62.5, 160],
  ["a cheap refine", 1, 10000],
].forEach(([name, cost, want]) => {
  check(`${name}: ${cost} focus → ${want}`, () => {
    assert.strictEqual(qtyForFocusBar(cost, CL_FOCUS_BAR), want);
  });
});

console.log("qtyForFocusBar — rows that cannot spend focus");
[
  ["zero", 0], ["negative", -5], ["missing", undefined], ["null", null],
  ["not a number", "n/a"], ["NaN", NaN],
].forEach(([name, cost]) => {
  check(`${name} focus cost → null`, () => {
    assert.strictEqual(qtyForFocusBar(cost, CL_FOCUS_BAR), null);
  });
});

console.log("qtyForFocusBar — the bar argument");
check("a junk bar falls back to 10,000", () => {
  assert.strictEqual(qtyForFocusBar(100, "abc"), 100);
  assert.strictEqual(qtyForFocusBar(100, 0), 100);
  assert.strictEqual(qtyForFocusBar(100), 100);
});
check("a custom bar is honoured", () => {
  assert.strictEqual(qtyForFocusBar(100, 30000), 300);
});
check("the exported bar is one day of Premium focus", () => {
  assert.strictEqual(CL_FOCUS_BAR, 10000);
});

console.log("clQtyFocusBtnHtml — markup");
const entry = { tableId: "mounts-table", rowKey: "T7_MOUNT" };

check("carries the count, the table and the row key", () => {
  const html = clQtyFocusBtnHtml(entry, { focusCost: 125 });
  assert.ok(/data-cl-qty-focus="80"/.test(html), html);
  assert.ok(/data-table-id="mounts-table"/.test(html), html);
  assert.ok(/data-row-key="T7_MOUNT"/.test(html), html);
  assert.ok(/>10k</.test(html), html);
  assert.ok(/type="button"/.test(html), html);
});

check("the tooltip prints the real spend", () => {
  const html = clQtyFocusBtnHtml(entry, { focusCost: 125 });
  assert.ok(/80 × 125 focus = 10,000/.test(html), html);
});

check("a row over one bar says what it really costs", () => {
  const html = clQtyFocusBtnHtml(entry, { focusCost: 50000 });
  assert.ok(/data-cl-qty-focus="1"/.test(html), html);
  assert.ok(/1 × 50,000 focus = 50,000/.test(html), html);
});

check("a multi-day row says the focus is per day", () => {
  const html = clQtyFocusBtnHtml(entry, { focusCost: 100, focusDays: 6 });
  assert.ok(/over 6 days/.test(html), html);
});

check("a one-day row says nothing about days", () => {
  const html = clQtyFocusBtnHtml(entry, { focusCost: 100, focusDays: 1 });
  assert.ok(!/days/.test(html), html);
});

check("a focus-less row draws no button", () => {
  assert.strictEqual(clQtyFocusBtnHtml(entry, { focusCost: 0 }), "");
  assert.strictEqual(clQtyFocusBtnHtml(entry, {}), "");
});

check("a placeholder row (no extracted entry) draws no button", () => {
  assert.strictEqual(clQtyFocusBtnHtml(entry, null), "");
  assert.strictEqual(clQtyFocusBtnHtml(null, { focusCost: 125 }), "");
});

check("quotes in a row key cannot break out of the attribute", () => {
  const html = clQtyFocusBtnHtml(
    { tableId: "t", rowKey: 'a"><script>x</script>' }, { focusCost: 125 });
  assert.ok(!/<script>/.test(html), html);
  assert.ok(/&quot;/.test(html), html);
});

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
