/**
 * Test: moving the Volume table's City picker re-renders the table.
 *
 * The pick is honoured inside the row builder (js/render-volume.js reads
 * getTableSellCity), so a pick that does not trigger a rebuild changes nothing
 * on screen. Two things used to break that chain:
 *
 *   1. repriceOnCityChange read `sellcityfilter-<table>`. The Volume table
 *      carries the COMBINED picker `cityfilter-<table>` instead - its rows name
 *      one market, not a buy->sell route - so the detector found no element,
 *      read "" forever and never fired.
 *   2. the Volume picker's change callback called updateTableDisplay directly,
 *      which re-filters the rows already built and can never re-price them.
 *
 * Black-box over the real js/table-search.js internals with a fake DOM and
 * stubbed globals. No live DOM, no network.
 *
 * Run: node tests/volume-city-pick-rerender.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const TABLE = "volume-table";

// ── Stub the globals table-search.js reaches for by bare identifier ──────────
const REPRICING = new Set([TABLE, "flipping-table"]);
globalThis.tableRepricesOnCityPick = (id) => REPRICING.has(id);
globalThis.TABLE_RENDERERS = { [TABLE]: "renderVolumeTable" };
globalThis.lastMarketData = { T4_CAPEITEM_FW_LYMHURST: {} };

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
globalThis.window = { renderVolumeTable: () => { renders++; } };

// ── Fake DOM: the combined picker only. The split buy/sell ids do NOT exist on
// this table, which is exactly what the old detector tripped over.
const citySel = { value: "" };
const strayBuy = { value: "Martlock" };
const straySell = { value: "Thetford" };
globalThis.document = {
  getElementById(id) {
    if (id === "cityfilter-" + TABLE) return citySel;
    // Present only so a wrong read would be VISIBLE as a bogus pick, never as a
    // silent null. The real page renders neither for this table.
    if (id === "buycityfilter-" + TABLE) return strayBuy;
    if (id === "sellcityfilter-" + TABLE) return straySell;
    return null;
  },
  querySelector: () => null,
};

const { repriceOnCityChange } = require("../js/table-search.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    citySel.value = "";
    sellChanged.reset();
    buyChanged.reset();
    renders = 0;
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} - ${e.message}`);
    failed++;
  }
}

console.log("Volume re-renders when its combined City picker moves\n");

test("a city pick re-renders the table", () => {
  citySel.value = "Black Market";
  assert.strictEqual(repriceOnCityChange(TABLE), true);
  assert.strictEqual(renders, 1);
});

test("the detector reads the COMBINED picker, not the split ids", () => {
  citySel.value = "Black Market";
  repriceOnCityChange(TABLE);
  assert.deepStrictEqual(sellChanged.calls, ["Black Market"]);
  assert.deepStrictEqual(buyChanged.calls, [""],
    "this table has no buy leg, so the buy detector must record 'All'");
});

test("an unmoved picker re-renders nothing", () => {
  citySel.value = "Black Market";
  repriceOnCityChange(TABLE);
  renders = 0;
  assert.strictEqual(repriceOnCityChange(TABLE), false);
  assert.strictEqual(renders, 0);
});

test("clearing the pick back to All re-renders too", () => {
  citySel.value = "Black Market";
  repriceOnCityChange(TABLE);
  renders = 0;
  citySel.value = "";
  assert.strictEqual(repriceOnCityChange(TABLE), true, "Reset filters must redraw");
  assert.strictEqual(renders, 1);
});

test("a city pick asks the scheduler when one is installed", () => {
  const asked = [];
  globalThis.scheduleRerender = (reason, opts) => { asked.push({ reason, opts }); return true; };
  try {
    citySel.value = "Lymhurst";
    assert.strictEqual(repriceOnCityChange(TABLE), true);
    assert.strictEqual(renders, 0, "the blocking renderer must not run");
    assert.strictEqual(asked.length, 1);
    assert.strictEqual(asked[0].reason, "city-pick");
    assert.strictEqual(asked[0].opts.priorityTableId, TABLE);
  } finally {
    delete globalThis.scheduleRerender;
  }
});

// ── The wiring, pinned at the source level (it lives inside wireSearchBoxes,
// which needs a whole page to run).
const src = fs.readFileSync(
  path.join(__dirname, "..", "js", "table-search.js"),
  "utf8",
);

function volumeWiringBlock(text) {
  const marker = 'injectFilterControls("volume-table"';
  const start = text.indexOf(marker);
  assert.ok(start >= 0, "the volume picker wiring must exist");
  return text.slice(start, text.indexOf("});", start) + 3);
}

test("the Volume picker callback goes through repriceOnCityChange first", () => {
  const block = volumeWiringBlock(src);
  assert.ok(
    /repriceOnCityChange\("volume-table"\)/.test(block),
    "a city move must rebuild the rows, not re-filter the ones on screen",
  );
  assert.ok(
    block.indexOf("repriceOnCityChange") < block.indexOf("updateTableDisplay"),
    "the cheap object-filter pass is the FALLBACK, taken only when no city moved",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
