/**
 * Per-row sell-city overrides (the profit-cell city picker's backend) and the
 * Rolling table's category / roll collapse state.
 *
 * Split out of js/app.js (800-line limit). Plain globals, loaded before it.
 */

// ── Sell-city picker helpers ──────────────────────────────────────────────────

function showNoPriceWarning(city) {
  let toast = document.getElementById("sell-city-no-data-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "sell-city-no-data-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = `No market data for "${city}" — row not changed`;
  toast.classList.add("visible");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("visible"), 2500);
}

function getBuyCityForRow(tableId, row) {
  if (tableId === "flipping-table") return row.buy?.city;
  if (tableId === "crafting-table") return row.craftCity;
  if (tableId === "transport-table") return row.buyRaw?.city;
  if (tableId === "consumable-table") return row.craftCity || row.buyMat?.city;
  if (tableId === "mounts-table") return row.craftCity || row.buyMat?.city;
  if (tableId === "farming-table") return row.buySeed?.city;
  if (tableId === "rolling-table") return row.fragBuyCity;
  if (tableId === "enchanting-table") return row.sourceCity;
  if (tableId === "transmute-table") return row.buyCity;
  if (tableId === "rerolling-table") return row.buyCity;
  return null;
}

function updateSingleRow(tableId, rowIdx) {
  const state = tableState[tableId];
  if (!state || !state.formatter || !state.data) return;
  const row = state.data[rowIdx];
  if (!row) return;
  // querySelectorAll, not querySelector: a row picked onto My Crafting List is
  // rendered a SECOND time by this same formatter (js/render-craft-list.js), so
  // both copies carry this table/row-idx pair and both must be refreshed.
  const cells = document.querySelectorAll(
    `[data-profit-cell="1"][data-table-id="${tableId}"][data-row-idx="${rowIdx}"]`
  );
  cells.forEach((profitCell) => {
    const tr = profitCell.closest("tr");
    if (!tr) return;
    // An editor open in this row dies with the swap. Close it first so its
    // 150 ms blur timer cannot later persist a half-typed value against a row
    // that no longer exists (and leave activeEditor pointing at the dead one).
    tr.querySelectorAll("td.pe-editing").forEach((td) => {
      if (td._closeEditor) td._closeEditor();
    });
    const temp = document.createElement("tbody");
    temp.innerHTML = state.formatter(row, rowIdx);
    const newTr = temp.firstElementChild;
    if (newTr) tr.replaceWith(newTr);
  });
  // The list copy lost its quantity cell in that swap — repaint the panel.
  if (typeof renderCraftListTable === "function" && cells.length > 1) renderCraftListTable();
}

function applyRowCityOverride(tableId, rowIdx, newCity) {
  const state = tableState[tableId];
  if (!state || !state.data) return;
  const row = state.data[rowIdx];
  if (!row || !row.marginInfo) return;
  if (!lastMarketData) return;

  let itemId, newSellPrice, bounds, newMargin;

  if (tableId === "flipping-table") {
    itemId = row.item.id;
    bounds = getIQRBounds(lastMarketData[itemId]);
    newSellPrice = getSellPrice(lastMarketData[itemId], newCity, bounds, itemId);
    if (newSellPrice <= 0) { showNoPriceWarning(newCity); return; }
    newMargin = calculateFlipMargin(row.buy.price, newSellPrice).margin;

  } else if (tableId === "crafting-table") {
    itemId = row.item.id;
    bounds = getIQRBounds(lastMarketData[itemId]);
    newSellPrice = getSellPrice(lastMarketData[itemId], newCity, bounds, itemId);
    if (newSellPrice <= 0) { showNoPriceWarning(newCity); return; }
    const profit = newSellPrice * (1 - PREMIUM_TAX) - row.totalInputCost;
    newMargin = (profit / row.totalInputCost) * 100;

  } else if (tableId === "transport-table") {
    itemId = row.route.refinedId || (row.route.rawId + "_refined");
    bounds = getIQRBounds(lastMarketData[itemId]);
    newSellPrice = getSellPrice(lastMarketData[itemId], newCity, bounds, itemId);
    if (newSellPrice <= 0) { showNoPriceWarning(newCity); return; }
    newMargin = calculateTransportMargin(
      row.totalRawCost, newSellPrice, row.rrr, 0,
      refineStationFeeSilver(row.route.refinedId), 0, 0,
      row.setupExemptCost || 0,
    ).margin;

  } else if (tableId === "consumable-table") {
    itemId = row.item.id;
    bounds = getIQRBounds(lastMarketData[itemId]);
    newSellPrice = getSellPrice(lastMarketData[itemId], newCity, bounds, itemId);
    if (newSellPrice <= 0) { showNoPriceWarning(newCity); return; }
    if (row.isFlip || !row.recipe) {
      newMargin = calculateFlipMargin(row.buyMat.price, newSellPrice).margin;
    } else {
      const profit = newSellPrice * (1 - PREMIUM_TAX) - row.totalInputCost;
      newMargin = (profit / row.totalInputCost) * 100;
    }

  } else if (tableId === "mounts-table") {
    if (row.isBreeding) {
      itemId = row.item.grownId;
      bounds = getIQRBounds(lastMarketData[itemId]);
      newSellPrice = getSellPrice(lastMarketData[itemId], newCity, bounds, itemId);
      if (newSellPrice <= 0) { showNoPriceWarning(newCity); return; }
      newMargin = calculateFlipMargin(row.buyMat.price, newSellPrice).margin;
    } else {
      itemId = row.item.id;
      bounds = getIQRBounds(lastMarketData[itemId]);
      newSellPrice = getSellPrice(lastMarketData[itemId], newCity, bounds, itemId);
      if (newSellPrice <= 0) { showNoPriceWarning(newCity); return; }
      const profit = newSellPrice * (1 - PREMIUM_TAX) - row.totalInputCost;
      newMargin = (profit / row.totalInputCost) * 100;
    }

  } else if (tableId === "farming-table") {
    // FARMING_PRODUCTION rows key the harvested good as `outputId` (there is no cropId).
    itemId = row.item.outputId;
    bounds = getIQRBounds(lastMarketData[itemId]);
    newSellPrice = getSellPrice(lastMarketData[itemId], newCity, bounds, itemId);
    if (newSellPrice <= 0) { showNoPriceWarning(newCity); return; }
    newMargin = calculateFlipMargin(row.buySeed.price, newSellPrice).margin;

  } else if (tableId === "rolling-table") {
    itemId = row.artId;
    bounds = getIQRBounds(lastMarketData[itemId]);
    newSellPrice = getSellPrice(lastMarketData[itemId], newCity, bounds, itemId);
    if (newSellPrice <= 0) { showNoPriceWarning(newCity); return; }
    const newSellRevenue = newSellPrice * (1 - PREMIUM_TAX);
    newMargin = row.rollCostSilver > 0
      ? ((newSellRevenue - row.rollCostSilver) / row.rollCostSilver) * 100
      : -999;

  } else if (tableId === "enchanting-table") {
    itemId = row.targetId;
    bounds = getIQRBounds(lastMarketData[itemId]);
    newSellPrice = getSellPrice(lastMarketData[itemId], newCity, bounds, itemId);
    if (newSellPrice <= 0) { showNoPriceWarning(newCity); return; }
    const revenue = newSellPrice * (1 - PREMIUM_TAX);
    newMargin = row.totalInputCost > 0 ? ((revenue - row.totalInputCost) / row.totalInputCost) * 100 : -999;

  } else if (tableId === "rerolling-table") {
    // Rerolling uses quality data — recalculate with the new sell price. The
    // city force is keyed per quality (sell = the `to` quality) so it lines up
    // with how render-rerolling and the price editor read it.
    if (!lastQualityMarketData) { showNoPriceWarning(newCity); return; }
    newSellPrice = getQualitySellPrice(lastQualityMarketData, row.item.id, row.transition.to, newCity);
    if (newSellPrice <= 0) { showNoPriceWarning(newCity); return; }
    const revenue = newSellPrice * (1 - PREMIUM_TAX);
    newMargin = row.totalInputCost > 0 ? ((revenue - row.totalInputCost) / row.totalInputCost) * 100 : -999;
    itemId = qualityOverrideKey(row.item.id, row.transition.to);
  }

  // Persist the sell-city force so it survives re-renders
  if (itemId) setCityForce(itemId, "sell", newCity);

  // Update only the profit cell — route and other columns stay unchanged
  const profitCell = document.querySelector(
    `[data-profit-cell="1"][data-table-id="${tableId}"][data-row-idx="${rowIdx}"]`
  );
  if (!profitCell) return;
  profitCell.className = getProfitClass(newMargin) + " profit-cell-clickable";
  profitCell.setAttribute("data-sell-city", newCity);
  const cityLabel = `<small style="color:#9ca3af;font-size:0.68rem;margin-left:3px">${newCity}</small>`;
  profitCell.innerHTML = newMargin.toFixed(2) + "%" + cityLabel;
}

// ── Rolling table group collapse ─────────────────────────────────────────────
const rollingCatCollapsed = new Set();
const rollingRollCollapsed = new Set();

function saveRollingCollapsed() {
  localStorage.setItem(
    "rolling-collapse",
    JSON.stringify({
      cats: [...rollingCatCollapsed],
      rolls: [...rollingRollCollapsed],
    }),
  );
}

function loadRollingCollapsed() {
  try {
    const { cats = [], rolls = [] } = JSON.parse(
      localStorage.getItem("rolling-collapse") || "{}",
    );
    cats.forEach((c) => rollingCatCollapsed.add(c));
    rolls.forEach((r) => rollingRollCollapsed.add(r));
  } catch (e) { /* stored state unreadable: start expanded */ }
}

function applyRollingCollapsed() {
  const tbody = document.querySelector("#rolling-table tbody");
  if (!tbody) return;
  Array.from(tbody.rows).forEach((row) => {
    if (row.dataset.headerCat) {
      const ind = row.querySelector(".cind");
      if (ind)
        ind.textContent = rollingCatCollapsed.has(row.dataset.headerCat)
          ? " ▶"
          : " ▼";
    } else if (row.dataset.headerRoll) {
      const catCollapsed = rollingCatCollapsed.has(row.dataset.rollCat);
      row.style.display = catCollapsed ? "none" : "";
      const rollKey = `${row.dataset.rollCat}:${row.dataset.headerRoll}`;
      const ind = row.querySelector(".cind");
      if (ind)
        ind.textContent = rollingRollCollapsed.has(rollKey) ? " ▶" : " ▼";
    } else if (row.dataset.cat) {
      const catCollapsed = rollingCatCollapsed.has(row.dataset.cat);
      const rollCollapsed = rollingRollCollapsed.has(row.dataset.rollKey);
      row.style.display = catCollapsed || rollCollapsed ? "none" : "";
    }
  });
}

// Collapse state changed → repaint, then let the search box have the last word.
// applyRollingCollapsed alone would unhide rows the active query filtered out
// (js/table-search.js hands display back to it only when the query is empty).
// The filter never calls back into this wrapper, so there is no recursion.
function refreshRollingRowDisplay() {
  applyRollingCollapsed();
  if (typeof applyTableSearchFilter === "function") {
    applyTableSearchFilter("rolling-table");
  }
}

function setupRollingGroupCollapse() {
  loadRollingCollapsed();
  const table = document.getElementById("rolling-table");
  if (!table) return;
  table.addEventListener("click", (e) => {
    const catRow = e.target.closest("tr[data-header-cat]");
    const rollRow = e.target.closest("tr[data-header-roll]");
    if (catRow) {
      const cat = catRow.dataset.headerCat;
      rollingCatCollapsed.has(cat)
        ? rollingCatCollapsed.delete(cat)
        : rollingCatCollapsed.add(cat);
      saveRollingCollapsed();
      refreshRollingRowDisplay();
    } else if (rollRow) {
      const key = `${rollRow.dataset.rollCat}:${rollRow.dataset.headerRoll}`;
      rollingRollCollapsed.has(key)
        ? rollingRollCollapsed.delete(key)
        : rollingRollCollapsed.add(key);
      saveRollingCollapsed();
      refreshRollingRowDisplay();
    }
  });
  tableState["rolling-table"]._postRender = applyRollingCollapsed;
}
