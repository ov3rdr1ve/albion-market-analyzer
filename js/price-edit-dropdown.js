/**
 * Price-edit dropdown builder.
 *
 * Used by the inline price editor in app.js (price-editable click handler) to
 * populate the city <select>. Two modes:
 *
 *  - Generic: one option per city in CITIES (buy) or SELL_CITIES (sell), all
 *    pointing at the same itemId. Default-selects the cheapest (buy) /
 *    highest (sell) city based on the same effective price the dropdown shows.
 *
 *  - Food (meat/plants/chocolate): one option per city, but each option's
 *    itemId is the cheapest tier of that food category at THAT city. Salamanders
 *    eat any tier of meat, horses/oxen eat any tier of plants, so the dropdown
 *    surfaces cross-tier picks per city. Default = absolute cheapest combo.
 *
 * Pure builder — no DOM, no side effects. Reads only the globals it needs at
 * call time: CITIES, SELL_CITIES, FOOD_ITEMS, getOverridePrice, getOrderType,
 * ITEM_NAMES_MAP / getItemDisplayName (for food labels), formatPriceAge (for
 * the freshness badge). formatPriceAge lives in js/app.js, which loads AFTER
 * this file — reachable anyway, because nothing here runs until a price cell
 * is clicked.
 */

(function () {
  const FOOD_CATEGORIES = ["meat", "plants", "chocolate"];

  function isFoodItem(itemId) {
    if (typeof FOOD_ITEMS === "undefined") return null;
    for (const cat of FOOD_CATEGORIES) {
      const ids = FOOD_ITEMS[cat];
      if (Array.isArray(ids) && ids.includes(itemId)) return cat;
    }
    return null;
  }

  // Effective per-city price for one (itemId, city) pair.
  // Mirrors the price computation in app.js:721-729 so the dropdown's
  // default-selection logic always matches the labels it displays.
  // Returns { price, override } where override is true if the price came
  // from an override (used for the ⚡ marker in labels).
  function priceForCity(itemId, city, side, marketData, orderType) {
    // The active override wins. A pinned one is used as-is; an "auto" one is
    // resolved for THIS dropdown's side so the label matches what the table
    // shows (js/utils.js getOverridePrice).
    const ov = typeof getOverridePrice === "function"
      ? getOverridePrice(itemId, city, side)
      : null;
    if (ov !== null) return { price: ov, override: true };
    const itemData = marketData?.[itemId]?.[city];
    if (!itemData) return { price: 0, override: false };
    if (side === "buy") {
      const p = orderType === "instant" ? itemData.sell_price : itemData.buy_price;
      return { price: p || 0, override: false };
    }
    const p = orderType === "instant" ? itemData.buy_price : itemData.sell_price;
    return { price: p || 0, override: false };
  }

  // For food cells: scan FOOD_ITEMS[category] at one city and return the
  // cheapest tier with data. Returns { itemId, price, override } or null.
  function cheapestTierAtCity(category, city, marketData, orderType) {
    const ids = (typeof FOOD_ITEMS !== "undefined" && FOOD_ITEMS[category]) || [];
    let best = null;
    for (const tierId of ids) {
      const { price, override } = priceForCity(tierId, city, "buy", marketData, orderType);
      if (price > 0 && (best === null || price < best.price)) {
        best = { itemId: tierId, price, override };
      }
    }
    return best;
  }

  function tierShortName(itemId) {
    if (typeof ITEM_NAMES_MAP !== "undefined" && ITEM_NAMES_MAP[itemId]) {
      return ITEM_NAMES_MAP[itemId];
    }
    if (typeof getItemDisplayName === "function") {
      return getItemDisplayName(itemId);
    }
    return itemId;
  }

  // The effective sell / buy order prices to DISPLAY for one (itemId, city):
  // a stored override field wins over the live market field, so a city that has
  // only an override (no live order book — e.g. Thetford in the reported bug)
  // still shows BOTH the override's sell and buy values, not just the active
  // one. Returns { sell, buy, sellHint }.
  //
  // sellHint (sell dropdowns only, `withHint`): when the Normal ask is empty
  // and no sell override stands in for it, the cheapest Good+ ask at the city
  // (qualityAskHint) — display only. `sell` stays the Normal value, so the hint
  // never ranks a city nor prefills the SELL ORDER input.
  function displayOrders(itemId, city, marketEntry, withHint) {
    const field = (side) =>
      typeof getOverrideField === "function" ? getOverrideField(itemId, city, side) : null;
    const ovSell = field("sell");
    const ovBuy = field("buy");
    const sell = ovSell != null && ovSell > 0 ? ovSell : marketEntry?.sell_price || 0;
    const buy = ovBuy != null && ovBuy > 0 ? ovBuy : marketEntry?.buy_price || 0;
    const sellHint = withHint && !(sell > 0) ? qualityAskHint(itemId, city) : null;
    return { sell, buy, sellHint };
  }

  // The planner's sell-label names (js/craft-planner-quality.js
  // _CP_SELL_QUALITY_LABELS), restated: that file is not loaded in the Node
  // harnesses that require this module.
  const HINT_QUALITY_NAMES = { 2: "Good", 3: "Outstanding", 4: "Excellent", 5: "Masterpiece" };

  // The cheapest Q2..Q5 ask for (itemId, city) in lastQualityMarketData, as
  // { price, quality } (a tie keeps the lower quality), or null. A
  // quality-keyed id (ITEM#Qn) never hints: its own book is the truth for
  // that quality. anyQualityBookPrice does not fit — it includes Q1 and does
  // not say which quality it read.
  function qualityAskHint(itemId, city) {
    if (typeof itemId !== "string" || itemId.includes("#Q")) return null;
    const qmap = typeof lastQualityMarketData !== "undefined" ? lastQualityMarketData : null;
    const book = qmap?.[itemId];
    if (!book) return null;
    let best = null;
    for (let q = 2; q <= 5; q++) {
      const p = book[q]?.[city]?.sell_price;
      if (typeof p !== "number" || !(p > 0)) continue;
      if (best === null || p < best.price) best = { price: p, quality: q };
    }
    return best;
  }

  // The hint's quality tag text, e.g. "Excellent".
  function hintQualityName(hint) {
    return HINT_QUALITY_NAMES[hint.quality] || `Q${hint.quality}`;
  }

  /**
   * The dates for the two numbers displayOrders prints, so each order can be
   * badged with its OWN age. The two books age apart — a Black Market capture
   * writes only the bid and keeps the previous ask and its date — so a single
   * shared age beside both numbers would be a lie (js/price-freshness.js).
   *
   * A side taken from a stored override has NO market age: the number is the
   * user's, and a book timestamp beside it describes something else. Same rule
   * priceTd applies in js/app.js.
   */
  function displayOrderDates(itemId, city, marketEntry) {
    const field = (side) =>
      typeof getOverrideField === "function" ? getOverrideField(itemId, city, side) : null;
    const ovSell = field("sell");
    const ovBuy = field("buy");
    const sellDate = ovSell != null && ovSell > 0 ? null : marketEntry?.sell_date || null;
    const buyDate = ovBuy != null && ovBuy > 0 ? null : marketEntry?.buy_date || null;
    return { sellDate, buyDate };
  }

  // The table's freshness ramp, borrowed rather than copied: formatPriceAge
  // (js/app.js) returns { label, color } or null for an absent/unparseable date
  // ("0001-01-01" from AODP lands here). Guarded because Node harnesses stub it.
  function ageOf(dateStr) {
    return typeof formatPriceAge === "function" ? formatPriceAge(dateStr) : null;
  }

  function esc(str) {
    return String(str).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // Build the option label. Shows the full order book at the city — sell order
  // on the left, buy order on the right (mirrors the in-game market window and
  // the editor's input layout) — followed by 24h volume. `eff` is the
  // side-specific effective price used only as a last-resort fallback when
  // neither a market nor an override sell/buy is known.
  function makeLabel(m) {
    const tierBit = m.foodMode ? ` ${m.tierName}` : "";
    const ovBit = m.override ? " ⚡" : "";
    const fmt = (n) => (n > 0 ? n.toLocaleString() : "—");
    // The age rides with its own number, and only when there IS a number: an
    // age beside an em dash would date a price that is not shown.
    const agePart = (dateStr, price) => {
      if (!(price > 0)) return "";
      const a = ageOf(dateStr);
      return a ? ` (${a.label})` : "";
    };
    if (m.sell > 0 || m.buy > 0 || m.sellHint) {
      const volBit = m.volume > 0 ? ` · ${m.volume.toLocaleString()} vol` : "";
      const sellBit = !(m.sell > 0) && m.sellHint
        ? `${m.sellHint.price.toLocaleString()} (${hintQualityName(m.sellHint)})`
        : `${fmt(m.sell)}${agePart(m.sellDate, m.sell)}`;
      return `${m.city}${tierBit} — ${sellBit}`
        + ` · ${fmt(m.buy)}${agePart(m.buyDate, m.buy)}${volBit}${ovBit}`;
    }
    // Neither side known — surface the effective price if there is one.
    if (m.price > 0) return `${m.city}${tierBit} — ${m.price.toLocaleString()}${ovBit}`;
    // No-data label: matches the convention in app.js:735 — refined/mat items
    // get a blank suffix because they're often legitimately unsold; everything
    // else gets " — no data" so the dropdown is still informative.
    if (m.itemId && (m.itemId.endsWith("_mat") || m.itemId.endsWith("_refined"))) return m.city;
    return `${m.city} — no data`;
  }

  /**
   * The same row as markup, with the prices, the ages and the volume in
   * separate spans so each carries its own colour — what the table's price cell
   * already does, where the number is light and the "2h ago · 3,763 vol" badge
   * under it is the freshness ramp / grey.
   *
   * A native <option> cannot colour parts of its text, so the editor's select
   * runs in Chromium's customizable-select mode (appearance: base-select,
   * css/price-editor.css). Where that is unsupported the spans flatten to the
   * plain label's text — same content, one colour.
   *
   * The age colour is inline, not a class: the ramp is data (formatPriceAge),
   * emitted the same way by the table and the quality ladders.
   */
  function cityOptionHtml(m) {
    if (!m) return "";
    const tierBit = m.foodMode && m.tierName ? ` ${esc(m.tierName)}` : "";
    const head = `${esc(m.city)}${tierBit}`;
    const ovBit = m.override ? ' <span class="pe-opt-ov">⚡</span>' : "";
    if (!(m.sell > 0 || m.buy > 0 || m.sellHint)) {
      if (m.price > 0) {
        return `${head} — <span class="pe-opt-price">${m.price.toLocaleString()}</span>${ovBit}`;
      }
      // No-data rows say one thing in one place: reuse the plain label.
      return esc(makeLabel(m));
    }
    const num = (n) => `<span class="pe-opt-price">${n > 0 ? n.toLocaleString() : "—"}</span>`;
    const age = (dateStr, price) => {
      if (!(price > 0)) return "";
      const a = ageOf(dateStr);
      return a ? ` <span class="pe-opt-age" style="color:${a.color}">(${a.label})</span>` : "";
    };
    const volBit = m.volume > 0
      ? ` · <span class="pe-opt-vol">${m.volume.toLocaleString()} vol</span>`
      : "";
    // A Good+ ask standing in for an empty Normal ask carries its quality name.
    const sellBit = !(m.sell > 0) && m.sellHint
      ? `${num(m.sellHint.price)} <span class="pe-opt-q">(${esc(hintQualityName(m.sellHint))})</span>`
      : `${num(m.sell)}${age(m.sellDate, m.sell)}`;
    return `${head} — ${sellBit}`
      + ` · ${num(m.buy)}${age(m.buyDate, m.buy)}${volBit}${ovBit}`;
  }

  /**
   * Build per-city options for the price-edit dropdown.
   *
   * @param {string} itemId — the cell's data-item-id
   * @param {"buy"|"sell"} side — the cell's data-city-list
   * @param {object} marketData — lastMarketData reference
   * @param {object} [opts] — { foodMode, preferCity }.
   *   foodMode — opt in to cross-tier feed scan. Default false: every cell
   *   edits the itemId verbatim, even when that itemId is a member of
   *   FOOD_ITEMS. Only the breeding-feed cells (mounts + faction-spending)
   *   set foodMode:true — for them the cell represents "feed at this city"
   *   so cross-tier substitution is desired. Recipe ingredients (consumables,
   *   crafting, etc.) always need tier-specific editing — Deepwater Kraken
   *   Salad's recipe asks for T6_MEAT specifically, not "the cheapest meat at
   *   any tier".
   *   preferCity — pin defaultIndex to this city's option regardless of
   *   best-price ranking. Caller passes the cell's data-city so a no-change
   *   Enter commits the override at the city the user thinks they're editing
   *   (rather than whichever city happened to have the best price). Empty /
   *   null / not-in-cityList falls back to best-price defaulting.
   * @returns {{
   *   options: Array<{ city: string, itemId: string, price: number, label: string }>,
   *   defaultIndex: number,         // -1 when no city has data AND no preferCity
   *   cityToItemId: Map<string,string>,
   *   isFood: boolean,
   *   foodCategory: string|null,    // "meat"|"plants"|"chocolate" or null
   * }}
   */
  function buildCityOptions(itemId, side, marketData, opts) {
    const foodMode = !!(opts && opts.foodMode);
    const preferCity = (opts && opts.preferCity) || null;
    const orderType = typeof getOrderType === "function" ? getOrderType(side) : "market";
    const cityList = side === "buy"
      ? (typeof CITIES !== "undefined" ? CITIES : [])
      : (typeof SELL_CITIES !== "undefined" ? SELL_CITIES : []);
    // Food mode (cross-tier cheapest-tier scan) is BUY-only AND opt-in. The
    // opt-in guard fixes a bug where any cell whose itemId happened to be in
    // FOOD_ITEMS (e.g. Raw Mutton inside Deepwater Kraken Salad's recipe)
    // would silently substitute a cheaper-tier itemId on commit, so the user's
    // override saved under the wrong key and the row never updated visually.
    // Sell side is always tier-specific — pretending the option is a different
    // tier would route the override to the wrong key.
    const foodCategory = (foodMode && side === "buy") ? isFoodItem(itemId) : null;
    const isFood = foodCategory !== null;

    const options = [];
    const cityToItemId = new Map();
    let defaultIndex = -1;
    let bestPrice = side === "buy" ? Infinity : 0;

    cityList.forEach((city) => {
      let optItemId = itemId;
      let price = 0;
      let override = false;

      if (isFood) {
        const cheapest = cheapestTierAtCity(foodCategory, city, marketData, orderType);
        if (cheapest) {
          optItemId = cheapest.itemId;
          price = cheapest.price;
          override = cheapest.override;
        }
      } else {
        const r = priceForCity(itemId, city, side, marketData, orderType);
        price = r.price;
        override = r.override;
      }

      const marketEntry = marketData?.[optItemId]?.[city];
      const { sell, buy, sellHint } = displayOrders(optItemId, city, marketEntry, side === "sell" && !isFood);
      const { sellDate, buyDate } = displayOrderDates(optItemId, city, marketEntry);
      const volume = marketEntry?.volume_24h || 0;
      // One meta per option, carrying every part both renderers need, so
      // cityOptionHtml never re-derives what makeLabel already resolved.
      const meta = {
        city,
        itemId: optItemId,
        price,
        sell,
        buy,
        sellHint,
        sellDate,
        buyDate,
        volume,
        override,
        foodMode: isFood,
        tierName: isFood ? tierShortName(optItemId) : null,
      };
      meta.label = makeLabel(meta);

      options.push(meta);
      if (isFood) cityToItemId.set(city, optItemId);

      if (price > 0) {
        const better = side === "buy" ? (price < bestPrice) : (price > bestPrice);
        if (better) {
          bestPrice = price;
          defaultIndex = options.length - 1;
        }
      }
    });

    // preferCity override: pin the default to the city the caller passed,
    // even if its price isn't the best. This makes a no-change Enter commit
    // the override at the city the user clicked, not at whichever city
    // happened to be cheapest/highest. Falls through to best-price logic
    // when preferCity is missing or not in the dropdown's city list.
    if (preferCity) {
      const idx = options.findIndex((o) => o.city === preferCity);
      if (idx >= 0) defaultIndex = idx;
    }

    return { options, defaultIndex, cityToItemId, isFood, foodCategory };
  }

  // Which book the inline editor opens for a clicked cell. Quality cells
  // (data-quality) route ALL override reads/writes through a per-quality
  // synthetic key so the item's other qualities keep independent overrides;
  // that quality's book is flattened from qualityMap[id][q] into the plain
  // { [key]: { [city]: cell } } shape buildCityOptions / editorFieldValue
  // read. No attribute → the plain id and the flat (Normal) map.
  function resolveEditSource(realItemId, qualityAttr, flatMap, qualityMap) {
    const quality = qualityAttr != null ? parseInt(qualityAttr) : null;
    if (quality == null) return { itemId: realItemId, quality: null, marketSource: flatMap };
    const itemId = qualityOverrideKey(realItemId, quality);
    const marketSource = { [itemId]: qualityMap?.[realItemId]?.[quality] || {} };
    return { itemId, quality, marketSource };
  }

  // SELL ORDER / BUY ORDER input prefill: a stored override field wins, else
  // the market field, else 0 (an empty input).
  function editorFieldValue(eid, city, side, marketSource) {
    const ov = typeof getOverrideField === "function" ? getOverrideField(eid, city, side) : null;
    if (ov !== null) return ov;
    const d = marketSource?.[eid]?.[city];
    if (!d) return 0;
    return (side === "buy" ? d.buy_price : d.sell_price) || 0;
  }

  // Expose for browser (global) and CommonJS (tests).
  if (typeof window !== "undefined") {
    window.buildCityOptions = buildCityOptions;
    window.cityOptionHtml = cityOptionHtml;
    window.displayOrderDates = displayOrderDates;
    window.resolveEditSource = resolveEditSource;
    window.editorFieldValue = editorFieldValue;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      buildCityOptions, isFoodItem, priceForCity, cheapestTierAtCity,
      cityOptionHtml, displayOrderDates, makeLabel,
      resolveEditSource, editorFieldValue,
    };
  }
})();
