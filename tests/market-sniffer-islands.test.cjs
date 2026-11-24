/**
 * Tests: islands and other instanced maps in the market reader.
 *
 * Moved out of tests/market-sniffer-events.test.cjs, which had grown past the
 * 800-line limit. Same harness, same behaviour pinned.
 *
 * Run: node tests/market-sniffer-islands.test.cjs
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
const joinAt = (locationId) => response(MARKET_OPS.join, { 8: locationId });

function reader(options = {}) {
  const orders = [], locations = [];
  const r = createMarketEventReader({
    onOrders: (u) => orders.push(u),
    onLocation: (l) => locations.push(l),
    ...options,
  });
  return { r, orders, locations };
}

// ── islands and other instanced maps ───────────────────────────────────────
// Reported: a teleport straight to an island lost the position, and the city
// entered afterwards did not restore it. An island has no market, so it names
// no city — but it must still be READ, or the reader goes on believing the
// player stands in the city they left and files the next capture there.

const ISLAND_RAW = "@island@1f2e3d4c-5b6a-7980-9a1b-2c3d4e5f6071";
const ISLAND = "@ISLAND@1f2e3d4c-5b6a-7980-9a1b-2c3d4e5f6071";

test("a join to a private island is read, and names no city", () => {
  const { r, locations } = reader();
  r.handle(joinAt("3005"));
  r.handle(joinAt(ISLAND_RAW));
  assert.strictEqual(r.locationId, ISLAND);
  assert.strictEqual(locations[1].city, null);
  assert.strictEqual(r.stats.joins, 2);
});

test("the city entered after an island is filed under that city again", () => {
  const { r, locations } = reader();
  r.handle(joinAt("3005"));
  r.handle(joinAt(ISLAND_RAW));
  r.handle(joinAt("1002"));
  assert.strictEqual(r.locationId, "1002");
  assert.strictEqual(locations[2].city, "Lymhurst");
});

test("a location that arrived as bytes is still read", () => {
  const { r } = reader();
  r.handle(joinAt(Buffer.from(ISLAND_RAW, "latin1")));
  assert.strictEqual(r.locationId, ISLAND);
});

test("a Join on an unknown operation is read, and counted apart", () => {
  const { r } = reader();
  r.handle(response(777, { 1: "character-id", 2: "PlayerName", 8: "4002" }));
  assert.strictEqual(r.locationId, "4002");
  assert.deepStrictEqual(r.stats.joinsByFallbackOp, { 777: 1 });
});

test("an unrelated response holding a cluster-shaped number does not move the player", () => {
  const { r } = reader();
  r.handle(joinAt("3005"));
  r.handle(response(778, { 0: "0320" }));
  assert.strictEqual(r.locationId, "3005");
  assert.deepStrictEqual(r.stats.joinsByFallbackOp, {});
});

// Reported 2026-09-04, alongside the window staying stuck on "@ISLAND@…": an
// island token used to be trusted anywhere in any payload, so post-island
// traffic carrying the player's own island reference refiled every capture
// under the island the player had already left.
test("an unrelated response holding an island token does not move the player", () => {
  const { r } = reader();
  r.handle(joinAt(ISLAND_RAW));
  r.handle(joinAt("1002"));
  r.handle(response(778, { 4: ISLAND_RAW }));
  assert.strictEqual(r.locationId, "1002");
  assert.deepStrictEqual(r.stats.joinsByFallbackOp, {});
});

test("an island beside the character block on an unknown operation is still read", () => {
  const { r } = reader();
  r.handle(joinAt("3005"));
  r.handle(response(778, { 1: "character-id", 2: "PlayerName", 4: ISLAND_RAW }));
  assert.strictEqual(r.locationId, ISLAND);
  assert.deepStrictEqual(r.stats.joinsByFallbackOp, { 778: 1 });
});

test("an island location is never uploaded as a market", () => {
  const { r, orders } = reader();
  r.handle(joinAt(ISLAND_RAW));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [order({ UnitPriceSilver: 12340000 })] }));
  assert.strictEqual(orders.length, 0, "an island has no market to file");
  assert.strictEqual(r.stats.droppedNoLocation, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
