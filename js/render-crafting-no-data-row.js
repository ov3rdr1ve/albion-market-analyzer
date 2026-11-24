// Crafting table — the NO-DATA row (a recipe the route search could not price).
//
// Split out of js/render-crafting.js to keep it inside the 800-line cap, the
// same way js/render-consumable-no-data-row.js serves the Consumables table.
// Everything it calls (bestMatBuySource, getNoSpecLabel, priceTd, matPriceSpan,
// …) is the same shared global as before the split.
//
// The row stays click-to-edit: every material shows its real price and source
// where it has one, and the lone unpriced blocker opens its editor on the city
// the rest of the table buys in — the Buy City pick when one is active.

/**
 * @param {object} row          a craftingRowsForItem placeholder (margin -1)
 * @param {string} rowKey
 * @param {string} stationAttr  ` data-station="…"` or ""
 * @param {object} marketData
 * @returns {string} the <tr> markup
 */
function craftingNoDataRowHtml(row, rowKey, stationAttr, marketData) {
  const { item, materials, craftCity } = row;
  const buyPick = (typeof getTableBuyCity === "function") ? getTableBuyCity("crafting-table") : null;
  const noDataMatsHtml = materials
    .map((m) => {
      const name = getItemDisplayName(m.matId);
      const { price, city } = bestMatBuySource(m.matId, craftCity, marketData);
      // Priced elsewhere → show real price + source; the lone unpriced
      // blocker falls back to the pick (else the craft city) as a clickable
      // "no data".
      const mCity = city || buyPick || getCityForce(m.matId, "buy") || craftCity;
      const fromTag = city
        ? ` <small style="color:#9ca3af">(${tx("from", "r_from_lower")} ${city})</small>`
        : "";
      return `${m.count}x ${name} ${matPriceSpan(m.matId, mCity, price)}${fromTag}`;
    })
    .join("<br>");
  // Same zone gate as the route search: a forced sell city the craft city
  // can't reach must not surface in this section's no-data row (otherwise the
  // Caerleon section shows a royal sell forced elsewhere). The City pick comes
  // first here too, so an unpriced row offers to edit the price at the city the
  // rest of the filtered table is selling in.
  const forcedSell = getCityForce(item.id, "sell");
  const reachableForce = forcedSell && !isInvalidCrossRoute(craftCity, forcedSell) ? forcedSell : null;
  const ndCities = (typeof effectiveSellCities === "function")
    ? effectiveSellCities("crafting-table", craftCity, reachableForce, SELL_CITIES)
    : (reachableForce ? [reachableForce] : SELL_CITIES);
  const sellCity = ndCities.length === 1 ? ndCities[0] : (reachableForce || craftCity);
  const sellPrice = getSellPrice(marketData[item.id], sellCity, null, item.id);
  const noDataTd = '<td style="color:#6b7280;font-style:italic">—</td>';
  const hasVariants = item.isGearRecipe && !item.id.includes("@") && getTierFromId(item.id) >= 4;
  // A Waystone's @n is a difficulty, not an enchant of a base row, so it
  // is not indented under anything (js/sorting.js isEnchantVariantRow).
  const isVariant = item.id.includes("@") && !item.topLevelVariant;
  const expandIcon = hasVariants
    ? `<span data-expand-craft="${item.id}" style="cursor:pointer;margin-right:4px;color:#7ab8c4">${expandedCraftItems.has(item.id) ? "▼" : "▶"}</span>`
    : "";
  const nameStyle = isVariant ? ' style="padding-left:1.5em;color:#b0b8c4"' : "";
  return `
        <tr data-row-key="${rowKey}"${stationAttr}>
          ${addTdForKey("crafting-table", rowKey)}
          <td class="cell-item"${nameStyle}>${expandIcon}${dispName(item.id, item.name)}</td>
          <td class="cell-route" style="color:#6b7280;font-style:italic">${tx("Craft", "r_craft")}: ${craftCity || "—"}${getNoSpecLabel(craftCity, item.craftType)}</td>
          <td class="cell-mats">${noDataMatsHtml}</td>
          ${noDataTd}
          ${priceTd(sellPrice, item.id, sellCity)}
          ${noDataTd}
          ${noDataTd}          ${noDataTd}          ${noDataTd}
          ${noDataTd}
          ${noDataTd}
        </tr>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { craftingNoDataRowHtml };
}
