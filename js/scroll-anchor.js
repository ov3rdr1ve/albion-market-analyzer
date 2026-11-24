/**
 * Keep the edited row where the user left it.
 *
 * Committing a price redraws the tables. The rows above the edited one can
 * change height — a route appears, a "no data" line goes away — so the row the
 * user was looking at slides out from under the cursor. The fix has always been
 * to note where that row sat in the viewport before the redraw and scroll the
 * difference back after it.
 *
 * The redraw is asynchronous now (js/render-async.js), and that changes the
 * shape of the correction in two ways:
 *
 *   - it is re-applied after every phase, not once, because each later phase can
 *     shift the page above the row again. So it has to be idempotent: once the
 *     row is back where it belongs, another call must do nothing.
 *   - it disarms permanently the moment the user scrolls. A pass can run for a
 *     second or two, and yanking someone back to a row they deliberately
 *     scrolled away from is far worse than the drift being corrected.
 *
 * Nothing global: the document and window are injected, so the whole thing runs
 * in Node (tests/scroll-anchor.test.cjs).
 */

/** Below this many pixels a correction is noise — and would fight the browser. */
const ANCHOR_EPSILON_PX = 0.5;

/** A scroll this much larger than the one we made is the user's, not ours. */
const USER_SCROLL_TOLERANCE_PX = 1;

function defaultDoc() {
  return typeof document !== "undefined" ? document : null;
}

function defaultWin() {
  return typeof window !== "undefined" ? window : null;
}

/** CSS.escape where it exists (browsers); a quoted-string escape in Node. */
function escapeAttr(value) {
  if (typeof CSS !== "undefined" && CSS && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/["\\]/g, "\\$&");
}

/**
 * Note where the row containing `td` is sitting right now.
 *
 * Must be called BEFORE anything is redrawn. Returns null when the row cannot be
 * identified afterwards (no `data-row-key`, or no table) — there is nothing to
 * anchor to, and a guess would move the page for no reason.
 *
 * @param {Element} td
 * @param {object}  [options]
 * @param {Document} [options.doc]
 * @returns {{key: string, tableId: string, top: number}|null}
 */
function captureRowAnchor(td, { doc = defaultDoc() } = {}) {
  if (!td || typeof td.closest !== "function") return null;
  const tr = td.closest("tr");
  if (!tr) return null;
  const key = (tr.dataset && tr.dataset.rowKey) || null;
  if (!key) return null;
  const table = typeof tr.closest === "function" ? tr.closest("table") : null;
  const tableId = (table && table.id) || null;
  if (!tableId) return null;
  return { key, tableId, top: tr.getBoundingClientRect().top };
}

/**
 * Build the correction for an anchor. Safe to call after every phase.
 *
 * @param {{key: string, tableId: string, top: number}|null} anchor
 * @param {object} [options]
 * @param {Document} [options.doc]
 * @param {Window}   [options.win]
 * @returns {() => boolean} true while the anchor is still live, false once it
 *   has been given up (user scrolled, row gone, or there was no anchor).
 */
function createAnchorRestorer(anchor, { doc = defaultDoc(), win = defaultWin() } = {}) {
  if (!anchor || !anchor.key || !anchor.tableId || !doc || !win) return () => false;

  let armed = true;
  // What the scroll position was after the last correction WE made. Anything
  // else it reads as afterwards is the user's own scrolling.
  let ours = win.scrollY;

  return function reapply() {
    if (!armed) return false;
    if (Math.abs(win.scrollY - ours) > USER_SCROLL_TOLERANCE_PX) {
      armed = false;
      return false;
    }
    const selector = `#${anchor.tableId} tr[data-row-key="${escapeAttr(anchor.key)}"]`;
    let row;
    try { row = doc.querySelector(selector); } catch (e) { row = null; }
    // The redraw dropped the row (a filter, or the item stopped being
    // profitable). Nothing to hold on to, and nothing to scroll to either.
    if (!row) return false;

    const delta = row.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) >= ANCHOR_EPSILON_PX) {
      win.scrollBy(0, delta);
      // Read back rather than assume: a scroll clamped at the end of the
      // document lands somewhere else, and treating that as the user's scroll
      // would disarm the anchor on the very next phase.
      ours = win.scrollY;
    }
    return true;
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ANCHOR_EPSILON_PX,
    captureRowAnchor,
    createAnchorRestorer,
  };
}
