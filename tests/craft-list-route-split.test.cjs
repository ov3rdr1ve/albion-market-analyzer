/**
 * My Crafting List — the Caerleon route split at the render level
 * (js/render-craft-list.js `findCraftListRow` and the panel).
 *
 * crafting-table / mounts-table row keys are `itemId|craftCity`, so the same
 * item appears in a table twice — once for the royal route, once for the
 * Caerleon / Black Market one — and the list may hold BOTH as entries. The
 * source lookup must respect that split:
 *
 *   - while the entry's own route still has a row, that row wins: the exact
 *     key, the city-independent identity and the item-id fallback all stay
 *     within the route, and the other route's row never displaces it,
 *   - when the entry's own route has NO row for the item at all (the transport
 *     table prices only its Caerleon candidate; a restart lost the winning
 *     city), the item-id fallback crosses the split and binds the one priced
 *     row — a "not priced yet" placeholder over existing data is the bug,
 *     not the answer,
 *   - only an item with no row on either route falls to the placeholder /
 *     held-row path.
 *
 * Black-box: the same string-surgery fake DOM tests/craft-list-render.test.cjs
 * uses (no jsdom in this repo), extended with the `table.cl-inner` node list
 * `_clHeldRows` walks, so a previous render's rows can be modelled as held.
 *
 * Run: node tests/craft-list-route-split.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const loadFile = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/if \(typeof module[\s\S]*$/, "");

// ── the fake DOM ────────────────────────────────────────────────────────────

const sandbox = `
const _store = { tbodies: {}, els: {}, heads: {} };

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
  if (tableId === "crafting-table" || tableId === "mounts-table") {
    return (row.item && row.item.id) + "|" + (row.craftCity || "");
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

// Two fake source tables: rows + the formatter renderTableData would have cached.
const tableState = {
  "crafting-table": { data: [], formatter: null },
  "mounts-table": { data: [], formatter: null },
};
function craftingFormatter(row, idx) {
  return \`
  <tr data-row-key="\${getRowKey(row, "crafting-table")}">
    <td class="cell-add"><button data-add-row="1">+</button></td>
    <td class="cell-item">\${row.item.name}</td>
    <td class="price-editable" data-item-id="\${row.item.id}" data-craft-city="\${row.craftCity}" data-row-idx="\${idx}">\${row.sellGear.price}</td>
  </tr>\`;
}
function mountsFormatter(row, idx) {
  return \`
  <tr data-row-key="\${getRowKey(row, "mounts-table")}">
    <td class="cell-add"><button data-add-row="1">+</button></td>
    <td class="cell-item">\${row.item.name}</td>
    <td class="price-editable" data-item-id="\${row.item.id}" data-craft-city="\${row.craftCity}" data-row-idx="\${idx}">\${row.sellPot.price}</td>
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
  + loadFile("js/craft-list-per10k.js")
  + loadFile("js/craft-list-sort.js")
  + loadFile("js/render-craft-list-footer.js")
  + loadFile("js/render-craft-list-header.js")
  + loadFile("js/render-craft-list-source.js")
  + loadFile("js/render-craft-list-cells.js")
  + loadFile("js/render-craft-list.js")
  + `
module.exports = {
  renderCraftListTable, findCraftListRow,
  addCraftListEntry, clearCraftList, setCraftListStorage, getCraftList,
  loadCraftListFromStorage, CRAFT_LIST_KEY, CRAFT_LIST_VERSION_KEY,
  CRAFT_LIST_SCHEMA_VERSION, setCraftListSortStorage,
  setBootFilling, isBootFilling, setRerenderBusy,
  _store, tableState, craftingFormatter, mountsFormatter,
};`;

const m = new Module("craft-list-route-split-test");
m._compile(src, path.join(ROOT, "js", "craft-list-route-split-test.js"));
const api = m.exports;

// ── harness helpers ─────────────────────────────────────────────────────────

function makeStorage(backing) {
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); },
    removeItem: (k) => { delete backing[k]; },
  };
}

const sortBacking = {};
api.setCraftListStorage(makeStorage({}));
api.setCraftListSortStorage(makeStorage(sortBacking));

const matsBody = { set innerHTML(v) { this._v = v; }, get innerHTML() { return this._v || ""; } };
api._store.tbodies["#craft-list-mats-table tbody"] = matsBody;
api._store.els["cl-count"] = { textContent: "" };
api._store.els["cl-clear-all"] = { hidden: false };
api._store.heads["crafting-table"] = ["", "Item:name", "Best Sell Price"];
api._store.heads["mounts-table"] = ["", "Item:name", "Best Sell Price"];

// The list body also answers the `table.cl-inner` node list `_clHeldRows`
// walks: the previous render's group tables, parsed back out of the HTML.
const listBody = {
  _v: "",
  set innerHTML(v) { this._v = v; },
  get innerHTML() { return this._v || ""; },
  querySelectorAll(sel) {
    if (sel !== "table.cl-inner") return [];
    const groups = [];
    const re = /<table class="data-table cl-inner" data-cl-group="([^"]*)">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/g;
    let match;
    while ((match = re.exec(this._v))) {
      const rows = [];
      const rowRe = /<tr\b[^>]*>[\s\S]*?<\/tr>/g;
      let row;
      while ((row = rowRe.exec(match[2]))) rows.push(fakeRow(row[0]));
      const groupId = match[1];
      groups.push({
        getAttribute: (a) => (a === "data-cl-group" ? groupId : null),
        tBodies: [{ rows }],
      });
    }
    return groups;
  },
};
api._store.tbodies["#craft-list-table tbody"] = listBody;

// Minimal row/cell fakes for the harvest — what _clHeldRows asks of a <tr>
// (same shape as tests/craft-list-held-rows.test.cjs, without the editor paths:
// the rows harvested here never carry an open price editor).
function fakeTd(html) {
  const open = html.slice(0, html.indexOf(">") + 1);
  const td = {
    _open: open,
    _content: html.slice(open.length, html.lastIndexOf("</td>")),
    _oldHtml: undefined,
    className: (/(?:^|\s)class="([^"]*)"/.exec(open) || [null, ""])[1] || "",
    style: {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    get outerHTML() { return td._open + td._content + "</td>"; },
    set innerHTML(v) { td._content = v; },
    get innerHTML() { return td._content; },
  };
  td.classList = {
    contains: (c) => td.className.split(/\s+/).includes(c),
    remove: (c) => { td.className = td.className.split(/\s+/).filter((x) => x !== c).join(" "); },
  };
  return td;
}

function fakeRow(html) {
  const head = html.slice(0, html.indexOf(">"));
  const attrs = {};
  const re = /(data-[\w-]+)="([^"]*)"/g;
  let match;
  while ((match = re.exec(head))) attrs[match[1]] = match[2];

  const row = {
    _tds: [],
    className: (/<tr[^>]*class="([^"]*)"/.exec(html) || [null, ""])[1],
    getAttribute: (name) => (attrs[name] != null ? attrs[name] : null),
    // A fresh parse: like the real cloneNode, it carries none of the mutations
    // made after the row was built.
    cloneNode: () => fakeRow(html),
    querySelectorAll: (sel) => (sel === "td" ? row._tds : []),
    get outerHTML() {
      let open = html.slice(0, html.indexOf(">") + 1);
      if (/class="/.test(open)) open = open.replace(/class="[^"]*"/, `class="${row.className}"`);
      else if (row.className) open = open.replace(/<tr/, `<tr class="${row.className}"`);
      return open + row._tds.map((td) => td.outerHTML).join("") + "</tr>";
    },
  };
  const tds = [];
  const tdRe = /<td\b[^>]*>[\s\S]*?<\/td>/g;
  let cell;
  while ((cell = tdRe.exec(html))) tds.push(fakeTd(cell[0]));
  row._tds = tds;
  row.classList = {
    add: (cls) => {
      if (row.className.split(/\s+/).includes(cls)) return;
      row.className = (row.className ? `${row.className} ` : "") + cls;
    },
  };
  return row;
}

// ── fixture ─────────────────────────────────────────────────────────────────

const ROYAL_SRC = {
  item: { id: "T6_BAG", name: "Bag [T6]" },
  materials: [{ matId: "T6_CLOTH", count: 16 }],
  matBestPrices: { T6_CLOTH: { city: "Martlock", price: 300 } },
  craftCity: "Martlock",
  sellGear: { city: "Bridgewatch", price: 5000 },
  totalInputCost: 3200,
  focusCost: 180,
  marginInfo: { profit: 400, margin: 50 },
};
// Same item, Caerleon route — a different craft city AND a different sell leg,
// so a row bound to the wrong route prints the wrong numbers.
const CAERLEON_SRC = {
  ...ROYAL_SRC,
  craftCity: "Caerleon",
  sellGear: { city: "Caerleon", price: 7777 },
  marginInfo: { profit: 900, margin: 60 },
};
const MOUNT_ROYAL_SRC = {
  item: { id: "T7_HORSE", name: "Horse [T7]" },
  materials: [{ matId: "T7_LEATHER", count: 20 }],
  matBestPrices: { T7_LEATHER: { city: "Martlock", price: 900 } },
  craftCity: "Martlock",
  sellPot: { city: "Caerleon", price: 30000 },
  totalInputCost: 12000,
  focusCost: 0,
  marginInfo: { profit: 300, margin: 20 },
};

// A transport-style resource priced only on the Caerleon side: the table has
// NO royal row for it while the stored entry is the royal one — the restart
// shape the cross-route fallback exists for.
const PLANKS_ROYAL_SRC = {
  item: { id: "T5_PLANKS", name: "Planks [T5]" },
  materials: [{ matId: "T5_WOOD", count: 8 }],
  matBestPrices: { T5_WOOD: { city: "Martlock", price: 120 } },
  craftCity: "Martlock",
  sellGear: { city: "Fort Sterling", price: 900 },
  totalInputCost: 960,
  focusCost: 45,
  marginInfo: { profit: 60, margin: 12 },
};
const PLANKS_CAERLEON_SRC = {
  ...PLANKS_ROYAL_SRC,
  craftCity: "Caerleon",
  sellGear: { city: "Caerleon", price: 4242 },
  marginInfo: { profit: 150, margin: 25 },
};

const ROYAL_KEY = "T6_BAG|Martlock";
const CAERLEON_KEY = "T6_BAG|Caerleon";
const PLANKS_ROYAL_KEY = "T5_PLANKS|Martlock";

let backing = {};
function reset() {
  api.clearCraftList();
  // The app's steady state: boot is over and no pass is running. The cases that
  // care flip these themselves.
  api.setBootFilling(false);
  api.setRerenderBusy(false);
  backing = {};
  api.setCraftListStorage(makeStorage(backing));
  api.tableState["crafting-table"].data = [];
  api.tableState["crafting-table"].formatter = api.craftingFormatter;
  api.tableState["mounts-table"].data = [];
  api.tableState["mounts-table"].formatter = api.mountsFormatter;
  listBody.innerHTML = "";
  matsBody.innerHTML = "";
}

// Seed the store DIRECTLY through its persisted shape, so the render-level
// cases exercise the lookup on two entries regardless of how addCraftListEntry
// dedupes (the store-level split is pinned in tests/craft-list-store.test.cjs).
function seedEntries() {
  backing[api.CRAFT_LIST_KEY] = JSON.stringify([
    { tableId: "crafting-table", rowKey: ROYAL_KEY, itemId: "T6_BAG", qty: 2, addedAt: 1 },
    { tableId: "crafting-table", rowKey: CAERLEON_KEY, itemId: "T6_BAG", qty: 3, addedAt: 2 },
  ]);
  backing[api.CRAFT_LIST_VERSION_KEY] = api.CRAFT_LIST_SCHEMA_VERSION;
  api.loadCraftListFromStorage();
}

const qtyInputs = (html) => (html.match(/data-cl-qty="1"/g) || []).length;
const craftCityMarks = (html, city) => (html.match(new RegExp(`data-craft-city="${city}"`, "g")) || []).length;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// ── two entries, two rows ───────────────────────────────────────────────────

test("route split — adding the same item from both routes renders two rows", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROYAL_KEY, itemId: "T6_BAG", qty: 2 });
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: CAERLEON_KEY, itemId: "T6_BAG", qty: 3 });
  api.tableState["crafting-table"].data = [ROYAL_SRC, CAERLEON_SRC];
  api.renderCraftListTable();
  const html = listBody.innerHTML;
  assert.strictEqual(qtyInputs(html), 2, "two entries must render two list rows");
  assert.match(html, /data-cl-qty="1"[^>]*data-row-key="T6_BAG\|Martlock"/);
  assert.match(html, /data-cl-qty="1"[^>]*data-row-key="T6_BAG\|Caerleon"/);
  assert.strictEqual(craftCityMarks(html, "Martlock"), 1, "the royal row renders once");
  assert.strictEqual(craftCityMarks(html, "Caerleon"), 1, "the Caerleon row renders once");
});

test("route split — two seeded entries bind their OWN source rows", () => {
  reset();
  seedEntries();
  api.tableState["crafting-table"].data = [ROYAL_SRC, CAERLEON_SRC];
  api.renderCraftListTable();
  const html = listBody.innerHTML;
  // Quantity and city travel together: the royal qty sits on the royal row, the
  // Caerleon qty on the Caerleon row.
  let royalRow = html.slice(html.indexOf('data-row-key="T6_BAG|Martlock"'));
  royalRow = royalRow.slice(0, royalRow.indexOf("</tr>"));
  assert.match(royalRow, /data-craft-city="Martlock"/, "the royal entry bound the royal row");
  assert.match(royalRow, /value="2"/, "with the royal entry's quantity");
  let caerleonRow = html.slice(html.indexOf('data-row-key="T6_BAG|Caerleon"'));
  caerleonRow = caerleonRow.slice(0, caerleonRow.indexOf("</tr>"));
  assert.match(caerleonRow, /data-craft-city="Caerleon"/, "the Caerleon entry bound the Caerleon row");
  assert.match(caerleonRow, /value="3"/, "with the Caerleon entry's quantity");
});

// ── findCraftListRow: the split is a routing rule ───────────────────────────

test("route split — own route gone, a Caerleon entry binds the only priced (royal) row", () => {
  reset();
  const state = { data: [ROYAL_SRC] };
  const found = api.findCraftListRow(state, { tableId: "crafting-table", rowKey: CAERLEON_KEY, itemId: "T6_BAG" });
  assert.strictEqual(found.idx, 0, "no caerleon row exists — the priced royal row beats a placeholder");
  assert.strictEqual(found.row, ROYAL_SRC);
});

test("route split — own route gone, a royal entry binds the only priced (Caerleon) row", () => {
  reset();
  const state = { data: [CAERLEON_SRC] };
  const found = api.findCraftListRow(state, { tableId: "crafting-table", rowKey: ROYAL_KEY, itemId: "T6_BAG" });
  assert.strictEqual(found.idx, 0, "no royal row exists — the priced caerleon row beats a placeholder");
  assert.strictEqual(found.row, CAERLEON_SRC);
});

test("route split — mounts-table crosses the same way when its own route is gone", () => {
  reset();
  const state = { data: [MOUNT_ROYAL_SRC] };
  const found = api.findCraftListRow(state, { tableId: "mounts-table", rowKey: "T7_HORSE|Caerleon", itemId: "T7_HORSE" });
  assert.strictEqual(found.idx, 0);
  assert.strictEqual(found.row, MOUNT_ROYAL_SRC);
});

test("route split — exact keys still win when both rows exist", () => {
  reset();
  const state = { data: [ROYAL_SRC, CAERLEON_SRC] };
  assert.strictEqual(
    api.findCraftListRow(state, { tableId: "crafting-table", rowKey: CAERLEON_KEY, itemId: "T6_BAG" }).idx,
    1,
  );
  assert.strictEqual(
    api.findCraftListRow(state, { tableId: "crafting-table", rowKey: ROYAL_KEY, itemId: "T6_BAG" }).idx,
    0,
  );
});

test("route split — royal drift still binds inside the royal route", () => {
  reset();
  const state = { data: [ROYAL_SRC] };
  assert.strictEqual(
    api.findCraftListRow(state, { tableId: "crafting-table", rowKey: "T6_BAG|Bridgewatch", itemId: "T6_BAG" }).idx,
    0,
    "a moved royal city is still the same royal entry",
  );
});

test("route split — same-route row present, the other route never displaces it", () => {
  reset();
  const state = { data: [ROYAL_SRC, CAERLEON_SRC] };
  assert.strictEqual(
    api.findCraftListRow(state, { tableId: "crafting-table", rowKey: "T6_BAG|Bridgewatch", itemId: "T6_BAG" }).idx,
    0,
    "royal drift binds the royal row even though a caerleon row shares the item",
  );
  assert.strictEqual(
    api.findCraftListRow(state, { tableId: "crafting-table", rowKey: "T6_BAG|Black Market", itemId: "T6_BAG" }).idx,
    1,
    "caerleon drift binds the caerleon row even though a royal row shares the item",
  );
});

// ── a route's source row vanishes ───────────────────────────────────────────

test("route split — idle, a Caerleon entry whose row vanished prices from the royal row", () => {
  reset();
  seedEntries();
  api.tableState["crafting-table"].data = [ROYAL_SRC]; // the Caerleon row lost the city
  api.renderCraftListTable();
  const html = listBody.innerHTML;
  assert.doesNotMatch(html, /cl-missing/, "a priced row exists — no placeholder");
  assert.strictEqual(qtyInputs(html), 2, "both entries stay on the list");
  assert.strictEqual(craftCityMarks(html, "Martlock"), 2, "both entries price from the surviving row");
  let caerleonRow = html.slice(html.indexOf('data-row-key="T6_BAG|Caerleon"'));
  caerleonRow = caerleonRow.slice(0, caerleonRow.indexOf("</tr>"));
  assert.match(caerleonRow, /value="3"/, "the caerleon entry keeps its own quantity");
});

test("route split — idle, a royal entry prices from the Caerleon row when no royal row rendered", () => {
  reset();
  seedEntries();
  api.tableState["crafting-table"].data = [CAERLEON_SRC]; // only the Caerleon row is priced
  api.renderCraftListTable();
  const html = listBody.innerHTML;
  assert.doesNotMatch(html, /cl-missing/, "the royal entry prices from the only priced row");
  assert.strictEqual(craftCityMarks(html, "Caerleon"), 2, "both entries bind the caerleon row");
  assert.strictEqual(qtyInputs(html), 2, "both entries stay on the list");
});

test("route split — a royal entry whose route never rendered prices from the Caerleon row", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: PLANKS_ROYAL_KEY, itemId: "T5_PLANKS", qty: 4 });
  api.tableState["crafting-table"].data = [PLANKS_CAERLEON_SRC]; // only the caerleon candidate rendered
  api.renderCraftListTable();
  const html = listBody.innerHTML;
  assert.doesNotMatch(html, /cl-missing/, "real prices exist — the placeholder must not win");
  assert.doesNotMatch(html, /Not priced yet/);
  assert.match(html, />4242</, "the caerleon row's numbers render");
  assert.strictEqual(craftCityMarks(html, "Caerleon"), 1, "the caerleon candidate is bound once");
  let row = html.slice(html.indexOf('data-row-key="T5_PLANKS|Martlock"'));
  row = row.slice(0, row.indexOf("</tr>"));
  assert.match(row, /value="4"/, "the entry keeps its quantity");
});

test("route split — the same-route row still wins when both routes rendered", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: PLANKS_ROYAL_KEY, itemId: "T5_PLANKS", qty: 4 });
  api.tableState["crafting-table"].data = [PLANKS_ROYAL_SRC, PLANKS_CAERLEON_SRC];
  api.renderCraftListTable();
  const html = listBody.innerHTML;
  assert.doesNotMatch(html, /cl-missing/);
  assert.strictEqual(craftCityMarks(html, "Martlock"), 1, "the royal entry bound the royal row");
  assert.strictEqual(craftCityMarks(html, "Caerleon"), 0, "the caerleon candidate must not displace it");
  assert.match(html, />900</, "the ROYAL numbers render");
  assert.doesNotMatch(html, />4242</);
});

test("route split — a city-empty entry binds the priced Caerleon row", () => {
  reset();
  const state = { data: [CAERLEON_SRC] };
  const found = api.findCraftListRow(state, { tableId: "crafting-table", rowKey: "T6_BAG|", itemId: "T6_BAG" });
  assert.strictEqual(found.idx, 0, "added unpriced, the caerleon row is priced after the restart");
  assert.strictEqual(found.row, CAERLEON_SRC);
});

test("route split — a city-empty entry renders prices, not a placeholder", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: "T6_BAG|", itemId: "T6_BAG", qty: 1 });
  api.tableState["crafting-table"].data = [CAERLEON_SRC];
  api.renderCraftListTable();
  const html = listBody.innerHTML;
  assert.doesNotMatch(html, /cl-missing/);
  assert.doesNotMatch(html, /Not priced yet/);
  assert.match(html, />7777</);
});

test("route split — no row on either route still falls to the placeholder", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: "T9_GHOST|Martlock", itemId: "T9_GHOST", qty: 1 });
  api.tableState["crafting-table"].data = [ROYAL_SRC, CAERLEON_SRC];
  api.renderCraftListTable();
  const html = listBody.innerHTML;
  assert.match(html, /cl-missing/);
  assert.match(html, /Not priced yet/);
  assert.strictEqual(qtyInputs(html), 1, "the ghost entry stays on the list");
});

test("route split — mid-pass, a vanished route binds the only priced row", () => {
  reset();
  seedEntries();
  api.tableState["crafting-table"].data = [ROYAL_SRC, CAERLEON_SRC];
  api.renderCraftListTable(); // both rows on screen — this is what gets harvested
  api.tableState["crafting-table"].data = [ROYAL_SRC]; // the Caerleon row lost the city
  api.setRerenderBusy(true);
  try { api.renderCraftListTable(); }
  finally { api.setRerenderBusy(false); }
  const html = listBody.innerHTML;
  assert.strictEqual(qtyInputs(html), 2, "the row count is preserved across the pass");
  assert.strictEqual(craftCityMarks(html, "Martlock"), 2, "both entries price from the surviving row");
  assert.strictEqual(craftCityMarks(html, "Caerleon"), 0, "the vanished row is gone");
});

test("route split — mid-pass, an entry with no row on EITHER route holds its last row", () => {
  reset();
  seedEntries();
  api.tableState["crafting-table"].data = [ROYAL_SRC, CAERLEON_SRC];
  api.renderCraftListTable(); // both rows on screen — this is what gets harvested
  api.tableState["crafting-table"].data = []; // nothing anywhere for the item
  api.setRerenderBusy(true);
  try { api.renderCraftListTable(); }
  finally { api.setRerenderBusy(false); }
  const html = listBody.innerHTML;
  assert.strictEqual(qtyInputs(html), 2, "the row count is preserved across the pass");
  assert.match(html, /cl-held/, "nothing binds, so the last rows are held");
  assert.match(html, />5000</, "the royal row's numbers survive");
  assert.match(html, />7777</, "the caerleon row's numbers survive");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
