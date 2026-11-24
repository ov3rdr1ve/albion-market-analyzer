/**
 * Black-box tests for SEEDED filter pickers (js/table-filters.js +
 * js/table-search.js).
 *
 * The feature: a table's Category / Subcategory / Buy City / Sell City pickers
 * are built with their full catalog option lists at injection time, so the
 * table's <h2> carries the same controls whether the table is collapsed, open,
 * scanned or not. Before this, the pickers were born empty and hidden and only
 * appeared once a filter pass had walked rendered rows — which a collapsed (or
 * never-scanned) table never has, so opening a table changed the shape of its
 * header.
 *
 * Once real rows exist, the first pass still prunes each list to what those
 * rows carry: seeding decides what the header shows BEFORE that, nothing else.
 *
 * Assertions are input→output only, over a tiny fake DOM. No live DOM, no
 * network.
 *
 * Run: node tests/table-filter-seed-options.test.cjs
 */

const assert = require("assert");

require("../js/data-item-categories.js");
require("../js/table-sell-city.js");
globalThis.SELL_CITIES = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford",
  "Martlock", "Bridgewatch", "Brecilien", "Black Market"];
globalThis.CITIES = globalThis.SELL_CITIES.slice(0, 7);
// js/table-search.js calls tx()/t() bare when it labels the Tier and Ench.
// pickers; in the browser js/i18n.js publishes both. Identity stubs keep the
// English labels, which is all these assertions read.
globalThis.tx = (en) => en;
globalThis.t = (slug) => slug;

const filters = require("../js/table-filters.js");
const {
  injectCategoryControls,
  injectBuyCityControl,
  injectSellCityControl,
  injectCityControl,
  categoryFilterId,
  subcategoryFilterId,
  buyCityFilterId,
  sellCityFilterId,
  cityFilterId,
  knownCities,
} = filters;
const { MARKET_CATEGORY_TREE } = require("../js/data-item-categories.js");

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

// ── fake DOM ────────────────────────────────────────────────────────────────
//
// Enough of one for the injectors: createElement for <select>/<option>/<button>,
// a parent that can insertBefore, and getElementById over everything inserted
// (which is also what makes the injectors' idempotency check real).

function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: "",
    className: "",
    value: "",
    textContent: "",
    style: { cssText: "", display: "" },
    options: [],
    children: [],
    parentNode: null,
    nextSibling: null,
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    addEventListener() {},
    appendChild(child) {
      if (this.tagName === "SELECT") this.options.push(child);
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    remove(i) { this.options.splice(i, 1); },
  };
  return el;
}

/** A table's <h2> holding just its search input, as index.html ships it. */
function mountHeading() {
  const registry = new Map();
  const heading = makeElement("h2");
  heading.insertBefore = (node, before) => {
    const at = before ? heading.children.indexOf(before) : heading.children.length;
    heading.children.splice(at < 0 ? heading.children.length : at, 0, node);
    node.parentNode = heading;
    // Re-link the sibling chain so chained injectors land in order.
    heading.children.forEach((c, i) => { c.nextSibling = heading.children[i + 1] || null; });
    if (node.id) registry.set(node.id, node);
    return node;
  };
  global.document = {
    createElement: (tag) => makeElement(tag),
    getElementById: (id) => registry.get(id) || null,
  };
  const input = makeElement("input");
  heading.children.push(input);
  input.parentNode = heading;
  return { heading, input, registry, get: (id) => registry.get(id) || null };
}

/** The values a seeded <select> offers, skipping its leading "All". */
function optionValues(sel) {
  return sel.options.map((o) => o.value).filter((v) => v !== "");
}

console.log("Seeded table filter pickers\n");

// ── seeded at injection, before anything renders ────────────────────────────

test("Category and Subcategory are visible with no rows rendered", () => {
  const dom = mountHeading();
  injectCategoryControls("transport-table", dom.input, () => {});
  const cat = dom.get(categoryFilterId("transport-table"));
  const sub = dom.get(subcategoryFilterId("transport-table"));
  assert.ok(cat, "category select injected");
  assert.ok(sub, "subcategory select injected");
  assert.notStrictEqual(cat.style.display, "none");
  assert.notStrictEqual(sub.style.display, "none");
});

test("seeded Category options are the whole taxonomy", () => {
  const dom = mountHeading();
  injectCategoryControls("transport-table", dom.input, () => {});
  assert.deepStrictEqual(
    optionValues(dom.get(categoryFilterId("transport-table"))),
    MARKET_CATEGORY_TREE.map((c) => c.key),
  );
});

test("seeded Subcategory options cover every category's subs, labelled with it", () => {
  const dom = mountHeading();
  injectCategoryControls("transport-table", dom.input, () => {});
  const sub = dom.get(subcategoryFilterId("transport-table"));
  const wanted = [];
  MARKET_CATEGORY_TREE.forEach((c) => c.subs.forEach((s) => wanted.push(s.key)));
  assert.deepStrictEqual(optionValues(sub), wanted);
  const first = MARKET_CATEGORY_TREE[0];
  assert.strictEqual(
    sub.options.find((o) => o.value === first.subs[0].key).textContent,
    `${first.label} · ${first.subs[0].label}`,
  );
});

test("Buy City and Sell City are visible with no rows rendered", () => {
  const dom = mountHeading();
  injectBuyCityControl("consumable-table", dom.input, () => {});
  injectSellCityControl("consumable-table", dom.input, () => {});
  const buy = dom.get(buyCityFilterId("consumable-table"));
  const sell = dom.get(sellCityFilterId("consumable-table"));
  assert.ok(buy && sell, "both city selects injected");
  assert.notStrictEqual(buy.style.display, "none");
  assert.notStrictEqual(sell.style.display, "none");
});

test("a re-pricing table seeds its own fixed city list", () => {
  const dom = mountHeading();
  injectSellCityControl("transport-table", dom.input, () => {});
  assert.deepStrictEqual(
    optionValues(dom.get(sellCityFilterId("transport-table"))),
    globalThis.CITIES,
  );
  const dom2 = mountHeading();
  injectSellCityControl("consumable-table", dom2.input, () => {});
  assert.deepStrictEqual(
    optionValues(dom2.get(sellCityFilterId("consumable-table"))),
    globalThis.SELL_CITIES,
  );
  const dom3 = mountHeading();
  injectBuyCityControl("consumable-table", dom3.input, () => {});
  assert.deepStrictEqual(
    optionValues(dom3.get(buyCityFilterId("consumable-table"))),
    globalThis.CITIES,
  );
});

test("a table with no fixed list seeds every known market", () => {
  const dom = mountHeading();
  injectSellCityControl("gathering-table", dom.input, () => {});
  assert.deepStrictEqual(
    optionValues(dom.get(sellCityFilterId("gathering-table"))),
    knownCities(),
  );
});

test("a seeded Buy City never offers the Black Market", () => {
  const dom = mountHeading();
  injectBuyCityControl("gathering-table", dom.input, () => {});
  const offered = optionValues(dom.get(buyCityFilterId("gathering-table")));
  assert.deepStrictEqual(offered, globalThis.CITIES);
  assert.ok(!offered.includes("Black Market"));
});

test("the volume table's combined City picker is seeded too", () => {
  const dom = mountHeading();
  injectCityControl("volume-table", dom.input, () => {});
  const city = dom.get(cityFilterId("volume-table"));
  assert.deepStrictEqual(optionValues(city), knownCities());
  assert.notStrictEqual(city.style.display, "none");
});

test("injection stays idempotent", () => {
  const dom = mountHeading();
  injectCategoryControls("transport-table", dom.input, () => {});
  injectCategoryControls("transport-table", dom.input, () => {});
  injectSellCityControl("transport-table", dom.input, () => {});
  injectSellCityControl("transport-table", dom.input, () => {});
  const ids = dom.heading.children.map((c) => c.id).filter(Boolean);
  assert.deepStrictEqual(ids, [...new Set(ids)]);
});

// ── which tables get pickers at all ─────────────────────────────────────────

const {
  injectFilterControls,
  NO_MARKET_ROW_TABLES,
  NO_SIDE_CITY_TABLES,
} = require("../js/table-search.js");

test("a table whose rows are not market items gets no Category or City picker", () => {
  for (const tableId of NO_MARKET_ROW_TABLES) {
    const dom = mountHeading();
    injectFilterControls(tableId, dom.input, () => {});
    assert.strictEqual(dom.get(categoryFilterId(tableId)), null, tableId);
    assert.strictEqual(dom.get(subcategoryFilterId(tableId)), null, tableId);
    assert.strictEqual(dom.get(buyCityFilterId(tableId)), null, tableId);
    assert.strictEqual(dom.get(sellCityFilterId(tableId)), null, tableId);
  }
});

test("a market table gets the full picker row in in-game order", () => {
  const dom = mountHeading();
  injectFilterControls("transport-table", dom.input, () => {});
  assert.deepStrictEqual(
    dom.heading.children.map((c) => c.id).filter(Boolean),
    [
      "catfilter-transport-table",
      "subcatfilter-transport-table",
      "tierfilter-transport-table",
      "enchfilter-transport-table",
      "buycityfilter-transport-table",
      "sellcityfilter-transport-table",
      "clear-filters-transport-table",
    ],
  );
});

test("a table that tags no price cell with a side gets no split city picker", () => {
  for (const tableId of NO_SIDE_CITY_TABLES) {
    const dom = mountHeading();
    injectFilterControls(tableId, dom.input, () => {});
    assert.strictEqual(dom.get(buyCityFilterId(tableId)), null, tableId);
    assert.strictEqual(dom.get(sellCityFilterId(tableId)), null, tableId);
    // It is a market table, so the category pickers stay.
    assert.ok(dom.get(categoryFilterId(tableId)), tableId);
  }
});

test("the buildings table keeps Buy City but never gets a category picker", () => {
  const dom = mountHeading();
  injectFilterControls("buildings-table", dom.input, () => {});
  assert.strictEqual(dom.get(categoryFilterId("buildings-table")), null);
  assert.ok(dom.get(buyCityFilterId("buildings-table")));
});

// ── an empty tbody never blanks a seed ──────────────────────────────────────

const { applyTableSearchFilter } = require("../js/table-search.js");

/**
 * Run a real filter pass over `rows` against seeded pickers, and hand back the
 * selects so the test can read what the pass left them offering.
 */
function passOver(tableId, rows) {
  const dom = mountHeading();
  injectFilterControls(tableId, dom.input, () => {});
  const heading = global.document;
  const tbody = { rows };
  global.document = {
    createElement: (tag) => makeElement(tag),
    getElementById: (id) => (id === "search-" + tableId ? dom.input : heading.getElementById(id)),
    querySelector: (sel) => (sel === `#${tableId} tbody` ? tbody : null),
  };
  applyTableSearchFilter(tableId);
  return dom;
}

function makeRow({ rowKey = "", text = "", cityCells = [] } = {}) {
  return {
    textContent: text,
    style: { display: "" },
    classList: { contains: () => false },
    hasAttribute: () => false,
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

test("a pass over an empty tbody leaves the seeds alone", () => {
  const dom = passOver("transport-table", []);
  const cat = dom.get(categoryFilterId("transport-table"));
  const sell = dom.get(sellCityFilterId("transport-table"));
  assert.deepStrictEqual(optionValues(cat), MARKET_CATEGORY_TREE.map((c) => c.key));
  assert.deepStrictEqual(optionValues(sell), globalThis.CITIES);
  assert.notStrictEqual(cat.style.display, "none");
  assert.notStrictEqual(sell.style.display, "none");
});

test("a pass over real rows still prunes to what those rows carry", () => {
  const dom = passOver("gathering-table", [
    makeRow({
      rowKey: "T4_ORE|T4_METALBAR|",
      text: "T4 Ore",
      cityCells: [{ city: "Martlock", side: "buy" }, { city: "Caerleon", side: "sell" }],
    }),
  ]);
  assert.deepStrictEqual(
    optionValues(dom.get(categoryFilterId("gathering-table"))),
    ["resources", "refinedresources"],
  );
  assert.deepStrictEqual(
    optionValues(dom.get(buyCityFilterId("gathering-table"))),
    ["Martlock"],
  );
  assert.deepStrictEqual(
    optionValues(dom.get(sellCityFilterId("gathering-table"))),
    ["Caerleon"],
  );
});

test("a picker with genuinely nothing to offer still hides itself after a pass", () => {
  const dom = passOver("gathering-table", [
    makeRow({ rowKey: "T4_ORE|", text: "T4 Ore" }), // no side-tagged price cells
  ]);
  assert.strictEqual(dom.get(buyCityFilterId("gathering-table")).style.display, "none");
  assert.strictEqual(dom.get(sellCityFilterId("gathering-table")).style.display, "none");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
