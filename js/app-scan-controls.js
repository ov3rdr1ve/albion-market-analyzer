/**
 * Boot step: the master "Scan Market Now" button, the per-table scan buttons,
 * the profit-cell sell-city picker, the row expand / detail toggles and the
 * sortable headers.
 *
 * Split out of js/app.js (800-line limit). Called from its DOMContentLoaded
 * handler.
 */
function setupScanAndTableControls() {
  const scanBtn = document.getElementById("scan-trigger");

  if (scanBtn) {
    const runScan = async () => {
      scanBtn.disabled = true;
      scanBtn.textContent = "Fetching Recipes...";
      // Same .scanning pulse/spinner the per-table scan buttons use.
      scanBtn.classList.add("scanning");

      try {
        // Phase 1: Pre-fetch all crafting/consumable recipes concurrently so that
        // getAllRequiredItemIds() can include every ingredient in the price request.
        const recipeTargets = [
          ...CRAFTING_ITEMS.map((i) => i.id),
          ...CONSUMABLES.map((i) => i.id),
        ];
        await Promise.all(recipeTargets.map((id) => fetchCraftingRecipe(id)));

        // Phase 2: Fetch market prices for all items + discovered ingredients.
        // Also fetch quality data (Rerolling) and Masterpiece quality=5 (Mounts /
        // Faction Spending MP column) in parallel so a single click populates
        // every source table the joined-summary reads from.
        scanBtn.textContent = "Scanning Market...";
        // Dim and spin every number this scan is about to replace, for the whole
        // fetch — the same report a price edit and a captured price already give
        // (js/recalc-cell-mark.js). The full list, unfiltered: a collapsed table
        // has a 0x0 rect and is thrown out for one read, so there is nothing to
        // gain by planning the pass first. delayMs 0 because a scan is never the
        // sub-100 ms pass the anti-flash delay exists for.
        if (typeof beginRecalcCellMark === "function") {
          beginRecalcCellMark({
            tableIds: [...RENDER_ORDER, ...BOARD_TABLES, CRAFT_LIST_TABLE],
            delayMs: 0,
          });
        }
        const itemsToFetch = getAllRequiredItemIds();
        const qualityIds = typeof getQualityItemIds === "function" ? getQualityItemIds() : [];
        const mpIds = typeof getSaddledMountOutputIds === "function" ? getSaddledMountOutputIds() : [];

        const [data, qualityMap, mpQualityMap] = await Promise.all([
          fetchPrices(itemsToFetch),
          qualityIds.length > 0
            ? fetchPricesBatchWithQualities(qualityIds, [1, 2, 3, 4, 5])
            : Promise.resolve(null),
          mpIds.length > 0
            ? fetchPricesBatchWithQualities(mpIds, [5])
            : Promise.resolve({}),
        ]);
        if (Object.keys(data).length === 0) {
          if (typeof clearRecalcCellMark === "function") clearRecalcCellMark();
          return;
        }

        // A full scan used to ASSIGN these three maps, and that threw away two
        // kinds of price nobody could get back: every item fetched on demand
        // rather than by the required-id list (enchant variants, planner
        // variants, buildings, the search box), and any city AODP happens to
        // have no data for today — the API answers with a zero cell there, and
        // a zero is "not observed", not "gone". Same fold as every per-table
        // scan button now (js/captured-prices-store.js).
        if (!lastMarketData) lastMarketData = {};
        applyScanPatch(lastMarketData, data);
        if (qualityMap) {
          if (!lastQualityMarketData) lastQualityMarketData = {};
          applyQualityScanPatch(lastQualityMarketData, qualityMap);
        }
        // applyScanPatch only folds captures back for the items the scan
        // carried. The rest of the capture map still has to land on top,
        // newest-wins: a capture survives where it is fresher than what the
        // scan returned, or where the scan has no price for that side at all.
        if (typeof getCapturedPrices === "function") {
          const captured = getCapturedPrices();
          mergeCapturedIntoFlat(lastMarketData, flattenCaptured(captured, 1));
          if (lastQualityMarketData) mergeCapturedIntoQuality(lastQualityMarketData, captured);
        }
        if (typeof flattenQualityToMp === "function") {
          if (!lastMpMarketData) lastMpMarketData = {};
          mergeFlatPrices(lastMpMarketData, flattenQualityToMp(mpQualityMap));
        }
        // Keep the scan: the next launch restores these tables instead of
        // making the user sit through the whole fetch again.
        if (typeof persistScanPrices === "function") persistScanPrices();
        // The merged map, not the raw patch: `data` used to BE lastMarketData,
        // and since the scan folds rather than assigns it no longer is.
        renderAllTables(lastMarketData);
        // Right after the draw, not in the finally: what is on screen now IS
        // the new number.
        if (typeof clearRecalcCellMark === "function") clearRecalcCellMark();
      } finally {
        // A throw anywhere above must not leave the whole app spinning. Idempotent
        // on the success path, where the draw already cleared; skipped when a
        // scheduler pass started meanwhile and owns the marks itself.
        if (typeof clearRecalcCellMark === "function"
            && !(typeof isRerenderBusy === "function" && isRerenderBusy())) {
          clearRecalcCellMark();
        }
        scanBtn.classList.remove("scanning");
        scanBtn.disabled = false;
        scanBtn.textContent = "Scan Market Now";
      }
    };

    scanBtn.addEventListener("click", runScan);
    // Expose so the "Refresh Volume" button can bootstrap a full scan when no
    // market data has been pulled yet (runScan is scoped to this DOMContentLoaded
    // callback, so it isn't a global on its own).
    window.runMarketScan = runScan;
  }

  setupPerTableScanButtons();

  // ── Sell-city picker for profit cells ──────────────────────────────────────
  (function setupSellCityPicker() {
    const picker = document.createElement("div");
    picker.id = "sell-city-picker";
    document.body.appendChild(picker);

    let _activePicker = null;

    function closePicker() {
      picker.style.display = "none";
      _activePicker = null;
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePicker();
    });

    document.addEventListener("click", (e) => {
      const td = e.target.closest("[data-profit-cell='1']");
      if (!td) {
        if (!e.target.closest("#sell-city-picker")) closePicker();
        return;
      }
      e.stopPropagation();

      const tableId = td.getAttribute("data-table-id");
      const rowIdx = parseInt(td.getAttribute("data-row-idx"), 10);
      const currentCity = td.getAttribute("data-sell-city");

      _activePicker = { tableId, rowIdx };

      const row = tableState[tableId]?.data?.[rowIdx];
      const buyCity = row ? getBuyCityForRow(tableId, row) : null;

      picker.innerHTML = "";
      SELL_CITIES.forEach((city) => {
        const isCurrent = city === currentCity;
        const isDisabled = !isBlackRedZoneEnabled() && buyCity
          && isInvalidCrossRoute(buyCity, city);
        const item = document.createElement("div");
        item.className = "city-picker-item" +
          (isCurrent ? " city-picker-current" : "") +
          (isDisabled ? " city-picker-disabled" : "");
        item.textContent = city;
        if (!isDisabled) {
          item.addEventListener("click", (ev) => {
            ev.stopPropagation();
            closePicker();
            applyRowCityOverride(tableId, rowIdx, city);
          });
        }
        picker.appendChild(item);
      });

      const rect = td.getBoundingClientRect();
      const pickerH = SELL_CITIES.length * 32 + 12;
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow >= pickerH ? rect.bottom + 2 : rect.top - pickerH - 2;
      picker.style.left = Math.min(rect.left, window.innerWidth - 170) + "px";
      picker.style.top = top + "px";
      picker.style.display = "block";
    });
  })();
  // ────────────────────────────────────────────────────────────────────────────

  // Crafting + Consumables tables: expand/collapse enchant variants. The
  // toggle's data-expand-table attribute tells us which table to refresh
  // (default = crafting-table for backwards compatibility).
  document.addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-expand-craft]");
    if (toggle) {
      const baseId = toggle.dataset.expandCraft;
      const tableId = toggle.dataset.expandTable || "crafting-table";
      // Flipping has a second way a base can be open — the auto-reveal pass
      // (js/flip-auto-reveal.js) — so its toggle owns both states or the ▼ of a
      // row nobody clicked would refuse to close. Every other table is unchanged.
      if (tableId === "flipping-table" && typeof flipToggleExpand === "function") {
        if (flipToggleExpand(baseId) && typeof ensureFlipVariantPrices === "function") {
          ensureFlipVariantPrices({ baseId });
        }
      } else if (expandedCraftItemsFor(tableId).has(baseId)) {
        expandedCraftItemsFor(tableId).delete(baseId);
      } else {
        expandedCraftItemsFor(tableId).add(baseId);
        // Craft planner skips @n ids in its scan, so newly-revealed variant
        // rows start unpriced — lazily fetch just this base's variant prices.
        if (tableId === "craft-planner-table" && typeof ensurePlannerVariantPrices === "function") {
          ensurePlannerVariantPrices({ baseId });
        }
        if (tableId === "flipping-table" && typeof ensureFlipVariantPrices === "function") {
          ensureFlipVariantPrices({ baseId });
        }
      }
      // Flipping BUILDS its variant rows at render time (they are route
      // searches, too costly to compute-then-hide), so replaying the cached row
      // set would show nothing — it needs its renderer, not updateTableDisplay.
      if (tableId === "flipping-table" && typeof renderFlippingTable === "function"
          && typeof lastMarketData !== "undefined" && lastMarketData) {
        renderFlippingTable(lastMarketData);
      } else {
        updateTableDisplay(tableId);
      }
    }
  });


  // Consumables: open/close a row's "alternative routes" panel — the ingredients
  // the row buys at market that it could chain-craft instead, with what each
  // would save. The row itself never changes price; the panel is the comparison.
  document.addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-cons-alt-toggle]");
    if (!toggle || typeof consumableOpenAltRows === "undefined") return;
    const rowKey = toggle.dataset.consAltToggle;
    if (consumableOpenAltRows.has(rowKey)) {
      consumableOpenAltRows.delete(rowKey);
    } else {
      consumableOpenAltRows.add(rowKey);
    }
    updateTableDisplay("consumable-table");
  });

  // Top-10 boards: open/close a row's detail panel — the feeder table's own row,
  // grafted in, so the per-unit prices behind the board's aggregate Input Cost
  // are editable in place. The key is board-scoped, so it names its own table.
  document.addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-detail-toggle]");
    if (!toggle || typeof jbOpenDetailRows === "undefined") return;
    const detailKey = toggle.dataset.detailToggle;
    if (jbOpenDetailRows.has(detailKey)) {
      jbOpenDetailRows.delete(detailKey);
    } else {
      jbOpenDetailRows.add(detailKey);
    }
    updateTableDisplay(detailKey.split("::")[0]);
  });

  // Setup sorting for all tables
  document.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", (e) => {
      const tableId = th.closest("table").id;
      // A header can carry a second sort key of its own — the Crafting Planner's
      // Sell header sorts by price, its small "vol" link by 24h sell volume.
      const sub = e.target.closest("[data-sort-sub]");
      const sortCol = sub ? sub.getAttribute("data-sort-sub") : th.getAttribute("data-sort");
      const state = tableState[tableId];

      // Update state
      if (state.sortCol === sortCol) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.secondarySortCol = state.sortCol;
        state.secondarySortDir = state.sortDir;
        state.sortCol = sortCol;
        state.sortDir = "desc";
      }

      saveCurrentSortState();

      // Update header UI — the arrow goes on whichever key was clicked.
      const tr = th.closest("tr");
      tr.querySelectorAll("th, [data-sort-sub]").forEach((t) =>
        t.classList.remove("sort-asc", "sort-desc"),
      );
      (sub || th).classList.add(`sort-${state.sortDir}`);

      // Re-render
      updateTableDisplay(tableId);
    });
  });
}
