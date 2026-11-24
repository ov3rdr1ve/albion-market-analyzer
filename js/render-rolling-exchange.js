/**
 * Markup for the Energy Manipulator exchange section of the Artifact Rolling
 * table (rows come from js/rolling-exchange.js; this file only draws them).
 *
 * The section reuses the table's eight columns. Where a roll column has a
 * meaning for a deterministic exchange it keeps it:
 *   Fragment — Buy     the cheapest city for the fragment, price age + volume,
 *                      click-to-set (same cell as a roll row's, no transmute path)
 *   Roll Cost          50 × fragment price + the buy-order setup fee
 *   Artifact Sell      the BEST pick's sale price, click-to-set
 *   Margin % / Profit  (net sale − cost) ÷ cost, and net sale − cost: a
 *                      CERTAIN payout, because the pick is yours to make
 *   Sell               the city the best pick sells in, and its value per fragment
 * Roll chance, salvage, roll EV and the strategy badge have no counterpart, so
 * they simply do not appear. The row and the group headers carry the same
 * data-header-cat / data-header-roll / data-roll-key hooks as the roll groups,
 * so folding, the tier filter and the search box treat them alike.
 */

const ROLLING_EXCHANGE_CAT_COLOR = "#6b4e82";
// All ten exchange rows live under ONE roll group; the fragment tier and
// family are printed on each row instead of in a per-tier header.
const ROLLING_EXCHANGE_GROUP = "Energy Manipulator";

/** Fragment name as the table prints it ("Crystal Shard"), localised. */
function rollingExchangeLabelHtml(label) {
  return typeof txRollLabel === "function" ? txRollLabel(label) : label;
}

/**
 * The category and tier/family header rows an exchange row needs, given the
 * headers the last painted row left open. Returns { html, cat, group }.
 */
function rollingExchangeHeadersHtml(row, lastCat, lastGroup) {
  const rollGroup = ROLLING_EXCHANGE_GROUP;
  let html = "";
  let cat = lastCat;
  let group = lastGroup;
  if (row.cat !== lastCat) {
    cat = row.cat;
    group = null;
    html += `<tr data-header-cat="${row.cat}" style="background:${ROLLING_EXCHANGE_CAT_COLOR};color:rgba(255,255,255,0.85);font-weight:700;cursor:pointer;user-select:none">
        <td colspan="8" style="padding:9px 12px;font-size:0.95rem;letter-spacing:0.06em" title="${tx("Hand 50 fragments to the Energy Manipulator, take the artifact you pick. Deterministic: no meld, no reroll, no salvage; fragments not refunded.", "r_ex_section_tip")}">◆ ${tx("Energy Manipulator exchange (pick, not a roll)", "r_ex_section")}<span class="cind"> ▼</span></td>
      </tr>`;
  }
  if (rollGroup !== group) {
    group = rollGroup;
    html += `<tr data-header-roll="${rollGroup}" data-roll-cat="${row.cat}" style="background:#1c2230;color:#6e90a8;font-weight:600;cursor:pointer;user-select:none">
        <td colspan="8" style="padding:5px 10px 5px 22px;font-size:0.82rem;letter-spacing:0.04em" title="${row.rollCost} ${tx("frags / exchange", "r_ex_frags_per_exchange")}">— ${tx("Energy Manipulator", "energy_manipulator")} —<small style="color:#8b98a8"> (${row.rollCost} ${tx("frags / exchange", "r_ex_frags_per_exchange")})</small><span class="cind"> ▼</span></td>
      </tr>`;
  }
  return { html, cat, group };
}

// The hover list of every pick, best first, net of tax, then the unpriced ones.
function rollingExchangePickTip(row) {
  const lines = row.picks.map((p) => `${p.name} — ${formatSilver(Math.round(p.net))} (${formatSilver(p.price)} @ ${p.city})`);
  if (row.unpricedPicks.length > 0) {
    lines.push(`${tx("No price", "r_ex_unpriced")}: ${row.unpricedPicks.map((p) => p.name).join(", ")}`);
  }
  return `${tx("Net of tax per pick, best first", "r_ex_pick_list")}&#10;${lines.join("&#10;")}`;
}

function rollingExchangeFragmentCell(row) {
  const { fragmentId, fragBuyCity, fragBuyPrice, hasNoFragData, rollCost } = row;
  const city = fragBuyCity || CITIES[0];
  const typed = getOverridePrice(fragmentId, city);
  const style = typed ? "color:#9e8840;" : hasNoFragData ? "color:#6b7280;font-style:italic;" : "";
  const mark = typed ? ' <span style="color:#9e8840;font-size:0.75rem" title="Price overridden">⚡</span>' : "";
  let body;
  if (hasNoFragData) {
    body = `<span style="color:#6b7280;font-style:italic">${tx("no data — click to set", "r_no_data_click_to_set")}</span>`;
  } else {
    // Bought, so its date follows the buy field the Pricing Model reads.
    const entry = lastMarketData?.[fragmentId]?.[city];
    const dateStr = typeof priceDateFor === "function" ? priceDateFor(entry, "buy") : entry?.buy_date;
    const age = formatPriceAge(dateStr);
    const vol = entry?.volume_24h;
    const volStr = vol > 0 ? ` · ${vol.toLocaleString()} vol` : "";
    const ageBadge = age
      ? ` <small style="color:${age.color};font-size:0.7rem" title="Price last seen: ${dateStr}">${age.label}${volStr}</small>`
      : "";
    body = `${formatSilver(fragBuyPrice)}${mark}${ageBadge} <small style="color:#9ca3af">(${rollCost}× ${rollingExchangeLabelHtml(row.fragLabel)} — ${fragBuyCity})</small>`;
  }
  return `<td class="silver-val price-editable" data-item-id="${fragmentId}" data-city="${city}" data-raw-price="${fragBuyPrice}" data-city-list="buy" style="cursor:pointer;${style}" title="${tx("Click to override", "r_tip_click_override")}">${body}</td>`;
}

function rollingExchangeRowHtml(row, rowIdx) {
  const { tier, artName, artId, bestSellCity, bestSellPrice, sellRevenue, rollCostSilver,
    margin, hasNoFragData, hasNoArtData, rollCost } = row;
  const frag = rollingExchangeLabelHtml(row.fragLabel);
  const rowKey = getRowKey(row, "rolling-table");
  const sellCity = bestSellCity || (typeof SELL_CITIES !== "undefined" && SELL_CITIES[0]) || CITIES[0];
  const catBadge = `<span style="background:${ROLLING_EXCHANGE_CAT_COLOR};color:rgba(255,255,255,0.85);padding:1px 5px;border-radius:3px;font-size:0.72rem">${tx("Exchange", "roll_exchange")}</span>`;
  const picksChip = row.picks.length + row.unpricedPicks.length > 1
    ? ` <small style="color:#9ca3af;cursor:help" title="${rollingExchangePickTip(row)}">${tx("{n} picks", "r_ex_picks").replace("{n}", row.picks.length + row.unpricedPicks.length)}</small>`
    : "";
  const nameHtml = hasNoArtData
    ? `<small style="color:#6b7280;font-style:italic" title="${tx("No pick has a price yet. Set one on the sell price to rank the picks.", "r_ex_no_pick_priced")}">${artName}</small>`
    : `<small style="color:#e5e7eb">${artName}</small>`;
  const token = typeof artifactTokenPathLine === "function" ? artifactTokenPathLine(row.tokenSub, artName) : "";
  const costTip = tx("{count} × {frag} @ {price} + {fee}% buy-order setup fee = one exchange. The Energy Manipulator charges no silver and the fragments are not refunded.", "r_ex_tip_cost")
    .replace("{count}", rollCost).replace("{frag}", frag).replace("{price}", formatSilver(row.fragBuyPrice))
    .replace("{fee}", (SETUP_FEE * 100).toFixed(1));
  const priced = !hasNoFragData && !hasNoArtData;
  const profitTip = tx("You PICK this artifact: a certain payout, not an expected value. Net sale {rev} − exchange cost {cost}.", "r_ex_tip_profit")
    .replace("{rev}", formatSilver(Math.round(sellRevenue))).replace("{cost}", formatSilver(Math.round(rollCostSilver)));
  const valueTip = tx("Value per fragment: the best pick's net sale ÷ {count}. Compare it with what one fragment sells for on its own.", "r_ex_tip_value").replace("{count}", rollCost);
  const lastCell = hasNoArtData
    ? ""
    : `<small style="color:#9ca3af">→ ${bestSellCity}</small><br><small style="color:#9ca3af;cursor:help" title="${valueTip}">${formatSilver(Math.round(row.valuePerFragment))} /frag</small>`;
  return `
    <tr data-cat="${row.cat}" data-roll-key="${row.cat}:${ROLLING_EXCHANGE_GROUP}" data-row-key="${rowKey}" data-filter-tier="${tier}">
      ${addTdForKey("rolling-table", rowKey)}
      <td class="cell-item">${catBadge} ${nameHtml}${picksChip}${token} <small style="color:#8b98a8">T${tier} ${frag}</small></td>
      ${rollingExchangeFragmentCell(row)}
      <td class="silver-val" title="${costTip}">${hasNoFragData ? "—" : formatSilver(rollCostSilver)}</td>
      ${priceTd(bestSellPrice, artId, sellCity)}
      ${priced ? profitTd({ margin }, "rolling-table", rowIdx, bestSellCity) : `<td>—</td>`}
      ${priced
        ? `<td class="silver-val ${getProfitClass(margin)}" title="${profitTip}">${formatSilver(sellRevenue - rollCostSilver)}</td>`
        : `<td>—</td>`}
      <td>${lastCell}</td>
    </tr>`;
}
