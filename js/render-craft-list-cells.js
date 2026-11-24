/**
 * My Crafting List — per-row cell builders and per-row profit / cost math.
 * Moved verbatim out of js/render-craft-list.js (800-line limit). Plain
 * browser globals; loaded before render-craft-list.js.
 */

function _clRemoveBtn(entry) {
  return `<button type="button" class="cl-row-btn cl-remove" data-cl-remove="1"`
    + ` data-table-id="${_clEsc(entry.tableId)}" data-row-key="${_clEsc(entry.rowKey)}"`
    + ` title="${tx("Remove from My Crafting List", "r_cl_remove_from_list")}">✕</button>`;
}

// A TEXT field, not type="number": the box takes arithmetic ("two runs of 96"
// is typed `96+96`, js/craft-list-qty-expr.js), and a number input hands the
// page back an empty string for anything with a `+` in it. min/step and the
// spinner arrows go with it — they mean nothing on a text field.
//
// 0 still PARKS the row: it stays on the list, with its prices still editable,
// and drops out of every total and the shopping board.
//
// The "10k" button under the box fills in what one focus bar buys
// (js/craft-list-qty-focus.js). It needs the row's focus cost, so it only
// appears on a row the list has actually extracted — a placeholder row passes
// no `extracted` and keeps the bare box.
function _clQtyCell(entry, extracted) {
  const tip = tx("How many of this row you plan to run", "r_cl_qty_tip")
    + " — " + tx("0 keeps the row without counting it", "r_cl_qty_zero_tip")
    + " — " + tx("type a sum like 96+96 and press Enter", "r_cl_qty_expr_tip");
  const focusBtn = (typeof clQtyFocusBtnHtml === "function")
    ? clQtyFocusBtnHtml(entry, extracted)
    : "";
  return `<td class="cl-qty-cell"><input type="text" class="cl-qty"`
    + ` autocomplete="off" spellcheck="false"`
    + ` value="${entry.qty}" data-cl-qty="1"`
    + ` data-table-id="${_clEsc(entry.tableId)}" data-row-key="${_clEsc(entry.rowKey)}"`
    + ` title="${_clEsc(tip)}" />${focusBtn}</td>`;
}

/**
 * The dimmed self-gathered line under a Total Profit headline (plan.md).
 *
 * `unitProfitSelfFound` is the source table's own twin (js/craft-list-
 * extractors.js); the list only scales it by the planned quantity — a
 * self-gathered plan of N runs makes N × the twin — and never by the focus
 * split: funded or not, self-gathered materials cost the same zero. A row
 * whose table computes no twin, or a parked one, gets "" — so bought-only
 * rows render byte-identical to before. Same dimmed block + own tooltip the
 * per-10k twin uses (js/craft-list-per10k.js).
 */
function _clSelfFoundTotalLine(extracted, qty, parked) {
  const unit = extracted && extracted.unitProfitSelfFound;
  if (parked || unit == null) return "";
  const perUnit = Number(unit);
  if (!Number.isFinite(perUnit)) return "";
  const n = Number(qty) || 0;
  const value = perUnit * n;
  const tip = tx("Same plan with the materials self-gathered (inputs at zero cost, fees and taxes kept): {qty} × {unit} = {value}", "r_cl_row_selffound_tip")
    .replace("{qty}", String(n))
    .replace("{unit}", _clFmt(perUnit))
    .replace("{value}", _clFmt(value));
  return `<small style="color:#9ca3af;display:block;font-size:0.7rem" title="${_clEsc(tip)}">`
    + `${tx("self-gathered", "r_selffound")} ${_clFmt(value)}</small>`;
}

/**
 * Split this basket's quantities at the focus budget.
 *
 * Reads the two live settings the pure allocator cannot see: the budget box
 * (persisted, js/craft-list-store.js) and the app-wide "Use Focus" checkbox —
 * with focus off every row is ALREADY priced focus-off, so nothing is funded
 * and nothing is reported short.
 */
function _clAllocate(entries) {
  if (typeof allocateCraftListFocus !== "function") return null;
  const budget = (typeof getCraftListFocusBudget === "function")
    ? getCraftListFocusBudget() : 10000;
  const focusEnabled = (typeof isFocusEnabled === "function") ? isFocusEnabled() : true;
  return allocateCraftListFocus(entries, budget, { focusEnabled });
}

/**
 * Per-ROW split: each entry priced as if it alone had the whole budget. Same
 * budget / Use Focus reads as _clAllocate; the footer and materials keep the
 * shared allocation.
 */
function _clAllocateRows(entries) {
  if (typeof allocateCraftListFocusStandalone !== "function") return null;
  const budget = (typeof getCraftListFocusBudget === "function")
    ? getCraftListFocusBudget() : 10000;
  const focusEnabled = (typeof isFocusEnabled === "function") ? isFocusEnabled() : true;
  return allocateCraftListFocusStandalone(entries, budget, { focusEnabled });
}

/** One entry's profit under the split: focused units + base-rate units. */
function _clRowProfit(extracted, split) {
  if (!extracted) return 0;
  const on = Number(extracted.unitProfit) || 0;
  const off = Number.isFinite(Number(extracted.unitProfitNoFocus))
    ? Number(extracted.unitProfitNoFocus) : on;
  return on * (split.fundedQty || 0) + off * (split.unfundedQty || 0);
}

/**
 * One entry's buy cost under the split — the same expression summarizeCraftList
 * sums into the footer's "cost" (js/craft-list-materials.js), so the column and
 * the footer can never disagree. Unfocused units cost MORE: a lower return rate
 * means more material bought per craft.
 */
function _clRowCost(extracted, split) {
  if (!extracted) return 0;
  const on = Number(extracted.inputCost) || 0;
  const off = Number.isFinite(Number(extracted.inputCostNoFocus))
    ? Number(extracted.inputCostNoFocus) : on;
  return on * (split.fundedQty || 0) + off * (split.unfundedQty || 0);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    _clRemoveBtn,
    _clQtyCell,
    _clSelfFoundTotalLine,
    _clAllocate,
    _clAllocateRows,
    _clRowProfit,
    _clRowCost,
  };
}
