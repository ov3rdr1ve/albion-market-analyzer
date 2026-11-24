/**
 * My Crafting List panel rendering (js/render-craft-list.js).
 *
 * The panel's whole point is REUSE: a list row is produced by the source
 * table's own formatter, then grafted with the list's cells. So the assertions
 * are about the graft — the source cells survive, the "+" cell becomes a ✕, a
 * quantity and a row total are appended — plus grouping, placeholders, totals
 * and the aggregated materials board.
 *
 * No jsdom in this repo: the few DOM operations the renderer performs
 * (createElement("tbody") → innerHTML → firstElementChild → querySelector /
 * insertAdjacentHTML → outerHTML) are stubbed as string surgery below, which is
 * exactly what the browser does to the same markup.
 *
 * Run: node tests/craft-list-render.test.cjs
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
  _store, tableState, craftingFormatter,
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

const ROW = {
  item: { id: "T5_BAG", name: "Bag [T5]" },
  materials: [{ matId: "T5_CLOTH", count: 8 }],
  matBestPrices: { T5_CLOTH: { city: "Martlock", price: 100 } },
  craftCity: "Martlock",
  sellGear: { city: "Caerleon", price: 5000 },
  totalInputCost: 800,
  focusCost: 120,
  marginInfo: { profit: 400, margin: 50 },
};
const ROW_KEY = "T5_BAG|Martlock";

function reset() {
  api.clearCraftList();
  // The app's steady state: boot is over and no pass is running. The cases that
  // care flip these themselves.
  api.setBootFilling(false);
  api.setRerenderBusy(false);
  Object.keys(sortBacking).forEach((k) => delete sortBacking[k]);
  api.setCraftListSortStorage(makeStorage(sortBacking));
  api.tableState["crafting-table"].data = [ROW];
  api.tableState["crafting-table"].formatter = api.craftingFormatter;
  listBody.innerHTML = "";
  matsBody.innerHTML = "";
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// ── the empty state ─────────────────────────────────────────────────────────

test("an empty list renders the empty state and a (0) badge", () => {
  reset();
  api.renderCraftListTable();
  assert.match(listBody.innerHTML, /Nothing on the list yet/);
  assert.strictEqual(api._store.els["cl-count"].textContent, "(0)");
  assert.strictEqual(api._store.els["cl-clear-all"].hidden, true);
  assert.match(matsBody.innerHTML, /No purchasable materials/);
});

// ── the graft ───────────────────────────────────────────────────────────────

test("a list row is rendered by the SOURCE formatter — its editable cells survive", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG" });
  api.renderCraftListTable();
  // Editable AND showing the current number: a cell can be marked editable and
  // still be painting a stale figure (that was the reported pinning bug), so the
  // class alone proves nothing.
  assert.match(listBody.innerHTML, /class="price-editable" data-item-id="T5_BAG"[^>]*>5000</);
  assert.match(listBody.innerHTML, /Bag \[T5\]/);
});

test("the row's + cell becomes a ✕ remove button carrying its identity", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG" });
  api.renderCraftListTable();
  assert.doesNotMatch(listBody.innerHTML, /data-add-row/);
  assert.match(listBody.innerHTML, /data-cl-remove="1"[^>]*data-table-id="crafting-table"[^>]*data-row-key="T5_BAG\|Martlock"/);
  assert.match(listBody.innerHTML, /✕/);
});

test("a quantity input and a per-row total are appended INSIDE the row", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 3 });
  api.renderCraftListTable();
  const rowHtml = listBody.innerHTML.slice(listBody.innerHTML.indexOf('data-row-key="T5_BAG'));
  const qtyAt = rowHtml.indexOf('data-cl-qty');
  const endAt = rowHtml.indexOf("</tr>");
  assert.ok(qtyAt > 0 && qtyAt < endAt, "the qty cell must sit inside the row");
  assert.match(rowHtml, /value="3"/);
  assert.match(rowHtml, /cl-row-total[^>]*>1200</, "row total = unit profit 400 × qty 3");
});

// The column the quantity is typed FOR: what the plan costs to buy. Same
// expression the footer's "cost" sums, so the two can never disagree.
test("a per-row Total Buy Cost is grafted in beside the total", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 3 });
  api.renderCraftListTable();
  const rowHtml = listBody.innerHTML.slice(listBody.innerHTML.indexOf('data-row-key="T5_BAG'));
  assert.match(rowHtml, /cl-row-cost[^>]*>2400</, "row cost = input cost 800 × qty 3");
  // Cost sits between the quantity and the profit it earns.
  assert.ok(rowHtml.indexOf("cl-qty-cell") < rowHtml.indexOf("cl-row-cost"));
  assert.ok(rowHtml.indexOf("cl-row-cost") < rowHtml.indexOf("cl-row-total"));
  const totals = listBody.innerHTML.slice(listBody.innerHTML.indexOf('class="cl-totals"'));
  assert.match(totals, /cost <span class="silver-val">2400</, "and it matches the footer");
});

test("a parked row's Total Buy Cost is a dash, not a 0", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 0 });
  api.renderCraftListTable();
  assert.match(listBody.innerHTML, /cl-row-cost[^>]*>—</);
});

test("each source table gets a band row and its own column header", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG" });
  api.renderCraftListTable();
  assert.match(listBody.innerHTML, /class="cl-group"/);
  // Qty + the two totals lead, then the source table's own labels (its "+"
  // header drops).
  assert.match(listBody.innerHTML, /class="cl-colhead">[\s\S]*Qty[\s\S]*Total Buy Cost[\s\S]*Total Profit[\s\S]*Item[\s\S]*Best Sell Price/);
});

// ── sorting ─────────────────────────────────────────────────────────────────

test("the list's own columns are sortable and the group carries its table id", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG" });
  api.renderCraftListTable();
  assert.match(listBody.innerHTML, /data-cl-group="crafting-table"/);
  assert.match(listBody.innerHTML, /<th class="sortable[^"]*" data-sort="qty" title="[^"]+">Qty<\/th>/);
  assert.match(listBody.innerHTML, /<th class="sortable[^"]*" data-sort="clCost" title="[^"]+">Total Buy Cost<\/th>/);
  assert.match(listBody.innerHTML, /<th class="sortable[^"]*" data-sort="clTotal" title="[^"]+">Total Profit<\/th>/);
});

test("a cloned header keeps the source column's sort key; an unsorted one stays plain", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG" });
  api.renderCraftListTable();
  assert.match(listBody.innerHTML, /<th class="sortable[^"]*" data-sort="name">Item<\/th>/);
  assert.match(listBody.innerHTML, /<th>Best Sell Price<\/th>/, "no data-sort on the source = not sortable here");
});

test("the active column shows its direction arrow", () => {
  reset();
  api.setCraftListSort("crafting-table", "clTotal"); // first click = desc
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG" });
  api.renderCraftListTable();
  assert.match(listBody.innerHTML, /class="sortable sort-desc" data-sort="clTotal"/);
  api.setCraftListSort("crafting-table", "clTotal"); // second click = asc
  api.renderCraftListTable();
  assert.match(listBody.innerHTML, /class="sortable sort-asc" data-sort="clTotal"/);
});

test("rows reorder on the sorted column, and unsorted keeps insertion order", () => {
  reset();
  const CHEAP = { ...ROW, item: { id: "T4_BAG", name: "Bag [T4]" }, craftCity: "Martlock", marginInfo: { profit: 10, margin: 5 } };
  api.tableState["crafting-table"].data = [ROW, CHEAP];
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: "T4_BAG|Martlock", itemId: "T4_BAG" });
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG" });

  api.renderCraftListTable();
  const order = (html) => [html.indexOf("T4_BAG"), html.indexOf("T5_BAG")];
  let [t4, t5] = order(listBody.innerHTML.slice(listBody.innerHTML.indexOf("<tbody>")));
  assert.ok(t4 < t5, "added first, so listed first");

  // Total Profit desc: T5 (400 × 1) over T4 (10 × 1).
  api.setCraftListSort("crafting-table", "clTotal");
  api.renderCraftListTable();
  [t4, t5] = order(listBody.innerHTML.slice(listBody.innerHTML.indexOf("<tbody>")));
  assert.ok(t5 < t4, "the bigger total leads on desc");

  api.setCraftListSort("crafting-table", "clTotal"); // flip to asc
  api.renderCraftListTable();
  [t4, t5] = order(listBody.innerHTML.slice(listBody.innerHTML.indexOf("<tbody>")));
  assert.ok(t4 < t5, "the smaller total leads on asc");

});

// The list prints Profit / 10k Focus as the row's bar PLUS its Total Profit
// (js/craft-list-per10k.js), so the column must order on that — not on the
// source row's bare per-10k figure, which is what the reported bug sorted on.
test("Profit / 10k Focus orders rows by the number the list prints", () => {
  reset();
  const savedHead = api._store.heads["crafting-table"];
  api._store.heads["crafting-table"] = ["", "Item:name", "Best Sell Price", "P10k:profitPer10kFocus"];
  try {
    // T5: bar 1,000 + 400 × 10 = 5,000.  T4: bar 3,000 + 10 × 1 = 3,010.
    // Bare bars would put T4 first.
    const T5 = { ...ROW, profitPer10kFocus: 1000 };
    const T4 = { ...ROW, item: { id: "T4_BAG", name: "Bag [T4]" }, profitPer10kFocus: 3000,
      marginInfo: { profit: 10, margin: 5 } };
    api.tableState["crafting-table"].data = [T4, T5];
    api.addCraftListEntry({ tableId: "crafting-table", rowKey: "T4_BAG|Martlock", itemId: "T4_BAG", qty: 1 });
    api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 10 });
    const order = () => {
      const body = listBody.innerHTML.slice(listBody.innerHTML.indexOf("<tbody>"));
      return [body.indexOf("T4_BAG"), body.indexOf("T5_BAG")];
    };

    api.setCraftListSort("crafting-table", "profitPer10kFocus"); // desc
    api.renderCraftListTable();
    let [t4, t5] = order();
    assert.ok(t5 < t4, "5,000 leads 3,010 on desc");

    api.setCraftListSort("crafting-table", "profitPer10kFocus"); // asc
    api.renderCraftListTable();
    [t4, t5] = order();
    assert.ok(t4 < t5, "3,010 leads 5,000 on asc");
  } finally {
    api._store.heads["crafting-table"] = savedHead;
  }
});

test("an unpriced row stays at the bottom of a sorted group", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: "T9_GHOST|Martlock", itemId: "T9_GHOST" });
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG" });
  api.setCraftListSort("crafting-table", "clTotal");
  api.renderCraftListTable();
  const body = listBody.innerHTML.slice(listBody.innerHTML.indexOf("<tbody>"));
  assert.ok(body.indexOf("T5_BAG") < body.indexOf("T9_GHOST"), "the placeholder sinks");
});

// A shared table sizes column N from the widest cell ANYWHERE in it, so the
// Crafting Planner's multi-line cells were stretching the Consumables group's
// short numeric columns and pushing the list off screen. Each group renders in
// its own table now; the groups have different column counts and different
// column meanings, so they were never comparable in the first place.
test("each group renders in its OWN table, not a shared one", () => {
  reset();
  api.tableState["consumable-table"].data = [ROW];
  api.tableState["consumable-table"].formatter = api.craftingFormatter;
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG" });
  api.addCraftListEntry({ tableId: "consumable-table", rowKey: "T5_BAG", itemId: "T5_BAG" });
  api.renderCraftListTable();
  const inner = (listBody.innerHTML.match(/<table class="data-table cl-inner" data-cl-group="/g) || []).length;
  assert.strictEqual(inner, 2, "one table per source group");
});

test("a group table carries its header in a thead and its rows in a tbody", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG" });
  api.renderCraftListTable();
  assert.match(listBody.innerHTML, /<thead><tr class="cl-colhead">/);
  assert.match(listBody.innerHTML, /<tbody><tr[^>]*data-row-key="T5_BAG\|Martlock"/);
});

test("the band and totals rows stay in the one-column shell", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG" });
  api.renderCraftListTable();
  // No colspan: the shell has a single column, and a stale colspan="24" would
  // have forced 24 columns onto it.
  assert.doesNotMatch(listBody.innerHTML, /class="cl-group"><td colspan/);
  assert.doesNotMatch(listBody.innerHTML, /class="cl-totals"><td colspan/);
  assert.match(listBody.innerHTML, /class="cl-group-row"><td class="cl-group-cell">/);
});

// ── missing rows ────────────────────────────────────────────────────────────

test("an entry with no scanned row renders a removable placeholder, not a blank", () => {
  reset();
  api.tableState["crafting-table"].data = [];
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: "T9_GHOST|Martlock", itemId: "T9_GHOST" });
  api.renderCraftListTable();
  assert.match(listBody.innerHTML, /cl-missing/);
  assert.match(listBody.innerHTML, /Not priced yet/);
  assert.match(listBody.innerHTML, /data-cl-remove="1"/);
  assert.match(listBody.innerHTML, /NAME:T9_GHOST/);
});

// Reported: "loading screen stopped but tables still shows empty for some time
// on start" — the panel is drawn last (js/render-schedule.js), so for the
// seconds before its turn every row said "scan Crafting Planner to fill this
// row" about numbers the app was already computing.
const workingCases = [
  ["boot is still filling the tables", (a) => a.setBootFilling(true)],
  ["a re-render pass is running", (a) => a.setRerenderBusy(true)],
];

workingCases.forEach(([label, arm]) => {
  test(`an unresolved row spins, and does not say "scan", while ${label}`, () => {
    reset();
    arm(api);
    api.tableState["crafting-table"].data = [];
    api.addCraftListEntry({ tableId: "crafting-table", rowKey: "T9_GHOST|Martlock", itemId: "T9_GHOST" });
    api.renderCraftListTable();
    // The ring, not a sentence: a row the app is already computing asks the
    // user for nothing, so it says nothing (js/table-loading-mark.js is where
    // the same mark comes from for a whole table).
    assert.match(listBody.innerHTML, /row-computing/);
    assert.doesNotMatch(listBody.innerHTML, /Not priced yet/);
    assert.match(listBody.innerHTML, /cl-pending/);
    assert.doesNotMatch(listBody.innerHTML, /cl-missing/);
    // Still a row the user owns: it can be removed and re-quantified while it
    // fills, exactly like the settled placeholder.
    assert.match(listBody.innerHTML, /data-cl-remove="1"/);
    assert.match(listBody.innerHTML, /data-cl-qty="1"/);
    assert.match(listBody.innerHTML, /NAME:T9_GHOST/);
  });
});

test("nothing is printed beside the ring", () => {
  reset();
  api.setBootFilling(true);
  api.tableState["crafting-table"].data = [];
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: "T9_GHOST|Martlock", itemId: "T9_GHOST" });
  api.renderCraftListTable();
  assert.match(listBody.innerHTML, /<span class="row-fluid row-computing"[^>]*><\/span>/);
});

test("a screen reader is still told, and told which table", () => {
  reset();
  api.setBootFilling(true);
  api.tableState["crafting-table"].data = [];
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: "T9_GHOST|Martlock", itemId: "T9_GHOST" });
  api.renderCraftListTable();
  assert.match(listBody.innerHTML, /role="status"/);
  assert.match(listBody.innerHTML, /aria-label="Computing…[^"]*fills when crafting-table is done/);
});

test("once boot is done the scan hint comes back", () => {
  reset();
  api.setBootFilling(true);
  api.tableState["crafting-table"].data = [];
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: "T9_GHOST|Martlock", itemId: "T9_GHOST" });
  api.renderCraftListTable();
  assert.match(listBody.innerHTML, /row-computing/);
  // Nothing was found, and nothing is coming: the user really does have to
  // scan, and THAT is worth a sentence because it asks for something.
  api.setBootFilling(false);
  api.renderCraftListTable();
  assert.match(listBody.innerHTML, /Not priced yet/);
  assert.doesNotMatch(listBody.innerHTML, /row-computing/);
});

test("a row that RESOLVES is never a placeholder, boot or not", () => {
  reset();
  api.setBootFilling(true);
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG" });
  api.renderCraftListTable();
  assert.doesNotMatch(listBody.innerHTML, /row-computing/);
  assert.doesNotMatch(listBody.innerHTML, /cl-pending/);
  assert.match(listBody.innerHTML, /Bag \[T5\]/);
});

test("a row key whose city moved still finds its row via the item id", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: "T5_BAG|Thetford", itemId: "T5_BAG" });
  api.renderCraftListTable();
  assert.doesNotMatch(listBody.innerHTML, /cl-missing/);
  assert.match(listBody.innerHTML, /Bag \[T5\]/);
});

test("a moved city is matched by identity even with NO item id stored", () => {
  reset();
  // The identity pass strips the city segment, so the entry resolves without
  // leaning on the item-id fallback (which some tables cannot supply).
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: "T5_BAG|Thetford", itemId: "" });
  api.renderCraftListTable();
  assert.doesNotMatch(listBody.innerHTML, /cl-missing/);
  assert.match(listBody.innerHTML, /Bag \[T5\]/);
});

test("an unpriced key (no city at all) matches the priced row", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: "T5_BAG|", itemId: "" });
  api.renderCraftListTable();
  assert.doesNotMatch(listBody.innerHTML, /cl-missing/);
});

test("identity never matches a DIFFERENT item", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: "T9_GHOST|Thetford", itemId: "" });
  api.renderCraftListTable();
  assert.match(listBody.innerHTML, /cl-missing/);
});

test("findCraftListRow returns the row index the formatter needs", () => {
  const state = { data: [{ item: { id: "X" } }, ROW] };
  const found = api.findCraftListRow(state, { tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG" });
  assert.strictEqual(found.idx, 1);
  assert.strictEqual(found.row, ROW);
});

// ── totals + materials ──────────────────────────────────────────────────────

test("the totals row sums cost, revenue and profit across the quantity", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 10 });
  api.renderCraftListTable();
  const totals = listBody.innerHTML.slice(listBody.innerHTML.indexOf('class="cl-totals"'));
  assert.match(totals, />8000</, "cost 800 × 10");
  assert.match(totals, />50000</, "revenue 5000 × 10");
  assert.match(totals, />4000</, "profit 400 × 10");
  assert.match(totals, /1,?200 \/ 10,000/, "focus 120 × 10, well inside the budget");
});

// Focus is finite: the footer is a BUDGET, not a yardstick. A basket that needs
// more than a day's bar cannot run every craft focused, and the part it cannot
// fund has to be said out loud rather than folded into the profit.
test("the focus footer is an editable budget with what it spent", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 10 });
  api.renderCraftListTable();
  const totals = listBody.innerHTML.slice(listBody.innerHTML.indexOf('class="cl-totals"'));
  assert.match(totals, /data-cl-focus-budget="1"/, "the budget is editable");
  assert.match(totals, /value="10000"/, "and defaults to a day's regen");
  assert.doesNotMatch(totals, /unfocused/, "nothing is short at 1,200 of 10,000");
});

// 10,000 focus buys 83 whole crafts (9,960) and the 40 left over funds a third
// of the 84th, so the whole bar is used and 200×120 − 10,000 = 14,000 focus
// goes unfunded.
test("a basket bigger than the budget reports what it could not focus", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 200 });
  api.renderCraftListTable();
  const totals = listBody.innerHTML.slice(listBody.innerHTML.indexOf('class="cl-totals"'));
  assert.match(totals, /10,?000 \/ 10,000/, "the whole bar is spent");
  assert.match(totals, /14,?000 unfocused/);
});

// A list with nothing focusable on it should not carry a focus budget control:
// a setting with nothing to set is noise.
test("a basket that needs no focus shows no budget box", () => {
  reset();
  api.tableState["crafting-table"].data = [{ ...ROW, focusCost: 0 }];
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 4 });
  api.renderCraftListTable();
  const totals = listBody.innerHTML.slice(listBody.innerHTML.indexOf('class="cl-totals"'));
  assert.doesNotMatch(totals, /data-cl-focus-budget/);
  api.tableState["crafting-table"].data = [ROW];
});

// ── a parked row (quantity 0) ───────────────────────────────────────────────

test("a parked row is dimmed, reads —, and counts for nothing", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 0 });
  api.renderCraftListTable();
  const html = listBody.innerHTML;
  assert.match(html, /cl-qty-zero/, "the row carries the parked class");
  assert.match(html, /class="silver-val cl-row-total ">—</, "its total is a dash, not a 0");
  const totals = html.slice(html.indexOf('class="cl-totals"'));
  assert.match(totals, />0</, "profit contributes nothing");
  assert.doesNotMatch(totals, /data-cl-focus-budget/, "and it needs no focus");
});

test("a parked row keeps an editable quantity box that accepts 0", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 0 });
  api.renderCraftListTable();
  assert.match(listBody.innerHTML, /class="cl-qty"[^>]*value="0"/);
});

// A TEXT field, not a number one: the box takes arithmetic (`96+96`), and a
// number input hands the page back an empty string for anything with a `+`.
test("the quantity box is a text field, so a sum survives being typed", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 3 });
  api.renderCraftListTable();
  const html = listBody.innerHTML;
  assert.match(html, /<input type="text" class="cl-qty"/);
  assert.doesNotMatch(html, /type="number"[^>]*class="cl-qty"/);
  assert.doesNotMatch(html, /class="cl-qty"[^>]*step=/);
});

test("a parked row buys nothing on the materials board", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 0 });
  api.renderCraftListTable();
  assert.match(matsBody.innerHTML, /No purchasable materials/);
});

test("no laborer play on the list means no second profit figure", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 10 });
  api.renderCraftListTable();
  const totals = listBody.innerHTML.slice(listBody.innerHTML.indexOf('class="cl-totals"'));
  assert.doesNotMatch(totals, /with laborers/);
});

test("a row with a laborer journal adds the second profit figure", () => {
  reset();
  api.tableState["crafting-table"].data = [{ ...ROW, profitWithLaborer: 650 }];
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 10 });
  api.renderCraftListTable();
  const totals = listBody.innerHTML.slice(listBody.innerHTML.indexOf('class="cl-totals"'));
  assert.match(totals, /with laborers/);
  assert.match(totals, />6500</, "laborer profit 650 × 10");
  assert.match(totals, />4000</, "the sell-the-journal profit is still there");
});

// A laborer journal the stub row can win: 200 fame/craft into a 500-fame
// journal = 2.5 crafts per journal, the screenshot's Tinker T5 rate.
const LABORER_ROW = {
  ...ROW,
  profitWithLaborer: 650,
  laborerJournal: { slug: "TOOLMAKER", famePerCraft: 200, bestJournal: { tier: 5, maxfame: 500 } },
};

function totalsCell() {
  return listBody.innerHTML.slice(listBody.innerHTML.indexOf('class="cl-totals"'));
}

test("the laborer headcount box counts the journals the list fills", () => {
  reset();
  api.tableState["crafting-table"].data = [LABORER_ROW];
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 233 });
  api.renderCraftListTable();
  assert.match(totalsCell(), /data-cl-laborers="1" value="93"/, "233 / 2.5 = 93");
  assert.match(totalsCell(), /laborers/);
});

test("a basket that fills no whole journal shows no box", () => {
  reset();
  api.tableState["crafting-table"].data = [LABORER_ROW];
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 2 });
  api.renderCraftListTable();
  assert.doesNotMatch(totalsCell(), /data-cl-laborers/);
  assert.match(totalsCell(), /with laborers/, "the profit play is still quoted");
});

test("a row with no laborer journal shows no box", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 233 });
  api.renderCraftListTable();
  assert.doesNotMatch(totalsCell(), /data-cl-laborers/);
});

test("back-solving from a headcount rewrites the quantity", () => {
  reset();
  api.tableState["crafting-table"].data = [LABORER_ROW];
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 233 });
  api.renderCraftListTable();

  // What the change handler does, minus the DOM event the harness cannot fire.
  api.scaleCraftListToLaborers(api._clSolverEntries(), 10)
    .forEach((c) => api.setCraftListQty(c.tableId, c.rowKey, c.qty));
  api.renderCraftListTable();

  assert.strictEqual(api.getCraftList()[0].qty, 25, "10 journals × 2.5 crafts");
  assert.match(totalsCell(), /data-cl-laborers="1" value="10"/);
});

test("the materials board multiplies each material by the row quantity", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG", qty: 10 });
  api.renderCraftListTable();
  assert.match(matsBody.innerHTML, /NAME:T5_CLOTH/);
  assert.match(matsBody.innerHTML, />80</, "8 cloth × 10 crafts");
  assert.match(matsBody.innerHTML, /Martlock/);
  // Editable AND showing the current price — see the graft test above.
  assert.match(matsBody.innerHTML, /price-editable[^>]*data-item-id="T5_CLOTH"[^>]*>@ 100</, "material prices stay click-to-edit");
  assert.match(matsBody.innerHTML, /Total to buy[\s\S]*8000/);
});

test("removing the entry empties the panel again", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG" });
  api.renderCraftListTable();
  api.removeCraftListEntry("crafting-table", ROW_KEY);
  api.renderCraftListTable();
  assert.match(listBody.innerHTML, /Nothing on the list yet/);
});

test("changing the quantity changes the totals on the next repaint", () => {
  reset();
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG" });
  api.setCraftListQty("crafting-table", ROW_KEY, 5);
  api.renderCraftListTable();
  const totals = listBody.innerHTML.slice(listBody.innerHTML.indexOf('class="cl-totals"'));
  assert.match(totals, />2000</, "profit 400 × 5");
});

test("a table with no <thead> in the DOM still renders its rows", () => {
  reset();
  delete api._store.heads["crafting-table"];
  api.addCraftListEntry({ tableId: "crafting-table", rowKey: ROW_KEY, itemId: "T5_BAG" });
  api.renderCraftListTable();
  assert.match(listBody.innerHTML, /Bag \[T5\]/);
  api._store.heads["crafting-table"] = ["", "Item:name", "Best Sell Price"];
});

test("the group label falls back to the table id when the heading isn't in the DOM", () => {
  assert.strictEqual(api.craftListTableLabel("crafting-table"), "crafting-table");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
