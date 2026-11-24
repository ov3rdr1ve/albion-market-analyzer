/**
 * Test (TLD): the Crafting Planner's "Reroll EV" column wiring.
 *
 * The column itself (js/craft-planner-reroll-ev.js) has its own unit suite;
 * this one proves the PLANNER integration:
 *   • every rendered row — data, no-data and enchanted-via alike — carries
 *     exactly as many <td> as the table has <th> in index.html (the column
 *     was inserted after Sell);
 *   • row.rerollEv is computed onto the row (it is what the sortable column
 *     reads, js/sorting-values-tables.js) and matches the module contract:
 *     null without per-quality prices, a positive number with a ladder;
 *   • the cell markup switches dim-dash → green +figure with the data.
 *
 * Drives the REAL render + pricing + reroll modules through the shared
 * harness (stitched sources, renderTableData capture, no DOM). No live API.
 *
 * Run: node tests/craft-planner-reroll-column.test.cjs
 */

const assert = require("assert");
const path = require("path");
const {
  renderCraftPlannerTable, captured, __setQualityMap, computeRerollEvUplift,
} = require("./helpers/craft-planner-render-harness.cjs");
const { getTableSpecificSortValue } = require(path.join(__dirname, "..", "js", "sorting-values-tables.js"));
const { readIndexHtml } = require("./helpers/page-source.cjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const FS = "Fort Sterling";
const CAE = "Caerleon";
const ITEM = "T8_ARMOR_PLATE_SET1"; // ARMOR slot equipment → rerollable

// Enough flat prices for a data row on the base item: mat priced, item sells.
function plannerMarket() {
  return {
    T8_METALBAR: { [FS]: { buy_price: 1000, volume_24h: 500 }, [CAE]: { buy_price: 1100, volume_24h: 500 } },
    [ITEM]: {
      [FS]: { sell_price: 80000, buy_price: 78000, volume_24h: 120 },
      [CAE]: { sell_price: 79000, buy_price: 77000, volume_24h: 90 },
    },
  };
}

// Per-quality ladder for the item at both cities the sell search can pick.
// Q5 priced far above Q1 so the optimal walk must reroll.
function qualityMap() {
  const ladder = { 1: 80000, 2: 90000, 3: 110000, 4: 150000, 5: 400000 };
  const map = { [ITEM]: {} };
  for (const q of Object.keys(ladder)) {
    map[ITEM][q] = {
      [FS]: { sell_price: ladder[q], buy_price: ladder[q] - 500 },
      [CAE]: { sell_price: ladder[q] - 1000, buy_price: ladder[q] - 1500 },
    };
  }
  return map;
}

function baseRow() {
  renderCraftPlannerTable(plannerMarket());
  const i = captured.rows.findIndex((r) => !r.noData && r.item && r.item.id === ITEM);
  assert.ok(i >= 0, "fixture sanity: expected a priced base-item row");
  return { row: captured.rows[i], html: captured.html[i] };
}

const headers = (() => {
  const html = readIndexHtml();
  const thead = html.match(/<table id="craft-planner-table"[\s\S]*?<\/thead>/);
  assert.ok(thead, "expected the planner thead in index.html");
  return (thead[0].match(/<th\b/g) || []).length;
})();

console.log("craft-planner Reroll EV column wiring (TLD)\n");

test("every rendered row has one cell per header (incl. the new column)", () => {
  __setQualityMap(qualityMap());
  renderCraftPlannerTable(plannerMarket());
  assert.ok(headers >= 12, `expected the planner header to carry the new column (got ${headers})`);
  assert.ok(captured.html.length > 0, "fixture sanity: expected rendered rows");
  captured.html.forEach((h, i) => {
    assert.ok(!h.startsWith("ERR:"), `row ${i} errored: ${h.slice(0, 120)}`);
    const cells = (h.match(/<td\b/g) || []).length;
    assert.strictEqual(cells, headers, `row ${i} has ${cells} cells for ${headers} headers`);
  });
  __setQualityMap({});
});

test("row.rerollEv is null without per-quality prices; the cell stays a dim dash", () => {
  __setQualityMap({});
  const { row, html } = baseRow();
  assert.ok("rerollEv" in row, "the row must carry the sortable rerollEv field");
  assert.strictEqual(row.rerollEv, null, "no quality map → null, not 0");
  assert.strictEqual(computeRerollEvUplift(ITEM, row.sellCity), null);
  // The dash cell exists between Sell and Profit — assert no green reroll cell.
  assert.ok(!/profit-high[^>]*>\+/.test(html), "no priced reroll cell may render");
});

test("a priced ladder puts a positive rerollEv on the row and a green +cell in the html", () => {
  __setQualityMap(qualityMap());
  const { row, html } = baseRow();
  assert.ok(row.sellCity, "fixture sanity: row chose a sell city");
  const direct = computeRerollEvUplift(ITEM, row.sellCity);
  assert.ok(direct !== null && direct > 0, "module contract: ladder → positive uplift");
  assert.strictEqual(row.rerollEv, direct, "the row books exactly the module's number");
  // Bounded above by "sell the best quality instead" — rerolling can't beat that.
  const cap = 400000 - 80000;
  assert.ok(direct <= cap, `uplift ${direct} exceeds the sell-Q5 cap ${cap}`);
  assert.ok(/class="silver-val profit-high"[^>]*>\+/.test(html), "expected the green +uplift cell");
  __setQualityMap({});
});

test("no-data rows keep the column and stay sortable-to-bottom", () => {
  __setQualityMap({});
  renderCraftPlannerTable(plannerMarket());
  const i = captured.rows.findIndex((r) => r.noData);
  assert.ok(i >= 0, "fixture sanity: expected a no-data row (unpriced .1–.4 variants)");
  assert.strictEqual(captured.rows[i].rerollEv, null);
  const cells = (captured.html[i].match(/<td\b/g) || []).length;
  assert.strictEqual(cells, headers, "no-data rows carry the new cell too");
});

test("the planner sort switch answers rerollEv (null sinks like the focus columns)", () => {
  assert.strictEqual(getTableSpecificSortValue({ rerollEv: 1234 }, "rerollEv", "craft-planner-table"), 1234);
  assert.strictEqual(getTableSpecificSortValue({ rerollEv: 0 }, "rerollEv", "craft-planner-table"), 0);
  assert.strictEqual(getTableSpecificSortValue({}, "rerollEv", "craft-planner-table"), -Infinity);
  assert.strictEqual(getTableSpecificSortValue({ rerollEv: null }, "rerollEv", "craft-planner-table"), -Infinity);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
