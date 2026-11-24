// Consumables table — the FLIP row builder.
//
// The leaf ingredients that are genuinely bought and resold rather than made:
// crops, herbs, raw fish, Avalonian Energy. Anything the player PRODUCES has a
// recipe (craft) or a CHAIN_RECIPES entry (butcher / mill / cook / alchemist /
// pasture) and never reaches this branch — a produced item shows its production
// route even when buying it off the market would be cheaper.
//
// Split out of js/render-consumables.js to keep both files inside the 800-line
// cap. Pure row-shape logic: every helper it calls (findBestRoute,
// calculateFlipMargin, getMinVol, …) is the same shared global as before.
//
// Returns the array of rows for one CONSUMABLES entry — one row with routes on,
// a royal + Caerleon pair with routes off, same contract as the other branches.
function buildConsumableFlipRows(item, marketData) {
  const toFlipRow = (route, section) => {
    if (!route.buyCity || !route.sellCity) {
      return section
        ? { item, marginInfo: { margin: -1 }, section }
        : { item, marginInfo: { margin: -1 } };
    }
    const marginInfo = calculateFlipMargin(
      route.buyPrice,
      route.sellPrice,
      route.travelCost || 0,
    );
    const vol = getMinVol(marketData, item.id, route.buyCity, route.sellCity);
    const row = {
      item,
      isFlip: true,
      buyMat: { city: route.buyCity, price: route.buyPrice },
      sellPot: { city: route.sellCity, price: route.sellPrice },
      matBestPrices: null,
      totalInputCost: route.buyPrice * (1 + SETUP_FEE),
      marginInfo,
      dailyVol: vol,
      rrr: 0,
      hasOverride: !!(
        getOverridePrice(item.id, route.buyCity) ||
        getOverridePrice(item.id, route.sellCity)
      ),
    };
    if (section) row.section = section;
    return row;
  };

  // The table's City picks narrow each leg (js/consumable-city-pick.js). A
  // section that cannot honour one searches nothing, and findBestRoute then
  // names no city — which toFlipRow already renders as the no-data row, so the
  // item stays on the table with editable price cells instead of vanishing.
  const buyPool = (pool) => consumablePickedPool("buy", pool);
  const sellPool = (pool) => consumablePickedPool("sell", pool);
  if (isBlackRedZoneEnabled()) {
    return [toFlipRow(
      findBestRoute(marketData, item.id, buyPool(CITIES), sellPool(SELL_CITIES)),
      null,
    )];
  }
  // Separate routes when the checkbox is OFF.
  return [
    toFlipRow(
      findBestRoute(marketData, item.id, buyPool(ROYAL_CITIES), sellPool(ROYAL_CITIES)),
      "royal",
    ),
    toFlipRow(
      findBestRoute(marketData, item.id,
        buyPool(["Caerleon"]), sellPool(["Caerleon", "Black Market"])),
      "caerleon",
    ),
  ];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildConsumableFlipRows };
}
