/**
 * My Crafting List — the search box and picker row (js/craft-list-filter.js).
 *
 * Every other data table filters through js/table-search.js. The list could not:
 * it is a shell whose rows live inside per-source INNER tables
 * (js/render-craft-list.js _clGroupTableHtml), and the generic pass reads
 * `#<tableId> tbody` — the outer one — so it would have hidden whole groups
 * rather than the rows in them.
 *
 * What is pinned here:
 *   1. The same predicates decide a row: free text, Tier, Ench., Category /
 *      Subcategory, Buy City, Sell City — AND-combined, exactly as the generic
 *      filter combines them.
 *   2. A group's inner table and its `tr.cl-group` label hide TOGETHER once
 *      nothing inside survives, and come back together.
 *   3. Filtering is a VIEW: the totals row and the "Materials to Buy" board are
 *      never touched, so narrowing to one tier cannot change what the list says
 *      you need to buy.
 *   4. A Craft Planner "paths" panel row follows its data row instead of
 *      matching on its own text.
 *
 * No jsdom in this repo, so the handful of DOM calls the filter makes are served
 * by the small fake below — the same approach as tests/craft-list-render.test.cjs.
 *
 * Run: node tests/craft-list-filter.test.cjs
 */

const assert = require("assert");
const path = require("path");

// ── the fake DOM ────────────────────────────────────────────────────────────

class FakeEl {
  constructor({ tag = "tr", cls = [], attrs = {}, text = "", children = [] } = {}) {
    this.tagName = tag.toUpperCase();
    this._cls = new Set(cls);
    this._attrs = { ...attrs };
    this.textContent = text;
    this.children = children;
    this.style = {};
    this.previousElementSibling = null;
    this.classList = {
      contains: (c) => this._cls.has(c),
      add: (c) => this._cls.add(c),
      remove: (c) => this._cls.delete(c),
    };
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
  }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name); }
  /** Depth-first over descendants; supports only the selectors the filter uses. */
  querySelectorAll(sel) {
    const out = [];
    const want = parseSelector(sel);
    const walk = (el) => {
      el.children.forEach((c) => {
        if (matches(c, want)) out.push(c);
        walk(c);
      });
    };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

// "tr.cl-group-row" | "tbody tr" | '[data-city][data-city-list="buy"]'
function parseSelector(sel) {
  const last = sel.trim().split(/\s+/).pop();
  const want = { tag: null, cls: [], attrs: {} };
  const tagMatch = last.match(/^[a-z]+/);
  if (tagMatch) want.tag = tagMatch[0].toUpperCase();
  for (const m of last.matchAll(/\.([\w-]+)/g)) want.cls.push(m[1]);
  for (const m of last.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) want.attrs[m[1]] = m[2] ?? null;
  return want;
}
function matches(el, want) {
  if (want.tag && el.tagName !== want.tag) return false;
  if (!want.cls.every((c) => el.classList.contains(c))) return false;
  for (const [k, v] of Object.entries(want.attrs)) {
    if (!el.hasAttribute(k)) return false;
    if (v !== null && el.getAttribute(k) !== v) return false;
  }
  return true;
}

const els = new Map();
globalThis.document = {
  readyState: "complete",
  getElementById: (id) => els.get(id) || null,
  addEventListener: () => {},
  querySelectorAll: () => [],
};
globalThis.window = undefined;

// ── the app globals the shared predicates read ──────────────────────────────

globalThis.ROYAL_CITIES = ["Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
globalThis.CITIES = ["Caerleon", ...globalThis.ROYAL_CITIES];
globalThis.SELL_CITIES = [...globalThis.CITIES, "Black Market"];
globalThis.getItemDisplayName = (id) => id;
globalThis.getMarketCategory = (id) => {
  if (/_BAG(@\d)?$/.test(id)) return { category: "accessories", subcategory: "bag" };
  if (/_CAPE/.test(id)) return { category: "accessories", subcategory: "cape" };
  if (/_MEAL/.test(id)) return { category: "consumables", subcategory: "food" };
  return null;
};
// Shape matches js/table-filters.js: { key, label, subs: [{ key, label }] }.
globalThis.MARKET_CATEGORY_TREE = [
  { key: "accessories", label: "Accessories",
    subs: [{ key: "bag", label: "Bag" }, { key: "cape", label: "Cape" }] },
  { key: "consumables", label: "Consumables", subs: [{ key: "food", label: "Food" }] },
];

const CLF = require(path.join(__dirname, "..", "js", "craft-list-filter.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); if (process.env.CLF_TRACE) console.error(e.stack); failed++; }
}

// ── the list under test ─────────────────────────────────────────────────────

/** One data row: its row key, its rendered text and its two city legs. */
function dataRow({ key, text, buyCity, sellCity }) {
  const cells = [];
  if (buyCity) {
    cells.push(new FakeEl({ tag: "td", attrs: { "data-city": buyCity, "data-city-list": "buy" } }));
  }
  if (sellCity) {
    cells.push(new FakeEl({ tag: "td", attrs: { "data-city": sellCity, "data-city-list": "sell" } }));
  }
  return new FakeEl({ tag: "tr", attrs: { "data-row-key": key }, text, children: cells });
}

const pathsRow = () => new FakeEl({ tag: "tr", cls: ["cp-paths-row"], text: "buy vs refine" });

/**
 * Build the shell the way render-craft-list.js does: a label row, then a
 * wrapper row holding one inner table per source.
 */
function buildList(groups) {
  const shellRows = [];
  const built = groups.map((g) => {
    const tbody = new FakeEl({ tag: "tbody", children: g.rows });
    const inner = new FakeEl({
      tag: "table", cls: ["data-table", "cl-inner"],
      attrs: { "data-cl-group": g.tableId }, children: [tbody],
    });
    const cell = new FakeEl({ tag: "td", cls: ["cl-group-cell"], children: [inner] });
    const wrapper = new FakeEl({ tag: "tr", cls: ["cl-group-row"], children: [cell] });
    const label = new FakeEl({ tag: "tr", cls: ["cl-group"], text: g.tableId });
    wrapper.previousElementSibling = label;
    shellRows.push(label, wrapper);
    return { label, wrapper, rows: g.rows };
  });
  const totals = new FakeEl({ tag: "tr", cls: ["cl-totals"], text: "Total" });
  shellRows.push(totals);
  const outerBody = new FakeEl({ tag: "tbody", children: shellRows });
  const table = new FakeEl({ tag: "table", children: [outerBody] });
  els.set("craft-list-table", table);
  const mats = new FakeEl({ tag: "table", children: [] });
  els.set("craft-list-mats-table", mats);
  return { table, totals, mats, groups: built };
}

function makeInput(value) {
  const input = new FakeEl({ tag: "input" });
  input.value = value;
  input.addEventListener = () => {};
  els.set(CLF.INPUT_ID, input);
  return input;
}

function makeSelect(id, value) {
  const sel = new FakeEl({ tag: "select", cls: ["table-filter-select"], attrs: { id } });
  sel.value = value;
  sel.options = [{ value: "" }];
  els.set(id, sel);
  return sel;
}

const T = CLF.TABLE_ID;
// Ids come from the shared modules, so a rename there cannot leave this test
// quietly filling in selects nothing reads.
const TS = require(path.join(__dirname, "..", "js", "table-search.js"));
const TF = require(path.join(__dirname, "..", "js", "table-filters.js"));
const SELECT_IDS = {
  tier: TS.tierFilterId(T),
  ench: TS.enchFilterId(T),
  cat: TF.categoryFilterId(T),
  sub: TF.subcategoryFilterId(T),
  buy: TF.buyCityFilterId(T),
  sell: TF.sellCityFilterId(T),
};

/** Render a fixed two-group list, set every picker, and run one filter pass. */
function run({ query = "", tier = "", ench = "", cat = "", sub = "", buy = "", sell = "" } = {}) {
  els.clear();
  const fixture = buildList([
    {
      tableId: "crafting-table",
      rows: [
        dataRow({ key: "T4_BAG|Lymhurst", text: "Novice's Bag", buyCity: "Lymhurst", sellCity: "Martlock" }),
        dataRow({ key: "T6_BAG@2|Thetford", text: "Expert's Bag .2", buyCity: "Thetford", sellCity: "Caerleon" }),
      ],
    },
    {
      tableId: "consumable-table",
      rows: [
        dataRow({ key: "T4_MEAL_PIE|Martlock", text: "Pie", buyCity: "Martlock", sellCity: "Martlock" }),
        pathsRow(),
      ],
    },
  ]);
  makeInput(query);
  makeSelect(SELECT_IDS.tier, tier);
  makeSelect(SELECT_IDS.ench, ench);
  makeSelect(SELECT_IDS.cat, cat);
  makeSelect(SELECT_IDS.sub, sub);
  makeSelect(SELECT_IDS.buy, buy);
  makeSelect(SELECT_IDS.sell, sell);
  CLF.applyCraftListFilter();
  return fixture;
}

const shown = (el) => el.style.display !== "none";
const visibleKeys = (fixture) =>
  fixture.groups.flatMap((g) => g.rows)
    .filter((r) => r.getAttribute("data-row-key") && shown(r))
    .map((r) => r.getAttribute("data-row-key"));

console.log("My Crafting List — filters\n");

// ── one case per picker, plus the combinations that must AND ────────────────

const CASES = [
  { name: "no filter shows every row", opts: {},
    expect: ["T4_BAG|Lymhurst", "T6_BAG@2|Thetford", "T4_MEAL_PIE|Martlock"] },
  { name: "free text matches rendered text", opts: { query: "pie" },
    expect: ["T4_MEAL_PIE|Martlock"] },
  { name: "free text matches the item id in the row key", opts: { query: "t6_bag" },
    expect: ["T6_BAG@2|Thetford"] },
  { name: "free text ANDs its terms", opts: { query: "bag expert" },
    expect: ["T6_BAG@2|Thetford"] },
  { name: "a query nothing matches empties the list", opts: { query: "zzz" }, expect: [] },
  { name: "tier picker", opts: { tier: "4" },
    expect: ["T4_BAG|Lymhurst", "T4_MEAL_PIE|Martlock"] },
  { name: "enchant picker", opts: { ench: "2" }, expect: ["T6_BAG@2|Thetford"] },
  { name: "enchant .0 keeps the plain rows", opts: { ench: "0" },
    expect: ["T4_BAG|Lymhurst", "T4_MEAL_PIE|Martlock"] },
  { name: "category picker", opts: { cat: "consumables" }, expect: ["T4_MEAL_PIE|Martlock"] },
  { name: "subcategory picker", opts: { cat: "accessories", sub: "bag" },
    expect: ["T4_BAG|Lymhurst", "T6_BAG@2|Thetford"] },
  { name: "buy city picker", opts: { buy: "Thetford" }, expect: ["T6_BAG@2|Thetford"] },
  { name: "sell city picker", opts: { sell: "Martlock" },
    expect: ["T4_BAG|Lymhurst", "T4_MEAL_PIE|Martlock"] },
  { name: "pickers AND with the query", opts: { query: "bag", tier: "4" },
    expect: ["T4_BAG|Lymhurst"] },
  { name: "pickers AND with each other", opts: { tier: "4", sell: "Martlock" },
    expect: ["T4_BAG|Lymhurst", "T4_MEAL_PIE|Martlock"] },
  { name: "contradictory pickers empty the list", opts: { tier: "4", ench: "2" }, expect: [] },
];

CASES.forEach((c) => {
  test(c.name, () => {
    const fixture = run(c.opts);
    assert.deepStrictEqual(visibleKeys(fixture).sort(), c.expect.slice().sort());
  });
});

// ── groups hide with their labels ───────────────────────────────────────────

console.log("\n=== groups and their labels ===");

test("an emptied group hides together with its label", () => {
  const f = run({ query: "pie" });
  const crafting = f.groups[0];
  const consumables = f.groups[1];
  assert.ok(!shown(crafting.wrapper), "the emptied group is still shown");
  assert.ok(!shown(crafting.label), "its label is still shown");
  assert.ok(shown(consumables.wrapper), "the surviving group was hidden");
  assert.ok(shown(consumables.label), "the surviving group's label was hidden");
});

test("clearing the query brings every group back", () => {
  run({ query: "pie" });
  const f = run({});
  f.groups.forEach((g, i) => {
    assert.ok(shown(g.wrapper), "group " + i + " stayed hidden");
    assert.ok(shown(g.label), "group " + i + "'s label stayed hidden");
  });
});

test("an idle filter never hides a group, even an empty one", () => {
  els.clear();
  const f = buildList([{ tableId: "crafting-table", rows: [] }]);
  makeInput("");
  Object.values(SELECT_IDS).forEach((id) => makeSelect(id, ""));
  CLF.applyCraftListFilter();
  assert.ok(shown(f.groups[0].wrapper), "an idle filter hid an empty group");
});

// ── what filtering must NOT touch ───────────────────────────────────────────

console.log("\n=== filtering is a view ===");

test("the totals row is never hidden", () => {
  const f = run({ query: "zzz" });
  assert.ok(shown(f.totals), "the totals row was hidden by a filter");
});

test("the Materials to Buy board is never touched", () => {
  const f = run({ query: "zzz" });
  assert.deepStrictEqual(f.mats.style, {},
    "the shopping list changed with the view");
});

// ── panel rows follow their data row ────────────────────────────────────────

console.log("\n=== panel rows ===");

test("a paths panel follows its data row when it matches", () => {
  const f = run({ query: "pie" });
  const panel = f.groups[1].rows[1];
  assert.ok(shown(panel), "the panel was hidden under a matching row");
});

test("a paths panel hides with its data row", () => {
  const f = run({ query: "bag" });
  const panel = f.groups[1].rows[1];
  assert.ok(!shown(panel), "the panel outlived the row it belongs to");
});

test("a panel row is never matched on its own text", () => {
  // "refine" appears only in the panel's text, never in a data row.
  const f = run({ query: "refine" });
  assert.deepStrictEqual(visibleKeys(f), [], "a panel row pulled its group into view");
  assert.ok(!shown(f.groups[1].rows[1]), "the panel matched on its own text");
});

// ── degrades safely ─────────────────────────────────────────────────────────

console.log("\n=== no list, no work ===");

test("with no search box the pass is a no-op", () => {
  els.clear();
  buildList([{ tableId: "crafting-table", rows: [dataRow({ key: "T4_BAG|X", text: "Bag" })] }]);
  assert.doesNotThrow(() => CLF.applyCraftListFilter());
});

test("with no list table the pass is a no-op", () => {
  els.clear();
  makeInput("bag");
  assert.doesNotThrow(() => CLF.applyCraftListFilter());
  assert.deepStrictEqual(CLF.craftListGroups(), []);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
