/**
 * Captured market orders → the app's price map.
 *
 * A captured order is a LISTING, not a trade: "someone offers 3 bags at 1234
 * silver in Caerleon". The app speaks in `sell_price` (cheapest ask) and
 * `buy_price` (fattest bid), so the reduction is min-over-offers and
 * max-over-requests per item / quality / city.
 *
 * Three details decide whether the numbers are right:
 *   - the wire multiplies every silver value by 10000 (the ingest pipeline
 *     divides the same way — see the deduper),
 *   - enchantment is its own field on the wire but part of the id in the app:
 *     "T4_BAG" + level 2 is "T4_BAG@2",
 *   - `volume_24h` stays 0. Listed quantity is not traded volume, and the
 *     renderers read that field as "how much actually changed hands". Filling
 *     it with stock on the board would quietly overstate liquidity. A cell the
 *     scan already measured keeps that number — see mergeEntry.
 */

// Bound under a local name on purpose: in the browser these files are plain
// scripts sharing one global scope, and a top-level `const marketCityName`
// would collide with the function market-locations.js already declares there —
// a SyntaxError that kills this whole file silently.
const cityOf = (typeof require !== "undefined")
  ? require("./market-locations.js").marketCityName
  : globalThis.marketCityName;

const SILVER_SCALE = 10000;

/** App item id for an order: enchantment folded into the id, "" → null. */
function orderItemId(order) {
  const base = order && typeof order.ItemTypeId === "string" ? order.ItemTypeId.trim() : "";
  if (!base) return null;
  if (base.includes("@")) return base;
  const enchant = Number(order.EnchantmentLevel) || 0;
  return enchant > 0 ? `${base}@${enchant}` : base;
}

function blankEntry() {
  return {
    buy_price: 0,
    sell_price: 0,
    sell_date: null,
    buy_date: null,
    sell_src: null,
    buy_src: null,
    volume_24h: 0,
    used_fallback: false,
    from_sniffer: true,
  };
}

/** The field stamping "this side's book was read", per query side. */
function seenFieldFor(side) {
  return side === "request" ? "buy_seen" : "sell_seen";
}

/**
 * Stamp "the book behind this side was read at `now`" on the queried items.
 *
 * This is the only thing that distinguishes "no listing here" from "never
 * looked" — a zero price cannot, because a zero side means "not observed" and
 * must never erase a price (see mergeEntry).
 *
 * A NAMED observation — the game answered a query ABOUT the item — is a
 * reading of the whole book: every quality it holds is stamped, and quality 1
 * is created and stamped even when nothing was listed at it, because the flat
 * map every table reads is projected from quality 1, so that is the cell whose
 * staleness a row can act on. A DERIVED observation (a category browse)
 * stamps only the qualities the page actually priced — a slice that shows the
 * item nothing is silence, not an empty book.
 */
function stampBookSeen(map, { now, observed, city }) {
  if (!observed || !city) return;
  const ids = Array.isArray(observed.itemIds) ? observed.itemIds : [];
  const field = seenFieldFor(observed.side);
  const priceField = observed.side === "request" ? "buy_price" : "sell_price";
  for (const rawId of ids) {
    const itemId = typeof rawId === "string" ? rawId.trim() : "";
    if (!itemId) continue;
    // A DERIVED observation — a category browse, whose items were read off the
    // page because no request named them — is not a reading of any of those
    // books. The page is a price slice across dozens of items, so an item it
    // carried at Outstanding alone says nothing about its Normal book, and
    // stamping Normal there turned every older Normal price red. Only what the
    // page actually priced is stamped; a page pricing NOTHING for the item
    // proves nothing either — its orders may all have been excluded from the
    // priced patch (an unpriceable location, a bad price or type), which is
    // silence, not an empty book. So a derived observation never earns the
    // whole-book "read, empty" stamp: that is a NAMED query's evidence.
    if (observed.derived) {
      const carried = Object.keys(map[itemId] || {}).filter((q) => {
        const entry = map[itemId][q][city];
        return entry && entry[priceField] > 0;
      });
      for (const quality of carried) map[itemId][quality][city][field] = now;
      continue;
    }
    if (!map[itemId]) map[itemId] = {};
    if (!map[itemId][1]) map[itemId][1] = {};
    if (!map[itemId][1][city]) map[itemId][1][city] = blankEntry();
    for (const quality of Object.keys(map[itemId])) {
      const entry = map[itemId][quality][city];
      if (entry) entry[field] = now;
    }
  }
}

/**
 * Reduce raw orders to {itemId: {quality: {city: entry}}}.
 * Orders from a location the app does not price (dens, hideout banks, roads)
 * are skipped — they are still uploaded, they just have no column here.
 *
 * @param {object[]} orders
 * @param {object} [options]
 * @param {string} [options.now]        capture timestamp for the entry dates
 * @param {object} [options.observed]   {side:"offer"|"request", itemIds:string[],
 *   derived?:boolean} — the query this response answered. Present, it records
 *   that the book was READ, which is what tells a stale price from an unwatched
 *   one. `derived` marks items named by the ORDERS rather than by a request —
 *   a category browse page, which is evidence only about what it carried.
 * @param {string} [options.city]       the market that was read, for the stamp
 */
function ordersToPrices(orders, { now = new Date().toISOString(), observed = null, city: seenCity = null } = {}) {
  const map = {};
  if (!Array.isArray(orders)) {
    stampBookSeen(map, { now, observed, city: seenCity });
    return map;
  }

  for (const order of orders) {
    const city = cityOf(order && order.LocationId);
    if (!city) continue;
    const itemId = orderItemId(order);
    if (!itemId) continue;

    const raw = Number(order.UnitPriceSilver);
    if (!Number.isFinite(raw) || raw <= 0) continue;
    const price = Math.floor(raw / SILVER_SCALE);
    if (price <= 0) continue;

    const type = String(order.AuctionType || "").toLowerCase();
    if (type !== "offer" && type !== "request") continue;

    const quality = Number(order.QualityLevel) || 1;
    if (!map[itemId]) map[itemId] = {};
    if (!map[itemId][quality]) map[itemId][quality] = {};
    if (!map[itemId][quality][city]) map[itemId][quality][city] = blankEntry();
    const entry = map[itemId][quality][city];

    if (type === "offer") {
      if (entry.sell_price === 0 || price < entry.sell_price) {
        entry.sell_price = price;
        entry.sell_date = now;
        entry.sell_src = "sniffer";
      }
    } else if (price > entry.buy_price) {
      entry.buy_price = price;
      entry.buy_date = now;
      entry.buy_src = "sniffer";
    }
  }
  stampBookSeen(map, { now, observed, city: seenCity });
  return map;
}

/**
 * The later of two "book was read" stamps, undefined when there is neither.
 * A stamp only ever moves forward: a patch replayed out of order (a teammate's
 * cell through the shared folder, a hydrate landing after a live capture) must
 * not un-see a book that has been looked at since.
 */
function newerStamp(previous, next) {
  if (!previous) return next || undefined;
  if (!next) return previous;
  return Date.parse(next) > Date.parse(previous) ? next : previous;
}

/**
 * How far apart two readings of one book may be and still be the SAME look at
 * it — the window js/price-freshness.js uses for the "not listed" flag, and for
 * the same reason: order lists answer in price-ascending PAGES.
 *
 * Within one browse, a later page holds an item's DEARER orders, so taking the
 * newest reading wholesale replaced the board's cheapest ask with whatever the
 * last page happened to carry. Inside the window the two pages are reduced the
 * way orders within one page already are: min over asks, max over bids.
 */
const SAME_LOOK_MS = 60 * 1000;

/** Whether two readings fall inside one look at the book. */
function sameLook(previous, next) {
  const a = previous ? Date.parse(previous) : NaN;
  const b = next ? Date.parse(next) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(b - a) <= SAME_LOOK_MS;
}

/**
 * Fold one captured cell onto what is already known about it.
 *
 * A patch only ever carries the side its response was about: the game answers
 * the sell list (AuctionGetOffers) and the buy list (AuctionGetRequests) in
 * separate messages, so an offers patch says `buy_price: 0` about a bid it
 * simply never saw. Overwriting the cell wholesale made the second response
 * erase the first — open the sell tab then the buy tab and only the buy side
 * survived, which is precisely the field the crafting table sources materials
 * from. A zero in the patch therefore means "not observed", not "gone".
 *
 * `volume_24h` is inherited for the same reason: a listing is not a trade, so
 * the capture never measures volume and must not wipe what the scan did.
 */
/**
 * Is this side of a cell a price AODP's 24h history invented, not a listing?
 *
 * js/api.js mergeEntryWithHistory flags the side it made up (sell_fallback /
 * buy_fallback). A cell stored before those flags existed carries only
 * used_fallback, which cannot say which side it was — so both count as
 * invented there. A real reading carries neither.
 */
function isInventedSide(entry, side) {
  if (!entry) return false;
  const own = entry[side === "buy" ? "buy_fallback" : "sell_fallback"];
  if (own === true) return true;
  if (own === false) return false;
  const other = entry[side === "buy" ? "sell_fallback" : "buy_fallback"];
  return !!entry.used_fallback && other === undefined;
}

function mergeEntry(previous, next) {
  if (!previous) return next;
  const merged = { ...previous, ...next };
  const sellSeen = newerStamp(previous.sell_seen, next.sell_seen);
  const buySeen = newerStamp(previous.buy_seen, next.buy_seen);
  if (sellSeen) merged.sell_seen = sellSeen;
  if (buySeen) merged.buy_seen = buySeen;
  // Whether the price standing at the end of this fold is the one that was
  // already there — the flag below rides along with it.
  let keptSell = false;
  let keptBuy = false;
  if (!next.sell_price && previous.sell_price) {
    merged.sell_price = previous.sell_price;
    merged.sell_date = previous.sell_date;
    keptSell = true;
  }
  if (!next.buy_price && previous.buy_price) {
    merged.buy_price = previous.buy_price;
    merged.buy_date = previous.buy_date;
    keptBuy = true;
  }
  // Two pages of one browse: keep the better side of the book, not the later
  // page. Outside the window the newer reading simply wins — the cheap ask is
  // gone, which is the whole point of re-reading a market.
  if (next.sell_price && previous.sell_price
    && sameLook(previous.sell_date, next.sell_date)
    && previous.sell_price < next.sell_price) {
    merged.sell_price = previous.sell_price;
    merged.sell_date = previous.sell_date;
    keptSell = true;
  }
  if (next.buy_price && previous.buy_price
    && sameLook(previous.buy_date, next.buy_date)
    && previous.buy_price > next.buy_price) {
    merged.buy_price = previous.buy_price;
    merged.buy_date = previous.buy_date;
    keptBuy = true;
  }
  // A price invented from the 24h history never replaces a real one, however
  // much newer its date: it is a guess, and the stored side is a reading. Real
  // report — an invented 712,435 Caerleon ask displaced a captured 8,400 one.
  if (next.sell_price && previous.sell_price > 0 && !keptSell
    && isInventedSide(next, "sell") && !isInventedSide(previous, "sell")) {
    merged.sell_price = previous.sell_price;
    merged.sell_date = previous.sell_date;
    merged.sell_fallback = false;
    keptSell = true;
  }
  if (next.buy_price && previous.buy_price > 0 && !keptBuy
    && isInventedSide(next, "buy") && !isInventedSide(previous, "buy")) {
    merged.buy_price = previous.buy_price;
    merged.buy_date = previous.buy_date;
    merged.buy_fallback = false;
    keptBuy = true;
  }
  // A side kept from `previous` keeps its own flag; one taken from `next` keeps
  // next's, which the spread above already put there.
  if (keptSell && previous.sell_fallback !== undefined) merged.sell_fallback = previous.sell_fallback;
  if (keptBuy && previous.buy_fallback !== undefined) merged.buy_fallback = previous.buy_fallback;
  // Provenance always follows the WINNING price per side: the kept side keeps
  // previous's source, a replaced side takes next's, an absent one is null —
  // never a stale flag riding along with a price it does not describe.
  merged.sell_src = (keptSell ? previous.sell_src : next.sell_src) || null;
  merged.buy_src = (keptBuy ? previous.buy_src : next.buy_src) || null;
  // `used_fallback` says "a price in this cell was invented from the 24h
  // history" (js/api.js). It arrives on the patch, so taking it from `next`
  // alone cleared the flag off a price the patch never replaced — a
  // history-derived number then read as a real order book. Whenever a stored
  // side survives the fold, its flag survives with it.
  if (keptSell || keptBuy) {
    merged.used_fallback = !!next.used_fallback || !!previous.used_fallback;
  }
  // With both per-side flags known the cell-wide flag is exact.
  if (typeof merged.sell_fallback === "boolean" && typeof merged.buy_fallback === "boolean") {
    merged.used_fallback = merged.sell_fallback || merged.buy_fallback;
  }
  if (!next.volume_24h && previous.volume_24h) merged.volume_24h = previous.volume_24h;
  return merged;
}

/**
 * Fold a patch into an existing {item: {quality: {city: entry}}} map,
 * touching only the cells actually observed. Returns the number written.
 */
function mergeQualityPrices(target, patch) {
  let written = 0;
  for (const itemId of Object.keys(patch || {})) {
    if (!target[itemId]) target[itemId] = {};
    for (const quality of Object.keys(patch[itemId])) {
      if (!target[itemId][quality]) target[itemId][quality] = {};
      for (const city of Object.keys(patch[itemId][quality])) {
        target[itemId][quality][city] = mergeEntry(
          target[itemId][quality][city], patch[itemId][quality][city],
        );
        written++;
      }
    }
  }
  return written;
}

/**
 * Fold a flat {item: {city: entry}} patch into a map of the same shape —
 * the form the app's own scan produces. Returns the number of cells written.
 */
function mergeFlatPrices(target, patch) {
  let written = 0;
  for (const itemId of Object.keys(patch || {})) {
    if (!target[itemId]) target[itemId] = {};
    for (const city of Object.keys(patch[itemId])) {
      target[itemId][city] = mergeEntry(target[itemId][city], patch[itemId][city]);
      written++;
    }
  }
  return written;
}

/** Project one quality onto the plain {item: {city: entry}} shape. */
function flattenQuality(map, quality = 1) {
  const flat = {};
  for (const itemId of Object.keys(map || {})) {
    const byCity = map[itemId][quality];
    if (!byCity || !Object.keys(byCity).length) continue;
    flat[itemId] = { ...byCity };
  }
  return flat;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ordersToPrices, mergeQualityPrices, mergeFlatPrices, flattenQuality, orderItemId, SILVER_SCALE,
    mergeEntry, isInventedSide,
    stampBookSeen, seenFieldFor, newerStamp, sameLook, SAME_LOOK_MS,
  };
}
