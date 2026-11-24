// My Crafting List — "only run N, the rest lose money" under a row's Total Profit.
//
// A row whose focused unit profit is positive but whose unfocused one is
// negative (a T8 nurtured mount: +1.3M focused, -95k without), planned at a Qty
// the focus budget cannot fund in full, folds the unfunded units' loss silently
// into Total Profit — so the total swings with every price capture. This says
// how many to run instead: N = the budget's funded count floored to a whole unit
// (js/craft-list-focus-budget.js). Total Profit itself is NOT changed; it still
// reflects the Qty typed. The warning is a button that reuses the "10k" chip's
// `data-cl-qty-focus` hook (js/render-craft-list-events.js), so a click sets Qty
// to N through the normal qty path. The text is deliberately short so it wraps
// inside the Total Profit cell instead of widening the column; the figures live
// in the Total cell and the tooltip. Lives in its own file because
// js/render-craft-list.js is past the 800-line cap.

/** Whole-number silver with a real minus sign, locale-independent. */
function _clFlFmt(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? "−" : "") + Math.abs(v).toLocaleString("en-US");
}

function _clFlTx(en, key) {
  return (typeof tx === "function") ? tx(en, key) : en;
}

/**
 * Pure. `null` when there is nothing to warn about, else
 * `{ n, lossEach, lossTotal, profitAtN, perDayAtN?, text }`.
 * lossEach / lossTotal are negative silver; lossTotal covers the unfunded part
 * (qty - fundedQty). perDayAtN exists for breeding rows with a grow time only.
 */
function clFocusLossWarning(input) {
  const i = input || {};
  const qty = Number(i.qty);
  const funded = Number(i.fundedQty);
  const on = Number(i.unitProfit);
  const off = Number(i.unitProfitNoFocus);
  if (![qty, funded, on, off].every(Number.isFinite)) return null;
  if (!(off < 0) || !(on > 0)) return null;
  const n = Math.floor(funded);
  if (n < 1 || !(qty > n)) return null;

  const lossTotal = Math.round(off * (qty - funded));
  const profitAtN = on * n;
  const hours = Number(i.growHours);
  const breeding = !!i.isBreeding;
  const perDayAtN = breeding && Number.isFinite(hours) && hours > 0
    ? profitAtN / (hours / 24) : undefined;

  const head = breeding
    ? (n === 1
      ? _clFlTx("Only nurture {n} baby", "r_cl_floss_nurture_one")
      : _clFlTx("Only nurture {n} babies", "r_cl_floss_nurture"))
    : _clFlTx("Only focus-craft {n}", "r_cl_floss_craft");
  const text = head.replace("{n}", _clFlFmt(n))
    + " — " + _clFlTx("unfocused are a loss", "r_cl_floss_tail");
  const out = { n, lossEach: off, lossTotal, profitAtN, text };
  if (perDayAtN !== undefined) out.perDayAtN = perDayAtN;
  return out;
}

function _clFlEsc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** The clickable warning block (HTML) for `input`, or "" when none applies. */
function clFocusLossWarningHtml(input, entry) {
  const w = clFocusLossWarning(input);
  if (!w || !entry) return "";
  const tip = _clFlTx("Set Qty to {n}", "r_cl_floss_tip").replace("{n}", _clFlFmt(w.n));
  return `<button type="button" class="cl-row-focusloss" data-cl-qty-focus="${w.n}"`
    + ` data-table-id="${_clFlEsc(entry.tableId)}" data-row-key="${_clFlEsc(entry.rowKey)}"`
    + ` title="${_clFlEsc(tip)}">${_clFlEsc(w.text)}</button>`;
}

/**
 * Renderer entry: the warning for one list row, "" when it has none.
 * `row` is the source table row, `extracted` the normalized entry, `split` the
 * budget split for this entry.
 */
function clFocusLossWarningLine(row, extracted, entry, split, parked) {
  if (parked || !row || !extracted || !entry || !split) return "";
  const hours = (typeof breedingRowGrowHours === "function") ? breedingRowGrowHours(row) : null;
  return clFocusLossWarningHtml({
    qty: entry.qty,
    fundedQty: split.fundedQty,
    unitProfit: extracted.unitProfit,
    unitProfitNoFocus: extracted.unitProfitNoFocus,
    isBreeding: !!row.isBreeding,
    growHours: hours,
  }, entry);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { clFocusLossWarning, clFocusLossWarningHtml, clFocusLossWarningLine };
}
