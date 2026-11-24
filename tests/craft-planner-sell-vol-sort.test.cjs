/**
 * Test: the Crafting Planner sorts by sell volume.
 *
 * The Sell cell already prints "159 vol" under the price, but nothing could
 * order the table by it. The Sell header now carries a second click target,
 * "vol" (data-sort-sub="sellVol"), and every planner row carries `sellVol` —
 * the 24h volume at the row's own sell city, a hand-typed volume first.
 *
 * Black box over computeCraftPlannerRow, the planner's sort values, and the
 * index.html / app.js wiring. Synthetic prices only.
 *
 * Run: node tests/craft-planner-sell-vol-sort.test.cjs
 */

const fs = require("fs");
const { appSource } = require("./helpers/app-source.cjs");
const path = require("path");
const assert = require("assert");
const M = require("./helpers/craft-planner-pricing-harness.cjs");
const { getTableSpecificSortValue } = require("../js/sorting-values-tables.js");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const { computeCraftPlannerRow, __setVolumeOverrides, __reset } = M;

let passed = 0, failed = 0;
function test(name, fn) {
  try { __reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const FS = "Fort Sterling";
const TABLE = { id: "T8_FURNITUREITEM_TABLE", name: "Elder's Table", craftType: null };
const TABLE_MATS = [{ matId: "T8_PLANKS", count: 30 }];

function market({ sellCities }) {
  const md = { T8_PLANKS: { [FS]: { buy_price: 1000, sell_price: 1000, volume_24h: 5000 } } };
  md[TABLE.id] = {};
  sellCities.forEach(([city, price, vol]) => {
    md[TABLE.id][city] = { buy_price: 0, sell_price: price, volume_24h: vol };
  });
  return md;
}

console.log("=== the row carries sellVol at its own sell city ===");

[
  { name: "one sell city", cities: [[FS, 60000, 159]], city: FS, vol: 159 },
  { name: "the best-paying city's volume, not the biggest book",
    cities: [[FS, 60000, 10], ["Lymhurst", 50000, 90000]], city: FS, vol: 10 },
  { name: "a city with no volume reads 0", cities: [[FS, 60000, 0]], city: FS, vol: 0 },
].forEach(({ name, cities, city, vol }) => {
  test(name, () => {
    const row = computeCraftPlannerRow(TABLE, TABLE_MATS, market({ sellCities: cities }), FS);
    assert.ok(!row.noData, "fixture should price");
    assert.strictEqual(row.sellCity, city);
    assert.strictEqual(row.sellVol, vol);
  });
});

test("a hand-typed volume wins over the market's", () => {
  __setVolumeOverrides({ [`${TABLE.id}:${FS}`]: 777 });
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, market({ sellCities: [[FS, 60000, 159]] }), FS);
  assert.strictEqual(row.sellVol, 777);
});

test("a no-data row carries no sellVol figure", () => {
  const md = market({ sellCities: [] });
  const row = computeCraftPlannerRow(TABLE, TABLE_MATS, md, FS);
  assert.ok(row.noData);
  assert.ok(!(row.sellVol > 0));
});

console.log("\n=== the sort value ===");

[
  [{ sellVol: 159 }, 159],
  [{ sellVol: 0 }, 0],
  [{}, 0],
  [{ noData: true }, 0],
].forEach(([row, expected]) => {
  test(`sellVol sort value of ${JSON.stringify(row)} is ${expected}`, () => {
    assert.strictEqual(getTableSpecificSortValue(row, "sellVol", "craft-planner-table"), expected);
  });
});

test("rows order by volume, descending", () => {
  const rows = [{ sellVol: 5 }, { sellVol: 900 }, { sellVol: 60 }];
  const sorted = rows.slice().sort((a, b) =>
    getTableSpecificSortValue(b, "sellVol", "craft-planner-table")
    - getTableSpecificSortValue(a, "sellVol", "craft-planner-table"));
  assert.deepStrictEqual(sorted.map((r) => r.sellVol), [900, 60, 5]);
});

console.log("\n=== wiring ===");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const html = readIndexHtml();
const thead = html.match(/<table id="craft-planner-table"[\s\S]*?<\/thead>/)[0];
const sellTh = thead.match(/<th data-sort="revenue"[\s\S]*?<\/th>/)[0];

test("the Sell header keeps its price sort and adds a vol sub-key", () => {
  assert.ok(/class="sortable"/.test(sellTh));
  assert.ok(/data-sort-sub="sellVol"/.test(sellTh), "no vol sub-key: " + sellTh);
});

test("the Sell label is translated on an inner span, not the th (which would wipe the link)", () => {
  assert.ok(!/<th[^>]*\sdata-i18n="/.test(sellTh), "th-level data-i18n replaces its children");
  assert.ok(/<span data-i18n="sell">Sell<\/span>/.test(sellTh));
  assert.ok(/data-sort-sub="sellVol"[^>]*data-i18n="vol_sort"/.test(sellTh));
});

test("the header click reads the sub-key before the th's own key", () => {
  const app = appSource();
  assert.ok(/closest\("\[data-sort-sub\]"\)/.test(app), "click handler ignores data-sort-sub");
  assert.ok(/sub \? sub\.getAttribute\("data-sort-sub"\) : th\.getAttribute\("data-sort"\)/.test(app));
});

test("the arrow is restored onto the sub-key after a render", () => {
  const sorting = read("js/sorting.js");
  assert.ok(/\[data-sort-sub="\$\{state\.sortCol\}"\]/.test(sorting));
});

// My Crafting List clones each source header's label; the sub-key must not
// leak into it as "Sell vol".
const { _clThLabel } = require("../js/render-craft-list-header.js");
const fakeTh = (text, subText) => ({
  textContent: text,
  querySelector: (sel) => (subText != null && sel === "[data-sort-sub]" ? { textContent: subText } : null),
});
[
  ["Sell vol", "vol", "Sell"],
  ["Venta vol", "vol", "Venta"],
  ["  Cost  ", null, "Cost"],
  ["Volume vol", "vol", "Volume"],
].forEach(([text, sub, expected]) => {
  test(`craft list label of "${text}" is "${expected}"`, () => {
    assert.strictEqual(_clThLabel(fakeTh(text, sub)), expected);
  });
});

test("both languages carry the vol label and its tooltip", () => {
  const en = read("js/i18n-strings-en.js");
  const es = read("js/i18n-strings-es.js");
  ["vol_sort", "sort_by_the_24h_sell_volume_at_each_row_s_sell"].forEach((k) => {
    assert.ok(new RegExp(`"?${k}"?\\s*:`).test(en), `EN missing ${k}`);
    assert.ok(new RegExp(`"?${k}"?\\s*:`).test(es), `ES missing ${k}`);
  });
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
