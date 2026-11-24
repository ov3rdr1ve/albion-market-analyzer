/**
 * Table cell renderers shared by every table — price / profit / cost cells and
 * the row painter — plus the live market-data maps they read.
 *
 * Split out of js/app.js (800-line limit). Plain globals, loaded before it.
 */
/**
 * Store a table's rows and its row formatter, then paint it.
 *
 * The formatter OUTLIVES this render pass — a sort, a search, a price override
 * and a collapsed-table expand all replay it straight off tableState, outside
 * the withSpecScope() wrapper installSpecScopedRenderers (js/spec-settings-panel.js)
 * put around the renderer. So the ambient specialization scope is pinned to it
 * here, once, and re-entered on every later call.
 *
 * Without that, a repaint re-prices whatever the row HTML recomputes at the
 * DEFAULT spec levels. That is how a max-spec Moose printed "4x 500 focus/baby"
 * in the Mats cell beside its own 125-focus Silver/Focus figure: the row object
 * was built in scope, the cell text was not.
 */
function renderTableData(tbodyId, rowData, formatter) {
  tableState[tbodyId].data = rowData;
  tableState[tbodyId].formatter = (typeof bindSpecScope === "function")
    ? bindSpecScope(formatter)
    : formatter;
  // An off-screen render (My Crafting List pricing an entry at its own City
  // pick, js/table-sell-city.js withTableCityPicks) only wants the rows; the
  // caller restores this state afterwards and the table on screen stays as is.
  if (typeof isTableShadowRender === "function" && isTableShadowRender(tbodyId)) return;
  // Skip DOM rendering for collapsed tables — data is cached for when they expand
  if (!isTableCollapsed(tbodyId)) {
    updateTableDisplay(tbodyId);
  }
}


function formatPriceAge(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime()) || d.getFullYear() < 2015) return null;
  const ms = Date.now() - d.getTime();
  if (ms < 0) return null;
  const h = ms / 3600000;
  if (h < 1)
    return { label: `${Math.round(ms / 60000)}m ago`, color: "#5e9e78" };
  if (h < 6) return { label: `${Math.floor(h)}h ago`, color: "#5e9e78" };
  if (h < 24) return { label: `${Math.floor(h)}h ago`, color: "#9e8840" };
  return { label: `${Math.floor(h / 24)}d ago`, color: "#9e5858" };
}

/**
 * Render a clickable price cell that supports inline price overriding.
 * @param {string} matId  - Item ID for override key
 * @param {string} city   - City name for override key
 * @param {number} price  - Current price to display
 * @param {object} [opts] - { foodMode } — opt in to the cross-tier feed
 *   dropdown (only the breeding feed cells in render-mounts.js and
 *   render-faction-spending.js want this). Default false: every other caller
 *   gets a tier-specific dropdown, so recipe ingredients like Raw Mutton inside
 *   a salad recipe override the exact tier the user clicked.
 */
// An Instant buy of `itemId` with buy orders standing and nobody selling — at
// `city`, or (`anywhere`) across every city the item is quoted in. Instant buys
// never read a bid (js/price-book-fallback.js), so this is what the empty cell
// says instead of "no data".
function _noInstantOrders(itemId, city, anywhere) {
  if (typeof onlyBuyOrders !== "function" || getOrderType("buy") !== "instant") return false;
  const data = (typeof lastMarketData !== "undefined" && lastMarketData) ? lastMarketData[itemId] : null;
  return onlyBuyOrders(data, itemId, city) || (anywhere && onlyBuyOrders(data, itemId, null));
}

// A price the outlier gate threw away at `city` (or, `anywhere`, at any city
// the item is quoted in) — what an empty cell names instead of "no data".
// See rejectedOutlierPrice (js/price-book-fallback.js).
function _outlierIgnored(itemId, city, side, anywhere) {
  if (typeof rejectedOutlierPrice !== "function") return null;
  const data = (typeof lastMarketData !== "undefined" && lastMarketData) ? lastMarketData[itemId] : null;
  return rejectedOutlierPrice(data, itemId, city, side)
    || (anywhere ? rejectedOutlierPrice(data, itemId, null, side) : null);
}

function _outlierIgnoredTip(hit) {
  return tx("{city} quotes {price}, far outside what the other cities quote, so it was ignored. Click to set a price.", "r_tip_outlier_ignored")
    .replace("{city}", hit.city)
    .replace("{price}", formatSilver(hit.price));
}

function matPriceSpan(matId, city, price, opts) {
  const hasOverride = getOverridePrice(matId, city) !== null;
  const indicator = hasOverride
    ? ` <span class="ov-mark" style="color:#9e8840;font-size:0.75rem" title="${tx("Price overridden", "r_price_overridden")}">⚡</span>`
    : "";
  const overrideStyle = hasOverride ? "color:#9e8840;" : "";
  const foodAttr = (opts && opts.foodMode) ? ' data-food-mode="1"' : "";
  // Buy orders standing and no seller, at this city or anywhere the item is
  // quoted: an Instant buy has nothing to take (js/price-book-fallback.js).
  if (!(price > 0) && !hasOverride && typeof _noInstantOrders === "function" && _noInstantOrders(matId, city, true)) {
    return `<span class="price-editable mat-price-inline" data-item-id="${matId}" data-city="${city || ""}" data-raw-price="0" data-city-list="buy"${foodAttr} style="cursor:pointer;text-decoration:underline dotted;" title="${tx("Buy orders exist, but no sell orders to buy from instantly. Click to set a price.", "r_tip_no_instant_orders")}">@ ${tx("no instant orders — click to set", "r_no_instant_orders_click_to_set")}</span>`;
  }
  const outlier = !(price > 0) && !hasOverride && typeof _outlierIgnored === "function"
    ? _outlierIgnored(matId, city, "buy", true) : null;
  if (outlier) {
    return `<span class="price-editable mat-price-inline" data-item-id="${matId}" data-city="${city || ""}" data-raw-price="0" data-city-list="buy"${foodAttr} style="cursor:pointer;text-decoration:underline dotted;" title="${_outlierIgnoredTip(outlier)}">@ ${tx("outlier ignored — click to set", "r_outlier_ignored_click_to_set")}</span>`;
  }
  const displayPrice = price > 0 ? formatSilver(price) : tx("no data", "r_no_data");
  return `<span class="price-editable mat-price-inline" data-item-id="${matId}" data-city="${city || ""}" data-raw-price="${price}" data-city-list="buy"${foodAttr} style="cursor:pointer;text-decoration:underline dotted;${overrideStyle}" title="${tx("Click to override price", "r_tip_override_price")}">@ ${displayPrice} ${tx("ea", "r_ea")}${indicator}</span>`;
}

/**
 * The age badge's hover text: BOTH order dates, so a badge that looks stale can
 * be read against the side it is not showing. This is the direct answer to
 * "the capture ran, why does this still say 4d ago?" — the two books age apart.
 */
function bookDatesTitle(entry) {
  const parts = [];
  if (entry?.buy_date) parts.push(`${tx("Buy order", "r_book_buy_order")} ${entry.buy_date}`);
  if (entry?.sell_date) parts.push(`${tx("Sell order", "r_book_sell_order")} ${entry.sell_date}`);
  return parts.length
    ? parts.join(" · ")
    : tx("Price last seen", "r_price_last_seen");
}

// `note` (optional, HTML): a line under the number for something about the CELL
// that the number cannot say — the Crafting Planner uses it for a sell-city pin
// the row's craft city cannot reach (js/render-craft-planner.js). It renders
// whether or not there is a price, because "no data" is exactly when a dropped
// pin needs explaining.
function priceTd(price, itemId, city, side = "sell", extraClass = "silver-val", showCity = false, quality = null, sideOverride = false, note = "") {
  // Quality cells key their override per quality; everything else uses the
  // plain itemId. Both read the active override (getOverridePrice).
  // sideOverride (Flipping): the ⚡ marker tracks the cell's OWN order field
  // (buy/sell) instead of the active pick, matching its side-specific price.
  const ovKey = quality != null ? qualityOverrideKey(itemId, quality) : itemId;
  const hasOverride = sideOverride
    ? getOverrideField(ovKey, city, side) !== null
    : getOverridePrice(ovKey, city) !== null;
  const indicator = hasOverride
    ? ' <span class="ov-mark" style="color:#9e8840;font-size:0.75rem" title="Price overridden">⚡</span>'
    : "";
  const overrideStyle = hasOverride ? "color:#9e8840;" : "";
  // A quality cell is priced from the quality map, so it must be DATED from it
  // too — reading lastMarketData here stamped an Outstanding price with the
  // Normal book's age, which is the same lie priceDateField exists to prevent.
  const entry = quality != null
    ? (typeof lastQualityMarketData !== "undefined" ? lastQualityMarketData?.[itemId]?.[quality]?.[city] : undefined)
    : lastMarketData?.[itemId]?.[city];
  // Date the field this cell actually PRINTED. An entry holds two order books
  // that age apart — a Black Market capture writes only the bid, keeping the
  // old ask and its date — so `sell_date` on a cell showing the bid reads as a
  // fresh price four days stale. priceDateField (js/price-freshness.js) picks
  // the field exactly as getBuyPrice/getSellPrice pick the price.
  // An overridden cell has no market age at all: the number is the user's, so
  // any book timestamp beside it describes something else. The volume stays —
  // that is a fact about the book either way.
  const dateStr = hasOverride
    ? null
    : (typeof priceDateFor === "function" ? priceDateFor(entry, side) : entry?.sell_date);
  const age = formatPriceAge(dateStr);
  const vol = entry?.volume_24h;
  // Optional "(City)" tag — mirrors the buy-city <small> in the Source column,
  // so a sell-price cell can show WHERE to sell (Transmute/Enchanting tables).
  const cityBadge =
    showCity && price > 0 && city
      ? ` <small style="color:#9ca3af">(${city})</small>`
      : "";
  // Age + volume badge. Volume must render INDEPENDENTLY of age: an order book
  // can carry a live 24h volume while its date is stale/absent (AODP returns
  // "0001-01-01" → formatPriceAge null; the Black Market has no asks at all).
  // Nesting the volume inside the age check hid real liquidity on those rows
  // (reported: forced sell city showed no vol). Show whichever parts exist;
  // use age's colour when present.
  const agePart = age ? age.label : "";
  const volPart =
    vol > 0
      ? (agePart ? ` · ${vol.toLocaleString()} ${tx("vol", "r_vol")}` : `${vol.toLocaleString()} ${tx("vol", "r_vol")}`)
      : "";
  const ageBadge =
    price > 0 && (agePart || volPart)
      ? ` <small style="color:${age ? age.color : "#9ca3af"};font-size:0.7rem"${age ? ` title="${bookDatesTitle(entry)}"` : ""}>${agePart}${volPart}</small>`
      : "";
  // The book behind this cell has been READ since this price was recorded, and
  // the price was not in it. Said out loud rather than acted on: order lists
  // arrive in pages and packets get dropped, so a missing offer is evidence,
  // not proof. The number stays, and stays clickable — this is the direct
  // answer to a row advertising a two-day-old ask at a market the player is
  // standing in. See bookEmptySince (js/price-freshness.js).
  const emptySince = hasOverride || typeof bookEmptySince !== "function"
    ? null
    : bookEmptySince(entry, side);
  const emptyAge = emptySince ? formatPriceAge(emptySince) : null;
  const emptyBadge =
    price > 0 && emptySince
      ? ` <small style="color:#9e5858;font-size:0.7rem" title="${tx("The order book was open at this market and this price was not in it.", "r_tip_book_empty")}">${tx("not listed", "r_not_listed")}${emptyAge ? ` · ${tx("looked", "r_looked")} ${emptyAge.label}` : ""}</small>`
      : "";
  // The same fact, on the other side of the price: the book was read and this
  // side of it was EMPTY. Without it a zero cell says only "no data", which
  // cannot tell a market nobody has looked at from one whose order list came
  // back with nothing on this side — the exact confusion after a capture ("I
  // fetched every price and the row still says no data"). Instant and market
  // read different fields, so the note follows the printed one: a book with a
  // real ask and no standing bid is empty only to the cell reading the bid.
  const noOrdersBadge =
    price <= 0 && emptySince
      ? ` <small style="color:#9e5858;font-size:0.7rem" title="${tx("The order book was open at this market and this side of it was empty.", "r_tip_no_orders")}">${tx("no orders", "r_no_orders")}${emptyAge ? ` · ${tx("looked", "r_looked")} ${emptyAge.label}` : ""}</small>`
      : "";
  const outlier = !hasOverride && quality == null && !(price > 0)
    && typeof _outlierIgnored === "function" ? _outlierIgnored(itemId, city, side, false) : null;
  const emptyLabel = side === "buy" && !hasOverride && quality == null
    && typeof _noInstantOrders === "function" && _noInstantOrders(itemId, city, false)
    ? `<span style="color:#6b7280;font-style:italic" title="${tx("Buy orders exist, but no sell orders to buy from instantly. Click to set a price.", "r_tip_no_instant_orders")}">${tx("no instant orders — click to set", "r_no_instant_orders_click_to_set")}</span>`
    : outlier
      ? `<span style="color:#6b7280;font-style:italic" title="${_outlierIgnoredTip(outlier)}">${tx("outlier ignored — click to set", "r_outlier_ignored_click_to_set")}</span>`
      : `<span style="color:#6b7280;font-style:italic">${tx("no data — click to set", "r_no_data_click_to_set")}</span>${noOrdersBadge}`;
  const displayContent =
    price > 0
      ? `${formatSilver(price)}${indicator}${cityBadge}${ageBadge}${emptyBadge}`
      : emptyLabel;
  // data-quality lets the price editor source from lastQualityMarketData
  // (keyed [itemId][quality][city]) instead of lastMarketData — used by the
  // Quality Rerolling table so its city-compare dropdown shows real prices.
  const qualityAttr = quality != null ? ` data-quality="${quality}"` : "";
  // cell-num caps the width and lets the age/volume badge wrap onto its own
  // line (css/styles.css) — a price cell trailing "15h ago · 60,318 vol" is
  // otherwise one long unbreakable run that pushes wide tables off-screen.
  return `<td class="${extraClass} cell-num price-editable" data-item-id="${itemId}" data-city="${city}" data-raw-price="${price}" data-city-list="${side}"${qualityAttr} style="cursor:pointer;${overrideStyle}" title="${tx("Click to override price", "r_tip_override_price")}">${displayContent}${note || ""}</td>`;
}


function profitTd(marginInfo, tableId, rowIdx, sellCity) {
  return `<td class="${getProfitClass(marginInfo.margin)} profit-cell-clickable" data-profit-cell="1" data-table-id="${tableId}" data-row-idx="${rowIdx}" data-sell-city="${sellCity || ""}" title="${tx("Click to change sell city", "r_tip_change_sell_city")}">${marginInfo.margin.toFixed(2)}%</td>`;
}

/**
 * A read-only aggregate cost cell (Crafting / Craft Planner / Transport /
 * Transmute "Input Cost").
 *
 * These used to be priceTd, i.e. click-to-override cells \u2014 but the number is a
 * SUM: every material's count \u00d7 unit price, plus the setup fee, the station fee,
 * the Brecilien haul and the recipe silver. No single per-unit price inverts it,
 * so an override typed here could only ever be wrong. It was wrong two ways: a
 * full-recipe item has no `item.matId`, so the key fell back to `<id>_mat`,
 * which nothing in the app ever reads (a silently dead edit); and an item that
 * DOES carry a matId stored the per-craft total as that material's per-unit buy
 * price, off by the recipe count (~30\u00d7 on furniture).
 *
 * The per-unit editors live one column left, in the Materials cell
 * (matPriceSpan) \u2014 that is where a price is actually pinnable.
 */
function aggregateCostTd(cost, extraClass = "silver-val cell-num") {
  const n = Number(cost);
  if (!isFinite(n) || n <= 0) {
    return `<td class="${extraClass}" style="color:#6b7280;font-style:italic">\u2014</td>`;
  }
  const title = tx(
    "Materials above plus fees. To change it, edit a material price in the Materials column.",
    "r_tip_aggregate_cost",
  );
  return `<td class="${extraClass}" title="${title}">${formatSilver(n)}</td>`;
}

// `title` (optional): per-row arithmetic behind the number, for tables whose
// price columns show UNIT prices rather than the per-cycle/per-craft silver the
// profit is built from (Laborers: yield \u00d7 price, less tax, less input cost).
// Without it the columns can't be added up by eye and the profit looks wrong.
//
// Both builders live in js/pure-profit-cell.js (this file was over the 800-line
// cap). These same-name globals forward to the module's __pureProfitCell
// namespace, so every caller, renderer and Node source-lift keeps working and
// the forwarders cannot recurse through the global binding the module's
// declarations used to own.
function pureProfitTd(marginInfo, title) {
  return __pureProfitCell.pureProfitTd(marginInfo, title);
}

// pureProfitTd + the margin on a second line, in ONE cell that is still
// click-to-change-sell-city (it took the affordance over when the Margin %
// column was folded away). The real body is js/pure-profit-cell.js's; when the
// row carries a selfFoundProfit it also appends the dimmed self-found twin
// line (see tests/laborers-table-shape.test.cjs for the shape contract).
function profitWithMarginTd(marginInfo, title, tableId, rowIdx, sellCity) {
  // The extracted body still emits exactly this cell:
  //   <td class="silver-val \u2026 profit-cell-clickable" data-profit-cell="1"
  //        data-table-id="\u2026" data-row-idx="\u2026" data-sell-city="\u2026" title="\u2026">
  //        value<br><small style="color:#9ca3af">margin%</small></td>
  return __pureProfitCell.profitWithMarginTd(marginInfo, title, tableId, rowIdx, sellCity);
}


let lastMarketData = null;
let lastQualityMarketData = null;
// Saddled-mount masterpiece (quality=5) prices, populated by mount + faction
// spending scans. Shape: { [mountId]: { [city]: { sell_price, volume_24h } } }
// — same shape as lastMarketData so findBestSellCity can consume it directly.
let lastMpMarketData = null;
