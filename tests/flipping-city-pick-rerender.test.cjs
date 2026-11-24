/**
 * Test: moving EITHER of Flipping's two City pickers re-renders the table.
 *
 * The picks are honoured inside the row builder (js/render-flipping.js), so a
 * pick that does not trigger a rebuild changes nothing on screen. That path used
 * to consult the sell picker alone — repriceOnCityChange read
 * sellCityFilterChanged and stopped there — which is fine for the craft tables
 * (they have one picker) and silently dead for Flipping's Buy City one.
 *
 * Also pinned: BOTH change-detectors run on every pass. They double as "record
 * what the picker reads now", so short-circuiting on the first `true` would
 * leave the other side's remembered value stale and swallow its next move.
 *
 * Black-box over the real js/table-search.js internals with a fake DOM and
 * stubbed globals. No live DOM, no network.
 *
 * Run: node tests/flipping-city-pick-rerender.test.cjs
 */

const assert = require("assert");

const TABLE = "flipping-table";

// ── Stub the globals table-search.js reaches for by bare identifier ──────────
// (each behind a `typeof` guard there, so a plain global assignment is enough)
const REPRICING = new Set([TABLE, "craft-planner-table"]);
globalThis.tableRepricesOnCityPick = (id) => REPRICING.has(id);
globalThis.TABLE_RENDERERS = { [TABLE]: "renderFlippingTable" };
globalThis.lastMarketData = { T5_BAG: {} };

// The real change-detector shape: remember the last value per (table, side) and
// report whether this call moved it.
function makeDetector() {
  const seen = new Map();
  const calls = [];
  const fn = (tableId, city) => {
    const next = city || "";
    const prev = seen.has(tableId) ? seen.get(tableId) : "";
    seen.set(tableId, next);
    calls.push(next);
    return next !== prev;
  };
  fn.calls = calls;
  fn.reset = () => { seen.clear(); calls.length = 0; };
  return fn;
}
const sellChanged = makeDetector();
const buyChanged = makeDetector();
globalThis.sellCityFilterChanged = sellChanged;
globalThis.buyCityFilterChanged = buyChanged;

let renders = 0;
globalThis.window = { renderFlippingTable: () => { renders++; } };

// ── Fake DOM: the two pickers plus an (unused) search box and tbody ──────────
const buySel = { value: "" };
const sellSel = { value: "" };
globalThis.document = {
  getElementById(id) {
    if (id === "buycityfilter-" + TABLE) return buySel;
    if (id === "sellcityfilter-" + TABLE) return sellSel;
    return null;
  },
  querySelector: () => null,
};

const { onFilterChange, repriceOnCityChange } = require("../js/table-search.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    buySel.value = "";
    sellSel.value = "";
    sellChanged.reset();
    buyChanged.reset();
    renders = 0;
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

console.log("Flipping re-renders when either City picker moves\n");

test("a sell pick re-renders the table", () => {
  sellSel.value = "Black Market";
  assert.strictEqual(repriceOnCityChange(TABLE), true);
  assert.strictEqual(renders, 1);
});

test("a buy pick re-renders the table (the second picker was dead)", () => {
  buySel.value = "Martlock";
  assert.strictEqual(repriceOnCityChange(TABLE), true);
  assert.strictEqual(renders, 1);
});

test("both pickers moving at once is still one render", () => {
  buySel.value = "Martlock";
  sellSel.value = "Black Market";
  assert.strictEqual(repriceOnCityChange(TABLE), true);
  assert.strictEqual(renders, 1);
});

test("an unmoved pair re-renders nothing", () => {
  assert.strictEqual(repriceOnCityChange(TABLE), false);
  assert.strictEqual(renders, 0);
});

test("clearing a pick back to All re-renders too", () => {
  sellSel.value = "Black Market";
  repriceOnCityChange(TABLE);
  renders = 0;
  sellSel.value = "";
  assert.strictEqual(repriceOnCityChange(TABLE), true, "Reset filters must redraw");
  assert.strictEqual(renders, 1);
});

test("both detectors run every pass, so neither side's memory goes stale", () => {
  // Sell moves first. If the sell branch short-circuited, the buy detector would
  // never see "Martlock" here — and would then read the NEXT pass as unchanged.
  buySel.value = "Martlock";
  sellSel.value = "Black Market";
  repriceOnCityChange(TABLE);
  assert.deepStrictEqual(sellChanged.calls, ["Black Market"]);
  assert.deepStrictEqual(buyChanged.calls, ["Martlock"]);
  renders = 0;
  assert.strictEqual(repriceOnCityChange(TABLE), false, "nothing moved on the second pass");
  assert.strictEqual(renders, 0);
});

test("a filter-only table never takes the re-price path", () => {
  sellSel.value = "Black Market";
  assert.strictEqual(repriceOnCityChange("mounts-table"), false);
  assert.strictEqual(renders, 0);
});

test("onFilterChange routes a Flipping city move to the re-render", () => {
  buySel.value = "Thetford";
  onFilterChange(TABLE);
  assert.strictEqual(renders, 1);
});

// ── with the app's async scheduler present ─────────────────────────────────
//
// The direct renderer call is one unbroken block (seconds, on the Crafting
// Planner), and the gesture that triggers it is a click on a <select> — so the
// picker the user is holding open is exactly what freezes. With a scheduler
// installed the pick asks for an async pass instead, which draws this table
// first and hands the thread back between slices.

test("a city pick asks the scheduler when one is installed", () => {
  const asked = [];
  globalThis.scheduleRerender = (reason, opts) => { asked.push({ reason, opts }); return true; };
  try {
    sellSel.value = "Black Market";
    assert.strictEqual(repriceOnCityChange(TABLE), true);
    assert.strictEqual(renders, 0, "the blocking renderer must not run");
    assert.strictEqual(asked.length, 1);
    assert.strictEqual(asked[0].reason, "city-pick");
    assert.strictEqual(asked[0].opts.priorityTableId, TABLE);
  } finally {
    delete globalThis.scheduleRerender;
  }
});

test("no pass coming (no data yet) falls back to the direct renderer", () => {
  globalThis.scheduleRerender = () => false;
  try {
    sellSel.value = "Black Market";
    assert.strictEqual(repriceOnCityChange(TABLE), true);
    assert.strictEqual(renders, 1, "the direct renderer is the fallback");
  } finally {
    delete globalThis.scheduleRerender;
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
