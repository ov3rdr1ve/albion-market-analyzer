/**
 * One centered spinner while a re-render pass runs.
 *
 * A price edit, a captured price or a header toggle redraws the app in phases
 * (js/render-async.js), which takes a second or two on a real price map. The
 * report used to be per-cell rings on every value the pass would replace; that
 * meant walking tables, a viewport band, a mark cap and item scoping, and still
 * cost layout time on every superseding pass. It is now ONE element:
 * `#recalc-overlay`, a "Recalculating…" label with a spinner, fixed in the
 * middle of the viewport (css/styles.css). It never takes a click
 * (pointer-events: none), so the app stays scrollable and editable under it.
 *
 * Rules.
 *
 *   lazy element   Created on first show with doc.createElement and appended
 *                  once to document.body, then reused. Never in index.html, so
 *                  boot shows nothing. Visible = class `is-visible`; the
 *                  `hidden` attribute is not used so the CSS can fade.
 *
 *   never flash    Most passes finish inside 100 ms. begin() waits delayMs
 *                  (default RECALC_MARK_DELAY_MS) before showing, and a pass
 *                  that ends first shows nothing. A pass that SUPERSEDES one
 *                  already visible keeps it visible: no class change, no timer.
 *
 *   pass end only  tableDone() is bookkeeping; the overlay stays until clear()
 *                  (pass end), so it never vanishes mid-pass.
 *
 *   no tables      begin() with no table ids is clear().
 *
 * DOM and lifecycle only: no knowledge of prices, tables or the schedule, so it
 * runs in Node (tests/recalc-overlay.test.cjs, tests/recalc-cell-mark.test.cjs).
 * The module and function names are kept from the per-cell version so callers
 * (render-pipeline, scan handlers, search fetch) are untouched.
 */

/** Long enough that a quick pass shows nothing; short enough to feel prompt. */
const RECALC_MARK_DELAY_MS = 100;

const RECALC_OVERLAY_ID = "recalc-overlay";
const RECALC_VISIBLE_CLASS = "is-visible";

function rcmDefaultDoc() {
  return typeof document !== "undefined" ? document : null;
}

/**
 * @param {object} [deps]
 * @param {Document} [deps.doc]
 * @param {Function} [deps.setTimer]
 * @param {Function} [deps.clearTimer]
 * @returns {{begin: Function, tableDone: Function, clear: Function, state: Function}}
 */
function createRecalcCellMark({
  doc = rcmDefaultDoc(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  /** Table ids this pass has not drawn yet (bookkeeping only). */
  let pending = new Set();
  let timer = null;
  let visible = false;
  let el = null;

  function ensureEl() {
    if (el) return el;
    if (!doc || typeof doc.createElement !== "function" || !doc.body) return null;
    el = doc.createElement("div");
    el.id = RECALC_OVERLAY_ID;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    const spinner = doc.createElement("span");
    spinner.className = "recalc-overlay-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const label = doc.createElement("span");
    label.className = "recalc-overlay-label";
    label.textContent = "Recalculating…";
    el.appendChild(spinner);
    el.appendChild(label);
    doc.body.appendChild(el);
    return el;
  }

  function cancelTimer() {
    if (timer !== null) { clearTimer(timer); timer = null; }
  }

  function show() {
    const node = ensureEl();
    if (node) node.classList.add(RECALC_VISIBLE_CLASS);
    visible = true;
  }

  /**
   * Start a pass.
   *
   * @param {object}   [options]
   * @param {string[]} [options.tableIds]  what the pass plans to draw
   * @param {number}   [options.delayMs]
   */
  function begin({ tableIds = [], delayMs = RECALC_MARK_DELAY_MS } = {}) {
    pending = new Set(tableIds);
    if (!pending.size) { clear(); return; }
    // Superseding a visible pass: stay visible, no flicker, no new countdown.
    if (visible) { cancelTimer(); return; }
    // Superseding a waiting pass: one timer only.
    cancelTimer();
    timer = setTimer(() => { timer = null; show(); }, delayMs);
  }

  /** That table has been drawn. The overlay stays until the pass ends. */
  function tableDone(tableId) {
    pending.delete(tableId);
  }

  /** The pass is over and painted. Idempotent. */
  function clear() {
    cancelTimer();
    pending = new Set();
    if (visible && el) el.classList.remove(RECALC_VISIBLE_CLASS);
    visible = false;
  }

  function state() {
    return { visible, waiting: timer !== null };
  }

  return { begin, tableDone, clear, state };
}

// ── the app's single mark ──────────────────────────────────────────────────

let _recalcCellMark = null;

function recalcCellMark() {
  if (!_recalcCellMark) _recalcCellMark = createRecalcCellMark();
  return _recalcCellMark;
}

function beginRecalcCellMark(options) { recalcCellMark().begin(options || {}); }
function recalcCellMarkTableDone(tableId) { recalcCellMark().tableDone(tableId); }
function clearRecalcCellMark() { recalcCellMark().clear(); }
function recalcCellMarkState() { return recalcCellMark().state(); }

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    RECALC_MARK_DELAY_MS,
    createRecalcCellMark,
  };
}
