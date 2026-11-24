/**
 * Test: which pickers are allowed to trigger a full table re-render.
 *
 * The Consumables / Crafting / Craft Planner tables collapse their enchant
 * variant rows at render time, so a moved ENCHANT pick has to re-run
 * updateTableDisplay — the collapse gate reads that picker
 * (variantMatchesEnchantFilter, js/sorting.js) and a hidden variant row can
 * never come back from a DOM pass alone.
 *
 * Every OTHER picker was paying for that re-render too, and it is not cheap:
 * state.formatter over every row plus a whole tbody.innerHTML replacement, one
 * unbroken synchronous block measured in seconds on a real price map. The
 * gesture that starts it is a click on a <select>, and a native option popup
 * needs the same thread — so a Tier, Category or City pick froze the picker the
 * user was still holding open ("filters getting stuck").
 *
 * Pinned here: a moved enchant pick re-renders; a Tier / Category / Subcategory
 * / Buy City / Sell City pick re-filters the rendered rows instead; and picking
 * the same enchant value twice costs one re-render, not two.
 *
 * The re-pricing path (js/table-sell-city.js) is stubbed OFF throughout, so
 * these assertions are about this branch alone — a table whose City pick
 * re-prices takes an earlier exit, covered by
 * tests/flipping-city-pick-rerender.test.cjs.
 *
 * Black-box over the real js/table-search.js with a fake DOM. No live DOM, no
 * network.
 *
 * Run: node tests/table-filter-rerender-scope.test.cjs
 */

const assert = require("assert");

// getMarketCategory / MARKET_CATEGORY_TREE, reached as globals from the filters.
require("../js/data-item-categories.js");
globalThis.SELL_CITIES = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford",
  "Martlock", "Bridgewatch", "Brecilien", "Black Market"];
globalThis.CITIES = globalThis.SELL_CITIES.slice(0, 7);

// This file is about the RERENDER_ON_FILTER branch, so the re-pricing branch in
// front of it stays shut.
globalThis.tableRepricesOnCityPick = () => false;
globalThis.sellCityFilterChanged = () => false;
globalThis.buyCityFilterChanged = () => false;

let redraws = [];
globalThis.updateTableDisplay = (tableId) => { redraws.push(tableId); };
globalThis.window = {};

// ── fake DOM ────────────────────────────────────────────────────────────────

function makeSelect() {
  return { value: "", style: { display: "" }, options: [{ value: "", textContent: "All" }],
    appendChild(op) { this.options.push(op); },
    remove(i) { this.options.splice(i, 1); } };
}

/** A data <tr>: what classifyRow, the matchers and rowCities read off it. */
function makeRow({ rowKey, text = "", cityCells = [] }) {
  return {
    style: {},
    classList: { contains: () => false },
    hasAttribute: () => false,
    textContent: text,
    getAttribute: (a) => (a === "data-row-key" ? rowKey : null),
    querySelectorAll: (selector) => {
      const m = String(selector).match(/data-city-list="(\w+)"/);
      const want = m ? m[1] : null;
      return cityCells
        .filter((c) => !want || c.side === want)
        .map((c) => ({
          getAttribute: (a) => (a === "data-city" ? c.city : a === "data-city-list" ? c.side : null),
        }));
    },
  };
}

const TABLES = ["consumable-table", "crafting-table", "craft-planner-table"];

// One picker set + one tbody per table, keyed the way the module names them.
const dom = {};
TABLES.forEach((tableId) => {
  dom[tableId] = {
    input: { value: "" },
    tier: makeSelect(),
    ench: makeSelect(),
    cat: makeSelect(),
    subcat: makeSelect(),
    buyCity: makeSelect(),
    sellCity: makeSelect(),
    rows: [
      makeRow({ rowKey: "T4_POTION_HEAL|", text: "Minor Healing Potion",
        cityCells: [{ city: "Martlock", side: "buy" }, { city: "Caerleon", side: "sell" }] }),
      makeRow({ rowKey: "T6_POTION_HEAL|", text: "Major Healing Potion",
        cityCells: [{ city: "Thetford", side: "buy" }, { city: "Lymhurst", side: "sell" }] }),
    ],
  };
});

globalThis.document = {
  createElement: () => ({ value: "", textContent: "", setAttribute() {} }),
  getElementById(id) {
    for (const tableId of TABLES) {
      const d = dom[tableId];
      if (id === "search-" + tableId) return d.input;
      if (id === "tierfilter-" + tableId) return d.tier;
      if (id === "enchfilter-" + tableId) return d.ench;
      if (id === "catfilter-" + tableId) return d.cat;
      if (id === "subcatfilter-" + tableId) return d.subcat;
      if (id === "buycityfilter-" + tableId) return d.buyCity;
      if (id === "sellcityfilter-" + tableId) return d.sellCity;
    }
    return null;
  },
  querySelector(selector) {
    const m = String(selector).match(/^#([\w-]+) tbody$/);
    if (!m || !dom[m[1]]) return null;
    return { rows: dom[m[1]].rows };
  },
  querySelectorAll: () => [],
};

const { onFilterChange } = require("../js/table-search.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    TABLES.forEach((tableId) => {
      const d = dom[tableId];
      d.input.value = "";
      [d.tier, d.ench, d.cat, d.subcat, d.buyCity, d.sellCity].forEach((s) => { s.value = ""; });
      d.rows.forEach((r) => { r.style = {}; });
    });
    redraws = [];
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

console.log("Only a moved enchant pick may re-render these tables\n");

// The pickers that change which rows are SHOWN: a value each one filters by,
// and how many of the two rows survive it. Both rows are potions, so the
// category that names them keeps both and any other category keeps none.
const CHEAP_PICKERS = [
  ["Tier", "tier", "6", 1],
  ["Category", "cat", "consumables", 2],
  ["Category", "cat", "resources", 0],
  ["Subcategory", "subcat", "potion", 2],
  ["Buy City", "buyCity", "Martlock", 1],
  ["Sell City", "sellCity", "Caerleon", 1],
];

TABLES.forEach((tableId) => {
  CHEAP_PICKERS.forEach(([label, key, value, kept]) => {
    test(`${tableId}: a ${label}=${value} pick re-filters, never re-renders`, () => {
      dom[tableId][key].value = value;
      onFilterChange(tableId);
      assert.deepStrictEqual(redraws, [], `${label} must not call updateTableDisplay`);
      // The DOM pass ran instead, and it is what decided the rows.
      const shown = dom[tableId].rows.filter((r) => r.style.display !== "none");
      assert.strictEqual(shown.length, kept, `${label}=${value} should leave ${kept} row(s)`);
    });
  });

  test(`${tableId}: a moved enchant pick DOES re-render`, () => {
    dom[tableId].ench.value = "2";
    onFilterChange(tableId);
    assert.deepStrictEqual(redraws, [tableId]);
  });

  test(`${tableId}: re-picking the same enchant value re-renders once`, () => {
    dom[tableId].ench.value = "3";
    onFilterChange(tableId);
    onFilterChange(tableId);
    assert.deepStrictEqual(redraws, [tableId], "the second pass moved nothing");
  });

  test(`${tableId}: clearing the enchant back to All re-renders`, () => {
    dom[tableId].ench.value = "1";
    onFilterChange(tableId);
    redraws = [];
    dom[tableId].ench.value = "";
    onFilterChange(tableId);
    assert.deepStrictEqual(redraws, [tableId], "the variant rows have to come back");
  });
});

test("the first pick a table ever sees does not count as an enchant move", () => {
  // The remembered value starts undefined; reading it raw made the opening "All"
  // read as a change and bought one full re-render per table per session.
  const tableId = "consumable-table";
  dom[tableId].tier.value = "4";
  onFilterChange(tableId);
  assert.deepStrictEqual(redraws, []);
});

test("a table outside the set never re-renders on any pick", () => {
  const tableId = "mounts-table";
  onFilterChange(tableId);
  assert.deepStrictEqual(redraws, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
