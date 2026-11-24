/**
 * Transmute Profitability Table Renderer
 *
 * Shows profit margins for transmute upgrades — buy a source item, pay the
 * silver transmute fee(s), sell the upgraded result:
 *   - Materials: Rune→Soul→Relic→Avalonian Shard (same tier, type upgrade).
 *   - Resources: single-step tier-up & enchant-up of Wood/Ore/Fiber/Hide/Stone.
 *   - Chains: multi-step resource paths (7.1 → 7.2 → 7.3 → 7.4, T4 → … → T8),
 *     showing the single most profitable start per end product.
 *
 * Transitions, ids, fees and colors come from data-transmute.js
 * (getTransmuteRecipes + getResourceTransmuteChains). A chain prices exactly
 * like a single step — buy the start, pay the summed fees, sell the end — so
 * priceTransmuteRoute() handles both.
 */

// Cheapest all-in cost to OBTAIN one unit of each resource node in this section,
// either by buying it at market (best volume-gated buy city) or by transmuting up
// from a cheaper-acquired lower node. The renderer uses `produced` to keep the
// table honest: a row whose start is cheaper to make than to buy (e.g. an
// expensive 8.3 you'd really reach by buying a cheap 8.1 and transmuting up) is
// HIDDEN, so every shown row is a genuine market buy → sell and the equivalent
// route surfaces as the longer chain from the bought base.
// cost = bought ? price*(1+SETUP_FEE) : acquire(pred)+stepFee+stationFee. Solved
// topologically (tier↑ then enchant↑) so both predecessors are already resolved.
// Returns { [nodeId]: { cost, city, produced, viaId, marketPrice } }; absent when
// the node is neither buyable nor producible in this section.
function computeTransmuteAcquireCosts(marketData, buyCities, MIN_VOLUME) {
  const acq = {};

  const bestMarketBuy = (id) => {
    const bounds = getIQRBounds(marketData[id]);
    let price = Infinity, city = null;
    buyCities.forEach((c) => {
      const p = getBuyPrice(marketData[id], c, bounds, id);
      const v = marketData[id]?.[c]?.volume_24h || 0;
      if (p > 0 && (v >= MIN_VOLUME || getOverridePrice(id, c) !== null) && p < price) {
        price = p; city = c;
      }
    });
    return city ? { price, city } : null;
  };

  [...TRANSMUTE_RESOURCE_FAMILIES, "ROCK"].forEach((family) => {
    const maxEnch = family === "ROCK" ? 0 : 4;
    for (let t = 4; t <= 8; t++) {
      for (let e = 0; e <= maxEnch; e++) {
        const id = transmuteResourceId(family, t, e);

        let best = Infinity, city = null, produced = false, viaId = null, marketPrice = null;
        const mb = bestMarketBuy(id);                       // option A: buy at market
        if (mb) { best = mb.price * (1 + SETUP_FEE); city = mb.city; marketPrice = mb.price; }

        const relax = (predId, fee) => {                    // options B/C: transmute up
          const pred = acq[predId];
          if (!pred || fee == null) return;
          // The step also pays the crafting-station usage fee priceTransmuteRoute
          // charges on the very same transition — without it, producing always
          // looked cheaper than it is and the produce-vs-buy verdict (which hides
          // rows) ran on an understated cost. Same helper, so the two can't drift.
          const station = transmuteRouteStationFee({
            kind: "resource", tier: t, sourceId: predId, targetId: id, silverCost: fee,
          });
          const cost = pred.cost + fee + station;
          if (cost < best) {
            best = cost; city = pred.city; produced = true; viaId = predId; marketPrice = null;
          }
        };
        if (t > 4) relax(transmuteResourceId(family, t - 1, e),
          family === "ROCK" ? TRANSMUTE_STONE_TIERUP_COST[t] : TRANSMUTE_TIERUP_COST[t]?.[e]);
        if (e > 0) relax(transmuteResourceId(family, t, e - 1), TRANSMUTE_ENCHANTUP_COST[t]?.[e]);

        if (best < Infinity) acq[id] = { cost: best, city, produced, viaId, marketPrice };
      }
    }
  });

  return acq;
}

// Throughput of one route: the thinner of the two ACTUALLY traded legs — buying
// the source at buyCity, selling the target at sellCity. A 5:1 material tier-up
// burns 5 source units per sale, so its buy leg only supports vol/5 transmutes a
// day. getMinVol2 with the same id/city on both legs reads a single leg's volume
// (min(v, v)) while keeping its volume-override handling.
function transmuteRouteVol(marketData, recipe, buyCity, sellCity) {
  const { sourceId, targetId } = recipe;
  const count = recipe.sourceCount || 1;
  if (count === 1) return getMinVol2(marketData, sourceId, buyCity, targetId, sellCity);
  const srcVol = getMinVol2(marketData, sourceId, buyCity, sourceId, buyCity);
  const tgtVol = getMinVol2(marketData, targetId, sellCity, targetId, sellCity);
  return Math.min(Math.floor(srcVol / count), tgtVol);
}

// Live Global Discount on a gross silver figure, no-op where the module isn't
// loaded (Node test sandboxes compile this renderer on its own).
function _transmuteDiscounted(silver) {
  return typeof applyGlobalDiscount === "function" ? applyGlobalDiscount(silver) : silver;
}

// The self-found pure-profit twin (js/self-found-profit.js); Node sandboxes that compile this renderer alone use the same live-getter formula.
const _transmuteSelfFoundTwin = (sellPrice, keptSilver) => typeof selfFoundProfit === "function" ? selfFoundProfit(sellPrice, keptSilver) : sellPrice * (1 - PREMIUM_TAX) - keptSilver;

// Price one route (obtain start → pay silverCost → sell end) within a section.
// `acq` is the produce-or-buy acquire map; resources value their start through it
// (min of buy vs produce), materials (no acquire entry) use a straight market buy.
// Returns the priced fields, or null when no buy/sell city is available.
// `MIN_VOLUME` gates the start's market buy, `MIN_SELL_VOLUME` the end item's
// sale — the two Pricing Model toggles move independently. It defaults to
// MIN_VOLUME so a caller passing one number keeps the old linked behaviour.
function priceTransmuteRoute(recipe, buyCities, sellCities, MIN_VOLUME, marketData, acq, MIN_SELL_VOLUME = MIN_VOLUME) {
  const { sourceId, targetId } = recipe;
  // The recipe carries GROSS silver — transmuteRouteStationFee derives its
  // nutrition from that same figure, so the Global Discount can only be applied
  // here, on the way into the row's cost.
  const silverCost = _transmuteDiscounted(recipe.silverCost);
  // How many source units one target costs — 1 for every 1:1 row, 5 for the
  // material tier-ups (5× T4 Relic → 1× T5 Relic).
  const sourceCount = recipe.sourceCount || 1;
  const targetBounds = getIQRBounds(marketData[targetId]);

  // Crafting-station usage fee on top of the fixed transmute silver, priced off
  // the same #station-fee field as crafting/refining. Resource steps read the
  // measured per-step grid (chains sum their steps); see transmuteRouteStationFee.
  const stationFee = transmuteRouteStationFee(recipe);

  // Start material cost. sourceCost is all-in (includes setup on any market buy).
  let sourceCost, buyCity, buyPrice, sourceProduced;
  // A pinned buy city (price edit on the source cell → setCityForce) outranks the
  // produce-or-buy acquire map: the user said "I buy the start HERE", so the row
  // must price as a market buy at that city instead of reverting to the cheapest
  // city — or vanishing because acq found the start cheaper to produce. The pin
  // only wins when that city actually has a price; otherwise acq/best-scan runs
  // as before so an unpriceable pin can't erase the row.
  const sourceBounds = getIQRBounds(marketData[sourceId]);
  const forcedBuyCity = getCityForce(sourceId, "buy");
  const forcedBuyPrice = forcedBuyCity && buyCities.includes(forcedBuyCity)
    ? getBuyPrice(marketData[sourceId], forcedBuyCity, sourceBounds, sourceId)
    : 0;
  const a = forcedBuyPrice > 0 ? null : (acq && acq[sourceId]);
  if (a) {
    sourceCost = a.cost;
    buyCity = a.city;
    sourceProduced = a.produced;
    buyPrice = a.produced ? a.cost : a.marketPrice;   // bought rows show market price; produced rows (a.cost) get filtered out before render
  } else {
    let bestBuyCity = null, bestBuyPrice = Infinity;
    if (forcedBuyPrice > 0) {
      bestBuyCity = forcedBuyCity; bestBuyPrice = forcedBuyPrice;
    } else {
      buyCities.forEach((city) => {
        const p = getBuyPrice(marketData[sourceId], city, sourceBounds, sourceId);
        const v = marketData[sourceId]?.[city]?.volume_24h || 0;
        if (p > 0 && (v >= MIN_VOLUME || getOverridePrice(sourceId, city) !== null) && p < bestBuyPrice) {
          bestBuyPrice = p; bestBuyCity = city;
        }
      });
    }
    if (!bestBuyCity) return null;
    sourceCost = bestBuyPrice * (1 + SETUP_FEE);
    buyCity = bestBuyCity; buyPrice = bestBuyPrice; sourceProduced = false;
  }
  if (buyCity == null || sourceCost == null) return null;

  // Best sell city for the end item.
  let bestSellCity = null;
  let bestSellPrice = 0;
  let maxMargin = -Infinity;
  const forcedSellCity = getCityForce(targetId, "sell");
  const effectiveSellCities =
    forcedSellCity && sellCities.includes(forcedSellCity) ? [forcedSellCity] : sellCities;
  effectiveSellCities.forEach((sc) => {
    if (isInvalidCrossRoute(buyCity, sc)) return;
    const p = getSellPrice(marketData[targetId], sc, targetBounds, targetId);
    const v = marketData[targetId]?.[sc]?.volume_24h || 0;
    if (p > 0 && (v >= MIN_SELL_VOLUME || getOverridePrice(targetId, sc) !== null)) {
      const inputCost = sourceCost * sourceCount + silverCost + stationFee;
      const revenue = p * (1 - PREMIUM_TAX);
      const margin = inputCost > 0 ? ((revenue - inputCost) / inputCost) * 100 : -999;
      if (margin > maxMargin) {
        maxMargin = margin;
        bestSellCity = sc;
        bestSellPrice = p;
      }
    }
  });
  if (!bestSellCity) return null;

  const totalInputCost = sourceCost * sourceCount + silverCost + stationFee;
  const revenue = bestSellPrice * (1 - PREMIUM_TAX);
  const profit = revenue - totalInputCost;
  const margin = totalInputCost > 0 ? (profit / totalInputCost) * 100 : -999;

  return {
    buyCity,
    buyPrice,
    sourceProduced,
    sellCity: bestSellCity,
    sellPrice: bestSellPrice,
    stationFee,
    totalInputCost,
    revenue,
    profit,
    margin,
    // Self-found twin (plan.md): the input resource is gatherable — zeroed with its
    // buy-order setup fee; the transmute silver and the station fee stay.
    selfFoundProfit: _transmuteSelfFoundTwin(bestSellPrice, silverCost + stationFee),
    dailyVol: transmuteRouteVol(marketData, recipe, buyCity, bestSellCity),
    hasOverride:
      (!sourceProduced && getOverridePrice(sourceId, buyCity) !== null) ||
      getOverridePrice(targetId, bestSellCity) !== null,
  };
}

// Tier/enchant of what a route PRODUCES, read off its target id. Recipes carry
// `tier` = the SOURCE tier, so a "T4 → T6" chain would otherwise read as a T4
// row; the Tier column and the tier/enchant pickers both use this instead.
function transmuteTargetTierEnch(targetId) {
  const id = typeof targetId === "string" ? targetId : "";
  const tm = id.match(/^T([1-8])_/);
  const em = id.match(/@([0-4])(?:\D|$)/);
  return { tier: tm ? parseInt(tm[1], 10) : null, ench: em ? parseInt(em[1], 10) : 0 };
}

// Assemble a table row from a recipe/chain descriptor + its priced result.
function buildTransmuteRow(recipe, priced, sectionName) {
  const target = transmuteTargetTierEnch(recipe.targetId);
  return {
    tier: recipe.tier,
    targetTier: target.tier != null ? target.tier : recipe.tier,
    targetEnch: target.ench,
    transition: recipe.transition,
    color: recipe.color,
    sourceId: recipe.sourceId,
    targetId: recipe.targetId,
    sourceCount: recipe.sourceCount || 1,
    silverCost: _transmuteDiscounted(recipe.silverCost),
    stationFee: priced.stationFee,
    buyCity: priced.buyCity,
    buyPrice: priced.buyPrice,
    sourceProduced: priced.sourceProduced,
    sellCity: priced.sellCity,
    sellPrice: priced.sellPrice,
    totalInputCost: priced.totalInputCost,
    revenue: priced.revenue,
    marginInfo: { profit: priced.profit, margin: priced.margin, selfFoundProfit: priced.selfFoundProfit },
    // Over-cap margins read as bad market data: kept + flagged (hidden unless
    // Show All) instead of dropped, so the price stays editable.
    suspectMargin: isSuspectMargin(priced.margin),
    dailyVol: priced.dailyVol,
    section: sectionName,
    hasOverride: priced.hasOverride,
  };
}

// "Show All" is a curation switch here, not only a data-presence one: chain
// groups are collapsed to their single best start at BUILD time, so the losing
// starts (4 → … → 8 next to 6 → 7 → 8) can never come back through the
// sorting.js display filter. With the box checked every priced, market-bought
// candidate is emitted instead. Guarded for the Node tests, which have no DOM.
function isTransmuteShowAllEnabled() {
  return typeof document !== "undefined" &&
    !!document.getElementById("show-all-items")?.checked;
}

function renderTransmuteTable(marketData) {
  const MIN_VOLUME = getOrderType("buy") === "market" ? 25 : 0;
  const MIN_SELL_VOLUME = getOrderType("sell") === "market" ? 25 : 0;
  const showAll = isTransmuteShowAllEnabled();

  const sections = isBlackRedZoneEnabled()
    ? [{ name: undefined, buyCities: CITIES, sellCities: SELL_CITIES }]
    : [
        { name: "royal", buyCities: ROYAL_CITIES, sellCities: ROYAL_CITIES },
        {
          name: "caerleon",
          buyCities: ["Caerleon"],
          sellCities: ["Caerleon", "Black Market"],
        },
      ];

  const recipes = getTransmuteRecipes();

  // Group multi-step chains by (axis | end product). Within each group the
  // renderer shows only the single most profitable start ("best chain per
  // product"); single-step rows above still cover the 1-step opportunities.
  const chainGroups = new Map();
  getResourceTransmuteChains().forEach((c) => {
    if (!chainGroups.has(c.groupKey)) chainGroups.set(c.groupKey, []);
    chainGroups.get(c.groupKey).push(c);
  });

  const rows = [];

  sections.forEach(({ name: sectionName, buyCities, sellCities }) => {
    // Produce-or-buy acquisition cost per resource node in this section's market.
    const acq = computeTransmuteAcquireCosts(marketData, buyCities, MIN_VOLUME);

    // Single-step material + resource upgrades — one row each. Skip any whose
    // start is cheaper to PRODUCE than to buy (sourceProduced): that opportunity
    // is a real buy → sell only as the longer chain from the bought base, which
    // renders on its own — so every shown row starts with a genuine market buy.
    recipes.forEach((recipe) => {
      const priced = priceTransmuteRoute(recipe, buyCities, sellCities, MIN_VOLUME, marketData, acq, MIN_SELL_VOLUME);
      if (!priced) {
        rows.push({ marginInfo: { margin: -999 }, section: sectionName });
        return;
      }
      if (priced.sourceProduced) return;          // buy → sell only: no produced-intermediate starts
      rows.push(buildTransmuteRow(recipe, priced, sectionName));
    });

    // Multi-step chains — best BOUGHT start per (axis, end product). Candidates
    // whose start is cheaper to produce than to buy are skipped (their bought
    // equivalent is a longer chain here or a row in another group), so every chain
    // row also reads buy → sell.
    // Under "Show All" the group is NOT collapsed — every bought start renders,
    // so a product's cheaper-but-worse routes are inspectable too.
    chainGroups.forEach((candidates) => {
      const viable = [];
      candidates.forEach((chain) => {
        const priced = priceTransmuteRoute(chain, buyCities, sellCities, MIN_VOLUME, marketData, acq, MIN_SELL_VOLUME);
        if (priced && !priced.sourceProduced) viable.push({ chain, priced });
      });
      if (!viable.length) {
        rows.push({ marginInfo: { margin: -999 }, section: sectionName });
        return;
      }
      // Rank by margin, but an over-cap (bad-data) candidate never beats a sane
      // one — otherwise it would win the group and then be hidden as flagged,
      // taking the product's only visible route with it.
      const rank = ({ priced }) => (isSuspectMargin(priced.margin) ? -Infinity : priced.margin);
      const keep = showAll
        ? viable
        : [viable.reduce((a, b) => (rank(b) > rank(a) ? b : a))];
      keep.forEach(({ chain, priced }) => rows.push(buildTransmuteRow(chain, priced, sectionName)));
    });
  });

  renderTableData("transmute-table", rows, (row, rowIdx) => {
    if (!row.transition || row.marginInfo.margin === -999) return "";
    const rowKey = getRowKey(row, "transmute-table");

    const transColor = row.color || "#c4a07a";
    const sourceName = getItemDisplayName(row.sourceId);

    // Every rendered row is a real market buy → sell: rows whose start is cheaper
    // to PRODUCE than to buy are filtered out in renderTransmuteTable, so the
    // source is always an editable, click-to-override market buy at buyCity.
    // The price stays PER UNIT (that's what the market shows and what an override
    // edits); the ratio prefix is what tells a 5:1 tier-up from a 1:1 row.
    const countPrefix = row.sourceCount > 1 ? `${row.sourceCount}× ` : "";
    const sourceCell = `${countPrefix}${sourceName}${resourceAliasSpan(row.sourceId)} ${matPriceSpan(row.sourceId, row.buyCity, row.buyPrice)} <small style="color:#9ca3af">(${row.buyCity})</small>`;

    // data-filter-tier/-ench pin the Tier/Ench. pickers to the END product (see
    // transmuteTargetTierEnch) — selecting T6 must surface "4 → 5 → 6" chains.
    const tgtTier = row.targetTier != null ? row.targetTier : row.tier;
    const tgtEnch = row.targetEnch || 0;
    return `
    <tr data-row-key="${rowKey}" data-filter-tier="${tgtTier}" data-filter-ench="${tgtEnch}">
      ${addTdForKey("transmute-table", rowKey)}
      <td>T${tgtTier}${tgtEnch ? "." + tgtEnch : ""}</td>
      <td class="cell-text" style="color:${transColor}">${suspectMarginBadge(row)}${row.transition.label}</td>
      <td class="cell-text">${sourceCell}</td>
      <td class="silver-val" title="${tx("Fixed transmute silver + crafting-station usage fee (from the Station Fee field)", "r_tip_transmute_fee")}">${formatSilver(row.silverCost + (row.stationFee || 0))}</td>
      ${aggregateCostTd(row.totalInputCost)}
      ${priceTd(row.sellPrice, row.targetId, row.sellCity, "sell", "silver-val", true)}
      ${profitTd(row.marginInfo, "transmute-table", rowIdx, row.sellCity)}
      ${pureProfitTd(row.marginInfo)}    </tr>`;
  });
}
