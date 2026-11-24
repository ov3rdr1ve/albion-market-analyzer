/**
 * The loading animation a table wears while boot (or a queued re-render) is
 * computing its rows.
 *
 * The app used to start behind two curtains: a native splash window and a
 * full-screen #app-loader overlay held until the LAST table was filled, which on
 * a real price map is ~19 s of a screen the user cannot read or touch. Both are
 * gone. The window now opens on the real page and the work reports itself where
 * the work is — in the table that is being computed.
 *
 * The mark is one spinner row in the tbody, in the same visual family as the
 * in-cell rings of js/recalc-cell-mark.js and js/pending-edit-mark.js — never a
 * second vocabulary for the same idea. The ring is the whole message: a table
 * with a header and nothing under it, turning a spinner, already says "filling
 * this", so there is no word beside it.
 *
 * Three rules shape it.
 *
 *   never over real rows   A table already showing its last render is better
 *                          left showing it — those numbers are stale, not
 *                          absent, and js/recalc-cell-mark.js is what says so.
 *                          Only an EMPTY tbody or one holding nothing but a
 *                          placeholder (the static "Awaiting Scan..." row in
 *                          index.html, or a mark this module put there) is
 *                          replaced.
 *
 *   never move a column    Every data table is `width: max-content`, so a
 *                          sentence in a colspan cell sizes the REAL columns and
 *                          they jump back the moment the rows land. The content
 *                          is wrapped in .row-fluid, which takes it out of
 *                          intrinsic sizing (css/styles.css).
 *
 *   the renderer clears it A render replaces the whole tbody, so the mark goes
 *                          with it. tableLoadingDone() is for the renderer that
 *                          throws or draws in place, and clearTablesLoading()
 *                          for whatever a stopped pass never reached.
 *
 * DOM and lifecycle only — no knowledge of prices, tables or the schedule, and
 * no CSS selector engine (it walks nodes), so it runs in Node
 * (tests/table-loading-mark.test.cjs).
 */

/** Marks the row this module owns, so it can be found and replaced again. */
const TABLE_LOADING_CLASS = "table-loading-row";

/** The static placeholder index.html ships in every unfilled table's tbody. */
const AWAITING_SCAN_SLUG = "r_awaiting_scan";

function tlmDefaultDoc() {
  return typeof document !== "undefined" ? document : null;
}

function tlmAttr(el, name) {
  if (!el || typeof el.getAttribute !== "function") return null;
  return el.getAttribute(name);
}

function tlmHasClass(el, cls) {
  return !!(el && el.classList && typeof el.classList.contains === "function"
    && el.classList.contains(cls));
}

/** Element children as a plain array, for both a real DOM and the tests' fake. */
function tlmChildren(el) {
  const kids = el && el.children;
  if (!kids) return [];
  return Array.prototype.slice.call(kids);
}

/** The first descendant with that tag name, breadth-first. No selector engine. */
function tlmFindTag(node, tag, depth = 4) {
  if (!node || depth <= 0) return null;
  const kids = tlmChildren(node);
  for (const child of kids) {
    if (child.tagName === tag) return child;
  }
  for (const child of kids) {
    const found = tlmFindTag(child, tag, depth - 1);
    if (found) return found;
  }
  return null;
}

/** Every descendant with that tag name, in document order. */
function tlmCollectTag(node, tag, out = []) {
  tlmChildren(node).forEach((child) => {
    if (child.tagName === tag) out.push(child);
    else tlmCollectTag(child, tag, out);
  });
  return out;
}

/**
 * Is this row a placeholder — something we may replace?
 *
 * Two shapes count: the static "Awaiting Scan..." row index.html ships (found by
 * its i18n slug, so a translated page still matches) and a mark this module put
 * there on an earlier call.
 */
function tlmIsPlaceholderRow(tr) {
  if (tlmHasClass(tr, TABLE_LOADING_CLASS)) return true;
  const cells = tr && tr.cells
    ? Array.prototype.slice.call(tr.cells)
    : tlmChildren(tr);
  if (cells.length !== 1) return false;
  return tlmAttr(cells[0], "data-i18n") === AWAITING_SCAN_SLUG;
}

/** Nothing in this tbody is a number the user would miss. */
function tlmIsReplaceable(tbody) {
  const rows = tlmChildren(tbody);
  if (!rows.length) return true;
  return rows.length === 1 && tlmIsPlaceholderRow(rows[0]);
}

/**
 * What the row says to a screen reader.
 *
 * Nothing is printed: the spinner is the whole message, and a word beside it was
 * one more string to translate and one more thing to measure. A reader that
 * cannot see the ring still needs telling, so the same label rides the row as an
 * aria-label instead.
 */
function tlmLabel() {
  if (typeof t === "function") {
    const translated = t("computing");
    if (translated && translated !== "computing") return translated;
  }
  return "Computing…";
}

/**
 * @param {object}   [deps]
 * @param {Document} [deps.doc]
 * @returns {{mark: Function, done: Function, clear: Function, state: Function}}
 */
function createTableLoadingMark({ doc = tlmDefaultDoc() } = {}) {
  /** Table ids currently wearing a mark, so clearing costs no document query. */
  const marked = new Set();

  function tableOf(tableId) {
    if (!doc || typeof doc.getElementById !== "function") return null;
    return doc.getElementById(tableId);
  }

  /**
   * Put the spinner row in.
   *
   * @param {string} tableId
   * @returns {boolean} whether the table now wears a mark
   */
  function mark(tableId) {
    const table = tableOf(tableId);
    const tbody = table && tlmFindTag(table, "TBODY", 2);
    if (!tbody || !tlmIsReplaceable(tbody)) return false;
    const head = tlmFindTag(table, "THEAD", 2);
    const cols = head ? tlmCollectTag(head, "TH").length || 1 : 1;
    // .row-fluid so the mark does not size the table (see the header note); the
    // span is empty because the ring IS the message (css/styles.css).
    tbody.innerHTML = `<tr class="${TABLE_LOADING_CLASS}">`
      + `<td colspan="${cols}">`
      + `<span class="row-fluid row-computing" role="status"`
      + ` aria-label="${tlmLabel()}"></span>`
      + "</td></tr>";
    marked.add(tableId);
    return true;
  }

  /** That table has been drawn: whatever is in it now is the real thing. */
  function done(tableId) {
    if (!marked.has(tableId)) return;
    marked.delete(tableId);
    const table = tableOf(tableId);
    const tbody = table && tlmFindTag(table, "TBODY", 2);
    if (!tbody) return;
    // Only our own row: the render that replaced the tbody has already taken it
    // away, and blanking whatever it drew instead would undo the render.
    const rows = tlmChildren(tbody);
    if (rows.length === 1 && tlmHasClass(rows[0], TABLE_LOADING_CLASS)) {
      tbody.innerHTML = "";
    }
  }

  /** The pass is over: nothing is owed a mark any more. */
  function clear() {
    [...marked].forEach(done);
    marked.clear();
  }

  function state() {
    return { marked: [...marked] };
  }

  return { mark, done, clear, state };
}

// ── the app's single mark ──────────────────────────────────────────────────

let _tableLoadingMark = null;

function tableLoadingMark() {
  if (!_tableLoadingMark) _tableLoadingMark = createTableLoadingMark();
  return _tableLoadingMark;
}

function markTableLoading(tableId) { return tableLoadingMark().mark(tableId); }
function tableLoadingDone(tableId) { tableLoadingMark().done(tableId); }
function clearTablesLoading() { tableLoadingMark().clear(); }
function tableLoadingState() { return tableLoadingMark().state(); }

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TABLE_LOADING_CLASS,
    AWAITING_SCAN_SLUG,
    createTableLoadingMark,
  };
}
