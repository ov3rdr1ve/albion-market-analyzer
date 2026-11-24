/**
 * The cell you just typed into, marked until its new number is on screen.
 *
 * A price edit redraws the app in phases (js/render-async.js), which takes a
 * second or two on a real price map. js/recalc-cell-mark.js reports that across
 * every number the pass will replace; this is the narrower half of the same
 * report — the ONE cell the user typed into, which is the cell they are watching
 * and the only one whose new value they are waiting on specifically. It keeps a
 * small spinner, and its row keeps an accent, from the moment the editor closes
 * until the pass has finished AND painted.
 *
 * The hard part is that the row does not survive the redraw. The edited table is
 * drawn FIRST (the `edited` phase), so within a few hundred milliseconds the
 * marked <td> has been replaced by a fresh one while the other ~20 tables are
 * still recomputing. A class on a node cannot outlive the node, so the mark is
 * stored as an IDENTITY — table id + the row's data-row-key + the cell's column
 * index — and re-applied after every phase, exactly as js/scroll-anchor.js
 * re-applies its scroll correction.
 *
 * DOM and lifecycle only: no knowledge of prices, tables or the schedule. The
 * document is injected, so it runs in Node (tests/pending-edit-mark.test.cjs).
 */

/** Dimmed + spinner. Predates this module; css/styles.css styles both. */
const PENDING_CELL_CLASS = "pe-pending";
const PENDING_ROW_CLASS = "pe-pending-row";

function pemDefaultDoc() {
  return typeof document !== "undefined" ? document : null;
}

/** CSS.escape where it exists (browsers); a quoted-string escape in Node. */
function pemEscapeAttr(value) {
  if (typeof CSS !== "undefined" && CSS && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/["\\]/g, "\\$&");
}

/**
 * @param {object} [deps]
 * @param {Document} [deps.doc]
 * @returns {{mark: Function, reapply: Function, clear: Function, state: Function}}
 */
function createPendingEditMark({ doc = pemDefaultDoc() } = {}) {
  /** {tableId, key, cellIndex} — what to find again after a redraw. */
  let record = null;

  const addClass = (el, cls) => { if (el && el.classList) el.classList.add(cls); };
  const removeClass = (el, cls) => { if (el && el.classList) el.classList.remove(cls); };

  /** Every marked node, whether or not it is the one we recorded. */
  function stripAll() {
    if (!doc || typeof doc.querySelectorAll !== "function") return;
    [PENDING_CELL_CLASS, PENDING_ROW_CLASS].forEach((cls) => {
      doc.querySelectorAll(`.${cls}`).forEach((el) => removeClass(el, cls));
    });
  }

  /**
   * Mark the cell being committed, and remember how to find it again.
   *
   * A cell with no identifiable row (no data-row-key, no table id) is still
   * marked — it just cannot be re-marked after the redraw, which is strictly
   * better than no feedback at all.
   *
   * @param {Element} td
   */
  function mark(td) {
    // One edit at a time: a second commit replaces the first, and the first
    // cell's mark must not be left behind on a row nobody is waiting for.
    stripAll();
    record = null;
    if (!td || typeof td.closest !== "function") return;

    addClass(td, PENDING_CELL_CLASS);
    const tr = td.closest("tr");
    if (!tr) return;
    addClass(tr, PENDING_ROW_CLASS);

    const key = (tr.dataset && tr.dataset.rowKey) || null;
    const table = typeof tr.closest === "function" ? tr.closest("table") : null;
    const tableId = (table && table.id) || null;
    if (!key || !tableId) return;

    const cells = tr.cells || tr.children || [];
    const cellIndex = Array.prototype.indexOf.call(cells, td);
    record = { tableId, key, cellIndex };
  }

  /**
   * Put the mark back on the row that replaced the marked one. Safe to call
   * after every phase, and a no-op once the row is gone (a filter dropped it,
   * the item stopped being profitable) — there is nothing left to wait for.
   *
   * @returns {boolean} whether a row was marked
   */
  function reapply() {
    if (!record || !doc || typeof doc.querySelector !== "function") return false;
    const selector = `#${record.tableId} tr[data-row-key="${pemEscapeAttr(record.key)}"]`;
    let row;
    try { row = doc.querySelector(selector); } catch (e) { row = null; }
    if (!row) return false;
    addClass(row, PENDING_ROW_CLASS);
    const cells = row.cells || row.children || [];
    const cell = record.cellIndex >= 0 ? cells[record.cellIndex] : null;
    if (cell) addClass(cell, PENDING_CELL_CLASS);
    return true;
  }

  /** The pass is over and painted: nothing is pending any more. */
  function clear() {
    record = null;
    stripAll();
  }

  function state() {
    return record ? { ...record } : null;
  }

  return { mark, reapply, clear, state };
}

// ── the app's single mark ──────────────────────────────────────────────────

let _pendingEditMark = null;

function pendingEditMark() {
  if (!_pendingEditMark) _pendingEditMark = createPendingEditMark();
  return _pendingEditMark;
}

function markPendingEdit(td) { pendingEditMark().mark(td); }
function reapplyPendingEditMark() { return pendingEditMark().reapply(); }
function clearPendingEditMark() { pendingEditMark().clear(); }
function pendingEditMarkState() { return pendingEditMark().state(); }

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PENDING_CELL_CLASS,
    PENDING_ROW_CLASS,
    createPendingEditMark,
  };
}
