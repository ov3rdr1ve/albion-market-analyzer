/**
 * My Crafting List — quantity 0 parks a row (js/craft-list-store.js +
 * js/craft-list-materials.js).
 *
 * A row on the list is a plan, and a plan you are not running right now is
 * still worth keeping: quantity 0 keeps the row (and its editable prices) on
 * the list while it contributes NOTHING — no profit, no cost, no revenue, no
 * focus, no journals, and no lines on the Materials to Buy board.
 *
 * Black-box over the two pure modules; the panel's dimming is covered by
 * tests/craft-list-render.test.cjs.
 *
 * Run: node tests/craft-list-qty-zero.test.cjs
 */
const assert = require("assert");
const path = require("path");

const store = require(path.join(__dirname, "..", "js", "craft-list-store.js"));
const {
  aggregateCraftListMaterials,
  summarizeCraftList,
} = require(path.join(__dirname, "..", "js", "craft-list-materials.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

function memStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

// ── the store accepts 0 ─────────────────────────────────────────────────────

test("normalizeCraftQty keeps 0 as 0", () => {
  const cases = [
    [0, 0], ["0", 0], [-5, 0], ["-5", 0], [-0.5, 0],
    // A cleared field commits as "" — Number("") is 0, and "none" is exactly
    // what an emptied quantity box means now.
    ["", 0],
    // No quantity at all is an ADD, not a park: "+" means one of these.
    [undefined, 1], [null, 1], ["abc", 1], [NaN, 1],
    [3.9, 3], ["12", 12], [1e12, 1000000],
  ];
  cases.forEach(([input, want]) => {
    assert.strictEqual(store.normalizeCraftQty(input), want, `${String(input)} → ${want}`);
  });
});

// A typed quantity may be arithmetic (js/craft-list-qty-expr.js). The clamping
// rules above are unchanged by it: the expression only decides what number the
// text means, and the store still floors, parks and caps that number.
test("normalizeCraftQty evaluates an arithmetic quantity", () => {
  const cases = [
    ["96+96", 192], ["96 + 96", 192], ["(96+96)/2", 96], ["3*4", 12],
    // Floored and clamped like any other number.
    ["96/7", 13], ["96-200", 0], ["2.5*4", 10],
    ["999999*999999", 1000000],
    // Not a finished expression — the old fallback stands.
    ["96+", 1], ["96++96", 1], ["1/0", 1], ["abc+1", 1],
    // Unchanged: a cleared field is still a park, a plain number still itself.
    ["", 0], ["0", 0], ["480", 480],
  ];
  cases.forEach(([input, want]) => {
    assert.strictEqual(store.normalizeCraftQty(input), want, `${String(input)} → ${want}`);
  });
});

test("setCraftListQty stores a 0 instead of snapping it to 1", () => {
  store.setCraftListStorage(null);
  store.clearCraftList();
  store.addCraftListEntry({ tableId: "crafting-table", rowKey: "T6_BAG|Martlock", itemId: "T6_BAG" });
  assert.strictEqual(store.setCraftListQty("crafting-table", "T6_BAG|Martlock", 0), true);
  assert.strictEqual(store.getCraftList()[0].qty, 0);
});

test("a parked row survives a save and reload as 0", () => {
  const storage = memStorage();
  store.setCraftListStorage(storage);
  store.clearCraftList();
  store.addCraftListEntry({ tableId: "crafting-table", rowKey: "T6_BAG|Martlock", itemId: "T6_BAG", qty: 0 });
  store.loadCraftListFromStorage();
  assert.strictEqual(store.getCraftList()[0].qty, 0);
  store.setCraftListStorage(null);
});

test("re-adding a parked row keeps it parked", () => {
  store.setCraftListStorage(null);
  store.clearCraftList();
  store.addCraftListEntry({ tableId: "crafting-table", rowKey: "T6_BAG|Martlock", itemId: "T6_BAG" });
  store.setCraftListQty("crafting-table", "T6_BAG|Martlock", 0);
  store.addCraftListEntry({ tableId: "crafting-table", rowKey: "T6_BAG|Martlock", itemId: "T6_BAG" });
  assert.strictEqual(store.getCraftList().length, 1);
  assert.strictEqual(store.getCraftList()[0].qty, 0);
});

// ── a parked row is out of every total ──────────────────────────────────────

const PARKED = {
  tableId: "crafting-table",
  inputCost: 1000, sellPrice: 1500, unitProfit: 400, unitProfitNoFocus: 300,
  laborerProfit: 450, hasLaborerPlay: true, focusCost: 100,
  laborerFill: { slug: "TOOLMAKER", tier: 5, craftsPerJournal: 2 },
  materials: [{ matId: "T5_METALBAR", count: 8, city: "Thetford", perUnit: 900 }],
  qty: 0,
};
const LIVE = { ...PARKED, itemId: "T6_BAG", qty: 10 };

test("a parked row contributes no cost, revenue, profit or focus", () => {
  const s = summarizeCraftList([PARKED]);
  assert.strictEqual(s.totalCost, 0);
  assert.strictEqual(s.totalRevenue, 0);
  assert.strictEqual(s.totalProfit, 0);
  assert.strictEqual(s.totalLaborerProfit, 0);
  assert.strictEqual(s.totalFocus, 0);
});

test("a parked row leaves a live row's totals untouched", () => {
  const alone = summarizeCraftList([LIVE]);
  const withParked = summarizeCraftList([LIVE, PARKED]);
  assert.strictEqual(withParked.totalCost, alone.totalCost);
  assert.strictEqual(withParked.totalRevenue, alone.totalRevenue);
  assert.strictEqual(withParked.totalProfit, alone.totalProfit);
  assert.strictEqual(withParked.totalFocus, alone.totalFocus);
});

test("a parked row does not count as a laborer-play row", () => {
  assert.strictEqual(summarizeCraftList([PARKED]).laborerRows, 0);
  assert.strictEqual(summarizeCraftList([LIVE]).laborerRows, 1);
});

test("a parked row fills no journals", () => {
  const s = summarizeCraftList([PARKED]);
  assert.strictEqual(s.totalJournals, 0);
  assert.deepStrictEqual(s.journalGroups, []);
});

// The row is still ON the list — it is a bookmark, not a deletion — so it is
// still counted as an entry. Only its economics are zero.
test("a parked row is still counted as an entry on the list", () => {
  assert.strictEqual(summarizeCraftList([PARKED, LIVE]).count, 2);
});

// ── a parked row buys nothing ───────────────────────────────────────────────

test("a parked row puts nothing on the shopping board", () => {
  const agg = aggregateCraftListMaterials([PARKED]);
  assert.deepStrictEqual(agg.lines, []);
  assert.strictEqual(agg.grandTotal, 0);
});

test("a parked row does not add a zero line beside a live one", () => {
  const agg = aggregateCraftListMaterials([LIVE, PARKED]);
  assert.strictEqual(agg.lines.length, 1);
  assert.strictEqual(agg.lines[0].count, 80);
});

test("a zero-count material line never reaches the board", () => {
  const agg = aggregateCraftListMaterials([{
    materials: [{ matId: "T5_METALBAR", count: 0, city: "Thetford", perUnit: 900 }],
    qty: 10,
  }]);
  assert.deepStrictEqual(agg.lines, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
