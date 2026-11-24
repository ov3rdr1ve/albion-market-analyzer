/**
 * Tests for folding sniffed market orders into the app's price map.
 *
 * A captured order is a LISTING, not a trade: it says "someone offers 3 bags at
 * 1234 silver in Caerleon". The app's price map speaks in `sell_price` (the
 * cheapest ask) and `buy_price` (the fattest bid), so the reduction is
 * min-over-offers and max-over-requests, per item / quality / city.
 *
 * Points that would silently corrupt prices if wrong, and are therefore pinned:
 *   - the wire multiplies every silver value by 10000,
 *   - enchantment is a separate field on the wire but part of the id in the app
 *     ("T4_BAG" + level 2 = "T4_BAG@2"),
 *   - `volume_24h` stays 0. Listed quantity is not traded volume, and the
 *     renderers read that field as "how much actually changed hands".
 *
 * Run: node tests/market-price-store.test.cjs
 */

const assert = require("assert");
const {
  ordersToPrices, mergeQualityPrices, mergeFlatPrices, flattenQuality, orderItemId,
} = require("../js/market-price-store.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const NOW = "2026-07-25T12:00:00";
const order = (over = {}) => ({
  Id: 1, ItemTypeId: "T4_BAG", LocationId: "3005", QualityLevel: 1,
  EnchantmentLevel: 0, UnitPriceSilver: 12340000, Amount: 3,
  AuctionType: "offer", Expires: "2026-08-01T00:00:00", ...over,
});

const at = (map, item, quality, city) => map[item] && map[item][quality] && map[item][quality][city];

// ── item id ────────────────────────────────────────────────────────────────
const ID_CASES = [
  [{ ItemTypeId: "T4_BAG", EnchantmentLevel: 0 }, "T4_BAG"],
  [{ ItemTypeId: "T4_BAG", EnchantmentLevel: 2 }, "T4_BAG@2"],
  [{ ItemTypeId: "T4_BAG@3", EnchantmentLevel: 3 }, "T4_BAG@3"],  // already suffixed
  [{ ItemTypeId: "T4_BAG@1", EnchantmentLevel: 0 }, "T4_BAG@1"],
  [{ ItemTypeId: "", EnchantmentLevel: 0 }, null],
  [{ EnchantmentLevel: 1 }, null],
];
ID_CASES.forEach(([input, want]) => {
  test(`orderItemId(${JSON.stringify(input)}) = ${JSON.stringify(want)}`, () => {
    assert.strictEqual(orderItemId(input), want);
  });
});

// ── reduction ──────────────────────────────────────────────────────────────
test("silver is divided by 10000 on the way in", () => {
  const map = ordersToPrices([order()], { now: NOW });
  assert.strictEqual(at(map, "T4_BAG", 1, "Caerleon").sell_price, 1234);
});

test("the cheapest offer wins the sell price", () => {
  const map = ordersToPrices([
    order({ Id: 1, UnitPriceSilver: 20000000 }),
    order({ Id: 2, UnitPriceSilver: 15000000 }),
    order({ Id: 3, UnitPriceSilver: 30000000 }),
  ], { now: NOW });
  assert.strictEqual(at(map, "T4_BAG", 1, "Caerleon").sell_price, 1500);
});

test("the fattest request wins the buy price", () => {
  const map = ordersToPrices([
    order({ Id: 1, AuctionType: "request", UnitPriceSilver: 8000000 }),
    order({ Id: 2, AuctionType: "request", UnitPriceSilver: 11000000 }),
  ], { now: NOW });
  assert.strictEqual(at(map, "T4_BAG", 1, "Caerleon").buy_price, 1100);
});

test("both sides land on the same entry", () => {
  const map = ordersToPrices([
    order({ Id: 1, AuctionType: "offer", UnitPriceSilver: 20000000 }),
    order({ Id: 2, AuctionType: "request", UnitPriceSilver: 15000000 }),
  ], { now: NOW });
  const entry = at(map, "T4_BAG", 1, "Caerleon");
  assert.deepStrictEqual([entry.sell_price, entry.buy_price], [2000, 1500]);
});

test("a side with no orders stays 0, like a market with no listings", () => {
  const entry = at(ordersToPrices([order()], { now: NOW }), "T4_BAG", 1, "Caerleon");
  assert.strictEqual(entry.buy_price, 0);
});

test("listed quantity is not traded volume", () => {
  const entry = at(ordersToPrices([order({ Amount: 99 })], { now: NOW }), "T4_BAG", 1, "Caerleon");
  assert.strictEqual(entry.volume_24h, 0);
});

test("entries are stamped with the capture time and flagged as sniffed", () => {
  const entry = at(ordersToPrices([order()], { now: NOW }), "T4_BAG", 1, "Caerleon");
  assert.strictEqual(entry.sell_date, NOW);
  assert.strictEqual(entry.from_sniffer, true);
  assert.strictEqual(entry.used_fallback, false);
});

test("only the side that has orders gets a date", () => {
  const entry = at(ordersToPrices([order()], { now: NOW }), "T4_BAG", 1, "Caerleon");
  assert.strictEqual(entry.buy_date, null);
});

// ── splitting ──────────────────────────────────────────────────────────────
test("quality is a separate bucket", () => {
  const map = ordersToPrices([
    order({ Id: 1, QualityLevel: 1, UnitPriceSilver: 10000000 }),
    order({ Id: 2, QualityLevel: 4, UnitPriceSilver: 90000000 }),
  ], { now: NOW });
  assert.strictEqual(at(map, "T4_BAG", 1, "Caerleon").sell_price, 1000);
  assert.strictEqual(at(map, "T4_BAG", 4, "Caerleon").sell_price, 9000);
});

test("enchantment splits the item id", () => {
  const map = ordersToPrices([
    order({ Id: 1, EnchantmentLevel: 0, UnitPriceSilver: 10000000 }),
    order({ Id: 2, EnchantmentLevel: 2, UnitPriceSilver: 50000000 }),
  ], { now: NOW });
  assert.strictEqual(at(map, "T4_BAG", 1, "Caerleon").sell_price, 1000);
  assert.strictEqual(at(map, "T4_BAG@2", 1, "Caerleon").sell_price, 5000);
});

test("city comes from each order's own location", () => {
  const map = ordersToPrices([
    order({ Id: 1, LocationId: "3005", UnitPriceSilver: 10000000 }),
    order({ Id: 2, LocationId: "1002", UnitPriceSilver: 20000000 }),
    order({ Id: 3, LocationId: "4301", UnitPriceSilver: 30000000 }),
  ], { now: NOW });
  assert.deepStrictEqual(Object.keys(map["T4_BAG"][1]).sort(), ["Caerleon", "Fort Sterling", "Lymhurst"]);
});

test("orders from a location the app does not price are skipped", () => {
  const map = ordersToPrices([
    order({ Id: 1, LocationId: "BLACKBANK-3005@1" }),
    order({ Id: 2, LocationId: "TNL-022" }),
  ], { now: NOW });
  assert.deepStrictEqual(map, {});
});

const JUNK_CASES = [
  ["no item id", { ItemTypeId: "" }],
  ["zero price", { UnitPriceSilver: 0 }],
  ["negative price", { UnitPriceSilver: -5 }],
  ["unknown auction type", { AuctionType: "bogus" }],
];
JUNK_CASES.forEach(([label, over]) => {
  test(`an order with ${label} is ignored`, () => {
    assert.deepStrictEqual(ordersToPrices([order(over)], { now: NOW }), {});
  });
});

test("an empty or missing order list gives an empty map", () => {
  assert.deepStrictEqual(ordersToPrices([], { now: NOW }), {});
  assert.deepStrictEqual(ordersToPrices(null, { now: NOW }), {});
});

// ── merging ────────────────────────────────────────────────────────────────
test("mergeQualityPrices writes into an empty target", () => {
  const target = {};
  const n = mergeQualityPrices(target, ordersToPrices([order()], { now: NOW }));
  assert.strictEqual(n, 1);
  assert.strictEqual(target["T4_BAG"][1]["Caerleon"].sell_price, 1234);
});

test("merging replaces only the cities it saw", () => {
  const target = { T4_BAG: { 1: {
    Caerleon: { sell_price: 1, buy_price: 1 },
    Martlock: { sell_price: 777, buy_price: 5 },
  } } };
  mergeQualityPrices(target, ordersToPrices([order()], { now: NOW }));
  assert.strictEqual(target["T4_BAG"][1]["Caerleon"].sell_price, 1234);
  assert.strictEqual(target["T4_BAG"][1]["Martlock"].sell_price, 777, "untouched");
});

test("merging keeps other items and other qualities intact", () => {
  const target = { T5_BAG: { 1: { Caerleon: { sell_price: 9 } } }, T4_BAG: { 4: { Caerleon: { sell_price: 8 } } } };
  mergeQualityPrices(target, ordersToPrices([order()], { now: NOW }));
  assert.strictEqual(target["T5_BAG"][1]["Caerleon"].sell_price, 9);
  assert.strictEqual(target["T4_BAG"][4]["Caerleon"].sell_price, 8);
});

test("merging counts every item/quality/city cell it wrote", () => {
  const n = mergeQualityPrices({}, ordersToPrices([
    order({ Id: 1, LocationId: "3005" }),
    order({ Id: 2, LocationId: "1002" }),
    order({ Id: 3, LocationId: "1002", QualityLevel: 3 }),
  ], { now: NOW }));
  assert.strictEqual(n, 3);
});

test("flattenQuality projects one quality onto the plain city map", () => {
  const map = ordersToPrices([
    order({ Id: 1, QualityLevel: 1, UnitPriceSilver: 10000000 }),
    order({ Id: 2, QualityLevel: 3, UnitPriceSilver: 90000000 }),
  ], { now: NOW });
  const flat = flattenQuality(map, 1);
  assert.strictEqual(flat["T4_BAG"]["Caerleon"].sell_price, 1000);
  assert.strictEqual(Object.keys(flat["T4_BAG"]).length, 1);
});

test("mergeFlatPrices folds a flattened patch into the scan's own map shape", () => {
  const target = { T4_BAG: { Martlock: { sell_price: 777 } } };
  const flat = flattenQuality(ordersToPrices([order()], { now: NOW }), 1);
  const n = mergeFlatPrices(target, flat);
  assert.strictEqual(n, 1);
  assert.strictEqual(target["T4_BAG"]["Caerleon"].sell_price, 1234);
  assert.strictEqual(target["T4_BAG"]["Martlock"].sell_price, 777, "untouched");
});

test("mergeFlatPrices into an empty map creates the item", () => {
  const target = {};
  mergeFlatPrices(target, flattenQuality(ordersToPrices([order()], { now: NOW }), 1));
  assert.strictEqual(target["T4_BAG"]["Caerleon"].sell_price, 1234);
});

test("mergeFlatPrices with nothing to merge writes nothing", () => {
  const target = { T4_BAG: { Caerleon: { sell_price: 5 } } };
  assert.strictEqual(mergeFlatPrices(target, {}), 0);
  assert.strictEqual(mergeFlatPrices(target, null), 0);
  assert.strictEqual(target["T4_BAG"]["Caerleon"].sell_price, 5);
});

test("flattenQuality skips items that have no data at that quality", () => {
  const map = ordersToPrices([order({ QualityLevel: 3 })], { now: NOW });
  assert.deepStrictEqual(flattenQuality(map, 1), {});
});

// ── two-sided merge ────────────────────────────────────────────────────────
// The game answers the sell list (AuctionGetOffers) and the buy list
// (AuctionGetRequests) in SEPARATE responses, so each patch carries one side
// and a 0 on the other. A cell-level replace made the second response erase
// the first: open the sell tab then the buy tab and buy_price alone survived,
// which is exactly the field the crafting table sources materials from.
const LATER = "2026-07-25T12:05:00";
const sellPatch = () => ordersToPrices([order({ AuctionType: "offer", UnitPriceSilver: 12340000 })], { now: NOW });
const buyPatch = () => ordersToPrices([order({ AuctionType: "request", UnitPriceSilver: 9000000 })], { now: LATER });

test("a buy-side patch keeps the sell price an earlier patch captured", () => {
  const target = {};
  mergeQualityPrices(target, sellPatch());
  mergeQualityPrices(target, buyPatch());
  const cell = at(target, "T4_BAG", 1, "Caerleon");
  assert.strictEqual(cell.sell_price, 1234, "sell side survives");
  assert.strictEqual(cell.buy_price, 900);
  assert.strictEqual(cell.sell_date, NOW, "its date travels with it");
  assert.strictEqual(cell.buy_date, LATER);
});

test("a sell-side patch keeps the buy price an earlier patch captured", () => {
  const target = {};
  mergeQualityPrices(target, buyPatch());
  mergeQualityPrices(target, sellPatch());
  const cell = at(target, "T4_BAG", 1, "Caerleon");
  assert.strictEqual(cell.buy_price, 900, "buy side survives");
  assert.strictEqual(cell.sell_price, 1234);
});

test("the same side seen again wins — a live re-read is never stale", () => {
  const target = {};
  mergeQualityPrices(target, sellPatch());
  mergeQualityPrices(target, ordersToPrices(
    [order({ AuctionType: "offer", UnitPriceSilver: 20000000 })], { now: LATER },
  ));
  assert.strictEqual(at(target, "T4_BAG", 1, "Caerleon").sell_price, 2000);
});

test("a capture keeps the 24h volume the scan measured for that cell", () => {
  const target = { T4_BAG: { 1: { Caerleon: { sell_price: 5, buy_price: 4, volume_24h: 812 } } } };
  mergeQualityPrices(target, sellPatch());
  const cell = at(target, "T4_BAG", 1, "Caerleon");
  assert.strictEqual(cell.volume_24h, 812, "listings are not trades, so volume is inherited");
  assert.strictEqual(cell.sell_price, 1234);
  assert.strictEqual(cell.buy_price, 4, "unseen side inherited too");
});

test("mergeFlatPrices merges the two sides the same way", () => {
  const target = {};
  mergeFlatPrices(target, flattenQuality(sellPatch(), 1));
  mergeFlatPrices(target, flattenQuality(buyPatch(), 1));
  assert.strictEqual(target["T4_BAG"]["Caerleon"].sell_price, 1234);
  assert.strictEqual(target["T4_BAG"]["Caerleon"].buy_price, 900);
});

test("mergeFlatPrices keeps a scanned volume and an unseen side", () => {
  const target = { T4_BAG: { Caerleon: { sell_price: 5, buy_price: 4, volume_24h: 812 } } };
  mergeFlatPrices(target, flattenQuality(sellPatch(), 1));
  assert.strictEqual(target["T4_BAG"]["Caerleon"].volume_24h, 812);
  assert.strictEqual(target["T4_BAG"]["Caerleon"].buy_price, 4);
  assert.strictEqual(target["T4_BAG"]["Caerleon"].sell_price, 1234);
});

test("every quality the capture saw is stored, not just Normal", () => {
  const map = ordersToPrices([
    order({ Id: 1, QualityLevel: 1 }),
    order({ Id: 2, QualityLevel: 3, UnitPriceSilver: 50000000 }),
    order({ Id: 3, QualityLevel: 5, UnitPriceSilver: 90000000 }),
  ], { now: NOW });
  assert.deepStrictEqual(Object.keys(map["T4_BAG"]).sort(), ["1", "3", "5"]);
  assert.strictEqual(at(map, "T4_BAG", 5, "Caerleon").sell_price, 9000);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
