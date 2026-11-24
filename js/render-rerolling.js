/**
 * Quality Rerolling Profitability Table Renderer
 * Shows profit margins for upgrading item quality levels.
 */

/**
 * Reads the selected quality transition from the dropdown.
 * Returns null for "All transitions", otherwise { from, to }.
 */
function getSelectedRerollTransition() {
  if (typeof document === "undefined") return null;
  const val = document.getElementById("rerolling-quality-filter")?.value || "";
  if (!val) return null;
  const [from, to] = val.split("-").map(Number);
  if (!from || !to) return null;
  return { from, to };
}

/**
 * Attempt counts are fractional averages. Short walks (the useful ones) keep a
 * decimal so 1 and 3.8 don't both read as "4"; long Masterpiece walks round.
 */
function formatRerollAttempts(attempts) {
  if (!Number.isFinite(attempts)) return "∞";
  return attempts < 10 ? attempts.toFixed(1) : Math.round(attempts).toLocaleString();
}

function renderRerollingTable(qualityMarketData) {
  const items = getRerollableItems();

  // When a single transition is selected from the dropdown, only that one is
  // rendered so items can be compared at a fixed quality jump.
  const selectedTrans = getSelectedRerollTransition();
  const transitions = selectedTrans
    ? QUALITY_TRANSITIONS.filter(
        (t) => t.from === selectedTrans.from && t.to === selectedTrans.to,
      )
    : QUALITY_TRANSITIONS;

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

      transitions.forEach((trans) => {
        // Find best buy city for source quality
        let bestBuyCity = null;
        let bestBuyPrice = Infinity;

        // Overrides/forces are keyed per quality (buy = the `from` quality) so
        // editing one transition's buy price never disturbs another quality.
        const buyOvKey = qualityOverrideKey(item.id, trans.from);
        const forcedBuyCity = getCityForce(buyOvKey, "buy");
        // Only honor a force that belongs to THIS section (royal vs Caerleon)
        // so an edit in one section doesn't bleed into the other.
        if (forcedBuyCity && buyCities.includes(forcedBuyCity)) {
          const p = getQualityBuyPrice(qualityMarketData, item.id, trans.from, forcedBuyCity);
          if (p > 0) { bestBuyCity = forcedBuyCity; bestBuyPrice = p; }
        } else {
          buyCities.forEach((city) => {
            const p = getQualityBuyPrice(qualityMarketData, item.id, trans.from, city);
            if (p > 0 && p < bestBuyPrice) {
              bestBuyPrice = p;
              bestBuyCity = city;
            }
          });
        }

        if (!bestBuyCity) {
          rows.push({ marginInfo: { margin: -999 }, section: sectionName });
          return;
        }

        const rerollCost = getExpectedRerollCost(item.id, trans.from, trans.to);

        // Find best sell city for target quality
        let bestSellCity = null;
        let bestSellPrice = 0;
        let maxMargin = -Infinity;

        const sellOvKey = qualityOverrideKey(item.id, trans.to);
        const forcedSellCity = getCityForce(sellOvKey, "sell");
        const effectiveSellCities =
          forcedSellCity && sellCities.includes(forcedSellCity)
            ? [forcedSellCity]
            : sellCities;
        effectiveSellCities.forEach((sc) => {
          if (bestBuyCity && isInvalidCrossRoute(bestBuyCity, sc)) return;
          const p = getQualitySellPrice(qualityMarketData, item.id, trans.to, sc);
          if (p > 0) {
            const inputCost = bestBuyPrice * (1 + SETUP_FEE) + rerollCost;
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
          rows.push({ marginInfo: { margin: -999 }, section: sectionName });
          return;
        }

        const totalInputCost = bestBuyPrice * (1 + SETUP_FEE) + rerollCost;
        const revenue = bestSellPrice * (1 - PREMIUM_TAX);
        const profit = revenue - totalInputCost;
        const margin = totalInputCost > 0 ? (profit / totalInputCost) * 100 : -999;

        const expectedAttempts = getExpectedAttempts(trans.from, trans.to);

        rows.push({
          item,
          tier,
          transition: trans,
          transitionLabel: `${QUALITY_NAMES[trans.from]} → ${QUALITY_NAMES[trans.to]}`,
          buyCity: bestBuyCity,
          buyPrice: bestBuyPrice,
          sellCity: bestSellCity,
          sellPrice: bestSellPrice,
          rerollCost,
          expectedAttempts,
          totalInputCost,
          revenue,
          // Self-found twin (plan.md): a reroll buys no gatherable input — the walk bills
          // silver (getExpectedRerollCost) — so the twin coincides with the primary profit.
          marginInfo: { profit, margin, selfFoundProfit: profit },
          // Over-cap margins read as bad market data: kept + flagged (hidden
          // unless Show All) instead of dropped, so the price stays editable.
          suspectMargin: isSuspectMargin(margin),
          // 24h volume of the rerolled (target-quality) item at the sell city.
          dailyVol: getQualityVolume(qualityMarketData, item.id, trans.to, bestSellCity),
          hasOverride: (
            getOverridePrice(buyOvKey, bestBuyCity) !== null ||
            getOverridePrice(sellOvKey, bestSellCity) !== null
          ),
          section: sectionName,
        });
      });
    });
  });

  renderTableData("rerolling-table", rows, (row, rowIdx) => {
    if (!row.item || row.marginInfo.margin === -999) return "";
    const rowKey = getRowKey(row, "rerolling-table");

    const qualityColors = {
      1: "#9ca3af",
      2: "#5e9e78",
      3: "#4a90d9",
      4: "#b07ac4",
      5: "#c4a07a",
    };
    const fromColor = qualityColors[row.transition.from] || "#9ca3af";
    const toColor = qualityColors[row.transition.to] || "#9ca3af";

    return `
    <tr data-row-key="${rowKey}">
      ${addTdForKey("rerolling-table", rowKey)}
      <td class="cell-item">${dispName(row.item.id, row.item.name)} <small style="color:#9ca3af">[T${row.tier}]</small></td>
      <td class="cell-text">
        ${suspectMarginBadge(row)}<span style="color:${fromColor}">${QUALITY_NAMES[row.transition.from]}</span>
        →
        <span style="color:${toColor}">${QUALITY_NAMES[row.transition.to]}</span>
        <small style="color:#9ca3af">(~${formatRerollAttempts(row.expectedAttempts)} attempts)</small>
      </td>
      ${priceTd(row.buyPrice, row.item.id, row.buyCity, "buy", "silver-val", true, row.transition.from)}
      <td class="silver-val">${formatSilver(row.rerollCost)}</td>
      ${priceTd(row.sellPrice, row.item.id, row.sellCity, "sell", "silver-val", true, row.transition.to)}
      ${profitTd(row.marginInfo, "rerolling-table", rowIdx, row.sellCity)}
      ${pureProfitTd(row.marginInfo)}    </tr>`;
  });
}

// ─── Quality-transition selector ─────────────────────────────────────────────
// Populates the #rerolling-quality-filter dropdown from QUALITY_TRANSITIONS and
// re-renders the table (re-using the cached lastQualityMarketData) when changed,
// so the user can switch between transitions for comparison without re-scanning.
(function _initRerollTransitionFilter() {
  if (typeof document === "undefined") return;
  if (document._rerollTransitionFilterInit) return;
  document._rerollTransitionFilterInit = true;
  const select = document.getElementById("rerolling-quality-filter");
  if (!select) return;

  // Build one option per meaningful transition, preserving the "All" default.
  QUALITY_TRANSITIONS.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = `${t.from}-${t.to}`;
    opt.textContent = `${QUALITY_NAMES[t.from]} → ${QUALITY_NAMES[t.to]}`;
    select.appendChild(opt);
  });

  select.addEventListener("change", () => {
    if (typeof lastQualityMarketData !== "undefined" && lastQualityMarketData) {
      renderRerollingTable(lastQualityMarketData);
    }
  });
})();
