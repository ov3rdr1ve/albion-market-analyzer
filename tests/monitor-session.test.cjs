/**
 * Tests for the single "Start Monitor" session.
 *
 * One capture feeds two consumers at once:
 *   - the app's own price map (market orders → sell/buy per city),
 *   - the Albion Online Data Project ingest (the same orders, verbatim).
 *
 * This is the wiring test: a fake sniffer plays real-shaped Photon messages in
 * and the session's outputs are checked end to end, so a mis-wired callback
 * shows up here rather than in a live capture.
 *
 * No capture device, no game, no network — the sniffer factory and the uploader
 * are injected.
 *
 * Run: node tests/monitor-session.test.cjs
 */

const assert = require("assert");
const { createMonitorSession } = require("../js/monitor-session.js");
const { MARKET_OPS } = require("../js/market-sniffer-events.js");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const response = (code, params) => ({ kind: "response", code: 0, parameters: { 253: code, ...params } });
const joinAt = (id) => response(MARKET_OPS.join, { 8: id });
const order = (over = {}) => JSON.stringify({
  Id: 1, ItemTypeId: "T4_BAG", LocationId: "", QualityLevel: 1, EnchantmentLevel: 0,
  UnitPriceSilver: 12340000, Amount: 3, AuctionType: "offer",
  Expires: "2026-08-01T00:00:00", ...over,
});

// Market-history timestamps are .NET ticks: 100 ns since 0001-01-01.
const HOUR = 60 * 60 * 1000;
const TICKS_EPOCH_MS = 62135596800000;
const ticksAgo = (ms) => (Date.now() - ms + TICKS_EPOCH_MS) * 10000;

/** A sniffer stand-in that lets the test push messages straight in. */
function fakeSnifferFactory(record) {
  return ({ onMessage, onStatus }) => {
    record.feed = onMessage;
    record.status = onStatus;
    return {
      start() { record.started = true; onStatus({ status: "listening", message: "fake" }); return true; },
      stop() { record.started = false; onStatus({ status: "stopped", message: "stopped" }); },
      get running() { return !!record.started; },
      get serverIp() { return "5.188.125.7"; },
    };
  };
}

function session(over = {}) {
  const record = {};
  const uploads = [];
  const out = { prices: [], statuses: [] };
  const s = createMonitorSession({
    createSniffer: fakeSnifferFactory(record),
    upload: async (payload, topic) => { uploads.push({ payload, topic }); return { ok: true }; },
    onPrices: (p) => out.prices.push(p),
    onStatus: (st) => out.statuses.push(st),
    now: () => "2026-07-25T12:00:00",
    ...over,
  });
  return { s, record, uploads, out };
}

(async () => {
  await test("starting opens the capture and reports listening", async () => {
    const { s, record, out } = session();
    assert.strictEqual(s.start(), true);
    assert.strictEqual(record.started, true);
    assert.deepStrictEqual(out.statuses.at(-1), { status: "listening", message: "fake" });
    assert.strictEqual(s.running, true);
  });

  await test("starting twice does not open a second capture", async () => {
    const { s, out } = session();
    s.start();
    s.start();
    assert.strictEqual(out.statuses.filter((x) => x.status === "listening").length, 1);
  });

  await test("stopping closes the capture", async () => {
    const { s, record, out } = session();
    s.start();
    s.stop();
    assert.strictEqual(record.started, false);
    assert.strictEqual(s.running, false);
    assert.deepStrictEqual(out.statuses.at(-1), { status: "stopped", message: "stopped" });
  });

  await test("market orders become app prices AND an upload", async () => {
    const { s, record, uploads, out } = session();
    s.start();
    record.feed(joinAt("3005"));
    record.feed(response(MARKET_OPS.auctionGetOffers, { 0: [order()] }));
    await s.flush();

    assert.strictEqual(out.prices.length, 1);
    assert.strictEqual(out.prices[0].prices["T4_BAG"][1]["Caerleon"].sell_price, 1234);
    assert.strictEqual(out.prices[0].city, "Caerleon");

    assert.strictEqual(uploads.length, 1);
    assert.strictEqual(uploads[0].topic, "marketorders.ingest");
    assert.strictEqual(uploads[0].payload.Orders[0].UnitPriceSilver, 12340000,
      "uploaded verbatim — the ingest pipeline does the /10000");
  });

  await test("gold, and a history nothing can be read out of, leave prices alone", async () => {
    const { s, record, uploads, out } = session();
    s.start();
    record.feed(joinAt("3005"));
    // Item index 42 with a 1970 timestamp: uploadable, but no trades in the
    // last 24h and no id the catalogs know.
    record.feed({ kind: "request", parameters: { 253: MARKET_OPS.auctionGetItemAverageStats, 1: 42, 2: 1, 3: 0, 255: 8 } });
    record.feed(response(MARKET_OPS.auctionGetItemAverageStats, { 0: [1], 1: [10], 2: [100], 255: 8 }));
    record.feed(response(MARKET_OPS.goldMarketGetAverageInfo, { 0: [4500], 1: [1000] }));
    await s.flush();
    assert.deepStrictEqual(uploads.map((u) => u.topic), ["markethistories.ingest", "goldprices.ingest"]);
    assert.strictEqual(out.prices.length, 0);
  });

  await test("a captured price chart becomes a local 24h volume AND an upload", async () => {
    const { s, record, uploads, out } = session();
    s.start();
    record.feed(joinAt("3005"));
    // 2888 is T4_BAG in ao-bin-dumps items.txt (2026-09-08); parameter 4 is the enchantment.
    record.feed({ kind: "request", parameters: { 253: MARKET_OPS.auctionGetItemAverageStats, 1: 2888, 2: 1, 3: 0, 4: 2, 255: 9 } });
    record.feed(response(MARKET_OPS.auctionGetItemAverageStats, {
      0: [10, 5], 1: [1000000, 500000], 2: [ticksAgo(1 * HOUR), ticksAgo(5 * HOUR)], 255: 9,
    }));
    await s.flush();

    assert.strictEqual(out.prices.length, 1, "the chart must reach the app, not only AODP");
    const cell = out.prices[0].prices["T4_BAG@2"][1]["Caerleon"];
    assert.strictEqual(cell.volume_24h, 15, "10 + 5 traded in the window");
    assert.strictEqual(cell.sell_price, 0, "a chart carries no order to overwrite prices with");
    assert.strictEqual(cell.buy_price, 0);
    assert.deepStrictEqual(uploads.map((u) => u.topic), ["markethistories.ingest"]);
    assert.strictEqual(uploads[0].payload.AlbionId, 2888, "the upload stays exactly as captured");
  });

  // Reported 2026-09-11: after a game patch moved the numeric item ids, price
  // charts were filed as the volume of whichever item the old index named.
  // Once the reader has judged its index stale, a chart still goes to AODP
  // (its ingest names items with its own, current index) but not into the app.
  await test("a stale item index stops price charts filing local volumes, not uploads", async () => {
    const { s, record, uploads, out } = session();
    s.start();
    record.feed(joinAt("3005"));
    for (let id = 50; id < 53; id++) {
      record.feed({ kind: "request", parameters: { 253: MARKET_OPS.auctionGetOffers, 8: [2888], 255: id } });
      record.feed(response(MARKET_OPS.auctionGetOffers, { 0: [order({ ItemTypeId: "T8_MOUNT_DRAKE_FIRE" })], 255: id }));
    }
    assert.strictEqual(s.diagnostics.itemIndexStale, true);
    const pricesBefore = out.prices.length;
    record.feed({ kind: "request", parameters: { 253: MARKET_OPS.auctionGetItemAverageStats, 1: 2888, 2: 1, 3: 0, 255: 60 } });
    record.feed(response(MARKET_OPS.auctionGetItemAverageStats, {
      0: [10], 1: [1000000], 2: [ticksAgo(1 * HOUR)], 255: 60,
    }));
    await s.flush();
    assert.strictEqual(out.prices.length, pricesBefore, "no volume filed under a name the index cannot vouch for");
    assert.strictEqual(uploads.at(-1).topic, "markethistories.ingest");
  });

  await test("a healthy session reports its item index as current", async () => {
    const { s, record } = session();
    s.start();
    record.feed(joinAt("3005"));
    assert.strictEqual(s.diagnostics.itemIndexStale, false);
  });

  await test("uploading can be disabled without losing local prices", async () => {
    const { s, record, uploads, out } = session({ isUploadEnabled: () => false });
    s.start();
    record.feed(joinAt("3005"));
    record.feed(response(MARKET_OPS.auctionGetOffers, { 0: [order()] }));
    await s.flush();
    assert.strictEqual(uploads.length, 0);
    assert.strictEqual(out.prices.length, 1);
  });

  await test("stats count what the session has seen", async () => {
    const { s, record } = session();
    s.start();
    record.feed(joinAt("3005"));
    record.feed(response(MARKET_OPS.auctionGetOffers, { 0: [order(), order({ Id: 2 })] }));
    await s.flush();
    assert.deepStrictEqual(s.stats, { orders: 2, histories: 0, gold: 0, uploads: 1, uploadErrors: 0, uploadsDropped: 0 });
  });

  // ── a seeded location ────────────────────────────────────────────────────
  await test("a city named before the capture starts is applied when it does", async () => {
    const { s, record, out } = session();
    s.seedLocation("1002");
    s.start();
    record.feed(response(MARKET_OPS.auctionGetOffers, { 0: [order()] }));
    await s.flush();
    assert.strictEqual(out.prices.length, 1);
    assert.strictEqual(out.prices[0].city, "Lymhurst");
  });

  await test("a city named mid-capture takes effect at once", async () => {
    const { s, record, out } = session();
    s.start();
    s.seedLocation("3008");
    record.feed(response(MARKET_OPS.auctionGetOffers, { 0: [order()] }));
    await s.flush();
    assert.strictEqual(out.prices[0].city, "Martlock");
  });

  // The picker was ignored once any zone was known, so a capture that had
  // learned the wrong city kept filing every market under it.
  await test("a city named after a zone was seen still takes effect", async () => {
    const { s, record, out } = session();
    s.start();
    record.feed(joinAt("4002"));
    record.feed(response(MARKET_OPS.auctionGetOffers, { 0: [order()] }));
    s.seedLocation("1002");
    record.feed(response(MARKET_OPS.auctionGetOffers, { 0: [order({ Id: 2 })] }));
    await s.flush();
    assert.strictEqual(out.prices.at(-1).city, "Lymhurst");
  });

  // A stale seed must not follow the player around: the readers are rebuilt on
  // every start, and the zone the capture actually reports is the truth.
  await test("a restart drops a seed the capture has since overtaken", async () => {
    const { s, record, out } = session();
    s.seedLocation("1002");
    s.start();
    record.feed(joinAt("3005"));
    record.feed(response(MARKET_OPS.auctionGetOffers, { 0: [order()] }));
    await s.flush();
    assert.strictEqual(out.prices.at(-1).city, "Caerleon");
  });

  // ── diagnostics ──────────────────────────────────────────────────────────
  // Kept apart from `stats`, which counts what the session DID. These say what
  // the wire looked like, and they are the only way to tell a capture that has
  // gone deaf from a game that is simply not sending anything.
  await test("diagnostics report the wire, not just the results", async () => {
    const { s, record } = session();
    s.start();
    record.feed(joinAt("3005"));
    record.feed(response(MARKET_OPS.auctionGetOffers, { 0: [order()] }));
    await s.flush();
    const d = s.diagnostics;
    assert.strictEqual(d.orderResponses, 1);
    assert.strictEqual(d.location, "3005");
    assert.strictEqual(d.droppedNoLocation, 0);
    assert.deepStrictEqual(d.unknownOps, {});
  });

  await test("orders arriving before any zone is known show up as dropped", async () => {
    const { s, record, out } = session();
    s.start();
    record.feed(response(MARKET_OPS.auctionGetOffers, { 0: [order(), order({ Id: 2 })] }));
    await s.flush();
    assert.strictEqual(out.prices.length, 0);
    assert.strictEqual(s.diagnostics.droppedNoLocation, 2);
    assert.strictEqual(s.diagnostics.location, null);
  });

  // The reported bug: the panel said "at Brecilien" while the player stood in
  // Lymhurst, and nothing in the session could say how old that claim was.
  await test("diagnostics timestamp the position", async () => {
    const t0 = 1_800_000_000_000;
    let clock = t0;
    const { s, record } = session({ nowMs: () => clock });
    s.start();
    record.feed(joinAt("3005"));
    clock = t0 + 60_000;
    record.feed(joinAt("TNL-022"));
    const d = s.diagnostics;
    assert.strictEqual(d.location, "TNL-022");
    assert.strictEqual(d.locationAt, t0 + 60_000);
    assert.strictEqual(d.joins, 2);
  });

  await test("the location is pushed the moment the game names it, without a market", async () => {
    const seen = [];
    const { s, record } = session({ onLocation: (loc) => seen.push(loc) });
    s.start();
    record.feed(joinAt("3005"));
    record.feed(joinAt("TNL-022"));
    assert.deepStrictEqual(seen.map((l) => [l.locationId, l.city]), [
      ["3005", "Caerleon"], ["TNL-022", null],
    ]);
    assert.ok(seen.every((l) => typeof l.at === "number"), "every push is timestamped");
  });

  await test("dropped orders name the location they were filed under", async () => {
    const { s, record } = session();
    s.start();
    record.feed(joinAt("TNL-022"));
    record.feed(response(MARKET_OPS.auctionGetOffers, { 0: [order({ LocationId: "" })] }));
    await s.flush();
    assert.strictEqual(s.diagnostics.droppedNoLocation, 1);
    assert.strictEqual(s.diagnostics.lastDroppedLocation, "TNL-022");
  });

  await test("diagnostics before the capture starts are empty rather than absent", async () => {
    const { s } = session();
    assert.strictEqual(s.diagnostics.orderResponses, 0);
    assert.strictEqual(s.diagnostics.packets, 0);
  });

  await test("an upload failure is counted, and prices still update", async () => {
    const { s, record, out } = session({ upload: async () => ({ ok: false, reason: "network" }) });
    s.start();
    record.feed(joinAt("3005"));
    record.feed(response(MARKET_OPS.auctionGetOffers, { 0: [order()] }));
    await s.flush();
    assert.strictEqual(s.stats.uploadErrors, 1);
    assert.strictEqual(out.prices.length, 1);
  });

  await test("an upload that throws does not take the session down", async () => {
    const { s, record } = session({ upload: async () => { throw new Error("boom"); } });
    s.start();
    record.feed(joinAt("3005"));
    record.feed(response(MARKET_OPS.auctionGetOffers, { 0: [order()] }));
    await s.flush();
    assert.strictEqual(s.stats.uploadErrors, 1);
    assert.strictEqual(s.running, true);
  });

  await test("an upload backlog is bounded — the oldest captures are shed, prices are not", async () => {
    let release;
    const held = new Promise((r) => { release = r; });
    const uploaded = [];
    const { s, record, out } = session({
      uploadQueueLimit: 3,
      upload: async (payload) => { await held; uploaded.push(payload); return { ok: true }; },
    });
    s.start();
    record.feed(joinAt("3005"));
    // A market sweep: far more responses than the queue may hold. Each costs a
    // proof-of-work solve, so an unbounded queue is minutes of hashing.
    for (let i = 0; i < 40; i++) {
      record.feed(response(MARKET_OPS.auctionGetOffers, { 0: [order()] }));
    }
    release();
    await s.flush();

    assert.strictEqual(out.prices.length, 40, "every capture still reaches the app's own price map");
    assert.strictEqual(uploaded.length, 4, "one in flight plus the bounded backlog");
    assert.strictEqual(s.stats.uploadsDropped, 36);
    assert.strictEqual(s.stats.uploadErrors, 0, "a deliberate drop is not an uploader fault");
  });

  await test("a capture that cannot start reports why and stays stopped", async () => {
    const { s, out } = session({
      createSniffer: ({ onStatus }) => ({
        start() { onStatus({ status: "unavailable", message: "npcap missing" }); return false; },
        stop() {}, get running() { return false; },
      }),
    });
    assert.strictEqual(s.start(), false);
    assert.strictEqual(s.running, false);
    assert.deepStrictEqual(out.statuses.at(-1), { status: "unavailable", message: "npcap missing" });
  });

  await test("a sniffer factory that throws is reported as unavailable", async () => {
    const { s, out } = session({
      createSniffer: () => { throw new Error("cap was built for a different runtime"); },
    });
    assert.strictEqual(s.start(), false);
    assert.strictEqual(out.statuses.at(-1).status, "unavailable");
    assert.match(out.statuses.at(-1).message, /different runtime/);
  });

  // ── your own orders ──────────────────────────────────────────────────────
  // The capture is the only thing that can know a price on the board is the
  // player's own listing, or that a trade of theirs just emptied a book. Both
  // were reported as "I closed the order and the table did not change".

  await test("your own open orders are reported, not priced", async () => {
    const own = [];
    const { s, record, out, uploads } = session({ onOwnOrders: (u) => own.push(u) });
    s.start();
    record.feed(joinAt("3003"));
    record.feed(response(MARKET_OPS.auctionGetMyOpenOffers, { 0: [order()] }));
    assert.strictEqual(out.prices.length, 0, "nothing priced");
    assert.strictEqual(uploads.length, 0, "nothing uploaded");
    assert.strictEqual(own.length, 1);
    assert.deepStrictEqual(
      own[0].books,
      { "T4_BAG|1|Black Market|sell": [1234] },
      "the wire's ×10000 silver is divided, as the price map does",
    );
  });

  await test("selling into a bid stamps that book as needing a fresh reading", async () => {
    const { s, record, out } = session();
    s.start();
    record.feed(joinAt("3003"));
    record.feed(response(MARKET_OPS.auctionSellRequest, {
      0: [order({ AuctionType: "request", QualityLevel: 2 })],
    }));
    assert.strictEqual(out.prices.length, 1);
    const cell = out.prices[0].prices.T4_BAG[2]["Black Market"];
    assert.strictEqual(cell.buy_seen, "2026-07-25T12:00:00");
    assert.strictEqual(cell.buy_price, 0, "a trade is not a reading — it carries no price");
    assert.strictEqual(cell.sell_seen, undefined, "and says nothing about the other side");
  });

  await test("cancelling an order of yours drops it from what stands in your name", async () => {
    const own = [];
    const { s, record } = session({ onOwnOrders: (u) => own.push(u) });
    s.start();
    record.feed(joinAt("3003"));
    record.feed(response(MARKET_OPS.auctionGetMyOpenOffers, { 0: [order()] }));
    record.feed(response(MARKET_OPS.auctionAbortOffer, { 0: [order()] }));
    assert.deepStrictEqual(own.at(-1).books, {});
  });

  await test("a listing of your open orders is not itself an invalidation", async () => {
    const { s, record, out } = session();
    s.start();
    record.feed(joinAt("3003"));
    record.feed(response(MARKET_OPS.auctionGetMyOpenOffers, { 0: [order()] }));
    assert.strictEqual(out.prices.length, 0);
  });

  await test("an order list carrying both sides is never priced", async () => {
    const own = [];
    const { s, record, out, uploads } = session({ onOwnOrders: (u) => own.push(u) });
    s.start();
    record.feed(joinAt("3003"));
    record.feed(response(MARKET_OPS.auctionGetOffers, {
      0: [order(), order({ Id: 2, AuctionType: "request" })],
    }));
    assert.strictEqual(out.prices.length, 0);
    assert.strictEqual(uploads.length, 0);
    assert.strictEqual(own.length, 1);
  });

  await test("a Join arriving on another operation is reported as such", async () => {
    const { s, record } = session();
    s.start();
    record.feed(response(777, { 1: "character-id", 2: "PlayerName", 8: "3005" }));
    assert.strictEqual(s.locationId, "3005");
    assert.deepStrictEqual(s.diagnostics.joinsByFallbackOp, { 777: 1 });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
