/**
 * My Crafting List — source-table lookup: label, row resolution, City re-pricing.
 * Moved verbatim out of js/render-craft-list.js (800-line limit). Plain
 * browser globals; loaded before render-craft-list.js.
 */

/** Human label for a source table — its <h2> text, falling back to the id. */
function craftListTableLabel(tableId) {
  if (typeof document === "undefined") return tableId;
  const tbl = document.getElementById(tableId);
  if (!tbl) return tableId;
  // app.js wraps every data table in a .table-wrap div, so the heading is the
  // WRAPPER's previous sibling, not the table's (js/app.js setupCollapsibleTables).
  const anchor = (typeof tbl.closest === "function" && tbl.closest(".table-wrap")) || tbl;
  let el = anchor.previousElementSibling;
  while (el && el.tagName !== "H2") el = el.previousElementSibling;
  if (!el) return tableId;
  const span = el.querySelector("span[data-i18n], span");
  const text = (span ? span.textContent : el.textContent) || "";
  return text.trim().split("\n")[0] || tableId;
}

/** Is the list panel itself on screen? Collapse, folded band, and absence count. */
function _clPanelVisible() {
  if (typeof isTableHidden !== "function") return true;
  return !isTableHidden("craft-list-table");
}

/**
 * The source table's cached rows, rendering the table on demand.
 *
 * renderAllTables skips hidden tables entirely (js/app.js draw()) and only
 * remembers them as deferred (js/render-gating.js) — it does NOT clear their
 * cache. So a source table behind a collapse comes back in two broken states,
 * and BOTH have to be rendered here or the list shows numbers that are not the
 * app's numbers:
 *
 *   empty  — a list entry from a collapsed band has nothing to render at all,
 *   stale  — the cache predates the current prices. This is what made a price
 *            edit made IN the list look like it did nothing: the override was
 *            saved and the cell went gold (priceTd re-reads the override for
 *            the ⚡ marker only), while the silver figure, the row total, the
 *            footer and the materials board all replayed the old row.
 *
 * A stale cache is only refreshed while the panel is visible: renderAllTables
 * runs on every captured price patch while the market monitor streams, and
 * paying for sources nobody is looking at is exactly the waste the gating
 * exists to stop. renderTableData skips the DOM for a collapsed table
 * (js/app.js), so a forced render costs the profit math and no layout, and
 * clearing the deferred flag on success keeps it to once per pass.
 */
function _clSourceState(tableId) {
  if (typeof tableState === "undefined") return null;
  const state = tableState[tableId];
  if (!state) return null;

  const populated = Array.isArray(state.data) && state.data.length > 0;
  const stale = typeof isTableDeferred === "function" && isTableDeferred(tableId);
  if (populated && !stale) return state;
  if (populated && !_clPanelVisible()) return state;

  const registry = (typeof window !== "undefined" && typeof window.tableRenderers === "function")
    ? window.tableRenderers()
    : null;
  const render = registry && registry[tableId];
  const haveQuality = typeof lastQualityMarketData !== "undefined" && lastQualityMarketData;
  const haveData = (typeof lastMarketData !== "undefined" && lastMarketData) || haveQuality;
  // Rerolling prices only exist after a quality-aware scan; rendering it from
  // the flat map paints a table of blanks (same guard as renderDeferredTable).
  if (tableId === "rerolling-table" && !haveQuality) return state;
  if (render && haveData) {
    try {
      render();
      // Caught up: don't make the next pass (or the next keystroke) pay again.
      if (typeof clearTableDeferred === "function") clearTableDeferred(tableId);
    } catch (e) {
      // Stay deferred — a renderer that threw left nothing behind, and the next
      // expand is the natural place to retry (js/render-gating.js).
      console.error(`[craft-list] could not render ${tableId}:`, e);
    }
  }
  return tableState[tableId];
}

/**
 * Which source tables the list needs computed, in the order they were added.
 *
 * _clSourceState above renders a stale or empty source INLINE, inside this
 * table's own renderer — measured at 8.7 s in one unbroken block on a real
 * price map, which is the single biggest freeze in the app. The async
 * re-render (js/render-async.js) uses this to schedule those sources as steps
 * of their own, so the browser gets a frame between each; by the time the list
 * itself is drawn every state is populated and fresh, and _clSourceState
 * returns immediately.
 *
 * @returns {string[]} distinct source table ids
 */
function craftListSourceTableIds() {
  const list = (typeof getCraftList === "function") ? getCraftList() : [];
  const seen = [];
  list.forEach((entry) => {
    if (entry && entry.tableId && !seen.includes(entry.tableId)) seen.push(entry.tableId);
  });
  return seen;
}

/**
 * The list's own City picks, as `{ sell, buy }` (null = All).
 *
 * Unlike every other table, the list's picks do NOT filter its rows: an entry
 * that sold best somewhere else would simply vanish, which is the bug the
 * re-pricing tables were built to end (js/table-sell-city.js). The pick
 * instead re-prices every entry at that city, through its source table.
 */
function _clListCityPicks() {
  const id = "craft-list-table";
  return {
    sell: (typeof getTableSellCity === "function" && getTableSellCity(id)) || null,
    buy: (typeof getTableBuyCity === "function" && getTableBuyCity(id)) || null,
  };
}

/** tableId → { base, sell, buy, state } — the last re-priced view, per source. */
const _clRepricedCache = new Map();

/**
 * `tableId`'s rows re-priced at the list's City pick, or null when the pick
 * does not apply to it (no pick, or a source that cannot re-price that leg —
 * the Black Market on the Refining / Transports table, or a table with no city
 * pick at all, which keeps the plain DOM filter).
 *
 * Rendered OFF SCREEN through the source's own renderer with the pick swapped
 * in for the duration (withTableCityPicks), and the source's tableState put
 * back exactly as it was — so the source table, its pickers and anything
 * reading its rows (the Faction Spending board reads the mounts rows) never
 * see the list's pick.
 *
 * Cached against the identity of the source's own rows: any re-render of the
 * source — a scan, a captured price, a price edited in the list — hands it a
 * new array, and only then is the (seconds-long, for the Crafting Planner)
 * re-price paid again.
 */
function _clRepricedState(tableId, base) {
  if (!base || !Array.isArray(base.data) || typeof withTableCityPicks !== "function") return null;
  const picks = _clListCityPicks();
  const legOk = (pick, optionsFor) => {
    if (!pick || typeof optionsFor !== "function") return null;
    const offered = optionsFor(tableId);
    return Array.isArray(offered) && offered.includes(pick) ? pick : null;
  };
  const sell = legOk(picks.sell, typeof sellCityOptionsFor === "function" ? sellCityOptionsFor : null);
  const buy = legOk(picks.buy, typeof buyCityOptionsFor === "function" ? buyCityOptionsFor : null);
  if (!sell && !buy) return null;

  const cached = _clRepricedCache.get(tableId);
  if (cached && cached.base === base.data && cached.sell === sell && cached.buy === buy) {
    return cached.state;
  }

  const registry = (typeof window !== "undefined" && typeof window.tableRenderers === "function")
    ? window.tableRenderers()
    : null;
  const render = registry && registry[tableId];
  if (!render || typeof tableState === "undefined" || !tableState[tableId]) return null;

  const live = tableState[tableId];
  const saved = { ...live };
  let shadow = null;
  try {
    withTableCityPicks(tableId, { sell, buy }, () => {
      render();
      shadow = { ...live };
    });
  } catch (e) {
    console.error(`[craft-list] could not re-price ${tableId} at the list's pick:`, e);
    shadow = null;
  } finally {
    Object.keys(live).forEach((k) => { delete live[k]; });
    Object.assign(live, saved);
  }
  if (!shadow || !Array.isArray(shadow.data)) return null;

  const state = { ...shadow, _clBase: base, _clRepriced: { sell, buy } };
  _clRepricedCache.set(tableId, { base: base.data, sell, buy, state });
  return state;
}

/**
 * Pay `tableId`'s re-price at the list's City pick NOW, so the list's own step
 * hits the _clRepricedCache. The async pass calls this right after the source's
 * own step (js/render-pipeline.js planRerenderPass), one source per step, with
 * a yield between. No pick, or a pick that does not apply: costs nothing.
 */
function _clWarmRepriced(tableId) {
  if (typeof tableState === "undefined" || !tableState[tableId]) return;
  _clRepricedState(tableId, tableState[tableId]);
}

/**
 * The rows the list reads for `tableId`: the source's own (_clSourceState),
 * or — while the list has a City pick — the same rows re-priced at it, falling
 * back per entry to the source's own row (findCraftListRow).
 */
function _clListState(tableId) {
  const base = _clSourceState(tableId);
  return _clRepricedState(tableId, base) || base;
}

/**
 * Locate an entry's row in its source table, in four passes:
 *
 *   1. the exact row key,
 *   2. the city-independent identity (craftListIdentity) — the winning city is
 *      part of the key and moves with prices, which is the common case after a
 *      restart or a price edit,
 *   3. the item id, within the entry's own route,
 *   4. the item id across routes — only when the entry's own route has no row
 *      for the item at all.
 *
 * Anything unmatched falls to the placeholder row rather than vanishing.
 */
function findCraftListRow(state, entry) {
  // A list view re-priced at the list's own City pick (_clListState) falls back
  // to the source's own row when the pick has no row for this entry — a craft
  // city that cannot reach the pick (the Black Market sells from Caerleon
  // alone). That row still names its own city, so the list's filter hides it
  // rather than printing it as if it sold at the pick.
  if (state && state._clBase) {
    const hit = _clFindIn(state, entry);
    if (hit.row) return { ...hit, state, repriced: state._clRepriced };
    return { ..._clFindIn(state._clBase, entry), state: state._clBase, repriced: null };
  }
  return { ..._clFindIn(state, entry), state, repriced: null };
}

function _clFindIn(state, entry) {
  const rows = (state && state.data) || [];
  if (!rows.length || typeof getRowKey !== "function") return { row: null, idx: -1 };
  let idx = rows.findIndex((r) => getRowKey(r, entry.tableId) === entry.rowKey);
  if (idx === -1 && typeof craftListIdentity === "function") {
    const want = craftListIdentity(entry.tableId, entry.rowKey);
    idx = rows.findIndex(
      (r) => craftListIdentity(entry.tableId, getRowKey(r, entry.tableId)) === want,
    );
  }
  // The item id alone knows no city, so while the entry's own route has a row
  // for the item, the fallback stays inside that route: with both routes priced
  // the Caerleon row can never displace the royal one (or the reverse), and the
  // row never prints the other route's numbers. But a split table can price
  // ONLY the other route — the transport table emits a Caerleon candidate for
  // every resource, and after a restart the entry's own side may have no row at
  // all. That is the last pass: the same fallback across routes, tried only
  // once the same-route pass found nothing, so the one priced row beats a
  // "not priced yet" placeholder.
  if (idx === -1 && entry.itemId && typeof extractCraftListRow === "function") {
    const routed = typeof craftListRowRouteIsCaerleon === "function";
    const wantCaerleon = routed && craftListRowRouteIsCaerleon(entry.rowKey);
    const byItemId = (r) => extractCraftListRow(entry.tableId, r)?.itemId === entry.itemId;
    idx = rows.findIndex((r) => {
      if (!byItemId(r)) return false;
      const rowCaerleon = routed && craftListRowRouteIsCaerleon(getRowKey(r, entry.tableId));
      return rowCaerleon === wantCaerleon;
    });
    if (idx === -1) idx = rows.findIndex(byItemId);
  }
  return { row: idx === -1 ? null : rows[idx], idx };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    craftListTableLabel,
    _clPanelVisible,
    _clSourceState,
    craftListSourceTableIds,
    _clListCityPicks,
    _clRepricedState,
    _clWarmRepriced,
    _clListState,
    findCraftListRow,
    _clFindIn,
  };
}
