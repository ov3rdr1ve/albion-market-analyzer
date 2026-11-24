/**
 * Test: Pure Profit column — pureProfitTd helper and sort value extraction.
 *
 * Run: node tests/pure-profit-column.test.cjs
 */

const assert = require("assert");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

console.log("Pure Profit Column Tests\n");

// ── Stubs ──

function formatSilver(num) {
  if (num === null || num === undefined) return "N/A";
  return Math.round(num).toLocaleString();
}

function getProfitClass(margin) {
  if (margin >= 20) return "profit-high";
  if (margin >= 10) return "profit-medium";
  if (margin > 0) return "profit-low";
  return "profit-negative";
}

// ── pureProfitTd (mirrors app.js) ──

function pureProfitTd(marginInfo) {
  const profit = marginInfo?.profit;
  if (profit === undefined || profit === null)
    return '<td class="silver-val" style="color:#6b7280;font-style:italic">\u2014</td>';
  return `<td class="silver-val ${getProfitClass(marginInfo.margin)}">${formatSilver(profit)}</td>`;
}

// ── getSortValue profit branch (mirrors sorting.js) ──


function getProfitSortValue(row, tableId) {
  if (tableId === "rolling-table")
    return (row.sellRevenue || 0) - (row.rollCostSilver || 0);
  return row.marginInfo ? (row.marginInfo.profit || 0) : -Infinity;
}

// ── Tests: pureProfitTd rendering ──

test("renders positive profit with profit-high class", () => {
  const html = pureProfitTd({ profit: 5000, margin: 25 });
  assert.ok(html.includes("profit-high"), "should use profit-high class");
  assert.ok(html.includes("5,000"), "should show formatted silver value");
});

test("renders medium profit with profit-medium class", () => {
  const html = pureProfitTd({ profit: 1200, margin: 15 });
  assert.ok(html.includes("profit-medium"), "should use profit-medium class");
  assert.ok(html.includes("1,200"), "should show formatted silver value");
});

test("renders low profit with profit-low class", () => {
  const html = pureProfitTd({ profit: 300, margin: 5 });
  assert.ok(html.includes("profit-low"), "should use profit-low class");
});

test("renders negative profit with profit-negative class", () => {
  const html = pureProfitTd({ profit: -500, margin: -10 });
  assert.ok(html.includes("profit-negative"), "should use profit-negative class");
  assert.ok(html.includes("-500"), "should show negative value");
});

test("renders dash for null marginInfo", () => {
  const html = pureProfitTd(null);
  assert.ok(html.includes("\u2014"), "should show dash for null");
});

test("renders dash for undefined profit", () => {
  const html = pureProfitTd({ margin: 10 });
  assert.ok(html.includes("\u2014"), "should show dash when profit is undefined");
});

test("renders zero profit correctly", () => {
  const html = pureProfitTd({ profit: 0, margin: 0 });
  // profit === 0 is falsy but defined, so it should show 0
  assert.ok(html.includes("0"), "should show 0");
});

// ── Tests: sort value extraction ──

test("sort value returns marginInfo.profit for crafting-table", () => {
  const row = { marginInfo: { profit: 1500, margin: 20 } };
  assert.strictEqual(getProfitSortValue(row, "crafting-table"), 1500);
});

test("sort value returns marginInfo.profit for flipping-table", () => {
  const row = { marginInfo: { profit: -200, margin: -5 } };
  assert.strictEqual(getProfitSortValue(row, "flipping-table"), -200);
});

test("sort value returns sellRevenue - rollCostSilver for rolling-table", () => {
  const row = { sellRevenue: 10000, rollCostSilver: 7000, marginInfo: { margin: 40 } };
  assert.strictEqual(getProfitSortValue(row, "rolling-table"), 3000);
});

test("sort value returns 0 for rolling-table with missing values", () => {
  const row = { marginInfo: { margin: -1 } };
  assert.strictEqual(getProfitSortValue(row, "rolling-table"), 0);
});

test("sort value returns -Infinity when marginInfo is missing", () => {
  const row = {};
  assert.strictEqual(getProfitSortValue(row, "crafting-table"), -Infinity);
});

test("sort value returns 0 when profit is falsy but marginInfo exists", () => {
  const row = { marginInfo: { profit: 0, margin: 0 } };
  assert.strictEqual(getProfitSortValue(row, "transport-table"), 0);
});

// ── Summary ──

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
