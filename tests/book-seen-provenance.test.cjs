// Run: node --test tests/book-seen-provenance.test.cjs
/**
 * TDD spec: a "book was read" stamp (`sell_seen` / `buy_seen`) must carry
 * PROOF that the book was actually read. Two capture paths stamped without
 * it, and both produced the same false verdict in the crafting list: a cell
 * still holding a live price was badged `not listed · looked Xm ago`
 * (bookEmptySince, js/price-freshness.js) because something claimed its book
 * had been read and the price was not in it.
 *
 *   [1] A DERIVED observation — a category browse whose orders name no item —
 *       whose orders for the item were ALL excluded from the priced patch
 *       (an unpriceable location, a bad price or type) fell through to the
 *       whole-book "read, empty" stamp. A browse slice does not enumerate the
 *       book: absence in it proves nothing.   → stamp nothing (RED)
 *   [2] A derived page that DID price the item stamps only what it priced.
 *       (existing behavior, pinned)                              (GREEN)
 *   [3] A NAMED query — the game answered a request ABOUT the item — is a
 *       reading of the whole book, empty or not. (regression pin)(GREEN)
 *   [4] An own trade whose response names no order blanket-stamped every
 *       lastBook item at all qualities — also without a reading. → stamp
 *       nothing; a NAMED own trade still stamps the book it touched.
 *   [5] Legacy stamps are already persisted, so a code fix alone cannot
 *       clear them: the captured store gains a format marker. A store
 *       without it has every stamp stripped on load (once); a store with it
 *       keeps its stamps — including ones written after the migration.
 *
 * Black-box: real js/market-price-store.js, js/own-orders-store.js and
 * js/captured-prices-store.js against synthetic maps, a fake localStorage and
 * a fake file bridge. No DOM, no live API, no disk.
 */

const { test } = require("node:test");
const assert = require("assert");
const path = require("path");

const store = require(path.join(__dirname, "..", "js", "market-price-store.js"));
const own = require(path.join(__dirname, "..", "js", "own-orders-store.js"));
const captured = require(path.join(__dirname, "..", "js", "captured-prices-store.js"));

const { ordersToPrices, stampBookSeen } = store;

const BW = "Bridgewatch";
const CAE = "Caerleon";
const ID = "T6_MOUNT_MOOSE";
const NOW = "2026-09-16T12:00:00.000Z";
const OLD = "2026-09-01T00:00:00.000Z";

/** A cell as the stores shape them; fields left out are simply absent. */
function cell(over = {}) {
  return {
    sell_price: 0, buy_price: 0, sell_date: null, buy_date: null,
    volume_24h: 0, used_fallback: false, from_sniffer: true,
    ...over,
  };
}

// ── [1] a derived page that priced nothing for the item ──────────────────

test("[1a] a derived browse pricing nothing for the item stamps no book at all", () => {
  const map = ordersToPrices([], {
    now: NOW,
    observed: { side: "offer", itemIds: [ID], derived: true },
    city: BW,
  });
  // The old code created a quality-1 blank stamped "read, empty" here.
  assert.deepStrictEqual(map, {}, "absence in a browse slice proves nothing");
});

test("[1b] a patch holding no PRICED quality for the item is not a reading", () => {
  // A price-less cell can be in the patch (e.g. carried over); without a
  // priced quality there is nothing to say the page priced this book.
  const entry = cell(); // sell_price 0
  const map = { [ID]: { 1: { [BW]: entry } } };
  stampBookSeen(map, {
    now: NOW, observed: { side: "offer", itemIds: [ID], derived: true }, city: BW,
  });
  assert.strictEqual(map[ID][1][BW].sell_seen, undefined, "no sell_seen stamp appeared");
  assert.deepStrictEqual(map[ID][1][BW], entry, "the cell itself is untouched");
  assert.deepStrictEqual(Object.keys(map[ID]), ["1"], "no quality husks created");
});

test("[1d] a derived page whose orders sit in an unpriceable location stamps nothing", () => {
  // The reported case end to end: the page DID carry the item's orders, but
  // they were all excluded from the priced patch (an unpriced market), which
  // used to fall through to the whole-book "read, empty" stamp.
  const map = ordersToPrices(
    [{ ItemTypeId: ID, EnchantmentLevel: 0, QualityLevel: 1, UnitPriceSilver: 500 * 10000, AuctionType: "offer", LocationId: "3007" }],
    { now: NOW, observed: { side: "offer", itemIds: [ID], derived: true }, city: BW },
  );
  assert.deepStrictEqual(map, {}, "excluded orders are silence, not an empty book");
});

test("[1c] a derived browse naming an unknown item creates nothing either", () => {
  const map = {};
  stampBookSeen(map, {
    now: NOW, observed: { side: "request", itemIds: [ID], derived: true }, city: BW,
  });
  assert.deepStrictEqual(map, {});
});

// ── [2] a derived page stamps only what it priced ────────────────────────

test("[2] a derived browse stamps only the qualities it actually priced", () => {
  const map = ordersToPrices(
    [{ ItemTypeId: ID, EnchantmentLevel: 0, QualityLevel: 2, UnitPriceSilver: 255000 * 10000, AuctionType: "offer", LocationId: "2004" }],
    { now: NOW, observed: { side: "offer", itemIds: [ID], derived: true }, city: BW },
  );
  assert.strictEqual(map[ID][2][BW].sell_seen, NOW, "the quality it carried was read");
  assert.strictEqual(map[ID][1], undefined, "and Normal was not: the page never asked about it");
});

// ── [3] a NAMED query is still a reading of the whole book ───────────────

test("[3a] a named query that came back empty still stamps the whole book", () => {
  const map = ordersToPrices([], {
    now: NOW, observed: { side: "offer", itemIds: [ID] }, city: BW,
  });
  assert.strictEqual(map[ID][1][BW].sell_seen, NOW, "the book was read, and was empty");
  assert.strictEqual(map[ID][1][BW].sell_price, 0, "a stamp is not a price");
});

test("[3b] a named query stamps the priced qualities it found, Normal included", () => {
  const map = {
    [ID]: { 3: { [BW]: cell({ sell_price: 50, sell_date: NOW }) } },
  };
  stampBookSeen(map, { now: NOW, observed: { side: "offer", itemIds: [ID] }, city: BW });
  assert.strictEqual(map[ID][3][BW].sell_seen, NOW);
  assert.strictEqual(map[ID][1][BW].sell_seen, NOW, "quality 1 blank created for a named read");
});

// ── [4] own trades ───────────────────────────────────────────────────────

test("[4a] an own trade whose response names no order stamps no book", () => {
  // The old blanket stamp hit every item the game had answered about, at
  // every quality — without anyone reading those books.
  assert.deepStrictEqual(
    own.invalidateBooks({ itemIds: [ID, "T4_BAG"], city: BW, side: "offer", now: NOW }),
    {},
  );
  assert.deepStrictEqual(
    own.invalidateBooks({ itemIds: [ID], city: BW, side: "request", now: NOW }),
    {},
  );
  assert.deepStrictEqual(own.invalidateBooks({ now: NOW }), {});
});

test("[4b] a named own trade still stamps the book it touched", () => {
  const patch = own.invalidateFromAction({
    action: "sold",
    orders: [{
      ItemTypeId: ID, LocationId: "", QualityLevel: 1, EnchantmentLevel: 0,
      UnitPriceSilver: 500 * 10000, AuctionType: "offer",
    }],
    city: BW,
    now: NOW,
  });
  assert.strictEqual(patch[ID][1][BW].sell_seen, NOW);
  assert.strictEqual(patch[ID][1][BW].sell_price, 0, "a trade is not a reading — no price");
});

// ── [5] the persisted store: one-time strip of unproven stamps ───────────
//
// The persisted shape is the bare map, { itemId: { quality: { city: entry } } }
// — the same JSON under both backends (captured-prices.json via the bridge,
// the "capturedPrices" localStorage key). The marker is a top-level key no
// item id can collide with.

const MARKER_KEY = "$seenProof";
const MARKER = 1;

/** Every entry of a synthetic store carries this legacy stamp. */
const SEEN_LEGACY = "2026-09-10T08:00:00.000Z";
const SEEN_NEW = "2026-09-16T09:30:00.000Z";

function legacyStore() {
  return {
    [ID]: {
      1: { [BW]: cell({ sell_price: 100, sell_date: OLD, sell_seen: SEEN_LEGACY, buy_seen: SEEN_LEGACY }) },
      2: { [BW]: cell({ sell_price: 200, sell_date: OLD, sell_seen: SEEN_LEGACY }) },
    },
    T4_BAG: { 1: { [CAE]: cell({ buy_price: 5, buy_date: OLD, buy_seen: SEEN_LEGACY }) } },
  };
}

function fakeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

function fakeBridge(initial) {
  let stored = initial === undefined ? null : JSON.parse(JSON.stringify(initial));
  let saves = 0;
  return {
    load: async () => JSON.parse(JSON.stringify(stored)),
    save: async (map) => { saves++; stored = JSON.parse(JSON.stringify(map)); return true; },
    _stored: () => stored,
    _saves: () => saves,
  };
}

const loadOpts = { now: Date.parse(NOW) };

test("[5a] localStorage: a store without the marker loses every seen stamp on load", () => {
  const st = fakeStorage({
    capturedPrices: JSON.stringify(legacyStore()),
    capturedPricesVersion: "1",
  });
  const back = captured.loadCapturedPrices({ storage: st, ...loadOpts });
  assert.strictEqual(back[ID][1][BW].sell_price, 100, "prices survive the strip");
  assert.strictEqual(back[ID][1][BW].sell_seen, undefined, "sell_seen stripped");
  assert.strictEqual(back[ID][1][BW].buy_seen, undefined, "buy_seen stripped");
  assert.strictEqual(back[ID][2][BW].sell_seen, undefined, "every quality stripped");
  assert.strictEqual(back.T4_BAG[1][CAE].buy_seen, undefined, "every city stripped");
});

test("[5b] localStorage: a store WITH the marker keeps its stamps", () => {
  const withMarker = { ...legacyStore(), [MARKER_KEY]: MARKER };
  const st = fakeStorage({
    capturedPrices: JSON.stringify(withMarker),
    capturedPricesVersion: "1",
  });
  const back = captured.loadCapturedPrices({ storage: st, ...loadOpts });
  assert.strictEqual(back[ID][1][BW].sell_seen, SEEN_LEGACY, "proven stamps are kept");
  assert.strictEqual(back.T4_BAG[1][CAE].buy_seen, SEEN_LEGACY);
});

test("[5c] localStorage: a save writes the marker, so later stamps survive a reload", () => {
  const st = fakeStorage({
    capturedPrices: JSON.stringify(legacyStore()),
    capturedPricesVersion: "1",
  });
  captured.loadCapturedPrices({ storage: st, ...loadOpts }); // one-time strip
  captured.saveCapturedPrices(
    { [ID]: { 1: { [BW]: cell({ sell_price: 300, sell_date: SEEN_NEW, sell_seen: SEEN_NEW }) } } },
    { storage: st, now: Date.parse(NOW) },
  );
  const back = captured.loadCapturedPrices({ storage: st, ...loadOpts });
  assert.strictEqual(back[ID][1][BW].sell_seen, SEEN_NEW, "a stamp written after the migration is proof");
});

test("[5d] file bridge: a file without the marker is stripped; with it, kept", async () => {
  const stripped = await captured.loadCapturedPricesFromFile({
    bridge: fakeBridge(legacyStore()), ...loadOpts,
  });
  assert.strictEqual(stripped[ID][1][BW].sell_seen, undefined);
  assert.strictEqual(stripped[ID][1][BW].sell_price, 100, "prices survive");
  const kept = await captured.loadCapturedPricesFromFile({
    bridge: fakeBridge({ ...legacyStore(), [MARKER_KEY]: MARKER }), ...loadOpts,
  });
  assert.strictEqual(kept[ID][1][BW].sell_seen, SEEN_LEGACY, "proven stamps are kept");
});

test("[5e] a file save writes the marker", async () => {
  const br = fakeBridge(null);
  captured.saveCapturedPrices(
    { [ID]: { 1: { [BW]: cell({ sell_price: 300, sell_date: SEEN_NEW, sell_seen: SEEN_NEW }) } } },
    { bridge: br, now: Date.parse(NOW) },
  );
  const stored = br._stored();
  assert.strictEqual(stored[MARKER_KEY], MARKER, "the format marker rides with every save");
  assert.strictEqual(stored[ID][1][BW].sell_seen, SEEN_NEW);
});
