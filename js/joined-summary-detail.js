/**
 * The Top-10 boards' expandable detail row.
 *
 * A board row's Input Cost is a SUM for ten of the twelve feeders — materials ×
 * count plus setup, station, recipe and haul fees. No single per-unit price
 * inverts it, which is why aggregateCostTd (js/app.js) exists and why typing
 * into that cell is a documented bug. But the per-unit prices it is built from
 * DO have editors: they are the feeder's own Materials cell, its chain
 * breakdown, its own priceTd cells.
 *
 * So the board row expands to show the feeder's row verbatim. Rows are NOT
 * re-implemented here: `tableState[tableId].formatter(row, idx)` is the same
 * call My Crafting List makes (js/render-craft-list.js), so the panel carries
 * every editable cell that table has, and the app-wide price editor in
 * js/app.js picks them up wherever they sit in the document.
 *
 * Two structural rules, both borrowed from the Crafting Planner's paths panel:
 *
 *   • open state lives in a Set here, not in the DOM. Every renderAllTables
 *     wipes `tbody.innerHTML`, and a committed price edit triggers exactly that
 *     — DOM-held state would collapse the panel the user just edited in.
 *   • the panel <tr> carries NO data-row-key. Sort anchoring, the table filters
 *     and the Craft List cloner all key on that attribute, and a second row
 *     sharing its parent's key confuses every one of them.
 *
 * The grafted row is nested in its own <table>. That is what keeps its cells out
 * of the board's own row iteration: `tbody.rows` on the board sees the panel row
 * and nothing inside it.
 */

// Board-scoped so expanding a row on the profit board does not silently expand
// the same play on the focus board.
const jbOpenDetailRows = new Set();

/** Stable identity for one row ON one board. */
function jbDetailKey(boardTableId, row) {
  const own = row.rowKey || `${row.itemName}|${row.routeLabel}`;
  return `${boardTableId}::${row.tableId}|${own}`;
}

function _jbTx(en, slug) {
  return (typeof tx === "function") ? tx(en, slug) : en;
}

function _jbEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The ▸ / ▾ affordance. Rendered in the Item cell, the row it explains. */
function jbDetailToggle(detailKey) {
  const open = jbOpenDetailRows.has(detailKey);
  return `<span class="jb-detail-toggle" data-detail-toggle="${_jbEsc(detailKey)}" title="${
    _jbTx("Show this play's own row from its table — its materials, its chain and every price you can override.",
          "r_tip_board_detail")
  }">${open ? "▾" : "▸"}</span>`;
}

/**
 * The feeder's cached rows, rendering the table on demand.
 *
 * While a board is open renderAllTables computes every feeder even when it is
 * collapsed (js/app.js, JOINED_SUMMARY_SOURCES), so in the common case this
 * returns immediately. The two cases it exists for are a board caught up from
 * deferred (js/render-gating.js) and a first paint where the feeder has not run
 * yet — both would otherwise graft an empty or pre-edit row into a panel the
 * user opened deliberately.
 */
function jbSourceState(tableId) {
  if (typeof tableState === "undefined") return null;
  const state = tableState[tableId];
  if (!state) return null;

  const populated = Array.isArray(state.data) && state.data.length > 0;
  const stale = typeof isTableDeferred === "function" && isTableDeferred(tableId);
  if (populated && !stale) return state;

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
      if (typeof clearTableDeferred === "function") clearTableDeferred(tableId);
    } catch (e) {
      console.error(`[top-boards] could not render ${tableId}:`, e);
    }
  }
  return tableState[tableId];
}

/** The feeder row behind a board row, with its index — the formatter needs both. */
function jbFindSourceRow(state, boardRow) {
  if (!state || !Array.isArray(state.data)) return null;
  const want = boardRow.rowKey;
  if (want && typeof getRowKey === "function") {
    for (let i = 0; i < state.data.length; i++) {
      const r = state.data[i];
      if (r && getRowKey(r, boardRow.tableId) === want) return { row: r, idx: i };
    }
  }
  return null;
}

/**
 * The panel row for an expanded board row, or "" when it is collapsed.
 *
 * @param {object} boardRow   a normalized board row
 * @param {string} detailKey  jbDetailKey(boardTableId, boardRow)
 * @param {number} colSpan    the board's column count (they differ: 10 vs 11)
 */
function jbDetailRowHtml(boardRow, detailKey, colSpan) {
  if (!jbOpenDetailRows.has(detailKey)) return "";

  let body;
  const state = jbSourceState(boardRow.tableId);
  const found = jbFindSourceRow(state, boardRow);
  if (!found || typeof state.formatter !== "function") {
    // A feeder re-scan can drop a row out of its cache between the board being
    // built and the panel being opened. Say so rather than showing a blank box.
    body = `<div class="jb-detail-empty">${
      _jbTx("This row is no longer in its table — re-scan, or open the table itself.",
            "r_board_detail_gone")}</div>`;
  } else {
    let inner = "";
    try {
      inner = state.formatter(found.row, found.idx) || "";
    } catch (e) {
      console.error(`[top-boards] ${boardRow.tableId} formatter failed:`, e);
    }
    body = inner
      ? `<table class="data-table jb-detail-inner"><tbody>${inner}</tbody></table>`
      : `<div class="jb-detail-empty">${
        _jbTx("This row is no longer in its table — re-scan, or open the table itself.",
              "r_board_detail_gone")}</div>`;
  }

  return `
      <tr class="jb-detail-row" data-detail-for="${_jbEsc(detailKey)}">
        <td colspan="${colSpan}"><div class="jb-detail-wrap">${body}</div></td>
      </tr>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    jbOpenDetailRows,
    jbDetailKey,
    jbDetailToggle,
    jbSourceState,
    jbFindSourceRow,
    jbDetailRowHtml,
  };
}
