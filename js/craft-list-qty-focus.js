/**
 * My Crafting List — the "10k" button beside a row's quantity box.
 *
 * A row's quantity is a plan, and the plan most often worth typing is "as many
 * of these as one focus bar pays for". That number is `10,000 / focusCost`
 * floored to whole units — a quantity is a count of crafts, and the same floor
 * calculateProfitPer10kFocus uses. (The budget allocator, js/craft-list-focus-
 * budget.js, funds whole units first and then hands any remainder to the next
 * unit as a fraction, since the daily pool carries it over.)
 *
 * `focusCost` on an extracted entry is focus per ROW EXECUTION PER DAY — a
 * breeding row divides its nurture charge over the grow days before it gets
 * here (js/craft-list-extractors.js) — and the budget box is a daily pool, so
 * the bar and the cost are in the same unit and the division is direct.
 *
 * A row that cannot spend focus at all (focusCost 0 or missing: a combine
 * craft, a flip) gets NO button — there is no quantity that spends a bar on it.
 * A row whose single execution costs MORE than a bar gets 1: one execution is
 * the smallest thing that can be run, and the tooltip prints what it really
 * costs rather than pretending it fits.
 */

/** One full focus bar. Premium regenerates ~10,000 a day. */
const CL_FOCUS_BAR = 10000;

/**
 * Pure: how many executions one focus bar buys.
 *
 * Returns null when the row cannot spend focus — the caller draws no button.
 */
function qtyForFocusBar(focusCost, bar) {
  const cost = Number(focusCost);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  const size = Number(bar);
  const cap = Number.isFinite(size) && size > 0 ? size : CL_FOCUS_BAR;
  const qty = Math.floor(cap / cost);
  return qty > 0 ? qty : 1;
}

/** Local escape — this module builds its own markup and loads on its own. */
function _clQfEsc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function _clQfFmt(n) {
  if (typeof formatSilver === "function") return formatSilver(n);
  return Math.round(Number(n) || 0).toLocaleString();
}

function _clQfTx(en, key) {
  return (typeof tx === "function") ? tx(en, key) : en;
}

/**
 * The button's markup, or "" when the row cannot spend focus.
 *
 * `extracted` is the normalized entry (js/craft-list-extractors.js); a
 * placeholder row has none and so gets nothing.
 */
function clQtyFocusBtnHtml(entry, extracted, bar) {
  if (!entry || !extracted) return "";
  const cap = Number.isFinite(Number(bar)) && Number(bar) > 0 ? Number(bar) : CL_FOCUS_BAR;
  const qty = qtyForFocusBar(extracted.focusCost, cap);
  if (qty === null) return "";
  const spend = qty * Number(extracted.focusCost);
  const days = Math.max(1, Math.floor(Number(extracted.focusDays) || 1));
  let tip = _clQfTx("Set the quantity to what one 10,000-focus bar buys", "r_cl_qty_10k_tip")
    + " — " + _clQfTx("{qty} × {cost} focus = {spend}", "r_cl_qty_10k_spend")
      .replace("{qty}", _clQfFmt(qty))
      .replace("{cost}", _clQfFmt(extracted.focusCost))
      .replace("{spend}", _clQfFmt(spend));
  if (days > 1) {
    tip += " — " + _clQfTx("focus per day, over {days} days", "r_cl_qty_10k_days")
      .replace("{days}", _clQfFmt(days));
  }
  return `<button type="button" class="cl-qty-focus" data-cl-qty-focus="${qty}"`
    + ` data-table-id="${_clQfEsc(entry.tableId)}" data-row-key="${_clQfEsc(entry.rowKey)}"`
    + ` title="${_clQfEsc(tip)}">10k</button>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CL_FOCUS_BAR, qtyForFocusBar, clQtyFocusBtnHtml };
}
