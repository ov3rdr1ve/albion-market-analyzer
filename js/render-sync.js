/**
 * The Team Sync panel, and the glue between the loop and the app's own stores.
 *
 * Everything with a rule in it lives elsewhere: the bounds and the merges in
 * js/team-sync-payload.js, the restraint in js/team-sync-loop.js, the files in
 * js/sync-folder.js. This file is the three controls in the Roads panel and the
 * four adapters that let the loop reach the portal graph and the captured-price
 * map without either of them knowing team sync exists.
 *
 * Desktop only: without the preload bridge (a plain browser page) the controls
 * stay hidden rather than offering something that cannot work — same rule the
 * monitor controls follow in js/render-monitor.js.
 */

(function () {
  const PANEL_ID = "roads-sync-controls";

  let prefs = null;
  let loop = null;

  function el(id) { return typeof document !== "undefined" ? document.getElementById(id) : null; }

  function bridge() {
    return typeof window !== "undefined" && window.teamSync ? window.teamSync : null;
  }

  /** English inline, Spanish from the UI_STRINGS_ES overlay — see js/i18n.js. */
  function T(en, slug) {
    return typeof tx === "function" ? tx(en, slug) : en;
  }

  // ── what the loop publishes ───────────────────────────────────────────────

  function portalPayload() {
    if (!prefs || typeof loadPortalGraph !== "function" || typeof buildPortalPayload !== "function") return null;
    const now = Date.now();
    return buildPortalPayload({
      deviceId: prefs.deviceId,
      deviceName: prefs.deviceName,
      portals: loadPortalGraph(null, now).toJSON(),
      now,
    });
  }

  function pricePayload() {
    if (!prefs || typeof getCapturedPrices !== "function" || typeof buildPricePayload !== "function") return null;
    return buildPricePayload({
      deviceId: prefs.deviceId,
      deviceName: prefs.deviceName,
      capturedPrices: getCapturedPrices(),
      now: Date.now(),
    });
  }

  // ── what the loop does with a peer's file ─────────────────────────────────

  function takePortals(payload) {
    if (typeof mergePeerPortals !== "function") return 0;
    const taken = mergePeerPortals(payload, Date.now());
    // The panel caches the graph, so it has to be told the store moved under it.
    if (taken > 0 && typeof window !== "undefined" && typeof window.reloadRoadsPortals === "function") {
      window.reloadRoadsPortals();
    }
    return taken;
  }

  /**
   * Fold a peer's captured cells in.
   *
   * The patch is built date-aware first (mergePeerCells) because
   * recordCapturedPrices assumes the incoming cell is the newer one — true for
   * our own capture, not for a teammate replaying a two-hour-old market. Once
   * the patch IS the newer reading, the rest is the ordinary capture path: the
   * session map and its file, then the two live maps so open tables show it
   * without a rescan.
   */
  function takePrices(payload) {
    if (typeof mergePeerCells !== "function" || typeof getCapturedPrices !== "function") return 0;
    const { patch, taken } = mergePeerCells(getCapturedPrices(), payload.capturedPrices);
    if (taken === 0) return 0;

    if (typeof recordCapturedPrices === "function") {
      try { recordCapturedPrices(patch); } catch (e) { /* quota / no bridge */ }
    }
    if (typeof lastQualityMarketData !== "undefined" && typeof mergeCapturedIntoQuality === "function") {
      if (!lastQualityMarketData) lastQualityMarketData = {};
      mergeCapturedIntoQuality(lastQualityMarketData, patch);
    }
    if (typeof lastMarketData !== "undefined"
      && typeof mergeCapturedIntoFlat === "function"
      && typeof flattenCaptured === "function") {
      if (!lastMarketData) lastMarketData = {};
      mergeCapturedIntoFlat(lastMarketData, flattenCaptured(patch, 1));
    }
    return taken;
  }

  function applyPeer(payload, kind) {
    if (kind === "prices") return { portals: 0, cells: takePrices(payload) };
    return { portals: takePortals(payload), cells: 0 };
  }

  // ── the panel ─────────────────────────────────────────────────────────────

  function shortFolder(folder) {
    if (!folder) return T("no folder chosen", "roads_sync_no_folder");
    const parts = String(folder).split(/[\\/]/).filter(Boolean);
    return parts.length <= 2 ? folder : `…${parts.slice(-2).join("\\")}`;
  }

  function renderStatus(status) {
    const line = el("roads-sync-status");
    if (!line) return;
    if (!prefs || !prefs.enabled) { line.textContent = ""; return; }
    if (!prefs.folder) { line.textContent = T("pick a shared folder to start", "roads_sync_pick_folder"); return; }
    if (status && status.lastError) {
      line.textContent = `${T("sync problem", "roads_sync_error")}: ${status.lastError}`;
      line.style.color = "#e2b53f";
      return;
    }
    line.style.color = "#9ca3af";
    if (!status || !status.lastPullAt) { line.textContent = T("waiting for the first read…", "roads_sync_waiting"); return; }
    const peers = status.peers ? status.peers.length : 0;
    const text = peers === 1
      ? T("1 peer · {p} portals taken", "roads_sync_summary_one")
      : T("{n} peers · {p} portals taken", "roads_sync_summary");
    line.textContent = text
      .replace("{n}", peers)
      .replace("{p}", status.lastPortalsTaken || 0);
  }

  function renderPrefs() {
    const enabled = el("roads-sync-enabled");
    const prices = el("roads-sync-prices");
    const folder = el("roads-sync-folder");
    if (enabled) enabled.checked = !!(prefs && prefs.enabled);
    if (prices) prices.checked = !!(prefs && prefs.sharePrices);
    if (folder) {
      folder.textContent = shortFolder(prefs && prefs.folder);
      folder.title = (prefs && prefs.folder) || "";
    }
  }

  function applyRunState() {
    if (!loop) return;
    if (prefs && prefs.enabled && prefs.folder) loop.start(); else loop.stop();
  }

  async function savePrefs(patch) {
    const api = bridge();
    if (!api) return;
    try { prefs = await api.setPrefs(patch); } catch (e) { return; }
    renderPrefs();
    applyRunState();
    renderStatus(loop && loop.status());
  }

  function bind() {
    const api = bridge();
    const panel = el(PANEL_ID);
    if (!api || !panel) return;
    // Shown by dropping the class, never by writing style.display: the section's
    // collapse handler (setupCollapsibleTables in js/app.js) snapshots the
    // inline display of every control row it finds and restores THAT on expand.
    // A row that was inline-hidden at snapshot time would come back hidden.
    panel.classList.remove("hidden");

    loop = createTeamSyncLoop({
      bridge: api,
      getPrefs: () => prefs || { enabled: false, sharePrices: false },
      getPortalPayload: portalPayload,
      getPricePayload: pricePayload,
      applyPeer,
      onStatus: renderStatus,
    });

    const enabled = el("roads-sync-enabled");
    if (enabled) enabled.addEventListener("change", () => savePrefs({ enabled: enabled.checked }));

    const prices = el("roads-sync-prices");
    if (prices) prices.addEventListener("change", () => savePrefs({ sharePrices: prices.checked }));

    const pick = el("roads-sync-folder-btn");
    if (pick) {
      pick.addEventListener("click", async () => {
        try { prefs = await api.pickFolder(); } catch (e) { return; }
        renderPrefs();
        // A new folder is a new set of peers; nothing read from the old one
        // should count as already seen.
        if (loop) loop.resetSeen();
        applyRunState();
      });
    }

    // start() both reads the folder and publishes what this box already has,
    // so nothing extra is needed here to avoid the first-interval wait.
    api.getPrefs().then((stored) => {
      prefs = stored;
      renderPrefs();
      applyRunState();
    }).catch(() => { /* no bridge after all */ });
  }

  /** Called by the portal store and the capture path when something changed. */
  function notifyPortalsChanged() { if (loop) loop.notifyPortalsChanged(); }
  function notifyPricesChanged() { if (loop) loop.notifyPricesChanged(); }

  if (typeof window !== "undefined") {
    window.teamSyncLoop = { notifyPortalsChanged, notifyPricesChanged };
    document.addEventListener("DOMContentLoaded", () => {
      try { bind(); } catch (e) { console.error("teamSync:", e); }
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { applyPeer, shortFolder, _setPrefs: (p) => { prefs = p; } };
  }
})();
