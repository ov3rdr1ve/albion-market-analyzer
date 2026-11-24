/**
 * Test: a stored table row formatter keeps the specialization scope it was
 * built under, so a repaint prices its text the same way the first paint did.
 *
 * renderTableData (js/app.js) parks the row formatter on tableState and returns.
 * Every later repaint — sort, search, price override, collapsed-table expand —
 * replays that formatter OUTSIDE the withSpecScope() wrapper the renderer ran
 * in. Anything the row HTML recomputes then reads the DEFAULT levels (a mastery
 * 100, every specialization 0) instead of the table's own, which is how a
 * max-spec Moose printed "4x 500 focus/baby" in the Mats cell next to its own
 * 125-focus Silver/Focus figure.
 *
 * Black box over the shipped modules — no DOM, no market data, no live calls.
 *
 * Run: node tests/table-formatter-spec-scope.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
// Working tree mixes CRLF and LF (core.autocrlf); source regexes are LF.
const read = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf-8").split("\r\n").join("\n");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// The browser's shared script scope: the spec tables + runtime, the breeding
// data that prices a nurture, and the real renderTableData lifted out of
// js/app.js with the three globals it touches stubbed.
function loadSandbox(store = {}) {
  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };

  const appSrc = appSource();
  const start = appSrc.indexOf("function renderTableData");
  const end = appSrc.indexOf("function formatPriceAge");
  assert.ok(start !== -1 && end > start, "could not lift renderTableData out of js/app.js");
  const renderTableDataSrc = appSrc.slice(start, end);

  const mountsSrc = read("js/render-mounts.js");
  const mountsHelpers = mountsSrc.slice(0, mountsSrc.indexOf("function renderMountsTable"));

  return new Function(
    "localStorage",
    `${read("js/focus-spec-nodes.js")}
     ${read("js/focus-spec-items.js")}
     ${read("js/focus-spec.js")}
     ${read("js/data-mounts.js")}
     ${mountsHelpers}
     // The app seeds tableState with one entry per table (js/sorting.js); the
     // sandbox auto-vivifies instead so a test can name any table id.
     const tableState = new Proxy({}, {
       get(target, key) {
         if (typeof key === "string" && !(key in target)) target[key] = {};
         return target[key];
       },
     });
     const painted = {};
     let collapsed = false;
     function isTableCollapsed() { return collapsed; }
     function updateTableDisplay(id) {
       const state = tableState[id];
       painted[id] = (state.data || []).map((row, i) => state.formatter(row, i)).join("");
     }
     ${renderTableDataSrc}
     return { tableState, painted, renderTableData, bindSpecScope, withSpecScope,
              currentSpecScope, setSpecLevel, getNurtureFocusCost, getBreedingMeta,
              setCollapsed: (v) => { collapsed = v; },
              repaint: (id) => updateTableDisplay(id) };`
  )(localStorage);
}

const MOUNTS = "mounts-table";
const FARMING = "farming-table";
const MOOSE = "T6_FARM_GIANTSTAG_MOOSE_BABY"; // FARM_ANIMALS + FARM_ANIMALS_RARE

console.log("Table Formatter Spec Scope Tests\n");

// ── bindSpecScope: the scope travels with the callback ─────────────────────

[
  // [name, scopeAtBind, setup, expectedFocus]
  ["mounts scope with Rare Animals 100 survives the repaint", MOUNTS,
    (a) => a.setSpecLevel(MOUNTS, "FARM_ANIMALS_RARE", 100), 125],
  ["mounts scope with Rare Animals 64 survives the repaint", MOUNTS,
    (a) => a.setSpecLevel(MOUNTS, "FARM_ANIMALS_RARE", 64), 206],
  ["mounts levels never leak into the farming scope", FARMING,
    (a) => a.setSpecLevel(MOUNTS, "FARM_ANIMALS_RARE", 100), 500],
  ["no ambient scope binds the defaults, not whatever runs later", null,
    (a) => a.setSpecLevel(MOUNTS, "FARM_ANIMALS_RARE", 100), 500],
].forEach(([name, scope, setup, focus]) => {
  test(name, () => {
    const a = loadSandbox();
    setup(a);
    // Bind under `scope`, then call from bare scope the way a sort does.
    const priced = scope
      ? a.withSpecScope(scope, () => a.bindSpecScope(() => a.getNurtureFocusCost(MOOSE)))
      : a.bindSpecScope(() => a.getNurtureFocusCost(MOOSE));
    assert.strictEqual(a.currentSpecScope(), null, "the bind must not leave a scope behind");
    assert.strictEqual(priced(), focus);
  });
});

test("an unbound callback is what used to read the defaults", () => {
  const a = loadSandbox();
  a.setSpecLevel(MOUNTS, "FARM_ANIMALS_RARE", 100);
  const unbound = a.withSpecScope(MOUNTS, () => () => a.getNurtureFocusCost(MOOSE));
  assert.strictEqual(unbound(), 500, "the regression this fix removes");
});

test("bindSpecScope passes arguments and the return value through", () => {
  const a = loadSandbox();
  const bound = a.bindSpecScope((x, y) => [x, y]);
  assert.deepStrictEqual(bound("row", 7), ["row", 7]);
});

test("bindSpecScope leaves a non-function alone", () => {
  const a = loadSandbox();
  assert.strictEqual(a.bindSpecScope(undefined), undefined);
  assert.strictEqual(a.bindSpecScope(null), null);
});

// ── nesting: an outer scope is restored, on return and on throw ────────────

test("calling a bound formatter from inside another scope restores that scope", () => {
  const a = loadSandbox();
  a.setSpecLevel(MOUNTS, "FARM_ANIMALS_RARE", 100);
  const bound = a.withSpecScope(MOUNTS, () => a.bindSpecScope(() => a.currentSpecScope()));
  const seen = a.withSpecScope(FARMING, () => {
    const inner = bound();
    return [inner, a.currentSpecScope()];
  });
  assert.deepStrictEqual(seen, [MOUNTS, FARMING]);
  assert.strictEqual(a.currentSpecScope(), null);
});

test("a throwing bound formatter still restores the scope", () => {
  const a = loadSandbox();
  const bound = a.withSpecScope(MOUNTS, () => a.bindSpecScope(() => { throw new Error("boom"); }));
  a.withSpecScope(FARMING, () => {
    assert.throws(() => bound(), /boom/);
    assert.strictEqual(a.currentSpecScope(), FARMING);
  });
  assert.strictEqual(a.currentSpecScope(), null);
});

// ── renderTableData: the stored formatter is the bound one ─────────────────

test("renderTableData stores a formatter pinned to the render pass's scope", () => {
  const a = loadSandbox();
  a.setSpecLevel(MOUNTS, "FARM_ANIMALS_RARE", 100);
  a.withSpecScope(MOUNTS, () => {
    a.renderTableData(MOUNTS, [{ babyId: MOOSE }], (row) => `focus:${a.getNurtureFocusCost(row.babyId)}`);
  });
  assert.strictEqual(a.painted[MOUNTS], "focus:125", "first paint");
  // A sort / search / override replays the stored formatter from bare scope.
  a.repaint(MOUNTS);
  assert.strictEqual(a.painted[MOUNTS], "focus:125", "repaint must not fall back to 500");
  assert.strictEqual(a.tableState[MOUNTS].formatter.__specBoundScope, MOUNTS);
});

test("a collapsed table's cached formatter is bound too", () => {
  const a = loadSandbox();
  a.setSpecLevel(MOUNTS, "FARM_ANIMALS_RARE", 100);
  a.setCollapsed(true);
  a.withSpecScope(MOUNTS, () => {
    a.renderTableData(MOUNTS, [{ babyId: MOOSE }], (row) => `focus:${a.getNurtureFocusCost(row.babyId)}`);
  });
  assert.strictEqual(a.painted[MOUNTS], undefined, "collapsed tables are not painted");
  a.setCollapsed(false);
  a.repaint(MOUNTS); // the expand
  assert.strictEqual(a.painted[MOUNTS], "focus:125");
});

test("a scope-less table keeps reading the defaults after a repaint", () => {
  const a = loadSandbox();
  a.setSpecLevel(MOUNTS, "FARM_ANIMALS_RARE", 100);
  a.renderTableData("joined-focus-table", [{ babyId: MOOSE }],
    (row) => `focus:${a.getNurtureFocusCost(row.babyId)}`);
  a.withSpecScope(MOUNTS, () => a.repaint("joined-focus-table"));
  assert.strictEqual(a.painted["joined-focus-table"], "focus:500",
    "an unscoped table must not inherit whoever triggered the repaint");
});

// ── the reported row: the Mats cell text and the row's own figures agree ───

test("the breeding row carries the meta it was priced with", () => {
  const a = loadSandbox();
  a.setSpecLevel(MOUNTS, "FARM_ANIMALS_RARE", 100);
  const meta = a.withSpecScope(MOUNTS, () => a.getBreedingMeta({ babyId: MOOSE }));
  assert.strictEqual(meta.focusPerNurture, 125);
  assert.strictEqual(meta.focusPerNurture, meta.focusPerNurtureMaxSpec, "so the row may say (max spec)");
  assert.strictEqual(meta.totalNurtureFocus, meta.maxNurtures * 125);

  const rowSrc = read("js/render-mounts-breeding-row.js");
  assert.ok(/row\.meta \|\| getBreedingMeta\(row\.item\)/.test(rowSrc),
    "the row renderer must prefer the meta computed inside the table's spec scope");
  const mountsSrc = read("js/render-mounts.js");
  assert.ok(/isBreeding: true[\s\S]{0,400}?\n {6}meta,/.test(mountsSrc),
    "breedingRowFor must carry `meta` on the row it returns");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
