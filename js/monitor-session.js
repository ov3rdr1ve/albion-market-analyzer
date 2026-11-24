/**
 * One capture, two consumers.
 *
 * "Start Monitor" opens a single passive tap on the game's traffic and fans it
 * out to:
 *   - the app's own price map — market orders become sell/buy per city,
 *   - the Albion Online Data Project ingest — the same orders, verbatim.
 *
 * The second one matters: the app reads AODP prices on every scan, so a monitor
 * that only took would be freeloading. Orders go up EXACTLY as captured, with
 * prices still ×10000, because the ingest pipeline is what divides.
 *
 * Nothing here touches a device or a socket: the sniffer factory and the upload
 * function are injected, which is also how this is tested.
 */

const { createMarketEventReader } = require("./market-sniffer-events.js");
const { ordersToPrices } = require("./market-price-store.js");
const {
  createOwnOrders, recordOwnOrders, invalidateFromAction, invalidateBooks,
  ownOrdersSnapshot,
} = require("./own-orders-store.js");
const { historyToVolumePatch } = require("./market-history-volume.js");
const { albionItemIdFromIndex } = require("./item-index.js");
const { marketCityName } = require("./market-locations.js");
const { createUploadQueue } = require("./upload-queue.js");

/**
 * @param {object} options
 * @param {Function} options.createSniffer   ({onMessage,onStatus}) => sniffer
 * @param {(payload:object, topic:string) => Promise<object>} [options.upload]
 * @param {(update:object) => void} [options.onPrices]
 * @param {(update:{books:object}) => void} [options.onOwnOrders]  the books the
 *   player holds an order in, so a row can stop quoting the player to themselves
 * @param {(loc:{locationId:string, city:string|null, at:number}) => void} [options.onLocation]
 * @param {(state:object) => void} [options.onStatus]
 * @param {() => boolean} [options.isUploadEnabled]
 * @param {() => string} [options.now]
 */
function createMonitorSession({
  createSniffer,
  upload = async () => ({ ok: false, reason: "disabled" }),
  onPrices = () => {},
  onOwnOrders = () => {},
  onLocation = () => {},
  onStatus = () => {},
  isUploadEnabled = () => true,
  // How many captured payloads may wait for a proof-of-work solve before the
  // oldest is shed. One market page is well under this; a sweep that runs the
  // backlog past it was going to upload minutes-old prices anyway.
  uploadQueueLimit = 32,
  now = () => new Date().toISOString(),
  // Wall clock in ms, separate from `now` (an ISO string for price rows), so a
  // test has to be able to move it.
  nowMs = () => Date.now(),
} = {}) {
  let sniffer = null;
  let marketReader = null;
  // A city named by hand, for when the capture cannot learn one — see
  // marketReader.seedLocation. Kept here so it survives a stop/start.
  let seededLocation = null;
  // Which standing orders are the player's own. Session-scoped: the game
  // re-lists them whenever the market is opened, and a stale claim would be
  // worse than none.
  const ownOrders = createOwnOrders();
  const stats = { orders: 0, histories: 0, gold: 0, uploads: 0, uploadErrors: 0, uploadsDropped: 0 };

  // Uploads go through a bounded serial queue rather than straight out. Each
  // one costs a proof-of-work solve on a single worker thread, so a market
  // sweep's few hundred responses used to keep that thread hashing for minutes
  // after the capture had gone quiet — and every payload was retained until the
  // session ended. See js/upload-queue.js.
  const queue = createUploadQueue({
    upload: (payload, topic) => upload(payload, topic),
    maxPending: uploadQueueLimit,
    onResult: (result) => {
      if (result && result.ok) stats.uploads++;
      // A drop is a deliberate shed of stale data, not a fault — counted apart
      // so the status line does not report a broken uploader.
      else if (result && result.reason === "dropped") stats.uploadsDropped++;
      else stats.uploadErrors++;
    },
  });

  function send(payload, topic) {
    if (!isUploadEnabled()) return;
    queue.push(payload, topic);
  }

  function buildReaders() {
    marketReader = createMarketEventReader({
      onOrders: ({ topic, orders, city, locationId, observed }) => {
        stats.orders += orders.length;
        // `observed` records that the book was READ — including a read that
        // came back empty, which is the only evidence that a stored price is
        // gone rather than merely old (js/market-price-store.js).
        const prices = ordersToPrices(orders, { now: now(), observed, city });
        if (orders.length || Object.keys(prices).length) {
          onPrices({ prices, city, locationId, count: orders.length });
        }
        // An empty book has nothing to upload; AODP takes trades and listings.
        if (orders.length) send({ Orders: orders }, topic);
      },
      // Your own market traffic. Never priced and never uploaded: what it
      // carries is the order YOU placed, cancelled or consumed. It does two
      // things — remembers which standing numbers are yours, and stamps the
      // book a trade of yours just changed as needing a fresh reading, which is
      // the only thing that could correct a price you personally removed
      // without waiting for you to reopen the market.
      onOwnOrders: ({ action, orders, city, locationId, itemIds, side }) => {
        recordOwnOrders(ownOrders, { action, orders, city });
        onOwnOrders({ books: ownOrdersSnapshot(ownOrders), action, city });
        const at = now();
        const prices = orders && orders.length
          ? invalidateFromAction({ action, orders, city, now: at })
          : invalidateBooks({ itemIds, city, side, now: at });
        if (Object.keys(prices).length) {
          onPrices({ prices, city, locationId, count: 0 });
        }
      },
      // The price chart is the only capture that carries TRADED amounts, which
      // is what Vol/24h means. It goes up to AODP verbatim and, reduced to a
      // volume-only patch, straight into the app's own tables — otherwise every
      // captured item sits at Vol 0 forever (js/market-history-volume.js).
      onHistory: ({ topic, payload, enchant, indexStale }) => {
        stats.histories++;
        // A stale item index names the chart's item wrongly, so the volume is
        // not filed locally. AODP still gets it: its ingest uses a current index.
        const prices = indexStale ? {} : historyToVolumePatch(payload, {
          enchant,
          lookupId: albionItemIdFromIndex,
          cityOf: marketCityName,
        });
        const itemCount = Object.keys(prices).length;
        if (itemCount) {
          onPrices({
            prices,
            city: marketCityName(payload.LocationId),
            locationId: payload.LocationId,
            count: 0,
          });
        }
        send(payload, topic);
      },
      onGold: ({ topic, payload }) => { stats.gold++; send(payload, topic); },
      // Where the capture thinks it is, pushed the moment the game says so.
      // The status line used to learn this only when PRICES arrived, so "at
      // Brecilien" outlived the position by however long it took to open the
      // next market — hours, in the report that prompted this.
      onLocation: ({ locationId, city }) => onLocation({ locationId, city, at: nowMs() }),
      // Names the items a market query asked about, so an EMPTY order book can
      // be reported as "this item has no listings here" rather than as silence.
      lookupId: albionItemIdFromIndex,
      now: nowMs,
    });
    if (seededLocation) marketReader.seedLocation(seededLocation);
  }

  /** Name the city the capture is in. Any zone the capture reports outranks it. */
  function seedLocation(raw) {
    seededLocation = raw || null;
    if (seededLocation && marketReader) marketReader.seedLocation(seededLocation);
  }

  function handleMessage(message) {
    try { marketReader.handle(message); } catch (e) { /* one bad frame must not stop the tap */ }
  }

  function start() {
    if (sniffer && sniffer.running) return true;
    // Fresh readers on every start.
    buildReaders();
    try {
      sniffer = createSniffer({
        onMessage: handleMessage,
        onStatus: (state) => onStatus(state),
      });
    } catch (e) {
      sniffer = null;
      onStatus({ status: "unavailable", message: e.message });
      return false;
    }
    return sniffer.start() !== false;
  }

  function stop() {
    if (sniffer) {
      try { sniffer.stop(); } catch (e) { /* already closed */ }
    }
    sniffer = null;
  }

  /** Wait for every queued upload — used by tests and by a clean shutdown. */
  async function flush() {
    await queue.idle();
  }

  /**
   * What the WIRE looked like, as opposed to `stats`, which counts what the
   * session managed to do with it. A capture that has gone deaf and a game that
   * is sending nothing read identically from the outside — "listening · 8
   * orders" either way — so these are the numbers the status line reports back.
   */
  function diagnostics() {
    const market = marketReader ? marketReader.stats : null;
    const photon = sniffer && sniffer.photonStats ? sniffer.photonStats : null;
    return {
      packets: sniffer && sniffer.packetsSeen ? sniffer.packetsSeen : 0,
      location: marketReader ? marketReader.locationId : null,
      // WHEN the game last said so. A wrong-but-confident city is the failure
      // this exists to make visible: without an age, a position frozen half an
      // hour ago reads exactly like one confirmed a second ago.
      locationAt: market ? market.locationAt : null,
      joins: market ? market.joins : 0,
      // Positions read off a response that did not carry the Join operation
      // code, by code (js/join-location.js looksLikeJoinResponse). Empty on a
      // healthy client; a code here is the client having moved its Join.
      joinsByFallbackOp: market ? market.joinsByFallbackOp : {},
      lastDroppedLocation: market ? market.lastDroppedLocation : null,
      responses: market ? market.responses : 0,
      // marketResponses counts every market answer, orderResponses only the
      // ones that carried listings. A gap between them is the whole point:
      // it says the game replied and the book was empty, which used to be
      // indistinguishable from a capture that had gone deaf.
      marketResponses: market ? market.marketResponses : 0,
      orderResponses: market ? market.orderResponses : 0,
      emptyOrderResponses: market ? market.emptyOrderResponses : 0,
      lastQueries: market ? market.lastQueries.slice(-5) : [],
      // A game patch renumbered the items and js/item-index.js has not caught
      // up; only an app update fixes it (js/market-query-index-check.js).
      itemIndexStale: market ? !!market.itemIndexStale : false,
      droppedNoLocation: market ? market.droppedNoLocation : 0,
      unknownOps: market ? market.unknownOps : {},
      // The player's own market traffic, per operation. Its codes are the one
      // part of the reader pinned to numbers a client patch can move, so a
      // zero here after an update is the only warning that a cancel or a sale
      // has stopped invalidating the price it changed.
      ownOrderOps: market ? market.ownOrderOps : {},
      mixedSideResponses: market ? market.mixedSideResponses : 0,
      lastOrderOp: market ? market.lastOrderOp : null,
      // The decoder's own breakdown. Without it, "1949 packets, 3 responses" is
      // unreadable: it could be a healthy capture of a quiet game or a decoder
      // that throws almost everything away before it ever reaches an operation.
      events: photon ? photon.events : 0,
      requests: photon ? photon.requests : 0,
      encrypted: photon ? photon.encrypted : 0,
      fragments: photon ? photon.fragments : 0,
      reassembled: photon ? photon.reassembled : 0,
      // Partial messages given up on. The only counter here that means LOSS —
      // fragments and reassembled count pieces and whole messages respectively,
      // and their ratio says nothing.
      abandoned: photon ? photon.abandoned : 0,
      pendingFragments: sniffer && sniffer.pendingFragments ? sniffer.pendingFragments : 0,
      malformed: photon ? photon.malformed : 0,
      // Collected by the decoder and previously unreachable: it separates "the
      // game sends nothing" from "everything arrives encrypted".
      byMessageType: photon ? photon.byMessageType : {},
    };
  }

  return {
    start,
    stop,
    flush,
    stats,
    seedLocation,
    get diagnostics() { return diagnostics(); },
    get running() { return !!(sniffer && sniffer.running); },
    get locationId() { return marketReader ? marketReader.locationId : null; },
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createMonitorSession };
}
