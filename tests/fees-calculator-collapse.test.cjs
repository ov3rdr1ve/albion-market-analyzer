/**
 * Regression test: Saved Trades survive the collapsible-section cycle.
 *
 * Bug: the saved trades vanished from the table when the app was restarted
 *      (or the "Fees Calculator" section was collapsed then re-expanded) and
 *      only came back after the user added/edited a row.
 *
 * Root cause: index.html places an <h2>Fees Calculator</h2> directly before
 *      the #fees-calculator div, so app.js's setupCollapsibleTables() treats
 *      the whole tool as a collapsible block keyed on the inner #fc-saved-table.
 *      That handler WIPES the table's <tbody> on collapse and, on expand, only
 *      restores tables that either live in `tableState` or expose a
 *      `_staticRenderer`. #fc-saved-table has neither path wired by default, so
 *      once collapsed its rows were gone until renderSaved() ran again (Save /
 *      Edit / Delete). The other self-managed tables (brecilien-fees,
 *      city-bonuses) already register a _staticRenderer for exactly this reason.
 *
 * Fix: render-fees-calculator.js registers renderSaved as
 *      #fc-saved-table._staticRenderer inside attach().
 *
 * Black-box approach: we drive the REAL js/render-fees-calculator.js through a
 * minimal fake-DOM registry (so attach() runs and registers its renderer), then
 * mirror app.js's setCollapsed() collapse/expand branch to prove the round-trip
 * rebuilds the rows. localStorage is the only persistence — never a live store.
 *
 * Run: node tests/fees-calculator-collapse.test.cjs
 */

const assert = require("assert");

const LS_SAVED_KEY = "feesCalculatorSavedRows"; // observable storage contract

// ── localStorage stub ────────────────────────────────────────────────────────
let _ls = {};
global.localStorage = {
  getItem(k) { return k in _ls ? _ls[k] : null; },
  setItem(k, v) { _ls[k] = String(v); },
  removeItem(k) { delete _ls[k]; },
};

// ── minimal fake DOM: one auto-creating element registry keyed by id ─────────
// root.querySelector('#id') and document.getElementById('id') both resolve to
// the SAME element object, so whatever attach() reads/writes is what we assert.
const elements = {};
function el(id) {
  if (!elements[id]) {
    elements[id] = {
      id,
      value: "",
      checked: false,
      hidden: false,
      textContent: "",
      className: "",
      innerHTML: "",
      _staticRenderer: undefined,
      classList: { add() {}, remove() {}, contains() { return false; } },
      addEventListener() {},
      removeEventListener() {},
      focus() {},
      contains() { return false; },
      scrollIntoView() {},
      querySelector(sel) {
        const m = /^#(.+)$/.exec(String(sel));
        return m ? el(m[1]) : null;
      },
    };
  }
  return elements[id];
}

global.document = {
  readyState: "complete", // so the module's bootstrap calls attach() immediately
  getElementById(id) { return el(id); },
  querySelector(sel) {
    const m = /^#(.+)$/.exec(String(sel));
    return m ? el(m[1]) : null;
  },
  addEventListener() {},
};

// Requiring the module runs its IIFE → attach() (readyState !== "loading").
// buildSavedRow is reused to fabricate realistic saved rows for storage.
globalThis.tx = globalThis.tx || ((en) => en);
globalThis.dispName = globalThis.dispName || ((id, fallback) => fallback);
const { buildSavedRow } = require("../js/render-fees-calculator.js");

const savedTable = el("fc-saved-table");
const tbody = el("fc-saved-tbody");
const countEl = el("fc-saved-count");

// ── helpers ──────────────────────────────────────────────────────────────────
function seedRows(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push(buildSavedRow(
      { name: `Trade ${i}`, city: "Martlock", buyPrice: 1000 + i, sellPrice: 2000 + i,
        quantity: 10, buyMode: "market", sellMode: "market", premium: true },
      () => `row-${i}`,
    ));
  }
  localStorage.setItem(LS_SAVED_KEY, JSON.stringify(rows));
  return rows;
}
function rowCount(html) {
  return (String(html).match(/data-row-id=/g) || []).length;
}
function render() {
  // mirror of expand path: invoke whatever the table registered
  if (typeof savedTable._staticRenderer === "function") savedTable._staticRenderer();
}

// Faithful mirror of the relevant branch of app.js setCollapsed(): #fc-saved-table
// has no tableState entry, so collapse wipes the tbody and expand falls through
// to the table's _staticRenderer (if any).
function setCollapsed(collapsed) {
  if (collapsed) {
    tbody.innerHTML = "";
  } else if (typeof savedTable._staticRenderer === "function") {
    savedTable._staticRenderer();
  }
}

// ── test runner ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  _ls = {};                 // reset persisted storage between cases
  tbody.innerHTML = "";
  countEl.textContent = "";
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Fees Calculator — Saved Trades collapse/expand persistence\n");

// ── the fix itself: a renderer is registered for the collapse handler ────────
test("attach() registers a _staticRenderer on #fc-saved-table", () => {
  assert.strictEqual(typeof savedTable._staticRenderer, "function",
    "#fc-saved-table must expose a _staticRenderer so app.js can rebuild it after collapse");
});

// ── baseline render from storage ─────────────────────────────────────────────
test("empty storage renders the empty-state placeholder, no rows", () => {
  render();
  assert.ok(/fc-saved-empty/.test(tbody.innerHTML), "expected empty-state row");
  assert.strictEqual(rowCount(tbody.innerHTML), 0);
});

test("renders one <tr> per saved row from storage", () => {
  seedRows(3);
  render();
  assert.strictEqual(rowCount(tbody.innerHTML), 3);
  assert.strictEqual(countEl.textContent, "(3)");
});

// ── collapse wipes; expand must restore (THE BUG) ────────────────────────────
test("collapse wipes the tbody", () => {
  seedRows(2);
  render();
  assert.strictEqual(rowCount(tbody.innerHTML), 2);
  setCollapsed(true);
  assert.strictEqual(tbody.innerHTML, "", "collapse should clear the tbody");
});

test("expand after collapse restores the saved rows (regression)", () => {
  seedRows(2);
  render();
  setCollapsed(true);
  assert.strictEqual(rowCount(tbody.innerHTML), 0, "wiped on collapse");
  setCollapsed(false);
  assert.strictEqual(rowCount(tbody.innerHTML), 2, "rows must reappear on expand");
  assert.strictEqual(countEl.textContent, "(2)");
});

test("reload-while-collapsed then expand restores rows (the reported flow)", () => {
  // simulate: page load renders rows, the persisted collapsed flag forces a
  // collapse (wiping the freshly-rendered tbody), then the user expands.
  seedRows(4);
  render();                 // attach() render on load
  setCollapsed(true);       // setupCollapsibleTables() reapplies collapsed state
  assert.strictEqual(rowCount(tbody.innerHTML), 0);
  setCollapsed(false);      // user expands the section
  assert.strictEqual(rowCount(tbody.innerHTML), 4);
});

// ── why the registration matters: without it, expand cannot restore ──────────
test("a table with no _staticRenderer stays blank after expand (documents the cause)", () => {
  const bare = { _staticRenderer: undefined };
  seedRows(2);
  // collapse wipes, expand has nothing to replay
  tbody.innerHTML = "";
  if (typeof bare._staticRenderer === "function") bare._staticRenderer();
  assert.strictEqual(rowCount(tbody.innerHTML), 0,
    "without a registered renderer the rows cannot come back — exactly the bug");
});

// ── stability + freshness ────────────────────────────────────────────────────
test("multiple collapse/expand cycles stay stable", () => {
  seedRows(3);
  render();
  for (let i = 0; i < 4; i++) {
    setCollapsed(true);
    setCollapsed(false);
  }
  assert.strictEqual(rowCount(tbody.innerHTML), 3);
});

test("expand re-reads current storage (reflects rows added while collapsed)", () => {
  seedRows(1);
  render();
  setCollapsed(true);
  seedRows(5);               // storage grows while the section is collapsed
  setCollapsed(false);
  assert.strictEqual(rowCount(tbody.innerHTML), 5);
  assert.strictEqual(countEl.textContent, "(5)");
});

test("expand reflects rows removed while collapsed (down to empty state)", () => {
  seedRows(3);
  render();
  setCollapsed(true);
  localStorage.setItem(LS_SAVED_KEY, JSON.stringify([])); // user cleared all
  setCollapsed(false);
  assert.strictEqual(rowCount(tbody.innerHTML), 0);
  assert.ok(/fc-saved-empty/.test(tbody.innerHTML), "should fall back to empty state");
});

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
