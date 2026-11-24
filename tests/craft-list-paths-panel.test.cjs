/**
 * My Crafting List — multi-row formatter output (js/render-craft-list.js).
 *
 * A table formatter may emit TWO <tr>s for one entry: the data row plus a
 * detail row beneath it (the Consumables "alternative routes" panel does this
 * today; the Crafting Planner's "best path" panel used to). The list renders its
 * entries through those same formatters, so it must keep every row it gets back
 * — it used to return only the first, which is why clicking a detail toggle on a
 * list row appeared to do nothing. The markup below is a stand-in for any such
 * formatter, not a copy of a live one.
 *
 * Black-box: feed _clEntryRowHtml (via renderCraftListTable) formatters that emit
 * one row / two rows / a row with no "+" cell, and assert on the HTML that comes
 * out. The trailing rows' colspan must grow by 2, because the graft turns one
 * td.cell-add into three cells.
 *
 * No jsdom in this repo: the fake DOM below is string surgery over the same
 * operations the renderer performs, extended to expose more than one row.
 *
 * Run: node tests/craft-list-paths-panel.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const loadFile = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/if \(typeof module[\s\S]*$/, "");

// ── the fake DOM ────────────────────────────────────────────────────────────
// A tbody splits its HTML into rows on demand, so `children` and per-row cell
// edits behave like the browser's while the storage stays a plain string.

const sandbox = `
const _store = { tbodies: {}, els: {}, heads: {} };

function _splitRows(html) {
  return String(html || "").match(/<tr[\\s\\S]*?<\\/tr>/g) || [];
}

class FakeCell {
  constructor(row) { this.row = row; }
  set outerHTML(v) {
    this.row._write(this.row._html.replace(/<td class="cell-add">[\\s\\S]*?<\\/td>/, v));
  }
}
class FakeTd {
  constructor(row, index) { this.row = row; this.index = index; }
  getAttribute(name) {
    const m = new RegExp('<td[^>]*\\\\b' + name + '="([^"]*)"', "g");
    let hit = null, i = 0, x;
    while ((x = m.exec(this.row._html)) !== null) { if (i === this.index) { hit = x[1]; break; } i++; }
    return hit;
  }
  setAttribute(name, value) {
    let i = 0;
    const next = this.row._html.replace(
      new RegExp('(<td[^>]*\\\\b' + name + '=")([^"]*)(")', "g"),
      (all, a, _old, c) => (i++ === this.index ? a + value + c : all));
    this.row._write(next);
  }
}
class FakeTr {
  constructor(owner, index) { this.owner = owner; this.index = index; }
  get _html() { return _splitRows(this.owner._html)[this.index] || ""; }
  _write(html) {
    const rows = _splitRows(this.owner._html);
    rows[this.index] = html;
    this.owner._html = rows.join("");
  }
  get outerHTML() { return this._html.trim(); }
  querySelector(sel) {
    if (sel === "td.cell-add" && /<td class="cell-add">/.test(this._html)) return new FakeCell(this);
    return null;
  }
  querySelectorAll(sel) {
    if (sel !== "td[colspan]") return [];
    const n = (this._html.match(/<td[^>]*\\bcolspan="/g) || []).length;
    return Array.from({ length: n }, (_, i) => new FakeTd(this, i));
  }
  insertAdjacentHTML(pos, html) {
    if (pos === "afterbegin") this._write(this._html.replace(/(<tr[^>]*>)/, "$1" + html));
    else if (pos === "beforeend") {
      const at = this._html.lastIndexOf("</tr>");
      this._write(this._html.slice(0, at) + html + this._html.slice(at));
    }
  }
}
class FakeTbody {
  constructor() { this._html = ""; }
  set innerHTML(v) { this._html = v; }
  get innerHTML() { return this._html; }
  get children() { return _splitRows(this._html).map((_, i) => new FakeTr(this, i)); }
  get firstElementChild() { return _splitRows(this._html).length ? new FakeTr(this, 0) : null; }
}

const document = {
  readyState: "complete",
  addEventListener() {},
  createElement() { return new FakeTbody(); },
  getElementById(id) { return _store.els[id] || null; },
  querySelector(sel) { return _store.tbodies[sel] || null; },
  querySelectorAll(sel) {
    const m = /^#([\\w-]+) thead th$/.exec(sel);
    if (m) return (_store.heads[m[1]] || []).map((t) => {
      const [label, sort] = String(t).split(":");
      return { textContent: label, getAttribute: (a) => (a === "data-sort" ? (sort || null) : null) };
    });
    return [];
  },
};
const window = {};

function tx(en) { return en; }
function formatSilver(n) { return String(Math.round(Number(n) || 0)); }
function getItemDisplayName(id) { return "NAME:" + id; }
function matPriceSpan(id, city, price) { return '<span class="price-editable">@ ' + price + '</span>'; }
function getRowKey(row) { return (row.item && row.item.id) + "|" + (row.craftCity || ""); }
let lastMarketData = { seeded: true };
let lastQualityMarketData = null;

function getSortValue() { return 0; }
function compareRows() { return 0; }

const tableState = { "craft-planner-table": { data: [], formatter: null } };
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
  renderCraftListTable, addCraftListEntry, clearCraftList,
  setCraftListStorage, setCraftListSortStorage, _store, tableState,
};`;

const m = new Module("craft-list-paths-panel-test");
m._compile(src, path.join(ROOT, "js", "craft-list-paths-panel-test.js"));
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

const ROW = {
  item: { id: "T8_BAG", name: "Bag [T8]" },
  craftCity: "Martlock",
  sourcing: [{ matId: "T8_CLOTH", count: 8 }],
  combinedProfit: 1000,
};
const ROW_KEY = "T8_BAG|Martlock";
const TABLE = "craft-planner-table";

// The planner's shape: the data row, optionally followed by the paths panel row
// carrying the source table's own column count as its colspan.
const CP_COL_COUNT = 11;
function plannerFormatter(row, idx, { withPanel = true, withAddCell = true } = {}) {
  const add = withAddCell ? `<td class="cell-add"><button data-add-row="1">+</button></td>` : "";
  const dataRow = `<tr data-row-key="${getKey(row)}">`
    + add
    + `<td class="cell-item">${row.item.name}</td>`
    + `<td class="cell-mats">8x cloth<span class="cp-paths-toggle" data-paths-toggle="${getKey(row)}">&#9656; paths</span></td>`
    + `</tr>`;
  const panel = withPanel
    ? `<tr class="cp-paths-row" data-paths-for="${getKey(row)}">`
      + `<td colspan="${CP_COL_COUNT}"><div class="cp-paths-wrap">buy it</div></td></tr>`
    : "";
  return dataRow + panel;
}
function getKey(row) { return row.item.id + "|" + row.craftCity; }

function setFormatter(opts) {
  api.tableState[TABLE].data = [ROW];
  api.tableState[TABLE].formatter = (row, idx) => plannerFormatter(row, idx, opts);
}

function reset(opts) {
  api.clearCraftList();
  setFormatter(opts);
  listBody.innerHTML = "";
  matsBody.innerHTML = "";
  api.addCraftListEntry({ tableId: TABLE, rowKey: ROW_KEY, itemId: ROW.item.id, qty: 1 });
  api.renderCraftListTable();
}

const rowsOf = (html) => (String(html).match(/<tr[\s\S]*?<\/tr>/g) || []);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// ── a single-row formatter is unchanged ─────────────────────────────────────

test("a formatter that emits one row still yields one grafted row", () => {
  reset({ withPanel: false });
  const rows = rowsOf(listBody.innerHTML).filter((r) => /data-row-key="T8_BAG/.test(r));
  assert.strictEqual(rows.length, 1);
  assert.match(rows[0], /data-cl-remove="1"/);
  assert.match(rows[0], /data-cl-qty="1"/);
  assert.match(rows[0], /cl-row-total/);
  assert.doesNotMatch(rows[0], /<button data-add-row/);
});

// ── the panel row survives the graft ────────────────────────────────────────

test("an open paths panel comes through as a second row", () => {
  reset({ withPanel: true });
  assert.match(listBody.innerHTML, /class="cp-paths-row"/);
  assert.match(listBody.innerHTML, /cp-paths-wrap/);
});

test("the panel row follows its data row, in that order", () => {
  reset({ withPanel: true });
  const html = listBody.innerHTML;
  const dataAt = html.indexOf('data-row-key="T8_BAG');
  const panelAt = html.indexOf('class="cp-paths-row"');
  assert.ok(dataAt > -1 && panelAt > dataAt, "panel row must come after the data row");
});

test("the toggle affordance itself survives into the list", () => {
  reset({ withPanel: true });
  assert.match(listBody.innerHTML, /data-paths-toggle="T8_BAG\|Martlock"/);
});

// ── colspan ─────────────────────────────────────────────────────────────────

test("the panel row's colspan grows by the three cells the graft adds", () => {
  reset({ withPanel: true });
  const panel = rowsOf(listBody.innerHTML).find((r) => /cp-paths-row/.test(r));
  assert.ok(panel, "no panel row rendered");
  assert.match(panel, new RegExp(`colspan="${CP_COL_COUNT + 3}"`));
});

test("the data row's own cells are NOT re-spanned", () => {
  reset({ withPanel: true });
  const dataRow = rowsOf(listBody.innerHTML).find((r) => /data-row-key="T8_BAG/.test(r));
  assert.doesNotMatch(dataRow, /colspan=/);
});

// ── the no-"+"-cell fallback ────────────────────────────────────────────────

test("a formatter row with no + cell keeps its trailing rows too", () => {
  reset({ withPanel: true, withAddCell: false });
  assert.match(listBody.innerHTML, /class="cp-paths-row"/);
  const panel = rowsOf(listBody.innerHTML).find((r) => /cp-paths-row/.test(r));
  assert.match(panel, new RegExp(`colspan="${CP_COL_COUNT + 3}"`));
  // The list cells were prepended instead of replacing a "+" cell.
  const dataRow = rowsOf(listBody.innerHTML).find((r) => /data-row-key="T8_BAG/.test(r));
  assert.match(dataRow, /data-cl-qty="1"/);
});

// ── a closed panel adds nothing ─────────────────────────────────────────────

test("a closed panel leaves no empty panel row behind", () => {
  reset({ withPanel: false });
  assert.doesNotMatch(listBody.innerHTML, /cp-paths-row/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
