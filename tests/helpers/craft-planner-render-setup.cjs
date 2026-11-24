// Shared setup for tests/craft-planner-render-*.test.cjs (split from craft-planner-render.test.cjs).
// Each part requires this once; `test` and `finish` keep one pass/fail tally per part.
const assert = require("assert");
const { readIndexHtml } = require("./page-source.cjs");
const { renderCraftPlannerTable, captured, _cpFocusCell, _cpMatLine, _cpJumpToRefine,
  __setFocus, __setCraftSpec, getCraftJournalFill, _cpBestSell, expandCraftPlannerItems,
  _cpNameTd, setHouseTier, __setForce, __setCrossRoute, __setQualityMap,
  __expand, __collapseAll } = require("./craft-planner-render-harness.cjs");

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log(`  PASS: ${name}`); passed++; } catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; } }
// Mirrors the sandbox's formatSilver so assertions can quote a rendered figure.
function formatSilverLocal(n) { return Math.round(n).toLocaleString(); }
// Mirrors the sandbox's getRowKey (js/sorting.js:224 in prod).
function getRowKeyLocal(row) { return ((row.item && row.item.id) || "") + "|" + (row.craftCity || "") + "|" + (row.section || ""); }

const FS = "Fort Sterling";
const market = {
  T8_PLANKS:   { [FS]: { buy_price: 1000, sell_price: 1100, volume_24h: 500 } },
  T8_METALBAR: { [FS]: { buy_price: 1200, sell_price: 1300, volume_24h: 500 } },
  T8_FURNITUREITEM_TABLE: { [FS]: { sell_price: 60000, volume_24h: 80 } },
  T8_ARMOR_PLATE_SET1:    { [FS]: { sell_price: 80000, volume_24h: 120 } },
  T8_JOURNAL_TOOLMAKER_EMPTY: { [FS]: { buy_price: 5000 } },
  T8_JOURNAL_TOOLMAKER_FULL:  { [FS]: { sell_price: 20000, volume_24h: 30 } },
  T8_JOURNAL_WARRIOR_EMPTY:   { [FS]: { buy_price: 4000 } },
  T8_JOURNAL_WARRIOR_FULL:    { [FS]: { sell_price: 18000, volume_24h: 30 } },
};


function finish() {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

module.exports = {
  assert, readIndexHtml, renderCraftPlannerTable, captured, _cpFocusCell, _cpMatLine, _cpJumpToRefine, __setFocus, __setCraftSpec, getCraftJournalFill, _cpBestSell, expandCraftPlannerItems, _cpNameTd, setHouseTier, __setForce, __setCrossRoute, __setQualityMap, __expand, __collapseAll, passed, failed, test, formatSilverLocal, getRowKeyLocal, FS, market, finish,
};
