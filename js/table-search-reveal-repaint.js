// ── Search-reveal repaint ────────────────────────────────────────────────
//
// The profitability gate (updateTableDisplay, js/sorting.js) drops no-data and
// unprofitable rows from the DOM at RENDER time, and it reads the search box
// there — a typed query reveals such rows (rowRevealedBySearch). But the
// input's own pass (applyTableSearchFilter) runs over PAINTED rows only: a row
// the last render gated out is not in the DOM and no keystroke can bring it
// back. So when the query names a cached row the gate is holding off-screen,
// the paint has to be replayed — updateTableDisplay re-reads the query before
// the gate and the row appears.
//
// The replay is a full reformat + innerHTML pass (seconds on the planner), so
// it is debounced per table and only scheduled when something revealed is
// actually missing from the DOM. Clearing the box schedules one restore
// repaint, because a row the reveal painted stays painted after the query is
// gone and only the gate can re-drop it.
//
// Loaded before js/table-search.js, which wires these to each search box and
// re-exports them.

(function () {
  function revealInternals() {
    if (typeof rowRevealedBySearch === "function" && typeof tableSearchTerms === "function") {
      return { rowRevealedBySearch, tableSearchTerms };
    }
    if (typeof require === "function") {
      return require("./table-search-reveal.js");
    }
    return {};
  }

  function rowKeyForReveal(row, tableId) {
    if (typeof getRowKey === "function") {
      try { return getRowKey(row, tableId) || ""; } catch { return ""; }
    }
    if (typeof require === "function") {
      try { return require("./sorting-row-key.js").getRowKey(row, tableId) || ""; } catch { return ""; }
    }
    return "";
  }

  // The volume table predates the generic search box and keeps its own input id
  // (#volume-search); every other table follows the search-<tableId> scheme.
  function searchInputId(tableId) {
    return tableId === "volume-table" ? "volume-search" : "search-" + tableId;
  }

  /** True when tableState caches a gate-dropped row the query would reveal. */
  function searchRevealNeedsRepaint(tableId, terms) {
    if (!tableId || !Array.isArray(terms) || terms.length === 0) return false;
    const state = (typeof tableState !== "undefined" && tableState) || null;
    const data = state && state[tableId] && state[tableId].data;
    if (!Array.isArray(data)) return false;
    const { rowRevealedBySearch: reveals } = revealInternals();
    if (typeof reveals !== "function") return false;
    const tbody = (typeof document !== "undefined" && document.querySelector)
      ? document.querySelector(`#${tableId} tbody`) : null;
    const painted = new Set();
    if (tbody && typeof tbody.querySelectorAll === "function") {
      tbody.querySelectorAll("tr[data-row-key]").forEach((tr) => {
        const k = tr.getAttribute("data-row-key");
        if (k) painted.add(k);
      });
    }
    return data.some((row) => {
      const key = rowKeyForReveal(row, tableId);
      return !painted.has(key) && reveals(row, tableId, terms);
    });
  }

  const REVEAL_REPAINT_DELAY_MS = 300;
  const _revealRepaintTimers = {};
  const _revealRepaintActive = {};

  /**
   * Debounced: replay the paint when the query names a row the gate is hiding.
   * Called after every input event, next to the immediate DOM pass.
   */
  function scheduleSearchRevealRepaint(tableId) {
    if (typeof document === "undefined" || !document.getElementById) return;
    const input = document.getElementById(searchInputId(tableId));
    if (!input) return;
    const { tableSearchTerms: termsOf } = revealInternals();
    const terms = (typeof termsOf === "function") ? termsOf(tableId) : [];

    if (terms.length === 0) {
      if (_revealRepaintTimers[tableId]) {
        clearTimeout(_revealRepaintTimers[tableId]);
        _revealRepaintTimers[tableId] = null;
      }
      // A previous reveal painted gate-dropped rows; with the query gone only
      // the gate can re-drop them. One restore repaint, not per keystroke.
      if (_revealRepaintActive[tableId] && typeof updateTableDisplay === "function") {
        _revealRepaintActive[tableId] = false;
        _revealRepaintTimers[tableId] = setTimeout(() => {
          _revealRepaintTimers[tableId] = null;
          if (!(input.value || "").trim()) updateTableDisplay(tableId);
        }, REVEAL_REPAINT_DELAY_MS);
      }
      return;
    }

    if (!searchRevealNeedsRepaint(tableId, terms)) return;
    if (_revealRepaintTimers[tableId]) clearTimeout(_revealRepaintTimers[tableId]);
    _revealRepaintTimers[tableId] = setTimeout(() => {
      _revealRepaintTimers[tableId] = null;
      // Cleared (or emptied) while the debounce ran: the gate must re-drop, not
      // resurrect — read the box at fire time, not at schedule time.
      if (!(input.value || "").trim()) return;
      _revealRepaintActive[tableId] = true;
      if (typeof updateTableDisplay === "function") updateTableDisplay(tableId);
    }, REVEAL_REPAINT_DELAY_MS);
  }

  const api = { searchRevealNeedsRepaint, scheduleSearchRevealRepaint };

  if (typeof window !== "undefined") {
    window.tableSearchRevealRepaint = api;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
