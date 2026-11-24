/**
 * Tests: naming the items an order-book request asked about, after the game
 * patch of 2026-09-03.
 *
 * Reported 2026-09-11 ("i opened fort sterling market with sniffer active and
 * theres no sell order for this item, but table still shows its there"). The
 * stored captures showed two reader defects behind it:
 *
 *   1. js/item-index.js was the 2026-07-21 ao-bin-dumps items.txt. The 09-03
 *      patch inserted items from index 23 onward, so 12,049 of 12,071 wire ids
 *      named the wrong item. Opening the Firewing Drake (wire 3067) stamped
 *      "book read" onto UNIQUE_MOUNT_BASTION_CRYSTAL, and the empty Tame
 *      Firewing Drake ask list was never recorded at all.
 *   2. Parameter 6 of the request stopped being the enchantment. Correlating
 *      every stored stamp with the orders its own response carried: before the
 *      patch the stamp's @n matched the orders' enchant; after it, parameter 6
 *      is 2 on every offers request and 1 on every requests request, whatever
 *      was searched, while an enchanted search sends the @n variant's OWN index
 *      in parameter 8 (items.txt lists T6_ARMOR_LEATHER_DRAGON@3 as 4696).
 *
 * So parameter 6 is ignored, and the reader checks its index against what the
 * game answers: a named request whose response carries orders for a different
 * item is attributed from the orders instead, and once mismatches outweigh
 * matches the index is reported stale — its names are no longer used to stamp
 * an EMPTY book (a wrong stamp flags a live price "not listed") nor to file a
 * price-chart volume.
 *
 * Run: node tests/market-query-item-index-drift.test.cjs
 */

const assert = require("assert");
const { createMarketEventReader, MARKET_OPS } = require("../js/market-sniffer-events.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const order = (over = {}) => JSON.stringify({
  Id: 1, ItemTypeId: "T4_BAG", ItemGroupTypeId: "T4_BAG", LocationId: "",
  QualityLevel: 1, EnchantmentLevel: 0, UnitPriceSilver: 12340000, Amount: 3,
  AuctionType: "offer", Expires: "2026-08-01T00:00:00", ...over,
});
const response = (code, params) => ({ kind: "response", code: 0, parameters: { 253: code, ...params } });
const request = (code, params) => ({ kind: "request", code: 0, parameters: { 253: code, ...params } });
const joinAt = (locationId) => response(MARKET_OPS.join, { 8: locationId });

const OFFERS = MARKET_OPS.auctionGetOffers;
const REQUESTS = MARKET_OPS.auctionGetRequests;
const FORT_STERLING = "4002";

// A slice of the live (2026-09-08) items.txt.
const INDEX = {
  24: "T8_FARM_DRAKE_GROWN",
  3067: "T8_MOUNT_DRAKE_FIRE",
  4693: "T6_ARMOR_LEATHER_DRAGON",
  4696: "T6_ARMOR_LEATHER_DRAGON@3",
  9738: "T6_FURNITUREITEM_TROPHY_FISH",
};
const lookupId = (n) => INDEX[n] || null;
// The same wire ids through the stale 2026-07-21 index the app shipped. 9738
// stands for an id both indexes happen to agree on (22 of them really do).
const STALE = {
  24: "T4_FARM_OX_BABY", 3067: "UNIQUE_MOUNT_BASTION_CRYSTAL", 4693: "T6_HEAD_CLOTH_SET2",
  9738: "T6_FURNITUREITEM_TROPHY_FISH",
};
const staleLookup = (n) => STALE[n] || null;

function reader(options = {}) {
  const orders = [], histories = [];
  const r = createMarketEventReader({
    onOrders: (u) => orders.push(u),
    onHistory: (u) => histories.push(u),
    ...options,
  });
  r.handle(joinAt(FORT_STERLING));
  return { r, orders, histories };
}

let nextMessageId = 100;
/** One request/response round trip; returns the emitted upload, if any. */
function query(ctx, { code = OFFERS, params = {}, list = [] }) {
  const id = nextMessageId++;
  const before = ctx.orders.length;
  ctx.r.handle(request(code, { ...params, 255: id }));
  ctx.r.handle(response(code, { 0: list, 255: id }));
  return ctx.orders.length > before ? ctx.orders[ctx.orders.length - 1] : null;
}

console.log("Order-book request naming — parameter 6 and index drift\n");

// ── parameter 6 is not the enchantment ─────────────────────────────────────
[
  ["an offers request (6 = 2) on a flat item", OFFERS, 24, 2, "T8_FARM_DRAKE_GROWN"],
  ["a requests request (6 = 1) on a flat item", REQUESTS, 24, 1, "T8_FARM_DRAKE_GROWN"],
  ["an enchanted search names the @n variant by its own index", OFFERS, 4696, 2, "T6_ARMOR_LEATHER_DRAGON@3"],
  ["a request with no parameter 6 at all", OFFERS, 3067, undefined, "T8_MOUNT_DRAKE_FIRE"],
].forEach(([label, code, wire, p6, want]) => {
  test(`parameter 6 never suffixes the id — ${label}`, () => {
    const ctx = reader({ lookupId });
    const params = { 8: [wire] };
    if (p6 !== undefined) params[6] = p6;
    const upload = query(ctx, { code, params });
    assert.deepStrictEqual(upload.observed.itemIds, [want]);
    assert.strictEqual(ctx.r.stats.lastQueries[0].itemId, want);
  });
});

// ── a named request checked against its own answer ─────────────────────────
test("orders for the named item confirm the index", () => {
  const ctx = reader({ lookupId });
  const upload = query(ctx, { params: { 8: [3067] }, list: [order({ ItemTypeId: "T8_MOUNT_DRAKE_FIRE" })] });
  assert.deepStrictEqual(upload.observed.itemIds, ["T8_MOUNT_DRAKE_FIRE"]);
  assert.ok(!upload.observed.derived);
  assert.strictEqual(ctx.r.stats.itemIndexMatches, 1);
  assert.strictEqual(ctx.r.stats.itemIndexMismatches, 0);
});

test("an enchanted order still confirms its base item", () => {
  const ctx = reader({ lookupId });
  query(ctx, { params: { 8: [4693] }, list: [order({ ItemTypeId: "T6_ARMOR_LEATHER_DRAGON", EnchantmentLevel: 2 })] });
  assert.strictEqual(ctx.r.stats.itemIndexMatches, 1);
});

test("the reported Firewing Drake read: orders name the drake, the stale index the Bastion", () => {
  const ctx = reader({ lookupId: staleLookup });
  const upload = query(ctx, {
    code: REQUESTS,
    params: { 8: [3067], 6: 1 },
    list: [order({ ItemTypeId: "T8_MOUNT_DRAKE_FIRE", AuctionType: "request", UnitPriceSilver: 200000010000 })],
  });
  assert.deepStrictEqual(upload.observed.itemIds, ["T8_MOUNT_DRAKE_FIRE"], "stamped from the orders");
  assert.strictEqual(upload.observed.derived, true);
  assert.strictEqual(ctx.r.stats.itemIndexMismatches, 1);
});

// ── when the index is judged stale ─────────────────────────────────────────
const mismatch = (ctx) => query(ctx, { params: { 8: [4693] }, list: [order({ ItemTypeId: "T6_ARMOR_LEATHER_DRAGON" })] });
const match = (ctx) => query(ctx, { params: { 8: [9738] }, list: [order({ ItemTypeId: "T6_FURNITUREITEM_TROPHY_FISH" })] });

// [label, mismatches, matches, wantStale]
[
  ["no evidence", 0, 0, false],
  ["two mismatches are not yet a verdict", 2, 0, false],
  ["three mismatches and nothing else", 3, 0, true],
  ["matches outweigh the mismatches", 3, 5, false],
  ["mismatches outweigh the matches", 6, 2, true],
].forEach(([label, bad, good, wantStale]) => {
  test(`itemIndexStale — ${label}`, () => {
    const ctx = reader({ lookupId: staleLookup });
    for (let i = 0; i < good; i++) match(ctx);
    for (let i = 0; i < bad; i++) mismatch(ctx);
    assert.strictEqual(ctx.r.stats.itemIndexStale, wantStale);
  });
});

// A shared stale-index reader for the checks below.
function staleReader() {
  const ctx = reader({ lookupId: staleLookup });
  for (let i = 0; i < 3; i++) mismatch(ctx);
  return ctx;
}

test("a stale index no longer stamps an EMPTY book it cannot name", () => {
  const ctx = staleReader();
  const before = ctx.r.stats.emptyOrderResponses;
  const upload = query(ctx, { params: { 8: [24] } });
  assert.strictEqual(upload, null, "no stamp for T4_FARM_OX_BABY");
  assert.strictEqual(ctx.r.stats.emptyOrderResponses, before + 1, "still counted as an answer");
});

test("a stale index still files prices from the orders themselves", () => {
  const ctx = staleReader();
  const upload = query(ctx, { params: { 8: [24] }, list: [order({ ItemTypeId: "T8_FARM_DRAKE_GROWN" })] });
  assert.deepStrictEqual(upload.observed.itemIds, ["T8_FARM_DRAKE_GROWN"]);
});

test("a healthy index keeps stamping empty books", () => {
  const ctx = reader({ lookupId });
  const upload = query(ctx, { params: { 8: [24] } });
  assert.deepStrictEqual(upload.observed.itemIds, ["T8_FARM_DRAKE_GROWN"]);
});

[
  ["healthy", () => reader({ lookupId }), false],
  ["stale", staleReader, true],
].forEach(([label, make, want]) => {
  test(`a price-chart capture carries the index verdict — ${label}`, () => {
    const ctx = make();
    ctx.r.handle(request(MARKET_OPS.auctionGetItemAverageStats, { 1: 24, 2: 1, 3: 1, 255: 9001 }));
    ctx.r.handle(response(MARKET_OPS.auctionGetItemAverageStats, { 0: [5], 1: [500], 2: [100], 255: 9001 }));
    assert.strictEqual(ctx.histories.length, 1);
    assert.strictEqual(ctx.histories[0].indexStale, want);
  });
});

test("reset forgets the verdict", () => {
  const ctx = staleReader();
  ctx.r.reset();
  assert.strictEqual(ctx.r.stats.itemIndexStale, false);
  assert.strictEqual(ctx.r.stats.itemIndexMismatches, 0);
  assert.strictEqual(ctx.r.stats.itemIndexMatches, 0);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
