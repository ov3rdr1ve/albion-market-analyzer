/**
 * Per-table scan button handlers.
 * Each button fetches only the item IDs for its table, then renders it.
 */
console.log("[scan-handlers] loaded (includes Refresh Volume refetch)");

// Saddled-mount output IDs (the items the breeding chain ultimately sells).
// Used by the mount + faction-spending scans to additionally fetch quality=5
// prices for the masterpiece-bonus column. Excludes battlemounts (they're
// crafted, not bred) and recipes that don't consume a grown farm animal.
function getSaddledMountOutputIds() {
  if (typeof MOUNT_RECIPES === "undefined") return [];
  return MOUNT_RECIPES
    .filter((m) => m.craftType !== "battlemount"
                && m.materials.some((x) => /^T\d_FARM_/.test(x.matId)))
    .map((m) => m.id);
}

// Flatten qualityMap[id][5][city] -> mpMarketData[id][city] so it can be passed
// straight to findBestSellCity like ordinary market data.
function flattenQualityToMp(qualityMap) {
  const out = {};
  Object.keys(qualityMap || {}).forEach((id) => {
    const q5 = qualityMap[id]?.[5];
    if (q5) out[id] = q5;
  });
  return out;
}

// Minimum time the .scanning pulse/spinner stays visible. Without it, fast
// per-table fetches (a few items, ~100ms) clear the animation before the user
// can notice it. Mirrors the Refresh Volume button's MIN_VISIBLE_MS below.
const SCAN_MIN_VISIBLE_MS = 700;

/**
 * Dim and spin the numbers a scan is about to replace, for as long as it runs.
 *
 * The button's own .scanning pulse sits in the table header; the user is looking
 * at the profit column. beginRecalcCellMark marks that column the same way a
 * price edit or a captured price does (js/recalc-cell-mark.js) — and it covers
 * the FETCH, which is the part of a scan actually worth reporting.
 *
 * delayMs 0, unlike a re-render pass: that 100 ms delay exists so a pass which
 * finishes inside it never flashes, and a scan is never that fast.
 */
function beginScanMark(tableIds) {
  if (!tableIds.length || typeof beginRecalcCellMark !== "function") return;
  beginRecalcCellMark({ tableIds, delayMs: 0 });
}

/** Called the moment the rows are redrawn — never from a `finally` that also
 *  waits out SCAN_MIN_VISIBLE_MS, which would leave fresh numbers spinning. */
function endScanMark() {
  if (typeof clearRecalcCellMark !== "function") return;
  // A scheduler pass that started during the fetch owns the marks now, and its
  // own end clears them (js/app.js installRenderScheduler).
  if (typeof isRerenderBusy === "function" && isRerenderBusy()) return;
  clearRecalcCellMark();
}

/**
 * @param {string|string[]} [tables] the table(s) renderFn draws, marked while
 *   the scan runs. Two buttons draw two tables (Faction Spending also redraws
 *   Mounts; Gathering also redraws Journal Filling).
 */
function wrapScanButton(btnId, label, fetchFn, renderFn, tables = []) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const tableIds = [].concat(tables);
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = tx("Scanning...", "r_scanning");
    // .scanning drives the CSS pulse + spinner — same style/animation the
    // Refresh Volume button uses, now shared by every scan button.
    btn.classList.add("scanning");
    beginScanMark(tableIds);
    const t0 = Date.now();
    try {
      await fetchFn();
      renderFn();
      endScanMark();
      // Every per-table scan feeds the same maps a full scan does, so it is
      // worth keeping for the next launch. The write is deferred, so pressing
      // three table buttons in a row still costs one file.
      if (typeof persistScanPrices === "function") persistScanPrices();
      // Hold the animation for a beat so quick fetches don't flash by.
      const elapsed = Date.now() - t0;
      if (elapsed < SCAN_MIN_VISIBLE_MS) {
        await new Promise((r) => setTimeout(r, SCAN_MIN_VISIBLE_MS - elapsed));
      }
    } catch (e) {
      endScanMark();
      console.error(`${label} scan failed:`, e);
      showFetchError(e.message);
    } finally {
      btn.classList.remove("scanning");
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}

/**
 * The twelve feeder catalogs, as {tableId: ids[]}, for bmScanFeederTables.
 *
 * Read out of the search-fetch registry (js/table-search-fetch.js) rather than
 * listed again here — that map is already the one place a table's id universe is
 * named. An enumerator that throws drops only its own table; if every one of
 * them fails the result is empty, which bmScanFeederTables reads as "redraw
 * everything" rather than as "nothing to do".
 */
function bmFeederSources() {
  const registry = (typeof window !== "undefined" && window.tableSources)
    ? window.tableSources() : null;
  if (!registry || typeof BM_SCAN_FEEDERS === "undefined") return null;
  const out = {};
  BM_SCAN_FEEDERS.forEach((tableId) => {
    const fn = registry[tableId];
    if (typeof fn !== "function") return;
    try {
      const ids = fn();
      if (Array.isArray(ids)) out[tableId] = ids;
    } catch (e) {
      console.warn(`[BM scan] ${tableId} catalog unavailable:`, e.message);
    }
  });
  return out;
}

/**
 * Recompute one feeder against the current price maps.
 *
 * The same dispatch renderDeferredTable does (js/render-gating.js), without its
 * "was it deferred" gate: here the prices just changed under every one of them.
 */
function bmRenderFeeder(tableId) {
  if (typeof TABLE_RENDERERS === "undefined") return;
  const render = globalThis[TABLE_RENDERERS[tableId]];
  if (typeof render !== "function") return;
  const isQuality = typeof QUALITY_TABLES !== "undefined" && QUALITY_TABLES.has(tableId);
  if (isQuality && !lastQualityMarketData) return;
  try {
    render(isQuality ? lastQualityMarketData : lastMarketData);
  } catch (e) {
    // One feeder that throws must not cost the board its redraw.
    console.error(`[BM scan] ${tableId}:`, e);
  }
}

function setupPerTableScanButtons() {
  // Rolling
  wrapScanButton("scan-rolling-btn", "Scan Rolling", async () => {
    const ids = getRollingItemIds();
    const data = await fetchPricesBatch(ids);
    if (!lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
  }, () => renderRollingTable(lastMarketData), "rolling-table");

  // Crafting — needs recipe pre-fetch
  wrapScanButton("scan-crafting-btn", "Scan Crafting", async () => {
    const recipeTargets = CRAFTING_ITEMS.map((i) => i.id);
    // Also fetch @1-@4 recipes for T4-T8 gear items
    CRAFTING_ITEMS.forEach((i) => {
      if (i.isGearRecipe && !i.id.includes("@")) {
        const tier = getTierFromId(i.id);
        if (tier >= 4 && tier <= 8) {
          for (let enchLevel = 1; enchLevel <= 4; enchLevel++) {
            recipeTargets.push(i.id + "@" + enchLevel);
          }
        }
      }
    });
    await Promise.all(recipeTargets.map((id) => fetchCraftingRecipe(id)));
    const ids = getCraftingItemIds();
    const data = await fetchPricesBatch(ids);
    if (!lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
  }, () => renderCraftingTable(lastMarketData), "crafting-table");

  // Crafting Planner — like Crafting (needs recipe pre-fetch), plus the refining
  // chain intermediates and the crafting journals so refine-vs-buy at each tier
  // and the journal-fill column populate in one click.
  wrapScanButton("scan-craft-planner-btn", "Scan Planner", async () => {
    const recipeTargets = CRAFTING_ITEMS.filter((i) => !String(i.id).includes("@")).map((i) => i.id);
    await Promise.all(recipeTargets.map((id) => fetchCraftingRecipe(id)));
    const ids = getCraftPlannerItemIds();
    const data = await fetchPricesBatch(ids);
    if (!lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
  }, () => renderCraftPlannerTable(lastMarketData), "craft-planner-table");

  // Flipping
  wrapScanButton("scan-flipping-btn", "Scan Flipping", async () => {
    const ids = getFlippingItemIds();
    const data = await fetchPricesBatch(ids);
    if (!lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
  }, () => renderFlippingTable(lastMarketData), "flipping-table");

  // Skins Trading — pure market lookup of tradeable vanity unlock-token listings
  wrapScanButton("scan-skins-btn", "Scan Skins", async () => {
    const ids = getSkinsItemIds();
    const data = await fetchPricesBatch(ids);
    if (!lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
  }, () => renderSkinsTradingTable(lastMarketData), "skins-trading-table");

  // Laborers — trophy journals only; pure market lookup, no recipe pre-fetch
  wrapScanButton("scan-laborers-btn", "Scan Laborers", async () => {
    const ids = getLaborersItemIds();
    const data = await fetchPricesBatch(ids);
    if (!lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
  }, () => renderLaborersTable(lastMarketData), "laborers-table");

  // Building Costs — construction materials, laborer contracts and furniture;
  // pure market lookup (build recipes come from buildings.xml, not the API).
  wrapScanButton("scan-buildings-btn", "Scan Buildings", async () => {
    const ids = getBuildingsItemIds();
    // Plus the journals of the laborer the table is pinned to, so the Best Journal
    // column fills from this scan alone. Only the pinned laborer: all eleven of
    // them with their payloads IS the Laborers scan.
    const slug = getBuildingsLaborerSlug();
    if (slug) ids.push(...getLaborerJournalScanIds(slug).filter((id) => !ids.includes(id)));
    const data = await fetchPricesBatch(ids);
    if (!lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
  }, () => renderBuildingsTable(lastMarketData), "buildings-table");

  // Transport / Refining
  wrapScanButton("scan-transport-btn", "Scan Transport", async () => {
    const ids = getTransportItemIds();
    const data = await fetchPricesBatch(ids);
    if (!lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
  }, () => renderTransportTable(lastMarketData), "transport-table");

  // Consumables — needs recipe pre-fetch
  wrapScanButton("scan-consumable-btn", "Scan Consumables", async () => {
    const recipeTargets = CONSUMABLES.map((i) => i.id);
    await Promise.all(recipeTargets.map((id) => fetchCraftingRecipe(id)));
    const ids = getConsumableItemIds();
    const data = await fetchPricesBatch(ids);
    if (!lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
  }, () => renderConsumableTable(lastMarketData), "consumable-table");

  // Mounts — also fetches masterpiece (quality=5) prices for saddled-mount
  // outputs in parallel so the MP-bonus annotation has data on first render.
  wrapScanButton("scan-mounts-btn", "Scan Mounts", async () => {
    const ids = getMountsItemIds();
    const mpIds = getSaddledMountOutputIds();
    const [data, mpQualityMap] = await Promise.all([
      fetchPricesBatch(ids),
      mpIds.length > 0 ? fetchPricesBatchWithQualities(mpIds, [5]) : Promise.resolve({}),
    ]);
    if (!lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
    if (!lastMpMarketData) lastMpMarketData = {};
    mergeFlatPrices(lastMpMarketData, flattenQualityToMp(mpQualityMap));
  }, () => renderMountsTable(lastMarketData), "mounts-table");

  // Faction Spending — fetches FP-priced items AND the mount-chain items so
  // both the Direct silver/FP and the If-Bred silver/FP can be computed in
  // one click. Without the mount items, the breed-comparison column would
  // show "—" for every Baby row. Also pulls quality=5 mount prices for the
  // masterpiece annotation (parallel fetch).
  wrapScanButton("scan-faction-spending-btn", "Scan Faction Spending", async () => {
    const fsIds = getFactionSpendingItemIds();
    const mountIds = typeof getMountsItemIds === "function" ? getMountsItemIds() : [];
    const ids = Array.from(new Set([...fsIds, ...mountIds]));
    const mpIds = getSaddledMountOutputIds();
    const [data, mpQualityMap] = await Promise.all([
      fetchPricesBatch(ids),
      mpIds.length > 0 ? fetchPricesBatchWithQualities(mpIds, [5]) : Promise.resolve({}),
    ]);
    if (!lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
    if (!lastMpMarketData) lastMpMarketData = {};
    mergeFlatPrices(lastMpMarketData, flattenQualityToMp(mpQualityMap));
  }, () => {
    // Render mounts first so the breed silver/FP lookup is fresh when
    // faction-spending reads tableState["mounts-table"].data.
    try { renderMountsTable(lastMarketData); } catch(e) { console.error("renderMountsTable:", e); }
    renderFactionSpendingTable(lastMarketData);
  }, ["mounts-table", "faction-spending-table"]);

  // Farming
  wrapScanButton("scan-farming-btn", "Scan Farming", async () => {
    const ids = getFarmingItemIds();
    const data = await fetchPricesBatch(ids);
    if (!lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
  }, () => renderFarmingTable(lastMarketData), "farming-table");

  // Gathering — pure market lookup of raw resource sell prices, no recipes.
  // Also pulls empty/full journal prices so the Best Journal column + the
  // Journal Filling companion table populate in the same scan.
  wrapScanButton("scan-gathering-btn", "Scan Gathering", async () => {
    const ids = getGatheringItemIds();
    if (typeof getJournalItemIds === "function") ids.push(...getJournalItemIds());
    // Plus what a laborer would return from those journals, for the Feed a
    // Laborer column both this table and its Journal Filling companion carry.
    if (typeof getJournalPayloadScanIds === "function") ids.push(...getJournalPayloadScanIds());
    const data = await fetchPricesBatch([...new Set(ids)]);
    if (!lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
  }, () => {
    renderGatheringTable(lastMarketData);
    try { renderJournalFillingTable(lastMarketData); } catch (e) { console.error("renderJournalFillingTable:", e); }
  }, ["gathering-table", "journal-filling-table"]);

  // Journal Filling — empty/full journal prices for every gathering, trophy and
  // General journal, so the companion table can be refreshed on its own.
  wrapScanButton("scan-journals-btn", "Scan Journals", async () => {
    const ids = getJournalItemIds();
    // Journal payloads too, so the Feed a Laborer column fills from this scan
    // alone rather than needing a Gathering or Laborers scan first.
    if (typeof getJournalPayloadScanIds === "function") ids.push(...getJournalPayloadScanIds());
    const data = await fetchPricesBatch([...new Set(ids)]);
    if (!lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
  }, () => renderJournalFillingTable(lastMarketData), "journal-filling-table");

  // Volume — refetches prices+history for every item currently in
  // lastMarketData so volume_24h numbers actually move, then re-renders.
  // Always clickable: with no data yet the handler bootstraps a full market
  // scan (same as "Scan Market Now"); with data it does the fast refresh.
  const volBtn = document.getElementById("scan-volume-btn");
  if (volBtn) {
    volBtn.disabled = false;
    const statusEl = document.getElementById("volume-refresh-status");
    volBtn.addEventListener("click", async () => {
      console.log("[Volume] Refresh clicked");
      // No market data yet → run the same full scan as "Scan Market Now".
      // It populates lastMarketData and renderAllTables() fills every table,
      // including this one, so the button is never a dead end on a fresh page.
      if (!lastMarketData) {
        volBtn.disabled = true;
        volBtn.textContent = "Scanning...";
        volBtn.classList.add("scanning");
        if (statusEl) statusEl.textContent = "running full market scan…";
        try {
          if (typeof window.runMarketScan === "function") {
            await window.runMarketScan();
          } else {
            // Fallback if the main scan wasn't exposed for some reason.
            document.getElementById("scan-trigger")?.click();
          }
          if (statusEl) {
            statusEl.textContent = lastMarketData
              ? `scanned ${new Date().toLocaleTimeString()}`
              : "scan returned no data — see console";
          }
        } catch (e) {
          console.error("Volume bootstrap scan failed:", e);
          showFetchError(e.message);
          if (statusEl) statusEl.textContent = "scan failed — see console";
        } finally {
          volBtn.classList.remove("scanning");
          volBtn.disabled = false;
          volBtn.textContent = "Refresh Volume";
        }
        return;
      }
      // Only refetch items that are actually visible in the volume table —
      // i.e. items whose row survived the totalVol > 0 filter in
      // renderVolumeTable. Refetching the full lastMarketData (~9k items) took
      // 90+ seconds at 150/chunk; the visible set is typically a few hundred
      // and finishes in under 10 seconds.
      const cachedRows = (typeof tableState !== "undefined"
        && tableState["volume-table"]?.data) || null;
      const idsFromTable = cachedRows
        ? cachedRows.map((r) => r.itemId).filter((id) => !!id)
        : null;
      const ids = idsFromTable && idsFromTable.length > 0
        ? idsFromTable
        : Object.keys(lastMarketData);
      volBtn.disabled = true;
      volBtn.textContent = "Scanning...";
      volBtn.classList.add("scanning");
      beginScanMark(["volume-table"]);
      if (statusEl) statusEl.textContent = `fetching ${ids.length} items…`;
      const t0 = Date.now();
      // Min-visible duration: tiny fetches (3 items / 100ms) used to flash by
      // before the user noticed. Hold the scanning state for at least 700ms.
      const MIN_VISIBLE_MS = 700;
      try {
        console.log(`[Volume] Refetching ${ids.length} items`);
        const data = await fetchPricesBatch(ids);
        applyScanPatch(lastMarketData, data);
        if (typeof persistScanPrices === "function") persistScanPrices();
        renderVolumeTable(lastMarketData);
        endScanMark();
        const elapsed = Date.now() - t0;
        if (elapsed < MIN_VISIBLE_MS) {
          await new Promise((r) => setTimeout(r, MIN_VISIBLE_MS - elapsed));
        }
        if (statusEl) {
          const secs = ((Date.now() - t0) / 1000).toFixed(1);
          statusEl.textContent = `refreshed ${new Date().toLocaleTimeString()} (${ids.length} items, ${secs}s)`;
        }
      } catch (e) {
        endScanMark();
        console.error("Volume scan failed:", e);
        showFetchError(e.message);
        if (statusEl) statusEl.textContent = "refresh failed — see console";
      } finally {
        volBtn.classList.remove("scanning");
        volBtn.disabled = false;
        volBtn.textContent = "Refresh Volume";
      }
    });
  }

  // Volume search box — re-render the volume table on each keystroke. The
  // filter lives in updateTableDisplay (reads #volume-search live), so this
  // just needs to trigger a re-render; state.data stays the full row set.
  const volSearch = document.getElementById("volume-search");
  if (volSearch) {
    volSearch.addEventListener("input", () => {
      if (typeof updateTableDisplay === "function") {
        updateTableDisplay("volume-table");
      }
    });
  }

  // Transmute
  wrapScanButton("scan-transmute-btn", "Scan Transmute", async () => {
    const ids = getTransmuteItemIds();
    const data = await fetchPricesBatch(ids);
    if (!lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
  }, () => renderTransmuteTable(lastMarketData), "transmute-table");

  // Enchanting (moved from app.js)
  wrapScanButton("scan-enchanting-btn", "Scan Enchanting", async () => {
    const enchantIds = getAllEnchantItemIds();
    const data = await fetchPricesBatch(enchantIds);
    if (!lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
  }, () => renderEnchantingTable(lastMarketData), "enchanting-table");

  // Rerolling (moved from app.js) — fetches quality-tier prices (q1-q5) into
  // lastQualityMarketData rather than the default best-quality lastMarketData,
  // so the fetchFn assigns there. Routed through wrapScanButton like every
  // other table so it gets the same .scanning pulse/spinner animation.
  wrapScanButton("scan-rerolling-btn", "Scan Rerolling", async () => {
    const qualityIds = getQualityItemIds();
    const data = await fetchPricesBatchWithQualities(qualityIds, [1, 2, 3, 4, 5]);
    // Through applyQualityScanPatch, not a bare assignment: assigning the map
    // erased every captured quality cell the monitor had contributed, and
    // dropped the items this scan does not cover along with them.
    if (!lastQualityMarketData) lastQualityMarketData = {};
    applyQualityScanPatch(lastQualityMarketData, data);
  }, () => renderRerollingTable(lastQualityMarketData), "rerolling-table");

  // Black Market board — the one table with no catalog of its own: it re-ranks
  // rows the twelve feeders already computed (js/render-bm-board.js). So this
  // button re-reads the ids the Black Market is known to quote plus the legs the
  // rows on screen are priced from (js/bm-board-scan.js), recomputes only the
  // feeders those ids can move, and redraws the board over them.
  //
  // With nothing stored yet there is nothing to re-read, and the board would
  // stay empty however long the button spun — so a cold press runs the full
  // market scan instead, the way the Refresh Volume button bootstraps above.
  let bmFullScan = false;
  let bmFeeders = [];
  wrapScanButton("scan-bm-board-btn", "Scan Black Market", async () => {
    bmFullScan = false;
    bmFeeders = [];
    const { ids, qualityIds } = getBlackMarketScanIds({
      flat: typeof lastMarketData !== "undefined" ? lastMarketData : null,
      quality: typeof lastQualityMarketData !== "undefined" ? lastQualityMarketData : null,
      rows: (typeof tableState !== "undefined" && tableState["bm-board-table"]?.data) || [],
    });
    if (!ids.length) {
      bmFullScan = true;
      if (typeof window.runMarketScan === "function") await window.runMarketScan();
      else document.getElementById("scan-trigger")?.click();
      return;
    }
    console.log(`[BM scan] refetching ${ids.length} items (${qualityIds.length} per-quality)`);
    const [data, qmap] = await Promise.all([
      fetchPricesBatch(ids),
      qualityIds.length
        ? fetchPricesBatchWithQualities(qualityIds, [1, 2, 3, 4, 5])
        : Promise.resolve(null),
    ]);
    // Patched in, never assigned: a bare assignment wipes the prices the live
    // capture contributed for everything this targeted scan does not cover.
    if (!lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
    if (qmap) {
      if (!lastQualityMarketData) lastQualityMarketData = {};
      applyQualityScanPatch(lastQualityMarketData, qmap);
    }
    bmFeeders = bmScanFeederTables(ids, bmFeederSources());
  }, () => {
    // runMarketScan already drew every table, the board included.
    if (bmFullScan) return;
    // Feeders first: the board projects over their tableState caches, so a
    // fresh price map alone would redraw the same rows it already had.
    bmFeeders.forEach(bmRenderFeeder);
    renderBlackMarketBoard();
  }, "bm-board-table");
}
