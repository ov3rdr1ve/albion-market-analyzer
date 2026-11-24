/**
 * Crafting List: a source formatter's group-header rows never reach the list.
 *
 * The Artifact Rolling formatter is stateful and PREPENDS `data-header-cat` /
 * `data-header-roll` <tr>s to the first row of each group. The list renders one
 * entry at a time, so those headers used to land in the list, the list cells
 * were grafted onto the header, and the real data row kept its source "+" cell.
 * The contract: exactly one data row per entry (the <tr data-row-key>), list
 * cells on it, the Planner's trailing "paths" panel row kept (colspan + 3).
 *
 * No jsdom: a tiny string-backed DOM models only what the renderer touches.
 *
 * Run: node tests/craft-list-source-header-rows.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const loadFile = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/if \(typeof module[\s\S]*$/, "");

const sandbox = `
const _store = { tbodies: {}, els: {}, heads: {} };

function attrOf(tag, name) {
  const m = new RegExp("\\\\s" + name + '="([^"]*)"').exec(tag);
  return m ? m[1] : null;
}
class FakeCell {
  constructor(owner) { this.owner = owner; }
  set outerHTML(v) {
    this.owner._html = this.owner._html.replace(/<td class="cell-add">[\\s\\S]*?<\\/td>/, v);
  }
}
class FakeTr {
  constructor(html, parent) { this._html = html; this.parent = parent; }
  get outerHTML() { return this._html.trim(); }
  _tag() { return /^\\s*<tr\\b[^>]*>/.exec(this._html)[0]; }
  hasAttribute(n) { return attrOf(this._tag(), n) !== null; }
  getAttribute(n) { return attrOf(this._tag(), n); }
  setAttribute(n, v) {
    this._html = this._html.replace(/^(\\s*<tr\\b)/, '$1 ' + n + '="' + v + '"');
  }
  remove() { this.parent._rows = this.parent._rows.filter((r) => r !== this); }
  querySelector(sel) {
    if (sel === "td.cell-add" && /<td class="cell-add">/.test(this._html)) return new FakeCell(this);
    return null;
  }
  querySelectorAll(sel) {
    if (sel !== "td[colspan]") return [];
    const self = this;
    const out = [];
    const re = /<td\\b[^>]*\\scolspan="(\\d+)"[^>]*>/g;
    let m;
    while ((m = re.exec(this._html))) {
      const tag = m[0], start = m.index;
      out.push({
        getAttribute: () => tag.match(/colspan="(\\d+)"/)[1],
        setAttribute: (n, v) => {
          self._html = self._html.slice(0, start) + tag.replace(/colspan="\\d+"/, 'colspan="' + v + '"') + self._html.slice(start + tag.length);
        },
      });
    }
    return out;
  }
  insertAdjacentHTML(pos, html) {
    if (pos === "afterbegin") this._html = this._html.replace(/(<tr[^>]*>)/, "$1" + html);
  }
}
class FakeTbody {
  constructor() { this._rows = []; }
  set innerHTML(v) {
    this._rows = (String(v).match(/<tr\\b[\\s\\S]*?<\\/tr>/g) || []).map((h) => new FakeTr(h, this));
  }
  get innerHTML() { return this._rows.map((r) => r._html).join("\\n"); }
  get children() { return this._rows.slice(); }
  get firstElementChild() { return this._rows[0] || null; }
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
function matPriceSpan(id, city, price) { return '<span>@ ' + price + '</span>'; }
function getRowKey(row) { return (row.item && row.item.id) + "|" + (row.craftCity || ""); }
let lastMarketData = { seeded: true };
let lastQualityMarketData = null;
function getSortValue(row, col) { return 0; }
function compareRows() { return 0; }
const tableState = { "crafting-table": { data: [], formatter: null } };
`;

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
  + loadFile("js/craft-list-per10k.js")
  + loadFile("js/craft-list-sort.js")
  + loadFile("js/render-craft-list-footer.js")
  + loadFile("js/render-craft-list-header.js")
  + loadFile("js/render-craft-list-source.js")
  + loadFile("js/render-craft-list-cells.js")
  + loadFile("js/render-craft-list.js")
  + `
module.exports = {
  renderCraftListTable, addCraftListEntry, clearCraftList, setCraftListStorage,
  setCraftListSortStorage, setBootFilling, setRerenderBusy, _store, tableState,
};`;

const m = new Module("craft-list-source-header-rows-test");
m._compile(src, path.join(ROOT, "js", "craft-list-source-header-rows-test.js"));
const api = m.exports;

const makeStorage = () => ({
  _b: {},
  getItem(k) { return k in this._b ? this._b[k] : null; },
  setItem(k, v) { this._b[k] = String(v); },
  removeItem(k) { delete this._b[k]; },
});
api.setCraftListStorage(makeStorage());
api.setCraftListSortStorage(makeStorage());
const listBody = { set innerHTML(v) { this._v = v; }, get innerHTML() { return this._v || ""; } };
const matsBody = { set innerHTML(v) { this._v = v; }, get innerHTML() { return this._v || ""; } };
api._store.tbodies["#craft-list-table tbody"] = listBody;
api._store.tbodies["#craft-list-mats-table tbody"] = matsBody;
api._store.els["cl-count"] = { textContent: "" };
api._store.els["cl-clear-all"] = { hidden: false };
api._store.heads["crafting-table"] = ["", "Item:name", "Best Sell Price"]; // 3 + 3 graft = 6

const ROW = {
  item: { id: "T5_BAG", name: "Bag [T5]" },
  materials: [], matBestPrices: {}, craftCity: "Martlock",
  sellGear: { city: "Caerleon", price: 5000 },
  totalInputCost: 800, focusCost: 120,
  marginInfo: { profit: 400, margin: 50 },
};
const ROW_KEY = "T5_BAG|Martlock";

const DATA = `<tr data-row-key="${ROW_KEY}"><td class="cell-add"><button>+</button></td><td class="cell-item">Bag [T5]</td><td>5000</td></tr>`;
const HDR_CAT = `<tr data-header-cat="Cape" style="background:#333"><td colspan="8">Cape</td></tr>`;
const HDR_ROLL = `<tr data-header-roll="g1" data-roll-cat="Cape"><td colspan="8">Roll group</td></tr>`;
const HDR_EX = `<tr data-header-cat="Cape" style="background:#7a3cff;color:rgba(255,255,255,0.85)"><td colspan="8">◆ Energy Manipulator exchange (pick, not a roll)</td></tr>`;
const HDR_EX_SUB = `<tr data-header-roll="exchange" data-roll-cat="Cape" style="background:#1c2230"><td colspan="8">— Energy Manipulator — (50 frags / exchange)</td></tr>`;
const PANEL = `<tr class="paths-panel"><td colspan="5">paths</td></tr>`;

const CASES = [
  { name: "a. single data row (baseline)", html: DATA, panel: false },
  { name: "b. roll header + roll sub-header + data row", html: HDR_CAT + HDR_ROLL + DATA, panel: false },
  { name: "c. exchange header + sub-header + data row", html: HDR_EX + HDR_EX_SUB + DATA, panel: false },
  { name: "d. data row + trailing paths panel", html: DATA + PANEL, panel: true },
  { name: "e. header + data row + paths panel", html: HDR_CAT + DATA + PANEL, panel: true },
];

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

const rowsOf = (html) => html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) || [];
const count = (s, re) => (s.match(re) || []).length;

function render(kase, qty) {
  api.clearCraftList();
  api.setBootFilling(false);
  api.setRerenderBusy(false);
  api.tableState["crafting-table"].data = [ROW];
  api.tableState["crafting-table"].formatter = () => kase.html;
  listBody.innerHTML = "";
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty });
  api.renderCraftListTable();
  return listBody.innerHTML;
}

for (const kase of CASES) {
  for (const qty of [3, 0]) {
    test(`${kase.name} (qty ${qty})`, () => {
      const out = render(kase, qty);
      const rows = rowsOf(out);
      const dataRows = rows.filter((r) => /^<tr\b[^>]*data-row-key=/.test(r.trim()) && !/cl-missing/.test(r));
      assert.doesNotMatch(out, /data-header-cat|data-header-roll/, "no source header rows");
      assert.doesNotMatch(out, /Energy Manipulator|Roll group/, "no header text");
      assert.strictEqual(count(out, /data-cl-remove/g), 1, "exactly one remove button");
      assert.strictEqual(dataRows.length, 1, "exactly one data row");
      const row = dataRows[0];
      assert.match(row, /data-cl-remove/, "remove button lives in the data row");
      assert.doesNotMatch(out, /<button>\+<\/button>/, "source + cell gone");
      assert.match(row, /cl-row-total/, "list total cell on the data row");
      assert.strictEqual(count(row, /<td\b/g), 6, "cell count = group column count");
      if (qty === 0) assert.match(row, /^<tr[^>]*cl-qty-zero/, "parked mark on the data row");
      else assert.doesNotMatch(row, /cl-qty-zero/);
      const panels = rows.filter((r) => /paths-panel/.test(r));
      if (kase.panel) {
        assert.strictEqual(panels.length, 1, "panel row kept");
        assert.match(panels[0], /colspan="8"/, "panel colspan widened by 3");
        assert.ok(out.indexOf(panels[0]) > out.indexOf(row), "panel after the data row");
      } else {
        assert.strictEqual(panels.length, 0);
      }
    });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
