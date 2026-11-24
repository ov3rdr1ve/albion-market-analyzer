/**
 * Test: "Show All" checkbox expands all collapsed sections and renders
 * with empty market data so all artifact rows are visible.
 *
 * Run: node tests/show-all-expands-sections.test.cjs
 */

const assert = require("assert");
const { test } = require("node:test");

// ── Simulated Show All change handler logic (from app.js) ───────────────────

let expandAllCalled = false;
let renderCalledWith = undefined;

function expandAll() { expandAllCalled = true; }
function renderAllTables(data) { renderCalledWith = data; }

function simulateShowAllChange(checked, lastMarketData) {
  expandAllCalled = false;
  renderCalledWith = undefined;

  // Mirrors app.js change handler
  if (checked) expandAll();
  renderAllTables(lastMarketData || {});
}

// ── Tests ───────────────────────────────────────────────────────────────────

test("Show All checked: calls expandAll and renders with empty data when lastMarketData is null", () => {
  simulateShowAllChange(true, null);
  assert.strictEqual(expandAllCalled, true, "expandAll should be called");
  assert.deepStrictEqual(renderCalledWith, {}, "should render with {} when lastMarketData is null");
});

test("Show All checked: calls expandAll and renders with existing data", () => {
  const data = { T4_RUNE: { Lymhurst: { sell_price: 10 } } };
  simulateShowAllChange(true, data);
  assert.strictEqual(expandAllCalled, true, "expandAll should be called");
  assert.strictEqual(renderCalledWith, data, "should render with existing market data");
});

test("Show All unchecked: does NOT call expandAll, still renders", () => {
  simulateShowAllChange(false, null);
  assert.strictEqual(expandAllCalled, false, "expandAll should NOT be called when unchecking");
  assert.deepStrictEqual(renderCalledWith, {}, "should still render with {} when lastMarketData is null");
});

test("Show All unchecked with data: renders with existing data", () => {
  const data = { T4_SOUL: { Martlock: { sell_price: 149 } } };
  simulateShowAllChange(false, data);
  assert.strictEqual(expandAllCalled, false);
  assert.strictEqual(renderCalledWith, data);
});
