/**
 * Test: the Faction Spending table sorts by the Favor columns.
 *
 * Bug: getSortValue (js/sorting.js) had explicit branches for silverPerFp /
 * fpCost but none for silverPerFavor / favorCost, so clicking the "S/Favor" or
 * "Favor Cost" header fell through to `return 0` — every row tied and nothing
 * reordered.
 *
 * Loads the REAL getSortValue from js/sorting.js (via Module._compile with a
 * localStorage stub) so the fix is exercised directly, not mirrored.
 *
 * Run: node tests/faction-spending-favor-sort.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "js", "sorting.js"), "utf8");
const stubs = `
const localStorage = { getItem: () => null, setItem: () => {} };
const document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
const window = { scrollTo() {}, scrollY: 0 };
const SETUP_FEE = 0.025;
function getItemDisplayName(id) { return id; }
const ITEM_NAMES_MAP = {};
`;
const mod = new Module("sorting-favor-test");
mod._compile(stubs + src + "\nmodule.exports = { getSortValue };", "sorting.js");
const { getSortValue } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const TID = "faction-spending-table";

console.log("Faction Spending — Favor column sorting tests\n");

test("getSortValue reads silverPerFavor", () => {
  assert.strictEqual(getSortValue({ silverPerFavor: 12.5 }, "silverPerFavor", TID), 12.5);
});
test("getSortValue reads favorCost", () => {
  assert.strictEqual(getSortValue({ favorCost: 6750 }, "favorCost", TID), 6750);
});
test("missing Favor fields default to 0 (not undefined → NaN sort)", () => {
  assert.strictEqual(getSortValue({}, "silverPerFavor", TID), 0);
  assert.strictEqual(getSortValue({}, "favorCost", TID), 0);
});
test("FP rows (silverPerFavor 0) and Favor rows both yield comparable numbers", () => {
  const fpRow = { currency: "FP", silverPerFp: 14, silverPerFavor: 0 };
  const favorRow = { currency: "Favor", silverPerFp: 0, silverPerFavor: 22.5 };
  assert.strictEqual(getSortValue(fpRow, "silverPerFavor", TID), 0);
  assert.strictEqual(getSortValue(favorRow, "silverPerFavor", TID), 22.5);
});

test("sorting an array by silverPerFavor descending orders correctly", () => {
  const rows = [
    { itemId: "a", silverPerFavor: 1.82 },
    { itemId: "b", silverPerFavor: 148.15 },
    { itemId: "c", silverPerFavor: 0 },
    { itemId: "d", silverPerFavor: 22.47 },
  ];
  rows.sort((x, y) => getSortValue(y, "silverPerFavor", TID) - getSortValue(x, "silverPerFavor", TID));
  assert.deepStrictEqual(rows.map((r) => r.itemId), ["b", "d", "a", "c"]);
});

test("sorting by favorCost ascending orders correctly", () => {
  const rows = [
    { itemId: "relic", favorCost: 8100 },
    { itemId: "rune", favorCost: 150 },
    { itemId: "chest", favorCost: 6750 },
  ];
  rows.sort((x, y) => getSortValue(x, "favorCost", TID) - getSortValue(y, "favorCost", TID));
  assert.deepStrictEqual(rows.map((r) => r.itemId), ["rune", "chest", "relic"]);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
