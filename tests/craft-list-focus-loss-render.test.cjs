/**
 * Focus-loss warning on the My Crafting List rows when TWO rows are on the
 * list (js/craft-list-focus-loss-warning.js wired in js/render-craft-list.js).
 *
 * Rows are priced STANDALONE (each as if it alone had the whole budget); the
 * footer shares one budget across all rows. The warning is driven by each row's
 * standalone funded count (allocateCraftListFocusStandalone), on both render paths: the full repaint
 * (renderCraftListTable) and the qty-edit path (_clRefreshTotalsOnly).
 * Same fake-DOM harness as tests/craft-list-render.test.cjs; synthetic numbers.
 *
 * Run: node --test tests/craft-list-focus-loss-render.test.cjs
 */
const assert = require("assert");
const { test } = require("node:test");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const loadFile = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/if \(typeof module[\s\S]*$/, "");

// ── the fake DOM ────────────────────────────────────────────────────────────

const sandbox = `
const _store = { tbodies: {}, els: {}, heads: {}, inputs: [] };

class FakeCell {
  constructor(owner) { this.owner = owner; }
  set innerHTML(v) {
    this.owner._html = this.owner._html.replace(
      /(<td class="cell-add">)[\\s\\S]*?(<\\/td>)/, "$1" + v + "$2");
  }
  // One cell replaced by several — what the list does to graft its own cells in.
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
    if (pos === "beforeend") {
      const at = this.owner._html.lastIndexOf("</tr>");
      this.owner._html = this.owner._html.slice(0, at) + html + this.owner._html.slice(at);
    } else if (pos === "afterbegin") {
      this.owner._html = this.owner._html.replace(/(<tr[^>]*>)/, "$1" + html);
    }
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
  querySelector(sel) { return _store.tbodies[sel] || null; },
  // Head cells are authored as "Label" or "Label:sortCol" — the cloned header
  // carries the source column's data-sort across.
  querySelectorAll(sel) {
    if (sel === "#craft-list-table [data-cl-qty]") return _store.inputs;
    const m = /^#([\\w-]+) thead th$/.exec(sel);
    if (m) return (_store.heads[m[1]] || []).map((t) => {
      const [label, sort] = String(t).split(":");
      return { textContent: label, getAttribute: (a) => (a === "data-sort" ? (sort || null) : null) };
    });
    return [];
  },
};
const window = {};

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

// The sorting.js contract the list's comparator delegates to.
function getSortValue(row, col) {
  if (col === "margin") return row.marginInfo ? row.marginInfo.margin : -Infinity;
  if (col === "name") return row.item ? row.item.name : "";
  return 0;
}
function compareRows(a, b, state, tableId) {
  const va = getSortValue(a, state.sortCol, tableId);
  const vb = getSortValue(b, state.sortCol, tableId);
  let cmp = (typeof va === "string" && typeof vb === "string") ? va.localeCompare(vb) : va - vb;
  if (state.sortDir === "desc") cmp = -cmp;
  return cmp;
}

// One fake source table: rows + the formatter renderTableData would have cached.
const tableState = {
  "crafting-table": { data: [], formatter: null },
  "consumable-table": { data: [], formatter: null },
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

// The two "the app is working on it" signals the placeholder row reads. The
// boot flag is the real module; the re-render one is a stub of the scheduler's
// one-line predicate (js/render-async.js isRerenderBusy).
const busySandbox = `
let _rerenderBusy = false;
function isRerenderBusy() { return _rerenderBusy; }
function setRerenderBusy(v) { _rerenderBusy = !!v; }
`;

const src = sandbox
  + loadFile("js/boot-state.js")
  + busySandbox
  + loadFile("js/craft-list-store.js")
  + loadFile("js/craft-list-focus-budget.js")
  + loadFile("js/craft-list-extractors.js")
  + loadFile("js/craft-list-extractors-transport.js")
  + loadFile("js/craft-list-materials.js")
  + loadFile("js/craft-list-focus-loss-warning.js")
  + loadFile("js/craft-list-per10k.js")
  + loadFile("js/craft-list-sort.js")
  + loadFile("js/render-craft-list-footer.js")
  + loadFile("js/render-craft-list-header.js")
  + loadFile("js/render-craft-list-source.js")
  + loadFile("js/render-craft-list-cells.js")
  + loadFile("js/render-craft-list.js")
  + `
module.exports = {
  renderCraftListTable, findCraftListRow, craftListTableLabel,
  addCraftListEntry, removeCraftListEntry, setCraftListQty, clearCraftList,
  setCraftListStorage, getCraftList,
  setCraftListSortStorage, setCraftListSort,
  _clSolverEntries, scaleCraftListToLaborers,
  setBootFilling, isBootFilling, setRerenderBusy,
  _store, tableState, craftingFormatter, _clRefreshTotalsOnly,
};`;

const m = new Module("craft-list-render-test");
m._compile(src, path.join(ROOT, "js", "craft-list-render-test.js"));
const api = m.exports;

// ── harness helpers ─────────────────────────────────────────────────────────

function makeStorage(backing) {
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); },
    removeItem: (k) => { delete backing[k]; },
  };
}
api.setCraftListStorage(makeStorage({}));
const sortBacking = {};
api.setCraftListSortStorage(makeStorage(sortBacking));

const listBody = { set innerHTML(v) { this._v = v; }, get innerHTML() { return this._v || ""; } };
const matsBody = { set innerHTML(v) { this._v = v; }, get innerHTML() { return this._v || ""; } };
api._store.tbodies["#craft-list-table tbody"] = listBody;
api._store.tbodies["#craft-list-mats-table tbody"] = matsBody;
api._store.els["cl-count"] = { textContent: "" };
api._store.els["cl-clear-all"] = { hidden: false };
api._store.heads["crafting-table"] = ["", "Item:name", "Best Sell Price"];
api._store.heads["crafting-table"] = ["", "Item:name", "Best Sell Price"];


// Two focus crafts sharing one 10k budget. Rates differ so the split is
// deterministic: A (152 focus, +1.35M per focus-on unit) is funded first.
const mkRow = (id, profit, delta, focusCost) => ({
  item: { id, name: id },
  materials: [{ matId: "T5_CLOTH", count: 8 }],
  matBestPrices: { T5_CLOTH: { city: "Martlock", price: 100 } },
  craftCity: "Martlock",
  sellGear: { city: "Caerleon", price: 5000 },
  totalInputCost: 800,
  focusCost,
  focusProfitDelta: delta,
  marginInfo: { profit, margin: 50 },
});
const rowA = mkRow("T8_A", 783053, 1350233, 152);   // unfocused -567,180
const rowB = mkRow("T8_B", 1312946, 1563000, 600);  // unfocused  -250,054

function paint(rows, qtys) {
  api.clearCraftList();
  api.setBootFilling(false);
  api.setRerenderBusy(false);
  api.tableState["crafting-table"].data = rows;
  api.tableState["crafting-table"].formatter = api.craftingFormatter;
  rows.forEach((r, i) => {
    api.addCraftListEntry({ tableId: "crafting-table", rowKey: `${r.item.id}|Martlock`, itemId: r.item.id, qty: qtys[i] });
  });
  api.renderCraftListTable();
  return listBody.innerHTML;
}
const rowHtml = (html, id) => {
  const at = html.indexOf(`data-row-key="${id}|`);
  return html.slice(at, html.indexOf("</tr>", at));
};
const warns = (html, id) => [...rowHtml(html, id).matchAll(/class="cl-row-focusloss" data-cl-qty-focus="(\d+)"/g)].map((m) => +m[1]);

test("two rows: each warns with its STANDALONE floor(funded), not the shared allocation", () => {
  const html = paint([rowA, rowB], [80, 80]);
  // A alone: 65 whole units (9,880) + 120 left as a fraction. B alone: floor(10000/600) = 16.
  assert.deepStrictEqual(warns(html, "T8_A"), [65], rowHtml(html, "T8_A"));
  assert.deepStrictEqual(warns(html, "T8_B"), [16], rowHtml(html, "T8_B"));
});

test("a row that fits the budget alone shows no warning even when another row exists", () => {
  // A at qty 60 needs 9,120 <= 10,000: fully funded standalone. B no longer starves.
  const html = paint([rowA, rowB], [60, 80]);
  assert.deepStrictEqual(warns(html, "T8_A"), [], "A is fully funded at qty 60");
  assert.deepStrictEqual(warns(html, "T8_B"), [16], rowHtml(html, "T8_B"));
});

test("a row whose qty fits the budget alone shows no warning (B qty 16 = 9,600)", () => {
  const html = paint([rowA, rowB], [80, 16]);
  assert.deepStrictEqual(warns(html, "T8_B"), []);
});

test("a qty equal to the standalone floor does not warn", () => {
  const html = paint([rowA, rowB], [65, 80]);
  assert.deepStrictEqual(warns(html, "T8_A"), []);
});

test("row profit = qty x focused unit profit when it fits the budget alone", () => {
  const html = paint([rowA, rowB], [60, 16]);
  assert.ok(rowHtml(html, "T8_A").includes(String(60 * 783053)), "A profit");
  assert.ok(rowHtml(html, "T8_B").includes(String(16 * 1312946)), "B profit");
});

test("single row above budget/focusCost still warns: N = floor(10000/152) = 65", () => {
  const html = paint([rowA], [80]);
  assert.deepStrictEqual(warns(html, "T8_A"), [65]);
});

test("footer stays on the shared cap: unfocused chip present, profit total has the tooltip", () => {
  const html = paint([rowA, rowB], [60, 16]);
  // 60x152 + 16x600 = 18,720 needed vs 10,000 budget -> shared allocation is short.
  assert.ok(/unfocused/.test(html), "footer unfocused chip");
  assert.ok(html.includes("Rows are each priced with the full focus budget"), "footer tooltip");
});

// The qty-edit path (_clRefreshTotalsOnly): one fake input + total cell per row.
function fakeInputs(rows) {
  return rows.map((r) => {
    const cell = { innerHTML: "", textContent: "", className: "" };
    const tr = { classList: { toggle() {} }, querySelector: (sel) => (sel === ".cl-row-total" ? cell : null) };
    const attrs = { "data-table-id": "crafting-table", "data-row-key": r.item.id + "|Martlock" };
    return { cell, getAttribute: (a) => attrs[a], closest: () => tr };
  });
}
function refresh(rows, qtys) {
  paint(rows, qtys);
  const inputs = fakeInputs(rows);
  api._store.inputs = inputs;
  api._clRefreshTotalsOnly();
  return inputs.map((i) => i.cell.innerHTML || i.cell.textContent);
}
const warnsIn = (html) => [...html.matchAll(/class="cl-row-focusloss" data-cl-qty-focus="(\d+)"/g)].map((m) => +m[1]);

test("qty-edit path: each row warns with its standalone N", () => {
  const cells = refresh([rowA, rowB], [80, 80]);
  assert.deepStrictEqual(warnsIn(cells[0]), [65], cells[0]);
  assert.deepStrictEqual(warnsIn(cells[1]), [16], cells[1]);
});

test("qty-edit path: a row that fits the budget alone shows no warning", () => {
  const cells = refresh([rowA, rowB], [60, 16]);
  assert.deepStrictEqual(warnsIn(cells[0]), []);
  assert.deepStrictEqual(warnsIn(cells[1]), []);
  assert.ok(cells[0].includes(String(60 * 783053)), cells[0]);
});

test("qty-edit path: single row above budget still warns", () => {
  const cells = refresh([rowA], [80]);
  assert.deepStrictEqual(warnsIn(cells[0]), [65], cells[0]);
});


