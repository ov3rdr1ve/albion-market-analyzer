// Split from js/render-consumables.js (800-line cap): the Consumables table row
// formatter. renderConsumableTable builds the rows and hands them to
// renderTableData with makeConsumableRowFormatter(marketData). Loads right
// after js/render-consumables.js; nothing here runs at load time.
function makeConsumableRowFormatter(marketData) {
  return (
    (row, rowIdx) => {
      const {
        item,
        isFlip,
        recipe,
        matBestPrices,
        craftCity,
        buyMat,
        sellPot,
        totalInputCost,
        marginInfo,
        rrr,
        focusCost,
        focusRrr,
        profitPerFocus,
        profitPer10kFocus,
        chainBonusProfit,
        chainBonusBreakdown,
        bestFocusPlay,
      } = row;
      const rowKey = getRowKey(row, "consumable-table");
      // Build the item-name cell: base rows that have enchant variants show an
      // expand caret to toggle their .1/.2/.3 rows; variant rows are indented so
      // the hierarchy reads clearly when expanded. Keyed on the sauce map (not
      // tier) so the T3 rare/alchemy potions are expandable too.
      const isVariant = !!item?.baseId;
      const isExpandableBase = !isVariant
        && item && consumableBaseHasEnchantVariants(item.id);
      const expandIcon = isExpandableBase
        ? `<span data-expand-craft="${item.id}" data-expand-table="consumable-table" style="cursor:pointer;margin-right:4px;color:#7ab8c4">${(typeof expandedCraftItemsFor === "function" ? expandedCraftItemsFor("consumable-table") : expandedCraftItems).has(item.id) ? "▼" : "▶"}</span>`
        : "";
      const indent = isVariant ? `style="padding-left:24px"` : "";
      const itemNameCell = item ? `<td class="cell-item" ${indent}>${expandIcon}${dispName(item.id, item.name)}</td>` : `<td class="cell-item">—</td>`;

      // No-data placeholder (margin === -1). Renders the row so the user
      // still sees the consumable in the table — important for variants of
      // expanded base rows that have no live market data yet. Every price on it
      // stays click-to-edit, which is the whole point of drawing it: this is the
      // state the user needs to type a price INTO. See
      // js/render-consumable-no-data-row.js.
      if (item && row.marginInfo && row.marginInfo.margin === -1) {
        return renderConsumableNoDataRow(row, rowKey, itemNameCell, marketData);
      }
      // Chain craft row (raw meat from grown animal, flour from wheat,
      // bread from flour, butter from milk). Renders the chain breakdown for
      // ONE batch (chain.output units) so users see concrete numbers — e.g.
      // "1x Grown Goat → 20 raw meat" instead of fractional per-unit math.
      // Breeding is tracked separately in the mounts table.
      if (row.isChainCraft) return renderConsumableChainRow(row, rowIdx, rowKey, itemNameCell);
      if (isFlip || !recipe) {
        // Simple flip row
        return `
      <tr data-row-key="${rowKey}">
          ${addTdForKey("consumable-table", rowKey)}
          ${itemNameCell}
          ${routeCityCell([
            { label: tx("Buy", "r_buy"), city: buyMat.city, itemId: item.id, side: "buy", price: buyMat.price },
            { label: tx("Sell", "r_sell"), city: sellPot.city, itemId: item.id, side: "sell", price: sellPot.price },
          ])}
          <td>—</td>
          ${aggregateCostTd(buyMat.price * (1 + SETUP_FEE), "silver-val")}
          ${priceTd(sellPot.price, item.id, sellPot.city)}
          ${profitTd(marginInfo, "consumable-table", rowIdx, sellPot.city)}
          ${pureProfitTd(marginInfo)}          <td>—</td>
          <td>—</td>
          <td>—</td>
          <td>—</td>
      </tr>
    `;
      }

      // Per-craft yield (amountcrafted). Ingredient amounts and the focus-mats
      // column are shown PER SINGLE UNIT so they line up with the per-unit input
      // cost / profit / sale price. A batch recipe (24 turnip → 10 salads) shows
      // 2.4x turnip per salad; a "(yields N/craft)" tag flags the batch.
      const recipeOutput = (item && typeof getRecipeOutput === "function")
        ? getRecipeOutput(item.id) : 1;

      // Multi-ingredient craft row; chain-sourced ingredients get an indented
      // sub-breakdown. Extracted to render-chain-breakdown.js (800-line cap).
      const matsHtml = renderConsumableIngredients({
        recipe, matBestPrices, rrr, recipeOutput, chainBonusBreakdown, focusCost,
        matAltChains: row.matAltChains, rowKey,
      });

      // A bar buys floor(10000 / focusCost) OUTPUT UNITS — items.xml charges
      // craftingfocus per unit and this row prices per unit. For a batch recipe
      // those units run as whole craft actions: units / amountcrafted.
      const craftUnitsPer10k = focusCost ? (typeof focusBarCrafts === "function" ? focusBarCrafts(focusCost) : Math.floor(10000 / focusCost)) : 0;
      const craftActionsPer10k = recipeOutput > 1
        ? Math.floor(craftUnitsPer10k / recipeOutput)
        : craftUnitsPer10k;
      const craftUnitsLabel = recipeOutput > 1
        ? `${(typeof formatBarCrafts === "function" ? formatBarCrafts(craftUnitsPer10k) : craftUnitsPer10k.toLocaleString())}x ${tx("units", "r_units")} (${craftActionsPer10k.toLocaleString()}x ${tx("crafts", "r_crafts")})`
        : `${(typeof formatBarCrafts === "function" ? formatBarCrafts(craftUnitsPer10k) : craftUnitsPer10k.toLocaleString())}x ${tx("crafts", "r_crafts")}`;
      const focusMatsHtml = focusCost
        ? recipe
            .map((m) => {
              const need = matsNeededFor10kFocus(focusCost, m.count / recipeOutput, true, focusRrr || rrr);
              const name = ITEM_NAMES_MAP[m.matId] || getItemDisplayName(m.matId) || m.matId;
              return `${need.toLocaleString()}x ${name}`;
            })
            .join("<br>") +
          `<br><small style="color:#9ca3af" title="${typeof focusSpecTitle === "function" ? focusSpecTitle(item.id) : ""}">${craftUnitsLabel} @ ${formatFocusCost(focusCost)}${typeof focusSpecMark === "function" ? focusSpecMark(item.id) : ""} ${tx("focus ea", "r_focus_ea")}</small>`
        : "—";
      const ppfClass = profitPerFocus > 0 ? "profit-low" : "profit-negative";
      // Hover-text mirrors the chain-craft row: explain the formula when focus
      // applies, or flag the item as not focus-craftable when items.xml omits
      // the craftingfocus attribute (fish sauce, fish chops). Without this,
      // the "—" cell gave no clue why focus calc was skipped.
      // Chain savings from ingredients the game won't let you focus are real
      // silver but not focus-bought, so they are named alongside the figure and
      // deliberately kept out of it.
      const chainBonusSuffix = (chainBonusProfit > 0)
        ? ` Separately, ${formatSilver(chainBonusProfit)}/craft is yours for chain-crafting the ingredients that take no focus (${(chainBonusBreakdown || []).map(b => (typeof ITEM_NAMES_MAP !== "undefined" && ITEM_NAMES_MAP[b.matId]) || b.matId).join(", ")}) — no focus buys it, so it is not counted here.`
        : "";
      const ppfTitle = focusCost > 0
        ? `${formatSilver(bestFocusPlay ? bestFocusPlay.profitDelta : 0)} added per craft ÷ ${formatFocusCost(focusCost)} focus — what the focus itself buys (RRR ${(((focusRrr || rrr) || 0) * 100).toFixed(1)}% vs base on the returnable ingredients), not the craft's whole profit.${chainBonusSuffix}`
        : "Not focus-craftable per items.xml — base RRR still applied to inputs (no craftingfocus attribute on this item)";

      // Profit for a whole 10k focus bar spent cooking/brewing this consumable.
      // Quotes the FOCUS-ON profit the figure multiplies (Pure Profit follows
      // the checkbox and can differ). Batch rows are priced per unit, so the
      // tooltip quotes units — "crafts" would claim 5× the real actions.
      const p10k = profitPer10kFocus || 0;
      const p10kOperand = formatSilver(row.profitFocusOn != null ? row.profitFocusOn : (marginInfo.profit || 0));
      const p10kTip = recipeOutput > 1
        ? tx("{profit} profit/unit (after mat costs) × {units} units ({focus} focus ea)", "r_p10k_unit_tip")
            .replace("{profit}", p10kOperand)
            .replace("{units}", (typeof formatBarCrafts === "function" ? formatBarCrafts(craftUnitsPer10k) : craftUnitsPer10k.toLocaleString()))
            .replace("{focus}", formatFocusCost(focusCost))
        : tx("{profit} profit/craft (after mat costs) × {crafts} crafts ({focus} focus ea)", "r_p10k_craft_tip")
            .replace("{profit}", p10kOperand)
            .replace("{crafts}", (typeof formatBarCrafts === "function" ? formatBarCrafts(craftUnitsPer10k) : craftUnitsPer10k.toLocaleString()))
            .replace("{focus}", formatFocusCost(focusCost));
      const p10kCell = focusCost > 0
        ? `<td class="silver-val ${p10k > 0 ? "profit-low" : "profit-negative"}" title="${p10kTip}">${formatSilver(p10k)}${(typeof gatheredPer10kSmallHtml === "function" ? gatheredPer10kSmallHtml(row.profitPer10kFocusGathered, row.profitFocusOnGathered) : "")}</td>`
        : `<td style="color:#6b7280;font-style:italic" title="${ppfTitle}">—</td>`;

      // Surface when the picked craft city has no matching spec bonus for the
      // consumable's craft type. Happens in BMR-off mode for food: Caerleon is
      // the only food spec city and is excluded from the royal pool, so the
      // 5 royals + Brecilien tie at base 18% RRR — the picker hands the slot
      // to the first non-Caerleon city in CITIES order (Lymhurst). Without
      // this tag the user can't tell the displayed city is arbitrary.
      const craftTypeForRow = (typeof getConsumableCraftType === "function")
        ? getConsumableCraftType(item.id) : null;
      const cityHasSpec = craftTypeForRow
        && (typeof CITY_CRAFT_SPEC !== "undefined")
        && CITY_CRAFT_SPEC[craftCity]
        && CITY_CRAFT_SPEC[craftCity].includes(craftTypeForRow);
      const noSpecTag = (craftTypeForRow && !cityHasSpec)
        ? ` <small style="color:#fbbf24" title="${tx("No {type} bonus in {city} — only base 18% RRR. Caerleon (food) / Brecilien (potion) are the spec cities.", "r_no_spec_consumable_tip").replace("{type}", craftTypeForRow).replace("{city}", craftCity)}">${tx("(no spec)", "r_no_spec")}</small>`
        : "";
      // Flag batch recipes so the fractional per-unit ingredient amounts read
      // clearly (one craft yields N units; costs/profit are shown per unit).
      const yieldTag = recipeOutput > 1
        ? ` <small style="color:#9ca3af" title="${tx("One craft yields {n} units; ingredient amounts, cost, and profit are shown per single unit.", "r_yield_per_craft_tip").replace("{n}", recipeOutput)}">${tx("(yields {n}/craft)", "r_yields_per_craft").replace("{n}", recipeOutput)}</small>`
        : "";

      return `
      <tr data-row-key="${rowKey}">
          ${addTdForKey("consumable-table", rowKey)}
          ${itemNameCell}
          ${routeCityCell([
            { label: tx("Craft", "r_craft"), city: craftCity, suffix: noSpecTag },
            { label: tx("Sell", "r_sell"), city: sellPot.city, itemId: item.id, side: "sell", price: sellPot.price },
          ], { trailing: `${yieldTag}${brecilienFeeBadge(row.brecilienFee)}` })}
          <td class="cell-mats">${matsHtml}</td>
          <td class="silver-val">${formatSilver(totalInputCost)}</td>
          ${priceTd(sellPot.price, item.id, sellPot.city)}
          ${profitTd(marginInfo, "consumable-table", rowIdx, sellPot.city)}
          ${pureProfitTd(marginInfo)}          ${p10kCell}
          <td class="cell-focus-mats">${focusMatsHtml}</td>
          <td class="silver-val ${ppfClass}" title="${ppfTitle}">${profitPerFocus ? profitPerFocus.toFixed(1) : "—"}</td>
          <td class="cell-note">${focusPlayCell(bestFocusPlay)}</td>
      </tr>${typeof consumableAltRoutesRow === "function" ? consumableAltRoutesRow(row, rowKey) : ""}
    `;
    }
  );
}
