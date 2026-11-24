// Free-text filter for the volume table. Pure: takes the already-built row
// objects and a query string, returns the subset whose visible text matches
// EVERY whitespace-separated term (AND semantics). Matching is case-insensitive
// against the name, tier ("t4"), category, top city, and the raw market id —
// so "planks", "4.2 planks", ".2 cloth", "resource", or "level2" all work.
// Resources display as the short generic label e.g. "4.2 planks", so a search
// like "4.2 planks" narrows straight to them.
//
// The picker values (raw <select> strings, ""=All) AND with the text query,
// mirroring the in-game Marketplace filters the generic tables get. tier is
// row.tier; enchant is parsed off the item id's trailing _LEVELn@n (base = 0);
// category/subcategory come from getMarketCategory (js/data-item-categories.js)
// and city is the row's top-volume market. This table filters its ROW OBJECTS
// rather than the rendered DOM (js/table-search.js skips it), so every picker
// has to be re-implemented against the row shape here.
function filterVolumeRows(rows, query, tierSel, enchSel, catSel, subSel, citySel) {
  const q = (query || "").trim().toLowerCase();
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  const tierN = tierSel ? parseInt(tierSel, 10) : null;
  const enchN = enchSel !== "" && enchSel != null ? parseInt(enchSel, 10) : null;
  const cat = catSel || "";
  const sub = subSel || "";
  const city = citySel || "";
  if (terms.length === 0 && tierN === null && enchN === null && !cat && !sub && !city) {
    return rows;
  }
  const lookup = typeof getMarketCategory === "function" ? getMarketCategory : null;
  return rows.filter((row) => {
    if (tierN !== null && row.tier !== tierN) return false;
    if (enchN !== null) {
      const em = String(row.itemId || "").match(/@([0-4])(?:\D|$)/);
      const rowEnch = em ? parseInt(em[1], 10) : 0;
      if (rowEnch !== enchN) return false;
    }
    if (cat || sub) {
      const hit = lookup ? lookup(row.itemId) : null;
      if (!hit) return false; // uncategorised item, explicit pick active
      if (cat && hit.category !== cat) return false;
      if (sub && hit.subcategory !== sub) return false;
    }
    if (city && row.topCity !== city && row.displayPriceCity !== city) return false;
    if (terms.length === 0) return true;
    const hay = [
      row.name,
      "t" + row.tier,
      row.category,
      row.topCity,
      row.itemId,
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * Keep the volume table's Category / Subcategory / City pickers offering only
 * what its rows actually hold.
 *
 * Every other table gets this for free: js/table-search.js walks the rendered
 * <tr>s and syncs the options as it filters them. The volume table filters row
 * OBJECTS before rendering, so nothing walks its DOM — without this call its
 * pickers would stay empty (and therefore hidden) forever. `rows` must be the
 * PRE-filter set, or picking a category would collapse the list to that one.
 */
function syncVolumeFilterOptions(rows, catSel) {
  const filters = typeof window !== "undefined" ? window.tableFilters : null;
  if (!filters) return;
  // No rows yet (never scanned) is not evidence that the table has no
  // categories or cities: the pickers are seeded from the catalogs at injection
  // so the header looks the same before the first scan, and pruning to nothing
  // here would hide them again. Same guard js/table-search.js applies.
  if (!rows || rows.length === 0) return;
  const lookup = typeof getMarketCategory === "function" ? getMarketCategory : null;
  const pairs = [];
  const cities = new Set();
  rows.forEach((row) => {
    const hit = lookup ? lookup(row.itemId) : null;
    if (hit) pairs.push(hit);
    if (row.topCity) cities.add(row.topCity);
  });
  filters.syncCategoryOptions("volume-table", pairs, catSel || "");
  filters.syncCityOptions("volume-table", cities);
}

/**
 * Read this table's search box + every picker off the DOM, sync the option
 * lists, and return the surviving rows. Called from updateTableDisplay
 * (js/sorting.js) so the full row set stays cached there.
 */
function applyVolumeTableFilters(rows) {
  if (typeof filterVolumeRows !== "function") return rows;
  const val = (id) => document.getElementById(id)?.value || "";
  const catSel = val("catfilter-volume-table");
  // Options first, off the UNFILTERED set — see syncVolumeFilterOptions.
  syncVolumeFilterOptions(rows, catSel);
  return filterVolumeRows(
    rows,
    val("volume-search"),
    val("tierfilter-volume-table"),
    val("enchfilter-volume-table"),
    catSel,
    val("subcatfilter-volume-table"),
    val("cityfilter-volume-table"),
  );
}

function renderVolumeTable(marketData) {
  const allIds = Object.keys(marketData);
  // The table's City pick RE-PRICES the rows rather than filtering them
  // (js/table-sell-city.js). A volume row names one market — the busiest — so
  // filtering on it asked "is this item's top market the picked one", and an
  // item that trades at the Black Market but trades MORE somewhere else
  // (T4_CAPEITEM_FW_LYMHURST: BM 1,195 vs Lymhurst 3,199) vanished under a Black
  // Market pick while its T6-T8 siblings stayed. Under a pick the row is built
  // at that city instead: its volume, its price, its name in the Top City cell.
  const cityPick = typeof getTableSellCity === "function"
    ? getTableSellCity("volume-table")
    : null;
  const rowData = allIds.map((itemId) => {
    const itemData = marketData[itemId];
    let totalVol = 0;
    let topCity = null;
    let topCityVol = -1;

    // Total Volume (All Cities) reads every market whatever the pick says — it
    // is the column's whole point.
    SELL_CITIES.forEach((city) => {
      const vol = itemData[city]?.volume_24h || 0;
      totalVol += vol;
      if (vol > topCityVol) {
        topCityVol = vol;
        topCity = city;
      }
    });
    if (cityPick) {
      topCity = cityPick;
      topCityVol = itemData[cityPick]?.volume_24h || 0;
    }

    // Prefer override city/price if one exists for this item.
    // Order: city-force (pinned by the price editor on commit) → most recent
    // override key → topCity. The force is what makes a city *change* in the
    // dropdown actually stick — without it, Object.keys()[0] kept returning
    // the oldest insertion and the row appeared to "reset" the city.
    //
    // An active City pick outranks both: the user is asking "price this table at
    // X", the precedence effectiveSellCities documents (js/table-sell-city.js).
    // A typed override AT that city still applies — getSellPrice reads one for
    // whatever city it is handed.
    let displayPriceCity = topCity;
    const forcedSellCity = getCityForce(itemId, "sell");
    const ovKeys = priceOverrides[itemId]
      ? Object.keys(priceOverrides[itemId])
      : [];
    if (cityPick) {
      displayPriceCity = cityPick;
    } else if (forcedSellCity && priceOverrides[itemId]?.[forcedSellCity] != null) {
      displayPriceCity = forcedSellCity;
    } else if (ovKeys.length > 0) {
      displayPriceCity = ovKeys[ovKeys.length - 1];
    }
    const bounds = getIQRBounds(itemData);
    const topCityPrice = getSellPrice(
      itemData,
      displayPriceCity,
      bounds,
      itemId,
    );

    return {
      itemId,
      name: getItemDisplayName(itemId),
      tier: getTierFromId(itemId),
      category: getItemCategory(itemId),
      totalVol,
      topCity,
      topCityVol,
      displayPriceCity,
      topCityPrice,
    };
  });

  // No pick: a row earns its place by trading SOMEWHERE. Under a pick: by
  // trading at that city — otherwise the table lists items holding a 0 in the
  // very column it is ranked by.
  const validRows = rowData.filter((r) => (cityPick ? r.topCityVol > 0 : r.totalVol > 0));

  renderTableData(
    "volume-table",
    validRows,
    (row) => {
      const {
        name,
        tier,
        category,
        totalVol,
        topCity,
        topCityVol,
        itemId,
        displayPriceCity,
        topCityPrice,
      } = row;
      const rowKey = getRowKey(row, "volume-table");
      return `
      <tr data-row-key="${rowKey}">
          <td>${name}</td>
          <td>T${tier}</td>
          <td>${category}</td>
          <td class="vol-cell">${totalVol.toLocaleString()}</td>
          <td>${topCity || "None"}</td>
          <td class="vol-cell">${topCityVol > 0 ? topCityVol.toLocaleString() : 0}</td>
          ${priceTd(topCityPrice, itemId, displayPriceCity)}
      </tr>
  `;
    },
  );
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { filterVolumeRows, syncVolumeFilterOptions, applyVolumeTableFilters };
}

