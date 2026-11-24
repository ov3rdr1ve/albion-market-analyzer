/**
 * Test: _suppressSort preserves existing row order, but inserts NEW rows at
 * their correct sorted position.
 *
 * When an override triggers a re-render, previously-shown rows keep their
 * current order so the user's view stays stable.  Rows that appear this render
 * (e.g. an override priced a route into existence) are spliced into the slot
 * the active sort warrants — NOT dumped at the bottom.  Appending them ignored
 * their sort value, so a high-profit override row landed below low-profit rows
 * and the active "Profit" sort looked broken (reported bug).
 *
 * Run: node tests/suppress-sort-new-rows.test.cjs
 */

const assert = require("assert");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

console.log("Suppress-Sort New Rows Tests\n");

// ── Minimal stubs mirroring sorting.js ──

function getRowKey(row) {
  // Mirrors the new stable key: item.id + craftCity (sell city excluded)
  return (row.item?.id || "") + "|" + (row.craftCity || "");
}

function getSortValue(row, col) {
  if (col === "profit") return row.marginInfo ? (row.marginInfo.profit || 0) : -Infinity;
  if (col === "margin") return row.marginInfo ? row.marginInfo.margin : -999;
  return 0;
}

/**
 * Reproduces the suppress-sort logic from updateTableDisplay.
 * @param {Array} rows        – the profitableRows array
 * @param {string[]} oldKeys  – _sortedKeys from the previous render
 * @param {boolean} suppress  – whether _suppressSort is true
 * @param {string} sortCol    – active sort column
 * @param {string} sortDir    – "asc" | "desc"
 * @returns {Array} sorted rows
 */
function compareRows(a, b, sortCol, sortDir) {
  let valA = getSortValue(a, sortCol);
  let valB = getSortValue(b, sortCol);
  let cmp;
  if (typeof valA === "string" && typeof valB === "string") {
    cmp = valA.localeCompare(valB);
  } else {
    cmp = valA - valB;
  }
  if (sortDir === "desc") cmp = -cmp;
  return cmp;
}

function applySortLogic(rows, oldKeys, suppress, sortCol, sortDir) {
  let copy = rows.slice();
  let preserved = false;
  if (suppress && oldKeys) {
    const keyOrder = new Map(oldKeys.map((k, i) => [k, i]));
    const known = [];
    const fresh = [];
    for (const r of copy) {
      (keyOrder.has(getRowKey(r)) ? known : fresh).push(r);
    }
    known.sort((a, b) => keyOrder.get(getRowKey(a)) - keyOrder.get(getRowKey(b)));
    if (fresh.length > 0) {
      fresh.sort((a, b) => compareRows(a, b, sortCol, sortDir));
      for (const nr of fresh) {
        let i = 0;
        while (i < known.length && compareRows(known[i], nr, sortCol, sortDir) <= 0) i++;
        known.splice(i, 0, nr);
      }
    }
    copy = known;
    preserved = true;
  }
  if (!preserved) {
    copy.sort((a, b) => compareRows(a, b, sortCol, sortDir));
  }
  return copy;
}

// ── Fixtures ──

const rowA = { item: { id: "T6_2H_BOW", name: "Bow" },       craftCity: "Lymhurst",     sellGear: { city: "Bridgewatch" }, marginInfo: { profit: 5000,  margin: 20 } };
const rowB = { item: { id: "T6_MAIN_SWORD", name: "Sword" },  craftCity: "Bridgewatch",  sellGear: { city: "Martlock" },    marginInfo: { profit: 3000,  margin: 15 } };
const rowC = { item: { id: "T6_MAIN_FIRESTAFF", name: "Staff" }, craftCity: "Fort Sterling", sellGear: { city: "Lymhurst" },   marginInfo: { profit: 1000,  margin: 5 } };
// Transport Ox — initially unprofitable, then override makes it profitable
const rowOx = { item: { id: "T6_MOUNT_OX", name: "Transport Ox" }, craftCity: "Lymhurst",   sellGear: { city: "Bridgewatch" }, marginInfo: { profit: 4000, margin: 10 } };

// ── Tests ──

test("suppress-sort preserves order when all rows are known", () => {
  const oldKeys = [getRowKey(rowA), getRowKey(rowB), getRowKey(rowC)];
  const result = applySortLogic([rowC, rowA, rowB], oldKeys, true, "profit", "desc");
  const names = result.map(r => r.item.name);
  assert.deepStrictEqual(names, ["Bow", "Sword", "Staff"], "should preserve cached order A, B, C");
});

test("suppress-sort preserves order and inserts new rows at their sorted slot", () => {
  // Before override: only A, B, C were profitable → cached keys
  const oldKeys = [getRowKey(rowA), getRowKey(rowB), getRowKey(rowC)];
  // After override: Ox appears (profit 4000) — slots between A (5000) and B (3000)
  const result = applySortLogic([rowA, rowB, rowC, rowOx], oldKeys, true, "profit", "desc");
  const names = result.map(r => r.item.name);
  assert.deepStrictEqual(names, ["Bow", "Transport Ox", "Sword", "Staff"],
    "existing order preserved, new row inserted by profit (not dumped at bottom)");
});

test("a high-profit new row is NOT parked at the bottom", () => {
  // Reproduces the reported refining bug: an override prices a high-profit
  // route into existence; it must land at the TOP, not below low-profit rows.
  const oldKeys = [getRowKey(rowB), getRowKey(rowC)]; // only Sword(3000), Staff(1000) shown
  const result = applySortLogic([rowB, rowC, rowA], oldKeys, true, "profit", "desc");
  const names = result.map(r => r.item.name);
  assert.deepStrictEqual(names, ["Bow", "Sword", "Staff"],
    "Bow(5000) inserts above the cached Sword/Staff rows, matching the active Profit sort");
});

test("normal sort when _suppressSort is false", () => {
  const oldKeys = [getRowKey(rowA), getRowKey(rowB), getRowKey(rowC)];
  const result = applySortLogic([rowC, rowA, rowB], oldKeys, false, "profit", "desc");
  const names = result.map(r => r.item.name);
  assert.deepStrictEqual(names, ["Bow", "Sword", "Staff"], "should sort by profit desc");
});

test("normal sort when _sortedKeys is null", () => {
  const result = applySortLogic([rowC, rowA, rowB], null, true, "profit", "desc");
  const names = result.map(r => r.item.name);
  assert.deepStrictEqual(names, ["Bow", "Sword", "Staff"], "should sort by profit desc when no cached keys");
});

test("suppress-sort falls through when a row disappears", () => {
  // Cached keys had A, B, C, Ox.  Now Ox disappeared (became unprofitable).
  const oldKeys = [getRowKey(rowA), getRowKey(rowOx), getRowKey(rowB), getRowKey(rowC)];
  // profitableRows only has A, B, C — all known, so order should be preserved
  const result = applySortLogic([rowA, rowB, rowC], oldKeys, true, "profit", "desc");
  const names = result.map(r => r.item.name);
  // All rows found in old keys, so preserved order: A, B, C (positions 0, 2, 3)
  assert.deepStrictEqual(names, ["Bow", "Sword", "Staff"], "should preserve order for remaining rows");
});

test("suppress-sort inserts new rows honoring sort direction", () => {
  const oldKeys = [getRowKey(rowA), getRowKey(rowB), getRowKey(rowC)];
  // Ascending profit: Ox(4000) sorts before the first cached row it beats — A(5000).
  const result = applySortLogic([rowA, rowB, rowC, rowOx], oldKeys, true, "profit", "asc");
  const names = result.map(r => r.item.name);
  assert.deepStrictEqual(names, ["Transport Ox", "Bow", "Sword", "Staff"],
    "known rows keep cached order; new row placed per ascending direction");
});

test("suppress-sort preserves position when sell city changes due to override", () => {
  const oldKeys = [getRowKey(rowA), getRowKey(rowB), getRowKey(rowC)];
  // After override: Bow's sell city changes from Bridgewatch to Martlock
  const rowA2 = { ...rowA, sellGear: { city: "Martlock" }, marginInfo: { profit: 2000, margin: 8 } };
  const result = applySortLogic([rowA2, rowB, rowC], oldKeys, true, "profit", "desc");
  const names = result.map(r => r.item.name);
  assert.deepStrictEqual(names, ["Bow", "Sword", "Staff"],
    "row stays in same position even though sell city changed");
});

test("suppress-sort preserves position when row transitions from no-data to data", () => {
  // No-data row has no sellGear — key still uses item.id + craftCity
  const rowNoData = { item: { id: "T6_2H_BOW", name: "Bow" }, craftCity: "Lymhurst", marginInfo: { margin: -1 }, section: "royal" };
  const oldKeys = [getRowKey(rowNoData), getRowKey(rowB), getRowKey(rowC)];
  // After override: Bow now has data
  const result = applySortLogic([rowA, rowB, rowC], oldKeys, true, "profit", "desc");
  const names = result.map(r => r.item.name);
  assert.deepStrictEqual(names, ["Bow", "Sword", "Staff"],
    "row stays in same position after transitioning from no-data to data");
});

// ── Summary ──

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
