/**
 * My Crafting List — the self-found secondary line in "Profit / 10k Focus"
 * (plan.md step 1: tests first, TDD red).
 *
 * The mounts table's p10k cell carries a dimmed `self-found` <small> under the
 * bought value (js/render-mounts-breeding-row.js). The crafting list re-renders
 * each entry through the source formatter and then OVERWRITES the whole cell
 * (patchPer10kCell / refreshPer10kCell in js/craft-list-per10k.js), so the
 * line — and its tooltip — vanish exactly where the plan is being sized. The
 * list cell is a COMBINED figure (Total Profit + one full 10k bar), so the
 * self-found twin must be combined the same way, with the bar addend swapped to
 * row.profitPer10kFocusSelfFound.
 *
 * Contract under test (plan.md):
 *   patchPer10kCell(tr, tableId, base, rowProfit, parked, baseSelf)
 *     - finite baseSelf  → keeps the bought combined value, appends a dimmed
 *       display:block <small> ("self-found" + the self-found combined value)
 *       with its OWN tooltip, and persists data-cl-p10k-base-self;
 *     - otherwise byte-identical to today.
 *   refreshPer10kCell(row, rowProfit, parked)
 *     - rebuilds that line from the stashed attribute while a qty is typed.
 *
 * Black box: scenarios a–d drive the module through fake thead/row objects and
 * read textContent, attributes and markup back; scenario e renders a full list
 * through the real render stack (js/render-craft-list.js and its modules) with
 * a breeding-style row carrying profitPer10kFocusSelfFound. No market data, no
 * browser, no live API.
 *
 * Run: node tests/craft-list-self-found-per10k-focus.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const MOD = path.join(ROOT, "js", "craft-list-per10k.js");

globalThis.tx = (en) => en;
globalThis.formatSilver = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");

const BASE = 4192063;      // row.profitPer10kFocus  — the bought bar
const PROFIT = 12927886;   // the row's planned total profit
const SELF = 5000000;      // row.profitPer10kFocusSelfFound — the self-bred bar
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");

/** Pull the single <small …>…</small> out of a cell, with its attributes. */
function smallOf(html) {
  const m = /<small\b([^>]*)>([\s\S]*?)<\/small>/i.exec(String(html));
  if (!m) return null;
  const attrs = {};
  String(m[1]).replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; return ""; });
  return { open: m[1], inner: m[2], attrs, title: attrs.title || "" };
}

// ── the fake DOM for scenarios a–d ──────────────────────────────────────────

/**
 * A fake <td> modelled as one HTML string plus attributes — close enough to a
 * real cell that a `textContent`-first-then-append write and an `innerHTML`
 * write both read back the way a browser would read them.
 */
function td(text) {
  const cell = { _html: text || "", className: "silver-val", attrs: {} };
  cell.classList = {
    add(c) {
      const have = String(cell.className).split(/\s+/).filter(Boolean);
      if (!have.includes(c)) cell.className = have.concat(c).join(" ");
    },
    contains(c) { return String(cell.className).split(/\s+/).includes(c); },
  };
  cell.setAttribute = (k, v) => { cell.attrs[k] = String(v); };
  cell.getAttribute = (k) => (k in cell.attrs ? cell.attrs[k] : null);
  cell.removeAttribute = (k) => { delete cell.attrs[k]; };
  cell.insertAdjacentHTML = (pos, html) => {
    if (pos === "beforeend") cell._html += html;
    else if (pos === "afterbegin") cell._html = html + cell._html;
    else throw new Error("harness: unsupported insertAdjacentHTML position " + pos);
  };
  cell.appendChild = (node) => { cell._html += node.outerHTML; return node; };
  Object.defineProperty(cell, "innerHTML", {
    get() { return cell._html; },
    set(v) { cell._html = String(v); },
  });
  Object.defineProperty(cell, "textContent", {
    get() { return cell._html.replace(/<[^>]*>/g, ""); },
    set(v) { cell._html = String(v); },
  });
  Object.defineProperty(cell, "outerHTML", {
    get() {
      const a = Object.keys(cell.attrs).map((k) => ` ${k}="${cell.attrs[k]}"`).join("");
      const cls = cell.className ? ` class="${cell.className}"` : "";
      return `<td${cls}${a}>${cell._html}</td>`;
    },
  });
  return cell;
}
function row(cells) {
  return {
    cells,
    querySelectorAll(sel) { return sel === "td" ? cells : []; },
    querySelector(sel) {
      const want = sel.replace(/^\./, "");
      return cells.find((c) => String(c.className).split(/\s+/).includes(want)) || null;
    },
  };
}
/** `sorts` is the source thead's data-sort values, in order. */
function withHead(sorts) {
  globalThis.document = {
    querySelectorAll(sel) {
      if (!/^#[\w-]+ thead th$/.test(sel)) return [];
      return sorts.map((s) => ({ getAttribute: (a) => (a === "data-sort" ? s : null) }));
    },
  };
}

const {
  patchPer10kCell, refreshPer10kCell,
} = require(MOD);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

/** The source row: +, item, profit, per-10k, focus-mats — p10k at index 3. */
function plannedRow() {
  withHead(["", "name", "profit", "profitPer10kFocus", "focusMats"]);
  return row([td("+"), td("Moose [T6]"), td(fmt(209603)), td(fmt(BASE)), td("20x Baby Moose")]);
}

// ── a. patching a breeding row (finite baseSelf) ────────────────────────────

test("a. patch with a self-found base keeps the bought value and stashes both bases", () => {
  const tr = plannedRow();
  assert.strictEqual(patchPer10kCell(tr, "mounts-table", BASE, PROFIT, false, SELF), true);
  const cell = tr.cells[3];
  assert.ok(String(cell.textContent).includes(fmt(BASE + PROFIT)),
    `bought combined value lost — got "${cell.textContent}"`);
  assert.strictEqual(cell.attrs["data-cl-p10k-base"], String(BASE),
    "bought base stash changed");
  assert.strictEqual(cell.attrs["data-cl-p10k-base-self"], String(SELF),
    "the self-found base must be stashed for the live qty path");
  assert.ok(String(cell.attrs.title).includes(fmt(PROFIT)) && String(cell.attrs.title).includes(fmt(BASE)),
    "the bought combined tooltip must survive under the new line");
});

test("a. the self-found line is a dimmed display:block small with its own tooltip", () => {
  const tr = plannedRow();
  patchPer10kCell(tr, "mounts-table", BASE, PROFIT, false, SELF);
  const cell = tr.cells[3];
  const small = smallOf(cell.innerHTML);
  assert.ok(small, "no <small> self-found line inside the cell");
  assert.match(small.open, /display:\s*block/, "the line must be a block of its own under the value");
  assert.match(small.open, /#9ca3af/, "the line must be dimmed like the mounts table's");
  assert.ok(small.title.length > 0, "the self-found line carries no own tooltip");
  assert.notStrictEqual(small.title, cell.attrs.title,
    "the line must not reuse the bought cell's tooltip");
});

test("a. the self-found line combines the row plan with the self-bred bar", () => {
  const tr = plannedRow();
  patchPer10kCell(tr, "mounts-table", BASE, PROFIT, false, SELF);
  const small = smallOf(tr.cells[3].innerHTML);
  assert.ok(small, "no <small> self-found line inside the cell");
  assert.match(small.inner, /self-found/, "the line must reuse the self-found label");
  assert.ok(small.inner.includes(fmt(SELF + PROFIT)),
    `line must show baseSelf + rowProfit = ${fmt(SELF + PROFIT)} — got "${small.inner}"`);
  assert.ok(small.title.includes(fmt(SELF + PROFIT)),
    "the line's own tooltip must substitute {value} with the combined self value");
  assert.match(small.title, /self-bred/,
    "the tooltip must say the bar is priced on self-bred babies");
});

test("a. parked, the self-found line keeps only the self-bred bar", () => {
  const tr = plannedRow();
  patchPer10kCell(tr, "mounts-table", BASE, PROFIT, true, SELF);
  const cell = tr.cells[3];
  assert.ok(String(cell.textContent).includes(fmt(BASE)),
    "the bought side stays the bare bar when parked");
  const small = smallOf(cell.innerHTML);
  assert.ok(small, "a parked breeding row keeps its self-found line");
  assert.ok(small.inner.includes(fmt(SELF)),
    `line must show the self-bred bar only (${fmt(SELF)}) — got "${small.inner}"`);
  assert.ok(!small.inner.includes(fmt(SELF + PROFIT)),
    "a parked row must not add planned profit to the self-found line");
  assert.ok(small.title.includes(fmt(SELF)),
    "the parked line's tooltip still explains its own value");
});

[undefined, null, NaN, "—"].forEach((baseSelf) => {
  test(`a. a non-finite self-found base (${String(baseSelf)}) changes nothing`, () => {
    const tr = plannedRow();
    patchPer10kCell(tr, "mounts-table", BASE, PROFIT, false, baseSelf);
    const cell = tr.cells[3];
    assert.strictEqual(cell.textContent, fmt(BASE + PROFIT));
    assert.strictEqual(smallOf(cell.innerHTML), null,
      "no self-found line without a self-found base");
    assert.strictEqual(cell.attrs["data-cl-p10k-base-self"], undefined,
      "no self-found stash without a self-found base");
  });
});

// ── b. backward compatibility: no baseSelf argument at all ──────────────────

test("b. no self-found argument: the cell is exactly today's combined bought value", () => {
  const tr = plannedRow();
  assert.strictEqual(patchPer10kCell(tr, "mounts-table", BASE, PROFIT, false), true);
  const cell = tr.cells[3];
  assert.strictEqual(cell.textContent, fmt(BASE + PROFIT),
    "the bought combined value must stay the cell's whole text");
  assert.strictEqual(smallOf(cell.innerHTML), null, "no <small> may appear");
  assert.strictEqual(cell.attrs["data-cl-p10k-base-self"], undefined, "no self stash may appear");
  assert.strictEqual(cell.attrs["data-cl-p10k-base"], String(BASE),
    "the bought base stash is unchanged");
});

// ── c. the live qty path (refreshPer10kCell) ────────────────────────────────

test("c. the live qty path recomputes the self-found line from the stashed base", () => {
  const tr = plannedRow();
  patchPer10kCell(tr, "mounts-table", BASE, PROFIT, false, SELF);
  assert.strictEqual(refreshPer10kCell(tr, 209603, false), true);
  const cell = tr.cells[3];
  assert.ok(String(cell.textContent).includes(fmt(BASE + 209603)),
    "the bought side must track the new plan");
  const small = smallOf(cell.innerHTML);
  assert.ok(small, "the self-found line must survive the live update");
  assert.ok(small.inner.includes(fmt(SELF + 209603)),
    `line must recombine with the new plan (${fmt(SELF + 209603)}) — got "${small.inner}"`);
  assert.ok(small.title.includes(fmt(SELF + 209603)),
    "the line's tooltip must follow the new plan");
  assert.ok(!small.title.includes(fmt(SELF + PROFIT)),
    "the stale combined value must not survive in the tooltip");
});

test("c. the live path back to 0 parks the self-found line on its bar", () => {
  const tr = plannedRow();
  patchPer10kCell(tr, "mounts-table", BASE, PROFIT, false, SELF);
  refreshPer10kCell(tr, 0, true);
  const small = smallOf(tr.cells[3].innerHTML);
  assert.ok(small, "the line survives parking");
  assert.ok(small.inner.includes(fmt(SELF)),
    `parked line must drop to the self-bred bar (${fmt(SELF)}) — got "${small.inner}"`);
  assert.ok(!small.inner.includes(fmt(SELF + PROFIT)),
    "parking must drop the planned half of the self-found line");
});

test("c. the live path adds no self-found line to a row that never had one", () => {
  const tr = plannedRow();
  patchPer10kCell(tr, "mounts-table", BASE, PROFIT, false);
  refreshPer10kCell(tr, 209603, false);
  const cell = tr.cells[3];
  assert.ok(String(cell.textContent).includes(fmt(BASE + 209603)));
  assert.strictEqual(smallOf(cell.innerHTML), null, "no line may grow on a bought-only row");
  assert.strictEqual(cell.attrs["data-cl-p10k-base-self"], undefined);
});

// ── d. the ES overlay ───────────────────────────────────────────────────────

test("d. ES overlay: r_cl_p10k_self_tip exists with {value}; r_p10k_breed_self is reused", () => {
  const { UI_STRINGS_ES_ROWS } = require(path.join(ROOT, "js", "i18n-strings-es-rows.js"));
  const { UI_STRINGS_ES } = require(path.join(ROOT, "js", "i18n-strings-es.js"));
  assert.strictEqual(typeof UI_STRINGS_ES_ROWS.r_cl_p10k_self_tip, "string",
    "missing ES entry r_cl_p10k_self_tip in js/i18n-strings-es-rows.js");
  assert.ok(UI_STRINGS_ES_ROWS.r_cl_p10k_self_tip.includes("{value}"),
    "r_cl_p10k_self_tip lost the {value} placeholder");
  assert.strictEqual(typeof UI_STRINGS_ES_ROWS.r_p10k_breed_self, "string",
    "the self-found label must keep its existing slug r_p10k_breed_self (no new slug)");
  assert.ok(UI_STRINGS_ES.r_cl_p10k_self_tip != null,
    "r_cl_p10k_self_tip not merged into UI_STRINGS_ES — tx() would render English");
});

// ── e. integration: a full list render (real render stack) ──────────────────

const loadFile = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/if \(typeof module[\s\S]*$/, "");

// Same fake DOM as tests/craft-list-render.test.cjs, extended so the p10k
// patcher's `tr.querySelectorAll("td")` returns LIVE cells whose mutations
// splice back into the row's HTML — exactly what a browser would end up with.
const sandbox = `
const _store = { tbodies: {}, els: {}, heads: {} };

function parseAttrs(openTag) {
  const attrs = {};
  String(openTag).replace(/([:\\w-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; return ""; });
  return attrs;
}
// A minimal element a patcher could build for appendChild.
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
// A live <td> over the row's HTML string: every mutation splices back, so later
// reads of tbody.innerHTML see exactly what a browser would have.
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
  // Head cells are authored as "Label" or "Label:sortCol" — the cloned header
  // carries the source column's data-sort across.
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

// App globals the renderer leans on.
function tx(en) { return en; }
function formatSilver(n) { return String(Math.round(Number(n)) || 0); }
function getItemDisplayName(id) { return "NAME:" + id; }
function matPriceSpan(id, city, price) {
  return '<span class="price-editable" data-item-id="' + id + '" data-city="' + (city || "") + '">@ ' + price + '</span>';
}
function getRowKey(row, tableId) {
  if (tableId === "crafting-table") return (row.item && row.item.id) + "|" + (row.craftCity || "");
  if (tableId === "mounts-table") {
    return ((row.isBreeding && row.item && row.item.babyId) || (row.item && row.item.id))
      + "|" + (row.craftCity || "");
  }
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

// Fake source tables: rows + the formatter renderTableData would have cached.
const tableState = {
  "crafting-table": { data: [], formatter: null },
  "consumable-table": { data: [], formatter: null },
  "mounts-table": { data: [], formatter: null },
};
function craftingFormatter(row, idx) {
  return \`
  <tr data-row-key="\${getRowKey(row, "crafting-table")}">
    <td class="cell-add"><button data-add-row="1">+</button></td>
    <td class="cell-item">\${row.item.name}</td>
    <td class="price-editable" data-item-id="\${row.item.id}" data-city="\${row.sellGear.city}" data-row-idx="\${idx}">\${row.sellGear.price}</td>
  </tr>\`;
}
// The mounts table's breeding formatter (the shape of
// js/render-mounts-breeding-row.js): its p10k cell carries the bought bar with
// the dimmed self-found <small> under it — the annotation the list must keep.
function breedingFormatter(row, idx) {
  const key = getRowKey(row, "mounts-table");
  const selfLine = (row.profitPer10kFocusSelfFound != null)
    ? '<small style="color:#9ca3af;display:block;font-size:0.7rem" title="self tip">self-found '
      + row.profitPer10kFocusSelfFound + '</small>'
    : "";
  return \`
  <tr data-row-key="\${key}">
    <td class="cell-add"><button data-add-row="1">+</button></td>
    <td class="cell-item">\${row.item.name}</td>
    <td class="silver-val" title="bought bar tip">\${row.profitPer10kFocus}\${selfLine}</td>
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
  setBootFilling, setRerenderBusy,
  _store, tableState, breedingFormatter,
};`;

const m = new Module("craft-list-self-found-per10k-test");
m._compile(src, path.join(ROOT, "js", "craft-list-self-found-per10k-test.js"));
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
api._store.heads["mounts-table"] = ["", "Item:name", "Profit / 10k Focus:profitPer10kFocus"];

// A breeding row the mounts extractor can price, carrying BOTH per-10k bars.
const BREED_ROW = {
  isBreeding: true,
  item: { id: "T6_MOOSE", babyId: "T4_BABY_MOOSE", name: "Moose [T6]" },
  buyMat: { city: "Martlock", price: 95000 },
  craftCity: "Martlock",
  sellPot: { city: "Caerleon", price: 9000 },
  totalInputCost: 100000,
  marginInfo: { profit: 400, margin: 50 },
  focusCost: 120,
  profitPer10kFocus: BASE,
  profitPer10kFocusSelfFound: SELF,
};
const BREED_KEY = "T4_BABY_MOOSE|Martlock";
// A bought-only mounts craft: a per-10k bar but NO self-found twin.
const MOUNT_ROW = {
  isBreeding: false,
  item: { id: "T6_MOOSE", name: "Moose [T6]" },
  materials: [{ matId: "T4_LEATHER", count: 20 }],
  matBestPrices: { T4_LEATHER: { city: "Martlock", price: 200 } },
  buyMat: { city: "Martlock", price: 1000 },
  craftCity: "Martlock",
  sellPot: { city: "Caerleon", price: 9000 },
  totalInputCost: 4000,
  marginInfo: { profit: 400, margin: 50 },
  focusCost: 120,
  profitPer10kFocus: BASE,
};
const MOUNT_KEY = "T6_MOOSE|Martlock";

function reset() {
  api.clearCraftList();
  api.setBootFilling(false);
  api.setRerenderBusy(false);
  api.tableState["crafting-table"].data = [];
  api.tableState["mounts-table"].data = [];
  api.tableState["mounts-table"].formatter = api.breedingFormatter;
  listBody.innerHTML = "";
  matsBody.innerHTML = "";
}

/** One rendered row's HTML, from its data-row-key to the closing </tr>. */
function rowHtmlOf(key) {
  const html = listBody.innerHTML;
  const at = html.indexOf(`data-row-key="${key}"`);
  assert.ok(at > 0, `the ${key} row rendered at all`);
  return html.slice(at, html.indexOf("</tr>", at));
}

// Since 2026-10-07 a breeding row's Profit / 10k Focus is the focus-ONLY gain
// of one bar, which the planned quantity does not change, so the list leaves
// the source cell exactly as the table drew it — no Total Profit added.
test("e. a breeding entry's list cell is the table's own focus-only cell, untouched", () => {
  reset();
  api.tableState["mounts-table"].data = [BREED_ROW];
  api.addCraftListEntry({ tableId: "mounts-table", rowKey: BREED_KEY, itemId: "T4_BABY_MOOSE", qty: 2 });
  api.renderCraftListTable();

  const rowHtml = rowHtmlOf(BREED_KEY);
  assert.doesNotMatch(rowHtml, /data-cl-p10k-base/, "a breeding cell must not be re-based on the plan");
  assert.doesNotMatch(rowHtml, /cl-p10k/, "a breeding cell must not join the live qty path");
  assert.ok(rowHtml.includes(`>${BASE}<small`), `the bought bar ${BASE} must print as is — got "${rowHtml}"`);
  assert.ok(rowHtml.includes(`self-found ${SELF}</small>`),
    "the table's self-found line must survive as is");
  assert.ok(rowHtml.includes('title="bought bar tip"'), "the table's own tooltip must survive");
});

test("e. an entry without a self-found base renders without the line", () => {
  reset();
  api.tableState["mounts-table"].data = [MOUNT_ROW];
  api.addCraftListEntry({ tableId: "mounts-table", rowKey: MOUNT_KEY, itemId: "T6_MOOSE", qty: 1 });
  api.renderCraftListTable();

  const rowHtml = rowHtmlOf(MOUNT_KEY);
  assert.match(rowHtml, /data-cl-p10k-base="4192063"/, "the bought base stash is present");
  assert.doesNotMatch(rowHtml, /data-cl-p10k-base-self/,
    "a bought-only row must not grow a self-found stash");
  assert.ok(!/<small/i.test(rowHtml), "a bought-only row must not grow a self-found line");
  assert.ok(rowHtml.includes("4192463"),
    `bought combined (bar ${fmt(BASE)} + plan 400) lost — got "${rowHtml}"`);
});

// The user's screenshot, through the whole list render: 1,440 x Moose [T6] with
// the row the REAL mounts renderer prices from his prices. Hand-worked values
// are in tests/breeding-per10k-moose-screenshot.test.cjs.
test("f. 1,440 moose: bought / self-found / gathered lines read the focus-only bars", () => {
  const { row: MOOSE } = require("./helpers/moose-screenshot-row.cjs");
  reset();
  const moose = Object.assign({}, MOOSE, { craftCity: "Thetford" });
  const key = `${moose.item.babyId}|Thetford`;
  api.tableState["mounts-table"].data = [moose];
  api.addCraftListEntry({ tableId: "mounts-table", rowKey: key, itemId: moose.item.babyId, qty: 1440 });
  api.renderCraftListTable();
  const rowHtml = rowHtmlOf(key);
  const cell = /<td class="silver-val" title="bought bar tip">([\s\S]*?)<\/td>/.exec(rowHtml);
  assert.ok(cell, "the p10k cell rendered");
  const head = Number(cell[1].split("<small")[0].trim());
  const line = (label) => {
    const m = new RegExp(label + " (-?[\\d.]+)</small>").exec(cell[1]);
    return m ? Number(m[1]) : NaN;
  };
  // Hand-worked in tests/breeding-per10k-moose-screenshot.test.cjs:
  // 24% nurture x offspring value x 20 babies a bar, whatever the qty.
  assert.ok(Math.abs(head - 1121371.2) <= 1, `all bought: expected 1,121,371, shows ${head}`);
  assert.ok(Math.abs(line("self-found") - 1867883.1) <= 1,
    `babies self-found: expected 1,867,883, shows ${line("self-found")}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
