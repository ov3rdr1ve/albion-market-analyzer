/**
 * Test: My Crafting List's Total Profit cell grows the self-gathered twin —
 * plan.md step 1 (TDD red).
 *
 * The list is a PASS-THROUGH (plan.md per-table rules): whatever twin the
 * source table put on its row (marginInfo.selfFoundProfit on a crafting row,
 * here) must reach the list's combined figures. The per-10k column already
 * does exactly this dance for profitPer10kFocusSelfFound
 * (js/craft-list-per10k.js, commit-following tests/craft-list-self-found-
 * per10k-focus.test.cjs); this applies it to the Total Profit cell:
 *
 *   extractor pass-through — extractCraftListRow("crafting-table", row)
 *     publishes the twin as unitProfitSelfFound (the unitProfit /
 *     unitProfitNoFocus / laborerProfit naming), undefined when absent;
 *
 *   full render — the cl-row-total cell keeps its headline (qty × unitProfit)
 *     and appends a dimmed display:block <small> ("self-gathered" +
 *     qty × unitProfitSelfFound) with its OWN tooltip; a row without a twin is
 *     byte-identical to today; a parked (qty 0) row reads "—" with no line;
 *
 *   live qty refresh — the keystroke path (_clRefreshTotalsOnly, the
 *     refreshPer10kCell analog for the profit cell) rebuilds BOTH lines while
 *     the quantity is typed.
 *
 * The twin scales with the quantity (a self-gathered plan of 5 crafts makes
 * 5 × the twin), and the focus budget never moves it: funded or not, materials
 * cost the same zero.
 *
 * Black-box: scenario 1 drives the REAL extractor (standalone module); the
 * render scenarios drive the REAL render stack (js/render-craft-list.js and
 * its modules) over fake thead/row objects, exactly like
 * tests/craft-list-self-found-per10k-focus.test.cjs, plus a fake
 * [data-cl-qty] input so the live refresh path has something to type at.
 * No market data, no browser, no live API.
 *
 * RED BY DESIGN: the twin field/line do not exist yet — the extractor and
 * refresh assertions fail on the missing field/line; the "absent twin" and
 * "parked" assertions are byte-identical regressions that pass before AND
 * after.
 *
 * Run: node --test tests/craft-list-self-found-profit.test.cjs
 */

const assert = require("assert");
const { test } = require("node:test");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");

// Same shape as the sandbox's formatSilver (plain rounded integer) so the
// byte-exact assertions read the harness's own output convention.
const fmt = (n) => String(Math.round(Number(n)) || 0);

/** Pull every <small …>…</small> out of a cell, with their attributes. */
function smallsOf(html) {
  const out = [];
  const re = /<small\b([^>]*)>([\s\S]*?)<\/small>/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    const attrs = {};
    String(m[1]).replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; return ""; });
    out.push({ open: m[1], inner: m[2], attrs, title: attrs.title || "" });
  }
  return out;
}

// ── 1. the extractor pass-through (pure data) ────────────────────────────────

const extractors = require(path.join(ROOT, "js", "craft-list-extractors.js"));

const CRAFT_ROW = {
  item: { id: "T4_TEST_ARMOR", name: "Test Armor" },
  craftCity: "Lymhurst",
  sellGear: { city: "Caerleon", price: 60000 },
  totalInputCost: 44305,
  marginInfo: { profit: 400, margin: 50, selfFoundProfit: 250 },
  materials: [],
  matBestPrices: {},
  rrr: 0,
  focusCost: 0,
  focusProfitDelta: 0,
};
const KEY = "T4_TEST_ARMOR|Lymhurst";

test("extractor: regression — unitProfit still comes from marginInfo.profit", () => {
  const ex = extractors.extractCraftListRow("crafting-table", CRAFT_ROW);
  assert.ok(ex, "the crafting extractor must normalize the row");
  assert.strictEqual(ex.unitProfit, 400);
  assert.strictEqual(ex.sellCity, "Caerleon");
});

test("extractor: the twin passes through as unitProfitSelfFound", () => {
  const ex = extractors.extractCraftListRow("crafting-table", CRAFT_ROW);
  assert.strictEqual(ex.unitProfitSelfFound, 250,
    "unitProfitSelfFound missing on the extracted row (feature not implemented)");
});

test("extractor: a row without a twin leaves unitProfitSelfFound absent", () => {
  const ex = extractors.extractCraftListRow("crafting-table",
    { ...CRAFT_ROW, marginInfo: { profit: 400, margin: 50 } });
  assert.strictEqual(ex.unitProfitSelfFound, undefined,
    "a bought-only row must not invent a twin");
});

// ── the fake DOM for the render scenarios (per10k-test shape) ────────────────

globalThis.tx = (en) => en;
globalThis.formatSilver = fmt;

function td(text) {
  const cell = { _html: text || "", className: "silver-val", attrs: {} };
  cell.classList = {
    add(c) {
      const have = String(cell.className).split(/\s+/).filter(Boolean);
      if (!have.includes(c)) cell.className = have.concat(c).join(" ");
    },
    contains(c) { return String(cell.className).split(/\s+/).includes(c); },
    toggle() {},
  };
  cell.setAttribute = (k, v) => { cell.attrs[k] = String(v); };
  cell.getAttribute = (k) => (k in cell.attrs ? cell.attrs[k] : null);
  cell.removeAttribute = (k) => { delete cell.attrs[k]; };
  cell.insertAdjacentHTML = (pos, html) => {
    if (pos === "beforeend") cell._html += html;
    else if (pos === "afterbegin") cell._html = html + cell._html;
    else throw new Error("harness: unsupported insertAdjacentHTML position " + pos);
  };
  Object.defineProperty(cell, "innerHTML", {
    get() { return cell._html; },
    set(v) { cell._html = String(v); },
  });
  Object.defineProperty(cell, "textContent", {
    get() { return cell._html.replace(/<[^>]*>/g, ""); },
    set(v) { cell._html = String(v); },
  });
  return cell;
}

const loadFile = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n").replace(/if \(typeof module[\s\S]*$/, "");

const sandbox = `
const _store = { tbodies: {}, els: {}, heads: {} };
const _qtyInputs = [];

function parseAttrs(openTag) {
  const attrs = {};
  String(openTag).replace(/([:\\w-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; return ""; });
  return attrs;
}
class FakeEl {
  constructor(tag) { this._tag = tag; this._inner = ""; this._attrs = {}; }
  set innerHTML(v) { this._inner = String(v); }
  set textContent(v) { this._inner = String(v); }
  set className(v) { this._attrs.class = String(v); }
  get classList() {
    const self = this;
    return { add(c) { self._attrs.class = ((self._attrs.class || "") + " " + c).trim(); } };
  }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return (k in this._attrs) ? this._attrs[k] : null; }
  get outerHTML() {
    const a = Object.keys(this._attrs).map((k) => ' ' + k + '="' + this._attrs[k] + '"').join("");
    return '<' + this._tag + a + '>' + this._inner + '</' + this._tag + '>';
  }
}
class FakeTd {
  constructor(tbody, index) {
    this.tbody = tbody; this.index = index;
    const span = this._span();
    this._attrs = parseAttrs(span.openTag);
    this._inner = span.inner;
    this.className = this._attrs.class || "";
  }
  _span() {
    const re = /<td\\b[^>]*>([\\s\\S]*?)<\\/td>/g;
    let m, i = 0;
    while ((m = re.exec(this.tbody._html))) {
      if (i++ === this.index) {
        const cut = m[0].indexOf(">");
        return { start: m.index, end: m.index + m[0].length, openTag: m[0].slice(0, cut + 1), inner: m[1] };
      }
    }
    throw new Error("harness: td #" + this.index + " is no longer in the row");
  }
  _write() {
    const span = this._span();
    const attrs = Object.assign({}, this._attrs);
    if (this.className) attrs.class = this.className; else delete attrs.class;
    const a = Object.keys(attrs).map((k) => ' ' + k + '="' + attrs[k] + '"').join("");
    const h = this.tbody._html;
    this.tbody._html = h.slice(0, span.start) + '<td' + a + '>' + this._inner + '</td>' + h.slice(span.end);
  }
  get textContent() { return this._inner.replace(/<[^>]*>/g, ""); }
  set textContent(v) { this._inner = String(v); this._write(); }
  get innerHTML() { return this._inner; }
  set innerHTML(v) { this._inner = String(v); this._write(); }
  get classList() {
    const self = this;
    return {
      add(c) {
        const have = String(self.className).split(/\\s+/).filter(Boolean);
        if (!have.includes(c)) { self.className = have.concat(c).join(" "); self._write(); }
      },
      contains(c) { return String(self.className).split(/\\s+/).includes(c); },
    };
  }
  setAttribute(k, v) { this._attrs[k] = String(v); this._write(); }
  getAttribute(k) { return (k in this._attrs) ? this._attrs[k] : null; }
  removeAttribute(k) { delete this._attrs[k]; this._write(); }
  insertAdjacentHTML(pos, html) {
    if (pos === "beforeend") this._inner += html;
    else if (pos === "afterbegin") this._inner = html + this._inner;
    else throw new Error("harness: unsupported insertAdjacentHTML " + pos);
    this._write();
  }
  appendChild(node) { this._inner += node.outerHTML; this._write(); return node; }
}
class FakeCell {
  constructor(owner) { this.owner = owner; }
  set innerHTML(v) {
    this.owner._html = this.owner._html.replace(
      /(<td class="cell-add">)[\\s\\S]*?(<\\/td>)/, "$1" + v + "$2");
  }
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
  querySelectorAll(sel) {
    if (sel === "td") {
      const n = (this.owner._html.match(/<td\\b/g) || []).length;
      const out = [];
      for (let i = 0; i < n; i++) out.push(new FakeTd(this.owner, i));
      return out;
    }
    return [];
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
  createElement(tag) { return tag === "tbody" ? new FakeTbody() : new FakeEl(tag); },
  getElementById(id) { return _store.els[id] || null; },
  querySelector(sel) { return _store.tbodies[sel] || null; },
  querySelectorAll(sel) {
    const m = /^#([\\w-]+) thead th$/.exec(sel);
    if (m) return (_store.heads[m[1]] || []).map((t) => {
      const [label, sort] = String(t).split(":");
      return { textContent: label, getAttribute: (a) => (a === "data-sort" ? (sort || null) : null) };
    });
    if (sel === "#craft-list-table [data-cl-qty]") return _qtyInputs;
    return [];
  },
};
const window = {};

function tx(en) { return en; }
function formatSilver(n) { return String(Math.round(Number(n)) || 0); }
function getItemDisplayName(id) { return "NAME:" + id; }
function matPriceSpan(id, city, price) {
  return '<span class="price-editable" data-item-id="' + id + '" data-city="' + (city || "") + '">@ ' + price + '</span>';
}
function getRowKey(row, tableId) {
  return (row.item && row.item.id) + "|" + (row.craftCity || "");
}
let lastMarketData = { seeded: true };
let lastQualityMarketData = null;

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

const tableState = {
  "crafting-table": { data: [], formatter: null },
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
  renderCraftListTable, addCraftListEntry, removeCraftListEntry, setCraftListQty,
  clearCraftList, setCraftListStorage, getCraftList, setCraftListSortStorage,
  setBootFilling, setRerenderBusy, _clRefreshTotalsOnly,
  _store, tableState, craftingFormatter, _qtyInputs,
};`;

const m = new Module("craft-list-self-found-profit-test");
m._compile(src, path.join(ROOT, "js", "craft-list-self-found-profit-test.js"));
const api = m.exports;

function makeStorage(backing) {
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); },
    removeItem: (k) => { delete backing[k]; },
  };
}
const backing = {};
api.setCraftListStorage(makeStorage(backing));
api.setCraftListSortStorage(makeStorage({}));

const listBody = { set innerHTML(v) { this._v = v; }, get innerHTML() { return this._v || ""; } };
const matsBody = { set innerHTML(v) { this._v = v; }, get innerHTML() { return this._v || ""; } };
api._store.tbodies["#craft-list-table tbody"] = listBody;
api._store.tbodies["#craft-list-mats-table tbody"] = matsBody;
api._store.els["cl-count"] = { textContent: "" };
api._store.els["cl-clear-all"] = { hidden: false };
api._store.heads["crafting-table"] = ["", "Item:name", "Best Sell Price"];

/** The rendered row's HTML, from its data-row-key to the closing </tr>. */
function rowHtmlOf(key) {
  const html = listBody.innerHTML;
  const at = html.indexOf(`data-row-key="${key}"`);
  assert.ok(at > 0, `the ${key} row rendered at all`);
  return html.slice(at, html.indexOf("</tr>", at));
}

function reset() {
  api.clearCraftList();
  api.setBootFilling(false);
  api.setRerenderBusy(false);
  api.tableState["crafting-table"].data = [];
  api.tableState["crafting-table"].formatter = api.craftingFormatter;
  listBody.innerHTML = "";
  matsBody.innerHTML = "";
  api._qtyInputs.length = 0;
}

function addRow(qty) {
  api.tableState["crafting-table"].data = [CRAFT_ROW];
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: KEY, itemId: "T4_TEST_ARMOR", qty });
  api.renderCraftListTable();
}

// ── 2. the full render ───────────────────────────────────────────────────────

test("full render: the total-profit cell keeps the headline and gains the twin line", () => {
  reset();
  addRow(2);
  const rowHtml = rowHtmlOf(KEY);
  const cell = /<td\b[^>]*class="[^"]*cl-row-total[^"]*"[^>]*>([\s\S]*?)<\/td>/.exec(rowHtml);
  assert.ok(cell, "the total cell carries the cl-row-total class");
  assert.ok(cell[1].includes(fmt(800)),
    `bought total (400 x 2) lost — got "${cell[1]}"`);
  const smalls = smallsOf(cell[1]);
  const twin = smalls.find((s) => /self-gathered/.test(s.inner));
  assert.ok(twin, `no self-gathered line in the total cell: "${cell[1]}"`);
  assert.match(twin.open, /display:\s*block/, "the line must be a block of its own");
  assert.match(twin.open, /#9ca3af/, "the line must be dimmed like the per-10k twin");
  assert.ok(twin.inner.includes(fmt(500)),
    `line must show the qty-scaled twin (250 x 2 = ${fmt(500)}) — got "${twin.inner}"`);
  assert.ok(twin.title.length > 0, "the twin line carries no own tooltip");
});

test("full render: a row WITHOUT a twin is byte-identical to today", () => {
  reset();
  api.tableState["crafting-table"].data = [{ ...CRAFT_ROW, marginInfo: { profit: 400, margin: 50 } }];
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: KEY, itemId: "T4_TEST_ARMOR", qty: 2 });
  api.renderCraftListTable();
  const rowHtml = rowHtmlOf(KEY);
  assert.ok(!/<small/i.test(rowHtml), "a bought-only row must not grow any line");
  assert.ok(rowHtml.includes(`<td class="silver-val cl-row-total profit-high">${fmt(800)}</td>`),
    `the total cell drifted from today's exact markup: ${rowHtml}`);
});

test("full render: a parked (qty 0) row reads an em dash with no twin line", () => {
  reset();
  addRow(0);
  const rowHtml = rowHtmlOf(KEY);
  const cell = /<td\b[^>]*class="[^"]*cl-row-total[^"]*"[^>]*>([\s\S]*?)<\/td>/.exec(rowHtml);
  assert.ok(cell, "the total cell is present");
  assert.strictEqual(cell[1].trim(), "—", `a parked row must read "—" — got "${cell[1]}"`);
  assert.ok(!/<small/i.test(cell[1]), "a parked row must not grow the twin line");
});

// ── 3. the live qty refresh ──────────────────────────────────────────────────

test("live qty refresh: both lines rebuild while the quantity is typed", () => {
  reset();
  addRow(2);
  const profitCell = td(fmt(800));
  const fakeRow = {
    classList: td().classList,
    querySelector: (sel) => (sel === ".cl-row-total" ? profitCell : null),
  };
  api._qtyInputs.push({
    getAttribute: (a) => (a === "data-table-id" ? "crafting-table"
      : a === "data-row-key" ? KEY : null),
    closest: (sel) => (sel === "tr" ? fakeRow : null),
  });

  api.setCraftListQty("crafting-table", KEY, 5);
  api._clRefreshTotalsOnly();

  assert.ok(profitCell.textContent.includes(fmt(2000)),
    `the headline must track the new qty (400 x 5) — got "${profitCell.textContent}"`);
  const twin = smallsOf(profitCell.innerHTML).find((s) => /self-gathered/.test(s.inner));
  assert.ok(twin,
    `the self-gathered line must survive the live qty update — got "${profitCell.innerHTML}"`);
  assert.ok(twin.inner.includes(fmt(1250)),
    `line must rescale with the qty (250 x 5 = ${fmt(1250)}) — got "${twin.inner}"`);
  assert.ok(twin.title.includes(fmt(1250)),
    "the line's own tooltip must follow the new qty");
});

test("live qty refresh: a row that never had a twin grows none", () => {
  reset();
  api.tableState["crafting-table"].data = [{ ...CRAFT_ROW, marginInfo: { profit: 400, margin: 50 } }];
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: KEY, itemId: "T4_TEST_ARMOR", qty: 2 });
  api.renderCraftListTable();
  const profitCell = td(fmt(800));
  const fakeRow = {
    classList: td().classList,
    querySelector: (sel) => (sel === ".cl-row-total" ? profitCell : null),
  };
  api._qtyInputs.push({
    getAttribute: (a) => (a === "data-table-id" ? "crafting-table"
      : a === "data-row-key" ? KEY : null),
    closest: (sel) => (sel === "tr" ? fakeRow : null),
  });

  api.setCraftListQty("crafting-table", KEY, 5);
  api._clRefreshTotalsOnly();

  assert.ok(profitCell.textContent.includes(fmt(2000)));
  assert.strictEqual(smallsOf(profitCell.innerHTML).length, 0,
    "no line may grow on a bought-only row during the live update");
});
