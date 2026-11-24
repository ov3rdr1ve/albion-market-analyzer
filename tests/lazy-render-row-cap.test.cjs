/**
 * Test: Lazy table rendering — collapsed tables skip DOM rendering,
 * expanding re-renders from cached tableState.data.
 *
 * Run: node tests/lazy-render-row-cap.test.cjs
 */

const fs = require("fs");
const { appSource } = require("./helpers/app-source.cjs");
const path = require("path");
const assert = require("assert");

const sortingSrc = fs.readFileSync(path.join(__dirname, "..", "js/sorting.js"), "utf-8");
const appSrc = appSource();

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

console.log("Lazy Table Rendering Tests\n");

test("isTableCollapsed function is defined in sorting.js", () => {
  assert.ok(sortingSrc.includes("function isTableCollapsed(tableId)"));
});

test("isTableCollapsed defers to isTableHidden, so a collapsed wrap counts", () => {
  // Reading only the <table>'s own display missed both ways a table is hidden:
  // per-table collapse hides the .table-wrap and group collapse folds the
  // .tgroup band. See js/render-gating.js.
  assert.ok(
    /isTableHidden\(tableId\)/.test(sortingSrc),
    "isTableCollapsed must delegate to isTableHidden",
  );
});

test("renderTableData checks isTableCollapsed before updateTableDisplay", () => {
  assert.ok(appSrc.includes("isTableCollapsed(tbodyId)"));
});

test("setCollapsed clears tbody.innerHTML when collapsing", () => {
  assert.ok(
    appSrc.includes('tbody.innerHTML = ""') || appSrc.includes("tbody.innerHTML = ''"),
  );
});

test("setCollapsed calls updateTableDisplay when expanding", () => {
  const expandBlock = appSrc.match(/localStorage\.removeItem[\s\S]{0,600}updateTableDisplay/);
  assert.ok(expandBlock);
});

test("expanding recomputes a table the last redraw skipped, before the cache replay", () => {
  // A hidden table is not computed at all, so its tableState cache is older
  // than the prices in hand — replaying it would show stale numbers.
  const expand = appSrc.match(/localStorage\.removeItem\(`table-collapsed[\s\S]{0,600}updateTableDisplay/);
  assert.ok(expand, "expand branch not found");
  const deferredIdx = expand[0].indexOf("renderDeferredTable");
  const cacheIdx = expand[0].indexOf("updateTableDisplay");
  assert.ok(deferredIdx >= 0, "expand must try the deferred render");
  assert.ok(deferredIdx < cacheIdx, "the deferred render must come before the cache replay");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
