// Consumables table — the CHAIN-CRAFT row renderer (butcher / mill / cook /
// alchemist rows that turn one bought input into a batch: raw meat from a grown
// animal, flour from wheat, fish chops from fish, schnapps from potatoes).
//
// Split out of js/render-consumables.js to keep both files inside the 800-line
// cap. Pure presentation: every figure on `row` is computed by the chain-craft
// branch of renderConsumableTable, and every helper it calls (renderChainBreakdown,
// priceTd, profitTd, focusPlayCell, …) is a shared global, same as before the split.
//
// Returns the <tr> HTML for one chain-craft row.
function renderConsumableChainRow(row, rowIdx, rowKey, itemNameCell) {
  const { item, buyMat, sellPot, totalInputCost, marginInfo } = row;
  const chain = row.chainSourcing.chain;
  const stationVerb = chain.station === "butcher" ? tx("Buy & butcher", "r_buy_butcher")
                    : chain.station === "mill" ? tx("Mill", "r_mill")
                    : chain.station === "cook" ? tx("Cook", "r_cook")
                    : chain.station === "alchemist" ? tx("Brew", "r_brew")
                    : chain.station === "pasture" ? tx("Pasture", "r_pasture")
                    : tx("Craft", "r_craft");
  // Surface the bonus city whenever it differs from the buy city, so the route
  // reads buy → craft → sell: butchers chase the +10% CITY_BUTCHER_SPEC city,
  // mill/cook rows the +15% CITY_CRAFT_SPEC one (Caerleon food; alchemist rows
  // have no bonus city). When buy == craft the single-city label still works and
  // just carries the bonus tag.
  const isButcherRow = chain.station === "butcher";
  const bonusTag = (pct) => ` <small style="color:#5e9e78">${pct}</small>`;
  const sellLeg = `${tx("Sell", "r_sell")}: ${sellPot.city}`;
  const craftCity = isButcherRow ? row.butcherCity : row.craftCity;
  const craftBonus = isButcherRow ? row.butcherBonus : row.craftBonus;
  let routeLabel;
  if (craftCity && craftCity !== buyMat.city) {
    const verb = isButcherRow ? tx("Butcher", "r_butcher") : stationVerb;
    routeLabel = `${tx("Buy", "r_buy")}: ${buyMat.city} → ${verb}: ${craftCity}${craftBonus ? bonusTag(craftBonus) : ""} → ${sellLeg}`;
  } else {
    const sameCityBonus = isButcherRow
      ? ((typeof getButcherRRR === "function")
          && CITY_BUTCHER_SPEC[buyMat.city]?.includes(chain.produces) ? "+10%" : null)
      : craftBonus;
    routeLabel = `${stationVerb}: ${buyMat.city}${sameCityBonus ? bonusTag(sameCityBonus) : ""} → ${sellLeg}`;
  }
  // The pasture's grown animal hangs under the feed as capital — it is what the
  // play costs to start, and the one figure NOT inside Total Input Cost.
  const matsHtml = renderChainBreakdown(chain, chain.output)
    + (row.pastureCapital && typeof renderPastureCapitalLine === "function"
        ? renderPastureCapitalLine(row.pastureCapital) : "");
  // Focus efficiency cells. Butchers turn focus into extra meat per
  // animal (returnproductnotresource); mill/cook turn focus into a
  // refund on the input. Both use the same +59% bonus from focus.
  const fCost = row.focusCost || 0;
  const batchesPer10k = fCost > 0 ? (typeof focusBarCrafts === "function" ? focusBarCrafts(fCost) : Math.floor(10000 / fCost)) : 0;
  // Why that figure — and, crucially, how many spec nodes it still assumes are
  // maxed. A butcher row charges per ANIMAL (craftingfocus × amountcrafted), so
  // it hands the explainer the same base getButcherFocusCost used.
  const focusItemId = row.item.sellAs || row.item.id;
  const focusOptions = {
    base: isButcherRow && typeof getBaseFocusCost === "function"
      ? getBaseFocusCost(focusItemId) * chain.output
      : undefined,
  };
  const focusTitle = (typeof focusSpecTitle === "function")
    ? focusSpecTitle(focusItemId, focusOptions)
    : "";
  // "*": the figure still leans on nodes nobody typed a level for.
  const focusMark = (typeof focusSpecMark === "function")
    ? focusSpecMark(focusItemId, focusOptions)
    : "";
  const focusMatsHtml = fCost > 0
    ? chain.inputs.map((inp) => {
        const name = (typeof ITEM_NAMES_MAP !== "undefined" && ITEM_NAMES_MAP[inp.matId])
          || (typeof getItemDisplayName === "function" && getItemDisplayName(inp.matId))
          || inp.matId;
        return `${(batchesPer10k * inp.count).toLocaleString()}x ${name}`;
      }).join("<br>")
      + `<br><small style="color:#9ca3af" title="${focusTitle}">${(typeof formatBarCrafts === "function" ? formatBarCrafts(batchesPer10k) : batchesPer10k.toLocaleString())}x ${stationVerb.toLowerCase()} @ ${formatFocusCost(fCost)}${focusMark} ${tx("focus ea", "r_focus_ea")}</small>`
    : "—";
  const ppfClass = (row.profitPerFocus || 0) > 0 ? "profit-low" : "profit-negative";
  const ppfTitle = fCost > 0
    ? tx("{added} added per batch ÷ {focus} focus — what the focus itself buys (RRR {rrr}% applied to {target}), not the batch's whole profit", "r_ppf_batch_tip")
        .replace("{added}", formatSilver(row.bestFocusPlay ? row.bestFocusPlay.profitDelta : 0))
        .replace("{focus}", formatFocusCost(fCost))
        .replace("{rrr}", (((row.chainRrr || 0)) * 100).toFixed(1))
        .replace("{target}", chain.station === "butcher" ? tx("output meat", "r_output_meat") : tx("input refund", "r_input_refund"))
    : chain.station === "pasture"
      ? tx("A produce cycle spends no focus — the animal eats, waits 22h and hands the byproduct over", "r_pasture_no_focus")
      : tx("Not focus-craftable per items.xml — base RRR still applied to inputs (no craftingfocus attribute on this item)", "r_not_focus_craftable_itemsxml");
  const ppfCell = (row.profitPerFocus || 0) > 0
    ? `<td class="silver-val ${ppfClass}" title="${ppfTitle}">${row.profitPerFocus.toFixed(1)}</td>`
    : `<td title="${ppfTitle}">—</td>`;
  // Profit for a whole 10k focus bar: per-BATCH profit × whole batches. The
  // batch quoted is the FOCUS-ON one (row.profitFocusOn) the figure multiplies;
  // the row's own profit tracks the Use Focus checkbox and can differ.
  const p10k = row.profitPer10kFocus || 0;
  const p10kBatchProfit = row.profitFocusOn != null
    ? row.profitFocusOn
    : (row.marginInfo.profit || 0) * (row.effectiveOutput || chain.output);
  const p10kCell = fCost > 0
    ? `<td class="silver-val ${p10k > 0 ? "profit-low" : "profit-negative"}" title="${tx("{profit} profit/batch (after mat costs) × {batches} {verb} ({focus} focus ea)", "r_p10k_batch_tip").replace("{profit}", formatSilver(p10kBatchProfit)).replace("{batches}", (typeof formatBarCrafts === "function" ? formatBarCrafts(batchesPer10k) : batchesPer10k.toLocaleString())).replace("{verb}", stationVerb.toLowerCase()).replace("{focus}", formatFocusCost(fCost))}">${formatSilver(p10k)}${(typeof gatheredPer10kSmallHtml === "function" ? gatheredPer10kSmallHtml(row.profitPer10kFocusGathered, row.profitFocusOnGathered) : "")}</td>`
    : `<td style="color:#6b7280;font-style:italic" title="${ppfTitle}">—</td>`;
  return `
<tr data-row-key="${rowKey}">
    ${addTdForKey("consumable-table", rowKey)}
    ${itemNameCell}
    <td class="cell-route">${routeLabel}${brecilienFeeBadge(row.brecilienFee)}</td>
    <td class="cell-mats">${matsHtml}</td>
    <td class="silver-val">${formatSilver(totalInputCost)}</td>
    ${priceTd(sellPot.price, item.id, sellPot.city)}
    ${profitTd(marginInfo, "consumable-table", rowIdx, sellPot.city)}
    ${pureProfitTd(marginInfo)}          ${p10kCell}
    <td class="cell-focus-mats">${focusMatsHtml}</td>
    ${ppfCell}
    <td class="cell-note">${focusPlayCell(row.bestFocusPlay, { unit: "/batch" })}</td>
</tr>
    `;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { renderConsumableChainRow };
}
