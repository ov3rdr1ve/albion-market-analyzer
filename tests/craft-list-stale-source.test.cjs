/**
 * My Crafting List: catching up a source table whose cache the last redraw
 * skipped (js/render-craft-list.js `_clSourceState`, `_clRefreshTotalsOnly`).
 *
 * The panel does not compute anything. Every row it shows is replayed out of
 * its source table's cached rows + formatter (tableState[id]), and
 * renderAllTables skips hidden tables — it only marks them deferred and leaves
 * the cache alone. So the cache comes back in two broken states:
 *
 *   empty  — nothing to draw at all,
 *   stale  — the reported bug: a price pinned ON a list row saved fine and the
 *            cell went gold, but the silver figure, the row total, the footer
 *            and the materials board all replayed the old row.
 *
 * These are black-box assertions about that contract: which sources get
 * re-rendered, which deliberately do not (the perf gate that keeps this off the
 * hot path while the market monitor streams price patches), and how many times.
 *
 * No jsdom in this repo — the fake DOM is the same string-surgery stub
 * tests/craft-list-render.test.cjs uses, extended with the node lists
 * `_clRefreshTotalsOnly` walks.
 *
 * Run: node tests/craft-list-stale-source.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const loadFile = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/if \(typeof module[\s\S]*$/, "");

// ── the fake DOM + the gating globals ───────────────────────────────────────

const sandbox = `
const _store = {
  tbodies: {}, els: {}, heads: {},
  hidden: new Set(),        // table ids isTableHidden() reports as invisible
  deferred: new Set(),      // table ids the last redraw skipped
  renderCounts: {},         // tableId -> how many times its renderer ran
  throwOn: new Set(),       // tableIds whose renderer blows up
  totalsCell: null,
  qtyInputs: [],
};

class FakeCell {
  constructor(owner) { this.owner = owner; }
  set outerHTML(v) {
    this.owner._html = this.owner._html.replace(
      /<td class="cell-add">[\\s\\S]*?<\\/td>/, v);
  }
}
class FakeTr {
  constructor(owner) { this.owner = owner; }
  get outerHTML() { return this.owner._html.trim(); }
  querySelector(sel) {
    if (sel === "td.cell-add" && /<td class="cell-add">/.test(this.owner._html)) {
      return new FakeCell(this.owner);
    }
    return null;
  }
  insertAdjacentHTML(pos, html) {
    if (pos === "afterbegin") this.owner._html = this.owner._html.replace(/(<tr[^>]*>)/, "$1" + html);
  }
}
class FakeTbody {
  constructor() { this._html = ""; }
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html; }
  get firstElementChild() { return this._html.trim() ? new FakeTr(this) : null; }
}

const document = {
  readyState: "complete",
  addEventListener() {},
  createElement() { return new FakeTbody(); },
  getElementById(id) { return _store.els[id] || null; },
  querySelector(sel) {
    if (sel === "#craft-list-table tbody tr.cl-totals") return _store.totalsCell;
    return _store.tbodies[sel] || null;
  },
  querySelectorAll(sel) {
    if (sel === "#craft-list-table [data-cl-qty]") return _store.qtyInputs;
    const m = /^#([\\w-]+) thead th$/.exec(sel);
    if (m) return (_store.heads[m[1]] || []).map((t) => {
      const [label, sort] = String(t).split(":");
      return { textContent: label, getAttribute: (a) => (a === "data-sort" ? (sort || null) : null) };
    });
    return [];
  },
};

// ── js/render-gating.js contract, faked ────────────────────────────────────
function isTableHidden(id) { return _store.hidden.has(id); }
function isTableDeferred(id) { return _store.deferred.has(id); }
function clearTableDeferred(id) { _store.deferred.delete(id); }

// One counting renderer per source table. Writing FRESH_ROW into the cache is
// what a real renderer does after re-reading prices (and the overrides).
let FRESH_ROW = null;
function makeRenderer(tableId) {
  return function () {
    _store.renderCounts[tableId] = (_store.renderCounts[tableId] || 0) + 1;
    if (_store.throwOn.has(tableId)) throw new Error("renderer exploded");
    tableState[tableId].data = FRESH_ROW ? [FRESH_ROW] : [];
    tableState[tableId].formatter = craftingFormatter;
  };
}
const window = {
  tableRenderers: () => ({
    "crafting-table": makeRenderer("crafting-table"),
    "rerolling-table": makeRenderer("rerolling-table"),
  }),
};

// App globals the renderer leans on.
function tx(en) { return en; }
function formatSilver(n) { return String(Math.round(Number(n) || 0)); }
function getItemDisplayName(id) { return "NAME:" + id; }
function matPriceSpan(id, city, price) {
  return '<span class="price-editable" data-item-id="' + id + '" data-city="' + (city || "") + '">@ ' + price + '</span>';
}
function getRowKey(row, tableId) {
  if (tableId === "crafting-table") return (row.item && row.item.id) + "|" + (row.craftCity || "");
  return (row.item && row.item.id) || "";
}
let lastMarketData = { seeded: true };
let lastQualityMarketData = null;

function getSortValue() { return 0; }
function compareRows() { return 0; }

const tableState = {
  "crafting-table": { data: [], formatter: null },
  "rerolling-table": { data: [], formatter: null },
};
function craftingFormatter(row, idx) {
  return \`
  <tr data-row-key="\${getRowKey(row, "crafting-table")}">
    <td class="cell-add"><button data-add-row="1">+</button></td>
    <td class="cell-item">\${row.item.name}</td>
    <td class="price-editable" data-item-id="\${row.item.id}" data-city="\${row.sellGear.city}" data-row-idx="\${idx}">\${row.sellGear.price}</td>
  </tr>\`;
}
`;

const src = sandbox
  + loadFile("js/craft-list-store.js")
  + loadFile("js/craft-list-focus-budget.js")
  + loadFile("js/craft-list-extractors.js")
  + loadFile("js/craft-list-extractors-transport.js")
  + loadFile("js/craft-list-materials.js")
  + loadFile("js/craft-list-sort.js")
  + loadFile("js/render-craft-list-footer.js")
  + loadFile("js/render-craft-list-header.js")
  + loadFile("js/render-craft-list-source.js")
  + loadFile("js/render-craft-list-cells.js")
  + loadFile("js/render-craft-list.js")
  + `
module.exports = {
  renderCraftListTable, _clSourceState, _clRefreshTotalsOnly,
  addCraftListEntry, clearCraftList, setCraftListQty,
  setCraftListStorage, setCraftListSortStorage,
  _store, tableState,
  setFreshRow: (r) => { FRESH_ROW = r; },
  setQualityData: (v) => { lastQualityMarketData = v; },
  setMarketData: (v) => { lastMarketData = v; },
};`;

const m = new Module("craft-list-stale-source-test");
m._compile(src, path.join(ROOT, "js", "craft-list-stale-source-test.js"));
const api = m.exports;

// ── harness ─────────────────────────────────────────────────────────────────

function makeStorage(backing) {
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); },
    removeItem: (k) => { delete backing[k]; },
  };
}
api.setCraftListStorage(makeStorage({}));
api.setCraftListSortStorage(makeStorage({}));

const listBody = { set innerHTML(v) { this._v = v; }, get innerHTML() { return this._v || ""; } };
const matsBody = { set innerHTML(v) { this._v = v; }, get innerHTML() { return this._v || ""; } };
api._store.tbodies["#craft-list-table tbody"] = listBody;
api._store.tbodies["#craft-list-mats-table tbody"] = matsBody;
api._store.els["cl-count"] = { textContent: "" };
api._store.els["cl-clear-all"] = { hidden: false };
api._store.heads["crafting-table"] = ["", "Item:name", "Best Sell Price"];

const ROW_KEY = "T5_BAG|Martlock";
const row = (sellPrice, profit) => ({
  item: { id: "T5_BAG", name: "Bag [T5]" },
  materials: [{ matId: "T5_CLOTH", count: 8 }],
  matBestPrices: { T5_CLOTH: { city: "Martlock", price: 100 } },
  craftCity: "Martlock",
  sellGear: { city: "Caerleon", price: sellPrice },
  totalInputCost: 800,
  focusCost: 120,
  marginInfo: { profit, margin: 50 },
});
const STALE = row(5000, 400);   // what the cache holds
const PINNED = row(9000, 4400); // what the renderer would produce after the pin

/**
 * @param {object} o
 *  cached    rows already in tableState (null = empty cache)
 *  deferred  the last redraw skipped this table
 *  panel     is the list panel on screen
 *  quality   lastQualityMarketData
 */
function scenario(o = {}) {
  api.clearCraftList();
  const s = api._store;
  s.hidden.clear(); s.deferred.clear(); s.throwOn.clear();
  s.renderCounts = {};
  Object.keys(api.tableState).forEach((id) => {
    api.tableState[id].data = [];
    api.tableState[id].formatter = null;
  });
  if (o.cached !== null) {
    api.tableState["crafting-table"].data = [o.cached || STALE];
    api.tableState["crafting-table"].formatter = null; // set by the renderer
  }
  // The formatter survives a skipped pass in the real app, so seed it too.
  if (o.cached !== null) api.tableState["crafting-table"].formatter = FORMATTER;
  if (o.deferred) s.deferred.add(o.deferred === true ? "crafting-table" : o.deferred);
  if (o.panel === "hidden") s.hidden.add("craft-list-table");
  api.setFreshRow(o.fresh || PINNED);
  api.setQualityData(o.quality === undefined ? null : o.quality);
  listBody.innerHTML = "";
  matsBody.innerHTML = "";
  s.totalsCell = null;
  s.qtyInputs = [];
}

// Grab the formatter the sandbox defined by rendering once through the registry.
let FORMATTER = null;
{
  api._store.renderCounts = {};
  api.setFreshRow(STALE);
  api._store.deferred.add("crafting-table");
  api._clSourceState("crafting-table");
  FORMATTER = api.tableState["crafting-table"].formatter;
  assert.ok(typeof FORMATTER === "function", "harness: could not capture the formatter");
}

const addRow = () =>
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG" });

const renders = (id) => api._store.renderCounts[id] || 0;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// ── the reported bug ────────────────────────────────────────────────────────

console.log("\n=== a stale source cache is caught up ===");

test("a STALE (deferred) source is re-rendered and the row shows the new price", () => {
  scenario({ cached: STALE, deferred: true });
  addRow();
  api.renderCraftListTable();
  assert.strictEqual(renders("crafting-table"), 1, "the stale source must be recomputed");
  assert.match(listBody.innerHTML, /data-item-id="T5_BAG"[^>]*>9000</, "the row must show the pinned price");
  assert.doesNotMatch(listBody.innerHTML, />5000</, "the old price must be gone");
});

test("the per-row total and the footer follow the recomputed row", () => {
  scenario({ cached: STALE, deferred: true });
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 2 });
  api.renderCraftListTable();
  assert.match(listBody.innerHTML, /cl-row-total[^>]*>8800</, "row total = 4400 profit × qty 2");
  assert.match(listBody.innerHTML, /profit <strong[^>]*>8800</);
});

test("an EMPTY cache is still rendered on demand (unchanged behaviour)", () => {
  scenario({ cached: null });
  addRow();
  api.renderCraftListTable();
  assert.strictEqual(renders("crafting-table"), 1);
  assert.match(listBody.innerHTML, /Bag \[T5\]/);
});

// ── what must NOT be recomputed ─────────────────────────────────────────────

console.log("\n=== the gates that keep this off the hot path ===");

test("a fresh, non-deferred source is NOT re-rendered", () => {
  scenario({ cached: STALE });
  addRow();
  api.renderCraftListTable();
  assert.strictEqual(renders("crafting-table"), 0, "a visible source was already computed this pass");
  assert.match(listBody.innerHTML, />5000</, "and its cached row is what renders");
});

test("a stale source is NOT re-rendered while the list panel is hidden", () => {
  scenario({ cached: STALE, deferred: true, panel: "hidden" });
  addRow();
  api.renderCraftListTable();
  assert.strictEqual(renders("crafting-table"), 0, "nobody is looking at the panel");
});

test("an EMPTY cache is still filled even when the panel is hidden", () => {
  // The empty case is once-per-source and is what makes a restored list paint
  // at all — the visibility gate only guards the repeatable stale case.
  scenario({ cached: null, panel: "hidden" });
  addRow();
  api.renderCraftListTable();
  assert.strictEqual(renders("crafting-table"), 1);
});

test("one successful catch-up un-defers the table; a second pass renders 0 more", () => {
  scenario({ cached: STALE, deferred: true });
  addRow();
  api.renderCraftListTable();
  assert.strictEqual(renders("crafting-table"), 1);
  api.renderCraftListTable();
  assert.strictEqual(renders("crafting-table"), 1, "the flag must have been cleared");
});

test("a renderer that throws stays deferred and does not break the panel", () => {
  scenario({ cached: STALE, deferred: true });
  api._store.throwOn.add("crafting-table");
  addRow();
  const quiet = console.error;
  console.error = () => {}; // the throw is the point; its stack is not
  try { assert.doesNotThrow(() => api.renderCraftListTable()); }
  finally { console.error = quiet; }
  assert.strictEqual(api._store.deferred.has("crafting-table"), true, "a failed catch-up must be retried later");
  assert.match(listBody.innerHTML, /data-cl-remove/, "the entry is still removable");
});

test("rerolling is NOT force-rendered without a quality-aware scan", () => {
  scenario({ cached: STALE, deferred: "rerolling-table", quality: null });
  assert.strictEqual(renders("rerolling-table"), 0);
  api._clSourceState("rerolling-table");
  assert.strictEqual(renders("rerolling-table"), 0, "it would paint a table of blanks");
});

test("rerolling IS force-rendered once quality prices exist", () => {
  scenario({ cached: STALE, deferred: "rerolling-table", quality: { seeded: true } });
  api._clSourceState("rerolling-table");
  assert.strictEqual(renders("rerolling-table"), 1);
});

test("an unknown table id is a no-op, not a throw", () => {
  scenario({ cached: STALE });
  assert.strictEqual(api._clSourceState("not-a-table"), null);
});

// ── _clRefreshTotalsOnly (the quantity-keystroke path) ──────────────────────

console.log("\n=== _clRefreshTotalsOnly uses the same source lookup ===");

function wireTotalsDom(qty) {
  const totalCell = { textContent: "", className: "" };
  const costCell = { innerHTML: "", className: "" };
  api._store.totalsCell = { querySelector: () => api._store.totalsCellTd };
  api._store.totalsCellTd = { innerHTML: "" };
  api._store.qtyInputs = [{
    getAttribute: (a) => (a === "data-table-id" ? "crafting-table"
      : a === "data-row-key" ? ROW_KEY : null),
    // Selector-aware: the row carries a Total Profit cell AND a Total Buy Cost
    // cell, and the refresh writes a different number into each.
    closest: () => ({
      querySelector: (sel) => (sel === ".cl-row-cost" ? costCell : totalCell),
    }),
  }];
  return { totalCell, costCell, qty };
}

test("a stale source is caught up on a quantity edit too", () => {
  scenario({ cached: STALE, deferred: true });
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 2 });
  const dom = wireTotalsDom(2);
  api._clRefreshTotalsOnly();
  assert.strictEqual(dom.totalCell.textContent, "8800", "row total must use the recomputed profit");
  assert.match(api._store.totalsCellTd.innerHTML, /profit <strong[^>]*>8800</);
});

test("the buy-cost cell is caught up on the same keystroke", () => {
  scenario({ cached: STALE, deferred: true });
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 2 });
  const dom = wireTotalsDom(2);
  api._clRefreshTotalsOnly();
  assert.strictEqual(dom.costCell.innerHTML, "1600", "cost = 800 input cost × qty 2");
});

test("the catch-up happens EXACTLY ONCE across both of its loops", () => {
  scenario({ cached: STALE, deferred: true });
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 2 });
  wireTotalsDom(2);
  api._clRefreshTotalsOnly();
  assert.strictEqual(renders("crafting-table"), 1, "the entries loop and the qty loop must share one render");
});

test("the materials board is rebuilt from the recomputed row", () => {
  scenario({ cached: STALE, deferred: true });
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 2 });
  wireTotalsDom(2);
  api._clRefreshTotalsOnly();
  assert.match(matsBody.innerHTML, /data-item-id="T5_CLOTH"/);
});

console.log(`\n${passed + failed} run | ${passed} passed | ${failed} failed`);
if (failed > 0) process.exit(1);
