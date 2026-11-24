/**
 * Which tables are worth computing on a redraw.
 *
 * `renderAllTables` recomputes every profit table in the app. That is right
 * after a scan — the user asked for fresh numbers everywhere — but it is also
 * what runs on every captured price patch while the market monitor is live, and
 * there it is nearly all waste: measured against a real price map with only
 * Artifact Rolling expanded, the pass cost 1306 ms of which 1063 ms went into
 * tables the user had collapsed and could not see. One core, held for as long
 * as the capture kept feeding patches.
 *
 * So a hidden table is skipped and remembered instead. Expanding it (or the
 * group band it sits in) replays its renderer against the current price map,
 * which is what the user is actually waiting for.
 *
 * "Hidden" is three different things in this page, and all three count:
 *   - the table's own collapse, which hides the wrapping `.table-wrap` div
 *     (js/app.js setCollapsed) — NOT the <table> element,
 *   - a folded `.tgroup` band (js/section-groups.js),
 *   - a table that is not in the document at all.
 *
 * The joined summary is the exception that has to be handled here rather than
 * ignored: it projects over its source tables' `tableState[id].data` caches, so
 * when IT is open its sources must still be computed even while collapsed. See
 * js/render-joined-summary.js.
 *
 * Browser + Node (the tests inject a fake document).
 */

/** Table id → the global renderer that fills it. */
const TABLE_RENDERERS = {
  "rolling-table": "renderRollingTable",
  "crafting-table": "renderCraftingTable",
  "craft-planner-table": "renderCraftPlannerTable",
  "flipping-table": "renderFlippingTable",
  "skins-trading-table": "renderSkinsTradingTable",
  "transport-table": "renderTransportTable",
  "consumable-table": "renderConsumableTable",
  "mounts-table": "renderMountsTable",
  "faction-spending-table": "renderFactionSpendingTable",
  "farming-table": "renderFarmingTable",
  "gathering-table": "renderGatheringTable",
  "journal-filling-table": "renderJournalFillingTable",
  "laborers-table": "renderLaborersTable",
  "buildings-table": "renderBuildingsTable",
  "volume-table": "renderVolumeTable",
  "enchanting-table": "renderEnchantingTable",
  "transmute-table": "renderTransmuteTable",
  "rerolling-table": "renderRerollingTable",
  "joined-summary-table": "renderJoinedSummaryTable",
  "joined-focus-table": "renderJoinedFocusTable",
  "bm-board-table": "renderBlackMarketBoard",
};

/**
 * Tables the Top-10 boards read out of. Kept in step with JOINED_SOURCES in
 * js/joined-summary-sources.js — a source missing here is a board row that
 * silently disappears whenever its table is collapsed.
 */
const JOINED_SUMMARY_SOURCES = new Set([
  "flipping-table",
  "crafting-table",
  "transport-table",
  "consumable-table",
  "mounts-table",
  "farming-table",
  "enchanting-table",
  "transmute-table",
  "rerolling-table",
  "rolling-table",
  "faction-spending-table",
  "laborers-table",
]);

/** Renderers that take the quality-aware map instead of the flat one. */
const QUALITY_TABLES = new Set(["rerolling-table"]);

/** Renderers that read their data from the other tables' caches, not an argument. */
const NO_ARG_TABLES = new Set([
  "joined-summary-table", "joined-focus-table", "bm-board-table",
]);

/** Tables skipped by the last pass, owed a render when they become visible. */
const deferredTables = new Set();

function defaultDocument() {
  return typeof document !== "undefined" ? document : null;
}

/**
 * Can the user see this table right now?
 * A table that is absent, collapsed, or inside a folded band counts as hidden —
 * so does an unknown id, because there is nothing to draw either way.
 */
function isTableHidden(tableId, doc = defaultDocument()) {
  if (!doc || typeof doc.getElementById !== "function") return true;
  const table = doc.getElementById(tableId);
  if (!table) return true;
  if (table.style && table.style.display === "none") return true;

  // Per-table collapse hides the wrapper, so the <table> itself stays
  // `display:""` — reading only the table is how this check used to miss.
  const wrap = table.parentElement;
  if (wrap && wrap.classList && wrap.classList.contains("table-wrap")
      && wrap.style && wrap.style.display === "none") {
    return true;
  }

  const group = typeof table.closest === "function" ? table.closest(".tgroup") : null;
  if (group && group.classList && group.classList.contains("collapsed")) return true;

  return false;
}

function markTableDeferred(tableId) {
  deferredTables.add(tableId);
}

function clearTableDeferred(tableId) {
  deferredTables.delete(tableId);
}

function isTableDeferred(tableId) {
  return deferredTables.has(tableId);
}

function deferredTableIds() {
  return [...deferredTables];
}

/**
 * Catch a table up after it was skipped. No-op unless it really was deferred,
 * so an ordinary expand still replays the cached rows (js/app.js) rather than
 * paying for a recompute.
 *
 * @param {string} tableId
 * @param {object} options
 * @param {object} [options.scope]         where the renderers live (default: globalThis)
 * @param {object} options.data            flat price map
 * @param {object} [options.qualityData]   quality-aware map, for rerolling
 * @returns {boolean} whether the table was rendered
 */
/**
 * Catch a board's SOURCES up before the board itself.
 *
 * Reported: after a restart the Black Market board and both Top-10s opened
 * empty and stayed empty until a full scan, though every price had been
 * restored from disk. A board holds no catalog — it projects over the twelve
 * feeders' `tableState[id].data` caches (js/render-joined-summary.js). Boot
 * computes what is on screen and defers the rest, so with the boards collapsed
 * their feeders were deferred too; expanding a board then rendered it over
 * twelve empty caches. Pressing Scan was the only thing that ever filled them,
 * which is what "the board does not persist" was.
 *
 * The document is deliberately not consulted: a feeder is the board's DATA, not
 * something on screen, so a collapsed one is still computed. A source that
 * cannot be drawn (no renderer, or Rerolling with no quality map) is left owed
 * and the board is drawn without it — a board short one feeder beats no board.
 *
 * @returns {number} how many sources were drawn
 */
function renderBoardSources(options) {
  let drawn = 0;
  for (const sourceId of JOINED_SUMMARY_SOURCES) {
    if (renderDeferredTable(sourceId, options)) drawn++;
  }
  return drawn;
}

function renderDeferredTable(tableId, { scope = globalThis, data, qualityData } = {}) {
  if (!isTableDeferred(tableId)) return false;
  const fnName = TABLE_RENDERERS[tableId];
  if (!fnName) return false;
  const render = scope ? scope[fnName] : null;
  if (typeof render !== "function") return false;

  // Rerolling prices only exist once a quality-aware scan has run; rendering it
  // from the flat map produces a table of blanks, so leave it deferred.
  if (QUALITY_TABLES.has(tableId) && !qualityData) return false;

  // A board reads the feeders' caches, so they go first — see renderBoardSources.
  if (NO_ARG_TABLES.has(tableId)) renderBoardSources({ scope, data, qualityData });

  try {
    if (NO_ARG_TABLES.has(tableId)) render();
    else render(QUALITY_TABLES.has(tableId) ? qualityData : data);
  } catch (e) {
    // Stay deferred: a renderer that threw has left nothing on screen, and the
    // next expand is the natural place to try again.
    if (typeof console !== "undefined") console.error(`${fnName}:`, e);
    return false;
  }
  clearTableDeferred(tableId);
  return true;
}

/**
 * Catch up every table that is owed a render and is ON SCREEN right now.
 *
 * Expanding a table used to be the only way a deferral was ever paid off, which
 * left a hole: a table that is ALREADY OPEN when it gets deferred keeps showing
 * stale numbers until the user collapses and re-expands it. That is not a rare
 * corner — a re-render pass stops the moment the next price editor opens, and
 * everything it did not reach is marked deferred (js/render-async.js). Editing
 * two prices in a row was enough to strand the tables late in the draw order.
 *
 * So the end of every settled pass drains this instead (js/app.js
 * installRenderScheduler). Collapsed tables are deliberately skipped: they are
 * the whole point of the gating above, and expanding one still replays it.
 *
 * @param {object} options  same shape as renderDeferredTable, plus `doc`
 * @returns {number} how many tables were drawn
 */
function drainVisibleDeferredTables(options = {}) {
  let drawn = 0;
  for (const tableId of deferredTableIds()) {
    if (isTableHidden(tableId, options.doc)) continue;
    if (renderDeferredTable(tableId, options)) drawn++;
  }
  return drawn;
}

/**
 * Catch up every deferred table inside a container — used when a whole `.tgroup`
 * band is unfolded, which reveals several tables at once.
 */
function renderDeferredTablesIn(container, options = {}) {
  if (!container || typeof container.querySelector !== "function") return 0;
  let drawn = 0;
  for (const tableId of deferredTableIds()) {
    if (!container.querySelector(`#${tableId}`)) continue;
    if (isTableHidden(tableId, options.doc)) continue;
    if (renderDeferredTable(tableId, options)) drawn++;
  }
  return drawn;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TABLE_RENDERERS,
    JOINED_SUMMARY_SOURCES,
    isTableHidden,
    markTableDeferred,
    clearTableDeferred,
    isTableDeferred,
    deferredTableIds,
    renderDeferredTable,
    renderBoardSources,
    drainVisibleDeferredTables,
    renderDeferredTablesIn,
  };
}
