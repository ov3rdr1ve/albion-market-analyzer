/**
 * Black-box tests for the in-game-style table filters (js/table-filters.js).
 *
 * The feature: alongside the free-text box and the Tier/Ench. pickers, every
 * data table grows the two levels the in-game Marketplace filters by —
 * Category ▸ Subcategory — plus a City picker. Category comes from the items.xml
 * shop taxonomy (js/data-item-categories.js); City is read off the rendered row.
 *
 * Assertions are input→output only: given a row and a set of picker values, does
 * the row survive? No live DOM, no network.
 *
 * Run: node tests/table-filters.test.cjs
 */

const assert = require("assert");

// Publishes getMarketCategory / MARKET_CATEGORY_TREE as globals, which is how
// table-filters.js reaches them in the browser too.
require("../js/data-item-categories.js");
// Same deal for the City pick: table-filters.js probes `sellCityOptionsFor` as a
// global, and a re-pricing table's picker offers every sell city rather than
// only the ones its rows currently name.
require("../js/table-sell-city.js");
globalThis.SELL_CITIES = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford",
  "Martlock", "Bridgewatch", "Brecilien", "Black Market"];
globalThis.CITIES = globalThis.SELL_CITIES.slice(0, 7);
const {
  idsFromRowKey,
  rowCategoryPairs,
  rowPassesCategory,
  rowCities,
  rowPassesCity,
  rowPassesBuyCity,
  rowPassesSellCity,
  syncSelectOptions,
  syncCategoryOptions,
  syncCityOptions,
  categoryFilterId,
  subcategoryFilterId,
  cityFilterId,
  buyCityFilterId,
  sellCityFilterId,
  syncSideCityOptions,
} = require("../js/table-filters.js");
const { getMarketCategory, marketCategoryBaseId } = require("../js/data-item-categories.js");

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

// ── fakes ────────────────────────────────────────────────────────────────────

/** A <tr> needs only getAttribute, textContent and (optionally) querySelectorAll. */
function makeRow({ rowKey = "", text = "", cityCells = null } = {}) {
  const tr = {
    textContent: text,
    getAttribute: (a) => (a === "data-row-key" ? rowKey : null),
  };
  // A cityCells entry is either a bare city (untagged, so the combined pick sees
  // it and neither side pick does) or { city, side } — the data-city /
  // data-city-list pair js/app.js priceTd and matPriceSpan emit.
  if (cityCells) {
    const cells = cityCells.map((c) => (typeof c === "string" ? { city: c, side: null } : c));
    tr.querySelectorAll = (selector) => {
      const m = String(selector).match(/data-city-list="(\w+)"/);
      const want = m ? m[1] : null;
      return cells
        .filter((c) => !want || c.side === want)
        .map((c) => ({
          getAttribute: (a) => (a === "data-city" ? c.city : a === "data-city-list" ? c.side : null),
        }));
    };
  }
  return tr;
}

/**
 * A <select> with the leading "All" option, as buildFilterSelect leaves it.
 *
 * `value` models the real element: assigning a value no <option> carries is
 * silently ignored (the browser leaves the select where it was). The option-sync
 * code depends on that, so a plain `{ value }` object would hide the bug it
 * guards against.
 */
function makeSelect(value = "") {
  const options = [{ value: "", textContent: "All" }];
  let current = "";
  const sel = {
    style: { display: "" },
    options,
    appendChild: (op) => options.push(op),
    // Removing the selected <option> snaps a real select back to its first one.
    remove: (i) => {
      const [gone] = options.splice(i, 1);
      if (gone && gone.value === current) current = options[0] ? options[0].value : "";
    },
    get value() {
      return current;
    },
    set value(v) {
      if (options.some((o) => o.value === v)) current = v;
    },
  };
  if (value) {
    options.push({ value, textContent: value });
    sel.value = value;
  }
  return sel;
}

/** Minimal document so syncSelectOptions can build <option>s and find selects. */
function mountDocument(byId = {}) {
  global.document = {
    createElement: () => ({ value: "", textContent: "", setAttribute() {} }),
    getElementById: (id) => byId[id] || null,
  };
}

console.log("Table Filters (Category / Subcategory / City) Tests\n");

// ── the generated taxonomy ───────────────────────────────────────────────────

test("base id strips the tier prefix, _LEVELn and the @n enchant", () => {
  assert.strictEqual(marketCategoryBaseId("T4_2H_BOW@2"), "2H_BOW");
  assert.strictEqual(marketCategoryBaseId("T5_PLANKS_LEVEL3@3"), "PLANKS");
  assert.strictEqual(marketCategoryBaseId("T4_ORE"), "ORE");
});

test("every tier and enchant of one item resolves to the same category", () => {
  const want = { category: "ranged", subcategory: "bow" };
  ["T4_2H_BOW", "T8_2H_BOW", "T6_2H_BOW@3"].forEach((id) => {
    assert.deepStrictEqual(getMarketCategory(id), want, id);
  });
});

test("an id items.xml lists no shop category for resolves to null", () => {
  assert.strictEqual(getMarketCategory("UNIQUE_UNLOCK_CAPE_VANITY_MADE_UP"), null);
});

// ── category matching ────────────────────────────────────────────────────────

test("row with no picks passes regardless of category", () => {
  const tr = makeRow({ rowKey: "T4_ORE|Thetford" });
  assert.strictEqual(rowPassesCategory(tr, "", ""), true);
});

test("category pick keeps a matching row and drops a mismatching one", () => {
  const ore = makeRow({ rowKey: "T4_ORE|Thetford" });
  const bow = makeRow({ rowKey: "T4_2H_BOW|Lymhurst" });
  assert.strictEqual(rowPassesCategory(ore, "resources", ""), true);
  assert.strictEqual(rowPassesCategory(bow, "resources", ""), false);
});

test("subcategory narrows within a category", () => {
  const ore = makeRow({ rowKey: "T4_ORE|Thetford" });
  assert.strictEqual(rowPassesCategory(ore, "resources", "ore"), true);
  assert.strictEqual(rowPassesCategory(ore, "resources", "planks"), false);
});

test("subcategory alone (no category picked) still filters", () => {
  const ore = makeRow({ rowKey: "T4_ORE|Thetford" });
  const planks = makeRow({ rowKey: "T4_PLANKS|Lymhurst" });
  assert.strictEqual(rowPassesCategory(ore, "", "ore"), true);
  assert.strictEqual(rowPassesCategory(planks, "", "ore"), false);
});

test("a two-id row (raw → refined) matches on either of its ids", () => {
  const tr = makeRow({ rowKey: "T4_ORE|T4_METALBAR|Thetford|" });
  assert.strictEqual(rowPassesCategory(tr, "resources", "ore"), true);
  assert.strictEqual(rowPassesCategory(tr, "refinedresources", "metalbar"), true);
});

test("row categories come from the row key only — a material never leaks in", () => {
  // Crafting rows are keyed "<product>|<craftCity>"; the metal bar the recipe
  // consumes is not in the key, so the row must not answer to "Resources".
  const tr = makeRow({ rowKey: "T5_ARMOR_PLATE_SET1|Martlock", text: "T5 Metal Bar 8x" });
  assert.strictEqual(rowPassesCategory(tr, "armor", ""), true);
  assert.strictEqual(rowPassesCategory(tr, "resources", ""), false);
});

test("an uncategorised row is hidden while a category pick is active", () => {
  const tr = makeRow({ rowKey: "acquire|steady|Lymhurst", text: "Mercenary" });
  assert.strictEqual(rowPassesCategory(tr, "resources", ""), false);
  assert.strictEqual(rowPassesCategory(tr, "", ""), true); // but visible with no pick
});

test("rowCategoryPairs dedupes ids that share a category", () => {
  const tr = makeRow({ rowKey: "T4_ORE|T5_ORE|T6_ORE|Thetford" });
  assert.deepStrictEqual(rowCategoryPairs(tr), [{ category: "resources", subcategory: "ore" }]);
});

// ── city matching ────────────────────────────────────────────────────────────

test("city is read from the price cells' data-city", () => {
  const tr = makeRow({ rowKey: "T4_ORE|", cityCells: ["Thetford", "Caerleon"] });
  assert.deepStrictEqual([...rowCities(tr)].sort(), ["Caerleon", "Thetford"]);
});

test("city is read from a city-named row-key segment", () => {
  const tr = makeRow({ rowKey: "T4_ORE|T4_METALBAR|Fort Sterling|" });
  assert.strictEqual(rowPassesCity(tr, "Fort Sterling"), true);
  assert.strictEqual(rowPassesCity(tr, "Martlock"), false);
});

test("city falls back to the rendered text when nothing else names one", () => {
  const tr = makeRow({ rowKey: "T4_ORE|royal", text: "T4 Ore  Bridgewatch  1,200" });
  assert.strictEqual(rowPassesCity(tr, "Bridgewatch"), true);
});

test("a buy-here sell-there row answers to BOTH cities", () => {
  const tr = makeRow({ rowKey: "T4_ORE|", cityCells: ["Thetford", "Caerleon"] });
  assert.strictEqual(rowPassesCity(tr, "Thetford"), true);
  assert.strictEqual(rowPassesCity(tr, "Caerleon"), true);
  assert.strictEqual(rowPassesCity(tr, "Lymhurst"), false);
});

test("no city pick passes every row, including cityless ones", () => {
  assert.strictEqual(rowPassesCity(makeRow({ rowKey: "T4_ORE|" }), ""), true);
});

// ── buy / sell city matching ─────────────────────────────────────────────────
// The combined pick above answers to either end of a route, which is exactly
// what made it useless for "show me only what I buy in Martlock". The split
// pickers read the side each price cell is tagged with (data-city-list) and
// nothing else — a row key and rendered text carry no side.

const routeRow = () =>
  makeRow({
    rowKey: "T4_ORE|T4_METALBAR|Martlock|",
    cityCells: [{ city: "Martlock", side: "buy" }, { city: "Caerleon", side: "sell" }],
  });

const SIDE_CASES = [
  ["buy pick matches the buy leg", rowPassesBuyCity, "Martlock", true],
  ["buy pick does NOT match the sell leg", rowPassesBuyCity, "Caerleon", false],
  ["sell pick matches the sell leg", rowPassesSellCity, "Caerleon", true],
  ["sell pick does NOT match the buy leg", rowPassesSellCity, "Martlock", false],
  ["buy pick misses a city the row never names", rowPassesBuyCity, "Lymhurst", false],
  ["an empty buy pick passes everything", rowPassesBuyCity, "", true],
  ["an empty sell pick passes everything", rowPassesSellCity, "", true],
];

SIDE_CASES.forEach(([name, fn, pick, expected]) => {
  test(name, () => assert.strictEqual(fn(routeRow(), pick), expected));
});

// On a table whose City pick re-prices (Flipping routes both legs against it),
// the pick is already honoured at build time. Re-filtering the rendered rows on
// top would hide the very rows the re-routing produced — a "no data" row for a
// city with no book names no city at all — so the DOM pass stands down.
[
  ["a re-pricing table's buy pick is owned by the router", rowPassesBuyCity, "Lymhurst"],
  ["a re-pricing table's sell pick is owned by the router", rowPassesSellCity, "Lymhurst"],
].forEach(([name, fn]) => {
  test(name, () => {
    assert.strictEqual(fn(routeRow(), "Lymhurst", "flipping-table"), true);
    // Mounts re-prices both legs too (it sources the baby, the feed and every
    // saddler mat wherever cheapest), so its DOM pass stands down as well.
    assert.strictEqual(fn(routeRow(), "Lymhurst", "mounts-table"), true);
    // A filter-only table (skins-trading) still judges the rendered row.
    assert.strictEqual(fn(routeRow(), "Lymhurst", "skins-trading-table"), false);
    assert.strictEqual(fn(routeRow(), "Lymhurst"), false,
      "and so does a caller that names no table");
  });
});

test("rowCities(tr, side) reads only that side's cells", () => {
  const tr = routeRow();
  assert.deepStrictEqual([...rowCities(tr, "buy")], ["Martlock"]);
  assert.deepStrictEqual([...rowCities(tr, "sell")], ["Caerleon"]);
  assert.deepStrictEqual([...rowCities(tr)].sort(), ["Caerleon", "Martlock"]);
});

test("a row whose price cells carry no side answers to neither split pick", () => {
  // No data-city-list means the row cannot say which end it is — better to offer
  // nothing than to guess, and syncSideCityOptions then hides the picker.
  const tr = makeRow({ rowKey: "T4_ORE|", cityCells: ["Thetford"] });
  assert.strictEqual(rowPassesBuyCity(tr, "Thetford"), false);
  assert.strictEqual(rowPassesSellCity(tr, "Thetford"), false);
  assert.strictEqual(rowPassesCity(tr, "Thetford"), true, "the combined pick still sees it");
});

test("a row-key city segment is NOT read by a side pick (it carries no side)", () => {
  const tr = makeRow({ rowKey: "T4_ORE|T4_METALBAR|Fort Sterling|" });
  assert.strictEqual(rowPassesCity(tr, "Fort Sterling"), true);
  assert.strictEqual(rowPassesBuyCity(tr, "Fort Sterling"), false);
  assert.strictEqual(rowPassesSellCity(tr, "Fort Sterling"), false);
});

// ── option syncing ───────────────────────────────────────────────────────────

test("syncSelectOptions keeps the leading All and lists the given options", () => {
  mountDocument();
  const sel = makeSelect();
  syncSelectOptions(sel, [{ value: "a", label: "A" }, { value: "b", label: "B" }]);
  assert.deepStrictEqual(sel.options.map((o) => o.value), ["", "a", "b"]);
});

test("syncSelectOptions preserves an active pick that left the present set", () => {
  mountDocument();
  const sel = makeSelect("gone");
  syncSelectOptions(sel, [{ value: "a", label: "A" }]);
  assert.strictEqual(sel.value, "gone", "an active filter must never be dropped silently");
  assert.ok(sel.options.some((o) => o.value === "gone"));
});

test("a picker with nothing to offer hides itself, and returns when it has options", () => {
  mountDocument();
  const sel = makeSelect();
  syncSelectOptions(sel, []);
  assert.strictEqual(sel.style.display, "none");
  syncSelectOptions(sel, [{ value: "a", label: "A" }]);
  assert.strictEqual(sel.style.display, "");
});

test("category options list only the categories the table's rows carry", () => {
  const cat = makeSelect();
  mountDocument({ [categoryFilterId("t")]: cat });
  syncCategoryOptions("t", [
    { category: "resources", subcategory: "ore" },
    { category: "armor", subcategory: "plate_armor" },
  ], "");
  assert.deepStrictEqual(cat.options.map((o) => o.value), ["", "resources", "armor"]);
});

test("subcategory options follow the active category pick", () => {
  const sub = makeSelect();
  mountDocument({ [subcategoryFilterId("t")]: sub });
  const pairs = [
    { category: "resources", subcategory: "ore" },
    { category: "armor", subcategory: "plate_armor" },
  ];
  syncCategoryOptions("t", pairs, "resources");
  assert.deepStrictEqual(sub.options.map((o) => o.value), ["", "ore"]);
});

test("with no category picked the subcategory labels name their category", () => {
  const sub = makeSelect();
  mountDocument({ [subcategoryFilterId("t")]: sub });
  syncCategoryOptions("t", [{ category: "resources", subcategory: "ore" }], "");
  assert.strictEqual(sub.options[1].textContent, "Resources · Ore");
});

test("city options list only the cities present, in the app's city order", () => {
  const city = makeSelect();
  mountDocument({ [cityFilterId("t")]: city });
  syncCityOptions("t", new Set(["Martlock", "Caerleon"]));
  assert.deepStrictEqual(city.options.map((o) => o.value), ["", "Caerleon", "Martlock"]);
});

// The combined picker is the Volume table's now — every route table gets the
// split pair below. The re-pricing rule it carries is unchanged and is asserted
// against the Sell picker that inherited it.

// ── option syncing: the split pickers ────────────────────────────────────────

test("the buy picker prunes to the cities its rows actually buy in", () => {
  const buy = makeSelect();
  mountDocument({ [buyCityFilterId("t")]: buy });
  syncSideCityOptions("t", "buy", new Set(["Martlock", "Caerleon"]));
  assert.deepStrictEqual(buy.options.map((o) => o.value), ["", "Caerleon", "Martlock"]);
});

// The Crafting Planner's buy pick SOURCES its materials (effectiveBuyCities,
// js/table-sell-city.js), so like Flipping it must offer every city: pruning to
// the cities today's rows already name would make a city that currently wins no
// row unpickable, which is the whole point of the pick.
test("the planner's buy picker offers every city, not only the ones on screen", () => {
  const buy = makeSelect();
  mountDocument({ [buyCityFilterId("craft-planner-table")]: buy });
  syncSideCityOptions("craft-planner-table", "buy", new Set(["Martlock"]));
  const values = buy.options.map((o) => o.value);
  assert.ok(values.length > 2, "expected the full city list: " + values.join(","));
  assert.ok(values.includes("Caerleon") && values.includes("Martlock"));
});

// A table whose buy leg is not a user pick keeps the pruned default. The
// Volume table re-prices only its sell leg (REPRICE_CITY_LISTS alone), so its
// buy picker still prunes to the cities the rendered rows actually buy in.
test("the buy picker is pruned on a table that re-prices only its sell leg", () => {
  const buy = makeSelect();
  mountDocument({ [buyCityFilterId("volume-table")]: buy });
  syncSideCityOptions("volume-table", "buy", new Set(["Martlock"]));
  assert.deepStrictEqual(buy.options.map((o) => o.value), ["", "Martlock"]);
});

// Flipping routes BOTH legs against its picks, so its buy picker must offer
// every city — pruning to the winners is what stops you asking "price the whole
// board as if I bought in Thetford".
test("Flipping's buy picker offers every city, not only the winners", () => {
  const buy = makeSelect();
  mountDocument({ [buyCityFilterId("flipping-table")]: buy });
  syncSideCityOptions("flipping-table", "buy", new Set(["Martlock"]));
  const values = buy.options.map((o) => o.value);
  assert.ok(values.includes("Thetford"), `expected a city no row names, got ${values}`);
  assert.ok(!values.includes("Black Market"), "the Black Market is never a buy city");
});

test("the sell picker on a re-pricing table still offers every sell city", () => {
  const sell = makeSelect();
  mountDocument({ [sellCityFilterId("craft-planner-table")]: sell });
  syncSideCityOptions("craft-planner-table", "sell", new Set(["Martlock"]));
  const values = sell.options.map((o) => o.value);
  assert.ok(values.includes("Black Market"), `expected the Black Market in ${values}`);
  assert.ok(values.includes("Thetford"), "and a city no row currently names");
});

test("the sell picker on a plain table prunes like the buy one", () => {
  const sell = makeSelect();
  mountDocument({ [sellCityFilterId("t")]: sell });
  syncSideCityOptions("t", "sell", new Set(["Caerleon"]));
  assert.deepStrictEqual(sell.options.map((o) => o.value), ["", "Caerleon"]);
});

test("the Refining / Transports sell picker offers no Black Market (bars are not traded there)", () => {
  const sell = makeSelect();
  mountDocument({ [sellCityFilterId("transport-table")]: sell });
  syncSideCityOptions("transport-table", "sell", new Set(["Martlock"]));
  assert.ok(!sell.options.map((o) => o.value).includes("Black Market"));
});

test("a picker with nothing to offer hides itself", () => {
  const buy = makeSelect();
  mountDocument({ [buyCityFilterId("t")]: buy });
  syncSideCityOptions("t", "buy", new Set());
  assert.strictEqual(buy.style.display, "none");
});

test("syncing a picker that is not mounted is a no-op", () => {
  mountDocument({});
  assert.doesNotThrow(() => syncSideCityOptions("t", "buy", new Set(["Martlock"])));
  assert.doesNotThrow(() => syncSideCityOptions("t", "sell", new Set(["Martlock"])));
});

test("the two pickers have distinct element ids", () => {
  assert.notStrictEqual(buyCityFilterId("t"), sellCityFilterId("t"));
  assert.notStrictEqual(buyCityFilterId("t"), cityFilterId("t"));
  assert.notStrictEqual(sellCityFilterId("t"), cityFilterId("t"));
});

// ── row-key id extraction (moved here from table-search.js) ──────────────────

test("idsFromRowKey pulls game ids out and leaves sections and cities alone", () => {
  assert.deepStrictEqual(idsFromRowKey("T4_ORE|T4_METALBAR|Thetford|"), ["T4_ORE", "T4_METALBAR"]);
  assert.deepStrictEqual(idsFromRowKey("acquire|T8_JOURNAL_HIDE_FULL"), ["T8_JOURNAL_HIDE_FULL"]);
  assert.deepStrictEqual(idsFromRowKey(""), []);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
