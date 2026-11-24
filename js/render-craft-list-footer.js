/**
 * My Crafting List — the footer line and the Materials to Buy board.
 *
 * Split out of js/render-craft-list.js, which renders the rows: that file was
 * at the 800-line limit and this is a self-contained concern — everything below
 * reads a summarizeCraftList accumulator and an aggregateCraftListMaterials
 * result and turns them into HTML.
 *
 * The footer is one labelled cell, not a column-aligned footer: the groups
 * above have different column layouts, so a per-column total would land under
 * whichever header that group happened to carry in that position.
 */

/**
 * The laborer headcount box: how many laborers the laborer-journal play needs
 * for this basket, and an input that back-solves the other way — type what you
 * have and every laborer-play row's quantity scales to fit
 * (scaleCraftListToLaborers, js/craft-list-materials.js).
 *
 * Hidden when the basket fills no whole journal: "0 laborers" with an editable
 * box would be a control with nothing to divide by.
 */
function _clLaborersHtml(totals) {
  if (!(totals.totalJournals > 0)) return "";
  const name = (slug) => (typeof craftLaborerName === "function" ? craftLaborerName(slug) : slug);
  const breakdown = (totals.journalGroups || [])
    .map((g) => `${name(g.slug)} T${g.tier}: ${g.journals}`).join(" · ");
  const tip = tx(
    "One laborer works one journal per 22h cycle. Type how many laborers you have and the quantities resize to fit.",
    "r_cl_laborers_needed_tip",
  ) + (breakdown ? ` — ${breakdown}` : "");
  return ` · <span title="${_clEsc(tip)}">`
    + `<input type="number" min="1" step="1" class="cl-qty cl-laborers" data-cl-laborers="1"`
    + ` value="${totals.totalJournals}" /> ${tx("laborers", "r_cl_laborers_unit")}</span>`;
}

/**
 * The focus part of the footer: a BUDGET, not a yardstick.
 *
 * Focus is the one input on this list that cannot be bought — Premium
 * regenerates ~10,000 a day, the pool caps at 30,000 — so a basket bigger than
 * the budget does not get to run every craft focused. The box is what the plan
 * may spend; everything past it is priced at the base return rate and reported
 * here rather than quietly folded into the profit
 * (allocateCraftListFocus, js/craft-list-focus-budget.js).
 *
 * The whole part is hidden when the basket needs no focus at all: a budget
 * control on a list of flips would be a setting with nothing to set.
 */
function _clFocusHtml(totals) {
  const needed = Number(totals.focusNeeded) || 0;
  const used = Number(totals.totalFocus) || 0;
  if (!(needed > 0) && !(used > 0)) return "";

  const budget = Number.isFinite(Number(totals.focusBudget))
    ? Number(totals.focusBudget)
    : ((typeof getCraftListFocusBudget === "function") ? getCraftListFocusBudget() : 10000);
  const n = (v) => Math.round(v).toLocaleString();

  const budgetTip = tx(
    "Focus points this plan may spend. Premium regenerates about 10,000 a day and the pool caps at 30,000.",
    "r_cl_focus_budget_tip",
  );
  const box = `<input type="number" min="0" step="1000" class="cl-qty cl-focus-budget"`
    + ` data-cl-focus-budget="1" value="${budget}" title="${_clEsc(budgetTip)}" />`;

  // Spent vs available, so an under-used budget reads as headroom rather than
  // as the whole story the old fixed "≈N days at 10,000/day" hint told.
  const spent = `<span class="cl-focus-total">${n(used)} / ${n(budget)}</span>`;

  const short = Number(totals.focusUnfunded) || 0;
  const shortPart = short > 0
    ? ` · <span class="cl-focus-short" title="${_clEsc(tx(
        "Focus the budget could not cover. Those units are priced at the base return rate — they buy more materials and earn less.",
        "r_cl_focus_unfunded_tip",
      ))}">${tx("{focus} unfocused", "r_cl_focus_unfunded").replace("{focus}", n(short))}</span>`
    : "";

  // Say WHICH focus this is. A basket that only crafts spends its focus in one
  // sitting; a breeding basket pays a nurture a day for as many days as the
  // baby grows, so its total is a daily draw against a daily pool and reading
  // it as a one-off overstates the bill by the length of the ladder.
  const days = Math.floor(Number(totals.focusDays) || 1);
  const label = days > 1
    ? `<span title="${_clEsc(tx(
        "A nurture can only be done once every 24h, so this list spends focus in daily instalments — the longest runs {days} days.",
        "r_cl_focus_per_day_tip",
      ).replace("{days}", days))}">${tx("focus/day", "r_cl_focus_per_day")}</span>`
    : tx("focus", "r_focus");

  return ` · ${label} ${box} ${spent}${shortPart}`;
}

/**
 * Faction Points and Energy Manipulator Favor the basket spends — beside the
 * silver cost, since both are paid at an NPC and never counted in it. Each part
 * is hidden when nothing on the list costs that currency.
 */
function _clFpTotalHtml(totals) {
  const fp = Number(totals && totals.totalFp) || 0;
  const favor = Number(totals && totals.totalFavor) || 0;
  const fpPart = fp > 0
    ? ` · <span title="${_clEsc(tx("Faction Points the planned quantities spend", "r_cl_total_fp_tip"))}">`
      + `${tx("FP", "r_fp")} <span class="cl-total-fp">${Math.round(fp).toLocaleString()}</span></span>`
    : "";
  const favorPart = favor > 0
    ? ` · <span title="${_clEsc(tx("Favor the planned quantities spend at the Energy Manipulator", "r_cl_total_favor_tip"))}">`
      + `${tx("Favor", "r_favor")} <span class="cl-total-favor">${Math.round(favor).toLocaleString()}</span></span>`
    : "";
  return fpPart + favorPart;
}

/** The footer line. */
function _clTotalsCellHtml(totals, count) {
  // The SAME basket under the other journal play — the craftable rows hand the
  // journal to a laborer instead of selling it. Exclusive with `profit`, so it
  // is a second headline, never an addition. Hidden when nothing on the list
  // has that play: it would only restate `profit` (js/craft-list-materials.js).
  const laborerPart = totals.laborerRows > 0
    ? ` · <span title="${tx("The same basket, but every craftable row hands its journal to a laborer instead of selling it — the two plays are exclusive", "r_cl_total_laborer_tip")}">`
      + `${tx("with laborers", "r_cl_with_laborers")} `
      + `<strong class="${totals.totalLaborerProfit >= 0 ? "profit-high" : "profit-negative"}">${_clFmt(totals.totalLaborerProfit)}</strong></span>`
      + _clLaborersHtml(totals)
    : "";
  return `${tx("Totals", "r_totals")} (${count})`
    + ` · <span title="${tx("Silver spent on inputs", "r_cl_total_cost_tip")}">${tx("cost", "r_cl_cost")} <span class="silver-val">${_clFmt(totals.totalCost)}</span></span>`
    + _clFpTotalHtml(totals)
    + ` · <span title="${tx("Gross sale value before tax", "r_cl_total_revenue_tip")}">${tx("revenue", "r_cl_revenue")} <span class="silver-val">${_clFmt(totals.totalRevenue)}</span></span>`
    + ` · <span title="${tx("Rows are each priced with the full focus budget; this total shares one budget across all rows.", "r_cl_total_profit_shared_tip")}">${tx("profit", "r_cl_profit")} <strong class="${totals.totalProfit >= 0 ? "profit-high" : "profit-negative"}">${_clFmt(totals.totalProfit)}</strong></span>`
    + laborerPart
    + _clFocusHtml(totals);
}

/** The "Materials to buy" board under the list. */
function _clRenderMaterials(entries, allocation) {
  const tbody = document.querySelector("#craft-list-mats-table tbody");
  if (!tbody) return;
  const agg = aggregateCraftListMaterials(entries, allocation);
  if (!agg.lines.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:#6b7280;font-style:italic">`
      + `<span class="row-fluid row-note">`
      + `${tx("No purchasable materials on the list yet.", "r_cl_no_materials")}</span></td></tr>`;
    return;
  }
  const rows = agg.lines.map((l) => {
    const name = (typeof getItemDisplayName === "function") ? getItemDisplayName(l.matId) : l.matId;
    // A refined line is MADE by the plan, not bought — its price is the cost of
    // refining it, so it must not read as a market buy in the same city.
    const isRefine = l.note === "refine";
    const price = isRefine
      ? `<small style="color:#7ab8c4">${tx("refined by you", "r_cl_refined_by_you")} ▲ @ ${_clFmt(l.perUnit)}</small>`
      : ((typeof matPriceSpan === "function") ? matPriceSpan(l.matId, l.city, l.perUnit) : _clFmt(l.perUnit));
    const where = isRefine
      ? `<small style="color:#7ab8c4">${tx("refine", "r_refine_lower")} @ ${_clEsc(l.city)}</small>`
      : (_clEsc(l.city) || "—");
    return `<tr>`
      + `<td class="cell-item">${_clEsc(name)}</td>`
      + `<td>${where}</td>`
      // Rounded UP: the return rate makes counts fractional, and you cannot buy
      // 4.4 planks. The exact figure stays in the tooltip.
      + `<td class="cell-num" title="${l.count.toFixed(2)} ${tx("net of the return rate", "r_cl_net_of_rrr")}">${Math.ceil(l.count).toLocaleString()}</td>`
      + `<td class="cell-num">${price}</td>`
      + `<td class="silver-val cell-num">${_clFmt(l.total)}</td>`
      + `</tr>`;
  });
  rows.push(`<tr class="cl-totals">`
    + `<td colspan="4">${tx("Total to buy", "r_cl_total_to_buy")}</td>`
    + `<td class="silver-val cell-num"><strong>${_clFmt(agg.grandTotal)}</strong></td></tr>`);
  tbody.innerHTML = rows.join("");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { _clTotalsCellHtml, _clFpTotalHtml, _clFocusHtml, _clLaborersHtml, _clRenderMaterials };
}
