/**
 * Test: an AODP scan must not delete a price it simply has no data for.
 *
 * Bug: applyScanPatch / applyQualityScanPatch started with
 * `Object.assign(target, data)`, which replaces a whole ITEM. AODP answers with
 * a cell for every requested (item, city) pair, and a city with no order book
 * comes back as `sell_price: 0, buy_price: 0, sell_date: null`. So re-scanning
 * an item whose book has since emptied replaced a perfectly usable older
 * reading with "no data" — and persistScanPrices() then wrote that loss to
 * scan-prices.json, where nothing could get it back.
 *
 * The capture side has had the right rule for a while: a zero side means "not
 * observed", never "gone" (mergeEntry in js/market-price-store.js). A scan
 * patch now folds the same way.
 *
 * Contract under test (js/captured-prices-store.js):
 *   - a zero side in the patch keeps the stored price AND its date,
 *   - a live side replaces, taking its own date with it,
 *   - a city or an item the patch does not carry survives untouched,
 *   - volume_24h is inherited when the patch measures none,
 *   - used_fallback stays true while a history-derived side is still standing,
 *   - a capture still wins wherever it is fresher than the scan.
 *
 * Black-box: pure functions, fixed clock, no DOM, no live API.
 *
 * Run: node tests/scan-patch-preserves-prices.test.cjs
 */

const assert = require("assert");
const path = require("path");

const S = require(path.join(__dirname, "..", "js", "captured-prices-store.js"));

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const NOW = Date.parse("2026-08-26T12:00:00.000Z");
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

/** One price cell in the shape both the scan and the fold speak. */
function cell({ sell = 0, buy = 0, sellAge = 0, buyAge = 0, vol = 0, fallback = false } = {}) {
  return {
    sell_price: sell,
    buy_price: buy,
    sell_date: sell ? iso(sellAge) : null,
    buy_date: buy ? iso(buyAge) : null,
    volume_24h: vol,
    used_fallback: fallback,
  };
}

/** What AODP hands back for a city it has nothing on. */
const NO_DATA = () => cell({});

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL ${name}\n       ${e.message}`);
  }
}

// The module keeps a session capture map; every case below starts from empty so
// only the case that asks for a capture sees one.
function fresh() {
  S.resetCapturedPrices();
}

/** Record a capture without letting the store reach any storage backend. */
function capture(map) {
  S.recordCapturedPrices(map, { saveDelayMs: 0, bridge: null, storage: null });
}

// ── the flat map ────────────────────────────────────────────────────────────
console.log("applyScanPatch: a zero is not a deletion");

[
  {
    name: "an all-zero patch cell keeps both stored sides and their dates",
    stored: cell({ sell: 1000, buy: 900, sellAge: 3 * HOUR, buyAge: 4 * HOUR }),
    patch: NO_DATA(),
    want: { sell_price: 1000, buy_price: 900, sell_date: iso(3 * HOUR), buy_date: iso(4 * HOUR) },
  },
  {
    name: "a live ask with no bid replaces the ask and keeps the stored bid",
    stored: cell({ sell: 1000, buy: 900, sellAge: 3 * HOUR, buyAge: 4 * HOUR }),
    patch: cell({ sell: 1200 }),
    want: { sell_price: 1200, buy_price: 900, sell_date: iso(0), buy_date: iso(4 * HOUR) },
  },
  {
    name: "a live bid with no ask replaces the bid and keeps the stored ask",
    stored: cell({ sell: 1000, buy: 900, sellAge: 3 * HOUR, buyAge: 4 * HOUR }),
    patch: cell({ buy: 950 }),
    want: { sell_price: 1000, buy_price: 950, sell_date: iso(3 * HOUR), buy_date: iso(0) },
  },
  {
    name: "two live sides replace both, dates and all",
    stored: cell({ sell: 1000, buy: 900, sellAge: 3 * HOUR, buyAge: 4 * HOUR }),
    patch: cell({ sell: 1200, buy: 1100 }),
    want: { sell_price: 1200, buy_price: 1100, sell_date: iso(0), buy_date: iso(0) },
  },
  {
    name: "a dearer ask read hours later still wins — the cheap one is gone",
    stored: cell({ sell: 800, sellAge: 5 * HOUR }),
    patch: cell({ sell: 3000 }),
    want: { sell_price: 3000, sell_date: iso(0) },
  },
  {
    name: "a dearer ask inside one minute is a later PAGE, not a new price",
    stored: cell({ sell: 800, sellAge: 30 * 1000 }),
    patch: cell({ sell: 3000 }),
    want: { sell_price: 800, sell_date: iso(30 * 1000) },
  },
  {
    name: "an unmeasured volume never wipes the one already stored",
    stored: cell({ sell: 1000, sellAge: 3 * HOUR, vol: 42 }),
    patch: cell({ sell: 1200 }),
    want: { sell_price: 1200, volume_24h: 42 },
  },
  {
    name: "a measured volume replaces the stored one",
    stored: cell({ sell: 1000, sellAge: 3 * HOUR, vol: 42 }),
    patch: cell({ sell: 1200, vol: 77 }),
    want: { sell_price: 1200, volume_24h: 77 },
  },
  {
    name: "a fallback price kept through a zero patch is still flagged a fallback",
    stored: cell({ sell: 1000, buy: 950, fallback: true }),
    patch: NO_DATA(),
    want: { sell_price: 1000, buy_price: 950, used_fallback: true },
  },
  {
    name: "both sides replaced by live prices clears the fallback flag",
    stored: cell({ sell: 1000, buy: 950, sellAge: 3 * HOUR, buyAge: 3 * HOUR, fallback: true }),
    patch: cell({ sell: 1200, buy: 1100 }),
    want: { sell_price: 1200, buy_price: 1100, used_fallback: false },
  },
].forEach(({ name, stored, patch, want }) => {
  test(name, () => {
    fresh();
    const target = { T4_BAG: { Caerleon: stored } };
    S.applyScanPatch(target, { T4_BAG: { Caerleon: patch } });
    const got = target.T4_BAG.Caerleon;
    Object.keys(want).forEach((k) => {
      assert.strictEqual(got[k], want[k], `${k}: got ${got[k]}, want ${want[k]}`);
    });
  });
});

test("a city the patch does not carry survives the scan", () => {
  fresh();
  const target = {
    T4_BAG: {
      Caerleon: cell({ sell: 1000, sellAge: 3 * HOUR }),
      Martlock: cell({ sell: 1500, buy: 1400, sellAge: 2 * HOUR }),
    },
  };
  S.applyScanPatch(target, { T4_BAG: { Caerleon: cell({ sell: 1100 }) } });
  assert.strictEqual(target.T4_BAG.Caerleon.sell_price, 1100);
  assert.strictEqual(target.T4_BAG.Martlock.sell_price, 1500);
  assert.strictEqual(target.T4_BAG.Martlock.buy_price, 1400);
  assert.strictEqual(target.T4_BAG.Martlock.sell_date, iso(2 * HOUR));
});

test("an item the patch does not carry survives the scan", () => {
  fresh();
  const target = {
    T4_BAG: { Caerleon: cell({ sell: 1000 }) },
    "T5_2H_AXE@2": { Martlock: cell({ sell: 90000, buy: 80000 }) },
  };
  S.applyScanPatch(target, { T4_BAG: { Caerleon: cell({ sell: 1100 }) } });
  assert.strictEqual(target["T5_2H_AXE@2"].Martlock.sell_price, 90000);
  assert.strictEqual(target["T5_2H_AXE@2"].Martlock.buy_price, 80000);
});

test("an item the target has never seen is added whole", () => {
  fresh();
  const target = {};
  S.applyScanPatch(target, { T4_BAG: { Caerleon: cell({ sell: 1100, buy: 1000 }) } });
  assert.strictEqual(target.T4_BAG.Caerleon.sell_price, 1100);
  assert.strictEqual(target.T4_BAG.Caerleon.buy_price, 1000);
});

test("an empty patch changes nothing", () => {
  fresh();
  const target = { T4_BAG: { Caerleon: cell({ sell: 1000, buy: 900 }) } };
  const before = JSON.parse(JSON.stringify(target));
  S.applyScanPatch(target, {});
  assert.deepStrictEqual(target, before);
});

// ── captures still win where they are fresher ───────────────────────────────
console.log("\napplyScanPatch: the capture fold still stands");

test("a capture newer than the scan survives the scan", () => {
  fresh();
  capture({ T4_BAG: { 1: { Caerleon: { ...cell({ sell: 1234, sellAge: 1 * MIN }), from_sniffer: true } } } });
  const target = { T4_BAG: { Caerleon: cell({ sell: 1000, sellAge: 5 * HOUR }) } };
  S.applyScanPatch(target, { T4_BAG: { Caerleon: cell({ sell: 9999, sellAge: 2 * HOUR }) } });
  assert.strictEqual(target.T4_BAG.Caerleon.sell_price, 1234, "the fresher capture wins");
  fresh();
});

test("a scan newer than the capture wins", () => {
  fresh();
  capture({ T4_BAG: { 1: { Caerleon: { ...cell({ sell: 1234, sellAge: 6 * HOUR }), from_sniffer: true } } } });
  const target = { T4_BAG: { Caerleon: cell({ sell: 1000, sellAge: 7 * HOUR }) } };
  S.applyScanPatch(target, { T4_BAG: { Caerleon: cell({ sell: 9999 }) } });
  assert.strictEqual(target.T4_BAG.Caerleon.sell_price, 9999);
  fresh();
});

test("a zero scan cell falls back to the capture, not to no-data", () => {
  fresh();
  capture({ T4_BAG: { 1: { Caerleon: { ...cell({ sell: 1234, sellAge: 2 * HOUR }), from_sniffer: true } } } });
  const target = { T4_BAG: { Caerleon: cell({ sell: 1000, sellAge: 5 * HOUR }) } };
  S.applyScanPatch(target, { T4_BAG: { Caerleon: NO_DATA() } });
  assert.strictEqual(target.T4_BAG.Caerleon.sell_price, 1234);
  fresh();
});

// ── the quality map ─────────────────────────────────────────────────────────
console.log("\napplyQualityScanPatch: the same rule, one level deeper");

test("a zero cell keeps the stored price at that quality", () => {
  fresh();
  const target = { T5_2H_AXE: { 1: { Caerleon: cell({ sell: 50000, buy: 45000, sellAge: 3 * HOUR }) } } };
  S.applyQualityScanPatch(target, { T5_2H_AXE: { 1: { Caerleon: NO_DATA() } } });
  assert.strictEqual(target.T5_2H_AXE[1].Caerleon.sell_price, 50000);
  assert.strictEqual(target.T5_2H_AXE[1].Caerleon.buy_price, 45000);
  assert.strictEqual(target.T5_2H_AXE[1].Caerleon.sell_date, iso(3 * HOUR));
});

test("a quality the patch does not carry survives", () => {
  fresh();
  const target = {
    T5_2H_AXE: {
      1: { Caerleon: cell({ sell: 50000, sellAge: 3 * HOUR }) },
      4: { Caerleon: cell({ sell: 250000, buy: 240000 }) },
    },
  };
  S.applyQualityScanPatch(target, { T5_2H_AXE: { 1: { Caerleon: cell({ sell: 51000 }) } } });
  assert.strictEqual(target.T5_2H_AXE[1].Caerleon.sell_price, 51000);
  assert.strictEqual(target.T5_2H_AXE[4].Caerleon.sell_price, 250000);
  assert.strictEqual(target.T5_2H_AXE[4].Caerleon.buy_price, 240000);
});

test("a live side at one quality does not touch another quality's cell", () => {
  fresh();
  const target = {
    T5_2H_AXE: {
      1: { Caerleon: cell({ sell: 50000, buy: 45000, sellAge: 3 * HOUR }) },
      5: { Martlock: cell({ sell: 900000, buy: 850000, buyAge: 8 * HOUR }) },
    },
  };
  S.applyQualityScanPatch(target, {
    T5_2H_AXE: { 1: { Caerleon: cell({ sell: 60000 }) }, 5: { Martlock: NO_DATA() } },
  });
  assert.strictEqual(target.T5_2H_AXE[1].Caerleon.sell_price, 60000);
  assert.strictEqual(target.T5_2H_AXE[1].Caerleon.buy_price, 45000);
  assert.strictEqual(target.T5_2H_AXE[5].Martlock.sell_price, 900000);
  assert.strictEqual(target.T5_2H_AXE[5].Martlock.buy_price, 850000);
  assert.strictEqual(target.T5_2H_AXE[5].Martlock.buy_date, iso(8 * HOUR));
});

test("a fresher capture still wins in the quality map", () => {
  fresh();
  capture({ T5_2H_AXE: { 4: { Caerleon: { ...cell({ sell: 111111, sellAge: 1 * MIN }), from_sniffer: true } } } });
  const target = { T5_2H_AXE: { 4: { Caerleon: cell({ sell: 250000, sellAge: 9 * HOUR }) } } };
  S.applyQualityScanPatch(target, { T5_2H_AXE: { 4: { Caerleon: cell({ sell: 300000, sellAge: 2 * HOUR }) } } });
  assert.strictEqual(target.T5_2H_AXE[4].Caerleon.sell_price, 111111);
  fresh();
});

console.log(failures === 0
  ? "\nAll scan-patch preservation tests passed."
  : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
