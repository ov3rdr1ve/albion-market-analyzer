function buildFlipRowData(item, route, marketData, section, weightOverride) {
  const tier = item.tier || getTierFromId(item.id);
  if (!route.buyCity || !route.sellCity) {
    // No priced pair — under a Buy/Sell City pick this is the honest answer for
    // an item that city has no book for, so the row stays and says "no data"
    // rather than silently leaving the board. `noData` is what the profit cell
    // reads to print an em dash instead of the -1 sentinel.
    return {
      item, tier,
      buy: { city: '', price: 0 },
      sell: { city: '', price: 0 },
      marginInfo: { margin: -1 },
      noData: true,
      quality: 1,
      priceId: item.id,
      byQuality: route.byQuality || [],
      dailyVol: 0,
      oxLoad: { profitPerLoad: 0 },
      section,
      // A revealed .1-.4 row stays on the board unpriced (js/sorting.js reads
      // this flag) — it was just asked for, so "no data" is the honest answer
      // rather than a row that silently never appears.
      enchantVariant: item.enchantVariant || 0,
      baseId: item.baseId || item.id,
    };
  }
  const marginInfo = calculateFlipMargin(route.buyPrice, route.sellPrice, route.travelCost || 0);
  // Ox load needs the REAL per-unit weight. getItemWeight (travel-cost.js) reads
  // the extracted items.xml table + the manual overrides, and falls back to the
  // very same 0.5*1.8^tier gear estimate for ids it doesn't know — so it is a
  // strict improvement over getGearWeightKg, which mis-sized every non-gear row
  // (artifact mats, resources, and the untiered tokens whose real weight is
  // 0.01 kg but which the tier formula priced at kilograms).
  const weight =
    weightOverride ||
    (typeof getItemWeight === "function" ? getItemWeight(item.id) : getGearWeightKg(tier));
  const oxLoad = calculateOxLoad(marginInfo.profit, weight);
  // Volume, overrides and prices all live under the id the winning pair was
  // priced from: the plain item id at Normal, `ITEM#Q2` above it. Reading the
  // item id there would report the Normal book's liquidity beside a Good price.
  const quality = route.quality || 1;
  const priceId = route.viewId || item.id;
  const volData = quality === 1 ? marketData : { [priceId]: flipQualityData()?.[item.id]?.[quality] || {} };
  const vol = getMinVol(volData, priceId, route.buyCity, route.sellCity);
  return {
    item,
    buy: { city: route.buyCity, price: route.buyPrice },
    sell: { city: route.sellCity, price: route.sellPrice },
    tier,
    marginInfo,
    // The quality both legs were priced at, and the id those prices are filed
    // under. Quality 1 leaves every existing consumer reading exactly what it
    // read before.
    quality,
    priceId,
    // Every quality's pair, so a row can say what the ones it did not pick are
    // worth instead of discarding them silently.
    byQuality: route.byQuality || [],
    // A route over MAX_MARGIN_PERCENT is bad market data far more often than a
    // real 6x flip. It is FLAGGED, never dropped: the row keeps its ⚠ badge and
    // its clickable prices so the bad number can be corrected in place.
    suspectMargin: typeof isSuspectMargin === "function" && isSuspectMargin(marginInfo.margin),
    dailyVol: vol,
    oxLoad,
    section,
    // Side-specific (match the split buy/sell cells): a buy-order field at the
    // buy city OR a sell-order field at the sell city keeps the row visible.
    hasOverride: !!(
      getOverrideField(priceId, route.buyCity, "buy") !== null ||
      getOverrideField(priceId, route.sellCity, "sell") !== null
    ),
    enchantVariant: item.enchantVariant || 0,
    baseId: item.baseId || item.id,
  };
}

/**
 * Narrow one leg's city list to the table's Buy City / Sell City pick.
 *
 * The pickers used to filter RENDERED rows, which could only ever surface the
 * items whose best pair had already chosen that city — every other item left
 * the board entirely (reported: T5/T7 bags gone under a Black Market pick).
 * They now constrain the route SEARCH instead, so a pick re-prices the whole
 * table on the named leg. See js/table-sell-city.js.
 *
 * Returns [] when the pick is outside this section's list, which the caller
 * reads as "this section cannot honour the pick" and drops the row.
 */
function flipCityList(side, allCities) {
  return typeof effectiveFlipCities === "function"
    ? effectiveFlipCities("flipping-table", side, allCities)
    : allCities;
}

/** The app's quality-aware price map, when there is one (absent in Node tests). */
function flipQualityData() {
  return typeof lastQualityMarketData !== "undefined" ? lastQualityMarketData : null;
}

function buildFlipRoute(marketData, itemId, buyCities, sellCities) {
  // Each leg gates on its own Pricing Model toggle: a market ORDER needs a real
  // book to fill against, an instant fill does not, and Buy and Sell are chosen
  // independently.
  const minVol = getOrderType("buy") === "market" ? 25 : 0;
  const minSellVol = getOrderType("sell") === "market" ? 25 : 0;
  // Every allowed (buy, sell) PAIR is scored, not the two legs independently.
  // Resolving the buy city first and the sell city against it lost the Black
  // Market — a sale there requires a Caerleon buy, and that rule was only ever
  // checked after the buy city was already fixed. See js/flip-route.js.
  //
  // sideMode=true: buy reads the buy-order override field, sell reads the
  // sell-order field — independently. Flipping can route Buy and Sell to the
  // SAME city, where the generic active-pick override would collapse both cells
  // onto one number; side mode keeps them split.
  //
  // Across QUALITIES, because a gear book routinely holds nothing Normal at
  // all — the reported case: Caerleon's four Rootbound Staff asks were Good and
  // Outstanding, so the quality-1 flat map the table reads had nothing to show
  // and kept a two-day-old number. Both legs are always priced at the SAME
  // quality; see js/flip-route-quality.js.
  const opts = { minVolume: minVol, minSellVolume: minSellVol, sideMode: true };
  if (typeof findBestFlipPairAcrossQualities !== "function") {
    return findBestFlipPair(marketData, itemId, buyCities, sellCities, opts);
  }
  return findBestFlipPairAcrossQualities(
    marketData, flipQualityData(), itemId, buyCities, sellCities, opts,
  );
}

// Luxury (trade) goods flip: BUY cheap on the market, SELL to the fixed trader
// NPC at lux.npcPrice in lux.sellCity ("any" -> sell where bought). Buy-side
// city set honours the Black/Red Zone Routes toggle: routes off blocks
// royal<->Caerleon hauling, so a Caerleon-locked good may only be bought in
// Caerleon and a royal-locked good only in the royal cities. See data-luxury.js.
function luxuryBuyCities(sellCity) {
  if (isBlackRedZoneEnabled()) return CITIES; // cross-zone haul allowed
  if (sellCity === "any") return CITIES;       // sold locally, zone never blocks
  if (sellCity === "Caerleon") return ["Caerleon"];
  return ROYAL_CITIES;                          // royal-locked good
}

function buildLuxuryFlipRoute(marketData, lux) {
  // Buy side only — the sell leg is a fixed trader NPC, not an order book, so
  // there is no sell-side liquidity question to gate.
  const minVol = getOrderType("buy") === "market" ? 25 : 0;
  // The buy leg is a real market, so the Buy City pick narrows it like any
  // other row. The SELL leg is a fixed trader NPC, not a market: a Sell City
  // pick can only agree with that city or rule the row out (handled by the
  // caller, which drops the row rather than quoting the wrong trader).
  let buyCities = flipCityList("buy", luxuryBuyCities(lux.sellCity));
  // An "any" good is sold in the city it was bought in, so a Sell City pick
  // lands on the buy leg — the two are the same city on these rows.
  if (lux.sellCity === "any") buyCities = flipCityList("sell", buyCities);
  const buy = buyCities.length
    ? findBestBuyCity(marketData, lux.id, buyCities, minVol, undefined, true)
    : { city: "", price: 0 };
  const sellCity = lux.sellCity === "any" ? (buy.city || "") : lux.sellCity;
  return {
    buyCity: buy.city,
    buyPrice: buy.price,
    sellCity,
    sellPrice: buy.city ? lux.npcPrice : 0,
    travelCost: 0,
  };
}

/**
 * Does a Sell City pick allow this luxury row at all? A "any" good sells where
 * it was bought, so the pick constrains it through the buy leg instead.
 */
function luxuryPassesSellPick(lux) {
  const pick = typeof getTableSellCity === "function" ? getTableSellCity("flipping-table") : null;
  if (!pick || lux.sellCity === "any") return true;
  return lux.sellCity === pick;
}

/**
 * The Margin % cell, which has two things the generic profitTd cannot say:
 *
 *   • a row with no priced pair (an item the picked city has no book for) reads
 *     as an em dash, not the -1.00% the no-route sentinel would otherwise print,
 *   • an over-MAX_MARGIN_PERCENT route wears the ⚠ badge. It is flagged, never
 *     dropped — the prices are still clickable, which is the only way to correct
 *     the stale listing behind it.
 *
 * The data-profit-cell attributes are kept verbatim: they are what makes the
 * cell a click-to-change-sell-city target (js/app.js).
 */
function flipProfitTd(row, rowIdx) {
  const attrs =
    `data-profit-cell="1" data-table-id="flipping-table" data-row-idx="${rowIdx}"` +
    ` data-sell-city="${(row.sell && row.sell.city) || ""}"`;
  const tip = tx("Click to change sell city", "r_tip_change_sell_city");
  if (row.noData) {
    return `<td class="profit-cell-clickable" ${attrs} style="color:#6b7280;font-style:italic" title="${tip}">—</td>`;
  }
  const badge = typeof suspectMarginBadge === "function" ? suspectMarginBadge(row) : "";
  return `<td class="${getProfitClass(row.marginInfo.margin)} profit-cell-clickable" ${attrs} title="${tip}">${badge}${row.marginInfo.margin.toFixed(2)}%</td>`;
}

/**
 * Every row one catalog item contributes: one for a luxury good, one when the
 * black/red zone haul is on, and the royal + Caerleon pair when it is off.
 *
 * A section whose city list cannot honour an active Buy/Sell City pick yields
 * NO row for that section — the royal section can never sell at the Black
 * Market, and inventing a row that ignores the pick reads as the picker being
 * broken. Every other row is built, priced against the pick, and left on the
 * board even when that leg has no book (buildFlipRowData's `noData` row).
 */
function buildFlipRowsForItem(item, marketData) {
  const lux = typeof getLuxuryFlipInfo === "function" ? getLuxuryFlipInfo(item.id) : null;
  if (lux) {
    if (!luxuryPassesSellPick(lux)) return [];
    const route = buildLuxuryFlipRoute(marketData, lux);
    return [buildFlipRowData(lux, route, marketData, undefined, lux.weight)];
  }
  if (isBlackRedZoneEnabled()) {
    const buys = flipCityList("buy", CITIES);
    const sells = flipCityList("sell", SELL_CITIES);
    if (!buys.length || !sells.length) return [];
    return [buildFlipRowData(item, buildFlipRoute(marketData, item.id, buys, sells), marketData, undefined)];
  }
  const rows = [];
  const royalBuys = flipCityList("buy", ROYAL_CITIES);
  const royalSells = flipCityList("sell", ROYAL_CITIES);
  if (royalBuys.length && royalSells.length) {
    rows.push(buildFlipRowData(item, buildFlipRoute(marketData, item.id, royalBuys, royalSells), marketData, "royal"));
  }
  const caeBuys = flipCityList("buy", ["Caerleon"]);
  const caeSells = flipCityList("sell", ["Caerleon", "Black Market"]);
  if (caeBuys.length && caeSells.length) {
    rows.push(buildFlipRowData(item, buildFlipRoute(marketData, item.id, caeBuys, caeSells), marketData, "caerleon"));
  }
  return rows;
}

/**
 * First-column name cell, with the Crafting-table expand affordance: an
 * enchantable base gets a >/v toggle (data-expand-table="flipping-table", so
 * app.js's shared handler drives it), an enchant variant indents under it.
 */
function flipNameTd(item, row) {
  const isVariant = !!item.enchantVariant;
  const hasVariants = !isVariant
    && typeof hasEnchantVariants === "function" && hasEnchantVariants(item.id);
  // Open when the user opened it OR when the auto-reveal pass did
  // (js/flip-auto-reveal.js) — the ▼ has to describe what the table is
  // showing, not only what was clicked.
  const open = typeof isFlipExpanded === "function"
    ? isFlipExpanded(item.id)
    : (typeof expandedCraftItemsFor === "function" && expandedCraftItemsFor("flipping-table").has(item.id));
  const icon = hasVariants
    ? `<span data-expand-craft="${item.id}" data-expand-table="flipping-table" style="cursor:pointer;margin-right:4px;color:#7ab8c4">${open ? "▼" : "▶"}</span>`
    : "";
  const style = isVariant ? ' style="padding-left:1.5em;color:#b0b8c4"' : "";
  return `<td class="cell-item"${style}>${icon}${dispName(item.id, item.name)}${resourceAliasSpan(item.id)}${flipQualityChip(row)}</td>`;
}

// Quality names for the chip's hover text. A deliberate local copy of
// QUALITY_NAMES (js/data-rerolling.js): that file is a top-level `const`, which
// lives in the shared LEXICAL scope rather than on globalThis, and it loads
// after this one — so `typeof QUALITY_NAMES` is a temporal-dead-zone throw, not
// the "undefined" the usual guard expects.
const FLIP_QUALITY_NAMES = {
  1: "Normal", 2: "Good", 3: "Outstanding", 4: "Excellent", 5: "Masterpiece",
};

/**
 * "Q2" beside the item name when the row is NOT a Normal-quality trade.
 *
 * A flip is a matched pair, so the row buys and sells one specific quality. It
 * is Normal on almost every row and the chip stays out of the way there; when
 * the only live book is a Good one, the chip is the difference between a price
 * the reader can act on and a price they will misread.
 *
 * The Black Market board reuses the chip for the same reason: its rows carry
 * the priced quality as `sellQuality` (js/joined-summary-sources.js), one field
 * further down the same pipe. A flipping row always has `quality`, so the
 * fallback changes nothing there.
 */
function flipQualityChip(row) {
  const q = row && (row.quality ?? row.sellQuality);
  if (!q || q === 1) return "";
  const name = FLIP_QUALITY_NAMES[q] || `Quality ${q}`;
  return ` <span class="qual-chip" style="color:#7ab8c4;font-size:0.7rem;border:1px solid #35506080;border-radius:3px;padding:0 3px" title="${tx(`Bought and sold at ${name} quality`, "r_tip_flip_quality")}">Q${q}</span>`;
}

/**
 * The per-quality ladder for one side's cell, when the item routes at more than
 * one quality. js/flip-quality-breakdown.js owns the markup; absent (Node
 * harnesses that compile this file alone) the cells render as they always did.
 */
function flipQualityNote(row, side) {
  return typeof flipQualityBreakdown === "function" ? flipQualityBreakdown(row, side) : "";
}

function renderFlippingTable(marketData) {
  const catalog = typeof getAllFlippingItems === "function"
    ? getAllFlippingItems()
    : [...FLIPPING_ITEMS, ...ARTIFACT_FLIP_ITEMS, ...RESOURCE_FLIP_ITEMS];
  // Which .1-.4 levels earn a row of their own. Decided with THIS builder, so an
  // auto-revealed row is the same row a hand-expanded one would be, and gated on
  // a cheap ask-and-bid read first so the route search runs on a sixth of the
  // ladder — see js/flip-auto-reveal.js.
  if (typeof setFlipAutoRevealed === "function" && typeof flipAutoRevealLevels === "function") {
    setFlipAutoRevealed(flipAutoRevealLevels(
      catalog, marketData, flipQualityData(),
      (variant) => buildFlipRowsForItem(variant, marketData),
    ));
  }
  // Enchant (.1-.4) rows are otherwise generated only for the bases the user
  // expanded or the Ench. picker selected — see js/flip-enchant-variants.js for
  // why they are not materialised up front.
  const allItems = typeof expandFlipItems === "function" ? expandFlipItems(catalog) : catalog;
  const rowData = allItems.flatMap((item) => buildFlipRowsForItem(item, marketData));

  renderTableData(
    "flipping-table",
    rowData,
    (row, rowIdx) => {
      const { item, tier, buy, sell, marginInfo, oxLoad } = row;
      const rowKey = getRowKey(row, "flipping-table");
      // Null at Normal, so every row that is not a quality trade renders and
      // keys its override exactly as it did before this existed.
      const q = row.quality && row.quality !== 1 ? row.quality : null;
      return `
      <tr data-row-key="${rowKey}">
          ${addTdForKey("flipping-table", rowKey)}
          ${flipNameTd(item, row)}
          <td>T${tier}</td>
          ${routeCityCell([
            { label: "Buy", city: buy.city, itemId: item.id, side: "buy", price: buy.price },
            { label: "Sell", city: sell.city, itemId: item.id, side: "sell", price: sell.price },
          ])}
          ${priceTd(buy.price, item.id, buy.city, "buy", "silver-val", false, q, true, flipQualityNote(row, "buy"))}
          ${priceTd(sell.price, item.id, sell.city, "sell", "silver-val", false, q, true, flipQualityNote(row, "sell"))}
          ${flipProfitTd(row, rowIdx)}
          ${pureProfitTd(marginInfo)}          <td class="silver-val">${formatSilver(oxLoad.profitPerLoad)}</td>
      </tr>
  `;
    },
  );
}

