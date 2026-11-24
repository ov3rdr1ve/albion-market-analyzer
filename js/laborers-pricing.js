/**
 * What one laborer cycle is worth: the specs that describe a play, the payload
 * revenue per mode, the best buy/run city pair, and the price lookups the cells
 * read. Split out of render-laborers.js, which was over the file-size limit and
 * mixed this pricing model with the table markup.
 *
 * Loaded before js/render-laborers.js; every name here is a browser global the
 * renderer (and the Building Costs table, which reuses the journal model) reads.
 * The revenue formulas and the no-travel-fee assumption are documented in
 * js/render-laborers.js.
 */
// The city the user pinned for one side of an item, honoured only when a price
// override actually backs it — the same rule findBestRoute uses (js/utils.js:996)
// so a force left behind by a cleared override stays inert.
//
// getBuyPrice/getSellPrice only see an override AT THE CITY THEY ARE HANDED, so
// every cell that prices at a fixed city (the route city, a row's anchor) has to
// ask this first. Without it a price typed at Lymhurst was stored, invisible,
// and the cell snapped back to the route city on the next render.
function _pinnedCity(itemId, side) {
  if (!itemId || typeof getCityForce !== "function") return null;
  const forced = getCityForce(itemId, side);
  if (!forced) return null;
  if (typeof getOverridePrice !== "function") return forced;
  return getOverridePrice(itemId, forced) !== null ? forced : null;
}

// Allowed laborer cities + filled-journal source cities, gated on the
// Black/Red Zone Routes toggle (mirrors render-flipping.js:39-44).
// Laborers live on an island, so they run out of a CRAFT city — never out of a
// Smuggler's Den (market only). Journals can still be sourced from any market the
// zone rules allow.
function _laborerCityCandidates() {
  if (typeof isBlackRedZoneEnabled === "function" && isBlackRedZoneEnabled()) {
    return { cities: CRAFT_CITIES, splitCaerleon: false };
  }
  return { cities: [...ROYAL_CITIES, "Caerleon"], splitCaerleon: true };
}

function _filledBuyCities(laborerCity, splitCaerleon) {
  if (!splitCaerleon) return CITIES;
  if (laborerCity === "Caerleon") return ["Caerleon"];
  return ROYAL_CITIES;
}

// Fallback laborer city for rows with no market data (no computed route). Used
// only to anchor the editable price cells so the user can type in prices for
// an otherwise-blank row; the override they set is keyed by (itemId, city), so
// the next render recomputes the real route once enough cells are filled.
function _defaultLaborerCity() {
  const { cities } = _laborerCityCandidates();
  return cities[0] || "";
}

// ─── Payload revenue per cycle (mode-specific) ───────────────────────────

// Every helper takes an explicit `yield_` (the yield % as a multiplier). It
// defaults to the SAME-TIER yield for `tier`, but the Best-Journal search feeds
// 1.5 when a HIGHER-tier laborer runs this (lower) tier's journal.
function _trophyRevenue(trophyId, tier, marketData, laborerCity, yield_ = getLaborerYield(tier)) {
  const bounds = getIQRBounds(marketData[trophyId]);
  const price = getSellPrice(marketData[trophyId], laborerCity, bounds, trophyId);
  if (price <= 0) return { revenue: 0, payloadPrice: 0, hasData: false };
  return {
    revenue: price * yield_ * (1 - PREMIUM_TAX),
    payloadPrice: price,
    hasData: true,
  };
}

function _resourceRevenue(resourceSlug, tier, marketData, laborerCity, yield_ = getLaborerYield(tier)) {
  const total = GATHERER_BASELOOT[tier] || 0;
  if (total <= 0 || !resourceSlug) return { revenue: 0, hasData: false };
  let revenue = 0;
  let hasAnyData = false;
  getLaborerEnchantDistribution(resourceSlug, tier).forEach((e) => {
    const id = getEnchantedResourceId(resourceSlug, tier, e.level);
    const bounds = getIQRBounds(marketData[id]);
    const price = getSellPrice(marketData[id], laborerCity, bounds, id);
    if (price > 0) hasAnyData = true;
    const qty = total * yield_ * e.prob;
    revenue += qty * price * (1 - PREMIUM_TAX);
  });
  return { revenue, hasData: hasAnyData, payloadPrice: 0 };
}

// Fisherman Resource mode. The journal returns a FIXED, biome-independent mix
// defined by its lootlist (items.xml). We value the catch as a weight-share
// expected value over every line: a roll picks ONE line by weight/Σweight and
// returns `amount` of that item. `baselootamount × yield` is the number of
// rolls per cycle. This replaces the old "best common + 15% of the single most
// expensive biome rare" heuristic, which overstated revenue ~2-4× by valuing
// every rare at a cherry-picked max instead of as 1-of-21 equal rare lines.
// See data-laborers.js FISH_JOURNAL_LOOTLIST.
//
// THE DENOMINATOR IS THE PRICED WEIGHT, NOT THE WHOLE LIST. An unpriced line is
// a draw we cannot value, not a draw worth nothing. Dividing by the whole list
// while skipping unpriced lines put their weight in the denominator and nothing
// in the numerator, so every missing line dragged the payload toward zero — and
// only ever downward. The 21 biome rares are 18.2% of the T8 weight and the most
// illiquid ids in the game, so the fisherman's payload came out understated on
// nearly every scan; netted against a journal's market margin that was priced
// off the liquid journal market, it printed a NEGATIVE self-fill profit on every
// fisher row. Land laborers have 4-5 always-traded ids and never hit this.
// Renormalizing assumes an unpriced line is worth the average of the priced
// ones — an assumption, but a bounded one, unlike assuming it is worth zero.
function _fishResourceRevenue(tier, marketData, laborerCity, yield_ = getLaborerYield(tier)) {
  const draws = (FISH_LABORER_BASELOOT[tier] || 0) * yield_;
  const lootlist = FISH_JOURNAL_LOOTLIST[tier];
  const none = { revenue: 0, hasData: false, payloadPrice: 0, pricedWeightShare: 0 };
  if (draws <= 0 || !lootlist) return none;
  const totalWeight = lootlist.reduce((s, line) => s + line[2], 0);
  let pricedWeight = 0;
  let weightedValue = 0;
  let hasCommon = false;
  for (const [id, amount, weight] of lootlist) {
    const price = getSellPrice(marketData[id], laborerCity, getIQRBounds(marketData[id]), id);
    if (price <= 0) continue;
    if (id.includes("_COMMON")) hasCommon = true;
    pricedWeight += weight;
    weightedValue += weight * amount * price;
  }
  // Commons are ~78% of the catch by weight; a row valued only on a stray
  // seaweed/rare listing is not a real fish market, so require ≥1 priced common
  // (mirrors the old "no common → no data" gate).
  if (!hasCommon || pricedWeight <= 0) return none;
  const valuePerDraw = weightedValue / pricedWeight;
  return {
    revenue: draws * valuePerDraw * (1 - PREMIUM_TAX),
    hasData: true,
    payloadPrice: valuePerDraw,
    // How much of the lootlist the estimate actually rests on, for the tooltip.
    pricedWeightShare: totalWeight > 0 ? pricedWeight / totalWeight : 0,
  };
}

// Crafting journals return refined goods with the SAME enchant split as raw
// gathers (1889/100/10/1 at T4+). Enchanted refined materials carry a steep
// premium (T8 @1 ≈ 3× base), so spread each material's mix fraction across the
// enchant levels and price the _LEVELn@n ids — mirrors _resourceRevenue. Valuing
// the whole mix at base price understated crafter revenue ~9-13%.
// `lines` breaks the payload down per refined material — the quantity handed
// back and the silver it is worth, summed over that material's enchant spread.
// Additive: callers that only want the total keep reading `revenue`.
function _craftingRevenue(craftingMix, tier, marketData, laborerCity, yield_ = getLaborerYield(tier)) {
  const total = CRAFTING_BASELOOT[tier] || 0;
  if (total <= 0 || !craftingMix) return { revenue: 0, hasData: false, lines: [] };
  let revenue = 0;
  let hasAnyData = false;
  const lines = [];
  Object.entries(craftingMix).forEach(([refinedSlug, frac]) => {
    let lineQty = 0, lineSilver = 0;
    getLaborerEnchantDistribution(refinedSlug, tier).forEach((e) => {
      const id = getEnchantedResourceId(refinedSlug, tier, e.level);
      const bounds = getIQRBounds(marketData[id]);
      const price = getSellPrice(marketData[id], laborerCity, bounds, id);
      if (price > 0) hasAnyData = true;
      const qty = total * yield_ * frac * e.prob;
      const silver = qty * price * (1 - PREMIUM_TAX);
      revenue += silver;
      lineQty += qty;
      lineSilver += silver;
    });
    // The base id names the line; the enchanted twins are folded into its silver
    // (the spread is 1889/100/10/1, so the base is what you mostly get back).
    lines.push({
      refinedSlug,
      itemId: getEnchantedResourceId(refinedSlug, tier, 0),
      qty: lineQty,
      silver: lineSilver,
    });
  });
  return { revenue, hasData: hasAnyData, payloadPrice: 0, lines };
}

// Own-tier yield for a row spec: the trophies that reach THIS laborer's type.
// Trophy-mode rows carry the laborer they belong to, so a Lumberjack running a
// trophy journal still counts its wood trophies.
function _specOwnTierYield(spec) {
  const slug = (spec.laborer && spec.laborer.slug) || spec.journalSlug || null;
  return getLaborerYieldFor(slug, spec.tier);
}

function _mercenaryRevenue(tier, yield_ = getLaborerYield(tier)) {
  // Flat silver payout — no market tax on direct silver. Always has data.
  const silver = MERCENARY_SILVER_BY_TIER[tier] || 0;
  return {
    revenue: silver * yield_,
    payloadPrice: silver,
    hasData: silver > 0,
  };
}

// `spec.yield` (set by the spec builders / Best-Journal search) overrides the
// default own-tier yield. Lets a tier-T laborer be valued running a tier-J
// journal at 1.5 when J < T. The fallback names the laborer, because the trophy
// ceiling is type-dependent — a crafting laborer has no trophy of its own.
function _computeRevenueForMode(spec, marketData, laborerCity) {
  const y = spec.yield != null ? spec.yield : _specOwnTierYield(spec);
  switch (spec.mode) {
    case LABORER_MODE.TROPHY:    return _trophyRevenue(spec.trophyId, spec.tier, marketData, laborerCity, y);
    case LABORER_MODE.RESOURCE:  return spec.resourceSlug
                                   ? _resourceRevenue(spec.resourceSlug, spec.tier, marketData, laborerCity, y)
                                   : _fishResourceRevenue(spec.tier, marketData, laborerCity, y);
    case LABORER_MODE.CRAFTING:  return _craftingRevenue(spec.craftingMix, spec.tier, marketData, laborerCity, y);
    case LABORER_MODE.MERCENARY: return _mercenaryRevenue(spec.tier, y);
    default: return { revenue: 0, hasData: false };
  }
}

// ─── Best-route picker ────────────────────────────────────────────────────

/**
 * `spec` shape:
 *   {
 *     mode: LABORER_MODE.*,
 *     tier: number,
 *     filledId: string,
 *     emptyId: string,
 *     contractId: string | null,
 *     trophyId?: string,        // Trophy mode
 *     resourceSlug?: string,    // Resource mode
 *     craftingMix?: object,     // Crafting mode
 *   }
 *
 * Returns null when no city pair produces a payload with market data.
 */
function computeBestLaborerRoute(spec, marketData) {
  // Buy side only: the one gated lookup here is the filled journal the laborer
  // is fed. The trophy and empty-journal sells are priced ungated below.
  const minVol = ((typeof getOrderType === "function") ? getOrderType("buy") : "market") === "market" ? 25 : 0;
  const { cities: laborerCities, splitCaerleon } = _laborerCityCandidates();

  // When the user has pinned a buy city for the filled journal via override,
  // restrict laborer iteration to laborer cities that can actually source from
  // it. Without this, an unforced "phantom-cheap" city (e.g. Caerleon's
  // history-fallback buy_price for journals when buy_price_max=0) wins on
  // profit and the user's override at Lymhurst has no visible effect.
  // Mirrors findBestRoute's "only honour force when override-backed" semantics
  // (utils.js:564-565) so a force lingering after a cleared override doesn't
  // silently hide rows.
  const forcedBuy = (typeof getCityForce === "function")
    ? getCityForce(spec.filledId, "buy") : null;
  const enforceForcedBuy = forcedBuy
    && (typeof getOverridePrice === "function")
    && getOverridePrice(spec.filledId, forcedBuy) !== null;

  // Sell-side analog for the trophy: it's sold AT the laborer city, so an
  // override-backed force on the trophy sell side means "I want the laborer at
  // THIS city". The EMPTY journal is deliberately NOT here — it's priced
  // independently (see _emptyJournalSell), because pinning the laborer city to
  // the empty-sell city would collapse the route whenever the laborer can't run
  // there (no filled-journal buy / no payload data), making the user's
  // Empty-Sell selection snap back to "no data". The empty journal is weightless
  // and fungible, so it never needs to constrain where the laborer runs.
  const forcedLaborerCity = _pinnedCity(spec.trophyId, "sell");

  // Empty journal sell — priced once, independent of where the laborer runs.
  // Surfaces a real price wherever the empty journal trades (or the exact city
  // the user pinned via the cell editor) and is added as a constant to every
  // candidate laborer city's revenue, so it can never block the route. The price
  // is capped per-city against the filled journal below.
  const emptySell = _emptyJournalSell(marketData, spec.emptyId, laborerCities);

  let best = null;

  for (const laborerCity of laborerCities) {
    if (forcedLaborerCity && laborerCity !== forcedLaborerCity) continue;
    const buyCities = _filledBuyCities(laborerCity, splitCaerleon);
    if (enforceForcedBuy && !buyCities.includes(forcedBuy)) continue;

    const buy = findBestBuyCity(marketData, spec.filledId, buyCities, minVol, laborerCity);
    if (!buy.city || buy.price <= 0) continue;

    const payload = _computeRevenueForMode(spec, marketData, laborerCity);
    if (!payload.hasData) continue;

    const filledCost = buy.price * (1 + SETUP_FEE);
    // An empty journal can never be worth more than the filled one it came from
    // (filled = empty + filling cost). Cap a market-scanned empty sell at the
    // filled buy price so a bogus high listing on the volume-ungated empty market
    // (e.g. a 199,999 troll listing vs a 2,400 filled journal) can't become
    // phantom revenue. A user-pinned override price is respected as-is.
    const emptyPrice = emptySell.pinned ? emptySell.price : Math.min(emptySell.price, buy.price);
    const emptyRevenue = emptyPrice * (1 - PREMIUM_TAX);
    const revenue = payload.revenue + emptyRevenue;
    const profit = revenue - filledCost;
    const margin = filledCost > 0 ? (profit / filledCost) * 100 : 0;

    if (!best || profit > best.profit) {
      best = {
        laborerCity,
        buyCity: buy.city,
        filledPrice: buy.price,
        payloadPrice: payload.payloadPrice || 0,
        payloadRevenue: payload.revenue,
        emptyPrice,
        emptyCity: emptySell.city,
        emptyRevenue,
        filledCost,
        revenue,
        profit,
        margin,
      };
    }
  }

  return best;
}

// ─── Row spec builders (one helper per mode) ─────────────────────────────

// Payload-cell label for a journal spec run at a given yield. Shared by the spec
// builders (same-tier yield) and _buildRow (which uses the BEST journal's yield —
// 1.5 for a lower-tier journal — so the displayed quantity matches the play).
function _journalPayloadLabel(spec, yield_) {
  const t = spec.tier;
  switch (spec.mode) {
    case LABORER_MODE.TROPHY:
      return `Trophy ×${yield_.toFixed(3)}`;
    case LABORER_MODE.RESOURCE:
      return spec.resourceSlug
        ? `${(GATHERER_BASELOOT[t] * yield_).toFixed(1)} ${spec.resourceSlug} (enchant mix)`
        : `${(FISH_LABORER_BASELOOT[t] * yield_).toFixed(1)} fish (journal lootlist mix)`;
    case LABORER_MODE.CRAFTING:
      return `${(CRAFTING_BASELOOT[t] * yield_).toFixed(1)} refined (${_formatMixShort(spec.craftingMix)})`;
    case LABORER_MODE.MERCENARY:
      return `${formatSilver(MERCENARY_SILVER_BY_TIER[t] * yield_)} silver`;
    default:
      return "";
  }
}

function _trophyRowSpec(line, tier) {
  const spec = {
    mode: LABORER_MODE.TROPHY,
    tier,
    laborer: getLaborerForTrophyLine(line),
    laborerName: line.name,
    // The journal family this row runs — the self-fill column needs it to look
    // up which gathering fame fills it (js/laborer-self-fill.js).
    journalSlug: line.journalSlug,
    filledId: getLaborerFilledJournalId(line.journalSlug, tier),
    emptyId:  getLaborerEmptyJournalId(line.journalSlug, tier),
    trophyId: getLaborerTrophyId(line.trophySlug, tier),
  };
  spec.payloadLabel = _journalPayloadLabel(spec, _specOwnTierYield(spec));
  return spec;
}

function _laborerJournalRowSpec(laborer, tier, mode) {
  const spec = {
    mode,
    tier,
    laborer,
    laborerName: laborer.name,
    journalSlug: laborer.slug,
    filledId: getLaborerFilledJournalId(laborer.slug, tier),
    emptyId:  getLaborerEmptyJournalId(laborer.slug, tier),
  };
  if (mode === LABORER_MODE.RESOURCE) {
    spec.resourceSlug = laborer.resourceSlug;
  } else if (mode === LABORER_MODE.CRAFTING) {
    spec.craftingMix = laborer.craftingMix;
  }
  spec.payloadLabel = _journalPayloadLabel(spec, _specOwnTierYield(spec));
  return spec;
}

function _formatMixShort(mix) {
  const map = { METALBAR: "b", PLANKS: "p", CLOTH: "c", LEATHER: "l" };
  return Object.entries(mix)
    .map(([k, v]) => `${Math.round(v * 100)}${map[k] || k.charAt(0).toLowerCase()}`)
    .join("/");
}

// T8 contract market lookup. T8 is the only economically meaningful tier
// for both real-world paths:
//   - "Buy" path: players buy a T8 contract (max-tier, fully leveled) to
//      skip the leveling grind, then run any journal tier on it.
//   - "Level" path: players start with a free T2 apprentice, run journals
//      to level up, and exit by selling the contract at T8 (no one stops at
//      T3 to sell — the contract has no resale niche at intermediate tiers).
//
// So both columns query the T8 contract regardless of the row's journal tier.
// Returns both prices so the table can answer both questions side-by-side.
// Same-city assumption mirrors the rest of this module; no travel fee applies
// anywhere in it (see the module header).
const CONTRACT_TIER = 8;

function _contractLookup(spec, marketData, laborerCity, tier = CONTRACT_TIER) {
  if (!spec.laborer || !spec.laborer.contractSlug || !laborerCity) {
    return { id: null, city: "", buyPrice: 0, sellPrice: 0 };
  }
  const contractId = getLaborerContractId(spec.laborer.contractSlug, tier);
  const itemData = marketData[contractId];
  const bounds = getIQRBounds(itemData);
  // The Buy Contract cell is click-to-edit, and the editor pins the city it was
  // typed at. Each side reads its own pin, so a bought-at price and a sold-at
  // price can sit in different cities.
  const buyCity  = _pinnedCity(contractId, "buy")  || laborerCity;
  const sellCity = _pinnedCity(contractId, "sell") || laborerCity;
  const buyPrice  = getBuyPrice (itemData, buyCity,  bounds, contractId);
  const sellPrice = getSellPrice(itemData, sellCity, bounds, contractId);
  return {
    id: contractId,
    city: buyCity,
    sellCity,
    buyPrice:  buyPrice  > 0 ? buyPrice  : 0,
    sellPrice: sellPrice > 0 ? sellPrice : 0,
  };
}

// Empty journal sell — priced independently of where the laborer runs. The
// empty journal is weightless and fungible, so we value it at the best city it
// actually trades in (or the exact city the user pinned via the cell editor).
// Returns { city, price }.
//
// Two-stage lookup:
//   1. An override-backed sell force (set when the user picks a city in the
//      Empty Sell editor) wins outright — honour exactly that city so switching
//      cities STICKS instead of snapping back to "no data" when the laborer
//      can't run there. Requiring the force to be override-backed mirrors the
//      rest of the module (a stale force from a cleared override stays inert).
//   2. Otherwise scan the candidate cities and take the best available price, so
//      the column surfaces a real number whenever the empty journal trades
//      anywhere reachable — not only at the laborer's run city.
// `pinned` marks an override-backed user pick (stage 1) — that price is honoured
// as-is and is exempt from the empty≤filled cap in computeBestLaborerRoute. A
// market-scanned price (stage 2) is cappable.
function _emptyJournalSell(marketData, emptyId, candidateCities) {
  if (!emptyId) return { city: "", price: 0, pinned: false };
  const bounds = getIQRBounds(marketData[emptyId]);
  const forced = (typeof getCityForce === "function") ? getCityForce(emptyId, "sell") : null;
  if (
    forced &&
    (typeof getOverridePrice !== "function" || getOverridePrice(emptyId, forced) !== null)
  ) {
    const p = getSellPrice(marketData[emptyId], forced, bounds, emptyId);
    return { city: forced, price: p > 0 ? p : 0, pinned: true };
  }
  const cities = candidateCities || _laborerCityCandidates().cities;
  let bestCity = "", bestPrice = 0;
  for (const c of cities) {
    const p = getSellPrice(marketData[emptyId], c, bounds, emptyId);
    if (p > bestPrice) { bestPrice = p; bestCity = c; }
  }
  return { city: bestCity, price: bestPrice, pinned: false };
}

// Per-cell prices for a no-route (no-data) row, valued at the anchor city.
// Reads through getBuyPrice/getSellPrice so any override the user has already
// set surfaces (the ⚡ price), and the filled/empty/trophy cells stay clickable
// even when the market is empty. Pure read — no route, no profit.
// A price the user pinned to another city wins over the anchor — these are the
// rows they are most likely to be filling in by hand, so an edit that vanished
// here left the row looking permanently empty. Each cell reports the city it was
// read at so its label matches its number.
function _emptyRowPrices(spec, marketData, city) {
  const _read = (id, side) => {
    if (!id) return { price: 0, city };
    const at = _pinnedCity(id, side) || city;
    const bounds = getIQRBounds(marketData[id]);
    const p = side === "buy"
      ? getBuyPrice(marketData[id], at, bounds, id)
      : getSellPrice(marketData[id], at, bounds, id);
    return { price: p > 0 ? p : 0, city: at };
  };
  const filled = _read(spec.filledId, "buy");
  const empty  = _read(spec.emptyId, "sell");
  const trophy = _read(spec.trophyId, "sell");
  return {
    filledPrice: filled.price, filledCity: filled.city,
    emptyPrice:  empty.price,  emptyPriceCity: empty.city,
    trophyPrice: trophy.price, trophyCity: trophy.city,
  };
}


if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    computeBestLaborerRoute,
    _pinnedCity,
    _trophyRevenue,
    _resourceRevenue,
    _fishResourceRevenue,
    _craftingRevenue,
    _mercenaryRevenue,
    _contractLookup,
    _emptyJournalSell,
    // The self-fill column values a journal by its PAYLOAD ONLY (no purchase, no
    // resale), so it dispatches through this rather than through a route.
    _computeRevenueForMode,
    // Building Costs reuses these to answer "which journal would this laborer
    // run" without duplicating the yield model.
    _laborerJournalRowSpec,
    _trophyRowSpec,
  };
}
