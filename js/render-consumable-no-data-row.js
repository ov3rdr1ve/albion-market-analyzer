// Consumables table — the NO-DATA row renderer.
//
// A consumable collapses to this row when one of its inputs, or its own sale,
// has no price anywhere the route can reach. That used to print eight dead "—"
// cells: the Route column went to plain text, the ingredients vanished, and the
// Sell Price cell — the one control that could have fixed the row — was gone.
// The state a price cell exists FOR was the only state without one.
//
// So this mirrors the Crafting table's no-data branch (js/render-crafting.js),
// which is the app-wide convention: price every input that CAN be priced at its
// real source city, isolate the genuine blocker as a clickable "no data", and
// keep the sell cell editable at price 0. Only the computed columns — margin,
// profit, focus — stay dim, because there is nothing there to override.
//
// Split out of js/render-consumables.js to keep both files inside the 800-line
// cap, same as js/render-consumable-chain-row.js. Every helper it calls
// (priceTd, matPriceSpan, routeCityCell, bestMatBuySource, aggregateCostTd, …)
// is the same shared global the rest of the table uses.

/**
 * Where a collapsed row would have been crafted.
 *
 * The placeholder objects are built OUTSIDE the `CRAFT_CITIES.forEach` loop in
 * render-consumables.js, so the loop's craftCity is long gone by the time we get
 * here. Rebuild it from the row's section: with Black/Red-Zone routes off, the
 * royal arm must never land in Caerleon and the Caerleon arm never anywhere
 * else. Within what the section allows, prefer the craft type's spec city —
 * that is where the user would actually cook or brew this.
 */
function consumableNoDataCraftCity(row) {
  const cities = (typeof CRAFT_CITIES !== "undefined" && Array.isArray(CRAFT_CITIES))
    ? CRAFT_CITIES : [];
  if (row.section === "caerleon") return "Caerleon";
  // Past the early return, Caerleon is never the answer: the royal arm is not
  // allowed there, and with routes ON a Caerleon craft city would zone-lock
  // sourcing to Caerleon alone.
  const allowed = (c) => !!c && cities.indexOf(c) >= 0 && c !== "Caerleon";
  const craftType = (typeof getConsumableCraftType === "function" && row.item)
    ? getConsumableCraftType(row.item.id)
    : null;
  // Brecilien specializes in Potion; Caerleon in Food — but Caerleon is NOT
  // preferred here even for food, because sourcing is zone-locked to where the
  // craft happens (js/utils.js isValidSourceCity). A Caerleon craft city would
  // hide every royal listing this row could otherwise have shown a price for,
  // which is the opposite of what a no-data row is for. The Caerleon arm still
  // gets Caerleon: that is the early return above.
  const spec = craftType === "potion" ? "Brecilien" : null;
  if (allowed(spec)) return spec;
  return cities.find(allowed) || cities[0] || "";
}

/**
 * The city the row offers to sell in. Same resolution the Crafting table's
 * placeholder uses: a sell-city pin the craft city can legitimately reach wins,
 * then the single city an active Sell City pick leaves, then the craft city —
 * so an unpriced row offers to edit the price where the rest of the filtered
 * table is selling.
 */
function consumableNoDataSellCity(row, craftCity) {
  const sellId = (row.item && (row.item.sellAs || row.item.id)) || "";
  const forced = typeof getCityForce === "function" ? getCityForce(sellId, "sell") : null;
  const crosses = typeof isInvalidCrossRoute === "function"
    ? isInvalidCrossRoute(craftCity, forced)
    : false;
  const reachable = forced && !crosses ? forced : null;
  const pool = (typeof SELL_CITIES !== "undefined" && Array.isArray(SELL_CITIES))
    ? SELL_CITIES : [];
  const ndCities = (typeof effectiveSellCities === "function")
    ? effectiveSellCities("consumable-table", craftCity, reachable, pool)
    : (reachable ? [reachable] : pool);
  if (ndCities.length === 1) return ndCities[0];
  if (reachable) return reachable;
  return craftCity;
}

/** One ingredient line: count, name, its best real price, and where from. */
function consumableNoDataMatLine(mat, craftCity, marketData) {
  const name = (typeof getItemDisplayName === "function")
    ? getItemDisplayName(mat.matId)
    : mat.matId;
  const src = (typeof bestMatBuySource === "function")
    ? bestMatBuySource(mat.matId, craftCity, marketData)
    : { price: 0, city: null };
  // Priced elsewhere → show the real price + source. The lone unpriced blocker
  // falls back to the craft city as a clickable "no data", which is the cell the
  // user came here to fill in.
  const city = src.city
    || (typeof getCityForce === "function" ? getCityForce(mat.matId, "buy") : null)
    || craftCity;
  const fromTag = src.city
    ? ' <small style="color:#9ca3af">(' + _cndTx("from", "r_from_lower") + " " + src.city + ")</small>"
    : "";
  const span = (typeof matPriceSpan === "function")
    ? matPriceSpan(mat.matId, city, src.price)
    : "@ " + src.price;
  return mat.count + "x " + name + " " + span + fromTag;
}

function _cndTx(en, slug) {
  return typeof tx === "function" ? tx(en, slug) : en;
}

/**
 * The whole row — exactly 12 cells, matching the Consumables <thead>:
 * add · name · route · ingredients · input cost · sell price · margin ·
 * pure profit · profit/10k · mats to buy · silver/focus · best focus.
 *
 * @param {object} row      the `{ item, marginInfo: { margin: -1 }, section?, mats? }`
 *                          placeholder. `mats` is the recipe (or the chain's
 *                          inputs) when the item is produced; absent on the
 *                          leaves nobody makes (crops, herbs, raw fish).
 * @param {string} rowKey
 * @param {string} itemNameCell  already-built name cell (caret + indent)
 * @param {object} marketData
 * @returns {string} HTML, or "" when there is no item to name.
 */
function renderConsumableNoDataRow(row, rowKey, itemNameCell, marketData) {
  const item = row && row.item;
  if (!item) return "";

  const craftCity = consumableNoDataCraftCity(row);
  const sellCity = consumableNoDataSellCity(row, craftCity);
  const sellId = item.sellAs || item.id;
  const sellPrice = (typeof getSellPrice === "function")
    ? getSellPrice(marketData && marketData[sellId], sellCity, null, sellId)
    : 0;

  const mats = Array.isArray(row.mats) ? row.mats : null;
  const isProduced = !!(mats && mats.length);

  // A produced consumable names the station city (a place, not a price) and the
  // sell city (a price). A leaf is bought and resold, so BOTH its legs price the
  // item itself — the same two editable legs its flip row renders.
  const legs = isProduced
    ? [
        { label: _cndTx("Craft", "r_craft"), city: craftCity },
        { label: _cndTx("Sell", "r_sell"), city: sellCity, itemId: sellId, side: "sell", price: sellPrice },
      ]
    : [
        { label: _cndTx("Buy", "r_buy"), city: craftCity, itemId: item.id, side: "buy", price: 0 },
        { label: _cndTx("Sell", "r_sell"), city: sellCity, itemId: sellId, side: "sell", price: sellPrice },
      ];
  const noteHtml = ' <small style="color:#6b7280;font-style:italic">('
    + _cndTx("no market data", "r_no_market_data") + ")</small>";
  const routeCell = (typeof routeCityCell === "function")
    ? routeCityCell(legs, { trailing: noteHtml })
    : '<td class="cell-route">' + _cndTx("no market data", "r_no_market_data") + "</td>";

  const matsHtml = isProduced
    ? mats.map((m) => consumableNoDataMatLine(m, craftCity, marketData)).join("<br>")
    : "—";

  // The input cost is a SUM of prices that do not all exist yet, so it is
  // read-only like every other total in the app (js/app.js aggregateCostTd).
  const costCell = (typeof aggregateCostTd === "function")
    ? aggregateCostTd(0, "silver-val")
    : '<td class="silver-val">—</td>';
  const sellCell = (typeof priceTd === "function")
    ? priceTd(sellPrice, sellId, sellCity)
    : '<td class="cell-num">—</td>';

  // Margin, Pure Profit, Profit/10k, Mats to Buy, Silver/Focus, Best Focus.
  const dim = '<td style="color:#6b7280;font-style:italic">—</td>';
  const addCell = (typeof addTdForKey === "function")
    ? addTdForKey("consumable-table", rowKey)
    : "<td></td>";

  return "\n      <tr data-row-key=\"" + rowKey + "\">\n"
    + "          " + addCell + "\n"
    + "          " + itemNameCell + "\n"
    + "          " + routeCell + "\n"
    + '          <td class="cell-mats">' + matsHtml + "</td>\n"
    + "          " + costCell + "\n"
    + "          " + sellCell + "\n"
    + "          " + dim + dim + dim + dim + dim + dim + "\n"
    + "      </tr>";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    renderConsumableNoDataRow,
    consumableNoDataCraftCity,
    consumableNoDataSellCity,
  };
}
