/**
 * Enchanting Profitability Table Renderer
 * Shows profit margins for enchanting gear (.0→.1, .1→.2, .2→.3).
 */

// The self-found pure-profit twin (js/self-found-profit.js); Node sandboxes that compile this renderer alone use the same live-getter formula.
const _enchantSelfFoundTwin = (sellPrice, keptSilver) => typeof selfFoundProfit === "function" ? selfFoundProfit(sellPrice, keptSilver) : sellPrice * (1 - PREMIUM_TAX) - keptSilver;

function renderEnchantingTable(marketData) {
  const items = getEnchantableItems();
  // Like the crafting table (crafting-thin-volume-gate.test.cjs), an enchant row
  // is a valuation of one specific item, not a pick from a liquid market: the
  // per-order volume gate would drop the source, the mat or the target of nearly
  // every artifact/enchanted piece, since those trade in single digits per day.
  // getBuyPrice/getSellPrice still reject IQR outliers, and the Vol column shows
  // how thin the market is.
  const MIN_VOLUME = 0;

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

  const rows = [];

  sections.forEach(({ name: sectionName, buyCities, sellCities }) => {
    items.forEach((item) => {
      const tier = getTierFromId(item.id);
      const matCount = getEnchantMatCount(item);

      ENCHANT_TRANSITIONS.forEach((trans) => {
        const sourceId = getEnchantedItemId(item.id, trans.from);
        const targetId = getEnchantedItemId(item.id, trans.to);
        const enchantMatId = getEnchantMatId(tier, trans.matType);

        const sourceBounds = getIQRBounds(marketData[sourceId]);
        const targetBounds = getIQRBounds(marketData[targetId]);
        const matBounds = getIQRBounds(marketData[enchantMatId]);

        // Find best buy city for source item
        let bestSourceCity = null;
        let bestSourcePrice = Infinity;
        const forcedSourceCity = getCityForce(sourceId, "buy");
        // Only honor a force that belongs to THIS section (royal vs Caerleon).
        if (forcedSourceCity && buyCities.includes(forcedSourceCity)) {
          const p = getBuyPrice(marketData[sourceId], forcedSourceCity, sourceBounds, sourceId);
          if (p > 0) { bestSourceCity = forcedSourceCity; bestSourcePrice = p; }
        } else {
          buyCities.forEach((city) => {
            const p = getBuyPrice(marketData[sourceId], city, sourceBounds, sourceId);
            const v = getOverrideVolume(sourceId, city) ?? (marketData[sourceId]?.[city]?.volume_24h || 0);
            if (p > 0 && (v >= MIN_VOLUME || getOverridePrice(sourceId, city) !== null) && p < bestSourcePrice) {
              bestSourcePrice = p;
              bestSourceCity = city;
            }
          });
        }

        // Find best buy city for enchant materials
        let bestMatCity = null;
        let bestMatPrice = Infinity;
        const forcedMatCity = getCityForce(enchantMatId, "buy");
        if (forcedMatCity && buyCities.includes(forcedMatCity)) {
          const p = getBuyPrice(marketData[enchantMatId], forcedMatCity, matBounds, enchantMatId);
          if (p > 0) { bestMatCity = forcedMatCity; bestMatPrice = p; }
        } else {
          buyCities.forEach((city) => {
            const p = getBuyPrice(marketData[enchantMatId], city, matBounds, enchantMatId);
            const v = getOverrideVolume(enchantMatId, city) ?? (marketData[enchantMatId]?.[city]?.volume_24h || 0);
            if (p > 0 && (v >= MIN_VOLUME || getOverridePrice(enchantMatId, city) !== null) && p < bestMatPrice) {
              bestMatPrice = p;
              bestMatCity = city;
            }
          });
        }

        if (!bestSourceCity || !bestMatCity) {
          rows.push({
            marginInfo: { margin: -999 },
            section: sectionName,
          });
          return;
        }

        // Find best sell city for target item
        let bestSellCity = null;
        let bestSellPrice = 0;
        let maxMargin = -Infinity;

        const forcedSellCity = getCityForce(targetId, "sell");
        const effectiveSellCities =
          forcedSellCity && sellCities.includes(forcedSellCity)
            ? [forcedSellCity]
            : sellCities;
        effectiveSellCities.forEach((sc) => {
          if (bestSourceCity && isInvalidCrossRoute(bestSourceCity, sc)) return;
          const p = getSellPrice(marketData[targetId], sc, targetBounds, targetId);
          const v = getOverrideVolume(targetId, sc) ?? (marketData[targetId]?.[sc]?.volume_24h || 0);
          if (p > 0 && (v >= MIN_VOLUME || getOverridePrice(targetId, sc) !== null)) {
            const totalMatCost = matCount * bestMatPrice * (1 + SETUP_FEE);
            const sourceCost = bestSourcePrice * (1 + SETUP_FEE);
            const inputCost = sourceCost + totalMatCost;
            const revenue = p * (1 - PREMIUM_TAX);
            const margin = inputCost > 0 ? ((revenue - inputCost) / inputCost) * 100 : -999;
            if (margin > maxMargin) {
              maxMargin = margin;
              bestSellCity = sc;
              bestSellPrice = p;
            }
          }
        });

        if (!bestSellCity) {
          rows.push({
            marginInfo: { margin: -999 },
            section: sectionName,
          });
          return;
        }

        const totalMatCost = matCount * bestMatPrice * (1 + SETUP_FEE);
        const sourceCost = bestSourcePrice * (1 + SETUP_FEE);
        const totalInputCost = sourceCost + totalMatCost;
        const revenue = bestSellPrice * (1 - PREMIUM_TAX);
        const profit = revenue - totalInputCost;
        const margin = totalInputCost > 0 ? (profit / totalInputCost) * 100 : -999;
        // Self-found twin (plan.md): runes/souls/relics are farmable drops — zeroed WITH their
        // buy-order setup fee; the bought base item, its setup fee and the sell tax stay.
        const rowSelfFound = _enchantSelfFoundTwin(bestSellPrice, sourceCost);

        const vol = getOverrideVolume(targetId, bestSellCity) ?? (marketData[targetId]?.[bestSellCity]?.volume_24h || 0);

        rows.push({
          item,
          tier,
          transition: trans,
          transitionLabel: `.${trans.from} → .${trans.to}`,
          sourceId,
          targetId,
          enchantMatId,
          matCount,
          sourceCity: bestSourceCity,
          sourcePrice: bestSourcePrice,
          matCity: bestMatCity,
          matPrice: bestMatPrice,
          totalMatCost: matCount * bestMatPrice,
          sellCity: bestSellCity,
          sellPrice: bestSellPrice,
          totalInputCost,
          revenue,
          marginInfo: { profit, margin, selfFoundProfit: rowSelfFound },
          // Over-cap margins read as bad market data: kept + flagged (hidden
          // unless Show All) instead of dropped, so the price stays editable.
          suspectMargin: isSuspectMargin(margin),
          dailyVol: vol,
          section: sectionName,
          hasOverride:
            getOverridePrice(sourceId, bestSourceCity) !== null ||
            getOverridePrice(enchantMatId, bestMatCity) !== null ||
            getOverridePrice(targetId, bestSellCity) !== null ||
            getOverrideVolume(targetId, bestSellCity) !== null,
        });
      });
    });
  });

  renderTableData("enchanting-table", rows, (row, rowIdx) => {
    if (!row.item || row.marginInfo.margin === -999) return "";
    const rowKey = getRowKey(row, "enchanting-table");

    const transColor =
      row.transition.matType === "RUNE"
        ? "#7ab8c4"
        : row.transition.matType === "SOUL"
          ? "#b07ac4"
          : "#c4a07a";

    const matName = getItemDisplayName(row.enchantMatId);

    return `
    <tr data-row-key="${rowKey}">
      ${addTdForKey("enchanting-table", rowKey)}
      <td class="cell-item">${dispName(row.item.id, row.item.name)} <small style="color:#9ca3af">[T${row.tier}]</small></td>
      <td class="cell-text" style="color:${transColor}">${suspectMarginBadge(row)}${row.transitionLabel} <small>(${row.transition.matType})</small></td>
      <td class="cell-text">
        Source ${matPriceSpan(row.sourceId, row.sourceCity, row.sourcePrice)}
        <small style="color:#9ca3af">(${row.sourceCity})</small>
      </td>
      <td class="cell-mats">
        ${row.matCount}x ${matName} ${matPriceSpan(row.enchantMatId, row.matCity, row.matPrice)}
        <small style="color:#9ca3af">(${row.matCity})</small>
      </td>
      <td class="silver-val">${formatSilver(row.totalInputCost)}</td>
      ${priceTd(row.sellPrice, row.targetId, row.sellCity, "sell", "silver-val", true)}
      ${profitTd(row.marginInfo, "enchanting-table", rowIdx, row.sellCity)}
      ${pureProfitTd(row.marginInfo)}    </tr>`;
  });
}
