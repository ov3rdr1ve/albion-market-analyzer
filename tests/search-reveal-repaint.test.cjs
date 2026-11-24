/**
 * Black-box tests for the search-reveal repaint (js/table-search.js).
 *
 * The feature: the profitability gate (js/sorting.js updateTableDisplay) drops
 * no-data / unprofitable rows from the DOM at RENDER time, and a row not in the
 * DOM can never be shown by the input's own display:none pass. A query that
 * names such a row (rowRevealedBySearch) must therefore schedule a repaint —
 * updateTableDisplay reads the query BEFORE the gate, so the replay paints the
 * revealed row. Debounced per table; canceled when the box is emptied; a table
 * that already shows every revealed row never pays for a repaint.
 *
 * Pure input→output: a tiny fake document + real timers, no DOM library, no
 * network, no prices.
 *
 * Run: node tests/search-reveal-repaint.test.cjs
 */

const assert = require("assert");

const {
  searchRevealNeedsRepaint,
  scheduleSearchRevealRepaint,
} = require("../js/table-search.js");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── fake world ────────────────────────────────────────────────────────────────

// A cached planner row the gate dropped: unpriced Realmbreaker T5.
const HIDDEN_ROW = {
  item: { id: "T5_2H_AXE_AVALON", name: "Expert's Realmbreaker [T5]" },
  craftCity: "Martlock", section: "royal", noData: true, combinedProfit: undefined,
};
// A cached row the gate kept: profitable T6.
const SHOWN_ROW = {
  item: { id: "T6_2H_AXE_AVALON", name: "Master's Realmbreaker [T6]" },
  craftCity: "Martlock", section: "royal", noData: false, combinedProfit: 25396,
};
// A cached row that only matches part of a two-term query.
const PARTIAL_ROW = {
  item: { id: "T8_CAPE", name: "Elder's Cape [T8]" },
  craftCity: "Martlock", section: "royal", noData: true,
};

function rowKeyOf(row) {
  return `${row.item.id}|${row.craftCity}|${row.section}`;
}

/**
 * Mount the globals the predicate reads.
 * `paintedKeys` — row keys already on screen (the gate kept them).
 * `inputValue`  — the live value of #search-<tableId>.
 */
function mountWorld({ tableId = "craft-planner-table", data = [], paintedKeys = [], inputValue = "", withInput = true } = {}) {
  const painted = new Set(paintedKeys);
  global.tableState = { [tableId]: { data } };
  const tbody = {
    querySelectorAll: (sel) =>
      String(sel).includes("data-row-key")
        ? Array.from(painted).map((k) => ({ getAttribute: (a) => (a === "data-row-key" ? k : null) }))
        : [],
  };
  const input = { value: inputValue };
  global.document = {
    getElementById: (id) => {
      if (withInput && id === `search-${tableId}`) return input;
      return null;
    },
    querySelector: (sel) => (String(sel).includes(tableId) ? tbody : null),
  };
  global.getRowKey = rowKeyOf;
  // updateTableDisplay spy — the real one lives in js/sorting.js.
  global.__repaints = 0;
  global.updateTableDisplay = () => { global.__repaints++; };
  return input;
}

function unmountWorld() {
  delete global.tableState;
  delete global.document;
  delete global.getRowKey;
  delete global.updateTableDisplay;
  delete global.__repaints;
}

const TERMS = ["realmbr"];

// ── searchRevealNeedsRepaint (the predicate) ─────────────────────────────────

test("predicate — true when a cached row the gate dropped is revealed by the query", () => {
  mountWorld({ data: [HIDDEN_ROW], paintedKeys: [], inputValue: "realmbr" });
  assert.strictEqual(searchRevealNeedsRepaint("craft-planner-table", TERMS), true);
  unmountWorld();
});

test("predicate — false when every cached row is already painted", () => {
  mountWorld({ data: [SHOWN_ROW], paintedKeys: [rowKeyOf(SHOWN_ROW)], inputValue: "realmbr" });
  assert.strictEqual(searchRevealNeedsRepaint("craft-planner-table", TERMS), false);
  unmountWorld();
});

test("predicate — false when the hidden row matches some but not all terms (AND rule)", () => {
  mountWorld({ data: [PARTIAL_ROW], paintedKeys: [], inputValue: "realmbr cape" });
  assert.strictEqual(
    searchRevealNeedsRepaint("craft-planner-table", ["realmbr", "cape"]), false);
  unmountWorld();
});

test("predicate — false with no terms", () => {
  mountWorld({ data: [HIDDEN_ROW], paintedKeys: [], inputValue: "" });
  assert.strictEqual(searchRevealNeedsRepaint("craft-planner-table", []), false);
  unmountWorld();
});

test("predicate — false when the table has no cached data", () => {
  mountWorld({ tableId: "empty-table", data: [], paintedKeys: [], inputValue: "x" });
  assert.strictEqual(searchRevealNeedsRepaint("empty-table", ["x"]), false);
  unmountWorld();
});

test("predicate — false when tableState itself is absent", () => {
  mountWorld({ data: [HIDDEN_ROW], inputValue: "realmbr" });
  delete global.tableState;
  assert.strictEqual(searchRevealNeedsRepaint("craft-planner-table", TERMS), false);
  unmountWorld();
});

test("predicate — true for a hidden row revealed only through its display name", () => {
  // getItemDisplayName maps ids the catalogue spells differently; the identity
  // haystack includes it (same source js/sorting.js reveals from).
  global.getItemDisplayName = (id) =>
    id === "T5_2H_AXE_AVALON" ? "Expert's Realmbreaker [T5]" : id;
  mountWorld({
    data: [{ item: { id: "T5_2H_AXE_AVALON", name: "" }, craftCity: "Martlock", section: "royal" }],
    paintedKeys: [], inputValue: "realmbreaker",
  });
  assert.strictEqual(searchRevealNeedsRepaint("craft-planner-table", ["realmbreaker"]), true);
  delete global.getItemDisplayName;
  unmountWorld();
});

// ── scheduleSearchRevealRepaint (the debounced repaint) ──────────────────────

const REPAINT_DELAY_MS = 400; // ≥ the implementation's debounce

test("schedule — repaints once after the debounce when a hidden row is revealed", async () => {
  mountWorld({ data: [HIDDEN_ROW, SHOWN_ROW], paintedKeys: [rowKeyOf(SHOWN_ROW)], inputValue: "realmbr" });
  assert.strictEqual(global.__repaints, 0, "no repaint before the debounce");
  scheduleSearchRevealRepaint("craft-planner-table");
  await sleep(REPAINT_DELAY_MS / 2);
  assert.strictEqual(global.__repaints, 0, "debounce holds the repaint back");
  await sleep(REPAINT_DELAY_MS);
  assert.strictEqual(global.__repaints, 1, "exactly one repaint after the debounce");
  unmountWorld();
});

test("schedule — coalesces rapid keystrokes into one repaint", async () => {
  mountWorld({ data: [HIDDEN_ROW], paintedKeys: [], inputValue: "realmbr" });
  scheduleSearchRevealRepaint("craft-planner-table");
  await sleep(50);
  scheduleSearchRevealRepaint("craft-planner-table");
  await sleep(50);
  scheduleSearchRevealRepaint("craft-planner-table");
  await sleep(REPAINT_DELAY_MS);
  assert.strictEqual(global.__repaints, 1);
  unmountWorld();
});

test("schedule — no repaint when nothing revealed is missing from the DOM", async () => {
  mountWorld({ data: [SHOWN_ROW], paintedKeys: [rowKeyOf(SHOWN_ROW)], inputValue: "realmbr" });
  scheduleSearchRevealRepaint("craft-planner-table");
  await sleep(REPAINT_DELAY_MS);
  assert.strictEqual(global.__repaints, 0);
  unmountWorld();
});

test("schedule — canceled when the box is emptied before the debounce fires", async () => {
  const input = mountWorld({ data: [HIDDEN_ROW], paintedKeys: [], inputValue: "realmbr" });
  scheduleSearchRevealRepaint("craft-planner-table");
  await sleep(50);
  input.value = "";
  scheduleSearchRevealRepaint("craft-planner-table"); // empty terms → cancel
  await sleep(REPAINT_DELAY_MS);
  assert.strictEqual(global.__repaints, 0, "the gate must re-drop, not resurrect");
  unmountWorld();
});

test("schedule — reads the box at fire time: cleared mid-debounce never repaints", async () => {
  const input = mountWorld({ data: [HIDDEN_ROW], paintedKeys: [], inputValue: "realmbr" });
  scheduleSearchRevealRepaint("craft-planner-table");
  await sleep(50);
  input.value = ""; // cleared while the debounce is running
  await sleep(REPAINT_DELAY_MS);
  assert.strictEqual(global.__repaints, 0);
  unmountWorld();
});

test("schedule — repaint restores the gate view after a revealed query is cleared", async () => {
  const input = mountWorld({ data: [HIDDEN_ROW], paintedKeys: [], inputValue: "realmbr" });
  scheduleSearchRevealRepaint("craft-planner-table");
  await sleep(REPAINT_DELAY_MS);
  assert.strictEqual(global.__repaints, 1);
  input.value = ""; // user clears: the revealed row must go back into hiding
  scheduleSearchRevealRepaint("craft-planner-table");
  await sleep(REPAINT_DELAY_MS);
  assert.strictEqual(global.__repaints, 2, "one restore repaint after the reveal");
  unmountWorld();
});

test("schedule — no throw without a search input or without document", async () => {
  mountWorld({ data: [HIDDEN_ROW], inputValue: "realmbr", withInput: false });
  assert.doesNotThrow(() => scheduleSearchRevealRepaint("craft-planner-table"));
  unmountWorld();
  delete global.document;
  assert.doesNotThrow(() => scheduleSearchRevealRepaint("craft-planner-table"));
  await sleep(10);
});

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
