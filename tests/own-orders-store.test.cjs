/**
 * Tests for the orders that are YOURS.
 *
 * The app's price map holds "the cheapest ask" and "the fattest bid" and has no
 * idea who placed them. Two consequences were reported from the live app:
 *
 *   - a Flipping row quoted the player's OWN Black Market listing back at them
 *     as the best sell price on the board — a profit computed against yourself,
 *   - closing that order changed nothing, because the only thing that can
 *     correct a stored price is the player happening to reopen that book in
 *     game. Selling into a bid is not a reading of the book it emptied.
 *
 * This store answers both from the player's own market traffic: which standing
 * orders are theirs, and which books a trade of theirs just invalidated. The
 * second answer is deliberately a STAMP and not a price — "this book was read
 * and your number was not in it" is the vocabulary the rest of the app already
 * has (sell_seen / buy_seen, js/price-freshness.js). A capture must never
 * invent a price, and must never delete one.
 *
 * Run: node tests/own-orders-store.test.cjs
 */

const assert = require("assert");
const {
  createOwnOrders, recordOwnOrders, isOwnPrice, invalidateFromAction,
  invalidateBooks, ownOrderKey, OWN_ORDER_ACTIONS,
} = require("../js/own-orders-store.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const NOW = "2026-08-22T14:00:00.000Z";
const LATER = "2026-08-22T14:05:00.000Z";

/** One wire order. Silver is ×10000 on the wire, as everywhere else. */
const order = (over = {}) => ({
  Id: 1,
  ItemTypeId: "T7_2H_WARBOW",
  LocationId: "3003",
  QualityLevel: 1,
  EnchantmentLevel: 0,
  UnitPriceSilver: 373848 * 10000,
  Amount: 1,
  AuctionType: "offer",
  ...over,
});

// ── the key ────────────────────────────────────────────────────────────────

test("the key names item, quality, city and side", () => {
  assert.strictEqual(
    ownOrderKey("T7_2H_WARBOW", 1, "Black Market", "sell"),
    "T7_2H_WARBOW|1|Black Market|sell",
  );
});

test("enchantment is part of the item id, as it is everywhere else", () => {
  const state = createOwnOrders();
  recordOwnOrders(state, {
    action: "mine",
    orders: [order({ ItemTypeId: "T8_BAG", EnchantmentLevel: 4, LocationId: "" })],
    city: "Caerleon",
    now: NOW,
  });
  assert.ok(isOwnPrice(state, "T8_BAG@4", 1, "Caerleon", "sell", 373848));
  assert.ok(!isOwnPrice(state, "T8_BAG", 1, "Caerleon", "sell", 373848));
});

// ── recording ──────────────────────────────────────────────────────────────

[
  ["mine", true],
  ["listed", true],
  ["cancelled", false],
  ["sold", false],
  ["bought", false],
].forEach(([action, stands]) => {
  test(`"${action}" ${stands ? "records" : "clears"} the order as yours`, () => {
    const state = createOwnOrders();
    recordOwnOrders(state, { action: "mine", orders: [order()], city: "Black Market", now: NOW });
    recordOwnOrders(state, { action, orders: [order()], city: "Black Market", now: LATER });
    assert.strictEqual(
      isOwnPrice(state, "T7_2H_WARBOW", 1, "Black Market", "sell", 373848),
      stands,
    );
  });
});

test("the wire's ×10000 silver is divided, as the price map does", () => {
  const state = createOwnOrders();
  recordOwnOrders(state, { action: "mine", orders: [order()], city: "Black Market", now: NOW });
  assert.ok(isOwnPrice(state, "T7_2H_WARBOW", 1, "Black Market", "sell", 373848));
  assert.ok(!isOwnPrice(state, "T7_2H_WARBOW", 1, "Black Market", "sell", 3738480000));
});

test("an ask is the sell side and a bid is the buy side", () => {
  const state = createOwnOrders();
  recordOwnOrders(state, {
    action: "mine",
    orders: [order({ AuctionType: "request", UnitPriceSilver: 25260 * 10000 })],
    city: "Black Market",
    now: NOW,
  });
  assert.ok(isOwnPrice(state, "T7_2H_WARBOW", 1, "Black Market", "buy", 25260));
  assert.ok(!isOwnPrice(state, "T7_2H_WARBOW", 1, "Black Market", "sell", 25260));
});

test("a price that is not yours is not claimed", () => {
  const state = createOwnOrders();
  recordOwnOrders(state, { action: "mine", orders: [order()], city: "Black Market", now: NOW });
  assert.ok(!isOwnPrice(state, "T7_2H_WARBOW", 1, "Black Market", "sell", 548994));
  assert.ok(!isOwnPrice(state, "T7_2H_WARBOW", 1, "Caerleon", "sell", 373848));
  assert.ok(!isOwnPrice(state, "T8_2H_WILDSTAFF", 1, "Black Market", "sell", 373848));
});

test("two of your orders on one book both stand", () => {
  const state = createOwnOrders();
  recordOwnOrders(state, {
    action: "mine",
    orders: [order(), order({ Id: 2, UnitPriceSilver: 400000 * 10000 })],
    city: "Black Market",
    now: NOW,
  });
  assert.ok(isOwnPrice(state, "T7_2H_WARBOW", 1, "Black Market", "sell", 373848));
  assert.ok(isOwnPrice(state, "T7_2H_WARBOW", 1, "Black Market", "sell", 400000));
});

test("cancelling one of two leaves the other standing", () => {
  const state = createOwnOrders();
  recordOwnOrders(state, {
    action: "mine",
    orders: [order(), order({ Id: 2, UnitPriceSilver: 400000 * 10000 })],
    city: "Black Market",
    now: NOW,
  });
  recordOwnOrders(state, { action: "cancelled", orders: [order()], city: "Black Market", now: LATER });
  assert.ok(!isOwnPrice(state, "T7_2H_WARBOW", 1, "Black Market", "sell", 373848));
  assert.ok(isOwnPrice(state, "T7_2H_WARBOW", 1, "Black Market", "sell", 400000));
});

test("a listing with no readable item is ignored rather than filed under nothing", () => {
  const state = createOwnOrders();
  const written = recordOwnOrders(state, {
    action: "mine",
    orders: [order({ ItemTypeId: "" }), order({ ItemTypeId: null })],
    city: "Black Market",
    now: NOW,
  });
  assert.strictEqual(written, 0);
});

test("a city the app does not price is skipped", () => {
  const state = createOwnOrders();
  const written = recordOwnOrders(state, {
    action: "mine", orders: [order({ LocationId: "" })], city: null, now: NOW,
  });
  assert.strictEqual(written, 0);
});

test("the order's own location outranks a missing city, as it does in the price map", () => {
  const state = createOwnOrders();
  recordOwnOrders(state, {
    action: "mine",
    orders: [order({ LocationId: "3005" })],
    city: null,
    now: NOW,
  });
  assert.ok(isOwnPrice(state, "T7_2H_WARBOW", 1, "Caerleon", "sell", 373848));
});

// ── invalidation ───────────────────────────────────────────────────────────

[
  ["cancelled", true],
  ["sold", true],
  ["bought", true],
  ["listed", false],
  ["mine", false],
].forEach(([action, invalidates]) => {
  test(`"${action}" ${invalidates ? "stamps" : "does not stamp"} the book it touched`, () => {
    const patch = invalidateFromAction({
      action, orders: [order()], city: "Black Market", now: NOW,
    });
    const cell = patch?.T7_2H_WARBOW?.[1]?.["Black Market"];
    if (!invalidates) {
      assert.deepStrictEqual(patch, {});
      return;
    }
    assert.strictEqual(cell.sell_seen, NOW);
  });
});

test("the stamp lands on the side the order was on", () => {
  const patch = invalidateFromAction({
    action: "sold",
    orders: [order({ AuctionType: "request" })],
    city: "Black Market",
    now: NOW,
  });
  const cell = patch.T7_2H_WARBOW[1]["Black Market"];
  assert.strictEqual(cell.buy_seen, NOW);
  assert.strictEqual(cell.sell_seen, undefined);
});

test("the stamp carries no price — a trade is not a reading of a book", () => {
  const patch = invalidateFromAction({
    action: "sold", orders: [order()], city: "Black Market", now: NOW,
  });
  const cell = patch.T7_2H_WARBOW[1]["Black Market"];
  assert.strictEqual(cell.sell_price, 0);
  assert.strictEqual(cell.buy_price, 0);
  assert.strictEqual(cell.sell_date, null);
  assert.strictEqual(cell.buy_date, null);
});

test("only the quality traded is stamped", () => {
  const patch = invalidateFromAction({
    action: "sold",
    orders: [order({ QualityLevel: 3 })],
    city: "Black Market",
    now: NOW,
  });
  assert.ok(patch.T7_2H_WARBOW[3]["Black Market"]);
  assert.strictEqual(patch.T7_2H_WARBOW[1], undefined);
});

test("several orders in one action stamp several books", () => {
  const patch = invalidateFromAction({
    action: "cancelled",
    orders: [
      order(),
      order({ Id: 2, ItemTypeId: "T8_2H_WILDSTAFF", QualityLevel: 2, AuctionType: "request" }),
    ],
    city: "Black Market",
    now: NOW,
  });
  assert.strictEqual(patch.T7_2H_WARBOW[1]["Black Market"].sell_seen, NOW);
  assert.strictEqual(patch.T8_2H_WILDSTAFF[2]["Black Market"].buy_seen, NOW);
});

test("an unknown action is inert on both halves", () => {
  const state = createOwnOrders();
  const written = recordOwnOrders(state, {
    action: "browsed", orders: [order()], city: "Black Market", now: NOW,
  });
  assert.strictEqual(written, 0);
  assert.deepStrictEqual(
    invalidateFromAction({ action: "browsed", orders: [order()], city: "Black Market", now: NOW }),
    {},
  );
});

test("the action vocabulary is closed and named", () => {
  assert.deepStrictEqual(
    [...OWN_ORDER_ACTIONS].sort(),
    ["bought", "cancelled", "listed", "mine", "sold"],
  );
});

test("a response naming no order stamps no book at all", () => {
  // Reported as the false "not listed · looked 29h ago" badge on a still
  // listed item: the blanket stamp claimed every lastBook book had been read
  // and their prices were gone, when nobody had read them — the post-trade
  // re-read is often not captured. Only a response naming an order is
  // evidence about a book.
  assert.deepStrictEqual(
    invalidateBooks({ itemIds: ["T7_2H_WARBOW", "T4_BAG"], city: "Black Market", side: "offer", now: NOW }),
    {},
  );
  assert.deepStrictEqual(
    invalidateBooks({ itemIds: ["T7_2H_WARBOW"], city: "Black Market", side: "request", now: NOW }),
    {},
  );
  assert.deepStrictEqual(invalidateBooks({ now: NOW }), {});
});

test("no orders is not a crash", () => {
  const state = createOwnOrders();
  assert.strictEqual(recordOwnOrders(state, { action: "mine", orders: null, city: "Caerleon", now: NOW }), 0);
  assert.deepStrictEqual(invalidateFromAction({ action: "sold", orders: undefined, city: "Caerleon", now: NOW }), {});
  assert.strictEqual(isOwnPrice(state, "T4_BAG", 1, "Caerleon", "sell", 10), false);
  assert.strictEqual(isOwnPrice(null, "T4_BAG", 1, "Caerleon", "sell", 10), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
