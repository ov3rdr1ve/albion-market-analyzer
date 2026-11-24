// Mounts table — the CRAFT row renderer (saddled mounts built from a recipe).
//
// Split out of js/render-mounts.js to keep both files inside the 800-line cap,
// mirroring js/render-mounts-breeding-row.js. Everything it calls (priceTd,
// matPriceSpan, profitTd, focusPlayCell, …) is the same shared global as before
// the split.
//
// The `row.noData` branch is the reason this file is worth reading: a mount
// whose materials have no listing anywhere still renders, with every material
// span and the sell cell click-to-edit. It used to vanish entirely — the
// placeholder carried no `item`, and the formatter dropped those — so an
// unpriced mount was unreachable, and the price that would have fixed it could
// never be typed in.

/**
 * The row a mount craft collapses to when a material has no listing anywhere the
 * craft city can reach.
 *
 * It is a real row, not a sentinel: it carries `item`, the materials at whatever
 * they DID price at, and a sell city — so renderMountCraftRow can draw every one
 * of those as a click-to-edit cell. The sale is offered where the rest of the
 * filtered table sells, when that city is reachable from here (the same
 * resolution render-crafting.js's no-data row uses).
 */
function buildMountNoDataRow(mount, craftCity, matBestPrices, rrr, marketData, mountBounds) {
  // An active City pick names these cells' cities first: the row is unpriced AT
  // the pick, and the editor should open where the rest of the table trades.
  const sellPick = typeof mountsPick === "function" ? mountsPick("sell") : null;
  const buyPick = typeof mountsPick === "function" ? mountsPick("buy") : null;
  const forced = typeof getCityForce === "function" ? getCityForce(mount.id, "sell") : null;
  const sellCity = sellPick && !isInvalidCrossRoute(craftCity, sellPick) ? sellPick
    : (forced && !isInvalidCrossRoute(craftCity, forced) ? forced : craftCity);
  // The blocker priced nowhere, so its city is null — and a null city reaches
  // matPriceSpan as `data-city=""`, opening the editor with no city to default
  // to. Fall back to the buy pick, else the craft city, the way
  // render-crafting.js's no-data row does: it is where you would be standing
  // when you buy the thing.
  const mats = {};
  Object.entries(matBestPrices).forEach(([matId, m]) => {
    mats[matId] = m && m.city ? m : { price: (m && m.price) || 0, city: buyPick || craftCity };
  });
  return {
    item: mount, isBreeding: false, isCraft: true, noData: true,
    recipe: mount.materials, matBestPrices: mats, craftCity,
    buyMat: { city: craftCity, price: 0 },
    sellPot: {
      city: sellCity,
      price: getSellPrice(marketData[mount.id], sellCity, mountBounds, mount.id),
    },
    totalInputCost: 0,
    marginInfo: { margin: -1, profit: 0 },
    brecilienFee: 0,
    dailyVol: 0,
    rrr,
    focusCost: 0,
    hasOverride: false,
  };
}

function renderMountCraftRow(row, rowIdx, rowKey) {
  // Mount craft row
  const matsHtml = row.recipe.map((m) => {
    const name = getItemDisplayName(m.matId) || m.matId;
    const { price, city } = row.matBestPrices[m.matId] || { price: 0, city: "?" };
    const eligible = isRrrEligible(m.matId);
    const effectiveCount = eligible ? (m.count * (1 - row.rrr)).toFixed(1) : m.count.toString();
    const consumedTag = eligible
      ? ` <small style="color:#9ca3af">(~${effectiveCount}x consumed)</small>`
      : ` <small style="color:#9ca3af">(no return)</small>`;
    const fromTag = city ? ` <small style="color:#9ca3af">(${tx("from", "r_from_lower")} ${city})</small>` : "";
    return `${m.count}x ${name} ${matPriceSpan(m.matId, city, price)}${fromTag}${consumedTag}`;
  }).join("<br>");

  // Nothing prices yet: keep every material span and the sell cell editable so
  // the user can fill the hole, and dim only what a price would have computed.
  if (row.noData) {
    const dim = '<td style="color:#6b7280;font-style:italic">—</td>';
    return `
  <tr data-row-key="${rowKey}">
    ${addTdForKey("mounts-table", rowKey)}
    <td class="cell-item">${dispName(row.item.id, row.item.name)} <small style="color:#9ca3af">${tx("(Craft)", "r_craft_paren")}</small></td>
    <td class="cell-route" style="color:#6b7280;font-style:italic">${tx("Craft", "r_craft")}: ${row.craftCity} — ${tx("no market data", "r_no_market_data")}</td>
    <td class="cell-mats">${matsHtml}</td>
    ${typeof aggregateCostTd === "function" ? aggregateCostTd(0, "silver-val") : dim}
    ${priceTd(row.sellPot.price, row.item.id, row.sellPot.city)}
    ${dim}${dim}${dim}${dim}${dim}${dim}${dim}${dim}${dim}
  </tr>`;
  }

  const craftsWithFocus = row.focusCost ? (typeof focusBarCrafts === "function" ? focusBarCrafts(row.focusCost) : Math.floor(10000 / row.focusCost)) : 0;
  const focusMatsHtml = row.focusCost
    ? row.recipe.map((m) => {
        const need = matsNeededFor10kFocus(row.focusCost, m.count, true, row.focusRrr || row.rrr);
        const name = getItemDisplayName(m.matId) || m.matId;
        return `${need.toLocaleString()}x ${name}`;
      }).join("<br>") +
      `<br><small style="color:#9ca3af">${(typeof formatBarCrafts === "function" ? formatBarCrafts(craftsWithFocus) : craftsWithFocus.toLocaleString())}x ${tx("crafts", "r_crafts")} @ ${formatFocusCost(row.focusCost)} ${tx("focus ea", "r_focus_ea")}</small>`
    : "—";
  const ppfClass = row.profitPerFocus > 0 ? "profit-low" : "profit-negative";

  // Profit for a whole 10k focus bar spent crafting this mount. Quotes the
  // FOCUS-ON profit it multiplies; Pure Profit tracks the checkbox instead.
  const p10kCraft = row.profitPer10kFocus || 0;
  const p10kCraftOperand = formatSilver(row.profitFocusOn != null ? row.profitFocusOn : (row.marginInfo.profit || 0));
  const p10kCraftCell = row.focusCost
    ? `<td class="silver-val ${p10kCraft > 0 ? "profit-low" : "profit-negative"}" title="${tx("{profit} profit/craft (after mat costs) × {crafts} crafts ({focus} focus ea)", "r_p10k_craft_tip").replace("{profit}", p10kCraftOperand).replace("{crafts}", (typeof formatBarCrafts === "function" ? formatBarCrafts(craftsWithFocus) : craftsWithFocus.toLocaleString())).replace("{focus}", formatFocusCost(row.focusCost))}">${formatSilver(p10kCraft)}${(typeof gatheredPer10kSmallHtml === "function" ? gatheredPer10kSmallHtml(row.profitPer10kFocusGathered, row.profitFocusOnGathered) : "")}</td>`
    : '<td style="color:#6b7280;font-style:italic" title="Not focus-craftable">—</td>';

  return `
  <tr data-row-key="${rowKey}">
    ${addTdForKey("mounts-table", rowKey)}
    <td class="cell-item">${dispName(row.item.id, row.item.name)} <small style="color:#9ca3af">${tx("(Craft)", "r_craft_paren")}</small></td>
    <td class="cell-route">${tx("Craft", "r_craft")}: ${row.craftCity} → ${tx("Sell", "r_sell")}: ${row.sellPot.city}${brecilienFeeBadge(row.brecilienFee)}</td>
    <td class="cell-mats">${matsHtml}</td>
    <td class="silver-val">${formatSilver(row.totalInputCost)}</td>
    ${priceTd(row.sellPot.price, row.item.id, row.sellPot.city)}
    ${profitTd(row.marginInfo, "mounts-table", rowIdx, row.sellPot.city)}
    ${pureProfitTd(row.marginInfo)}
    ${p10kCraftCell}
    <td style="color:#6b7280;font-style:italic" title="Nurture only applies to breeding rows">—</td>      <td class="cell-focus-mats">${focusMatsHtml}</td>
    <td class="silver-val ${ppfClass}">${row.profitPerFocus ? row.profitPerFocus.toFixed(1) : "—"}</td>
    <td class="cell-note">${focusPlayCell(row.bestFocusPlay)}</td>
    <td style="color:#6b7280;font-style:italic" title="Silver/FP only applies to FP-priced breeding rows">—</td>
    <td style="color:#6b7280;font-style:italic" title="Raw baby sale only applies to FP-priced breeding rows">—</td>
  </tr>`;
}

/**
 * Every mount CRAFT row: the best route per zone section (royal / Caerleon, or
 * one row with Black/Red Zone Routes on), or its no-data row when nothing prices.
 *
 * Moved here from renderMountsTable when js/render-mounts.js passed the 800-line
 * cap — the loop is unchanged apart from reading the table City picks
 * (js/mounts-city-pick.js). `MOUNT_MIN_VOLUME` keeps the name it had inside the
 * renderer, where the rationale for 0 lives.
 */
function buildMountCraftRows(marketData, MOUNT_MIN_VOLUME) {
  const craftRows = MOUNT_RECIPES.flatMap((mount) => {
    const mountBounds = getIQRBounds(marketData[mount.id]);
    let bestResult = null;
    let bestRoyalResult = null;
    let bestCaerleonResult = null;
    // The merged-mode winner WITH focus — the source of Profit / 10k Focus (below).
    let bestFocusOnResult = null;
    // What to show when NOTHING prices: a row is still drawn, with every
    // material and the sell price click-to-edit. The placeholder this replaced
    // carried no `item`, and the formatter's `if (!row.item) return ""` then
    // dropped it — an unpriced mount craft was invisible even under "Show All",
    // so there was nothing left to click to correct the missing listing. Same
    // rule breedingRowFor already follows for breeding rows.
    let noDataResult = null;
    let noDataRoyalResult = null;
    let noDataCaerleonResult = null;

    // Faction Warfare mounts (e.g. T5_MOUNT_SWAMPDRAGON_FW_THETFORD) can only
    // be saddled at the matching faction city — not the cheapest-mat city.
    const mountLockCity = typeof getFactionLockCity === "function"
      ? getFactionLockCity(mount.id) : null;

    // Pre-compute the mount's focus cost so the toggle only boosts RRR when
    // the mount is actually focus-craftable (items.xml craftingfocus > 0).
    const mountFocusCost = (typeof getFocusCost === "function")
      ? getFocusCost(mount.id, getTierFromId(mount.id)) : 0;
    CRAFT_CITIES.forEach((craftCity) => {
      if (mountLockCity && craftCity !== mountLockCity) return;
      const rrr = getCraftRRR(craftCity, null, isFocusEnabled() && mountFocusCost > 0); // no specialization for mounts
      const isCaerleonCity = craftCity === "Caerleon";

      // Where this craft city may buy and sell, narrowed to the City picks
      // (js/mounts-city-pick.js). An empty pool is a pick out of this craft
      // city's reach: no honest route and no no-data row either.
      const buyCities = typeof mountsCraftBuyCities === "function"
        ? mountsCraftBuyCities(craftCity) : CITIES.filter((c) => isValidSourceCity(c, craftCity));
      const forcedSellCity = getCityForce(mount.id, "sell");
      const sellCities = typeof mountsCraftSellCities === "function"
        ? mountsCraftSellCities(craftCity, forcedSellCity)
        : (forcedSellCity ? [forcedSellCity] : SELL_CITIES);
      if (!buyCities.length || !sellCities.length) return;

      const matBestPrices = {};
      let allAvailable = true;

      mount.materials.forEach((m) => {
        const mBounds = getIQRBounds(marketData[m.matId]);
        let bestPrice = Infinity, bestCity = null;
        const forcedBuyCity = getCityForce(m.matId, "buy");
        // Only honor a forced material buy city the pool allows: zone-compatible
        // with the craft city (BMR off splits royal/caerleon) and never over an
        // active Buy City pick. Without this, a force at Lymhurst would silently
        // apply to the Caerleon-craft row too, displaying an impossible "buy
        // Lymhurst, craft Caerleon" route.
        const matForceValid = forcedBuyCity && buyCities.includes(forcedBuyCity);
        if (matForceValid) {
          const p = getBuyPrice(marketData[m.matId], forcedBuyCity, mBounds, m.matId);
          bestCity = forcedBuyCity;
          bestPrice = p > 0 ? p : 0;
          if (p <= 0) allAvailable = false;
        } else {
          let bestEff = Infinity;
          buyCities.forEach((buyCity) => {
            const p = getBuyPrice(marketData[m.matId], buyCity, mBounds, m.matId);
            const v = marketData[m.matId]?.[buyCity]?.volume_24h || 0;
            if (p > 0 && v >= MOUNT_MIN_VOLUME) {
              // Rank by effective cost incl. Brecilien haul-out fee to craftCity.
              const exit = (typeof legBrecilienCost === "function")
                ? legBrecilienCost(buyCity, craftCity, m.matId, 1) : 0;
              const eff = p + exit;
              if (eff < bestEff) { bestEff = eff; bestPrice = p; bestCity = buyCity; }
            }
          });
          if (!bestCity) allAvailable = false;
        }
        matBestPrices[m.matId] = { price: bestCity ? bestPrice : 0, city: bestCity };
      });

      // Remember this craft city as the row to fall back on. Two things can
      // leave a mount with no route: an input nothing has listed, and an OUTPUT
      // nothing has listed. Both used to make the mount disappear from the
      // table outright, taking with them the very cells that could have fixed
      // it, so both land here.
      const recordNoData = () => {
        const ndRow = buildMountNoDataRow(mount, craftCity, matBestPrices, rrr, marketData, mountBounds);
        if (!noDataResult) noDataResult = ndRow;
        if (isCaerleonCity) {
          if (!noDataCaerleonResult) noDataCaerleonResult = { ...ndRow, section: "caerleon" };
        } else if (!noDataRoyalResult) {
          noDataRoyalResult = { ...ndRow, section: "royal" };
        }
      };

      if (!allAvailable) {
        recordNoData();
        return;
      }

      let totalInputCost = 0;
      let brecilienMatFee = 0;
      mount.materials.forEach((m) => {
        const effectiveCount = isRrrEligible(m.matId) ? m.count * (1 - rrr) : m.count;
        totalInputCost += matBestPrices[m.matId].price * effectiveCount * (1 + SETUP_FEE);
        if (typeof legBrecilienCost === "function") {
          const matFee = legBrecilienCost(matBestPrices[m.matId].city, craftCity, m.matId, effectiveCount);
          totalInputCost += matFee;
          brecilienMatFee += matFee;
        }
      });

      let cityHadRoute = false;
      sellCities.forEach((sc) => {
        if (isInvalidCrossRoute(craftCity, sc)) return;
        const sPrice = getSellPrice(marketData[mount.id], sc, mountBounds, mount.id);
        const sVol = marketData[mount.id]?.[sc]?.volume_24h || 0;
        if (sPrice > 0 && sVol >= MOUNT_MIN_VOLUME) {
          cityHadRoute = true;
          // Mount crafted in Brecilien and sold elsewhere pays the haul-out fee.
          const productTravel = (typeof legBrecilienCost === "function")
            ? legBrecilienCost(craftCity, sc, mount.id, 1) : 0;
          const routeCost = totalInputCost + productTravel;
          const revenue = sPrice * (1 - PREMIUM_TAX);
          const profit = revenue - routeCost;
          const margin = routeCost > 0 ? (profit / routeCost) * 100 : 0;

          const candidate = {
            item: mount, isBreeding: false, isCraft: true,
            recipe: mount.materials, matBestPrices, craftCity,
            buyMat: { city: Object.values(matBestPrices)[0]?.city || craftCity, price: 0 },
            sellPot: { city: sc, price: sPrice },
            totalInputCost: routeCost, marginInfo: { profit, margin },
            brecilienFee: brecilienMatFee + productTravel,
            dailyVol: getCityVol(marketData, mount.id, sc),
            rrr,
            hasOverride:
              mount.materials.some(m => getOverridePrice(m.matId, matBestPrices[m.matId]?.city) !== null) ||
              getOverridePrice(mount.id, sc) !== null,
          };

          // The self-gathered twin (plan.md): the saddle mats (refined leather
          // etc. — RRR-eligible, so gatherable) leave WHOLE, price, setup fee
          // and haul leg together; a bought mount input (the grown horse) is
          // not gatherable and stays, like the finished mount's haul leg and
          // the sell tax. Priced on this same winning route (same sell city,
          // same travel), so pureProfitTd can show the two side by side
          // (js/pure-profit-cell.js reads marginInfo.selfFoundProfit).
          let selfFoundKept = productTravel;
          mount.materials.forEach((m) => {
            if (isRrrEligible(m.matId)) return;
            const bought = matBestPrices[m.matId] || {};
            selfFoundKept += (bought.price || 0) * m.count * (1 + SETUP_FEE);
            if (typeof legBrecilienCost === "function") {
              selfFoundKept += legBrecilienCost(bought.city, craftCity, m.matId, m.count);
            }
          });
          candidate.marginInfo.selfFoundProfit = sPrice * (1 - PREMIUM_TAX) - selfFoundKept;

          const focusCost = getFocusCost(mount.id, getTierFromId(mount.id));
          // Benchmark for Silver/Focus + "Mats to Buy": focus is ON only
          // when the mount is actually focus-craftable.
          const focusRrr = getCraftRRR(craftCity, null, focusCost > 0);
          const inputCostAtRrr = (atRrr) => {
            let cost = 0;
            mount.materials.forEach((m) => {
              const eff = isRrrEligible(m.matId) ? m.count * (1 - atRrr) : m.count;
              cost += matBestPrices[m.matId].price * eff * (1 + SETUP_FEE);
              if (typeof legBrecilienCost === "function") {
                cost += legBrecilienCost(matBestPrices[m.matId].city, craftCity, m.matId, eff);
              }
            });
            return cost + productTravel; // haul finished mount out of Brecilien
          };
          // A crafted mount buys its materials, so the craft is the only focusable
          // step: what focus adds to the finished mount is the extra material value
          // the higher return rate hands back. Same standard as every other table
          // (js/focus-play.js); the old figure was the craft's whole profit ÷ focus.
          const bestFocusPlay = pickBestFocusPlay([
            makeFocusPlay({
              kind: "craft", itemId: mount.id, focusCost,
              profitDelta: inputCostAtRrr(getCraftRRR(craftCity, null, false)) - inputCostAtRrr(focusRrr),
            }),
          ]);
          candidate.focusCost = focusCost;
          candidate.focusRrr = focusRrr;
          candidate.baseRrr = getCraftRRR(craftCity, null, false);
          candidate.bestFocusPlay = bestFocusPlay;
          // Gated on the row's own rate: with the box off `rrr` above IS
          // baseRrr, so the headline never had this saving to give back.
          candidate.focusProfitDelta =
            (isFocusEnabled() && focusCost > 0 && bestFocusPlay) ? bestFocusPlay.profitDelta : 0;
          candidate.profitPerFocus = focusPlayRate(bestFocusPlay);
          // A full focus bar is focus-on play by definition, so the per-10k
          // figure multiplies the FOCUS-ON profit — pairing it with the
          // checkbox profit made the column move with the toggle.
          candidate.profitFocusOn = revenue - inputCostAtRrr(focusRrr);
          candidate.profitPer10kFocus = calculateProfitPer10kFocus(
            candidate.profitFocusOn, focusCost,
          );
          // Self-gathered twin of the bar: the leather at zero, the grown
          // mount and haul legs kept (marginInfo.selfFoundProfit above).
          const gatheredFocusOn = candidate.marginInfo.selfFoundProfit;
          candidate.profitFocusOnGathered = gatheredFocusOn;
          candidate.profitPer10kFocusGathered = (Number.isFinite(gatheredFocusOn) && focusCost > 0)
            ? calculateProfitPer10kFocus(gatheredFocusOn, focusCost) : null;
          candidate.focusMats = mount.materials.reduce((sum, m) =>
            sum + matsNeededFor10kFocus(focusCost, m.count, isRrrEligible(m.matId), focusRrr), 0);

          if (!bestResult || margin > bestResult.marginInfo.margin) bestResult = candidate;
          const focusInputCost = inputCostAtRrr(focusRrr);
          candidate.focusOnMargin = focusInputCost > 0 ? (candidate.profitFocusOn / focusInputCost) * 100 : 0;
          if (!bestFocusOnResult || candidate.focusOnMargin > bestFocusOnResult.focusOnMargin) {
            bestFocusOnResult = candidate;
          }
          if (isCaerleonCity && (!bestCaerleonResult || margin > bestCaerleonResult.marginInfo.margin))
            bestCaerleonResult = { ...candidate, section: "caerleon" };
          // Royal pick: strictly higher margin wins; on a tie (mounts have no
          // craft spec, so every Royal city is interchangeable) prefer crafting
          // in the city you sell in — no finished-good haul. Falls back to
          // first-seen when the best sell city isn't a Royal craft candidate.
          const sellsLocal = sc === craftCity;
          if (
            !isCaerleonCity &&
            (!bestRoyalResult ||
              margin > bestRoyalResult.marginInfo.margin ||
              (margin === bestRoyalResult.marginInfo.margin &&
                sellsLocal &&
                bestRoyalResult.craftCity !== bestRoyalResult.sellPot.city))
          )
            bestRoyalResult = { ...candidate, section: "royal" };
        }
      });
      if (!cityHadRoute) recordNoData();
    });

    if (isBlackRedZoneEnabled()) {
      // Profit / 10k Focus is focus-ON play and must not follow the checkbox.
      // The merged row weighs Caerleon against royal cities that buy from
      // different markets, and the return rate only discounts the leather, not
      // the grown animal — so the checkbox can flip the winning craft city. The
      // figure comes from the focus-on winner (bestResult itself with focus on).
      if (bestResult && bestFocusOnResult && bestFocusOnResult !== bestResult) {
        bestResult = { ...bestResult, profitFocusOn: bestFocusOnResult.profitFocusOn,
          profitPer10kFocus: bestFocusOnResult.profitPer10kFocus,
          profitFocusOnGathered: bestFocusOnResult.profitFocusOnGathered,
          profitPer10kFocusGathered: bestFocusOnResult.profitPer10kFocusGathered };
      }
      return [bestResult || noDataResult].filter(Boolean);
    }
    return [
      bestRoyalResult || noDataRoyalResult,
      bestCaerleonResult || noDataCaerleonResult,
    ].filter(Boolean);
  });
  return craftRows;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { renderMountCraftRow, buildMountNoDataRow, buildMountCraftRows };
}
