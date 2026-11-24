/**
 * The Black Market board's scan set.
 *
 * The board is derived: it re-ranks rows the twelve feeder tables already
 * computed (js/render-bm-board.js), so unlike every other scan button it owns no
 * catalog to fetch. Its button re-reads exactly the ids the Black Market is
 * known to quote — the bids the board leans on and that go quietly stale — and
 * then redraws only the feeders those ids can move.
 *
 * Three things are load-bearing and pinned here:
 *   - a Black Market quote living only at quality 2-5 must reach the QUALITY
 *     fetch, not the flat one. A real bid quoted at q1-3 only is documented in
 *     js/flip-route-quality.js; fetched flat it would come back empty and the
 *     row would vanish from the board it belongs on.
 *   - a board row's BUY leg is fetched too. It is priced in a city, so it has no
 *     Black Market entry of its own and the quote sweep alone would never see
 *     it — leaving Input Cost frozen while the bid beside it refreshed.
 *   - an absent source map redraws ALL twelve feeders. Degrading to "redraw
 *     nothing" would leave the board projecting over stale caches with no sign
 *     anything was wrong.
 *
 * Black box over js/bm-board-scan.js. No DOM, no live API, no globals.
 *
 * Run: node tests/bm-board-scan.test.cjs
 */

const assert = require("assert");
const path = require("path");

const S = require(path.join(__dirname, "..", "js", "bm-board-scan.js"));
const { getBlackMarketScanIds, bmScanFeederTables, BM_SCAN_FEEDERS } = S;

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    if (process.env.VERBOSE) console.error(e.stack);
    failed++;
  }
}

/** A flat-map entry, shaped like what fetchPricesBatch returns. */
const entry = (buy = 1000) => ({ buy_price: buy, sell_price: 0, buy_date: "2026-08-23T10:00:00" });

/**
 * What AODP hands back for the Black Market on almost every id: the bucket
 * exists, the book behind it does not. Measured on a real saved scan, 9,674 of
 * 9,738 ids carried one of these — so "has a Black Market key" is not a quote.
 */
const emptyBook = () => ({
  buy_price: 0, sell_price: 0, sell_date: null, buy_date: null,
  volume_24h: 0, used_fallback: false,
});

console.log("\n=== which ids a Black Market scan re-reads ===");

// Nothing stored yet is the cold start the button falls back to a full scan on.
// It has to be an empty ANSWER, not a throw: the caller reads `.ids.length`.
[
  ["everything null", { flat: null, quality: null, rows: null }],
  ["everything empty", { flat: {}, quality: {}, rows: [] }],
  ["no argument at all", undefined],
  ["undefined members", { flat: undefined, quality: undefined, rows: undefined }],
].forEach(([label, input]) => {
  test(`nothing stored (${label}) → nothing to scan`, () => {
    assert.deepStrictEqual(getBlackMarketScanIds(input), { ids: [], qualityIds: [] });
  });
});

// The sweep is a Black Market sweep. Every other city's book is refreshed by
// that city's own table, and pulling them in here would rebuild the full scan.
test("a price in another city is not a Black Market id", () => {
  const out = getBlackMarketScanIds({
    flat: {
      T8_BAG: { Caerleon: entry(), Martlock: entry() },
      T8_CAPE: { "Black Market": entry() },
    },
  });
  assert.deepStrictEqual(out.ids, ["T8_CAPE"]);
});

// The bucket AODP returns for an item the Black Market has never bid on. Reading
// it as a quote turned a targeted scan back into the full one it exists to avoid.
test("an all-zero Black Market bucket is not a quote", () => {
  const out = getBlackMarketScanIds({
    flat: { T5_METALBAR: { "Black Market": emptyBook() }, T8_CAPE: { "Black Market": entry() } },
  });
  assert.deepStrictEqual(out.ids, ["T8_CAPE"]);
});

// A bid with no ask is the NORMAL Black Market shape: its book is one-way, so
// sell_price is often 0 on an item that is very much quoted.
test("a bid with no ask still counts", () => {
  const out = getBlackMarketScanIds({
    flat: { T8_CAPE: { "Black Market": { buy_price: 250000, sell_price: 0 } } },
  });
  assert.deepStrictEqual(out.ids, ["T8_CAPE"]);
});

test("an ask with no bid counts too", () => {
  const out = getBlackMarketScanIds({
    flat: { T8_CAPE: { "Black Market": { buy_price: 0, sell_price: 940000 } } },
  });
  assert.deepStrictEqual(out.ids, ["T8_CAPE"]);
});

// An empty book that was READ carries a seen stamp (js/price-freshness.js). It
// is still an empty book — nothing to re-read on a board of profitable plays.
test("a read-but-empty book is not a quote either", () => {
  const out = getBlackMarketScanIds({
    flat: { T8_CAPE: { "Black Market": { ...emptyBook(), buy_seen: "2026-08-22T13:27:43.478Z" } } },
  });
  assert.deepStrictEqual(out.ids, []);
});

test("an all-zero quality book is not a quote", () => {
  const out = getBlackMarketScanIds({
    quality: { T8_SWORD: { 3: { "Black Market": emptyBook() } } },
  });
  assert.deepStrictEqual(out, { ids: [], qualityIds: [] });
});

test("a flat Black Market quote is fetched flat, never per-quality", () => {
  const out = getBlackMarketScanIds({ flat: { T8_CAPE: { "Black Market": entry() } } });
  assert.deepStrictEqual(out.ids, ["T8_CAPE"]);
  assert.deepStrictEqual(out.qualityIds, []);
});

// quality[id][1] is the Normal book — the same number the flat map holds. It
// still needs the id fetched; it does not need the five-quality request.
test("a quality-1 Black Market quote does not pull in the quality fetch", () => {
  const out = getBlackMarketScanIds({
    quality: { T8_2H_WILDSTAFF: { 1: { "Black Market": entry() } } },
  });
  assert.deepStrictEqual(out.ids, ["T8_2H_WILDSTAFF"]);
  assert.deepStrictEqual(out.qualityIds, []);
});

test("a Black Market quote above Normal is fetched both ways", () => {
  const out = getBlackMarketScanIds({
    quality: { T8_2H_WILDSTAFF: { 3: { "Black Market": entry() } } },
  });
  assert.deepStrictEqual(out.ids, ["T8_2H_WILDSTAFF"]);
  assert.deepStrictEqual(out.qualityIds, ["T8_2H_WILDSTAFF"]);
});

test("a quality book with no Black Market column contributes nothing", () => {
  const out = getBlackMarketScanIds({
    quality: { T8_SWORD: { 4: { Caerleon: entry(), Thetford: entry() } } },
  });
  assert.deepStrictEqual(out, { ids: [], qualityIds: [] });
});

console.log("\n=== the rows already on the board ===");

test("a board row contributes BOTH legs — the bid and what it cost to get there", () => {
  const out = getBlackMarketScanIds({
    rows: [{ sellItemId: "T8_CAPE", buyItemId: "T8_CLOTH" }],
  });
  assert.deepStrictEqual(out.ids.sort(), ["T8_CAPE", "T8_CLOTH"]);
});

test("a board row priced above Normal adds its own quality fetch", () => {
  const out = getBlackMarketScanIds({
    rows: [{ sellItemId: "T8_2H_WILDSTAFF", sellQuality: 4 }],
  });
  assert.deepStrictEqual(out.qualityIds, ["T8_2H_WILDSTAFF"]);
});

test("a board row at Normal quality does not", () => {
  const out = getBlackMarketScanIds({
    rows: [{ sellItemId: "T8_CAPE", sellQuality: 1 }, { sellItemId: "T8_BAG" }],
  });
  assert.deepStrictEqual(out.qualityIds, []);
});

// The buy leg is a city price. Whatever quality the SELL leg is read at, the
// input is not quality-keyed, so it must never ride the five-quality request.
test("the buy leg never joins the quality fetch", () => {
  const out = getBlackMarketScanIds({
    rows: [{ sellItemId: "T8_CAPE", sellQuality: 5, buyItemId: "T8_CLOTH" }],
  });
  assert.deepStrictEqual(out.qualityIds, ["T8_CAPE"]);
});

test("a row with no ids at all is skipped rather than fetched as blank", () => {
  const out = getBlackMarketScanIds({
    rows: [{ sellItemId: null, buyItemId: "" }, { sellItemId: "T8_CAPE" }],
  });
  assert.deepStrictEqual(out.ids, ["T8_CAPE"]);
});

test("an id reachable three ways is fetched once", () => {
  const out = getBlackMarketScanIds({
    flat: { T8_CAPE: { "Black Market": entry() } },
    quality: { T8_CAPE: { 3: { "Black Market": entry() } } },
    rows: [{ sellItemId: "T8_CAPE", sellQuality: 3, buyItemId: "T8_CAPE" }],
  });
  assert.deepStrictEqual(out.ids, ["T8_CAPE"]);
  assert.deepStrictEqual(out.qualityIds, ["T8_CAPE"]);
});

console.log("\n=== which feeders have to be redrawn ===");

const SOURCES = {
  "flipping-table": ["T8_CAPE", "T8_BAG"],
  "crafting-table": ["T8_CAPE", "T8_CLOTH"],
  "mounts-table": ["T8_MOUNT_HORSE"],
  "farming-table": ["T8_FARM_COW"],
};

test("only the feeders whose catalog holds a scanned id", () => {
  assert.deepStrictEqual(
    bmScanFeederTables(["T8_BAG"], SOURCES),
    ["flipping-table"],
  );
});

test("one id in two catalogs redraws both", () => {
  assert.deepStrictEqual(
    bmScanFeederTables(["T8_CAPE"], SOURCES).sort(),
    ["crafting-table", "flipping-table"],
  );
});

test("the answer is in the app's feeder order, not the caller's id order", () => {
  const order = BM_SCAN_FEEDERS.filter((id) => SOURCES[id]);
  assert.deepStrictEqual(
    bmScanFeederTables(["T8_FARM_COW", "T8_MOUNT_HORSE", "T8_BAG", "T8_CLOTH"], SOURCES),
    order,
  );
});

test("a table listed in sources but untouched by the scan is left alone", () => {
  assert.ok(!bmScanFeederTables(["T8_BAG"], SOURCES).includes("farming-table"));
});

// A catalog function that threw, or a script that had not loaded yet, used to be
// indistinguishable from "this feeder has nothing to do".
[
  ["no source map", undefined],
  ["an empty source map", {}],
  ["a null source map", null],
].forEach(([label, sources]) => {
  test(`${label} redraws every feeder rather than none`, () => {
    assert.deepStrictEqual(bmScanFeederTables(["T8_CAPE"], sources), BM_SCAN_FEEDERS);
  });
});

test("no ids to scan is no feeder to redraw", () => {
  assert.deepStrictEqual(bmScanFeederTables([], SOURCES), []);
});

// Kept in step with JOINED_SUMMARY_SOURCES (js/render-gating.js) — a feeder
// missing here is a Black Market row that silently never refreshes.
test("the feeder list is the board's twelve sources", () => {
  const gating = require(path.join(__dirname, "..", "js", "render-gating.js"));
  assert.deepStrictEqual([...BM_SCAN_FEEDERS].sort(), [...gating.JOINED_SUMMARY_SOURCES].sort());
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
