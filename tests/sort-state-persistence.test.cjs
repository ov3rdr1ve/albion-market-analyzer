/**
 * Black-box tests for the sort-state store in js/sorting.js.
 *
 * Two contracts, both regressions of real bugs:
 *
 *  1. loadSortState MERGES the saved blob onto the defaults. A blob written
 *     before a table existed carries no entry for it; substituting the blob for
 *     the defaults left that table with sortCol === undefined, which makes
 *     getSortValue return 0 for every row — the table renders in build order and
 *     its default sort looks broken until a header is clicked.
 *
 *  2. saveCurrentSortState persists EVERY table in tableState, not a
 *     hand-written subset. The subset had drifted and omitted the Crafting
 *     Planner and the Laborers table, so a sort chosen there was forgotten on
 *     the next launch.
 *
 * Parameterized over the table ids, so a table added later is covered by the
 * same assertions without editing them.
 *
 * Run: node tests/sort-state-persistence.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL: ${name} — ${e.message}`);
  }
}

// sorting.js is a plain browser script: its top-level `const`s stay in the
// script's own lexical scope, so hand the two entry points we exercise back out
// through the sandbox global rather than reaching for them afterwards.
const SOURCE =
  fs.readFileSync(path.join(__dirname, "..", "js", "sorting.js"), "utf8") +
  "\n;globalThis.__api = { tableState, saveCurrentSortState };";
const STORAGE_KEY = "albionMarketSortState";

/** Load sorting.js against a fake localStorage seeded with `saved`. */
function loadModule(saved) {
  const store = new Map();
  if (saved !== undefined) store.set(STORAGE_KEY, JSON.stringify(saved));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const sandbox = { localStorage, console: { warn() {}, error() {} } };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return {
    sandbox,
    written: () => JSON.parse(store.get(STORAGE_KEY)),
  };
}

const SORT_FIELDS = ["sortCol", "sortDir", "secondarySortCol", "secondarySortDir"];

// The ids the app ships with, read off the module itself so this list can never
// drift from the source of truth.
const ALL_TABLES = Object.keys(loadModule().sandbox.__api.tableState);

console.log("Sort State Persistence Tests\n");

// ── 1. defaults ─────────────────────────────────────────────────────────────

test("every table in tableState starts with a sort column and direction", () => {
  const { sandbox } = loadModule();
  ALL_TABLES.forEach((tableId) => {
    const state = sandbox.__api.tableState[tableId];
    assert.ok(state.sortCol, `${tableId} has no sortCol`);
    assert.ok(
      state.sortDir === "asc" || state.sortDir === "desc",
      `${tableId} has sortDir ${state.sortDir}`,
    );
  });
});

test("a corrupt saved blob falls back to the defaults", () => {
  const store = new Map([[STORAGE_KEY, "{not json"]]);
  const sandbox = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    console: { warn() {}, error() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  ALL_TABLES.forEach((tableId) => {
    assert.ok(sandbox.__api.tableState[tableId].sortCol, `${tableId} lost its default`);
  });
});

// ── 2. merge, not substitute ────────────────────────────────────────────────

ALL_TABLES.forEach((missing) => {
  test(`an old blob missing "${missing}" still gives it its default sort`, () => {
    const fresh = loadModule().sandbox;
    const expected = fresh.__api.tableState[missing].sortCol;
    // Read the default DIRECTION too rather than assuming "desc": the Building
    // Costs table is a cost board and defaults to cheapest-first ascending.
    const expectedDir = fresh.__api.tableState[missing].sortDir;

    // Blob written by a build that predates `missing`: every OTHER table only.
    const old = {};
    ALL_TABLES.filter((id) => id !== missing).forEach((id) => {
      old[id] = { sortCol: "name", sortDir: "asc", secondarySortCol: null, secondarySortDir: "asc" };
    });

    const { sandbox } = loadModule(old);
    assert.strictEqual(sandbox.__api.tableState[missing].sortCol, expected);
    assert.strictEqual(sandbox.__api.tableState[missing].sortDir, expectedDir);
  });
});

test("a saved pick wins over the default for the tables it does cover", () => {
  const old = { "crafting-table": { sortCol: "cost", sortDir: "asc", secondarySortCol: null, secondarySortDir: "asc" } };
  const { sandbox } = loadModule(old);
  assert.strictEqual(sandbox.__api.tableState["crafting-table"].sortCol, "cost");
  assert.strictEqual(sandbox.__api.tableState["crafting-table"].sortDir, "asc");
  // …and leaves every other table on its default.
  assert.strictEqual(sandbox.__api.tableState["flipping-table"].sortCol, "margin");
});

test("a non-object entry in the blob is ignored, not spread over the default", () => {
  const { sandbox } = loadModule({ "mounts-table": null, "farming-table": "margin" });
  assert.strictEqual(sandbox.__api.tableState["mounts-table"].sortCol, "margin");
  assert.strictEqual(sandbox.__api.tableState["farming-table"].sortCol, "profitPerDay");
});

// ── 3. save covers every table ──────────────────────────────────────────────

test("saveCurrentSortState writes an entry for every table in tableState", () => {
  const { sandbox, written } = loadModule();
  sandbox.__api.saveCurrentSortState();
  const blob = written();
  ALL_TABLES.forEach((tableId) => {
    assert.ok(blob[tableId], `${tableId} was not persisted`);
    SORT_FIELDS.forEach((f) => {
      assert.ok(f in blob[tableId], `${tableId} lost ${f}`);
    });
  });
});

ALL_TABLES.forEach((tableId) => {
  test(`a sort chosen on "${tableId}" survives a reload`, () => {
    const first = loadModule();
    const state = first.sandbox.__api.tableState[tableId];
    state.sortCol = "route";
    state.sortDir = "asc";
    state.secondarySortCol = "name";
    state.secondarySortDir = "desc";
    first.sandbox.__api.saveCurrentSortState();

    const second = loadModule(first.written());
    const restored = second.sandbox.__api.tableState[tableId];
    assert.strictEqual(restored.sortCol, "route");
    assert.strictEqual(restored.sortDir, "asc");
    assert.strictEqual(restored.secondarySortCol, "name");
    assert.strictEqual(restored.secondarySortDir, "desc");
  });
});

test("the persisted blob carries no row data or formatters", () => {
  const { sandbox, written } = loadModule();
  sandbox.__api.tableState["crafting-table"].data = [{ big: "row" }];
  sandbox.__api.tableState["crafting-table"].formatter = () => "<tr></tr>";
  sandbox.__api.tableState["crafting-table"]._sortedKeys = ["a", "b"];
  sandbox.__api.saveCurrentSortState();
  const entry = written()["crafting-table"];
  assert.deepStrictEqual(Object.keys(entry).sort(), [...SORT_FIELDS].sort());
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
