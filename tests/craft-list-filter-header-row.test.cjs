/**
 * My Crafting List: a filter must never hide a group's column-header row.
 *
 * Reported: after any active filter (text, Tier, Sell/Buy City, ...) the group
 * header row — the one carrying the sort arrows — vanished. Cause:
 * craftListGroups() read `wrapper.querySelectorAll("tbody tr")`; the wrapper
 * `tr.cl-group-row` sits in the shell <tbody>, so the selector also matched
 * `tr.cl-colhead` in the group table's own <thead>, the filter judged it as a
 * data row, failed it, and set display:none (js/craft-list-filter.js).
 *
 * Pinned (black-box, on row visibility):
 *   1. tr.cl-colhead is never among a group's `rows`.
 *   2. It stays visible while at least one data row of its group is visible.
 *   3. A header hidden earlier comes back (display "") on the next pass.
 *   4. A group with every row filtered out still hides wrapper + label as before.
 *   5. An idle filter shows every header.
 *
 * The fake DOM has parent pointers and a small selector engine (descendant `␣`
 * and child `>` combinators, tag/.class/[attr]/:scope/:not(.class)), so the
 * scoping of the group's row query is actually exercised: a fake that only
 * looked at the last token could not tell `tbody tr` from `table > tbody > tr`.
 *
 * Run: node tests/craft-list-filter-header-row.test.cjs
 */

const assert = require("assert");
const path = require("path");

// ── fake DOM with a real selector engine ────────────────────────────────────

class FakeEl {
  constructor({ tag = "tr", cls = [], attrs = {}, text = "", children = [] } = {}) {
    this.tagName = tag.toUpperCase();
    this._cls = new Set(cls);
    this._attrs = { ...attrs };
    this.textContent = text;
    this.children = children;
    this.parentElement = null;
    children.forEach((c) => { c.parentElement = this; });
    this.style = {};
    this.previousElementSibling = null;
    this.classList = {
      contains: (c) => this._cls.has(c),
      add: (c) => this._cls.add(c),
      remove: (c) => this._cls.delete(c),
    };
  }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null; }
  hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this._attrs, n); }
  querySelectorAll(sel) {
    const alts = sel.split(",").map((s) => parseComplex(s.trim()));
    const out = [];
    const walk = (el) => el.children.forEach((c) => {
      if (alts.some((a) => matchComplex(c, a, this))) out.push(c);
      walk(c);
    });
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

/** "table.cl-inner > tbody > tr" -> [{compound, comb}] (comb = link to the LEFT part). */
function parseComplex(sel) {
  const parts = [];
  let comb = " ";
  for (const tok of sel.replace(/>/g, " > ").split(/\s+/).filter(Boolean)) {
    if (tok === ">") { comb = ">"; continue; }
    parts.push({ compound: parseCompound(tok), comb });
    comb = " ";
  }
  return parts;
}
function parseCompound(tok) {
  const c = { tag: null, cls: [], attrs: {}, scope: false, notCls: [] };
  const t = tok.match(/^[a-z]+/);
  if (t) c.tag = t[0].toUpperCase();
  const stripped = tok.replace(/:not\(\.([\w-]+)\)/g, (_, k) => { c.notCls.push(k); return ""; });
  if (stripped.includes(":scope")) c.scope = true;
  for (const m of stripped.matchAll(/\.([\w-]+)/g)) c.cls.push(m[1]);
  for (const m of stripped.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) c.attrs[m[1]] = m[2] ?? null;
  return c;
}
function matchCompound(el, c, scope) {
  if (c.scope) return el === scope;
  if (c.tag && el.tagName !== c.tag) return false;
  if (!c.cls.every((k) => el.classList.contains(k))) return false;
  if (c.notCls.some((k) => el.classList.contains(k))) return false;
  for (const [k, v] of Object.entries(c.attrs)) {
    if (!el.hasAttribute(k)) return false;
    if (v !== null && el.getAttribute(k) !== v) return false;
  }
  return true;
}
/** Right-to-left match; ancestors may lie ABOVE the scope root, as in a browser. */
function matchComplex(el, parts, scope, i = parts.length - 1) {
  if (!matchCompound(el, parts[i].compound, scope)) return false;
  if (i === 0) return true;
  const comb = parts[i].comb;
  let p = el.parentElement;
  while (p) {
    if (matchComplex(p, parts, scope, i - 1)) return true;
    if (comb === ">") return false;
    p = p.parentElement;
  }
  return false;
}

const els = new Map();
globalThis.document = {
  readyState: "complete",
  getElementById: (id) => els.get(id) || null,
  addEventListener: () => {},
  querySelectorAll: () => [],
};
globalThis.window = undefined;

globalThis.ROYAL_CITIES = ["Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
globalThis.CITIES = ["Caerleon", ...globalThis.ROYAL_CITIES];
globalThis.SELL_CITIES = [...globalThis.CITIES, "Black Market"];
globalThis.getItemDisplayName = (id) => id;
globalThis.getMarketCategory = (id) => (/_BAG/.test(id) ? { category: "accessories", subcategory: "bag" } : null);
globalThis.MARKET_CATEGORY_TREE = [
  { key: "accessories", label: "Accessories", subs: [{ key: "bag", label: "Bag" }] },
];

const CLF = require(path.join(__dirname, "..", "js", "craft-list-filter.js"));
const TS = require(path.join(__dirname, "..", "js", "table-search.js"));
const TF = require(path.join(__dirname, "..", "js", "table-filters.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " - " + e.message); failed++; }
}

// ── the list under test: shell > wrapper > cell > table.cl-inner > thead+tbody ──

function dataRow({ key, text, buyCity, sellCity }) {
  const cells = [];
  if (buyCity) cells.push(new FakeEl({ tag: "td", attrs: { "data-city": buyCity, "data-city-list": "buy" } }));
  if (sellCity) cells.push(new FakeEl({ tag: "td", attrs: { "data-city": sellCity, "data-city-list": "sell" } }));
  return new FakeEl({ tag: "tr", attrs: { "data-row-key": key }, text, children: cells });
}

function buildList(groups) {
  const shellRows = [];
  const built = groups.map((g) => {
    const colhead = new FakeEl({
      tag: "tr", cls: ["cl-colhead"], text: "Qty Total Buy Cost Total Profit",
      children: [new FakeEl({ tag: "th", text: "Qty" })],
    });
    const thead = new FakeEl({ tag: "thead", children: [colhead] });
    const tbody = new FakeEl({ tag: "tbody", children: g.rows });
    const inner = new FakeEl({
      tag: "table", cls: ["data-table", "cl-inner"],
      attrs: { "data-cl-group": g.tableId }, children: [thead, tbody],
    });
    const cell = new FakeEl({ tag: "td", cls: ["cl-group-cell"], children: [inner] });
    const wrapper = new FakeEl({ tag: "tr", cls: ["cl-group-row"], children: [cell] });
    const label = new FakeEl({ tag: "tr", cls: ["cl-group"], text: g.tableId });
    wrapper.previousElementSibling = label;
    shellRows.push(label, wrapper);
    return { label, wrapper, colhead, rows: g.rows };
  });
  const totals = new FakeEl({ tag: "tr", cls: ["cl-totals"], text: "Total" });
  shellRows.push(totals);
  const outerBody = new FakeEl({ tag: "tbody", children: shellRows });
  els.set("craft-list-table", new FakeEl({ tag: "table", children: [outerBody] }));
  els.set("craft-list-mats-table", new FakeEl({ tag: "table", children: [] }));
  return built;
}

const T = CLF.TABLE_ID;
const IDS = {
  tier: TS.tierFilterId(T), ench: TS.enchFilterId(T),
  cat: TF.categoryFilterId(T), sub: TF.subcategoryFilterId(T),
  buy: TF.buyCityFilterId(T), sell: TF.sellCityFilterId(T),
};
function put(id, value, tag = "select") {
  const el = new FakeEl({ tag, cls: ["table-filter-select"], attrs: { id } });
  el.value = value;
  el.options = [{ value: "" }];
  el.addEventListener = () => {};
  els.set(id, el);
}

/** Two groups, one pre-hidden header optional; run one filter pass. */
function run({ query = "", tier = "", buy = "", sell = "", prehide = false } = {}) {
  els.clear();
  const groups = buildList([
    { tableId: "crafting-table", rows: [
      dataRow({ key: "T4_BAG|Lymhurst", text: "Novice's Bag", buyCity: "Lymhurst", sellCity: "Martlock" }),
      dataRow({ key: "T6_BAG@2|Thetford", text: "Expert's Bag .2", buyCity: "Thetford", sellCity: "Caerleon" }),
    ] },
    { tableId: "consumable-table", rows: [
      dataRow({ key: "T4_MEAL_PIE|Martlock", text: "Pie", buyCity: "Martlock", sellCity: "Martlock" }),
    ] },
  ]);
  if (prehide) groups.forEach((g) => { g.colhead.style.display = "none"; });
  put(CLF.INPUT_ID, query, "input");
  put(IDS.tier, tier); put(IDS.ench, ""); put(IDS.cat, ""); put(IDS.sub, "");
  put(IDS.buy, buy); put(IDS.sell, sell);
  CLF.applyCraftListFilter();
  return groups;
}

const shown = (el) => el.style.display !== "none";
const visibleRows = (g) => g.rows.filter((r) => shown(r));

// ── 1. the header is not a row of the group ─────────────────────────────────

console.log("My Crafting List - group header row vs filters\n");

test("craftListGroups().rows never contains a tr.cl-colhead", () => {
  run({});
  const groups = CLF.craftListGroups();
  assert.strictEqual(groups.length, 2);
  groups.forEach((g, i) => {
    assert.ok(!g.rows.some((r) => r.classList.contains("cl-colhead")),
      "group " + i + " lists its column header as a data row");
    assert.ok(g.rows.length > 0, "group " + i + " lost its data rows");
  });
});

// ── 2-5. parameterized over the filters ─────────────────────────────────────

const CASES = [
  { name: "text query matching one group", opts: { query: "pie" }, visibleGroups: [1] },
  { name: "text query matching part of a group", opts: { query: "expert" }, visibleGroups: [0] },
  { name: "text query matching nothing", opts: { query: "zzz" }, visibleGroups: [] },
  { name: "Sell City pick that names no row", opts: { sell: "Lymhurst" }, visibleGroups: [] },
  { name: "Sell City pick matching rows in both groups", opts: { sell: "Martlock" }, visibleGroups: [0, 1] },
  { name: "Buy City pick", opts: { buy: "Thetford" }, visibleGroups: [0] },
  { name: "Tier pick", opts: { tier: "6" }, visibleGroups: [0] },
  { name: "Tier + text", opts: { tier: "4", query: "pie" }, visibleGroups: [1] },
  { name: "idle filter", opts: {}, visibleGroups: [0, 1] },
];

CASES.forEach((c) => {
  console.log("\n=== " + c.name + " ===");

  test("header stays visible in every group that still shows a row", () => {
    const groups = run(c.opts);
    groups.forEach((g, i) => {
      if (visibleRows(g).length > 0) {
        assert.ok(shown(g.colhead), "group " + i + " shows rows but its header row is display:none");
      }
    });
  });

  test("a group shows exactly when one of its rows survives", () => {
    const groups = run(c.opts);
    const shownGroups = groups.map((g, i) => (shown(g.wrapper) ? i : -1)).filter((i) => i >= 0);
    assert.deepStrictEqual(shownGroups, c.visibleGroups);
    groups.forEach((g, i) => {
      assert.strictEqual(shown(g.label), shown(g.wrapper), "group " + i + " label out of step with its group");
    });
  });

  test("a header hidden by an earlier pass is restored when rows are visible", () => {
    const groups = run({ ...c.opts, prehide: true });
    groups.forEach((g, i) => {
      if (visibleRows(g).length > 0) {
        assert.strictEqual(g.colhead.style.display, "",
          "group " + i + " header was left hidden (display=" + JSON.stringify(g.colhead.style.display) + ")");
      }
    });
  });
});

// ── an idle filter restores every header ────────────────────────────────────

console.log("\n=== idle filter ===");

test("clearing every filter brings back a header hidden earlier", () => {
  const groups = run({ prehide: true });
  groups.forEach((g, i) => assert.ok(shown(g.colhead), "group " + i + " header still hidden"));
});

// ── the totals row is still never touched ───────────────────────────────────

test("the totals row stays visible under a filter that matches nothing", () => {
  run({ query: "zzz" });
  const totals = els.get("craft-list-table").querySelector("tr.cl-totals");
  assert.ok(shown(totals));
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
