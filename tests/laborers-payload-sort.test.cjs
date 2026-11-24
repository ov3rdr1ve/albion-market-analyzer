/**
 * Test: the Laborers table sorts the "Payload / Cycle" column correctly.
 *
 * Bug: the Payload / Cycle header is data-sort="revenue", but getSortValue's
 * "revenue" branch had no laborers-table case, so it fell through to the
 * flipping default `row.sell.price`. For laborers, sell.price is only the
 * per-UNIT payload price (trophy price) — for resource/crafting/mercenary rows
 * it's a per-unit figure on a totally different scale than the per-cycle silver
 * the cell actually displays (payloadRevenue). Result: clicking the header
 * ordered rows by the wrong number.
 *
 * Fix: laborers-table "revenue" returns row.payloadRevenue — the gross
 * per-cycle revenue the column header defines and the cell displays.
 *
 * Loads the REAL getSortValue from js/sorting.js so the fix is exercised
 * directly, not mirrored.
 *
 * Run: node tests/laborers-payload-sort.test.cjs
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
const mod = new Module("sorting-laborers-payload-test");
mod._compile(stubs + src + "\nmodule.exports = { getSortValue };", "sorting.js");
const { getSortValue } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const TID = "laborers-table";

console.log("Laborers — Payload / Cycle column sorting tests\n");

test("revenue reads payloadRevenue (per-cycle gross), not sell.price", () => {
  const row = { payloadRevenue: 12345, sell: { city: "Martlock", price: 678 } };
  assert.strictEqual(getSortValue(row, "revenue", TID), 12345);
});

test("trophy-mode rows also sort by payloadRevenue", () => {
  // Trophy cell DISPLAYS the unit price, but the column means per-cycle gross.
  const row = { mode: "Trophy", payloadRevenue: 9000, sell: { city: "Lymhurst", price: 7600 } };
  assert.strictEqual(getSortValue(row, "revenue", TID), 9000);
});

test("missing payloadRevenue defaults to 0 (no NaN / undefined sort)", () => {
  assert.strictEqual(getSortValue({}, "revenue", TID), 0);
  assert.strictEqual(getSortValue({ payloadRevenue: null }, "revenue", TID), 0);
  assert.strictEqual(getSortValue({ payloadRevenue: undefined }, "revenue", TID), 0);
});

test("does NOT fall through to the flipping sell.price default", () => {
  // A row with only sell.price (no payloadRevenue) must read 0, proving the
  // laborers branch caught it before the flipping default.
  const row = { sell: { city: "Bridgewatch", price: 5000 } };
  assert.strictEqual(getSortValue(row, "revenue", TID), 0);
});

test("sorting an array by Payload / Cycle descending orders by payloadRevenue", () => {
  const rows = [
    { id: "merc",  mode: "Mercenary", payloadRevenue: 4200, sell: { price: 0 } },
    { id: "troph", mode: "Trophy",    payloadRevenue: 31000, sell: { price: 26000 } },
    { id: "res",   mode: "Resource",  payloadRevenue: 8800, sell: { price: 120 } },
    { id: "nodata",                   payloadRevenue: 0,    sell: { price: 9999 } },
  ];
  rows.sort((x, y) => getSortValue(y, "revenue", TID) - getSortValue(x, "revenue", TID));
  assert.deepStrictEqual(rows.map((r) => r.id), ["troph", "res", "merc", "nodata"]);
});

test("regression: the old sell.price order differs from the correct one", () => {
  // Under the buggy default these would sort troph(26000) > nodata(9999) >
  // res(120) > merc(0) — clearly wrong vs the payloadRevenue order above.
  const rows = [
    { id: "merc",  payloadRevenue: 4200, sell: { price: 0 } },
    { id: "troph", payloadRevenue: 31000, sell: { price: 26000 } },
    { id: "res",   payloadRevenue: 8800, sell: { price: 120 } },
    { id: "nodata", payloadRevenue: 0,   sell: { price: 9999 } },
  ];
  const byPayload = rows
    .slice()
    .sort((x, y) => getSortValue(y, "revenue", TID) - getSortValue(x, "revenue", TID))
    .map((r) => r.id);
  const bySellPrice = rows
    .slice()
    .sort((x, y) => (y.sell.price || 0) - (x.sell.price || 0))
    .map((r) => r.id);
  assert.notDeepStrictEqual(byPayload, bySellPrice);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
