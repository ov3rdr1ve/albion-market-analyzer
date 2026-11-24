// Refining / Transports table renderer. Route math lives in refining-route.js
// (computeRefineRouteForCity / computeRefineFocusColumn); this file turns a priced
// route into row data and HTML.

// Required-Materials line for a heart substitution, mirroring the amber
// "(via chain)" style. `replacedName` is the raw resource the heart stands in for.
function heartSubstituteLine(secHeart, replacedName) {
  return ` + ${secHeart.count}x ${getItemDisplayName(secHeart.id)} `
    + matPriceSpan(secHeart.id, secHeart.city, secHeart.price)
    + ` <small style="color:#fbbf24" title="${tx("Faction heart stands in for 1x {raw} — cheaper than the raw (heart is consumed; no resource return)", "r_tip_heart_substitute").replace("{raw}", replacedName)}">${tx("(substitute — cheaper than {raw})", "r_substitute_cheaper").replace("{raw}", replacedName)}</small>`;
}

// transmuteSubstituteLines (the "↳ buy the lower node, transmute it up" block)
// lives in js/render-chain-breakdown.js — the Craft Planner's chain expand
// needs the same lines for a raw leg sourced that way.

function renderTransportTable(marketData) {
  const rowData = TRANSPORT_ITEMS.flatMap((routeItem) => {
    // Both Pricing Model toggles: the raw buy and the refined sale gate on
    // their own side (computeRefineRouteForCity accepts either shape).
    const orderType = { buy: getOrderType("buy"), sell: getOrderType("sell") };

    // Emit one row per candidate refine city. Caerleon has NO refine spec, so a
    // Caerleon refine only wins when it reaches prices the spec royal city can't:
    // that's the BMR-off case, where Caerleon sits in its own isolated zone. With
    // Black/Red Zone Routes ON both rows reach the same markets, so the spec city's
    // +40% RRR strictly dominates — the Caerleon row is a worse duplicate (the
    // reported "Buy Brecilien → Refine Caerleon → Sell Brecilien" beside the correct
    // Bridgewatch row). Drop it when BMR is on. updateTableDisplay filters to
    // margin >= 0, so unprofitable rows are hidden automatically.
    const bmrOn =
      typeof isBlackRedZoneEnabled === "function" && isBlackRedZoneEnabled();
    const specRefineCity =
      getSpecRefineCity(routeItem.resourceType) || ROYAL_CITIES[0];
    const candidates =
      specRefineCity !== "Caerleon" && !bmrOn
        ? [specRefineCity, "Caerleon"]
        : [specRefineCity];

    // Build the row for a refine city — the route as it would actually be run,
    // with the secondary sourced the cheaper of market vs chain.
    const buildRow = (rc) => {
      const result = computeRefineRouteForCity(rc, routeItem, marketData, orderType, false);
      // Silver/Focus is a focus-ON benchmark: evaluate the route once more with
      // focus forced on (reuse `result` when the checkbox is already on) and
      // derive the focus column from THAT — so it never moves with the toggle.
      const focusResult = isFocusEnabled()
        ? result
        : computeRefineRouteForCity(rc, routeItem, marketData, orderType, true);
      const focusCol = computeRefineFocusColumn(focusResult, routeItem);
      if (!result) {
        // Zone-valid buy markets, narrowed to the Buy City pick (refineBuyOpts).
        const buyOpts = refineBuyOpts(rc);
        const validBuyCities = refineRawBuyCities(rc, buyOpts);

        // Mirror computeRefineRouteForCity — only honor a forced buy city the
        // pool allows (refine zone with BMR off, and never over an active pick).
        // Otherwise a cross-zone force would silently produce an impossible "buy
        // in Caerleon, refine in Royal" route in the fallback display.
        const forcedCity = getCityForce(routeItem.rawId, "buy");
        const forceValid = forcedCity && validBuyCities.includes(forcedCity);
        let fallbackBuyCity = forceValid ? forcedCity : null;
        let fallbackBuyPrice = 0;
        if (forceValid) {
          fallbackBuyPrice = getBuyPrice(marketData[routeItem.rawId], forcedCity, getIQRBounds(marketData[routeItem.rawId]), routeItem.rawId) || 0;
        }
        if (!forceValid || fallbackBuyPrice <= 0) {
          const fbRes = findBestBuyCity(marketData, routeItem.rawId, validBuyCities, 0, rc);
          fallbackBuyCity = fbRes.city || rc;
          fallbackBuyPrice = fbRes.price || 0;
        }

        let secFallbackPrice = 0;
        // Station-fee silver inside a self-refined secondary: no market setup fee.
        let secFallbackFee = 0;
        let secFallbackCity = rc;
        let secondaryChain = null;
        if (routeItem.secondaryMatId && typeof getRefiningSourcing === "function") {
          const srcResult = getSecondarySourcing(
            routeItem.secondaryMatId, marketData, rc, buyOpts
          );
          secFallbackPrice = srcResult.perUnit || 0;
          secFallbackFee = srcResult.feePerUnit || 0;
          if (srcResult.source === "chain") {
            secondaryChain = srcResult.chain;
            secFallbackCity = rc;
          } else {
            secFallbackCity = srcResult.city || rc;
          }
        }

        // Sell-side mirror of the buy-side gate above. A cross-zone forced sell
        // city (e.g. Caerleon-forced sell while refining at FS) gets dropped
        // in BMR-off mode so the fallback row doesn't display an impossible
        // sell route.
        const refinedId = routeItem.refinedId || routeItem.rawId + "_refined";
        // The table's City pick outranks the per-item force while active: the
        // fallback row is re-priced at that city too, so a filtered table never
        // mixes two sell cities (js/table-sell-city.js).
        const forcedSellCity = getCityForce(refinedId, "sell");
        const pickedSellCities = (typeof effectiveSellCities === "function")
          ? effectiveSellCities("transport-table", rc,
            forcedSellCity && !isInvalidCrossRoute(rc, forcedSellCity) ? forcedSellCity : null, CITIES)
          : null;
        const forcedByFilter = pickedSellCities && pickedSellCities.length === 1
          ? pickedSellCities[0] : null;
        const effectiveForce = forcedByFilter || forcedSellCity;
        const sellForceValid = effectiveForce && !isInvalidCrossRoute(rc, effectiveForce);
        let fallbackSellCity = sellForceValid ? effectiveForce : null;
        let fallbackSellPrice = 0;
        if (sellForceValid) {
          fallbackSellPrice = getSellPrice(marketData[refinedId], effectiveForce, getIQRBounds(marketData[refinedId]), refinedId) || 0;
        }
        // An ACTIVE pick this refine city cannot reach returns an empty list —
        // no honest sale, so the search is skipped rather than widened back to
        // every city (which would quietly undo the filter).
        const pickBlocked = pickedSellCities && pickedSellCities.length === 0;
        if (!pickBlocked && (!sellForceValid || fallbackSellPrice <= 0)) {
          const pool = pickedSellCities && pickedSellCities.length ? pickedSellCities : CITIES;
          const validSellCities = pool.filter(sc => !isInvalidCrossRoute(rc, sc));
          const fbSell = findBestSellCity(marketData, refinedId, validSellCities, 0, rc, rc);
          fallbackSellCity = fbSell.city || rc;
          fallbackSellPrice = fbSell.price || 0;
        }

        const tier = getTierFromId(routeItem.rawId);
        const rrr = getRefineRRR(rc, routeItem.resourceType, isFocusEnabled());
        const stationFee = refineStationFeeSilver(refinedId);

        // Transmute substitute, mirroring the main path: buy a cheaper lower node
        // and upgrade it into the raw. A transmuted raw is RRR-eligible and covers
        // ALL rawRatio units, so it simply replaces the raw's unit cost. Its start
        // node's Brecilien exit fee is already inside fbRawUnitCost, so the raw leg
        // charges no extra travel when the transmute wins.
        const fbRawSrc = resolveRefineRawSourcing(routeItem, fallbackBuyPrice > 0 ? fallbackBuyCity : null, fallbackBuyPrice, rc, marketData, 0, buyOpts);
        const fbTransmute = fbRawSrc.transmute;
        const fbRawUnitCost = fbRawSrc.unitCost;

        // Faction-heart substitute for ONE raw unit (RRR-exempt), mirroring the
        // main path. This branch handles thin-volume rows (raw 24h vol below the
        // order-type gate) — exactly the high-enchant refines where a heart is
        // most often profitable. Without it, a winning heart silently vanished on
        // every fallback row. Disabled at .4 inside resolveRefineRawHeart.
        const fbHeart = resolveRefineRawHeart(
          routeItem.resourceType, routeItem.rawRatio, fbRawUnitCost, rrr, marketData, rc, routeItem.rawId,
          buyOpts,
        );

        // Gross material costs — raw-only and secondary-only, with NO setup fee
        // or RRR pre-applied. calculateTransportMargin applies the (1-rrr) return
        // and the (1+SETUP_FEE) setup fee once to (buyCost + secondaryMatCost), so
        // folding the fee in here AND passing the secondary in both the buyCost
        // sum and the secondaryMatCost arg double-charged the secondary and the
        // fee. Mirror the main path: pass each gross cost exactly once. The heart
        // replaces one raw, so only the KEPT raws are priced as returnable mats.
        const rawGrossCost = fbRawUnitCost > 0
          ? fbHeart.rawKeptCount * fbRawUnitCost
          : 0;
        const secGrossCost = (routeItem.secondaryMatId && secFallbackPrice > 0)
          ? (routeItem.secondaryMatCount || 0) * secFallbackPrice
          : 0;
        // Slice of those gross costs that was never a market buy (transmute silver,
        // a self-refined secondary's station fees) — RRR-eligible, setup-fee-exempt.
        const fbSetupExempt = (fbRawSrc.unitFee || 0) * fbHeart.rawKeptCount
          + ((routeItem.secondaryMatId && secFallbackPrice > 0)
            ? (routeItem.secondaryMatCount || 0) * secFallbackFee : 0);
        // Displayed "Buy Cost" = gross material total (kept raw + secondary +
        // heart), matching the main path's totalRawCost field.
        const fallbackTotalRawCost = rawGrossCost + secGrossCost + fbHeart.heartCost;

        // Travel Planner fees for hauling raws/secondary/heart out of Brecilien
        // into the refine city rc (rc is never Brecilien, so the refined→sell leg
        // is free). Only the kept raws are hauled (the heart replaces one) plus
        // the heart's own leg.
        const fbInboundTravel = (typeof legBrecilienCost === "function")
          ? (fbTransmute ? 0 : legBrecilienCost(fallbackBuyCity, rc, routeItem.rawId, fbHeart.rawKeptCount)) +
            (routeItem.secondaryMatId
              ? legBrecilienCost(secFallbackCity, rc, routeItem.secondaryMatId, routeItem.secondaryMatCount || 0)
              : 0) +
            fbHeart.heartTravelTotal
          : 0;

        // Value the route only when raw, secondary (if any) and sell are all
        // priced. A missing raw/secondary slips past `fallbackTotalRawCost > 0`
        // (the other, priced input alone makes the sum positive) and would
        // invent a profit from a "free" mat — show n/a (margin -1) instead.
        const fullyPriced = isRefineRouteFullyPriced(
          fbRawUnitCost,
          !!routeItem.secondaryMatId,
          secFallbackPrice,
          secondaryChain,
          fallbackSellPrice,
        );
        const marginInfo = fullyPriced
          ? calculateTransportMargin(rawGrossCost, fallbackSellPrice, rrr, secGrossCost, stationFee, fbInboundTravel, fbHeart.heartCost, fbSetupExempt)
          : { margin: -1 };

        const oxLoad = calculateOxLoad(
          marginInfo.profit,
          getResourceWeightKg(tier) * routeItem.rawRatio,
        );
        const vol = getMinVol2(
          marketData,
          routeItem.rawId,
          fallbackBuyCity,
          routeItem.refinedId,
          fallbackSellCity,
        );

        // Silver/Focus: prefer the force-focus main evaluation (focusCol) — it
        // matches the main path exactly (heart/chain) and keeps the benchmark
        // identical across a main↔fallback path flip. When the force-focus pass
        // is also gated out (thin-volume rows → focusResult null), derive a
        // focus-on benchmark from the fallback's own volume-tolerant prices,
        // sourcing the secondary focus-on so the checkbox can't move it.
        // Focus-ON profit twins for the per-10k columns (see the main path):
        // a 10,000-focus bar is focus-on play, so its profit must not track the
        // checkbox either. Filled in both branches below.
        let fbProfitFocusOn;
        let fbRrrFocusOn;
        let fbGatheredFocusOn;
        let fbHeartFocusOn;
        let fbFocus;
        if (focusResult) {
          fbFocus = focusCol;
          const fp = computeRefineFocusProfit(focusResult, routeItem);
          fbProfitFocusOn = fp.profitFocusOn;
          fbRrrFocusOn = fp.rrrFocusOn;
          fbGatheredFocusOn = fp.gatheredProfitFocusOn;
          fbHeartFocusOn = { heartCost: fp.heartCostFocusOn, secHeart: fp.secHeartFocusOn };
        } else {
          const fbFocusRrr = getRefineRRR(rc, routeItem.resourceType, true);
          fbRrrFocusOn = fbFocusRrr;
          // Enchanted-rock rows yield 2^e blocks per refine but pay focus PER
          // BLOCK (items.xml craftingfocus is per output unit — see
          // computeRefineFocusColumn), so the per-1-output cost is the plain one.
          const fbFocusCost = getFocusCost(refinedId, tier, "refining");
          // The ladder is priced at base RRR whatever the checkbox says, and this
          // fallback spends its focus on the row's own refine (focusBestTier ===
          // tier), so the secondary needs no focus-on re-sourcing — it used to be
          // re-fetched here only because the chain moved with the toggle.
          const fbFocusSecPrice = secFallbackPrice;
          const fbFocusSecFee = secFallbackFee;
          const fbFocusSecChain = secondaryChain;
          const fbFocusSecCity = secFallbackCity;
          const fbFocusSecGross = (routeItem.secondaryMatId && fbFocusSecPrice > 0)
            ? (routeItem.secondaryMatCount || 0) * fbFocusSecPrice : 0;
          // The heart decision depends on RRR (a heart wins only below
          // rawUnitCost*(1-rrr)), so the focus-on benchmark needs its own heart pass
          // at the focus RRR — reusing the display-RRR rawGrossCost would price a
          // dropped raw without charging the heart (or vice versa).
          const fbFocusHeart = resolveRefineRawHeart(
            routeItem.resourceType, routeItem.rawRatio, fbRawUnitCost, fbFocusRrr, marketData, rc, routeItem.rawId,
            buyOpts,
          );
          const fbFocusRawGross = fbRawUnitCost > 0
            ? fbFocusHeart.rawKeptCount * fbRawUnitCost : 0;
          const fbFocusExempt = (fbRawSrc.unitFee || 0) * fbFocusHeart.rawKeptCount
            + (fbFocusSecGross > 0 ? (routeItem.secondaryMatCount || 0) * fbFocusSecFee : 0);
          // Marginal silver-per-focus (see marginalSilverPerFocus): RRR-eligible
          // base is the kept-raw gross + secondary gross; the heart is excluded.
          // Expressed as a focus PLAY so this path feeds the same Silver/Focus and
          // Best Focus columns as the main one (js/focus-play.js).
          const fbBaseRrr = getRefineRRR(rc, routeItem.resourceType, false);
          const fbPlay = fullyPriced
            ? makeFocusPlay({
                kind: "refine", matId: refinedId, focusItemId: refinedId, tier,
                focusCost: fbFocusCost,
                profitDelta: marginalSilverPerFocus(
                  fbFocusRawGross + fbFocusSecGross, fbBaseRrr, fbFocusRrr,
                  fbFocusCost, fbFocusExempt) * fbFocusCost,
              })
            : null;
          fbFocus = {
            focusCost: fbFocusCost,
            bestFocusPlay: fbPlay,
            profitPerFocus: fullyPriced ? focusPlayRate(fbPlay) : null,
            focusBestTier: tier,
            // Single refine, so a focus bar buys as many outputs as actions.
            refinesPerOutput: 1,
            outputsPer10kFocus: Math.floor(10000 / fbFocusCost),
            // Raw and secondary are both RRR-eligible (calculateTransportMargin
            // brackets them together), so the list discounts both.
            focusMatsList: [
              { matId: routeItem.rawId,
                units: matsNeededFor10kFocus(fbFocusCost, routeItem.rawRatio, true, fbFocusRrr) },
              ...(routeItem.secondaryMatId
                ? [{ matId: routeItem.secondaryMatId,
                     units: matsNeededFor10kFocus(
                       fbFocusCost, routeItem.secondaryMatCount || 0, true, fbFocusRrr) }]
                : []),
            ],
          };

          // The same route priced entirely focus-on: focus RRR, focus-on heart
          // decision and focus-on secondary. This is what a 10k-focus bar
          // actually buys on this row, so the per-10k columns ride on it.
          const fbFocusInboundTravel = (typeof legBrecilienCost === "function")
            ? (fbTransmute ? 0 : legBrecilienCost(fallbackBuyCity, rc, routeItem.rawId, fbFocusHeart.rawKeptCount)) +
              (routeItem.secondaryMatId
                ? legBrecilienCost(fbFocusSecCity, rc, routeItem.secondaryMatId, routeItem.secondaryMatCount || 0)
                : 0) +
              fbFocusHeart.heartTravelTotal
            : 0;
          fbHeartFocusOn = { heartCost: fbFocusHeart.heartCost || 0, secHeart: fbFocusHeart.secHeart || null };
          fbProfitFocusOn = fullyPriced
            ? calculateTransportMargin(
                fbFocusRawGross, fallbackSellPrice, fbFocusRrr, fbFocusSecGross,
                stationFee, fbFocusInboundTravel, fbFocusHeart.heartCost, fbFocusExempt,
              ).profit
            : null;
          fbGatheredFocusOn = computeRefineGatheredProfit(
            {
              refineCity: rc,
              rrr: fbFocusRrr,
              sellCity: fallbackSellCity,
              sellPrice: fallbackSellPrice,
              secPrice: fbFocusSecPrice,
              secCity: fbFocusSecChain ? null : fbFocusSecCity,
              secondaryChain: fbFocusSecChain,
            },
            routeItem,
          );
        }

        // Gathered profit rides on the fallback's own route fields. It needs no
        // raw price (the raws are self-gathered), so it still values on rows the
        // buy path has to show as no-data.
        const fbGathered = computeRefineGatheredProfit(
          {
            refineCity: rc,
            rrr,
            sellCity: fallbackSellCity,
            sellPrice: fallbackSellPrice,
            secPrice: secFallbackPrice,
            secCity: secondaryChain ? null : secFallbackCity,
            secondaryChain,
          },
          routeItem,
        );

        const fbBuyCity = fbTransmute ? fbTransmute.startCity : fallbackBuyCity;
        const fbBuyId = fbTransmute ? fbTransmute.startId : routeItem.rawId;
        return {
          route: routeItem,
          buyRaw: { city: fbBuyCity, price: fbTransmute ? fbTransmute.startPrice : fallbackBuyPrice },
          buyRawId: fbBuyId,
          rawTransmute: fbTransmute,
          refineCity: rc,
          sellRefined: { city: fallbackSellCity, price: fallbackSellPrice },
          secondaryMat: routeItem.secondaryMatId
            ? { id: routeItem.secondaryMatId, count: routeItem.secondaryMatCount, price: secFallbackPrice, city: secFallbackCity }
            : null,
          secondaryChain,
          // Heart substitution now also applies on the fallback path (thin-volume
          // rows), so a profitable heart isn't lost on high-enchant refines.
          secHeart: fbHeart.secHeart,
          // Per-unit raw acquisition cost + silver actually paid for the heart.
          // Consumed by the Faction Spending "profit / 10k focus (FP inputs)" column.
          rawUnitCost: fbRawUnitCost,
          heartCost: fbHeart.heartCost,
          totalRawCost: fallbackTotalRawCost,
          setupExemptCost: fbSetupExempt,
          // The self-found twin: the row's own gathered basis (raws at zero,
          // computeRefineGatheredProfit above) rides the same marginInfo the
          // Pure Profit cell reads — pureProfitTd (js/pure-profit-cell.js)
          // appends the dimmed line when it is finite.
          marginInfo: (fullyPriced && fbGathered != null)
            ? { ...marginInfo, selfFoundProfit: fbGathered }
            : marginInfo,
          dailyVol: vol,
          oxLoad: oxLoad,
          rrr: rrr,
          focusCost: fbFocus.focusCost,
          focusBestTier: fbFocus.focusBestTier,
          focusMatsList: fbFocus.focusMatsList,
          refinesPerOutput: fbFocus.refinesPerOutput,
          focusMats: fbFocus.focusMatsList.reduce((n, m) => n + m.units, 0),
          profitPerFocus: fbFocus.profitPerFocus,
          bestFocusPlay: fbFocus.bestFocusPlay,
          profitFocusOn: fbProfitFocusOn,
          rrrFocusOn: fbRrrFocusOn,
          heartCostFocusOn: fbHeartFocusOn ? (fbHeartFocusOn.heartCost || 0) : null,
          secHeartFocusOn: fbHeartFocusOn ? (fbHeartFocusOn.secHeart || null) : null,
          profitPer10kFocus: (fullyPriced && fbProfitFocusOn != null)
            ? calculateProfitPer10kFocus(fbProfitFocusOn, fbFocus.focusCost,
                fbFocus.refinesPerOutput)
            : null,
          gatheredProfit: fbGathered,
          gatheredProfitFocusOn: fbGatheredFocusOn != null ? fbGatheredFocusOn : fbGathered,
          profitGatheredPer10kFocus: (fbGatheredFocusOn != null ? fbGatheredFocusOn : fbGathered) != null
            ? calculateProfitPer10kFocus(
                fbGatheredFocusOn != null ? fbGatheredFocusOn : fbGathered,
                fbFocus.focusCost, fbFocus.refinesPerOutput)
            : null,
          hasOverride:
            getOverridePrice(fbBuyId, fbBuyCity) !== null ||
            getOverridePrice(routeItem.refinedId, fallbackSellCity) !== null ||
            (fbHeart.secHeart && getOverridePrice(fbHeart.secHeart.id, fbHeart.secHeart.city) !== null) ||
            (secondaryChain
              ? (typeof chainHasOverride === "function" && chainHasOverride(secondaryChain))
              : (routeItem.secondaryMatId
                  ? getOverridePrice(routeItem.secondaryMatId, secFallbackCity) !== null
                  : false)),
          section: rc === "Caerleon" ? "caerleon" : "royal",
        };
      }

      const {
        refineCity,
        bestRawCity,
        bestRawPrice,
        buyRawId,
        rawUnitCost,
        rawTransmute,
        totalRawCost,
        sellCity: bestSellCity,
        sellPrice: bestSellPrice,
        marginInfo: bestMarginInfo,
        rrr,
        secPrice,
        secCity,
        secHeart,
        secondaryChain,
      } = result;
      const tier = getTierFromId(routeItem.rawId);
      const oxLoad = calculateOxLoad(
        bestMarginInfo.profit,
        getResourceWeightKg(tier) * routeItem.rawRatio,
      );
      // Buy leg trades the raw, sell leg trades the REFINED good — read each
      // leg's own item at its own city (getMinVol2). Using rawId for both
      // legs read raw volume at the sell city, ignoring the refined good's
      // liquidity and any sell-city override stored under refinedId.
      const vol = getMinVol2(
        marketData,
        routeItem.rawId,
        bestRawCity,
        routeItem.refinedId,
        bestSellCity,
      );

      // Silver/Focus column: the focus-ON benchmark computed above
      // (computeRefineFocusColumn on focusResult), invariant to the toggle.
      const { focusCost, focusMatsList, refinesPerOutput, profitPerFocus,
        focusBestTier, bestFocusPlay } = focusCol;

      // Raw and sell are guaranteed priced here (computeRefineRouteForCity
      // returns null otherwise), so this only catches a recipe whose secondary
      // has no market price and no chain — its margin would treat the secondary
      // as free. Mark the route n/a (margin -1) instead of showing that profit.
      const fullyPriced = isRefineRouteFullyPriced(
        rawUnitCost,
        !!routeItem.secondaryMatId,
        secPrice,
        secondaryChain,
        bestSellPrice,
      );

      // Same route, raws self-gathered instead of bought. Independent of
      // `fullyPriced` — the raw's price is exactly the input this path doesn't
      // need (see computeRefineGatheredProfit).
      const gatheredProfit = computeRefineGatheredProfit(result, routeItem);

      // Profit / 10k Focus is a focus-ON benchmark exactly like Silver/Focus:
      // spending a whole 10,000-focus bar IS focus-on play, so the column must
      // not move with the checkbox. Pair the invariant focusCost with the
      // FOCUS-ON route's profit, never the checkbox route's — pairing an
      // invariant cost with a toggling profit was the reported bug.
      const focusProfits = computeRefineFocusProfit(focusResult, routeItem);
      const profitFocusOn = focusProfits.profitFocusOn;
      const gatheredProfitFocusOn = focusProfits.gatheredProfitFocusOn != null
        ? focusProfits.gatheredProfitFocusOn
        : gatheredProfit;

      return {
        route: routeItem,
        buyRaw: { city: bestRawCity, price: bestRawPrice },
        buyRawId,
        rawTransmute,
        refineCity,
        sellRefined: { city: bestSellCity, price: bestSellPrice },
        secondaryMat: routeItem.secondaryMatId
          ? {
              id: routeItem.secondaryMatId,
              count: routeItem.secondaryMatCount,
              price: secPrice,
              city: secCity,
            }
          : null,
        secondaryChain,
        secHeart,
        // Per-unit raw acquisition cost + silver actually paid for the heart.
        // Consumed by the Faction Spending "profit / 10k focus (FP inputs)" column.
        rawUnitCost,
        heartCost: result.heartCost || 0,
        totalRawCost,
        setupExemptCost: result.setupExemptCost || 0,
        // The self-found twin: the gathered basis computed above (the same
        // figure the Profit-Gathered column quotes) surfaced on marginInfo so
        // pureProfitTd appends the dimmed self-gathered line.
        marginInfo: fullyPriced
          ? (gatheredProfit != null
              ? { ...bestMarginInfo, selfFoundProfit: gatheredProfit }
              : bestMarginInfo)
          : { margin: -1 },
        dailyVol: vol,
        oxLoad,
        rrr,
        // The row's own refine at BASE rate. Equal to `rrr` whenever the focus
        // is off, and equal to it with focus ON too when the winning play sits
        // on a lower rung of the ladder — a returned bar is never re-refined,
        // so this refine's own material counts do not move. Read by callers
        // that have to cost the refines a finite focus budget cannot cover
        // (js/craft-list-focus-budget.js).
        baseRrr: getRefineRRR(refineCity, routeItem.resourceType, false),
        focusCost,
        // What the winning play adds to THIS row's headline profit, 0 when the
        // headline is not focused at all. profitPerFocus / profitFocusOn are
        // deliberately invariant benchmarks, so neither can answer that.
        focusProfitDelta: (fullyPriced && isFocusEnabled() && bestFocusPlay)
          ? bestFocusPlay.profitDelta : 0,
        focusBestTier,
        focusMatsList,
        refinesPerOutput,
        focusMats: focusMatsList.reduce((n, m) => n + m.units, 0),
        profitPerFocus: fullyPriced ? profitPerFocus : null,
        bestFocusPlay: fullyPriced ? bestFocusPlay : null,
        // Focus-ON twins of profit / rrr. Read by the per-10k columns here and
        // by the Faction Spending heart column (js/faction-focus-value.js), so
        // that figure is a focus-ON benchmark too.
        profitFocusOn,
        rrrFocusOn: focusProfits.rrrFocusOn,
        // Focus-on heart decision too — a heart wins only below
        // rawUnitCost*(1-rrr), so it can flip with the checkbox.
        heartCostFocusOn: focusProfits.heartCostFocusOn,
        secHeartFocusOn: focusProfits.secHeartFocusOn,
        profitPer10kFocus: (fullyPriced && profitFocusOn != null)
          ? calculateProfitPer10kFocus(profitFocusOn, focusCost, refinesPerOutput)
          : null,
        gatheredProfit,
        gatheredProfitFocusOn,
        profitGatheredPer10kFocus: gatheredProfitFocusOn != null
          ? calculateProfitPer10kFocus(gatheredProfitFocusOn, focusCost, refinesPerOutput)
          : null,
        hasOverride:
          getOverridePrice(buyRawId, bestRawCity) !== null ||
          getOverridePrice(routeItem.refinedId, bestSellCity) !== null ||
          (secHeart && getOverridePrice(secHeart.id, secHeart.city) !== null) ||
          (secondaryChain
            ? (typeof chainHasOverride === "function" && chainHasOverride(secondaryChain))
            : (routeItem.secondaryMatId
                ? getOverridePrice(routeItem.secondaryMatId, secCity) !== null
                : false)),
        section: refineCity === "Caerleon" ? "caerleon" : "royal",
      };
    };

    // With a City pick active the table prices every row at that city
    // (js/table-sell-city.js). A refine city that cannot reach it — royal vs
    // Caerleon with Black/Red Zone Routes off — has no honest row, so that
    // section is dropped instead of showing a sale (or a buy) it could not make.
    const sellPick = (typeof getTableSellCity === "function")
      ? getTableSellCity("transport-table") : null;
    const buyPick = (typeof getTableBuyCity === "function")
      ? getTableBuyCity("transport-table") : null;
    const reachable = candidates.filter((rc) => (!sellPick || !isInvalidCrossRoute(rc, sellPick))
      && (!buyPick || isValidSourceCity(buyPick, rc)));

    return reachable.flatMap((rc) => {
      // ONE row per candidate refine city: the route the player would actually
      // run. buildRow already sources the secondary at the cheaper of market vs
      // the refining chain, so this row IS the winner — it used to be paired with
      // a "direct refining" twin (same item, secondary forced to market) purely
      // so the two could be read side by side, which meant every chain route
      // occupied two rows and the reader had to score them. The `variant` tag
      // survives to badge WHICH way won, and stays in the row key.
      const row = buildRow(rc, false);
      if (row && row.secondaryChain) row.variant = "chain";
      return [row];
    });
  });

  renderTableData(
    "transport-table",
    rowData,
    (row, rowIdx) => {
      const {
        route,
        buyRaw,
        rawTransmute,
        refineCity,
        sellRefined,
        secondaryMat,
        secondaryChain,
        secHeart,
        totalRawCost,
        marginInfo,
        focusCost,
        focusBestTier,
        focusMatsList,
        profitPerFocus,
        bestFocusPlay,
        profitPer10kFocus,
        profitFocusOn,
        gatheredProfitFocusOn,
        profitGatheredPer10kFocus,
      } = row;
      const rowKey = getRowKey(row, "transport-table");
      // Route can't be valued (a raw/secondary/sell price is missing): show the
      // computed columns as n/a so the profit matches its "no data" inputs. The
      // material spans below still render so the user can click to set prices.
      const noData = marginInfo.margin === -1;
      const noDataCell = '<td class="silver-val" style="color:#6b7280;font-style:italic">—</td>';
      const craftsWithFocus = focusCost ? (typeof focusBarCrafts === "function" ? focusBarCrafts(focusCost) : Math.floor(10000 / focusCost)) : 0;
      const tier = getTierFromId(route.rawId);
      // A focus bar buys `craftsWithFocus` refine ACTIONS. When the focus sits on
      // a rung below the item this row sells, one sold output costs less than one
      // of those actions, so the bar yields more outputs than refines — and the
      // per-10k profit (per output) multiplies by the outputs. Say so in the tip
      // rather than printing an equation that does not multiply out.
      const outputsWithFocus = (row.refinesPerOutput && row.refinesPerOutput !== 1)
        ? craftsWithFocus / row.refinesPerOutput : craftsWithFocus;
      const subTierNote = (outputsWithFocus !== craftsWithFocus)
        ? " " + tx("Focus sits on the T{tier} step of the ladder, so the bar yields {outputs} finished units.",
            "r_p10k_sub_tier_note")
            .replace("{tier}", String(focusBestTier))
            .replace("{outputs}", Math.round(outputsWithFocus).toLocaleString())
        : "";
      const focusTierLabel = (focusBestTier && focusBestTier !== tier)
        ? ` <small style="color:#fbbf24">[Focus@T${focusBestTier}]</small>`
        : "";
      // One line per thing the play actually BUYS. A chain row lists the ladder's
      // market leaves, not its self-refined intermediates — telling the user to
      // buy a bar the route above refines was the old cell's contradiction.
      const focusMatsHtml = (focusCost && focusMatsList && focusMatsList.length)
        ? focusMatsList
            .map((m) => `${m.units.toLocaleString()}x ${getItemDisplayName(m.matId)}`)
            .join("<br>") +
          `<br><small style="color:#9ca3af" title="${typeof focusSpecTitle === "function" ? focusSpecTitle(route.refinedId) : ""}">${(typeof formatBarCrafts === "function" ? formatBarCrafts(craftsWithFocus) : craftsWithFocus.toLocaleString())}x ${tx("refines", "r_refines")} @ ${formatFocusCost(focusCost)}${typeof focusSpecMark === "function" ? focusSpecMark(route.refinedId) : ""} ${tx("focus ea", "r_focus_ea")}</small>`
        : "—";
      const profitPerFocusClass = profitPerFocus > 0 ? "profit-low" : "profit-negative";

      // Profit for a whole 10k focus bar spent on this refine. Only meaningful
      // when the row has a focus cost (every refine does) and a valued route.
      // Quotes the FOCUS-ON profit, which is what the figure multiplies — the
      // Pure Profit column tracks the checkbox and can differ.
      const p10kClass = profitPer10kFocus > 0 ? "profit-low" : "profit-negative";
      const p10kCell = (noData || !focusCost || profitPer10kFocus == null)
        ? noDataCell
        : `<td class="silver-val ${p10kClass}" title="${tx("{profit} profit/refine (after mat costs) × {refines} refines ({focus} focus ea)", "r_p10k_refine_tip").replace("{profit}", formatSilver(profitFocusOn)).replace("{refines}", (typeof formatBarCrafts === "function" ? formatBarCrafts(craftsWithFocus) : craftsWithFocus.toLocaleString())).replace("{focus}", formatFocusCost(focusCost))}${subTierNote}">${formatSilver(profitPer10kFocus)}</td>`;

      // Same bar of focus, but the raws are gathered rather than bought — the
      // sale (minus the secondary, station/setup fees and tax) is all profit.
      // Deliberately NOT gated on `noData`: an unpriced raw is the one input
      // this column doesn't need, so it still shows a number there.
      const pg10kClass = profitGatheredPer10kFocus > 0 ? "profit-low" : "profit-negative";
      const pg10kCell = (!focusCost || profitGatheredPer10kFocus == null)
        ? noDataCell
        : `<td class="silver-val ${pg10kClass}" title="${tx("Raws self-gathered (cost 0, here and down the chain): {profit} profit/refine × {refines} refines ({focus} focus ea). Bought bars, fees and tax still charged.", "r_pg10k_refine_tip").replace("{profit}", formatSilver(gatheredProfitFocusOn)).replace("{refines}", (typeof formatBarCrafts === "function" ? formatBarCrafts(craftsWithFocus) : craftsWithFocus.toLocaleString())).replace("{focus}", formatFocusCost(focusCost))}${subTierNote}">${formatSilver(profitGatheredPer10kFocus)}</td>`;

      // Badge naming how the row got its secondary. Only the winning route is
      // rendered, so this says which one won: chain-refined from lower tiers, or
      // (no badge) bought ready-made at market.
      const variantLabel =
        row.variant === "chain"
          ? ` <small style="color:#fbbf24;font-weight:600" title="${tx("Chain refining: the secondary material is refined from lower tiers yourself — cheaper here than buying it ready-made.", "r_tip_chain_refining")}">⛓ ${tx("chain", "r_chain")}</small>`
          : "";

      // Enchanted-rock rows refine enchanted raw rock (.1–.3) into the SAME plain
      // block — one refine yields 2^e blocks, so per-block it needs fewer (but
      // pricier) rocks. Badge distinguishes them from the plain-rock row.
      const enchRawLabel = route.enchantedRaw
        ? ` <small style="color:#a78bfa;font-weight:600" title="${tx("Refined from enchanted raw rock (.{ench}): one refine takes {mult}× lower blocks for {mult}× plain blocks and {mult}× focus. No enchanted block exists.", "r_tip_enchanted_rock").replace("{ench}", route.enchantedRaw).split("{mult}").join(route.outputPerRefine)}">⟲ .${route.enchantedRaw} ${tx("rock", "r_rock_lower")}</small>`
        : "";
      // Raw counts on enchanted-rock rows are fractional (rawRatio / 2^e per output
      // block), so render them trimmed rather than as a bare integer.
      const fmtRawCount = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

      // Required Materials cell: when secondaryChain is present, render the
      // recursive breakdown. Reuses renderChainBreakdown from
      // render-chain-breakdown.js (shared chain HTML helper).
      // A faction heart replaces ONE raw unit, so show (rawRatio-1) bought raws
      // plus the heart inline on the raw line; the heart names the raw it stands
      // in for. When a transmute route beats the raw's market price the raw line
      // reads "(via transmute)" and expands into the bought start + each upgrade
      // step. The refined secondary renders normally (market / via-chain).
      const rawShown = secHeart ? Math.max(0, route.rawRatio - 1) : route.rawRatio;
      let rawLine;
      if (rawTransmute) {
        rawLine = `${fmtRawCount(rawShown)}x ${getItemDisplayName(route.rawId)} `
          + `<small style="color:#fbbf24" title="${tx("Cheaper to buy {item} and transmute it up than to buy this raw ({price} vs market). It refines like any raw.", "r_tip_via_transmute").replace("{item}", getItemDisplayName(rawTransmute.startId)).replace("{price}", formatSilver(rawTransmute.perUnit))}">${tx("(via transmute)", "r_via_transmute")}</small>`;
        if (secHeart) rawLine += heartSubstituteLine(secHeart, getItemDisplayName(route.rawId));
        rawLine += transmuteSubstituteLines(rawTransmute, fmtRawCount(rawShown));
      } else {
        rawLine = `${fmtRawCount(rawShown)}x ${getItemDisplayName(route.rawId)} ${matPriceSpan(route.rawId, buyRaw.city, buyRaw.price)} <small style="color:#9ca3af">(${tx("at", "r_at")} ${buyRaw.city})</small>`;
        if (secHeart) rawLine += heartSubstituteLine(secHeart, getItemDisplayName(route.rawId));
      }
      let secondaryHtml = "";
      if (secondaryMat) {
        if (secondaryChain && typeof renderChainBreakdown === "function") {
          secondaryHtml = `<br>+ ${secondaryMat.count}x ${getItemDisplayName(secondaryMat.id)} <small style="color:#fbbf24" title="${tx("Cheaper to refine than buy", "r_tip_cheaper_to_refine")}">${tx("(via chain)", "r_via_chain")}</small>`
            + renderChainBreakdown(secondaryChain, secondaryMat.count);
        } else {
          secondaryHtml = `<br>+ ${secondaryMat.count}x ${getItemDisplayName(secondaryMat.id)} ${matPriceSpan(secondaryMat.id, secondaryMat.city, secondaryMat.price)} <small style="color:#9ca3af">(${tx("at", "r_at")} ${secondaryMat.city})</small>`;
        }
      }

      return `
      <tr data-row-key="${rowKey}">
          ${addTdForKey("transport-table", rowKey)}
          <td class="cell-item">${getItemDisplayName(route.refinedId)}${variantLabel}${enchRawLabel}${resourceAliasSpan(route.refinedId)}${resourceAliasSpan(route.rawId)}</td>
          ${routeCityCell([
            // buyRawId, not route.rawId: when the raw is transmuted up, the city
            // in this cell is where the START node is bought, so that is the
            // price the click has to open.
            { label: "Buy", city: buyRaw.city, itemId: row.buyRawId || route.rawId, side: "buy", price: buyRaw.price },
            { label: "Refine", city: refineCity },
            { label: "Sell", city: sellRefined.city, itemId: route.refinedId, side: "sell", price: sellRefined.price },
          ])}
          <td class="cell-mats">${rawLine}${secondaryHtml}</td>
          ${aggregateCostTd(totalRawCost)}
          ${priceTd(sellRefined.price, route.refinedId || route.rawId + "_refined", sellRefined.city)}
          ${noData ? noDataCell : profitTd(marginInfo, "transport-table", rowIdx, sellRefined.city)}
          ${noData ? noDataCell : pureProfitTd(marginInfo)}          ${p10kCell}
          ${pg10kCell}
          <td class="cell-focus-mats">${focusMatsHtml}${focusTierLabel}</td>
          ${noData ? noDataCell : `<td class="silver-val ${profitPerFocusClass}">${profitPerFocus ? profitPerFocus.toFixed(1) : "—"}</td>`}
          <td class="cell-note">${noData ? "—" : focusPlayCell(bestFocusPlay, { unit: "/refine" })}</td>
      </tr>
  `;
    },
  );
}
