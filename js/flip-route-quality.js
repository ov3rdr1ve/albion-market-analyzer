/**
 * The Flipping route across QUALITIES: one pair, both legs at the same quality.
 *
 * js/flip-route.js answers "the best (buy city, sell city) pair for this item",
 * reading the flat price map — which is projected from quality 1 alone. That
 * hid every Good and Outstanding book the sniffer captures, and it is why "the
 * sniffer sees Caerleon but the Rootbound Staff's instant buy price never
 * updates" was true: Caerleon had no Normal ask, only Good ones.
 *
 * The fix is not to let a Good ask stand in for a Normal one. A flip is a
 * matched pair — you buy a specific item and sell that same item — so quoting
 * a Good staff's 698,874 against the Black Market's NORMAL bid of 755,274
 * invents a 31% profit that nobody can take. Instead every priced quality is
 * routed INDEPENDENTLY, through the very same findBestFlipPair, and the best
 * complete pair wins.
 *
 * Each quality is a view keyed `ITEM#Q<n>` (js/quality-flat-views.js), so the
 * IQR fence, the volume gate and the price overrides are all naturally per
 * quality without findBestFlipPair or js/utils.js knowing this file exists.
 *
 * Ranking between qualities repeats the rule findBestFlipPair applies inside
 * one, because the reason is the same: a pair whose both legs clear the volume
 * gate outranks any thin pair however fat, since a book nothing trades in is a
 * price you cannot act on. Profit breaks the remaining ties, scored with the
 * same calculateFlipMargin the row prints, and a true tie keeps the LOWER
 * quality — quality 1 first — so a row does not re-key itself between renders.
 *
 * `byQuality` carries every quality's pair back to the caller, which is what
 * lets a row show what its other qualities are worth instead of silently
 * discarding them.
 *
 * Depends on js/quality-flat-views.js and js/flip-route.js. Loaded after both,
 * before js/render-flipping.js.
 */

/** Net profit of a pair, scored exactly as the row's Pure Profit column is. */
function flipQualityProfit(pair) {
  if (!pair || !pair.buyCity || !pair.sellCity) return -Infinity;
  const travel = pair.travelCost || 0;
  return typeof calculateFlipMargin === "function"
    ? calculateFlipMargin(pair.buyPrice, pair.sellPrice, travel).profit
    : pair.sellPrice - pair.buyPrice - travel;
}

/** Does `candidate` beat `champion`? Liquid first, then profit, ties keep the champion. */
function flipQualityBeats(candidate, champion) {
  if (!champion) return true;
  if (candidate.liquid !== champion.liquid) return candidate.liquid;
  return candidate.profit > champion.profit;
}

/** The date the badge beside a leg would print, or null. */
function flipLegDate(entry, side) {
  if (!entry) return null;
  return typeof priceDateFor === "function"
    ? priceDateFor(entry, side)
    : (entry[side === "buy" ? "buy_date" : "sell_date"] || null);
}

/**
 * May a non-Normal quality TAKE the row? Only if it can say when it was seen.
 *
 * Quality 1 is the app's baseline: the market scan fetches `qualities=1` every
 * time (js/api.js), so a Normal cell is as fresh as the last scan. Qualities 2
 * to 5 come from the Rerolling scan and from captures, on their own clocks —
 * and the Rerolling fetch used to drop the dates entirely, so a stored quality
 * book can be old with nothing on the row to admit it. Letting an undated cell
 * outrank a dated Normal one would replace a price the reader can judge with
 * one they cannot.
 *
 * A leg the user has pinned counts as dated: the number is theirs, and an
 * override never carries a market timestamp anyway (priceTd hides the badge
 * for exactly that reason).
 *
 * Undated qualities are still evaluated and still reported in `byQuality` —
 * they simply do not win the row.
 */
function flipQualityIsDatable(view, pair, sideMode) {
  if (view.quality === 1) return true;
  const book = view.data[view.viewId] || {};
  const legs = [[pair.buyCity, "buy"], [pair.sellCity, "sell"]];
  return legs.every(([city, side]) => {
    if (flipLegDate(book[city], side)) return true;
    if (typeof getOverrideField !== "function") return false;
    const pinned = sideMode
      ? getOverrideField(view.viewId, city, side)
      : (typeof getOverridePrice === "function" ? getOverridePrice(view.viewId, city) : null);
    return pinned !== null && pinned !== undefined;
  });
}

/**
 * The best leg on each side of one view, resolved INDEPENDENTLY.
 *
 * This is the quote for a book that has only one side — the reported case:
 * `T8_SHOES_LEATHER_HELL@4` holds a Black Market bid at qualities 1, 2 and 3
 * and a Caerleon ask at quality 4, so not one quality is a matched pair and the
 * item used to render as a bare "no data" row with every captured bid thrown
 * away.
 *
 * It is NOT a route: `findBestFlipPairAcrossQualities` files it with
 * `routable: false`, it can never take the row, and no profit is computed from
 * it. It exists so the ladder can say "the Black Market bids 3,850,938 for the
 * Outstanding one, and nobody is asking" instead of saying nothing.
 *
 * Prices come from `flipLegs` (js/flip-route.js) rather than a second reader, so
 * the IQR fence, the volume gate and the side-specific overrides are exactly the
 * ones a routable line obeys.
 *
 * @returns {object|null} a partial pair, or null when the view has no price at
 *   all on either side.
 */
function flipQualityOneSided(view, buyCities, sellCities, options) {
  const data = view.data || {};
  const bounds = typeof getIQRBounds === "function" ? getIQRBounds(data[view.viewId]) : null;
  const minVolume = options.minVolume || 0;
  const minSellVolume = options.minSellVolume ?? minVolume;
  const sideMode = !!options.sideMode;
  const best = (cities, side) => {
    if (typeof flipLegs !== "function") return null;
    const list = typeof flipCandidateCities === "function"
      ? flipCandidateCities(view.viewId, cities, side)
      : (cities || []);
    const legs = flipLegs(data, view.viewId, list, side, bounds,
      side === "sell" ? minSellVolume : minVolume, sideMode);
    if (!legs.length) return null;
    // Cheapest ask to buy at, fattest bid to sell into — the extremes
    // findBestFlipPair would have paired had the other side existed.
    return legs.reduce((champ, leg) =>
      ((side === "buy" ? leg.price < champ.price : leg.price > champ.price) ? leg : champ));
  };
  const buy = best(buyCities, "buy");
  const sell = best(sellCities, "sell");
  if (!buy && !sell) return null;
  return {
    buyCity: buy ? buy.city : null,
    buyPrice: buy ? buy.price : 0,
    sellCity: sell ? sell.city : null,
    sellPrice: sell ? sell.price : 0,
    travelCost: 0,
    liquid: false,
  };
}

/**
 * Best flip pair for one item over every quality it is priced at.
 *
 * @param {object} flatData     {itemId: {city: entry}} — the app's flat map
 * @param {object} qualityData  {itemId: {quality: {city: entry}}}
 * @param {string} itemId
 * @param {string[]} buyCities
 * @param {string[]} sellCities
 * @param {{minVolume?:number, sideMode?:boolean, qualities?:number[]}} [options]
 *   passed through to findBestFlipPair (and to qualityViewsFor for `qualities`)
 * @returns {{buyCity:string|null, buyPrice:number, sellCity:string|null,
 *   sellPrice:number, travelCost:number, liquid:boolean, quality:number,
 *   viewId:string, byQuality:object[]}}
 *   `viewId` is the id the winning pair's prices are filed under — the id a
 *   volume read or a price override for this row must use, NOT the item id.
 */
function findBestFlipPairAcrossQualities(flatData, qualityData, itemId, buyCities, sellCities, options = {}) {
  const views = typeof qualityViewsFor === "function"
    ? qualityViewsFor(itemId, flatData, qualityData, options)
    : [{ quality: 1, viewId: itemId, data: flatData || {} }];

  const byQuality = [];
  let champion = null;
  views.forEach((view) => {
    // The view id is what the PRICES are filed under; the real id and quality
    // are what a standing order of the player's own is filed under.
    const pair = findBestFlipPair(view.data, view.viewId, buyCities, sellCities, {
      ...options, ownItemId: itemId, quality: view.quality,
    });
    if (!pair.buyCity || !pair.sellCity) {
      // No matched pair at this quality. Report whichever side the book DOES
      // hold rather than discarding the reading: a Black Market bid with no ask
      // anywhere is not a trade, but it is the only price this item has.
      const quote = flipQualityOneSided(view, buyCities, sellCities, options);
      if (quote) {
        byQuality.push({
          ...quote,
          quality: view.quality,
          viewId: view.viewId,
          profit: null,
          routable: false,
          datable: false,
        });
      }
      return;
    }
    const scored = {
      ...pair,
      quality: view.quality,
      viewId: view.viewId,
      profit: flipQualityProfit(pair),
      routable: true,
      datable: flipQualityIsDatable(view, pair, !!options.sideMode),
    };
    byQuality.push(scored);
    // `routable` as well as `datable`: a one-sided quote carries no profit and
    // must never be the pair the row prints.
    if (scored.routable && scored.datable && flipQualityBeats(scored, champion)) champion = scored;
  });

  if (!champion) {
    return {
      buyCity: null, buyPrice: 0, sellCity: null, sellPrice: 0, travelCost: 0,
      liquid: false, quality: 1, viewId: itemId, byQuality,
    };
  }
  return { ...champion, byQuality };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { findBestFlipPairAcrossQualities, flipQualityProfit, flipQualityBeats, flipQualityOneSided };
}
