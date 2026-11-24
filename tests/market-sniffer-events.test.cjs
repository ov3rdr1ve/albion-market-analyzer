/**
 * Tests for turning Photon messages into market uploads.
 *
 * Parameter layout is transcribed from albiondata-client (the reference
 * implementation the app's own scans consume):
 *
 *   operation code           parameters[253]
 *   Join response location   parameters[8]            (opJoin = 2)
 *   AuctionGetOffers resp    parameters[0] = JSON strings   (op 81, sell side)
 *   AuctionGetRequests resp  parameters[0] = JSON strings   (op 82, buy side)
 *   AuctionGetItemAverageStats
 *       request              1 itemId, 2 quality, 3 timescale, 255 messageId
 *       response             0 amounts, 1 silver, 2 timestamps, 255 messageId
 *   GoldMarketGetAverageInfo response  0 prices, 1 timestamps   (op 250)
 *
 * Two behaviours are load-bearing and easy to get wrong, so they are pinned:
 *   - orders are emitted VERBATIM (prices still ×10000). The ingest pipeline
 *     divides, so scaling here would corrupt every uploaded price.
 *   - a history response carries no item id; it is correlated with its request
 *     through messageId % cacheSize, exactly as the reference client does.
 *
 * Run: node tests/market-sniffer-events.test.cjs
 */

const assert = require("assert");
const {
  createMarketEventReader, readOperationCode, MARKET_OPS,
} = require("../js/market-sniffer-events.js");

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

function reader(options = {}) {
  const orders = [], histories = [], gold = [], locations = [];
  const r = createMarketEventReader({
    onOrders: (u) => orders.push(u),
    onHistory: (u) => histories.push(u),
    onGold: (u) => gold.push(u),
    onLocation: (l) => locations.push(l),
    ...options,
  });
  return { r, orders, histories, gold, locations };
}

// ── operation code ─────────────────────────────────────────────────────────
test("the operation code is parameter 253, not the photon code byte", () => {
  assert.strictEqual(readOperationCode({ parameters: { 253: 81 }, code: 4 }), 81);
});

test("a byte-swapped code is corrected back to the known operation", () => {
  // Seen after client updates: 81 arrives as 0x5100 = 20736.
  assert.strictEqual(readOperationCode({ parameters: { 253: 20736 } }), 81);
});

test("a message without parameter 253 has no operation code", () => {
  assert.strictEqual(readOperationCode({ parameters: { 0: "x" } }), null);
  assert.strictEqual(readOperationCode(null), null);
});

// Parameter 253 is Albion's own addition, and it is missing from the responses
// whose whole payload sits in the debug-message slot — market order lists, in
// other words. Photon's own header code is the fallback, exactly as the
// reference client does it.
test("a response falls back to the Photon header operation code", () => {
  assert.strictEqual(readOperationCode({ kind: "response", code: 82, parameters: { 0: ["x"] } }), 82);
});

test("an EVENT does not borrow its code — the numbering is unrelated", () => {
  assert.strictEqual(readOperationCode({ kind: "event", code: 82, parameters: { 0: ["x"] } }), null);
});

test("an order list on a response with no parameter 253 is captured", () => {
  const { r, orders } = reader();
  r.handle(joinAt("3005"));
  r.handle({ kind: "response", code: MARKET_OPS.auctionGetRequests, parameters: { 0: [order()] } });
  assert.strictEqual(orders.length, 1);
  assert.strictEqual(orders[0].city, "Caerleon");
});

// ── location tracking ──────────────────────────────────────────────────────
test("the Join response sets the market location", () => {
  const { r, locations } = reader();
  r.handle(joinAt("3005"));
  assert.strictEqual(r.locationId, "3005");
  assert.deepStrictEqual(locations, [{ locationId: "3005", city: "Caerleon" }]);
});

test("a roads zone is tracked but reports no market city", () => {
  const { r, locations } = reader();
  r.handle(joinAt("TNL-022"));
  assert.strictEqual(r.locationId, "TNL-022");
  assert.deepStrictEqual(locations, [{ locationId: "TNL-022", city: null }]);
});

test("re-joining the same location does not re-announce it", () => {
  const { r, locations } = reader();
  r.handle(joinAt("3005"));
  r.handle(joinAt("3005"));
  assert.strictEqual(locations.length, 1);
});

// ── market orders ──────────────────────────────────────────────────────────
test("a sell-order response emits the orders with the current location filled in", () => {
  const { r, orders } = reader();
  r.handle(joinAt("3005"));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [order(), order({ Id: 2 })] }));
  assert.strictEqual(orders.length, 1);
  assert.strictEqual(orders[0].topic, "marketorders.ingest");
  assert.strictEqual(orders[0].city, "Caerleon");
  assert.deepStrictEqual(orders[0].orders.map((o) => o.LocationId), ["3005", "3005"]);
});

test("prices are passed through unscaled — the ingest pipeline divides by 10000", () => {
  const { r, orders } = reader();
  r.handle(joinAt("3005"));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [order()] }));
  assert.strictEqual(orders[0].orders[0].UnitPriceSilver, 12340000);
});

test("an order that names its own location keeps it (dens report themselves)", () => {
  const { r, orders } = reader();
  r.handle(joinAt("3005"));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [order({ LocationId: "BLACKBANK-3005@1" })] }));
  assert.strictEqual(orders[0].orders[0].LocationId, "BLACKBANK-3005@1");
});

test("buy-order responses are emitted too", () => {
  const { r, orders } = reader();
  r.handle(joinAt("1002"));
  r.handle(response(MARKET_OPS.auctionGetRequests, { 0: [order({ AuctionType: "request" })] }));
  assert.strictEqual(orders.length, 1);
  assert.strictEqual(orders[0].orders[0].AuctionType, "request");
});

test("orders seen before any location is known are dropped, not mislabelled", () => {
  const { r, orders } = reader();
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [order()] }));
  assert.strictEqual(orders.length, 0);
});

test("an empty order list emits nothing", () => {
  const { r, orders } = reader();
  r.handle(joinAt("3005"));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [] }));
  assert.strictEqual(orders.length, 0);
});

test("unparseable order JSON is skipped without losing the rest", () => {
  const { r, orders } = reader();
  r.handle(joinAt("3005"));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: ["{not json", order()] }));
  assert.strictEqual(orders[0].orders.length, 1);
});

test("an unrelated operation carrying no orders is ignored", () => {
  const { r, orders, histories } = reader();
  r.handle(joinAt("3005"));
  r.handle(response(999, { 0: ["hello", "world"] }));
  assert.strictEqual(orders.length + histories.length, 0);
});

// ── operation codes drift ──────────────────────────────────────────────────
// The op numbers move with client patches: what is 81 today is 84 after a
// content release, and the capture then goes silent with no way to tell the
// difference from "the game is closed". An order list is unmistakable on the
// wire — JSON objects with UnitPriceSilver — so the payload, not the number,
// is what decides. The known codes stay as the fast path.
test("an order list on an unknown operation is still captured", () => {
  const { r, orders } = reader();
  r.handle(joinAt("3005"));
  r.handle(response(137, { 0: [order()] }));
  assert.strictEqual(orders.length, 1);
  assert.strictEqual(orders[0].orders[0].UnitPriceSilver, 12340000);
});

test("the unknown operation that carried orders is recorded", () => {
  const { r } = reader();
  r.handle(joinAt("3005"));
  r.handle(response(137, { 0: [order()] }));
  r.handle(response(137, { 0: [order({ Id: 2 })] }));
  assert.deepStrictEqual(r.stats.unknownOps, { 137: 2 });
  assert.strictEqual(r.stats.lastOrderOp, 137);
});

test("a known operation does not count as an unknown one", () => {
  const { r } = reader();
  r.handle(joinAt("3005"));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [order()] }));
  assert.deepStrictEqual(r.stats.unknownOps, {});
  assert.strictEqual(r.stats.lastOrderOp, MARKET_OPS.auctionGetOffers);
});

// ── diagnostics ────────────────────────────────────────────────────────────
// Every drop here is silent by design — one bad frame must not stop the tap —
// so without counters "listening · 8 orders" is indistinguishable from a dead
// capture. These are what the status line reports back.
test("responses and order responses are counted", () => {
  const { r } = reader();
  r.handle(joinAt("3005"));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [order(), order({ Id: 2 })] }));
  r.handle(response(MARKET_OPS.goldMarketGetAverageInfo, { 0: [4500], 1: [1] }));
  assert.strictEqual(r.stats.orderResponses, 1);
  assert.strictEqual(r.stats.orders, 2);
  assert.ok(r.stats.responses >= 3);
});

test("orders dropped for want of a location are counted, not lost silently", () => {
  const { r, orders } = reader();
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [order(), order({ Id: 2 })] }));
  assert.strictEqual(orders.length, 0);
  assert.strictEqual(r.stats.droppedNoLocation, 2);
  assert.strictEqual(r.stats.orderResponses, 1, "the response was seen, just unusable");
});

// A capture started while the player already stands in a city never sees a
// Join, so the player location is unknown — but a den or bank names itself in
// the order, and that is enough to file it.
test("an order that names its own location survives an unknown player location", () => {
  const { r, orders } = reader();
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [order({ LocationId: "BLACKBANK-3005@1" })] }));
  assert.strictEqual(orders.length, 1);
  assert.strictEqual(orders[0].orders[0].LocationId, "BLACKBANK-3005@1");
  assert.strictEqual(r.stats.droppedNoLocation, 0);
});

test("a mixed response keeps the orders that name a location and counts the rest", () => {
  const { r, orders } = reader();
  r.handle(response(MARKET_OPS.auctionGetOffers, {
    0: [order(), order({ Id: 2, LocationId: "BLACKBANK-3005@1" })],
  }));
  assert.strictEqual(orders[0].orders.length, 1);
  assert.strictEqual(r.stats.droppedNoLocation, 1);
});

test("reset clears the diagnostics too", () => {
  const { r } = reader();
  r.handle(joinAt("3005"));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [order()] }));
  r.reset();
  assert.strictEqual(r.stats.orders, 0);
  assert.strictEqual(r.stats.orderResponses, 0);
  assert.deepStrictEqual(r.stats.unknownOps, {});
});

// ── a seeded location ──────────────────────────────────────────────────────
// The player location is only ever announced on a zone Join, so a capture
// started while you are already standing in the city learns nothing until you
// walk through a gate — and every order until then is thrown away. A seed lets
// the user name the city instead. It is a deliberate choice, so it outranks
// whatever the reader is holding; only a LATER Join, which is live truth, wins.
test("a seeded location makes city orders usable", () => {
  const { r, orders } = reader();
  r.seedLocation("1002");
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [order()] }));
  assert.strictEqual(orders.length, 1);
  assert.strictEqual(orders[0].city, "Lymhurst");
});

test("seeding announces the location like a Join does", () => {
  const { r, locations } = reader();
  r.seedLocation("1002");
  assert.deepStrictEqual(locations, [{ locationId: "1002", city: "Lymhurst" }]);
});

// The one the picker was useless for: the capture saw a Join hours ago, the
// player has since moved and the gate crossing was missed, so the reader is
// still filing every market under the wrong city. Naming a city has to fix it.
test("a seed overrides a location the capture saw earlier", () => {
  const { r, orders } = reader();
  r.handle(joinAt("4002"));
  assert.strictEqual(r.seedLocation("1002"), true);
  assert.strictEqual(r.locationId, "1002");
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [order()] }));
  assert.strictEqual(orders.at(-1).city, "Lymhurst");
});

test("overriding announces the new location", () => {
  const { r, locations } = reader();
  r.handle(joinAt("4002"));
  r.seedLocation("1002");
  assert.deepStrictEqual(locations.at(-1), { locationId: "1002", city: "Lymhurst" });
});

test("re-seeding the location already in force is not announced twice", () => {
  const { r, locations } = reader();
  r.seedLocation("1002");
  assert.strictEqual(r.seedLocation("1002"), false);
  assert.strictEqual(locations.length, 1);
});

test("a later Join outranks the seed", () => {
  const { r, orders } = reader();
  r.seedLocation("1002");
  r.handle(joinAt("3008"));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [order()] }));
  assert.strictEqual(orders[0].city, "Martlock");
});

const BAD_SEEDS = [["nothing", ""], ["blank", "   "], ["null", null], ["undefined", undefined]];
BAD_SEEDS.forEach(([label, value]) => {
  test(`seeding ${label} leaves the location unknown`, () => {
    const { r } = reader();
    assert.strictEqual(r.seedLocation(value), false);
    assert.strictEqual(r.locationId, null);
  });
});

// "Auto (from zone)" sends an empty seed. That gives the zone back its say; it
// must not blind a capture that already knows where it is.
BAD_SEEDS.forEach(([label, value]) => {
  test(`seeding ${label} does not erase a known location`, () => {
    const { r } = reader();
    r.handle(joinAt("3005"));
    assert.strictEqual(r.seedLocation(value), false);
    assert.strictEqual(r.locationId, "3005");
  });
});

// ── market history ─────────────────────────────────────────────────────────
test("a history response is correlated with its request by message id", () => {
  const { r, histories } = reader();
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetItemAverageStats, { 1: 4321, 2: 3, 3: 1, 255: 77 }));
  r.handle(response(MARKET_OPS.auctionGetItemAverageStats, {
    0: [10, 20], 1: [1000, 2000], 2: [100, 200], 255: 77,
  }));
  assert.strictEqual(histories.length, 1);
  assert.strictEqual(histories[0].topic, "markethistories.ingest");
  assert.deepStrictEqual(
    { id: histories[0].payload.AlbionId, q: histories[0].payload.QualityLevel, t: histories[0].payload.Timescale, loc: histories[0].payload.LocationId },
    { id: 4321, q: 3, t: 1, loc: "3005" },
  );
});

test("history points come back newest first", () => {
  const { r, histories } = reader();
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetItemAverageStats, { 1: 1, 2: 1, 3: 0, 255: 1 }));
  r.handle(response(MARKET_OPS.auctionGetItemAverageStats, {
    0: [1, 2, 3], 1: [10, 20, 30], 2: [100, 300, 200], 255: 1,
  }));
  assert.deepStrictEqual(
    histories[0].payload.MarketHistories.map((h) => h.Timestamp), [300, 200, 100],
  );
});

// The client reports item ids 129-256 as negative numbers; the reference
// implementation adds 256 to recover them (goose eggs arrive as -121 = 135).
test("a negative item id is corrected by adding 256", () => {
  const { r, histories } = reader();
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetItemAverageStats, { 1: -121, 2: 1, 3: 0, 255: 5 }));
  r.handle(response(MARKET_OPS.auctionGetItemAverageStats, { 0: [1], 1: [10], 2: [100], 255: 5 }));
  assert.strictEqual(histories[0].payload.AlbionId, 135);
});

test("a negative item AMOUNT below -124 is dropped, others get +256", () => {
  const { r, histories } = reader();
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetItemAverageStats, { 1: 1, 2: 1, 3: 0, 255: 9 }));
  r.handle(response(MARKET_OPS.auctionGetItemAverageStats, {
    0: [-125, -10, 5], 1: [10, 20, 30], 2: [100, 200, 300], 255: 9,
  }));
  assert.deepStrictEqual(
    histories[0].payload.MarketHistories.map((h) => [h.Timestamp, h.ItemAmount]),
    [[300, 5], [200, 246]],
  );
});

test("a history response with no matching request is dropped", () => {
  const { r, histories } = reader();
  r.handle(joinAt("3005"));
  r.handle(response(MARKET_OPS.auctionGetItemAverageStats, { 0: [1], 1: [10], 2: [100], 255: 42 }));
  assert.strictEqual(histories.length, 0);
});

test("the correlation cache wraps at cacheSize, matching the reference client", () => {
  const { r, histories } = reader({ cacheSize: 4 });
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetItemAverageStats, { 1: 55, 2: 1, 3: 0, 255: 2 }));
  r.handle(response(MARKET_OPS.auctionGetItemAverageStats, { 0: [1], 1: [10], 2: [100], 255: 6 }));
  assert.strictEqual(histories[0].payload.AlbionId, 55, "6 % 4 === 2 % 4");
});

test("a cache slot is consumed once, so a repeated response is dropped", () => {
  const { r, histories } = reader();
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetItemAverageStats, { 1: 7, 2: 1, 3: 0, 255: 3 }));
  const resp = response(MARKET_OPS.auctionGetItemAverageStats, { 0: [1], 1: [10], 2: [100], 255: 3 });
  r.handle(resp);
  r.handle(resp);
  assert.strictEqual(histories.length, 1);
});

test("an empty history response emits nothing", () => {
  const { r, histories } = reader();
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetItemAverageStats, { 1: 7, 2: 1, 3: 0, 255: 4 }));
  r.handle(response(MARKET_OPS.auctionGetItemAverageStats, { 0: [], 1: [], 2: [], 255: 4 }));
  assert.strictEqual(histories.length, 0);
});

// ── gold ───────────────────────────────────────────────────────────────────
test("gold prices are emitted with their timestamps", () => {
  const { r, gold } = reader();
  r.handle(joinAt("3005"));
  r.handle(response(MARKET_OPS.goldMarketGetAverageInfo, { 0: [4500, 4600], 1: [1000, 2000] }));
  assert.deepStrictEqual(gold[0].payload, { Prices: [4500, 4600], Timestamps: [1000, 2000] });
  assert.strictEqual(gold[0].topic, "goldprices.ingest");
});

test("gold needs no location — it is server-wide", () => {
  const { r, gold } = reader();
  r.handle(response(MARKET_OPS.goldMarketGetAverageInfo, { 0: [4500], 1: [1000] }));
  assert.strictEqual(gold.length, 1);
});

test("reset clears both the location and the pending history correlations", () => {
  const { r, histories, orders } = reader();
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetItemAverageStats, { 1: 7, 2: 1, 3: 0, 255: 3 }));
  r.reset();
  assert.strictEqual(r.locationId, null);
  r.handle(response(MARKET_OPS.auctionGetItemAverageStats, { 0: [1], 1: [10], 2: [100], 255: 3 }));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [order()] }));
  assert.strictEqual(histories.length + orders.length, 0);
});

// ── which item was queried ─────────────────────────────────────────────────
// Reported as "the Zander Trophy price is not being fetched by the sniffer":
// the monitor's counters never moved when that market page was opened, and
// there was no way to tell "the game never answered" from "the game answered
// and the book was empty". An empty list used to increment nothing at all.
//
// The request names the items. albiondata-client's operationAuctionGetOffers
// reads them from parameter 8 (`ItemIds []uint16`), with the category at 1 and
// the subcategory at 2. Correlating request → response through
// `messageId % cacheSize` — the same ring the history path already uses — is
// what lets the status line name the item it saw nothing for.
const ZANDER = "T6_FURNITUREITEM_TROPHY_FISH";
const lookupId = (n) => (n === 9738 ? ZANDER : n === 4 ? "T4_BAG" : null);

test("an EMPTY order book is counted, not swallowed", () => {
  const { r, orders } = reader({ lookupId });
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetOffers, { 8: [9738], 255: 11 }));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [], 255: 11 }));
  assert.strictEqual(r.stats.orderResponses, 0, "no book means no order response");
  assert.strictEqual(r.stats.emptyOrderResponses, 1);
  assert.strictEqual(r.stats.marketResponses, 1, "the game DID answer");
  // The emptiness is REPORTED: "the ask list was open and this item was not in
  // it" is what lets a row stop quoting a price the market no longer holds
  // (js/market-price-store.js stampBookSeen). It carries no orders, so the
  // consumer uploads nothing and prices nothing — it only stamps.
  assert.strictEqual(orders.length, 1, "the observation is emitted");
  assert.deepStrictEqual(orders[0].orders, [], "and it carries nothing to upload");
  assert.strictEqual(orders[0].city, "Caerleon");
  assert.strictEqual(orders[0].observed.side, "offer");
  assert.deepStrictEqual(orders[0].observed.itemIds, [ZANDER]);
});

test("an empty book with no city to attribute it to is not reported", () => {
  // No Join, no seed: the response cannot say WHICH market was empty, and a
  // stamp on the wrong city is worse than no stamp at all.
  const { r, orders } = reader({ lookupId });
  r.handle(request(MARKET_OPS.auctionGetOffers, { 8: [9738], 255: 11 }));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [], 255: 11 }));
  assert.strictEqual(orders.length, 0);
  assert.strictEqual(r.stats.emptyOrderResponses, 1, "still counted as an answer");
});

test("a book that came back names the items it was read for", () => {
  const { r, orders } = reader({ lookupId });
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetOffers, { 8: [9738], 255: 11 }));
  r.handle(response(MARKET_OPS.auctionGetOffers, {
    0: [order({ ItemTypeId: ZANDER, LocationId: "3005" })],
    255: 11,
  }));
  assert.strictEqual(orders.length, 1);
  assert.strictEqual(orders[0].observed.side, "offer");
  assert.deepStrictEqual(orders[0].observed.itemIds, [ZANDER]);
});

test("an empty book names the item that was queried", () => {
  const { r } = reader({ lookupId });
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetOffers, { 8: [9738], 255: 11 }));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [], 255: 11 }));
  assert.strictEqual(r.stats.lastQueries.length, 1);
  assert.strictEqual(r.stats.lastQueries[0].itemId, ZANDER);
  assert.strictEqual(r.stats.lastQueries[0].count, 0);
  assert.strictEqual(r.stats.lastQueries[0].city, "Caerleon");
});

test("a non-empty book counts as an order response, not an empty one", () => {
  const { r, orders } = reader({ lookupId });
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetOffers, { 8: [4], 255: 12 }));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [order()], 255: 12 }));
  assert.strictEqual(orders.length, 1);
  assert.strictEqual(r.stats.orderResponses, 1);
  assert.strictEqual(r.stats.emptyOrderResponses, 0);
  assert.strictEqual(r.stats.marketResponses, 1);
  assert.strictEqual(r.stats.lastQueries[0].itemId, "T4_BAG");
  assert.strictEqual(r.stats.lastQueries[0].count, 1);
});

test("a response with no matching request is still counted, unnamed", () => {
  const { r } = reader({ lookupId });
  r.handle(joinAt("3005"));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [], 255: 99 }));
  assert.strictEqual(r.stats.emptyOrderResponses, 1);
  assert.strictEqual(r.stats.lastQueries[0].itemId, null);
});

test("a query the index cannot name keeps the raw wire id", () => {
  const { r } = reader({ lookupId });
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetOffers, { 8: [65000], 255: 13 }));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [], 255: 13 }));
  assert.strictEqual(r.stats.lastQueries[0].itemId, null);
  assert.strictEqual(r.stats.lastQueries[0].albionId, 65000);
});

test("negative wire item ids are corrected before the lookup", () => {
  const seen = [];
  const { r } = reader({ lookupId: (n) => { seen.push(n); return null; } });
  r.handle(joinAt("3005"));
  // -118 on the wire is 138; the reference client adds 256 back.
  r.handle(request(MARKET_OPS.auctionGetOffers, { 8: [-118], 255: 14 }));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [], 255: 14 }));
  assert.deepStrictEqual(seen, [138]);
});

test("a multi-item query records every item it asked about", () => {
  const { r } = reader({ lookupId });
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetOffers, { 8: [9738, 4], 255: 15 }));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [], 255: 15 }));
  assert.deepStrictEqual(r.stats.lastQueries.map((q) => q.itemId), [ZANDER, "T4_BAG"]);
});

// The reported line: `#0 · Lymhurst · 12 buy`, four times over, on a market the
// capture was reading correctly. `Number(n) || 0` turned every value it could
// not parse into item zero, so an unreadable query printed as a confident
// (wrong) item number instead of admitting it was unreadable.
test("a query naming items by their unique id keeps the name", () => {
  const { r } = reader({ lookupId });
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetOffers, { 8: ["T4_LEATHER"], 255: 20 }));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [], 255: 20 }));
  assert.strictEqual(r.stats.lastQueries[0].itemId, "T4_LEATHER");
  assert.strictEqual(r.stats.lastQueries[0].albionId, null);
});

test("item ids arriving as a byte array are unknown, never item zero", () => {
  const { r } = reader({ lookupId });
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetOffers, { 8: Buffer.from([0x12, 0x34]), 255: 21 }));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [], 255: 21 }));
  assert.strictEqual(r.stats.lastQueries[0].itemId, null);
  assert.strictEqual(r.stats.lastQueries[0].albionId, null);
});

const UNREADABLE_IDS = [["nothing at all", null], ["an empty string", ""], ["a zero", 0]];
UNREADABLE_IDS.forEach(([label, value], i) => {
  test(`an item id that is ${label} is unknown, not item zero`, () => {
    const { r } = reader({ lookupId });
    r.handle(joinAt("3005"));
    r.handle(request(MARKET_OPS.auctionGetOffers, { 8: [value], 255: 30 + i }));
    r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [], 255: 30 + i }));
    assert.strictEqual(r.stats.lastQueries[0].albionId, null);
    assert.strictEqual(r.stats.lastQueries[0].itemId, null);
  });
});

// An unreadable request is not the end of it: the orders that came back name
// their own item, and that is the item the query was about.
test("an unnamed query is named by the orders that answered it", () => {
  const { r } = reader({ lookupId });
  r.handle(joinAt("3005"));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [order(), order({ Id: 2 })], 255: 40 }));
  assert.strictEqual(r.stats.lastQueries[0].itemId, "T4_BAG");
});

test("orders naming different items leave the query unnamed rather than guess", () => {
  const { r } = reader({ lookupId });
  r.handle(joinAt("3005"));
  r.handle(response(MARKET_OPS.auctionGetOffers, {
    0: [order(), order({ Id: 2, ItemTypeId: "T5_BAG" })], 255: 41,
  }));
  assert.strictEqual(r.stats.lastQueries[0].itemId, null);
});

// A category BROWSE — the Black Market opened with no search term — answers
// with one page of orders for dozens of different items and no request to pair
// it with. Reported as "Elder's Hellion Shoes Black Market price not detected
// by the sniffer": the price WAS captured, but the query named none of those
// items, so the diagnostics printed a bare "?" and, worse, not one of those
// books was stamped as read.
test("a mixed browse reports EVERY item whose book it read", () => {
  const { r, orders } = reader({ lookupId });
  r.handle(joinAt("3003"));
  r.handle(response(MARKET_OPS.auctionGetRequests, {
    0: [
      order({ Id: 1, ItemTypeId: "T8_SHOES_LEATHER_HELL", EnchantmentLevel: 4, QualityLevel: 3, AuctionType: "request" }),
      order({ Id: 2, ItemTypeId: "T8_HEAD_PLATE_HELL", EnchantmentLevel: 4, AuctionType: "request" }),
      order({ Id: 3, ItemTypeId: "T8_2H_BOW_HELL", AuctionType: "request" }),
    ],
    255: 71,
  }));
  assert.deepStrictEqual(orders[0].observed.itemIds, [
    "T8_SHOES_LEATHER_HELL@4", "T8_HEAD_PLATE_HELL@4", "T8_2H_BOW_HELL",
  ], "the enchant is folded in, as it is on the price the stamp describes");
  assert.strictEqual(orders[0].observed.side, "request");
  assert.strictEqual(orders[0].city, "Black Market");
  assert.strictEqual(orders[0].observed.derived, true,
    "the items were read off the page, so the page is not the whole of their books");
});

test("a mixed browse is ONE log line, counted rather than named", () => {
  const { r } = reader({ lookupId });
  r.handle(joinAt("3003"));
  r.handle(response(MARKET_OPS.auctionGetRequests, {
    0: [order({ Id: 1 }), order({ Id: 2, ItemTypeId: "T5_BAG" }), order({ Id: 3, ItemTypeId: "T6_BAG" })],
    255: 72,
  }));
  assert.strictEqual(r.stats.lastQueries.length, 1);
  assert.strictEqual(r.stats.lastQueries[0].itemId, null);
  assert.strictEqual(r.stats.lastQueries[0].itemCount, 3);
  assert.strictEqual(r.stats.lastQueries[0].count, 3, "orders, not items");
});

test("the same item at different enchants is not one item", () => {
  const { r, orders } = reader({ lookupId });
  r.handle(joinAt("3003"));
  r.handle(response(MARKET_OPS.auctionGetRequests, {
    0: [order({ Id: 1, EnchantmentLevel: 0 }), order({ Id: 2, EnchantmentLevel: 2 })],
    255: 73,
  }));
  assert.deepStrictEqual(orders[0].observed.itemIds, ["T4_BAG", "T4_BAG@2"]);
});

test("a single-item browse still names its item, enchant and all", () => {
  const { r, orders } = reader({ lookupId });
  r.handle(joinAt("3003"));
  r.handle(response(MARKET_OPS.auctionGetRequests, {
    0: [order({ Id: 1, EnchantmentLevel: 4 }), order({ Id: 2, EnchantmentLevel: 4 })],
    255: 74,
  }));
  assert.strictEqual(r.stats.lastQueries[0].itemId, "T4_BAG@4");
  assert.deepStrictEqual(orders[0].observed.itemIds, ["T4_BAG@4"]);
});

// Behaviour changed 2026-09-11: this used to pin the REQUEST's name. After a
// game patch shifted the numeric ids, that name was simply wrong, and a reader
// trusting it filed a week of book reads under other items. An order names its
// own item; when the two disagree the order wins (market-query-item-index-drift).
test("a named query whose answer names another item is filed under the answer's", () => {
  const { r, orders } = reader({ lookupId });
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetOffers, { 8: [9738], 255: 42 }));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [order()], 255: 42 }));
  assert.strictEqual(r.stats.lastQueries[0].itemId, "T4_BAG");
  assert.deepStrictEqual(orders[0].observed.itemIds, ["T4_BAG"]);
});

test("a numeric id sent as a string is still read as a number", () => {
  const { r } = reader({ lookupId });
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetOffers, { 8: ["9738"], 255: 22 }));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [], 255: 22 }));
  assert.strictEqual(r.stats.lastQueries[0].itemId, ZANDER);
  assert.strictEqual(r.stats.lastQueries[0].albionId, 9738);
});

test("the buy side is labelled apart from the sell side", () => {
  const { r } = reader({ lookupId });
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetRequests, { 8: [9738], 255: 16 }));
  r.handle(response(MARKET_OPS.auctionGetRequests, { 0: [], 255: 16 }));
  assert.strictEqual(r.stats.lastQueries[0].side, "request");
});

test("the query log is bounded", () => {
  const { r } = reader({ lookupId, queryLogSize: 3 });
  r.handle(joinAt("3005"));
  for (let i = 0; i < 10; i++) {
    r.handle(request(MARKET_OPS.auctionGetOffers, { 8: [9738], 255: 100 + i }));
    r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [], 255: 100 + i }));
  }
  assert.strictEqual(r.stats.lastQueries.length, 3);
});

test("an order list on an unknown operation still counts as a market response", () => {
  const { r } = reader({ lookupId });
  r.handle(joinAt("3005"));
  r.handle(response(137, { 0: [order()] }));
  assert.strictEqual(r.stats.marketResponses, 1);
});

test("reset clears the query correlations and the log", () => {
  const { r } = reader({ lookupId });
  r.handle(joinAt("3005"));
  r.handle(request(MARKET_OPS.auctionGetOffers, { 8: [9738], 255: 21 }));
  r.reset();
  assert.deepStrictEqual(r.stats.lastQueries, []);
  assert.strictEqual(r.stats.emptyOrderResponses, 0);
  assert.strictEqual(r.stats.marketResponses, 0);
  r.handle(joinAt("3005"));
  r.handle(response(MARKET_OPS.auctionGetOffers, { 0: [], 255: 21 }));
  assert.strictEqual(r.stats.lastQueries[0].itemId, null, "the pre-reset request is gone");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
