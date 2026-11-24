/**
 * Test: a price INVENTED from AODP's 24h history never beats a real one.
 *
 * Reported on the Consumables Caerleon row: "Avalonian Energy @ no data", while
 * the price editor listed Caerleon at 712,435. That number was not a listing:
 * AODP had no Caerleon ask, so mergeEntryWithHistory (js/api.js) invented one
 * from a troll-skewed 24h average (flag `used_fallback`). The cross-city clamp
 * only compared it with AODP's own live asks, of which there were fewer than
 * two, so it survived — and because its date was newer, it replaced the real
 * 8,400 ask the sniffer had captured in Caerleon. The IQR gate then rejected the
 * 712,435 and the row read "no data".
 *
 * Rules pinned here, black box:
 *   1. mergeEntryWithHistory marks WHICH side it invented (sell_fallback /
 *      buy_fallback); used_fallback stays their OR.
 *   2. guardInventedPrices zeroes an invented side outside [ref ÷ 3, ref × 3] of
 *      the median of the REAL prices other cities already hold (AODP live and
 *      sniffer alike). A cell from before the per-side flags (used_fallback with
 *      neither side flag) counts as invented on both sides. Real sides are never
 *      touched; the Black Market is neither judged nor a reference. Caerleon
 *      joined that exemption (plan-caerleon-exempt.md), so the invented-cell
 *      rule pins on Bridgewatch and Caerleon gets its own twin case.
 *   3. A fold never lets an invented side replace a real stored side, whatever
 *      the dates say (mergeEntry, capFoldOntoTarget).
 *   4. applyScanPatch, end to end: the captured 8,400 is what the table reads.
 *
 * Run: node tests/invented-price-guard.test.cjs
 */

const assert = require("assert");

const { mergeEntryWithHistory, clampFallbackOutliers } = require("../js/api.js");
const { mergeEntry, isInventedSide } = require("../js/market-price-store.js");
const { guardInventedPrices, guardInventedPriceMap } = require("../js/invented-price-guard.js");
const CAP = require("../js/captured-prices-store.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

const real = (buy, sell, extra = {}) => ({
  buy_price: buy, sell_price: sell, buy_date: "2026-09-11T06:00:00", sell_date: "2026-09-11T06:00:00",
  volume_24h: 1000, used_fallback: false, sell_fallback: false, buy_fallback: false, ...extra,
});

console.log("=== 1. mergeEntryWithHistory flags the invented side ===");

const hist = (avg) => ({ data: [{ timestamp: "2026-09-11T03:00:00", avg_price: avg, item_count: 50 }] });
[
  ["ask missing → sell invented", { buy_price_max: 6870, sell_price_min: 0, buy_price_max_date: "2026-09-09T00:00:00" }, hist(678510), { sell: true, buy: false }],
  ["bid missing → buy invented", { buy_price_max: 0, sell_price_min: 7000, sell_price_min_date: "2026-09-11T03:25:00" }, hist(6900), { sell: false, buy: true }],
  ["both live → nothing invented", { buy_price_max: 6000, sell_price_min: 7000 }, hist(6500), { sell: false, buy: false }],
  ["both empty → nothing invented", { buy_price_max: 0, sell_price_min: 0 }, hist(6500), { sell: false, buy: false }],
].forEach(([name, entry, h, want]) => {
  test(name, () => {
    const out = mergeEntryWithHistory(entry, h);
    assert.strictEqual(out.sell_fallback, want.sell);
    assert.strictEqual(out.buy_fallback, want.buy);
    assert.strictEqual(out.used_fallback, want.sell || want.buy);
  });
});

test("clampFallbackOutliers clears the flag of the side it zeroes", () => {
  const map = {
    Bridgewatch: { ...real(6870, 712435), used_fallback: true, sell_fallback: true },
    Lymhurst: real(6600, 6938),
    Martlock: real(6087, 6680),
  };
  clampFallbackOutliers(map, {
    Bridgewatch: { bid: 6870, ask: 0 }, Lymhurst: { bid: 6600, ask: 6938 }, Martlock: { bid: 6087, ask: 6680 },
  });
  assert.strictEqual(map.Bridgewatch.sell_price, 0);
  assert.strictEqual(map.Bridgewatch.sell_fallback, false);
  assert.strictEqual(map.Bridgewatch.used_fallback, false);
  assert.strictEqual(map.Bridgewatch.buy_price, 6870, "the live bid is untouched");
});

console.log("\n=== isInventedSide ===");
[
  [{ sell_price: 5, sell_fallback: true }, "sell", true],
  [{ sell_price: 5, sell_fallback: false, used_fallback: true, buy_fallback: true }, "sell", false],
  [{ sell_price: 5, used_fallback: true }, "sell", true],   // legacy: either side may be it
  [{ sell_price: 5, used_fallback: true }, "buy", true],
  [{ sell_price: 5, used_fallback: false }, "sell", false],
  [{ sell_price: 5 }, "sell", false],
  [null, "sell", false],
].forEach(([entry, side, want]) => {
  test(`isInventedSide(${JSON.stringify(entry)}, ${side}) = ${want}`, () => {
    assert.strictEqual(isInventedSide(entry, side), want);
  });
});

console.log("\n=== 2. guardInventedPrices against the real prices other cities hold ===");

const ROYALS = () => ({
  Brecilien: real(6240, 6300),
  Bridgewatch: real(6590, 7029),
  "Fort Sterling": real(6465, 7186),
  Lymhurst: real(6608, 6938),
  Martlock: real(6087, 6680),
  Thetford: real(6621, 6989),
});

[
  ["the reported cell shape, on a royal city: invented 712,435 ask", { ...real(6870, 712435), used_fallback: true, sell_fallback: true }, 0, 6870],
  ["a legacy cell with no side flags", { ...real(6870, 712435), used_fallback: true, sell_fallback: undefined, buy_fallback: undefined }, 0, 6870],
  ["an invented ask inside the band survives", { ...real(6870, 8000), used_fallback: true, sell_fallback: true }, 8000, 6870],
  ["an invented ask far BELOW the band goes too", { ...real(6870, 900), used_fallback: true, sell_fallback: true }, 0, 6870],
  ["a REAL 712,435 ask is never touched (the IQR gate's job)", real(6870, 712435), 712435, 6870],
].forEach(([name, cell, sell, buy]) => {
  test(name, () => {
    // Bridgewatch overrides its ROYALS entry: five references remain, and the
    // victim is a royal the guard still judges (Caerleon is exempt now).
    const map = { ...ROYALS(), Bridgewatch: { ...cell } };
    guardInventedPrices(map);
    assert.strictEqual(map.Bridgewatch.sell_price, sell);
    assert.strictEqual(map.Bridgewatch.buy_price, buy);
  });
});

test("fewer than two real references → nothing is judged", () => {
  const map = { Lymhurst: real(6600, 6938), Bridgewatch: { ...real(6870, 712435), used_fallback: true, sell_fallback: true } };
  guardInventedPrices(map);
  assert.strictEqual(map.Bridgewatch.sell_price, 712435);
});

test("invented cells are not references for each other", () => {
  const inv = (p) => ({ ...real(0, p), used_fallback: true, sell_fallback: true });
  const map = { A: inv(700000), B: inv(710000), C: inv(720000), D: inv(6900) };
  guardInventedPrices(map);
  assert.deepStrictEqual(Object.values(map).map((c) => c.sell_price), [700000, 710000, 720000, 6900]);
});

test("the Black Market is neither a reference nor judged", () => {
  const map = {
    Lymhurst: real(6600, 6938), Martlock: real(6087, 6680),
    "Black Market": { ...real(900000, 0), used_fallback: true, buy_fallback: true },
  };
  guardInventedPrices(map);
  assert.strictEqual(map["Black Market"].buy_price, 900000);
});

test("Caerleon is neither a reference nor judged (plan-caerleon-exempt.md)", () => {
  const map = {
    Lymhurst: real(6600, 6938), Martlock: real(6087, 6680),
    Caerleon: { ...real(6870, 712435), used_fallback: true, sell_fallback: true },
  };
  guardInventedPrices(map);
  assert.strictEqual(map.Caerleon.sell_price, 712435);
});

test("zeroing a side clears its flag and recomputes used_fallback", () => {
  const map = { ...ROYALS(), Bridgewatch: { ...real(6870, 712435), used_fallback: true, sell_fallback: true } };
  const zeroed = guardInventedPrices(map);
  assert.strictEqual(zeroed, 1);
  assert.strictEqual(map.Bridgewatch.sell_fallback, false);
  assert.strictEqual(map.Bridgewatch.used_fallback, false);
});

test("guardInventedPriceMap walks only the ids it is given", () => {
  const md = {
    QUESTITEM_TOKEN_AVALON: { ...ROYALS(), Bridgewatch: { ...real(6870, 712435), used_fallback: true, sell_fallback: true } },
    OTHER: { ...ROYALS(), Bridgewatch: { ...real(6870, 712435), used_fallback: true, sell_fallback: true } },
  };
  guardInventedPriceMap(md, ["QUESTITEM_TOKEN_AVALON"]);
  assert.strictEqual(md.QUESTITEM_TOKEN_AVALON.Bridgewatch.sell_price, 0);
  assert.strictEqual(md.OTHER.Bridgewatch.sell_price, 712435);
  guardInventedPriceMap(md);
  assert.strictEqual(md.OTHER.Bridgewatch.sell_price, 0);
});

console.log("\n=== 3. folds: invented never replaces real ===");

[
  ["invented newer ask vs real older ask → real kept",
    real(4268, 8400, { sell_date: "2026-09-07T13:33:53Z" }),
    { ...real(6870, 712435, { sell_date: "2026-09-11T03:00:00" }), used_fallback: true, sell_fallback: true },
    8400],
  ["real newer ask vs real older ask → newer wins",
    real(4268, 8400, { sell_date: "2026-09-07T13:33:53Z" }),
    real(6870, 7100, { sell_date: "2026-09-11T03:00:00" }),
    7100],
  ["invented vs invented → newer wins",
    { ...real(0, 9000), used_fallback: true, sell_fallback: true },
    { ...real(0, 9500, { sell_date: "2026-09-11T09:00:00" }), used_fallback: true, sell_fallback: true },
    9500],
  ["real newer ask replaces a stored invented one",
    { ...real(0, 712435), used_fallback: true, sell_fallback: true },
    real(0, 8400),
    8400],
  ["invented ask fills a side nobody observed",
    real(4268, 0),
    { ...real(0, 8800), used_fallback: true, sell_fallback: true },
    8800],
].forEach(([name, previous, next, want]) => {
  test(`mergeEntry: ${name}`, () => {
    const out = mergeEntry(previous, next);
    assert.strictEqual(out.sell_price, want);
    assert.strictEqual(out.sell_fallback, !!isInventedSide(want === next.sell_price ? next : previous, "sell"));
  });
});

test("mergeEntry: keeping a real side keeps its date", () => {
  const prev = real(4268, 8400, { sell_date: "2026-09-07T13:33:53Z" });
  const out = mergeEntry(prev, { ...real(6870, 712435, { sell_date: "2026-09-11T03:00:00" }), used_fallback: true, sell_fallback: true });
  assert.strictEqual(out.sell_date, prev.sell_date);
  assert.strictEqual(out.buy_price, 6870, "the other side still folds newest-wins");
});

[
  ["an older capture beats an invented scan ask",
    { ...real(6870, 712435, { sell_date: "2026-09-11T03:00:00" }), used_fallback: true, sell_fallback: true },
    { buy_price: 0, sell_price: 8400, sell_date: "2026-09-07T13:33:53Z" }, 8400],
  ["an older capture does NOT beat a newer real scan ask",
    real(6870, 7100, { sell_date: "2026-09-11T03:00:00" }),
    { buy_price: 0, sell_price: 8400, sell_date: "2026-09-07T13:33:53Z" }, 7100],
].forEach(([name, target, captured, want]) => {
  test(`capFoldOntoTarget: ${name}`, () => {
    const out = CAP.capFoldOntoTarget({ ...target }, captured);
    assert.strictEqual(out.sell_price, want);
    if (want === captured.sell_price) {
      assert.strictEqual(out.sell_fallback, false);
      assert.strictEqual(out.used_fallback, false);
    }
  });
});

console.log("\n=== 4. applyScanPatch end to end ===");

test("the captured Caerleon ask is what the map holds after a scan invents one", () => {
  CAP.resetCapturedPrices();
  CAP.recordCapturedPrices(
    { QUESTITEM_TOKEN_AVALON: { 1: { Caerleon: { buy_price: 4268, sell_price: 8400, sell_date: "2026-09-07T13:33:53Z", buy_date: "2026-08-19T15:56:49Z", volume_24h: 0 } } } },
    { saveDelayMs: 60000 },
  );
  const md = { QUESTITEM_TOKEN_AVALON: ROYALS() };
  const scan = {
    QUESTITEM_TOKEN_AVALON: {
      Caerleon: { ...real(6870, 712435, { sell_date: "2026-09-11T03:00:00", buy_date: "2026-09-09T00:00:00" }), used_fallback: true, sell_fallback: true },
    },
  };
  CAP.applyScanPatch(md, scan);
  assert.strictEqual(md.QUESTITEM_TOKEN_AVALON.Caerleon.sell_price, 8400);
  CAP.resetCapturedPrices();
});

test("with no capture, the invented ask is still dropped against the royal asks", () => {
  CAP.resetCapturedPrices();
  // The scan targets a city the map holds nothing for yet (and that is not
  // exempt, unlike Caerleon): the guard is its only line of defense.
  const md = { QUESTITEM_TOKEN_AVALON: { Lymhurst: real(6600, 6938), Martlock: real(6087, 6680) } };
  CAP.applyScanPatch(md, {
    QUESTITEM_TOKEN_AVALON: { "Fort Sterling": { ...real(6870, 712435), used_fallback: true, sell_fallback: true } },
  });
  assert.strictEqual(md.QUESTITEM_TOKEN_AVALON["Fort Sterling"].sell_price, 0);
  assert.strictEqual(md.QUESTITEM_TOKEN_AVALON["Fort Sterling"].buy_price, 6870);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
