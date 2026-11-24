/**
 * My Crafting List — the column header row of one group's table.
 *
 * Split out of js/render-craft-list.js when that file reached the repo's
 * 800-line limit. Everything here builds the <tr class="cl-colhead"> a group
 * table opens with: the list's own Qty / Total Buy Cost / Total Profit columns,
 * plus the source table's own columns cloned out of its <thead> — label,
 * data-sort AND tooltip — so a list column sorts and explains itself exactly
 * the way the same column does in its own table.
 *
 * _clEsc and tx stay in their own files: plain globals in the browser, resolved
 * at call time, so load order does not matter.
 */

/**
 * One header cell, sortable when the column has a sort key.
 *
 * `title` is the column's tooltip. Cloned columns inherit it from the source
 * table's own header (see _clSourceTitle) so the list explains a column exactly
 * the way its table does; the list's own columns pass their own text.
 */
function _clTh(label, sortCol, state, title) {
  const tip = title ? ` title="${_clEsc(title)}"` : "";
  if (!sortCol) return `<th${tip}>${_clEsc(label)}</th>`;
  const active = state.sortCol === sortCol ? ` sort-${state.sortDir}` : "";
  return `<th class="sortable${active}" data-sort="${_clEsc(sortCol)}"${tip}>${_clEsc(label)}</th>`;
}

/**
 * A source header's tooltip text.
 *
 * js/tooltips.js MIGRATES a native `title` into `data-tip` the first time an
 * element is hovered (so the slow OS tooltip never fires), which means a header
 * the user has already hovered no longer has a `title` to read. Take whichever
 * of the two is present.
 */
function _clSourceTitle(th) {
  if (!th || typeof th.getAttribute !== "function") return "";
  return th.getAttribute("title") || th.getAttribute("data-tip") || "";
}

/**
 * The tooltip a CLONED column gets.
 *
 * Normally the source header's own text. "Profit / 10k Focus" is the exception:
 * in the list that cell reads the row's Total Profit PLUS a full focus bar
 * (js/craft-list-per10k.js), which is not what the source column means, so the
 * source's tooltip would describe the wrong number.
 */
function _clColTitle(col) {
  if (col.sort === "profitPer10kFocus") {
    return tx("In this list: this row's Total Profit plus one more full 10,000-focus bar. Breeding rows: the focus-only gain of one bar.",
      "r_cl_p10k_th_tip");
  }
  return col.title || "";
}

/**
 * How many columns one group's table has — the header row's own count.
 *
 * Read from the same place _clHeaderRow builds that row from, so the two can
 * never disagree. A placeholder row that spans MORE columns than exist invents
 * anonymous ones, and in a `width: max-content` table those are real width.
 *
 * The shape is fixed by _clHeaderRow below: a blank remove column, Qty, Total
 * Buy Cost, Total Profit, and then the source's columns minus its own leading
 * "+".
 */
function _clGroupColCount(tableId) {
  // Guarded on the METHOD, not on `document`: the renderer tests stub a minimal
  // document with only the handful of calls they need on it.
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") {
    return 5;
  }
  const ths = document.querySelectorAll(`#${tableId} thead th`).length;
  return ths ? ths + 3 : 5;
}

/**
 * A source header's label, without the second sort key some headers carry.
 *
 * The Crafting Planner's Sell header holds a small "vol" link
 * (data-sort-sub="sellVol"); the list clones only the header's own key, so its
 * text must not read "Sell vol".
 */
function _clThLabel(th) {
  const text = (th && th.textContent) || "";
  const sub = (th && typeof th.querySelector === "function") ? th.querySelector("[data-sort-sub]") : null;
  const subText = sub ? (sub.textContent || "") : "";
  if (!subText) return text.trim();
  const at = text.lastIndexOf(subText);
  return (at >= 0 ? text.slice(0, at) + text.slice(at + subText.length) : text).trim();
}

/**
 * Column header row for one group, cloned from the source table's <thead>.
 *
 * The source's `data-sort` comes across with the label, so a list column sorts
 * on exactly the value its own table sorts on (js/craft-list-sort.js delegates
 * to compareRows). Columns the source does not sort on stay plain.
 */
function _clHeaderRow(tableId) {
  if (typeof document === "undefined") return "";
  const state = (typeof craftListSortFor === "function")
    ? craftListSortFor(tableId)
    : { sortCol: null, sortDir: "desc" };
  const ths = [...document.querySelectorAll(`#${tableId} thead th`)];
  const cols = ths.length
    ? ths.map((th) => ({
        label: _clThLabel(th),
        sort: (typeof th.getAttribute === "function" && th.getAttribute("data-sort")) || "",
        title: _clSourceTitle(th),
      }))
    : [{ label: tx("Row", "r_cl_row"), sort: "", title: "" }];
  // The source's leading "+" column becomes the remove column, and the list's
  // own Qty + the two totals sit right behind it — the source tables are wide
  // enough that appending them would park the quantity field off the right edge.
  // Cost before profit: cost is what the quantity takes to buy, profit is what
  // that spend returns.
  const rest = cols.slice(ths.length ? 1 : 0)
    .map((c) => _clTh(c.label, c.sort, state, _clColTitle(c))).join("");
  return `<tr class="cl-colhead"><th></th>`
    + _clTh(tx("Qty", "r_cl_qty"), "qty", state,
      tx("How many of this row the plan runs. 0 parks the row: it stays priced but counts nowhere.",
        "r_cl_qty_th_tip"))
    + _clTh(tx("Total Buy Cost", "total_buy_cost"), "clCost", state,
      tx("Qty × what one unit costs to buy. Units the focus budget cannot fund cost more: the base return rate buys more materials.",
        "r_cl_cost_th_tip"))
    + _clTh(tx("Total Profit", "r_cl_row_total"), "clTotal", state,
      tx("Qty × profit per unit. Focus-funded units use the focused profit, the rest the base return rate.",
        "r_cl_total_th_tip"))
    + `${rest}</tr>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { _clTh, _clThLabel, _clSourceTitle, _clColTitle, _clGroupColCount, _clHeaderRow };
}
