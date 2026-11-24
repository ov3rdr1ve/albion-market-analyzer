/**
 * Photon messages → market uploads.
 *
 * Everything here mirrors albiondata-client, the reference implementation whose
 * output the app already consumes through the AODP API. Staying byte-compatible
 * with it is the point: the same capture must produce the same records.
 *
 *   operation code            parameters[253]  (NOT the photon code byte)
 *   Join response location    parameters[8]    (op 2)
 *   AuctionGetOffers  resp    parameters[0] = JSON strings   (op 81, sell side)
 *       request               1 category, 2 subcategory, 5 quality,
 *                             8 itemIds, 255 messageId
 *                             (6 is NOT the enchantment since the 2026-09-03
 *                             patch: 2 on offers, 1 on requests, always; an
 *                             enchanted search sends the @n variant's own id)
 *   AuctionGetRequests resp   parameters[0] = JSON strings   (op 82, buy side)
 *   AuctionGetItemAverageStats
 *       request               1 itemId, 2 quality, 3 timescale, 4 enchantment,
 *                             255 messageId
 *       response              0 amounts, 1 silver, 2 timestamps, 255 messageId
 *   GoldMarketGetAverageInfo  0 prices, 1 timestamps          (op 250)
 *
 * Two things are deliberate:
 *   - orders are emitted VERBATIM, prices still multiplied by 10000. The ingest
 *     pipeline divides (deduper: `order.UnitPriceSilver /= 10000`), so scaling
 *     here would corrupt every uploaded price. The app-side conversion lives in
 *     js/market-price-store.js instead.
 *   - a history response carries no item id, only a message id. It is matched
 *     to its request through `messageId % cacheSize`, the same ring buffer the
 *     reference client uses.
 *
 * An ORDER response carries no item id either, and used to be attributed to
 * nothing at all: an empty book incremented no counter, so a session spent
 * browsing thin items (laborer trophies, faction capes) read exactly like a
 * capture that had gone deaf. The same ring now correlates op-81/82 requests —
 * whose parameter 8 is the list of item ids the client asked about — so the
 * status line can say "queried Zander Trophy, 0 offers" instead of nothing.
 */

const { isUploadableLocation, marketCityName } = (typeof require !== "undefined")
  ? require("./market-locations.js")
  : { isUploadableLocation: globalThis.isUploadableLocation, marketCityName: globalThis.marketCityName };

const { readOperationCode: readPhotonOperationCode } = (typeof require !== "undefined")
  ? require("./photon-operations.js")
  : { readOperationCode: globalThis.readOperationCode };

const { readJoinLocation, looksLikeJoinResponse } = (typeof require !== "undefined")
  ? require("./join-location.js")
  : { readJoinLocation: globalThis.readJoinLocation, looksLikeJoinResponse: globalThis.looksLikeJoinResponse };

const { judgeNamedQuery, itemIndexLooksStale } = (typeof require !== "undefined")
  ? require("./market-query-index-check.js")
  : { judgeNamedQuery: globalThis.judgeNamedQuery, itemIndexLooksStale: globalThis.itemIndexLooksStale };

const MARKET_OPS = {
  join: 2,
  auctionCreateOffer: 79,
  auctionCreateRequest: 80,
  auctionGetOffers: 81,
  auctionGetRequests: 82,
  auctionBuyOffer: 83,
  auctionAbortAuction: 84,
  auctionAbortOffer: 86,
  auctionAbortRequest: 87,
  auctionSellRequest: 88,
  auctionGetMyOpenOffers: 91,
  auctionGetMyOpenRequests: 92,
  auctionGetItemAverageStats: 95,
  goldMarketGetAverageInfo: 250,
};

/**
 * The operations that talk about YOUR orders rather than the market's.
 *
 * Their responses carry order records shaped exactly like a book's, which is
 * why they used to be priced: operation 83 by name (it was handled as a book
 * read) and the rest through the unknown-operation net. What they carry is the
 * order you just placed, cancelled or consumed — so filing it as the market
 * quotes your own listing back at you, and the trade that emptied a book leaves
 * no trace on the price it emptied.
 *
 * The numbers come from albiondata-client's operation enum offset by +6, an
 * offset the four constants above pin exactly (81, 82, 83, 95). Codes move with
 * client patches, so nothing DEPENDS on the number: it only chooses a handler,
 * and a paired request still overrules it (see handleOwnOrders).
 */
const OWN_ORDER_ACTION_BY_OP = {
  [MARKET_OPS.auctionCreateOffer]: "listed",
  [MARKET_OPS.auctionCreateRequest]: "listed",
  [MARKET_OPS.auctionBuyOffer]: "bought",
  [MARKET_OPS.auctionAbortAuction]: "cancelled",
  [MARKET_OPS.auctionAbortOffer]: "cancelled",
  [MARKET_OPS.auctionAbortRequest]: "cancelled",
  [MARKET_OPS.auctionSellRequest]: "sold",
  [MARKET_OPS.auctionGetMyOpenOffers]: "mine",
  [MARKET_OPS.auctionGetMyOpenRequests]: "mine",
};

/**
 * The side a trade can only have taken from, when its response names no order.
 * Selling can only shrink a bid; buying can only shrink an ask. A cancel could
 * be either, so it names nothing and invalidates nothing.
 */
const OWN_ACTION_SIDE = { sold: "request", bought: "offer" };

const TOPICS = {
  orders: "marketorders.ingest",
  histories: "markethistories.ingest",
  gold: "goldprices.ingest",
};

const DEFAULT_CACHE_SIZE = 8192;
/** Parameter carrying the item ids an AuctionGetOffers/Requests asked about.
 *  An enchanted search names the @n variant by its own index, so the id is
 *  taken as the index resolves it — nothing is folded in from beside it. */
const QUERY_ITEMS_PARAM = 8;
/** How many resolved market queries the status line keeps to show back. */
const DEFAULT_QUERY_LOG_SIZE = 20;

const KNOWN_OPS = new Set(Object.values(MARKET_OPS));

/**
 * The operation code, corrected for the byte-order artefact the reference
 * client also guards against (81 arriving as 0x5100 after a client update).
 * Shared with the roads reader (js/photon-operations.js) so the two agree on
 * what "operation 2" means — they used to answer that question differently.
 * @returns {number|null}
 */
function readOperationCode(message) {
  return readPhotonOperationCode(message, KNOWN_OPS);
}

/** Item ids 129-256 arrive as negative numbers; the reference adds 256 back. */
function fixNegativeItemId(id) {
  return id < 0 && id > -129 ? id + 256 : id;
}

// An order list is recognisable by its payload, not by the operation number.
// Codes move with client patches, and when they do the capture goes quiet with
// no way to tell it apart from a closed game — so anything shaped like an order
// list is read as one. Nothing else on the wire carries this field.
const ORDER_FIELD = '"UnitPriceSilver"';

function looksLikeOrderList(list) {
  return Array.isArray(list) && list.length > 0
    && list.some((raw) => typeof raw === "string" && raw.includes(ORDER_FIELD));
}

/**
 * The auction types a parsed list carries.
 *
 * A list holding BOTH is not an answer to operation 81 or 82: each answers one
 * side of the book only. It is your own traffic — your open orders, or the
 * record of a trade — and pricing it stamps both halves of a cell in the same
 * millisecond, the signature found on 213 of 14,320 cells in the live store.
 */
function orderSides(orders) {
  const sides = new Set();
  (orders || []).forEach((order) => {
    const type = String((order && order.AuctionType) || "").toLowerCase();
    if (type === "offer" || type === "request") sides.add(type);
  });
  return sides;
}

function parseOrders(rawList, fallbackLocation) {
  const orders = [];
  for (const raw of rawList) {
    let order;
    try { order = JSON.parse(raw); } catch (e) { continue; }
    if (!order || typeof order !== "object") continue;
    // Dens and hideout banks name themselves; ordinary city markets send an
    // empty location and rely on where the player is standing.
    if (!order.LocationId) order.LocationId = fallbackLocation;
    orders.push(order);
  }
  return orders;
}

/**
 * @param {object} options
 * @param {(upload:{topic:string, orders:object[], city:string|null, locationId:string}) => void} [options.onOrders]
 * @param {(upload:{topic:string, payload:object}) => void} [options.onHistory]
 * @param {(upload:{topic:string, payload:object}) => void} [options.onGold]
 * @param {(loc:{locationId:string, city:string|null}) => void} [options.onLocation]
 * @param {number} [options.cacheSize]  history correlation ring, default 8192
 * @param {(albionId:number) => string|null} [options.lookupId]  numeric wire id
 *   → app item id, for naming the items a market query asked about. Injected
 *   (js/item-index.js) so this file stays dependency-free and testable.
 * @param {number} [options.queryLogSize]  resolved queries kept, default 20
 */
function createMarketEventReader({
  onOrders = () => {},
  onOwnOrders = () => {},
  onHistory = () => {},
  onGold = () => {},
  onLocation = () => {},
  cacheSize = DEFAULT_CACHE_SIZE,
  lookupId = () => null,
  queryLogSize = DEFAULT_QUERY_LOG_SIZE,
  now = () => Date.now(),
} = {}) {
  let locationId = null;
  /** messageId % cacheSize → {albionId, quality, timescale} */
  let pendingHistory = new Map();
  /** messageId % cacheSize → {items:[{albionId,itemId}], side} */
  let pendingQueries = new Map();
  /** The last book the game answered about: {itemIds, city, side}. A trade
   *  whose response names no order still happened to the book you were just
   *  looking at, and that is the only handle on it. */
  let lastBook = null;
  // Every failure in here is silent on purpose (one bad frame must not stop the
  // tap), which makes "listening · 8 orders" read the same whether the capture
  // died or the game simply sent nothing. These counters are what tells them
  // apart in the status line.
  const stats = {
    responses: 0,
    /** op-81/82 responses of any shape — the game answered a market at all */
    marketResponses: 0,
    orderResponses: 0,
    /** the game answered and the book was EMPTY: nobody is listing that item */
    emptyOrderResponses: 0,
    orders: 0,
    droppedNoLocation: 0,
    /** The location those drops were filed under. "1598 dropped" says nothing
     *  on its own; the id says whether the capture is in the Roads, in a
     *  hideout, or holding no position at all. */
    lastDroppedLocation: null,
    /** When the game last named the player's location. */
    locationAt: null,
    /** Join responses that carried a location. */
    joins: 0,
    /** positions taken off a response that did not arrive under operation 2,
     *  by operation code — reported rather than trusted silently */
    joinsByFallbackOp: {},
    /** order-shaped responses arriving on an operation we do not know: {code: count} */
    unknownOps: {},
    /** your own market traffic, per operation: {code: count}. A zero here after
     *  a client patch is how a moved operation code announces itself. */
    ownOrderOps: {},
    /** order lists carrying both sides at once — never a public book */
    mixedSideResponses: 0,
    lastOrderOp: null,
    /** the last `queryLogSize` market queries, newest last: {itemId, city, count, side} */
    lastQueries: [],
    /** named requests whose orders named the same item / a different one */
    itemIndexMatches: 0,
    itemIndexMismatches: 0,
    /** the item index names the wrong items — a game patch has moved past it
     *  (js/market-query-index-check.js) */
    itemIndexStale: false,
  };

  function resetStats() {
    stats.responses = 0;
    stats.marketResponses = 0;
    stats.orderResponses = 0;
    stats.emptyOrderResponses = 0;
    stats.orders = 0;
    stats.droppedNoLocation = 0;
    stats.lastDroppedLocation = null;
    stats.locationAt = null;
    stats.joins = 0;
    stats.joinsByFallbackOp = {};
    stats.unknownOps = {};
    stats.ownOrderOps = {};
    stats.mixedSideResponses = 0;
    stats.lastOrderOp = null;
    stats.lastQueries = [];
    stats.itemIndexMatches = 0;
    stats.itemIndexMismatches = 0;
    stats.itemIndexStale = false;
  }

  /** Tally one named request's verdict and refresh the stale flag. */
  function noteIndexVerdict(verdict) {
    if (verdict === "match") stats.itemIndexMatches++;
    else if (verdict === "mismatch") stats.itemIndexMismatches++;
    else return;
    stats.itemIndexStale = itemIndexLooksStale(stats.itemIndexMatches, stats.itemIndexMismatches);
  }

  function setLocation(raw) {
    const next = String(raw).trim();
    if (!next || next === locationId) return;
    locationId = next;
    onLocation({ locationId, city: marketCityName(locationId) });
  }

  /**
   * A Join named a place. Counted even when the location is unchanged: "the
   * game last told us where we are 40 minutes ago" is the fact the status line
   * needs, and standing still must not read as a capture gone deaf.
   *
   * `confirmed` says the message is established as a Join — by its operation
   * code, or by `looksLikeJoinResponse`. Only then may the whole payload be
   * scanned for an instanced id: an island token mentioned by ordinary traffic
   * used to refile every capture under the island the player had left
   * (js/join-location.js, reported 2026-09-04).
   *
   * @returns {boolean} whether a location was read at all
   */
  function noteJoin(parameters, confirmed = false) {
    const id = readJoinLocation(parameters, { confirmed });
    if (!id) return false;
    stats.joins++;
    stats.locationAt = now();
    setLocation(id);
    return true;
  }

  /**
   * The location gate is per ORDER, not per response: a capture started while
   * the player already stands in a city never sees a Join, so the player
   * location is unknown — but dens and hideout banks name themselves in the
   * order and can still be filed. What is left over is counted rather than
   * dropped in silence.
   */
  /**
   * Name the city by hand, for the case the capture cannot learn it: the
   * location is only announced on a zone Join, so starting the monitor while
   * already standing in the market means every order is dropped until you walk
   * through a gate.
   *
   * A seed OVERRIDES whatever the reader is holding. It used to defer to any
   * known location, which made the picker useless in the case it exists for:
   * a Join seen earlier in the session — the city you logged in at, or one you
   * have since left through a gate crossing the capture missed — left every
   * market filed under the wrong city with no way to correct it. Only a LATER
   * Join outranks the seed, because that is the game speaking live.
   *
   * An empty seed is "Auto (from zone)": it hands the zone back its say and
   * must not blind a capture that already knows where it is.
   * @returns {boolean} whether it changed the location
   */
  function seedLocation(raw) {
    const next = String(raw === null || raw === undefined ? "" : raw).trim();
    if (!next || next === locationId) return false;
    locationId = next;
    onLocation({ locationId, city: marketCityName(locationId) });
    return true;
  }

  /**
   * Remember which items an order-list request asked about.
   *
   * Parameter 8 is `ItemIds []uint16` in albiondata-client's
   * operationAuctionGetOffers. The ids are the numeric index js/item-index.js
   * resolves; they arrive with the same negative-number artefact as the history
   * path, so fixNegativeItemId runs first.
   */
  function cacheOrderQuery(message, code) {
    const params = message.parameters;
    const messageId = Number(params[255]);
    if (!Number.isFinite(messageId)) return;
    const raw = params[QUERY_ITEMS_PARAM];
    const ids = Array.isArray(raw) ? raw : (raw === undefined ? [] : [raw]);
    pendingQueries.set(messageId % cacheSize, {
      side: code === MARKET_OPS.auctionGetRequests ? "request" : "offer",
      items: ids.map(readQueryItem),
    });
  }

  /**
   * One entry of a query's item list, as `{albionId, itemId}`.
   *
   * The wire normally carries numeric indices, but not always, and the previous
   * `Number(n) || 0` collapsed every other shape onto item ZERO — so a query
   * the reader could not parse was logged as a confident `#0` rather than as
   * unknown. An id that cannot be read is reported as unknown; the diagnostic
   * exists to answer "was this item ever asked for?", and a wrong answer is
   * worse there than no answer.
   *
   * A non-numeric string is taken at face value: the client can name items by
   * their unique id ("T4_LEATHER"), which is exactly what the rest of the app
   * calls them.
   */
  function readQueryItem(n) {
    if (typeof n === "string" && n.trim() && !/^-?\d+$/.test(n.trim())) {
      return { albionId: null, itemId: n.trim() };
    }
    const raw = Number(n);
    if (!Number.isFinite(raw) || raw === 0) return { albionId: null, itemId: null };
    const albionId = fixNegativeItemId(raw);
    let itemId;
    try { itemId = lookupId(albionId) || null; } catch (e) { itemId = null; }
    return { albionId, itemId };
  }

  /** Append to the bounded query log, oldest shed first. */
  function logQuery(entry) {
    stats.lastQueries.push(entry);
    while (stats.lastQueries.length > queryLogSize) stats.lastQueries.shift();
  }

  /**
   * Attribute one order-list response to the items it was about.
   *
   * A response with no matching request still gets a line — joining the capture
   * mid-flight is normal, and "something answered, item unknown" is a different
   * story from silence.
   */
  /**
   * The id one order is about, enchantment folded in.
   *
   * A deliberate twin of orderItemId (js/market-price-store.js): this file is
   * dependency-free on purpose, and the two must agree or the "book was read"
   * stamp would be filed under `T8_SHOES_LEATHER_HELL` while the price it
   * describes lives under `T8_SHOES_LEATHER_HELL@4`.
   */
  function orderQueryItemId(order) {
    const base = order && typeof order.ItemTypeId === "string" ? order.ItemTypeId.trim() : "";
    if (!base) return null;
    if (base.includes("@")) return base;
    const enchant = Number(order.EnchantmentLevel) || 0;
    return enchant > 0 ? `${base}@${enchant}` : base;
  }

  /** Every distinct item an order list is about, in the order first seen. */
  function orderListItems(orders) {
    const seen = [];
    (orders || []).forEach((order) => {
      const id = orderQueryItemId(order);
      if (id && !seen.includes(id)) seen.push(id);
    });
    return seen;
  }

  /**
   * @returns {{side:string, itemIds:string[], city:string|null}} what this
   *   response is evidence ABOUT — the items whose book was read, and which
   *   side of it. An empty order list is evidence too, which is the whole
   *   reason this is returned rather than only logged: "the ask list was open
   *   and this item was not in it" is what tells a stale price from an
   *   unwatched one (js/market-price-store.js stampBookSeen).
   */
  function recordQueryResult(message, code, count, orders) {
    const messageId = Number(message.parameters[255]);
    const index = Number.isFinite(messageId) ? messageId % cacheSize : null;
    const pending = index === null ? null : pendingQueries.get(index);
    if (index !== null) pendingQueries.delete(index);
    // The reader's zone names the market; an order names its own location when
    // the zone was never seen (joining a capture mid-flight). handleOrders has
    // always had that fallback — without it here the log said "?" for orders it
    // went on to file under Caerleon.
    const city = marketCityName(locationId)
      || (orders && orders.length ? marketCityName(orders[0].LocationId) : null);
    const side = pending ? pending.side
      : (code === MARKET_OPS.auctionGetRequests ? "request" : "offer");
    const named = pending && pending.items.length && pending.items.some((it) => it.itemId || it.albionId);
    const namedIds = named ? pending.items.map((it) => it.itemId).filter(Boolean) : [];
    // The orders name their own item, so they check the index's name. A request
    // answered with some other item's orders was misnamed: those orders are
    // attributed below, as if nothing had been asked.
    const verdict = named ? judgeNamedQuery(namedIds, orderListItems(orders)) : "unknown";
    noteIndexVerdict(verdict);
    if (named && verdict !== "mismatch") {
      // An EMPTY answer has nothing to check the name against. Once the index
      // is known to be stale its names are not used: a stamp on the wrong item
      // flags that item's live price "not listed".
      const trusted = verdict === "match" || !stats.itemIndexStale;
      pending.items.forEach((it) => {
        logQuery({ itemId: trusted ? it.itemId : null, albionId: it.albionId, city, count, side });
      });
      const stampIds = trusted ? namedIds : [];
      rememberBook(stampIds, city, side);
      return { side, itemIds: stampIds, city };
    }
    // Unpaired: the answer names itself. A category BROWSE — opening the Black
    // Market with no search term — answers with one page of orders for dozens
    // of different items, which used to name none of them: the log printed a
    // bare "?" and, worse, not one of those books was stamped as read. The set
    // is reported whole, and the log says how many it holds rather than
    // pretending to a name it does not have.
    const items = orderListItems(orders);
    logQuery({
      itemId: items.length === 1 ? items[0] : null,
      albionId: null,
      itemCount: items.length,
      city,
      count,
      side,
    });
    // `derived`: these ids came off the ORDERS, not off a request. The page is
    // a price slice across many items, so it is evidence only about the
    // qualities it actually carried — see stampBookSeen (market-price-store).
    rememberBook(items, city, side);
    return { side, itemIds: items, city, derived: true };
  }

  /** Keep the book the game just answered about, for a trade that names none. */
  function rememberBook(itemIds, city, side) {
    if (!city || !itemIds || !itemIds.length) return;
    lastBook = { itemIds: itemIds.slice(), city, side };
  }

  /**
   * Your own market traffic: what you listed, cancelled, sold into or bought
   * from, and the orders standing in your name. Never priced, never uploaded.
   *
   * A response whose messageId pairs with a cached order query is a book read
   * that a client patch happened to renumber onto one of these codes, and it
   * wins the argument — losing it would silence the capture.
   */
  function handleOwnOrders(message, code) {
    const action = OWN_ORDER_ACTION_BY_OP[code];
    const list = message.parameters[0];
    if (looksLikeOrderList(list) && pairedQuery(message)) {
      handleOrders(message, code);
      return;
    }
    stats.ownOrderOps[code] = (stats.ownOrderOps[code] || 0) + 1;
    const orders = looksLikeOrderList(list) ? parseOrders(list, locationId) : [];
    if (orders.length) {
      const city = marketCityName(locationId) || marketCityName(orders[0].LocationId);
      if (city) onOwnOrders({ action, orders, city, locationId });
      return;
    }
    // Nothing to name the order by. A trade still happened to the book you were
    // just looking at, and the side it can only have taken from is known.
    const side = OWN_ACTION_SIDE[action];
    if (!side || !lastBook) return;
    onOwnOrders({
      action, orders: [], city: lastBook.city, locationId,
      itemIds: lastBook.itemIds.slice(), side,
    });
  }

  /** Whether a response answers a market query this reader cached. */
  function pairedQuery(message) {
    const messageId = Number(message.parameters[255]);
    if (!Number.isFinite(messageId)) return false;
    return pendingQueries.has(messageId % cacheSize);
  }

  function handleOrders(message, code) {
    const list = message.parameters[0];
    // An EMPTY book is an answer too, and the counter that used to say
    // otherwise is why "the sniffer never fetched this item" was unanswerable.
    if (Array.isArray(list) && !looksLikeOrderList(list)) {
      if (!list.length) {
        stats.marketResponses++;
        stats.emptyOrderResponses++;
        const observed = recordQueryResult(message, code, 0);
        // "Nothing is listed" is a reading, not a non-event: it is what lets a
        // row stop quoting a price the market no longer holds. Emitted with no
        // orders, so nothing is uploaded and nothing is priced — only stamped.
        if (observed.city && observed.itemIds.length) {
          onOrders({ topic: TOPICS.orders, orders: [], city: observed.city, locationId, observed });
        }
      }
      return;
    }
    if (!looksLikeOrderList(list)) return;
    stats.marketResponses++;
    stats.orderResponses++;
    stats.lastOrderOp = code;
    // Parsed BEFORE the query is logged, so an unreadable request can still be
    // named by the item the orders themselves carry. Not filtered first: which
    // item was asked about does not depend on whether its location is one the
    // app will upload.
    const parsed = parseOrders(list, locationId);
    // Both sides in one list is your own traffic, whatever operation carried
    // it: no book read can answer with an ask and a bid together.
    if (orderSides(parsed).size > 1) {
      stats.mixedSideResponses++;
      const ownCity = marketCityName(locationId) || marketCityName(parsed[0].LocationId);
      if (ownCity) onOwnOrders({ action: "mine", orders: parsed, city: ownCity, locationId });
      return;
    }
    const observed = recordQueryResult(message, code, list.length, parsed);

    const orders = parsed.filter((order) => {
      if (isUploadableLocation(order.LocationId)) return true;
      stats.droppedNoLocation++;
      stats.lastDroppedLocation = order.LocationId || locationId || null;
      return false;
    });
    if (!orders.length) return;

    stats.orders += orders.length;
    const city = marketCityName(locationId) || marketCityName(orders[0].LocationId);
    onOrders({ topic: TOPICS.orders, orders, city, locationId, observed });
  }

  function cacheHistoryRequest(message) {
    const params = message.parameters;
    const messageId = Number(params[255]);
    if (!Number.isFinite(messageId)) return;
    pendingHistory.set(messageId % cacheSize, {
      albionId: fixNegativeItemId(Number(params[1]) || 0),
      quality: Number(params[2]) || 0,
      timescale: Number(params[3]) || 0,
      // The chart is requested per enchantment, and the id in parameter 1 is
      // the BASE item. Kept out of the uploaded payload (AODP's schema has no
      // such field) and handed to the consumer alongside it, which folds it
      // into the local id — "T4_BAG" + 2 → "T4_BAG@2".
      enchant: Number(params[4]) || 0,
    });
  }

  function handleHistoryResponse(message) {
    const params = message.parameters;
    const messageId = Number(params[255]);
    if (!Number.isFinite(messageId)) return;
    const index = messageId % cacheSize;
    const info = pendingHistory.get(index);
    // No matching request means we joined the capture mid-flight — the item id
    // is unknowable, so the response is useless rather than merely incomplete.
    if (!info) return;
    pendingHistory.delete(index);
    if (!isUploadableLocation(locationId)) return;

    const amounts = params[0] || [];
    const silver = params[1] || [];
    const timestamps = params[2] || [];
    const histories = [];
    for (let i = 0; i < amounts.length; i++) {
      let amount = Number(amounts[i]);
      // Same negative-number artefact as item ids; below -124 it is unexplained
      // and the reference client drops the point rather than guess.
      if (amount < 0) {
        if (amount < -124) continue;
        amount = 256 + amount;
      }
      histories.push({
        ItemAmount: amount,
        SilverAmount: Number(silver[i]) || 0,
        Timestamp: Number(timestamps[i]) || 0,
      });
    }
    if (!histories.length) return;
    histories.sort((a, b) => b.Timestamp - a.Timestamp);

    onHistory({
      topic: TOPICS.histories,
      enchant: info.enchant || 0,
      // The chart names its item by the same index; a consumer filing it
      // locally must not trust that name once the index is known to be stale.
      indexStale: stats.itemIndexStale,
      payload: {
        AlbionId: info.albionId,
        LocationId: locationId,
        QualityLevel: info.quality,
        Timescale: info.timescale,
        MarketHistories: histories,
      },
    });
  }

  function handleGold(message) {
    const prices = message.parameters[0];
    const timestamps = message.parameters[1];
    if (!Array.isArray(prices) || !prices.length) return;
    onGold({
      topic: TOPICS.gold,
      payload: { Prices: prices, Timestamps: Array.isArray(timestamps) ? timestamps : [] },
    });
  }

  function handle(message) {
    const code = readOperationCode(message);
    if (code === null) return;
    const isResponse = message.kind === "response";
    if (isResponse) stats.responses++;

    switch (code) {
      case MARKET_OPS.join: {
        if (!isResponse) return;
        // js/join-location.js, so this reader and the Roads reader cannot
        // disagree about where the player is. It also reads the island and
        // hideout forms, and a location that arrived as bytes rather than as a
        // string — a teleport straight to an island used to be dropped here.
        noteJoin(message.parameters, true);
        return;
      }
      case MARKET_OPS.auctionGetOffers:
      case MARKET_OPS.auctionGetRequests:
        if (isResponse) handleOrders(message, code);
        else cacheOrderQuery(message, code);
        return;
      case MARKET_OPS.auctionCreateOffer:
      case MARKET_OPS.auctionCreateRequest:
      case MARKET_OPS.auctionBuyOffer:
      case MARKET_OPS.auctionAbortAuction:
      case MARKET_OPS.auctionAbortOffer:
      case MARKET_OPS.auctionAbortRequest:
      case MARKET_OPS.auctionSellRequest:
      case MARKET_OPS.auctionGetMyOpenOffers:
      case MARKET_OPS.auctionGetMyOpenRequests:
        if (isResponse) handleOwnOrders(message, code);
        else cacheOrderQuery(message, code);
        return;
      case MARKET_OPS.auctionGetItemAverageStats:
        if (isResponse) handleHistoryResponse(message);
        else cacheHistoryRequest(message);
        return;
      case MARKET_OPS.goldMarketGetAverageInfo:
        if (isResponse) handleGold(message);
        return;
      default:
        // An operation we do not know, carrying what is plainly an order list:
        // the codes were renumbered by a patch. Take the orders and record the
        // new code so the table can be corrected.
        if (isResponse && looksLikeOrderList(message.parameters[0])) {
          stats.unknownOps[code] = (stats.unknownOps[code] || 0) + 1;
          handleOrders(message, code);
        }
        // A request on an unknown op that looks like a market query (an item-id
        // list at parameter 8) is cached too — a renumbering patch moves the
        // request and the response together.
        else if (!isResponse && Array.isArray(message.parameters[QUERY_ITEMS_PARAM])) {
          cacheOrderQuery(message, code);
        }
        // A Join that did not arrive under operation 2. Gated on
        // looksLikeJoinResponse, which wants the Join's own character block
        // beside the location or an instanced id nothing else sends — a bare
        // cluster-shaped number in some unrelated response must never refile
        // every captured price under another city.
        else if (isResponse && looksLikeJoinResponse(message.parameters)) {
          if (noteJoin(message.parameters, true)) {
            stats.joinsByFallbackOp[code] = (stats.joinsByFallbackOp[code] || 0) + 1;
          }
        }
        return;
    }
  }

  return {
    handle,
    stats,
    seedLocation,
    get locationId() { return locationId; },
    reset() {
      locationId = null;
      pendingHistory = new Map();
      pendingQueries = new Map();
      lastBook = null;
      resetStats();
    },
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createMarketEventReader, readOperationCode, MARKET_OPS, TOPICS };
}
