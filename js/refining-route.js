// Refining route evaluation for the Refining/Transports table: given a refine city
// and a TRANSPORT_ITEMS row, price the buy → refine → sell route and the row's
// focus benchmark. Extracted from render-transport.js, which now only renders.
//
// Raw sourcing has three shapes, all decided here:
//   1. market       — buy the raw outright at the cheapest compatible city;
//   2. transmute    — buy a cheaper lower node of the same family and transmute it
//                     up (refining-transmute-substitute.js). A transmuted raw is a
//                     normal raw: RRR-eligible, and it replaces ALL rawRatio units;
//   3. faction heart— replaces exactly ONE raw unit and is RRR-exempt (consumed).
// (2) and (3) compose: the heart competes against one unit at whatever the raw
// actually costs to obtain, so it is decided after the transmute pick.

function getRefineSpecLabel(city, resourceType) {
  return CITY_REFINE_SPEC[city] === resourceType ? " ★ spec" : "";
}

// A refining route can show a real profit only when every priced input AND the
// sale have market data: the raw, the secondary (when the recipe needs one and
// it isn't chain-sourced), and the refined sell price. Miss any one and the
// margin would be built from partial data — e.g. a 0-priced raw makes the
// refine look free and invents a profit. That was the reported bug: the
// "8.4 planks" row showing "5x 8.4 logs @ no data" yet still printing a profit
// off the priced secondary alone. Callers flag such routes margin -1 so the
// profit reads "no data" like its inputs. See tests/refining-no-data-profit-na.
function isRefineRouteFullyPriced(rawPrice, hasSecondary, secPrice, secChain, sellPrice) {
  if (!(rawPrice > 0)) return false;
  if (hasSecondary && !secChain && !(secPrice > 0)) return false;
  if (!(sellPrice > 0)) return false;
  return true;
}

// Wrap a row's secondary chain into a synthetic root ChainNode representing
// the row's own refining step. Lets pickCheapestFocusTier iterate the row's tier
// alongside every chained intermediate. The wrapper inherits the row's
// refineCity and uses the row's raw market price as the raw input cost.
// `rawFee` is the setup-exempt slice of rawPrice (transmute silver + its station
// fees) — without it the wrapper would re-charge the setup fee on silver the row
// itself keeps exempt, and the picker's per-tier costs would drift from the row.
function buildRootChainForFocus(routeItem, refineCity, rawPrice, secondaryChain, rawFee) {
  const tier = getTierFromId(routeItem.rawId);
  // Apply useFocus=false at root for cost-basis purposes; pickCheapestFocusTier
  // recomputes per-tier RRR via chainSilverCostWithFocusAtTier, so the
  // pre-stored rrr field on this node is not consulted by the picker math.
  return {
    produces: routeItem.refinedId,
    output: 1,
    station: `Refine ${routeItem.resourceType} at ${refineCity}`,
    refineCity,
    rrr: getRefineRRR(refineCity, routeItem.resourceType, false),
    focusCost: getFocusCost(routeItem.refinedId, tier, "refining"),
    tier,
    resourceType: routeItem.resourceType,
    inputs: [
      { matId: routeItem.rawId, count: routeItem.rawRatio,
        sourcing: { perUnit: rawPrice, feePerUnit: rawFee || 0, source: "market", city: null } },
      { matId: routeItem.secondaryMatId, count: routeItem.secondaryMatCount || 0,
        sourcing: { perUnit: secondaryChain.costPerOutput,
          feePerUnit: secondaryChain.feePerOutput || 0, source: "chain", chain: secondaryChain } },
    ],
    costPerOutput: 0, // not consumed by picker
  };
}

// Marginal silver saved per focus point for a single refine. Focus only adds
// RRR, so its value is the extra material it returns: the RRR-eligible material
// cost (raw kept + secondary; the faction heart is RRR-exempt and excluded)
// times the RRR delta (focus vs base), spread over the focus spent. Station and
// travel fees are flat silver and cancel out of the saving. This is the
// single-tier analogue of pickCheapestFocusTier's baseline−cost (which propagates
// the saving up a chain); both express the Silver/Focus column as the silver
// that focus actually adds, not the route's whole profit.
// `setupExemptCost` is the slice of that material cost which was never bought at
// market (transmute silver, a sub-chain's station fees) — returned material saves
// it too, but saving it saves no setup fee.
function marginalSilverPerFocus(rrrEligibleMatCost, baseRrr, focusRrr, focusCost, setupExemptCost = 0) {
  if (!focusCost || focusCost <= 0) return 0;
  const saved = ((rrrEligibleMatCost - setupExemptCost) * (1 + SETUP_FEE) + setupExemptCost)
    * (focusRrr - baseRrr);
  return saved / focusCost;
}

// Find the chain node at a given tier inside a wrapped root chain.
function findChainNodeAt(rootChain, targetTier) {
  let n = rootChain;
  while (n) {
    if (n.tier === targetTier) return n;
    const sec = n.inputs[1];
    n = (sec && sec.sourcing.source === "chain") ? sec.sourcing.chain : null;
  }
  return null;
}


function getSpecRefineCity(resourceType) {
  if (!resourceType) return null;
  return (
    Object.keys(CITY_REFINE_SPEC).find(
      (city) => CITY_REFINE_SPEC[city] === resourceType,
    ) || null
  );
}

// Decide whether a faction heart should replace ONE unit of the RAW resource in
// this refine (wiki: a heart stands in for one raw resource of the biome type,
// T4+, any enchant — e.g. one expensive 8.2 fiber). The heart is RRR-EXEMPT
// (fully consumed); a market raw unit is RRR-eligible, so the heart wins only
// when heartCost < rawUnitCost*(1-rrr). `rawUnitCost` is what one raw unit really
// costs to obtain — the market price, or the transmute route's per-unit cost when
// that is cheaper. Returns the kept raw count, the heart's non-returnable cost +
// travel, and heart display info. The refined secondary is never touched (only the
// raw is substitutable).
// `buyOpts` (refineBuyOpts) narrows where the heart may be bought.
function resolveRefineRawHeart(resourceType, rawRatio, rawUnitCost, rrr, marketData, refineCity, rawId, buyOpts) {
  const out = { usedHeart: false, rawKeptCount: rawRatio, heartCost: 0, heartTravelTotal: 0, secHeart: null };
  if (typeof getHeartSubstitute !== "function" || typeof chooseRawWithHeart !== "function") return out;
  // The .4/pristine and enchanted-rock carve-outs live in heartAllowedForRaw
  // (js/refining-chain-pricing.js) so the chain-level path applies the identical
  // rules — see the comment there for why each one exists.
  if (typeof heartAllowedForRaw === "function" && !heartAllowedForRaw(resourceType, rawId)) return out;
  const heartSrc = getHeartSubstitute(resourceType, marketData, refineCity, buyOpts);
  const c = chooseRawWithHeart(rawUnitCost, heartSrc, rawRatio, rrr);
  out.usedHeart = c.usedHeart;
  out.rawKeptCount = c.rawKeptCount;
  out.heartCost = c.heartCost;
  out.heartTravelTotal = c.heartTravelTotal;
  out.secHeart = c.heart;
  return out;
}

// Source the refine's RAW: cheapest of buying it at market vs buying a lower node
// and transmuting up. Returns the market fields the caller still needs for display
// and travel, plus `transmute` (null when the market buy wins) and `unitCost` —
// the per-unit cost basis every downstream calculation uses. The transmute route's
// per-unit cost already contains its own Brecilien exit fee, so callers must not
// charge raw travel again on top of it.
// `minVolume` gates the substitution's market leaves on the same 24h volume the
// row's own raw buy uses — a start node too thin for the row to buy directly must
// not become a transmute start either.
function resolveRefineRawSourcing(routeItem, bestRawCity, bestRawPrice, refineCity, marketData, minVolume, buyOpts) {
  if (typeof resolveRefineRawSource !== "function") {
    return { unitCost: bestRawCity ? bestRawPrice : 0, unitFee: 0, transmute: null };
  }
  const r = resolveRefineRawSource(
    routeItem.rawId, bestRawCity ? bestRawPrice : 0, bestRawCity, refineCity, marketData,
    { ...(buyOpts || {}), minVolume: minVolume || 0 },
  );
  return { unitCost: r.perUnit, unitFee: r.feePerUnit || 0, transmute: r.transmute };
}

// Source the refined SECONDARY material: cheapest of market vs the recursive
// refining chain (getRefiningSourcing).
//
// This used to take a `forceMarket` flag that skipped the chain, feeding the
// "direct refining" comparison row the table rendered beside every chain row.
// The table now renders only the route it would actually run, so there is no
// second row to price.
//
// Deliberately focus-OFF, and it no longer takes a flag. Focus is a per-refine
// charge that can only be spent at ONE rung of a ladder, so pricing the ladder
// with the focus bonus everywhere invents a discount nobody can buy — and since
// this cost feeds the market-vs-chain gate inside getRefiningSourcing, it also
// chain-refined bars that were cheaper to just purchase. The chain is built at
// base RRR here; the caller re-prices it at the one winning tier below (and the
// Crafting Planner does the same, js/craft-planner-pricing.js:_cpRefineFocusedSourcing).
// See tests/refining-chain-single-tier-focus.
function getSecondarySourcing(secondaryMatId, marketData, refineCity, buyOpts) {
  return getRefiningSourcing(secondaryMatId, marketData, refineCity, false, 0, buyOpts);
}

// The Refining / Transports Buy City pick (js/table-sell-city.js), as the
// sourcing `opts` every market input of a route takes — raw, secondary (and its
// chain leaves), transmute start, heart (getValidBuyCitiesForRefine). With no
// pick it is `undefined`, so every sourcing call prices exactly as before. An
// empty `buyCities` means this refine city cannot source from the pick.
function refineBuyOpts(refineCity) {
  const pick = (typeof getTableBuyCity === "function") ? getTableBuyCity("transport-table") : null;
  if (!pick) return undefined;
  const buyCities = (typeof effectiveBuyCities === "function")
    ? effectiveBuyCities("transport-table", refineCity, CITIES) : [pick];
  return { buyCities };
}

// Markets a refine city may buy its raw in: zone-valid, narrowed to the pick.
function refineRawBuyCities(refineCity, buyOpts) {
  if (typeof getValidBuyCitiesForRefine === "function") {
    return getValidBuyCitiesForRefine(refineCity, buyOpts);
  }
  const all = CITIES.filter((c) => isValidSourceCity(c, refineCity));
  return buyOpts ? all.filter((c) => buyOpts.buyCities.includes(c)) : all;
}

// `orderType` is either one mode applied to both legs (the historical shape) or
// `{buy, sell}` — the header's Buy and Sell Pricing Model radios move
// independently, so the raw purchase and the refined sale gate on their own.
function computeRefineRouteForCity(
  refineCity,
  routeItem,
  marketData,
  orderType,
  forceFocus = false,
) {
  const buyMode = (orderType && typeof orderType === "object") ? orderType.buy : orderType;
  const sellMode = (orderType && typeof orderType === "object") ? orderType.sell : orderType;
  const MIN_VOLUME = buyMode === "market" ? 25 : 0;
  const MIN_SELL_VOLUME = sellMode === "market" ? 25 : 0;
  // `forceFocus` pins the WHOLE evaluation (RRR, secondary sourcing, heart
  // substitution, sell-city pick, even whether the route exists) to focus-on,
  // independent of the "Use Focus" checkbox. renderTransportTable uses a
  // force-focus pass to build the Silver/Focus benchmark so it stays a stable
  // focus-on number — otherwise toggling the checkbox changes the route the
  // benchmark rides on (chain depth, heart, or main↔no-data fallback), making
  // Silver/Focus swing and flip negative. See tests/refining-silver-focus-focus-toggle.
  const useFocusEff = forceFocus || isFocusEnabled();
  const rowTier = getTierFromId(routeItem.rawId);
  // Where the inputs may be bought, under the table's Buy City pick.
  const buyOpts = refineBuyOpts(refineCity);

  // Secondary mat: pick cheaper of market vs refining-chain. The chain is
  // the recursive "refine the lower tier ourselves" path — naturally
  // collapses to the longest profitable sub-chain (full T4→T8 or just the
  // last few tiers). Honors Caerleon↔Royal split and city-force overrides.
  // Always priced at base RRR (see getSecondarySourcing); the focused re-price
  // happens once the winning tier is known, further down.
  let bestSecCity = null;
  let bestSecPrice = 0;
  let bestSecFee = 0;
  let secondaryChain = null;
  if (routeItem.secondaryMatId && typeof getRefiningSourcing === "function") {
    const srcResult = getSecondarySourcing(
      routeItem.secondaryMatId, marketData, refineCity, buyOpts
    );
    bestSecPrice = srcResult.perUnit || 0;
    // The part of a self-refined secondary that is station-fee silver, not a buy.
    bestSecFee = srcResult.feePerUnit || 0;
    if (srcResult.source === "chain") {
      secondaryChain = srcResult.chain;
      bestSecCity = null;
    } else {
      bestSecCity = srcResult.city;
    }
  }

  const rawBounds = getIQRBounds(marketData[routeItem.rawId]);
  let bestRawCity = null;
  let bestRawPrice = 0;
  const forcedRawCity = getCityForce(routeItem.rawId, "buy");
  const rawPool = refineRawBuyCities(refineCity, buyOpts);
  // Only apply force if the pool allows it: compatible with the refine city
  // (Caerleon↔Royal restriction) and never over an active Buy City pick.
  const forceValid = forcedRawCity && rawPool.includes(forcedRawCity);
  if (forceValid) {
    const p = getBuyPrice(marketData[routeItem.rawId], forcedRawCity, rawBounds, routeItem.rawId);
    if (p > 0) { bestRawCity = forcedRawCity; bestRawPrice = p; }
  }
  if (!forceValid || !bestRawCity) {
    let bestRawEff = Infinity;
    rawPool.forEach((city) => {
      const p = getBuyPrice(
        marketData[routeItem.rawId],
        city,
        rawBounds,
        routeItem.rawId,
      );
      const v = marketData[routeItem.rawId]?.[city]?.volume_24h || 0;
      if (
        p > 0 &&
        (v >= MIN_VOLUME || getOverridePrice(routeItem.rawId, city) !== null)
      ) {
        // Hauling raws out of Brecilien to the refine city costs the Travel
        // Planner fee (resources carry fasttravelfactor 4 — large), so rank by
        // effective cost. Refine cities are never Brecilien, so this only
        // penalises Brecilien as a raw-buy source.
        const exit = (typeof legBrecilienCost === "function")
          ? legBrecilienCost(city, refineCity, routeItem.rawId, 1) : 0;
        const eff = p + exit;
        if (eff < bestRawEff) {
          bestRawEff = eff;
          bestRawPrice = p;
          bestRawCity = city;
        }
      }
    });
  }

  // Transmute substitute: a cheaper lower node bought and upgraded into the raw.
  // Evaluated even when the raw itself has no buyable listing — a pristine raw is
  // often unlisted while the node below it trades, and that route is the whole
  // point of the substitution. So the "no route" bail-out below now also lets a
  // transmute-only row through.
  const rawSrc = resolveRefineRawSourcing(
    routeItem, bestRawCity, bestRawPrice, refineCity, marketData, MIN_VOLUME, buyOpts);
  const rawTransmute = rawSrc.transmute;
  if (!bestRawCity && !rawTransmute) return null;
  const rawUnitCost = rawSrc.unitCost;

  // ── Where the focus goes ────────────────────────────────────────────────────
  // A focus point buys extra RRR on ONE refine action. A chain row runs a whole
  // ladder, so the row must choose which rung to spend it on and price every
  // other rung at base RRR — pickCheapestFocusTier answers that (the rung that
  // leaves the sold resource cheapest, since revenue is the same either way).
  // A non-chain row has exactly one refine, so the answer is its own tier.
  //
  // This runs even with focus off: the tier is what the Best Focus column reports
  // and it must not move with the checkbox. Only the RRR below is gated on it.
  let focusTier = rowTier;
  let focusPick = null;
  let rootChain = null;
  if (secondaryChain && !routeItem.outputPerRefine && typeof pickCheapestFocusTier === "function") {
    rootChain = buildRootChainForFocus(
      routeItem, refineCity, rawUnitCost, secondaryChain, rawSrc.unitFee || 0);
    focusPick = pickCheapestFocusTier(rootChain);
    if (focusPick) focusTier = focusPick.tier;
  }

  // The tier focus is actually SPENT at — undefined when the checkbox is off, so
  // every consumer of it (the ladder re-price below, the gathered column) falls
  // back to the base-RRR basis the chain was built with. `focusTier` stays set
  // either way because the Best Focus column reports it in both states.
  const focusSpentTier = useFocusEff ? focusTier : undefined;

  // The row's own refine is focused only when it owns the winning tier.
  const rrr = getRefineRRR(
    refineCity, routeItem.resourceType, focusSpentTier === rowTier);

  // …and when a LOWER rung won instead, the ladder is re-priced with focus there.
  // Same move the Crafting Planner makes in _cpRefineFocusedSourcing.
  if (secondaryChain && focusSpentTier !== undefined && focusSpentTier !== rowTier
      && typeof _chainCostWithFocusAtTier === "function") {
    const focused = _chainCostWithFocusAtTier(secondaryChain, focusSpentTier);
    bestSecPrice = focused.cost;
    bestSecFee = focused.fee || 0;
  }

  const totalSecondaryCost = bestSecPrice * (routeItem.secondaryMatCount || 0);
  const totalSecondaryFee = bestSecFee * (routeItem.secondaryMatCount || 0);

  // Faction-heart substitute for ONE raw unit (RRR-exempt). Decided after the raw's
  // acquisition cost is known, since the heart competes against a single raw unit:
  // it wins only when its market price beats one RRR-discounted raw unit — at the
  // raw's REAL cost, transmuted or bought.
  const rawHeart = resolveRefineRawHeart(
    routeItem.resourceType, routeItem.rawRatio, rawUnitCost, rrr, marketData, refineCity, routeItem.rawId,
    buyOpts,
  );
  const heartCost = rawHeart.heartCost;

  // Inbound Travel Planner fees: raws/secondary/heart hauled out of Brecilien
  // into the (non-Brecilien) refine city. Per refined-output basis, matching
  // the cost basis of calculateTransportMargin. Only the kept raw units are
  // hauled (the heart replaces one) plus the heart's own leg. A transmuted raw
  // already carries its start node's exit fee inside rawUnitCost.
  const rawTravel = (!rawTransmute && bestRawCity && typeof legBrecilienCost === "function")
    ? legBrecilienCost(bestRawCity, refineCity, routeItem.rawId, rawHeart.rawKeptCount) : 0;
  const secTravel = (bestSecCity && typeof legBrecilienCost === "function")
    ? legBrecilienCost(bestSecCity, refineCity, routeItem.secondaryMatId, routeItem.secondaryMatCount || 0) : 0;
  const inboundTravel = rawTravel + secTravel + rawHeart.heartTravelTotal;

  const totalRawCost = rawUnitCost * rawHeart.rawKeptCount;
  // Silver inside totalRawCost/totalSecondaryCost that was never bought at market
  // — transmute fees on the raw, station fees from a self-refined secondary. It is
  // RRR-eligible but pays no setup fee (calculateTransportMargin).
  const setupExemptCost = (rawSrc.unitFee || 0) * rawHeart.rawKeptCount + totalSecondaryFee;
  const refinedBounds = getIQRBounds(marketData[routeItem.refinedId]);
  let bestSellCity = null;
  let bestSellPrice = 0;
  let bestMarginInfo = { margin: -1 };

  // Sell-side zone gate — mirror of the buy-side gate above (and the fallback
  // path's sell gate). The refined-good sell force is one global per item, but
  // the table renders each item in a Caerleon-refine section AND a royal-refine
  // section. Honoring a force the refine city can't reach (e.g. a royal sell
  // forced from the royal row, seen by the Caerleon row) would drop this
  // section's main route to null — silently losing heart substitution and the
  // real best sale. Only pin to the force when it's reachable; else search all.
  const forcedSellCity = getCityForce(routeItem.refinedId, "sell");
  const sellForceValid =
    forcedSellCity && !isInvalidCrossRoute(refineCity, forcedSellCity);
  // The Refining / Transports City pick outranks the per-item force while it is
  // active — the table re-prices to that city instead of hiding rows (see
  // js/table-sell-city.js). CITIES, not SELL_CITIES: refined bars are not
  // Black-Market-traded, so a BM pick simply leaves this table with no sale.
  const sellCitiesToSearch = (typeof effectiveSellCities === "function")
    ? effectiveSellCities("transport-table", refineCity, sellForceValid ? forcedSellCity : null, CITIES)
    : (sellForceValid ? [forcedSellCity] : CITIES);
  sellCitiesToSearch.forEach((sc) => {
    if (!isInvalidCrossRoute(refineCity, sc)) {
      const sPrice = getSellPrice(
        marketData[routeItem.refinedId],
        sc,
        refinedBounds,
        routeItem.refinedId,
      );
      const sVol = marketData[routeItem.refinedId]?.[sc]?.volume_24h || 0;
      if (
        sPrice > 0 &&
        (sVol >= MIN_SELL_VOLUME ||
          getOverridePrice(routeItem.refinedId, sc) !== null)
      ) {
        const productTravel = (typeof legBrecilienCost === "function")
          ? legBrecilienCost(refineCity, sc, routeItem.refinedId, 1) : 0;
        const marginInfo = calculateTransportMargin(
          totalRawCost,
          sPrice,
          rrr,
          totalSecondaryCost,
          refineStationFeeSilver(routeItem.refinedId),
          inboundTravel + productTravel,
          heartCost,
          setupExemptCost,
        );
        if (marginInfo.margin > bestMarginInfo.margin) {
          bestMarginInfo = marginInfo;
          bestSellCity = sc;
          bestSellPrice = sPrice;
        }
      }
    }
  });

  if (!bestSellCity) return null;
  return {
    refineCity,
    // Display/override target for the buy leg: the node actually bought.
    bestRawCity: rawTransmute ? rawTransmute.startCity : bestRawCity,
    bestRawPrice: rawTransmute ? rawTransmute.startPrice : bestRawPrice,
    buyRawId: rawTransmute ? rawTransmute.startId : routeItem.rawId,
    // Cost basis for every downstream calculation (margin, focus, heart).
    rawUnitCost,
    rawUnitFee: rawSrc.unitFee || 0,
    rawTransmute,
    totalRawCost: totalRawCost + totalSecondaryCost + heartCost,
    setupExemptCost,
    sellCity: bestSellCity,
    sellPrice: bestSellPrice,
    marginInfo: bestMarginInfo,
    rrr,
    secPrice: bestSecPrice,
    secCity: bestSecCity,
    totalSecondaryCost,
    heartCost,
    secHeart: rawHeart.secHeart,
    secondaryChain,
    inboundTravel,
    // The single tier this route spent (or would spend) its focus at, plus the
    // picker's own answer and the wrapped ladder. computeRefineFocusColumn reads
    // them instead of re-running the pick, so the Best Focus column can never
    // name a tier other than the one the profit above was priced at.
    focusTier,
    focusSpentTier,
    focusPick,
    rootChain,
  };
}

// Profit per refined output when the RAW resources are self-gathered instead of
// bought — the basis of the "Profit Gathered / 10k Focus" column. Same route as
// the row shows (same refine city, same RRR, same sale), with the raw side free:
//   - raws cost 0 at this refine and at every step of a secondary chain
//     (chainSilverCostGathered), and carry no haul-out fee;
//   - a market-bought refined secondary is still paid for — bars aren't gathered;
//   - the faction heart and the transmute substitute are both purchases, so they
//     can never beat a free raw: the gathered path ignores both;
//   - station fee, setup fee (on what silver remains) and sales tax still apply.
// `result` is either a computeRefineRouteForCity result or the renderer's no-data
// fallback shape — only refineCity/rrr/sellCity/sellPrice/secPrice/secCity/
// secondaryChain are read, so a row whose RAW has no listing still values (the
// gathered path never buys it). Returns null when the sale or a market secondary
// is unpriced, mirroring isRefineRouteFullyPriced minus the raw leg.
function computeRefineGatheredProfit(result, routeItem) {
  if (!result || !(result.sellPrice > 0)) return null;
  const { refineCity, rrr, sellCity, sellPrice, secPrice, secCity, secondaryChain,
    focusSpentTier } = result;

  let secUnit = 0;
  if (routeItem.secondaryMatId) {
    if (secondaryChain) {
      // Same one-tier focus model the route was priced with, so this column
      // values the play the row shows rather than a second, cheaper fiction.
      secUnit = (typeof chainSilverCostGathered === "function")
        ? chainSilverCostGathered(secondaryChain, focusSpentTier)
        : secondaryChain.costPerOutput;
    } else {
      if (!(secPrice > 0)) return null;
      secUnit = secPrice;
    }
  }
  const secCount = routeItem.secondaryMatId ? (routeItem.secondaryMatCount || 0) : 0;
  const secGross = secUnit * secCount;

  const secTravel = (secCity && typeof legBrecilienCost === "function")
    ? legBrecilienCost(secCity, refineCity, routeItem.secondaryMatId, secCount) : 0;
  const productTravel = (sellCity && typeof legBrecilienCost === "function")
    ? legBrecilienCost(refineCity, sellCity, routeItem.refinedId, 1) : 0;

  const cost = secGross * (1 - rrr) * (1 + SETUP_FEE)
    + refineStationFeeSilver(routeItem.refinedId)
    + secTravel + productTravel;
  return sellPrice * (1 - PREMIUM_TAX) - cost;
}

// Build the Silver/Focus column from a FOCUS-ON route result (produced by
// computeRefineRouteForCity with forceFocus=true). Kept separate from the
// profit-path result so the benchmark is invariant to the "Use Focus" toggle:
// chain tier, heart substitution, sell city and route existence are all the
// focus-on ones. Returns null `profitPerFocus` when the focus-on route is
// unpriced. Mirrors the per-tier picker + single-tier math.
function computeRefineFocusColumn(focusResult, routeItem) {
  const tier = getTierFromId(routeItem.rawId);
  // Enchanted-rock rows produce 2^e plain blocks per refine — but focus is NOT
  // spread over them: items.xml `craftingfocus` is a per-OUTPUT-UNIT figure (all
  // five T5_STONEBLOCK recipes carry 94, from the amountcrafted=1 plain one to
  // the amountcrafted=8 .3 one), so one .3 craft burns 94x8 = 752 focus for its
  // 8 blocks. Per block that is the same 94 as a plain refine — enchanted rock
  // buys a material discount, never a focus discount. `outputPerRefine` is kept
  // for the row's tooltip only; dividing focus by it made .3 read 8x cheaper.
  // See tests/refining-enchanted-rock-focus.test.cjs for the items.xml proof.
  if (!focusResult) {
    return { focusCost: getFocusCost(routeItem.refinedId, tier, "refining"), profitPerFocus: null,
      bestFocusPlay: null, focusBestTier: tier, focusMatsList: [],
      refinesPerOutput: 1, outputsPer10kFocus: 0 };
  }
  const {
    refineCity, totalRawCost, heartCost,
    setupExemptCost = 0, focusPick, rootChain,
  } = focusResult;
  const focusRrr = getRefineRRR(refineCity, routeItem.resourceType, true);
  let focusCost, focusBestTier, bestFocusPlay;
  // One unit of output costs this many refines at the focused tier — 1 when the
  // focus lands on the row's own refine, less when it lands on a rung below
  // (a returned bar is never re-refined). The 10k columns divide by it.
  let refinesPerOutput = 1;
  // What a whole focus bar's worth of this play actually BUYS: [{matId, units}].
  let focusMatsList = [];

  // The chain focus-tier picker prices mats off the ladder the route was built
  // with; enchanted-rock rows carry their own rawRatio/secondary counts and no
  // ladder, so they take the simple single-tier path below instead.
  //
  // A chain row refines a whole ladder, so every tier of it is a candidate focus
  // play. The winner is the tier that leaves the SOLD refined resource most
  // profitable — pickCheapestFocusTier, since the sell price is the same tier
  // whichever step gets the focus. Its silverSaved (focus-off cost − focused
  // cost, propagated up the ladder) is exactly the profitDelta the shared
  // Silver/Focus standard ranks on. See js/focus-play.js.
  //
  // The pick itself is NOT redone here: computeRefineRouteForCity already made it
  // and priced the route at that tier, and carries it on `focusPick`/`rootChain`.
  // Re-running it would let this column name a tier the profit was not priced at.
  if (focusPick && rootChain) {
    focusBestTier = focusPick.tier;
    focusCost = focusPick.focusCost;
    const producedAtTier = focusPick.tier === tier
      ? routeItem.refinedId
      : findChainNodeAt(rootChain, focusPick.tier).produces;
    bestFocusPlay = makeFocusPlay({
      kind: "refine", matId: routeItem.refinedId, focusItemId: producedAtTier,
      tier: focusPick.tier, focusCost, profitDelta: focusPick.silverSaved,
    });
    if (typeof refinesPerOutputAtTier === "function") {
      refinesPerOutput = refinesPerOutputAtTier(rootChain, focusBestTier, focusBestTier) || 1;
    }
    // Only the ladder's market leaves are a shopping list — a chain-refined
    // intermediate is produced, so listing it would tell the user to buy a bar
    // the route above already told them to refine.
    if (typeof chainMarketLeafDemand === "function") {
      const outputs = Math.floor(10000 / focusCost) / refinesPerOutput;
      focusMatsList = [...chainMarketLeafDemand(rootChain, outputs, focusBestTier)]
        .map(([matId, units]) => ({ matId, units: Math.round(units) }))
        .sort((a, b) => getTierFromId(b.matId) - getTierFromId(a.matId));
    }
  }
  if (focusBestTier === undefined) {
    focusCost = getFocusCost(routeItem.refinedId, tier, "refining");
    // Raw AND secondary are both RRR-eligible — calculateTransportMargin puts
    // them inside the same (1-rrr) bracket — so the shopping list discounts both.
    focusMatsList = [{
      matId: routeItem.rawId,
      units: matsNeededFor10kFocus(focusCost, routeItem.rawRatio, true, focusRrr),
    }];
    if (routeItem.secondaryMatId) {
      focusMatsList.push({
        matId: routeItem.secondaryMatId,
        units: matsNeededFor10kFocus(
          focusCost, routeItem.secondaryMatCount || 0, true, focusRrr),
      });
    }
    // Single refine, so there is exactly one place the focus can go. Focus only
    // adds RRR, so what it adds to the sold resource is the extra material
    // returned — the RRR-eligible material cost times the focus-vs-base RRR
    // delta. The faction heart is RRR-exempt (fully consumed) and station/travel
    // fees are flat, so they cancel out of the saving; only raw(kept)+secondary
    // count. totalRawCost is the raw+secondary+heart sum (heart decision already
    // applied at focus RRR), so the RRR-eligible base is totalRawCost − heartCost.
    // Its setup-exempt slice (transmute silver, sub-chain station fees) is saved
    // too, but saving it saves no setup fee — hence marginalSilverPerFocus's split.
    const baseRrr = getRefineRRR(refineCity, routeItem.resourceType, false);
    bestFocusPlay = makeFocusPlay({
      kind: "refine", matId: routeItem.refinedId, focusItemId: routeItem.refinedId,
      tier, focusCost,
      profitDelta: marginalSilverPerFocus(
        totalRawCost - (heartCost || 0), baseRrr, focusRrr, focusCost, setupExemptCost) * focusCost,
    });
    focusBestTier = tier;
  }
  return {
    focusCost, focusBestTier, focusMatsList, refinesPerOutput,
    // A focus bar buys floor(10000/focusCost) REFINES; that is only the same as
    // the number of OUTPUTS when the focus sits on the ladder's top step.
    outputsPer10kFocus: Math.floor(10000 / focusCost) / refinesPerOutput,
    bestFocusPlay, profitPerFocus: focusPlayRate(bestFocusPlay),
  };
}

/**
 * Focus-ON profit twins of a refining row, from the SAME force-focus evaluation
 * that backs Silver/Focus (computeRefineRouteForCity with forceFocus=true).
 *
 * The "Profit / 10k Focus" and "Profit Gathered / 10k Focus" columns price a
 * whole 10,000-focus bar, which is focus-on play by definition — so like
 * Silver/Focus they are benchmarks and must not move with the "Use Focus"
 * checkbox. Pairing the invariant focus cost with the checkbox route's profit
 * was exactly that bug. Profit / Margin / Input Cost keep tracking the checkbox.
 *
 * `heartCostFocusOn` / `secHeartFocusOn` are the focus-on heart decision (a
 * heart only wins below rawUnitCost × (1 − rrr), so it can flip with the
 * checkbox); the Faction Spending FP column reads them.
 */
function computeRefineFocusProfit(focusResult, routeItem) {
  if (!focusResult) {
    return { profitFocusOn: null, rrrFocusOn: null, gatheredProfitFocusOn: null,
      heartCostFocusOn: null, secHeartFocusOn: null };
  }
  return {
    profitFocusOn: focusResult.marginInfo ? focusResult.marginInfo.profit : null,
    rrrFocusOn: focusResult.rrr,
    gatheredProfitFocusOn: computeRefineGatheredProfit(focusResult, routeItem),
    heartCostFocusOn: focusResult.heartCost || 0,
    secHeartFocusOn: focusResult.secHeart || null,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    isRefineRouteFullyPriced,
    buildRootChainForFocus,
    marginalSilverPerFocus,
    findChainNodeAt,
    getSpecRefineCity,
    getRefineSpecLabel,
    resolveRefineRawHeart,
    resolveRefineRawSourcing,
    getSecondarySourcing,
    refineBuyOpts,
    refineRawBuyCities,
    computeRefineRouteForCity,
    computeRefineFocusColumn,
    computeRefineGatheredProfit,
    computeRefineFocusProfit,
  };
}
