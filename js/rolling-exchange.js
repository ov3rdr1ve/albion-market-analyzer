/**
 * Energy Manipulator exchange rows for the Artifact Rolling table (pure math —
 * the markup lives in js/render-rolling-exchange.js).
 *
 * Crystal Shards and Fire Dragon Scales are not melded. 50 fragments of a tier
 * hand you the ONE artifact of that family and tier you pick, so the table does
 * not roll anything for them: no 36/50 meld, no roll chance, no salvage, no
 * fragment tier-up or type-up transmute. A row is one family at one tier:
 *
 *   cost    = count × fragment price × (1 + SETUP_FEE)     the buy leg only —
 *             the exchange charges no silver and refunds no fragment
 *   outcome = the best-paying priced pick, net of PREMIUM_TAX
 *   profit  = outcome − cost,   value per fragment = outcome ÷ count
 *
 * Everything is derived from the exchange catalog (js/data-energy-exchange.js);
 * no fragment or artifact id is listed here. Prices go through the same
 * helpers the roll rows use (getBuyPrice / getSellPrice, overrides, city
 * forces), so the Pricing Model, the Premium toggle, the City pickers and typed
 * prices all apply. Two rules the roll rows never needed:
 *   • a REAL quote outranks an invented one (a side AODP's 24h average made up)
 *     whatever the numbers say — an invented price only ever fills a gap;
 *   • an unpriced leg ranks last and never voids a neighbour: no priced pick
 *     keeps the row editable on the first pick, no priced fragment keeps the
 *     best pick visible with a "no data" cost.
 */

const ROLLING_EXCHANGE_CAT = "Exchange";
// Display name of each exchange fragment (the id stem lives in the catalog).
const ROLLING_EXCHANGE_FRAGMENT_LABEL = {
  Crystal: "Crystal Shard",
  Dragon: "Fire Dragon Scales",
};

/** The exchange families, in catalog order ("Crystal", "Dragon"). */
function rollingExchangeFamilies() {
  return Object.keys(ENERGY_EXCHANGE_FRAGMENT_STEM);
}

function rollingExchangeFragmentLabel(family) {
  return ROLLING_EXCHANGE_FRAGMENT_LABEL[family] || family;
}

function rollingExchangeFragmentId(family, tier) {
  return `T${tier}_${ENERGY_EXCHANGE_FRAGMENT_STEM[family]}`;
}

/** The artifacts 50 fragments of `family` at `tier` can buy: [{artId, name, count}]. */
function rollingExchangePicks(family, tier) {
  const fragmentId = rollingExchangeFragmentId(family, tier);
  return ENERGY_EXCHANGE_ITEMS
    .filter((item) => item.materials[0].matId === fragmentId)
    .map((item) => {
      const suffix = item.id.replace(/^T\d+_ARTEFACT_/, "");
      const info = ARTIFACT_MAPPING[suffix];
      return { artId: item.id, name: info && info.name ? info.name : suffix, count: item.materials[0].count };
    });
}

/**
 * Every id the exchange rows price, for the Rolling price scan:
 * { fragments: [...], artifacts: [...] }, both straight from the catalog.
 */
function rollingExchangeItemIds() {
  return {
    fragments: ENERGY_EXCHANGE_FRAGMENT_IDS.slice(),
    artifacts: ENERGY_EXCHANGE_ITEMS.map((item) => item.id),
  };
}

// Was this leg's price invented from the 24h average rather than listed?
// `side` is the order the leg trades ("buy" = you buy, "sell" = you sell); the
// book field it reads follows the Pricing Model, and so does the invented flag.
function _rxInvented(cell, side) {
  if (!cell || typeof isInventedSide !== "function") return false;
  const orderType = typeof getOrderType === "function" ? getOrderType(side) : "market";
  const field = typeof readBookLeg === "function"
    ? readBookLeg(cell, side, orderType, null).field
    : ((side === "buy") === (orderType === "instant") ? "sell_price" : "buy_price");
  return isInventedSide(cell, field === "sell_price" ? "sell" : "buy");
}

// `candidate` replaces `best` when it is real and best is invented, or when both
// are the same kind and it is strictly better (first listed city wins a tie).
function _rxBeats(best, candidate, better) {
  if (!best) return true;
  if (best.invented !== candidate.invented) return best.invented;
  return better(candidate, best);
}

/** Where one artifact sells best over `cities`: {city, price, invented} or null. */
function rollingExchangeSellQuote(marketData, artId, cities) {
  const forced = getCityForce(artId, "sell");
  // Only honour a forced city that is in THIS section and carries a typed price.
  if (forced && cities.includes(forced) && getOverridePrice(artId, forced) !== null) {
    const price = getSellPrice(marketData[artId], forced, null, artId);
    return price > 0 ? { city: forced, price, invented: false } : null;
  }
  let best = null;
  cities.forEach((city) => {
    const typed = getOverridePrice(artId, city, "sell");
    const cell = marketData[artId] && marketData[artId][city];
    if (!cell && typed === null) return;
    const price = getSellPrice(marketData[artId], city, null, artId);
    if (!(price > 0)) return;
    const candidate = { city, price, invented: typed === null && _rxInvented(cell, "sell") };
    if (_rxBeats(best, candidate, (a, b) => a.price > b.price)) best = candidate;
  });
  return best;
}

/** Where the fragment is cheapest over `cities`: {city, price, invented} or null. */
function rollingExchangeBuyQuote(marketData, fragmentId, cities) {
  const data = marketData[fragmentId];
  const bounds = getIQRBounds(data || {});
  const forced = getCityForce(fragmentId, "buy");
  if (forced && cities.includes(forced)) {
    const price = getBuyPrice(data, forced, bounds, fragmentId);
    return price > 0 ? { city: forced, price, invented: false } : null;
  }
  let best = null;
  cities.forEach((city) => {
    const price = getBuyPrice(data, city, bounds, fragmentId);
    if (!(price > 0)) return;
    const typed = getOverridePrice(fragmentId, city, "buy");
    const candidate = { city, price, invented: typed === null && _rxInvented(data && data[city], "buy") };
    if (_rxBeats(best, candidate, (a, b) => a.price < b.price)) best = candidate;
  });
  return best;
}

/**
 * The priced picks of one family/tier, best first, plus the unpriced ones.
 * `net` is what the sale pays after the sales tax and the sell order's fee.
 */
function rollingExchangeRankPicks(picks, marketData, sellCities) {
  const priced = [];
  const unpriced = [];
  picks.forEach((pick) => {
    const quote = rollingExchangeSellQuote(marketData, pick.artId, sellCities);
    if (!quote) { unpriced.push(pick); return; }
    priced.push({ ...pick, city: quote.city, price: quote.price, invented: quote.invented,
      net: quote.price * (1 - PREMIUM_TAX) });
  });
  // Array#sort is stable, so equal nets keep the catalog's order.
  priced.sort((a, b) => (a.invented - b.invented) || (b.net - a.net));
  return { priced, unpriced };
}

function rollingExchangeRow(family, tier, marketData, buyCities, sellCities, section) {
  const picks = rollingExchangePicks(family, tier);
  if (picks.length === 0) return null;
  const fragmentId = rollingExchangeFragmentId(family, tier);
  const count = picks[0].count;
  const { priced, unpriced } = rollingExchangeRankPicks(picks, marketData, sellCities);

  // The fragment is bought somewhere that can reach the city the pick sells in
  // (isInvalidCrossRoute); the best-net pick with a reachable source wins.
  const home = rollingExchangeBuyQuote(marketData, fragmentId, buyCities);
  const sourceFor = (pick) => {
    if (home && !isInvalidCrossRoute(home.city, pick.city)) return home;
    const valid = buyCities.filter((city) => !isInvalidCrossRoute(city, pick.city));
    return valid.length > 0 ? rollingExchangeBuyQuote(marketData, fragmentId, valid) : null;
  };
  let best = null;
  let src = null;
  for (const pick of priced) {
    const found = sourceFor(pick);
    if (found) { best = pick; src = found; break; }
  }
  if (!best && priced.length > 0) best = priced[0]; // priced, but no source can reach it

  const hasNoFragData = !src;
  const hasNoArtData = !best;
  const shown = best || picks[0];
  const net = best ? best.net : 0;
  const rollCostSilver = hasNoFragData ? 0 : count * src.price * (1 + SETUP_FEE);
  const margin = hasNoFragData || hasNoArtData
    ? -999
    : rollCostSilver > 0 ? ((net - rollCostSilver) / rollCostSilver) * 100 : -999;
  const sellCity = best ? best.city : sellCities[0];

  return {
    marginInfo: { margin: hasNoFragData || hasNoArtData ? -1 : margin },
    exchange: true,
    // The row's identity: the fragment, never the best pick (which moves with prices).
    exchangeKey: fragmentId,
    hasOverride: !!(priceOverrides[shown.artId]?.[sellCity]
      || (src && priceOverrides[fragmentId]?.[src.city])),
    hasNoFragData,
    hasNoArtData,
    tier,
    cat: ROLLING_EXCHANGE_CAT,
    rollType: family,
    artName: shown.name,
    artId: shown.artId,
    fragmentId,
    fragLabel: rollingExchangeFragmentLabel(family),
    fragBuyId: fragmentId,
    fragBuyCity: src ? src.city : null,
    fragBuyPrice: src ? src.price : 0,
    fragBuyInvented: !!(src && src.invented),
    fragSalvagePrice: 0,
    fragSourcing: null,
    tokenSub: typeof rollArtifactTokenSubstitute === "function"
      ? rollArtifactTokenSubstitute(shown.artId, marketData, buyCities, best ? best.price : 0)
      : null,
    rollCost: count,
    rollCostSilver,
    bestSellCity: sellCity,
    bestSellPrice: best ? best.price : 0,
    sellInvented: !!(best && best.invented),
    sellRevenue: net,
    action: "SELL",
    margin,
    valuePerFragment: hasNoArtData ? 0 : net / count,
    profitPerFragment: hasNoFragData || hasNoArtData ? null : (net - rollCostSilver) / count,
    picks: priced,
    unpricedPicks: unpriced,
    section,
  };
}

/**
 * The exchange rows of one section: every family × T4..T8, over that section's
 * (already City-picked) buy and sell cities. Always one row per family/tier.
 */
function rollingExchangeRows(marketData, buyCities, sellCities, section) {
  const rows = [];
  ENERGY_EXCHANGE_TIERS.forEach((tier) => {
    rollingExchangeFamilies().forEach((family) => {
      const row = rollingExchangeRow(family, tier, marketData, buyCities, sellCities, section);
      if (row) rows.push(row);
    });
  });
  return rows;
}
