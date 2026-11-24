/**
 * Skins Trading table — Hybrid price-board + flip for tradeable vanity skins.
 *
 * Why this doesn't reuse the Flipping helpers: vanity unlock tokens are
 * collectibles, not commodities. They trade only as SELL-ORDER listings (there
 * are essentially no buy orders) and at tiny volume (1–3/day). The
 * 25-unit volume gate that the Flipping table applies would hide every row
 * here, so that gate is skipped. The Pricing Model IS honoured: the buy leg is
 * priced with getBuyPrice (the ask under Instant, your own buy order under
 * Market Orders) and the sell leg with getSellPrice. Cheapest buy-side city is
 * the best buy, dearest sell-side city is the best sell — a pure spatial
 * arbitrage — with the full per-city board (sell side) beside it. Under Market
 * Orders most rows lose their buy leg: skin tokens rarely carry buy orders, so
 * the cell reads "no data" and can be hand-priced.
 *
 * Profit uses the same calculateFlipMargin (4% premium tax + 2.5% setup fee) as
 * Flipping, with no travel cost (a 1 kg skin is trivial to carry).
 */

// Cities a skin can be listed in (no Black Market — vanity isn't BM-traded).
const SKIN_TRADE_CITIES = [
  "Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien",
  "Smuggler's Den",
];

// Short column headers for the per-city board (full name in the <th> title).
const SKIN_CITY_ABBR = {
  Caerleon: "Caer", Lymhurst: "Lym", "Fort Sterling": "FtSt", Thetford: "Thet",
  Martlock: "Mart", Bridgewatch: "Bdg", Brecilien: "Brec", "Smuggler's Den": "Smug",
};

// Price of a skin in one city for one side of the trade. Overrides win (they
// are consulted inside getBuyPrice/getSellPrice); 0 when the field the Pricing
// Model asks for is missing, which is the "not available, set it yourself"
// state rather than a silent fallback to the other field.
function skinCityPrice(marketData, id, city, side) {
  const data = (marketData && marketData[id]) || null;
  const ov = getOverridePrice(id, city, side);
  if (ov !== null && ov !== undefined) return ov;
  if (!data) return 0;
  return side === "buy"
    ? getBuyPrice(data, city, null, id)
    : getSellPrice(data, city, null, id);
}

function buildSkinRow(item, marketData) {
  // prices[] is the per-city BOARD, and the board is the sell side: "what you
  // receive selling here" under whichever Pricing Model is active.
  const prices = {};
  let buyCity = null, buyPrice = 0, sellCity = null, sellPrice = 0;
  SKIN_TRADE_CITIES.forEach((c) => {
    const bp = skinCityPrice(marketData, item.id, c, "buy");
    const sp = skinCityPrice(marketData, item.id, c, "sell");
    prices[c] = sp;
    if (bp > 0 && (buyCity === null || bp < buyPrice)) { buyPrice = bp; buyCity = c; }
    if (sp > sellPrice) { sellPrice = sp; sellCity = c; }
  });

  const hasData = sellPrice > 0;
  const canFlip = !!buyCity && !!sellCity && sellCity !== buyCity;
  // marginInfo carries the sort key in .margin: a real flip %, 0 for a
  // single-city "no flip", or -1 for "no data" (sorts to the bottom and is
  // hidden until Show All).
  const marginInfo = canFlip
    ? calculateFlipMargin(buyPrice, sellPrice, 0)
    : { profit: 0, margin: hasData ? 0 : -1 };
  const dailyVol = sellCity
    ? ((marketData && marketData[item.id] && marketData[item.id][sellCity] && marketData[item.id][sellCity].volume_24h) || 0)
    : 0;

  return {
    item,
    slot: item.slot,
    prices,
    buy: { city: buyCity, price: buyPrice },
    sell: { city: sellCity, price: sellPrice },
    marginInfo,
    canFlip,
    dailyVol,
    hasData,
    hasOverride: SKIN_TRADE_CITIES.some((c) => getOverridePrice(item.id, c) !== null),
  };
}

function renderSkinsTradingTable(marketData) {
  const md = marketData || {};
  const rowData = SKIN_TRADE_ITEMS.map((item) => buildSkinRow(item, md));

  const emDash = '<td class="silver-val" style="color:#6b7280;font-style:italic">—</td>';

  renderTableData("skins-trading-table", rowData, (row, rowIdx) => {
    const { item, slot, buy, sell, marginInfo, prices, canFlip } = row;
    const rowKey = getRowKey(row, "skins-trading-table");
    // cell-board: the per-city price board is capped tighter than the Best
    // Buy/Sell cells (css/styles.css), and tagging it keeps that cap on the
    // board however many cities SKIN_TRADE_CITIES grows to.
    const boardCells = SKIN_TRADE_CITIES.map((c) => priceTd(prices[c], item.id, c, "sell", "silver-val cell-board")).join("");
    // Only a genuine cross-city flip shows %/profit; single-city & no-data rows
    // get an em dash so the column reads as "no flip", not "0".
    const profitCell = canFlip ? profitTd(marginInfo, "skins-trading-table", rowIdx, sell.city) : emDash;
    const pureCell = canFlip ? pureProfitTd(marginInfo) : emDash;
    return `
      <tr data-row-key="${rowKey}">
        ${addTdForKey("skins-trading-table", rowKey)}
        <td class="cell-item">${dispName(item.id, item.name)}</td>
        <td><small style="color:#9ca3af">${slot}</small></td>
        ${priceTd(buy.price, item.id, buy.city, "buy", "silver-val", true)}
        ${priceTd(sell.price, item.id, sell.city, "sell", "silver-val", true)}
        ${profitCell}
        ${pureCell}        ${boardCells}
      </tr>
  `;
  });
}
