/**
 * Albion Market Application Main Controller
 * Binds data fetching to calculation logic and UI rendering.
 */

document.addEventListener("DOMContentLoaded", async () => {
  if (typeof bootStage === "function") bootStage("Building tables…");

  // Before anything can ask for a redraw: every price edit and header toggle
  // below goes through scheduleRerender().
  installRenderScheduler();

  // Wrap each data table in a horizontal-scroll container so wide tables
  // (mounts breeding rows etc.) scroll inside their own box instead of
  // pushing the page wider than the viewport.
  document.querySelectorAll("table.data-table").forEach((tbl) => {
    if (tbl.parentElement?.classList.contains("table-wrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    tbl.parentNode.insertBefore(wrap, tbl);
    wrap.appendChild(tbl);
  });

  loadOverridesFromStorage();
  loadVolumeOverridesFromStorage();
  loadCityForcesFromStorage();
  if (typeof loadCraftListFromStorage === "function") loadCraftListFromStorage();
  // The catalogs no longer ride along as deferred tags in index.html — they
  // are injected after first paint (js/catalog-loader.js), and every merge
  // below walks CRAFTING_ITEMS & co. This is the first reader, so wait here.
  // The guards below stay: one failed catalog file must not kill boot.
  if (typeof bootStage === "function") bootStage("Loading catalogs…");
  if (typeof catalogsReady !== "undefined") await catalogsReady;
  mergeCatalogsIntoTables();

  setupCollapsibleTables();
  setupRollingGroupCollapse();
  if (typeof setupTableSearch === "function") setupTableSearch();
  document
    .getElementById("collapse-all-btn")
    .addEventListener("click", collapseAll);
  document
    .getElementById("expand-all-btn")
    .addEventListener("click", expandAll);
  // Clear / Export / Import buttons live in js/settings-transfer-ui.js.
  if (typeof setupSettingsTransferControls === "function") {
    setupSettingsTransferControls();
  }

  setupToolbarControls();

  setupPriceEditor();

  setupScanAndTableControls();

  // ── Prices from earlier sessions ──────────────────────────────────────────
  // Two sources, restored in the order they must be folded: the last scan off
  // disk first (js/scan-price-store.js), then the monitor's own captures on
  // top of it newest-wins (js/captured-prices-store.js). Both are the user's
  // data; neither is worth making them fetch again just because the app was
  // closed. One render at the end, once both are in.
  (async () => {
    let restored = false;

    // The renders this pass ends in read the injected catalogs too
    // (js/catalog-loader.js). The handler above waits on the same promise
    // before the merges, so by here they are normally in — awaited again so
    // this pass can never paint a row from an empty catalog.
    if (typeof catalogsReady !== "undefined") await catalogsReady;

    if (typeof bootStage === "function") bootStage("Restoring saved prices…");

    if (typeof hydrateScanPrices === "function") {
      const scan = await hydrateScanPrices();
      if (scan) {
        if (!lastMarketData) lastMarketData = {};
        if (!lastQualityMarketData) lastQualityMarketData = {};
        // Folded, not assigned: the monitor auto-starts before this resolves,
        // so a player already standing in a market can have live cells in these
        // maps by now, and assigning a whole item over them dropped the sides
        // the file happens not to carry. mergeEntry keeps both.
        mergeFlatPrices(lastMarketData, scan.flat);
        // A saved cell can hold a price AODP invented from its 24h history that
        // every other city's real price contradicts (a 712,435 Caerleon ask
        // against ~7,000 elsewhere). Dropped before the captures fold on top, so
        // a real captured ask is what the tables read.
        if (typeof guardInventedPriceMap === "function") guardInventedPriceMap(lastMarketData);
        mergeQualityPrices(lastQualityMarketData, scan.quality);
        if (Object.keys(scan.mp).length > 0) {
          if (!lastMpMarketData) lastMpMarketData = {};
          mergeFlatPrices(lastMpMarketData, scan.mp);
        }
        restored = true;
      }
    }

    if (typeof hydrateCapturedPrices === "function") {
      // Merges into whatever the auto-started monitor has already captured
      // during this boot — see js/captured-prices-store.js.
      const captured = await hydrateCapturedPrices();
      const flat = flattenCaptured(captured, 1);
      if (Object.keys(flat).length > 0) {
        if (!lastMarketData) lastMarketData = {};
        if (!lastQualityMarketData) lastQualityMarketData = {};
        mergeCapturedIntoFlat(lastMarketData, flat);
        mergeCapturedIntoQuality(lastQualityMarketData, captured);
        restored = true;
      }
    }

    if (restored) {
      // Named separately from the restore above: reading the two price files is
      // I/O, this is the pass over every table, and the boot line
      // (js/boot-timing.js) can only tell them apart if they are announced apart.
      if (typeof bootStage === "function") bootStage("Computing tables…");
      // Chunked, not the synchronous pass (js/render-schedule.js): the tables on
      // screen are drawn first, the collapsed feeders and the craft list behind
      // them, and the thread is handed back between phases — which is what lets
      // the loading rows keep spinning and the page keep scrolling while it runs.
      //
      // Nothing is covering the app during any of this. Each table wears its own
      // loading row until its own render lands (js/table-loading-mark.js), so a
      // table that is still computing says so where the user is looking instead
      // of behind a full-screen curtain held until the last one finishes.
      await renderAllTablesBoot(lastMarketData);
    }
  })().finally(() => {
    // Nothing is owed a redraw any more: the placeholder rows the craft list
    // paints before prices exist are the app's normal "you have not scanned"
    // state again (js/boot-state.js).
    if (typeof setBootFilling === "function") setBootFilling(false);
    // Whatever a cut-short or failed pass never reached: a loading row nothing
    // is computing spins for ever.
    if (typeof clearTablesLoading === "function") clearTablesLoading();
    if (typeof bootFinish === "function") bootFinish();
  }).catch((e) => {
    // A throw in the restore pass used to reject the chain unhandled: nothing
    // downstream listened, so a half-finished boot render failed silently.
    // .finally() runs the cleanup above first and re-propagates; this logs it.
    console.error("[boot] restore failed:", e);
  });

  // A deferred write must not be lost to the window closing or being hidden.
  // beforeunload is best-effort (the IPC may not survive the teardown); the
  // visibility hook is the one that reliably catches "minimised and forgotten".
  if (typeof flushScanSave === "function") {
    window.addEventListener("beforeunload", () => { flushScanSave(); });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushScanSave();
    });
  }
});
