/**
 * Test: a capture records that a book was LOOKED AT, not only what was in it.
 *
 * Reported: the Flipping row for the Grandmaster's Rootbound Staff advertised
 * `Buy Caerleon 549,999 -> Black Market 755,274, 31.83%` while the player was
 * standing in that market with the book open. Nothing Normal was listed there
 * at all; 549,999 was a two-day-old AODP reading. The sniffer had just proved
 * the offer was gone and the app had no way to say so, because a zero side in
 * a patch means "not observed" and must never erase a price
 * (mergeEntry, js/market-price-store.js).
 *
 * So an observation is now recorded in its own right: `sell_seen` / `buy_seen`
 * stamp the moment the book behind that side was read. A price older than the
 * stamp beside it was not in the book when it was last opened, and the cell
 * says so instead of quoting it as an opportunity. The price is FLAGGED, never
 * deleted: order lists arrive in pages and packets get dropped, so a later page
 * carrying the missing offer must be able to clear the flag by itself.
 *
 * Black-box: real js/market-price-store.js, js/captured-prices-store.js and
 * js/price-freshness.js against synthetic order lists. No DOM, no live API.
 *
 * Run: node tests/market-book-observed.test.cjs
 */

const path = require("path");
const assert = require("assert");

const store = require(path.join(__dirname, "..", "js", "market-price-store.js"));
const captured = require(path.join(__dirname, "..", "js", "captured-prices-store.js"));
const fresh = require(path.join(__dirname, "..", "js", "price-freshness.js"));

const { ordersToPrices, mergeQualityPrices, flattenQuality } = store;

const CAE = "Caerleon";
const CAE_LOCATION = "3005";
const ID = "T7_2H_SHAPESHIFTER_SET2";
const T0 = "2026-08-20T15:20:00.000Z";
const T1 = "2026-08-22T06:02:52.000Z";
const T2 = "2026-08-22T07:00:00.000Z";

/** One wire order. Silver is x10000 on the wire. */
function order(price, { quality = 1, type = "offer", id = ID } = {}) {
  return {
    ItemTypeId: id,
    EnchantmentLevel: 0,
    QualityLevel: quality,
    UnitPriceSilver: price * 10000,
    AuctionType: type,
    LocationId: CAE_LOCATION,
  };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

console.log("Captured book-observed tests\n");

// -- Stamping ------------------------------------------------------------
test("an offers response stamps sell_seen and leaves buy_seen alone", () => {
  const map = ordersToPrices([order(698874, { quality: 2 })], {
    now: T1, observed: { side: "offer", itemIds: [ID] }, city: CAE,
  });
  assert.strictEqual(map[ID][1][CAE].sell_seen, T1, "the Normal book was read too");
  assert.strictEqual(map[ID][1][CAE].buy_seen, undefined, "the bids were not");
  assert.strictEqual(map[ID][2][CAE].sell_seen, T1, "and so was the Good book");
});

test("a requests response stamps buy_seen and leaves sell_seen alone", () => {
  const map = ordersToPrices([order(10, { type: "request" })], {
    now: T1, observed: { side: "request", itemIds: [ID] }, city: CAE,
  });
  assert.strictEqual(map[ID][1][CAE].buy_seen, T1);
  assert.strictEqual(map[ID][1][CAE].sell_seen, undefined);
});

test("the reported case: an all-Good book leaves a stamped, price-less Normal cell", () => {
  const map = ordersToPrices(
    [order(698874, { quality: 2 }), order(698941, { quality: 3 })],
    { now: T1, observed: { side: "offer", itemIds: [ID] }, city: CAE },
  );
  const normal = map[ID][1][CAE];
  assert.strictEqual(normal.sell_price, 0, "a stamp is not a price");
  assert.strictEqual(normal.sell_seen, T1);
  assert.strictEqual(map[ID][2][CAE].sell_price, 698874);
});

test("an empty response still stamps the item that was asked about", () => {
  const map = ordersToPrices([], {
    now: T1, observed: { side: "offer", itemIds: [ID] }, city: CAE,
  });
  assert.strictEqual(map[ID][1][CAE].sell_seen, T1);
  assert.strictEqual(map[ID][1][CAE].sell_price, 0);
});

test("no observation, or no city, stamps nothing", () => {
  const plain = ordersToPrices([order(1000)], { now: T1 });
  assert.strictEqual(plain[ID][1][CAE].sell_seen, undefined);
  const cityless = ordersToPrices([], { now: T1, observed: { side: "offer", itemIds: [ID] } });
  assert.deepStrictEqual(cityless, {}, "a market the app does not price gets no cell");
});

test("an unreadable queried id is skipped rather than filed under null", () => {
  const map = ordersToPrices([], {
    now: T1, observed: { side: "offer", itemIds: [null, "", ID] }, city: CAE,
  });
  assert.deepStrictEqual(Object.keys(map), [ID]);
});

// -- The stale condition -------------------------------------------------
test("a price older than the stamp beside it reads as gone from the book", () => {
  const entry = { sell_price: 549999, sell_date: T0, sell_seen: T1 };
  assert.strictEqual(fresh.bookEmptySince(entry, "buy", "instant"), T1,
    "buy + instant prints the ask, so the ask's stamp is the one that counts");
  assert.strictEqual(fresh.bookEmptySince(entry, "buy", "market"), null,
    "buy + market prints the bid, which nothing here says was read");
});

test("a price as new as the stamp is still in the book", () => {
  const entry = { sell_price: 698874, sell_date: T1, sell_seen: T1 };
  assert.strictEqual(fresh.bookEmptySince(entry, "buy", "instant"), null);
});

test("a later page carrying the missing offer clears the flag by itself", () => {
  // Page one is all Good, page two brings the Normal ask. The stamp does not
  // move backwards and the price is newer than it, so the row un-flags.
  let cell = ordersToPrices([order(698874, { quality: 2 })], {
    now: T1, observed: { side: "offer", itemIds: [ID] }, city: CAE,
  })[ID][1][CAE];
  assert.strictEqual(fresh.bookEmptySince(cell, "buy", "instant"), T1);

  const page2 = ordersToPrices([order(600000, { quality: 1 })], {
    now: T2, observed: { side: "offer", itemIds: [ID] }, city: CAE,
  })[ID][1][CAE];
  const merged = { ...cell, ...page2 };
  assert.strictEqual(fresh.bookEmptySince(merged, "buy", "instant"), null);
});

test("no stamp at all behaves exactly as before", () => {
  assert.strictEqual(fresh.bookEmptySince({ sell_price: 1, sell_date: T0 }, "buy", "instant"), null);
  assert.strictEqual(fresh.bookEmptySince(null, "buy", "instant"), null);
});

// -- Paged reads of one book --------------------------------------------
/**
 * Reported: `Grandmaster's Bow [T7] · Buy Caerleon 124,995 · 7m ago` carried a
 * red "not listed · looked 7m ago" while the bow was plainly on the board.
 *
 * The stored cell explains it: `sell_date 12:41:24.850`, `sell_seen
 * 12:41:35.033` — ten seconds apart. A market CATEGORY browse answers in
 * price-ascending pages, each page a slice of dozens of different items, so the
 * page that carried the bow's Normal ask at 124,995 was followed by a dearer
 * page carrying only its Outstanding ask at 255,000. That later page stamped
 * the item as read, and the Normal price — still the cheapest on the board —
 * was suddenly "older than the last look".
 *
 * Two readings this close together are one LOOK at the book, not a look and a
 * later re-look, so they cannot be evidence against each other.
 */
test("a page arriving seconds after the price does not flag it as gone", () => {
  const priced = "2026-08-22T12:41:24.850Z";
  const seen = "2026-08-22T12:41:35.033Z";
  const entry = { sell_price: 124995, sell_date: priced, sell_seen: seen };
  assert.strictEqual(fresh.bookEmptySince(entry, "buy", "instant"), null);
});

test("a re-read well after the price still flags it", () => {
  const priced = "2026-08-22T12:41:24.850Z";
  const later = "2026-08-22T12:45:00.000Z";
  const entry = { sell_price: 124995, sell_date: priced, sell_seen: later };
  assert.strictEqual(fresh.bookEmptySince(entry, "buy", "instant"), later,
    "three minutes on is a second visit to the market, and the ask was not in it");
});

test("the cheapest ask of a burst survives a dearer page of the same browse", () => {
  const page1 = ordersToPrices([order(124995, { quality: 1 })], {
    now: "2026-08-22T12:41:24.850Z", observed: { side: "offer", itemIds: [ID] }, city: CAE,
  });
  const page2 = ordersToPrices([order(255000, { quality: 1 })], {
    now: "2026-08-22T12:41:35.033Z", observed: { side: "offer", itemIds: [ID] }, city: CAE,
  });
  const target = {};
  mergeQualityPrices(target, page1);
  mergeQualityPrices(target, page2);
  const cell = target[ID][1][CAE];
  assert.strictEqual(cell.sell_price, 124995, "the board's cheapest ask, not the last page's");
  assert.strictEqual(cell.sell_date, "2026-08-22T12:41:24.850Z");
  assert.strictEqual(cell.sell_seen, "2026-08-22T12:41:35.033Z", "the look still moves forward");
  assert.strictEqual(fresh.bookEmptySince(cell, "buy", "instant"), null);
});

test("the fattest bid of a burst survives a thinner page of the same browse", () => {
  const target = {};
  mergeQualityPrices(target, ordersToPrices([order(200000, { type: "request" })], {
    now: "2026-08-22T12:41:24.850Z", observed: { side: "request", itemIds: [ID] }, city: CAE,
  }));
  mergeQualityPrices(target, ordersToPrices([order(100000, { type: "request" })], {
    now: "2026-08-22T12:41:35.033Z", observed: { side: "request", itemIds: [ID] }, city: CAE,
  }));
  assert.strictEqual(target[ID][1][CAE].buy_price, 200000);
});

test("a later visit does replace the price, cheaper or dearer", () => {
  const target = {};
  mergeQualityPrices(target, ordersToPrices([order(124995)], {
    now: "2026-08-22T12:41:24.850Z", observed: { side: "offer", itemIds: [ID] }, city: CAE,
  }));
  mergeQualityPrices(target, ordersToPrices([order(255000)], {
    now: "2026-08-22T13:10:00.000Z", observed: { side: "offer", itemIds: [ID] }, city: CAE,
  }));
  assert.strictEqual(target[ID][1][CAE].sell_price, 255000,
    "half an hour on, the cheap ask is simply gone");
});

test("the session map folds pages the same way the live map does", () => {
  const page1 = { sell_price: 124995, sell_date: "2026-08-22T12:41:24.850Z", sell_seen: "2026-08-22T12:41:24.850Z" };
  const page2 = { sell_price: 255000, sell_date: "2026-08-22T12:41:35.033Z", sell_seen: "2026-08-22T12:41:35.033Z" };
  const out = captured.capFoldEntry(page1, page2);
  assert.strictEqual(out.sell_price, 124995);
  assert.strictEqual(out.sell_date, "2026-08-22T12:41:24.850Z");
  assert.strictEqual(out.sell_seen, "2026-08-22T12:41:35.033Z");
});

/**
 * A browse page names the items it happens to carry (`observed.derived`) — it
 * was never a request for any of their books. Stamping Normal off one of those
 * pages is the same false accusation as the paging one above, only with hours
 * between the readings instead of seconds: the page held the item at
 * Outstanding alone, and every Normal price in the app older than it went red.
 */
test("a browse page stamps only the qualities it actually carried", () => {
  const map = ordersToPrices([order(255000, { quality: 4 })], {
    now: T1, observed: { side: "offer", itemIds: [ID], derived: true }, city: CAE,
  });
  assert.strictEqual(map[ID][4][CAE].sell_seen, T1, "the quality it carried was read");
  assert.ok(!map[ID][1], "and Normal was not: the page never asked about it");
});

test("a named query still stamps the whole book, Normal included", () => {
  const map = ordersToPrices([order(255000, { quality: 4 })], {
    now: T1, observed: { side: "offer", itemIds: [ID] }, city: CAE,
  });
  assert.strictEqual(map[ID][1][CAE].sell_seen, T1,
    "the item's own book came back without a Normal ask in it");
});

test("a browse page that carried nothing at all is not a reading of the book", () => {
  // Its orders may all have been excluded from the priced patch — an
  // unpriceable location, a bad price or type. A slice that shows an item
  // nothing is silence, not "the book is empty"; only a NAMED query earns
  // the whole-book stamp.
  const map = ordersToPrices([], {
    now: T1, observed: { side: "offer", itemIds: [ID], derived: true }, city: CAE,
  });
  assert.deepStrictEqual(map, {}, "no blank cell, no stamp");
});

// -- Carrying the stamp through every fold -------------------------------
test("mergeQualityPrices keeps the newer stamp and never loses one", () => {
  const target = {};
  mergeQualityPrices(target, ordersToPrices([order(1000)], {
    now: T1, observed: { side: "offer", itemIds: [ID] }, city: CAE,
  }));
  // A bids-only response: it must add buy_seen without dropping sell_seen.
  mergeQualityPrices(target, ordersToPrices([order(10, { type: "request" })], {
    now: T2, observed: { side: "request", itemIds: [ID] }, city: CAE,
  }));
  assert.strictEqual(target[ID][1][CAE].sell_seen, T1);
  assert.strictEqual(target[ID][1][CAE].buy_seen, T2);
});

test("an older stamp never replaces a newer one", () => {
  const target = {};
  mergeQualityPrices(target, ordersToPrices([], {
    now: T2, observed: { side: "offer", itemIds: [ID] }, city: CAE,
  }));
  mergeQualityPrices(target, ordersToPrices([], {
    now: T1, observed: { side: "offer", itemIds: [ID] }, city: CAE,
  }));
  assert.strictEqual(target[ID][1][CAE].sell_seen, T2, "a stale teammate patch must not win");
});

test("flattenQuality carries the stamp into the flat map", () => {
  const map = ordersToPrices([], { now: T1, observed: { side: "offer", itemIds: [ID] }, city: CAE });
  assert.strictEqual(flattenQuality(map, 1)[ID][CAE].sell_seen, T1);
});

test("capFoldOntoTarget carries the stamp onto a scanned cell", () => {
  // The scan knows a price; the capture knows the book no longer holds it.
  const scanned = { sell_price: 549999, sell_date: T0, buy_price: 3, buy_date: T0, volume_24h: 0 };
  const out = captured.capFoldOntoTarget(scanned, { sell_price: 0, sell_date: null, sell_seen: T1 });
  assert.strictEqual(out.sell_price, 549999, "the price survives - a stamp never deletes");
  assert.strictEqual(out.sell_seen, T1);
  assert.strictEqual(fresh.bookEmptySince(out, "buy", "instant"), T1);
});

test("capFoldOntoTarget keeps the newer of two stamps", () => {
  const a = captured.capFoldOntoTarget({ sell_seen: T2 }, { sell_seen: T1 });
  assert.strictEqual(a.sell_seen, T2);
  const b = captured.capFoldOntoTarget({ sell_seen: T1 }, { sell_seen: T2 });
  assert.strictEqual(b.sell_seen, T2);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
