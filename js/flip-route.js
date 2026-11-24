/**
 * The Flipping table's route picker: the best (buy city, sell city) PAIR.
 *
 * Every other table resolves its two legs independently — buy the materials
 * cheapest, sell the product dearest — because the two legs are joined by a
 * craft that can happen anywhere. A flip has no such joint: the pair IS the
 * play, and the legs constrain each other.
 *
 * That is why the greedy version this replaces got the wrong answer. It called
 * findBestBuyCity over the whole list, then findBestSellCity conditioned on the
 * winner, which loses a pair in two ways:
 *
 *   - isInvalidCrossRoute (js/utils.js) bars a Black Market sale unless the
 *     goods were bought in Caerleon. Evaluated after the buy city is locked in,
 *     the fattest bid in the game was thrown away whenever the cheapest buy
 *     happened to land in a royal city — the reported bug,
 *   - the Brecilien exit fee is charged per leg, so "cheapest buy" is not
 *     necessarily cheapest for the sell city that pays most.
 *
 * Both gates that shape the answer are kept:
 *   - the IQR outlier fence, inside getBuyPrice / getSellPrice — a price that
 *     reads as bad data returns 0 and the leg is skipped,
 *   - the volume gate as a PREFERENCE, now pair-wise: a pair whose BOTH legs
 *     clear minVolume (or carry a price override) outranks any thin pair, and
 *     the thin pairs are only consulted when no fully-liquid pair exists. Same
 *     rationale as findBestBuyCity: monitor-captured cells carry volume_24h = 0
 *     by design, and gating them out blanks whole rows that have a real book.
 *
 * Depends on js/utils.js (getBuyPrice, getSellPrice, getIQRBounds, volumeAt,
 * isInvalidCrossRoute, getCityForce, getOverrideField, getOverridePrice) and
 * js/travel-cost.js (legBrecilienCost). Loaded before js/render-flipping.js.
 */

/** Brecilien Travel Planner fee for one unit on this leg (currently 0). */
function flipLegExitFee(buyCity, sellCity, itemId) {
  return typeof legBrecilienCost === "function"
    ? legBrecilienCost(buyCity, sellCity, itemId, 1)
    : 0;
}

/**
 * The candidate cities for one side, honouring a city force.
 *
 * A force pins the leg rather than short-circuiting the whole route: unlike
 * findBestBuyCity, which returns immediately, collapsing the list to the forced
 * city leaves the OTHER side free to be maximised against it. A force naming a
 * city outside the caller's list (e.g. Caerleon while the royal-only branch is
 * rendering) is ignored, as it is there.
 */
function flipCandidateCities(itemId, cities, side) {
  const list = Array.isArray(cities) ? cities : [];
  const forced = typeof getCityForce === "function" ? getCityForce(itemId, side) : null;
  return forced && list.includes(forced) ? [forced] : list;
}

/**
 * Whether a leg's price may be traded on.
 *
 * Two numbers are on the board that no route may use, and both used to route:
 *
 *   - one the book was READ without: the order is gone from the market and the
 *     app keeps it flagged rather than deleting it (bookEmptySince,
 *     js/price-freshness.js), because a missing order is evidence, not proof.
 *     Good enough to print in grey; not good enough to buy a plan on.
 *   - one that is the player's OWN standing order. Routing against it books a
 *     profit against yourself — the reported Black Market case, where the row's
 *     best sell price was the player's own listing and closing it changed
 *     nothing on the board.
 *
 * An override always wins: a number typed by hand is a decision, not a reading.
 */
function flipLegUsable(entry, itemId, quality, city, side, price, hasOverride) {
  if (hasOverride) return true;
  if (typeof bookEmptySince === "function" && bookEmptySince(entry, side)) return false;
  if (typeof isOwnMarketPrice === "function"
    && isOwnMarketPrice(itemId, quality, city, side, price)) return false;
  return true;
}

/** Resolve one side's priced legs once, so the pairing is O(buy + sell) reads. */
function flipLegs(marketData, itemId, cities, side, bounds, minVolume, sideMode, own = {}) {
  const itemData = marketData ? marketData[itemId] : null;
  const readPrice = side === "buy" ? getBuyPrice : getSellPrice;
  const legs = [];
  cities.forEach((city) => {
    const price = readPrice(itemData, city, bounds, itemId, sideMode);
    if (price <= 0) return;
    const hasOverride = (sideMode
      ? getOverrideField(itemId, city, side)
      : getOverridePrice(itemId, city)) !== null;
    if (!flipLegUsable(itemData ? itemData[city] : null, own.itemId || itemId,
      own.quality || 1, city, side, price, hasOverride)) return;
    const vol = typeof volumeAt === "function" ? volumeAt(marketData, itemId, city) : 0;
    legs.push({ city, price, liquid: vol >= minVolume || hasOverride });
  });
  return legs;
}

/**
 * Best flip route for one item.
 *
 * @param {object} marketData   flat price map {itemId: {city: entry}}
 * @param {string} itemId
 * @param {string[]} buyCities
 * @param {string[]} sellCities
 * @param {{minVolume?:number, minSellVolume?:number, sideMode?:boolean}} [options]
 *   minVolume — the 24h volume the BUY leg needs to count as liquid (0 disables
 *   the preference); minSellVolume — the same for the SELL leg, defaulting to
 *   minVolume since the two Pricing Model toggles are independent;
 *   sideMode — read the buy-ORDER / sell-ORDER override fields
 *   independently, which Flipping needs because one row buys AND sells the same
 *   (itemId, city).
 * @returns {{buyCity:string|null, buyPrice:number, sellCity:string|null, sellPrice:number, travelCost:number}}
 */
function findBestFlipPair(marketData, itemId, buyCities, sellCities, options = {}) {
  const minVolume = options.minVolume || 0;
  const minSellVolume = options.minSellVolume ?? minVolume;
  const sideMode = !!options.sideMode;
  const empty = { buyCity: null, buyPrice: 0, sellCity: null, sellPrice: 0, travelCost: 0, liquid: false };

  // The id and quality a standing order of the player's own is filed under.
  // They differ from `itemId` whenever a quality VIEW is being routed, where
  // `itemId` is "T7_2H_WARBOW#Q3" and the order is filed under the real id.
  const own = { itemId: options.ownItemId || itemId, quality: options.quality || 1 };

  const bounds = getIQRBounds(marketData ? marketData[itemId] : null);
  const buys = flipLegs(
    marketData, itemId, flipCandidateCities(itemId, buyCities, "buy"),
    "buy", bounds, minVolume, sideMode, own,
  );
  if (!buys.length) return empty;
  const sells = flipLegs(
    marketData, itemId, flipCandidateCities(itemId, sellCities, "sell"),
    "sell", bounds, minSellVolume, sideMode, own,
  );
  if (!sells.length) return empty;

  // Strictly-greater comparisons throughout: a tie keeps the first pair
  // scanned, so the winning route does not shuffle between renders (which
  // would re-key the row and break _suppressSort's order preservation).
  let best = null;
  let thin = null;
  buys.forEach((b) => {
    sells.forEach((s) => {
      if (isInvalidCrossRoute(b.city, s.city)) return;
      const travelCost = flipLegExitFee(b.city, s.city, itemId);
      // Score the NET profit, not the gross spread. The market fees are
      // multiplicative and the exit fee is flat silver, so the two orderings
      // part company as soon as a leg carries a fee — a fatter spread can lose
      // once the sell-side tax comes off the larger number. calculateFlipMargin
      // is the same function the row's Pure Profit column prints, so the pair
      // that wins here is the pair the user sees win.
      const margin = typeof calculateFlipMargin === "function"
        ? calculateFlipMargin(b.price, s.price, travelCost).profit
        : s.price - b.price - travelCost;
      const liquid = b.liquid && s.liquid;
      const current = liquid ? best : thin;
      if (current && margin <= current.margin) return;
      const pair = {
        buyCity: b.city, buyPrice: b.price,
        sellCity: s.city, sellPrice: s.price,
        travelCost, margin,
      };
      if (liquid) best = pair;
      else thin = pair;
    });
  });

  const pick = best || thin;
  if (!pick) return empty;
  return {
    buyCity: pick.buyCity,
    buyPrice: pick.buyPrice,
    sellCity: pick.sellCity,
    sellPrice: pick.sellPrice,
    travelCost: pick.travelCost,
    // Whether BOTH legs cleared the volume gate. Reported, not acted on here —
    // the caller that compares one item's pairs across QUALITIES
    // (js/flip-route-quality.js) has to apply the same liquid-beats-thin rule
    // between views that this function applies within one, and it cannot see
    // the legs. Additive: every existing caller reads the five fields above.
    liquid: pick === best,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    findBestFlipPair, flipCandidateCities, flipLegExitFee, flipLegs, flipLegUsable,
  };
}
