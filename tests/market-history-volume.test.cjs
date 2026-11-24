/**
 * Test: the captured market-history response becomes a LOCAL 24h volume.
 *
 * The monitor already decodes AuctionGetItemAverageStats — the in-game price
 * chart — and uploads it to AODP, but nothing fed it back into the app, so
 * every captured item showed Vol/24h 0 (see captured-prices-store.js). That
 * response carries the same traded amounts AODP builds `volume_24h` from, so
 * it can fill the column directly.
 *
 * Contract under test (js/market-history-volume.js):
 *   - MarketHistories points inside the last 24h are summed into volume_24h,
 *   - timestamps decode from .NET ticks, epoch ms or epoch seconds,
 *   - Timescale 0 (Hours) and 1 (Days) are usable; 2 (Weeks) is not — a
 *     four-week bucket cannot be cut down to a day without inventing data,
 *   - the numeric AlbionId is resolved through the items.txt index, with the
 *     request's enchantment folded into the id ("T4_BAG" + 2 → "T4_BAG@2"),
 *   - the result is a price-shaped patch carrying ONLY volume, so the existing
 *     merge path applies it without touching captured prices.
 *
 * Black-box: pure function, injected id lookup and clock. No DOM, no network.
 *
 * Run: node tests/market-history-volume.test.cjs
 */

const assert = require("assert");
const path = require("path");

const { historyToVolumePatch, decodeHistoryTimestamp } = require(
  path.join(__dirname, "..", "js", "market-history-volume.js"),
);

const NOW = Date.parse("2026-07-27T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const TICK_EPOCH_MS = 62135596800000; // 0001-01-01 → 1970-01-01
const ticks = (ms) => (ms + TICK_EPOCH_MS) * 10000;

// Stand-in for js/item-index.js: 2832 is T4_BAG in ao-bin-dumps items.txt.
const lookupId = (index) => ({ 2832: "T4_BAG", 1971: "T6_SHARD_AVALONIAN" }[index] || null);

function payload(over = {}) {
  return {
    AlbionId: 2832,
    LocationId: "1002", // Lymhurst market
    QualityLevel: 1,
    Timescale: 0,
    MarketHistories: [
      { ItemAmount: 10, SilverAmount: 1000000, Timestamp: ticks(NOW - 1 * HOUR) },
      { ItemAmount: 5, SilverAmount: 500000, Timestamp: ticks(NOW - 5 * HOUR) },
      { ItemAmount: 7, SilverAmount: 700000, Timestamp: ticks(NOW - 23 * HOUR) },
      { ItemAmount: 999, SilverAmount: 900000, Timestamp: ticks(NOW - 40 * HOUR) },
    ],
    ...over,
  };
}

const opts = (over = {}) => ({ now: NOW, lookupId, cityOf: (id) => ({ 1002: "Lymhurst" }[id] || null), ...over });

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Market history → local volume tests\n");

// ── the sum ──────────────────────────────────────────────────────────────
test("points inside the last 24h are summed; older ones are ignored", () => {
  const patch = historyToVolumePatch(payload(), opts());
  assert.strictEqual(patch.T4_BAG[1].Lymhurst.volume_24h, 22, "10 + 5 + 7, not the 40h-old 999");
});

test("the patch carries volume ONLY — no prices to clobber a capture", () => {
  const cell = historyToVolumePatch(payload(), opts()).T4_BAG[1].Lymhurst;
  assert.strictEqual(cell.sell_price, 0);
  assert.strictEqual(cell.buy_price, 0);
  assert.strictEqual(cell.sell_date, null);
  assert.strictEqual(cell.buy_date, null);
  assert.ok(cell.volume_date, "a volume needs its own timestamp to age against");
});

test("negative amounts follow the reference client's +256 rule", () => {
  const patch = historyToVolumePatch(
    payload({ MarketHistories: [
      { ItemAmount: -121, SilverAmount: 1, Timestamp: ticks(NOW - HOUR) },
      { ItemAmount: -200, SilverAmount: 1, Timestamp: ticks(NOW - HOUR) }, // below -124: dropped
    ] }),
    opts(),
  );
  assert.strictEqual(patch.T4_BAG[1].Lymhurst.volume_24h, 135, "256 - 121, and the -200 dropped");
});

test("no points inside the window yields no patch at all", () => {
  const patch = historyToVolumePatch(
    payload({ MarketHistories: [{ ItemAmount: 9, SilverAmount: 1, Timestamp: ticks(NOW - 5 * 24 * HOUR) }] }),
    opts(),
  );
  assert.deepStrictEqual(patch, {}, "an item with no recent trades must not be reported as 0 volume");
});

// ── timestamp formats ────────────────────────────────────────────────────
test("decodeHistoryTimestamp reads .NET ticks, epoch ms and epoch seconds", () => {
  assert.strictEqual(decodeHistoryTimestamp(ticks(NOW)), NOW, "ticks");
  assert.strictEqual(decodeHistoryTimestamp(NOW), NOW, "epoch ms");
  assert.strictEqual(decodeHistoryTimestamp(Math.floor(NOW / 1000)), NOW - (NOW % 1000), "epoch seconds");
  assert.strictEqual(decodeHistoryTimestamp(0), 0, "nothing usable");
  assert.strictEqual(decodeHistoryTimestamp("not a number"), 0);
});

test("an epoch-ms feed sums the same window", () => {
  const patch = historyToVolumePatch(
    payload({ MarketHistories: [
      { ItemAmount: 4, SilverAmount: 1, Timestamp: NOW - 2 * HOUR },
      { ItemAmount: 6, SilverAmount: 1, Timestamp: NOW - 30 * HOUR },
    ] }),
    opts(),
  );
  assert.strictEqual(patch.T4_BAG[1].Lymhurst.volume_24h, 4);
});

// ── timescale ────────────────────────────────────────────────────────────
test("Timescale 1 (Days) is usable", () => {
  const patch = historyToVolumePatch(payload({ Timescale: 1 }), opts());
  assert.strictEqual(patch.T4_BAG[1].Lymhurst.volume_24h, 22);
});

test("Timescale 2 (Weeks) is refused — a 4-week bucket is not a day", () => {
  assert.deepStrictEqual(historyToVolumePatch(payload({ Timescale: 2 }), opts()), {});
});

// ── id resolution ────────────────────────────────────────────────────────
test("the numeric AlbionId resolves through the items.txt index", () => {
  const patch = historyToVolumePatch(payload({ AlbionId: 1971 }), opts());
  assert.ok(patch.T6_SHARD_AVALONIAN, "1971 is T6_SHARD_AVALONIAN");
});

test("the request's enchantment is folded into the id", () => {
  const patch = historyToVolumePatch(payload(), opts({ enchant: 2 }));
  assert.ok(patch["T4_BAG@2"], "enchant 2 must read as T4_BAG@2");
  assert.strictEqual(patch.T4_BAG, undefined, "and not as the base id");
});

test("an id that already carries @n is not double-suffixed", () => {
  const patch = historyToVolumePatch(
    payload(),
    opts({ enchant: 2, lookupId: () => "T4_BAG@3" }),
  );
  assert.ok(patch["T4_BAG@3"], "the index's own enchant wins");
});

test("an unknown index yields no patch", () => {
  assert.deepStrictEqual(historyToVolumePatch(payload({ AlbionId: 999999 }), opts()), {});
});

test("a location the app does not price yields no patch", () => {
  assert.deepStrictEqual(historyToVolumePatch(payload({ LocationId: "0000" }), opts()), {});
});

// ── quality ──────────────────────────────────────────────────────────────
test("quality is preserved, and quality 0 (all) lands on 1", () => {
  const q3 = historyToVolumePatch(payload({ QualityLevel: 3 }), opts());
  assert.strictEqual(q3.T4_BAG[3].Lymhurst.volume_24h, 22);
  const q0 = historyToVolumePatch(payload({ QualityLevel: 0 }), opts());
  assert.strictEqual(q0.T4_BAG[1].Lymhurst.volume_24h, 22, "the aggregate view feeds the normal-quality map");
});

// ── junk in ──────────────────────────────────────────────────────────────
test("a payload with no histories, or no payload at all, yields no patch", () => {
  assert.deepStrictEqual(historyToVolumePatch(payload({ MarketHistories: [] }), opts()), {});
  assert.deepStrictEqual(historyToVolumePatch(null, opts()), {});
  assert.deepStrictEqual(historyToVolumePatch(payload({ MarketHistories: null }), opts()), {});
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
