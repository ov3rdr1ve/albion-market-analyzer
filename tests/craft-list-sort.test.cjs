/**
 * My Crafting List sorting (js/craft-list-sort.js).
 *
 * The list groups its rows by source table and each group sorts on its own —
 * so the unit under test is per-tableId sort state plus one comparator over
 * resolved list items ({ entry, row, extracted }).
 *
 * Black box: the module is loaded with `compareRows` / `getSortValue` stubbed
 * to the same contract js/sorting.js provides, so these assertions describe the
 * delegation, not sorting.js's internals.
 *
 * Run: node tests/craft-list-sort.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const loadFile = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/if \(typeof module[\s\S]*$/, "");

// ── the sorting.js contract, stubbed ────────────────────────────────────────
const sandbox = `
function getSortValue(row, col) {
  const v = row ? row[col] : undefined;
  return v === undefined ? 0 : v;
}
function compareRows(a, b, state, tableId) {
  let va = getSortValue(a, state.sortCol, tableId);
  let vb = getSortValue(b, state.sortCol, tableId);
  let cmp = (typeof va === "string" && typeof vb === "string")
    ? va.localeCompare(vb)
    : va - vb;
  if (state.sortDir === "desc") cmp = -cmp;
  return cmp;
}
`;

// The per-10k cell's own arithmetic (js/craft-list-per10k.js): the list sorts
// that column on exactly the number the cell prints.
const src = sandbox
  + loadFile("js/craft-list-per10k.js")
  + loadFile("js/craft-list-sort.js")
  + `
module.exports = {
  CRAFT_LIST_SORT_KEY, setCraftListSortStorage, loadCraftListSorts,
  craftListSortFor, setCraftListSort, sortCraftListRows,
};`;

const m = new Module("craft-list-sort-test");
m._compile(src, path.join(ROOT, "js", "craft-list-sort-test.js"));
const api = m.exports;

// ── harness ─────────────────────────────────────────────────────────────────

function makeStorage(backing) {
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); },
    removeItem: (k) => { delete backing[k]; },
  };
}
let backing = {};
function resetStorage(seed) {
  backing = seed ? { ...seed } : {};
  api.setCraftListSortStorage(makeStorage(backing));
}

/**
 * One resolved list item: the stored entry, its source row, its extraction.
 *
 * `p10k` is the source row's own Profit / 10k Focus. `profit` / `cost` are the
 * row's figures under the focus-budget split, when the renderer attached them
 * (js/render-craft-list.js) — omitted, the list falls back to unit × qty.
 */
function item(name, {
  qty = 1, unitProfit = 0, inputCost = 0, margin = 0, missing = false,
  p10k, profit, cost,
} = {}) {
  const it = {
    entry: { tableId: "crafting-table", rowKey: name, qty },
    row: missing ? null : { name, margin, profitPer10kFocus: p10k },
    extracted: missing ? null : { itemId: name, unitProfit, inputCost },
  };
  if (profit !== undefined) it.profit = profit;
  if (cost !== undefined) it.cost = cost;
  return it;
}
const names = (items) => items.map((i) => i.entry.rowKey);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// ── sort state ──────────────────────────────────────────────────────────────

test("an untouched table sorts on nothing — the list's insertion order", () => {
  resetStorage();
  const s = api.craftListSortFor("crafting-table");
  assert.strictEqual(s.sortCol, null);
  assert.strictEqual(s.sortDir, "desc");
});

// Same toggle semantics as the app-wide header binder (js/app.js): a fresh
// column opens on desc (biggest first), re-clicking flips.
[
  { clicks: ["margin"], col: "margin", dir: "desc" },
  { clicks: ["margin", "margin"], col: "margin", dir: "asc" },
  { clicks: ["margin", "margin", "margin"], col: "margin", dir: "desc" },
  { clicks: ["margin", "qty"], col: "qty", dir: "desc" },
  { clicks: ["margin", "margin", "qty"], col: "qty", dir: "desc" },
].forEach(({ clicks, col, dir }) => {
  test(`clicking ${clicks.join(" → ")} leaves ${col}/${dir}`, () => {
    resetStorage();
    clicks.forEach((c) => api.setCraftListSort("crafting-table", c));
    const s = api.craftListSortFor("crafting-table");
    assert.strictEqual(s.sortCol, col);
    assert.strictEqual(s.sortDir, dir);
  });
});

test("each group keeps its OWN sort — one table's click never moves another's", () => {
  resetStorage();
  api.setCraftListSort("crafting-table", "margin");
  api.setCraftListSort("consumable-table", "qty");
  api.setCraftListSort("consumable-table", "qty");
  assert.deepStrictEqual(api.craftListSortFor("crafting-table"), { sortCol: "margin", sortDir: "desc" });
  assert.deepStrictEqual(api.craftListSortFor("consumable-table"), { sortCol: "qty", sortDir: "asc" });
});

test("the sort survives a reload", () => {
  resetStorage();
  api.setCraftListSort("crafting-table", "clTotal");
  const saved = { ...backing };
  resetStorage(saved);
  assert.deepStrictEqual(api.craftListSortFor("crafting-table"), { sortCol: "clTotal", sortDir: "desc" });
});

test("the sort is stored apart from the source tables' sort state", () => {
  resetStorage();
  api.setCraftListSort("crafting-table", "margin");
  assert.ok(backing[api.CRAFT_LIST_SORT_KEY], "written under the list's own key");
  assert.strictEqual(backing.albionMarketSortState, undefined);
});

[
  ["corrupt JSON", "{not json"],
  ["a non-object blob", "[1,2,3]"],
  ["a garbage entry", '{"crafting-table":42}'],
].forEach(([label, raw]) => {
  test(`${label} in storage falls back to insertion order`, () => {
    resetStorage({ [api.CRAFT_LIST_SORT_KEY]: raw });
    assert.deepStrictEqual(api.craftListSortFor("crafting-table"), { sortCol: null, sortDir: "desc" });
  });
});

test("no storage at all still sorts (memory only)", () => {
  api.setCraftListSortStorage(null);
  api.setCraftListSort("crafting-table", "qty");
  assert.strictEqual(api.craftListSortFor("crafting-table").sortCol, "qty");
});

// ── the comparator ──────────────────────────────────────────────────────────

test("no sort column leaves the rows exactly as the list stored them", () => {
  const items = [item("c", { qty: 1 }), item("a", { qty: 9 }), item("b", { qty: 5 })];
  const out = api.sortCraftListRows(items, "crafting-table", { sortCol: null, sortDir: "desc" });
  assert.deepStrictEqual(names(out), ["c", "a", "b"]);
  assert.notStrictEqual(out, items, "returns a new array — the store is never re-ordered");
  assert.deepStrictEqual(names(items), ["c", "a", "b"]);
});

const QTY_ROWS = () => [item("c", { qty: 1 }), item("a", { qty: 9 }), item("b", { qty: 5 })];
const TOTAL_ROWS = () => [
  item("c", { qty: 2, unitProfit: 100 }),   // 200
  item("a", { qty: 1, unitProfit: 900 }),   // 900
  item("b", { qty: 10, unitProfit: 50 }),   // 500
];
const COST_ROWS = () => [
  item("c", { qty: 2, inputCost: 100 }),    // 200
  item("a", { qty: 1, inputCost: 900 }),    // 900
  item("b", { qty: 10, inputCost: 50 }),    // 500
];
const MARGIN_ROWS = () => [
  item("c", { margin: 12 }), item("a", { margin: 55 }), item("b", { margin: 33 }),
];

[
  ["qty", "desc", QTY_ROWS, ["a", "b", "c"]],
  ["qty", "asc", QTY_ROWS, ["c", "b", "a"]],
  ["clTotal", "desc", TOTAL_ROWS, ["a", "b", "c"]],
  ["clTotal", "asc", TOTAL_ROWS, ["c", "b", "a"]],
  ["clCost", "desc", COST_ROWS, ["a", "b", "c"]],
  ["clCost", "asc", COST_ROWS, ["c", "b", "a"]],
  ["margin", "desc", MARGIN_ROWS, ["a", "b", "c"]],
  ["margin", "asc", MARGIN_ROWS, ["c", "b", "a"]],
].forEach(([col, dir, rows, want]) => {
  test(`${col} ${dir} orders ${want.join(",")}`, () => {
    const out = api.sortCraftListRows(rows(), "crafting-table", { sortCol: col, sortDir: dir });
    assert.deepStrictEqual(names(out), want);
  });
});

test("Total Profit is unit profit × quantity, not unit profit", () => {
  const out = api.sortCraftListRows(
    [item("small-unit-big-qty", { qty: 100, unitProfit: 10 }), item("big-unit", { qty: 1, unitProfit: 500 })],
    "crafting-table", { sortCol: "clTotal", sortDir: "desc" },
  );
  assert.deepStrictEqual(names(out), ["small-unit-big-qty", "big-unit"]);
});

test("Total Buy Cost is input cost × quantity, not input cost", () => {
  const out = api.sortCraftListRows(
    [item("cheap-unit-big-qty", { qty: 100, inputCost: 10 }), item("dear-unit", { qty: 1, inputCost: 500 })],
    "crafting-table", { sortCol: "clCost", sortDir: "desc" },
  );
  assert.deepStrictEqual(names(out), ["cheap-unit-big-qty", "dear-unit"]);
});

test("a row the list could not price counts as zero profit, not as missing", () => {
  const rows = [item("priced", { qty: 1, unitProfit: -5 }), { ...item("noprofit", { qty: 1 }), extracted: null }];
  // extracted:null but row present — a real row whose economics are unreadable.
  rows[1].row = { name: "noprofit" };
  const out = api.sortCraftListRows(rows, "crafting-table", { sortCol: "clTotal", sortDir: "desc" });
  assert.deepStrictEqual(names(out), ["noprofit", "priced"]);
});

// ── Profit / 10k Focus: sorted on the number the list PRINTS ────────────────
//
// The list re-bases that cell on the planned quantity (js/craft-list-per10k.js):
// it prints the source row's per-10k figure PLUS the row's Total Profit, and the
// bare figure on a parked row. Sorting on the source row's bare figure (what
// compareRows reads) ordered the rows against the numbers on screen — the
// reported bug.

// Bare per-10k order would be big-bar, mid, small-bar. The printed order is not.
const P10K_ROWS = () => [
  item("big-bar-small-plan", { p10k: 5000, qty: 1, unitProfit: 100 }),    // 5,100
  item("small-bar-big-plan", { p10k: 1000, qty: 10, unitProfit: 900 }),   // 10,000
  item("mid", { p10k: 3000, qty: 2, unitProfit: 1500 }),                  // 6,000
];
const P10K_PARKED = () => [
  item("running", { p10k: 1000, qty: 5, unitProfit: 1000 }),              // 6,000
  item("parked", { p10k: 7000, qty: 0, unitProfit: 999999 }),             // 7,000 (bar only)
];
// The focus budget ran out part-way through "funded-short": its split profit is
// 2,000, not 10 × 1,000. The cell prints 1,000 + 2,000.
const P10K_SPLIT = () => [
  item("funded-short", { p10k: 1000, qty: 10, unitProfit: 1000, profit: 2000 }), // 3,000
  item("other", { p10k: 1000, qty: 1, unitProfit: 2500 }),                        // 3,500
];
const P10K_SIGNS = () => [
  item("loss", { p10k: 1000, qty: 1, unitProfit: -4000 }),                 // -3,000
  item("zero-bar", { p10k: 0, qty: 1, unitProfit: 0 }),                    // 0
];

[
  ["the printed sum, desc", P10K_ROWS, "desc", ["small-bar-big-plan", "mid", "big-bar-small-plan"]],
  ["the printed sum, asc", P10K_ROWS, "asc", ["big-bar-small-plan", "mid", "small-bar-big-plan"]],
  ["a parked row counts its bar only, desc", P10K_PARKED, "desc", ["parked", "running"]],
  ["a parked row counts its bar only, asc", P10K_PARKED, "asc", ["running", "parked"]],
  ["the focus-budget split profit, not unit × qty", P10K_SPLIT, "desc", ["other", "funded-short"]],
  ["a loss sorts below a zero bar", P10K_SIGNS, "desc", ["zero-bar", "loss"]],
].forEach(([label, rows, dir, want]) => {
  test(`Profit / 10k Focus sorts on ${label}`, () => {
    const out = api.sortCraftListRows(rows(), "crafting-table", { sortCol: "profitPer10kFocus", sortDir: dir });
    assert.deepStrictEqual(names(out), want);
  });
});

// A row whose table prints "—" in this column (not focus-craftable) has no
// number at all. Reading it as -Infinity would float it to the TOP on asc.
[["desc", ["b", "a", "no-focus"]], ["asc", ["a", "b", "no-focus"]]].forEach(([dir, want]) => {
  test(`a row with no per-10k number sinks to the bottom on ${dir}`, () => {
    const rows = [
      item("no-focus", { p10k: null, qty: 5, unitProfit: 100000 }),
      item("a", { p10k: 10, qty: 1, unitProfit: 1 }),
      item("b", { p10k: 20, qty: 1, unitProfit: 1 }),
    ];
    const out = api.sortCraftListRows(rows, "crafting-table", { sortCol: "profitPer10kFocus", sortDir: dir });
    assert.deepStrictEqual(names(out), want);
  });
});

test("an unpriced placeholder still sinks below a per-10k row with no number", () => {
  const rows = [
    item("ghost", { missing: true }),
    item("no-focus", { p10k: null, qty: 1, unitProfit: 5 }),
    item("a", { p10k: 10, qty: 1, unitProfit: 1 }),
  ];
  const out = api.sortCraftListRows(rows, "crafting-table", { sortCol: "profitPer10kFocus", sortDir: "desc" });
  assert.deepStrictEqual(names(out), ["a", "no-focus", "ghost"]);
});

// Total Profit / Total Buy Cost print the split figures too (_clRowProfit /
// _clRowCost), so they sort on them when the renderer attached them.
[
  ["clTotal", [
    item("funded-short", { qty: 10, unitProfit: 1000, profit: 2000 }),
    item("other", { qty: 1, unitProfit: 2500 }),
  ], ["other", "funded-short"]],
  ["clCost", [
    item("cheap-split", { qty: 10, inputCost: 1000, cost: 2000 }),
    item("other", { qty: 1, inputCost: 2500 }),
  ], ["other", "cheap-split"]],
].forEach(([col, rows, want]) => {
  test(`${col} sorts on the split figure the cell prints`, () => {
    const out = api.sortCraftListRows(rows, "crafting-table", { sortCol: col, sortDir: "desc" });
    assert.deepStrictEqual(names(out), want);
  });
});

// ── placeholders ────────────────────────────────────────────────────────────

// An unpriced entry has no source row to read a column off. It must not sort to
// the TOP just because its value reads as 0 — it belongs at the bottom in both
// directions, the way no-data rows do everywhere else in the app.
[["desc"], ["asc"]].forEach(([dir]) => {
  test(`unpriced rows sink to the bottom on ${dir}`, () => {
    const rows = [
      item("ghost", { missing: true }),
      item("a", { margin: 10 }),
      item("b", { margin: 90 }),
    ];
    const out = api.sortCraftListRows(rows, "crafting-table", { sortCol: "margin", sortDir: dir });
    assert.strictEqual(names(out)[2], "ghost");
  });
});

test("several unpriced rows keep the order they were added in", () => {
  const rows = [
    item("g1", { missing: true }),
    item("a", { margin: 10 }),
    item("g2", { missing: true }),
  ];
  const out = api.sortCraftListRows(rows, "crafting-table", { sortCol: "margin", sortDir: "desc" });
  assert.deepStrictEqual(names(out), ["a", "g1", "g2"]);
});

test("ties keep insertion order (a stable sort)", () => {
  const rows = [item("x", { qty: 3 }), item("y", { qty: 3 }), item("z", { qty: 3 })];
  const out = api.sortCraftListRows(rows, "crafting-table", { sortCol: "qty", sortDir: "desc" });
  assert.deepStrictEqual(names(out), ["x", "y", "z"]);
});

test("an empty group sorts to an empty group", () => {
  assert.deepStrictEqual(api.sortCraftListRows([], "crafting-table", { sortCol: "qty", sortDir: "desc" }), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
