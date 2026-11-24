/**
 * The Pure Profit cell builders, extracted from js/app.js (plan.md step 2 —
 * app.js was over the 800-line cap). app.js keeps same-name forwarders, so
 * every caller, renderer and Node source-lift keeps working unchanged; the
 * browser global these forwarders resolve through is __pureProfitCell below.
 *
 * Behavior contract (tests/self-found-profit-core.test.cjs):
 *   - marginInfo.selfFoundProfit a finite number → the dimmed self-found
 *     <small> line (js/self-found-profit.js) is appended after the headline
 *     value — after the margin line in profitWithMarginTd — carrying its OWN
 *     r_selffound_tip tooltip with the twin's silver substituted into {value};
 *   - selfFoundProfit absent or non-finite → output byte-identical to the
 *     pre-extraction implementation, so every table that does not compute the
 *     twin yet renders exactly what it rendered before.
 *
 * Loading (same dual mode as the other split-out modules):
 *   browser   plain globals; index.html loads this after js/calculations.js
 *             (getProfitClass) and js/self-found-profit.js (the twin line),
 *             and before js/app.js, whose forwarders call __pureProfitCell;
 *   Node      bare require() pulls the app globals from the siblings that own
 *             them (calculations.js, self-found-profit.js, i18n.js).
 */

/** The self-found tooltip: one sentence, {value} substituted by the caller. */
function _selfFoundTip(sfValue) {
  return tx("Same craft, materials self-gathered (inputs at zero cost, fees and taxes kept): sell × (1 − market tax) − kept silver = {value}", "r_selffound_tip").replace("{value}", formatSilver(sfValue));
}

function pureProfitTd(marginInfo, title) {
  const profit = marginInfo?.profit;
  if (profit === undefined || profit === null) return '<td class="silver-val" style="color:#6b7280;font-style:italic">\u2014</td>';
  const titleAttr = title ? ` title="${title}"` : "";
  // The self-found twin: only when the row actually computed one (finite), so
  // tables without it stay byte-identical to the pre-extraction output.
  const sf = marginInfo?.selfFoundProfit;
  const selfFoundLine = (typeof sf === "number" && isFinite(sf))
    ? selfFoundSmallHtml(sf, _selfFoundTip(sf))
    : "";
  return `<td class="silver-val ${getProfitClass(marginInfo.margin)}"${titleAttr}>${formatSilver(profit)}${selfFoundLine}</td>`;
}

// pureProfitTd + the margin on a second line, in ONE cell that is still
// click-to-change-sell-city. For wide tables where a standalone Margin % column
// is a whole column spent on a number derived from the two beside it \u2014 but the
// click affordance lived on that column (profitTd), so it has to move here or it
// is lost. Carries both: the `data-profit-cell` attributes AND the arithmetic
// tooltip pureProfitTd exists for.
function profitWithMarginTd(marginInfo, title, tableId, rowIdx, sellCity) {
  const profit = marginInfo?.profit;
  if (profit === undefined || profit === null) return '<td class="silver-val" style="color:#6b7280;font-style:italic">\u2014</td>';
  const margin = marginInfo?.margin;
  const hasMargin = typeof margin === "number" && isFinite(margin) && margin > -1;
  const tip = title
    ? `${title} \u2014 ${tx("click to change sell city", "r_tip_click_sell_city")}`
    : tx("Click to change sell city", "r_tip_change_sell_city");
  const marginLine = hasMargin
    ? `<br><small style="color:#9ca3af">${margin.toFixed(2)}%</small>`
    : "";
  const sf = marginInfo?.selfFoundProfit;
  const selfFoundLine = (typeof sf === "number" && isFinite(sf))
    ? selfFoundSmallHtml(sf, _selfFoundTip(sf))
    : "";
  return `<td class="silver-val ${getProfitClass(margin)} profit-cell-clickable" data-profit-cell="1" data-table-id="${tableId}" data-row-idx="${rowIdx}" data-sell-city="${sellCity || ""}" title="${tip}">${formatSilver(profit)}${marginLine}${selfFoundLine}</td>`;
}

// The namespace js/app.js's same-name forwarders call. A top-level const in a
// classic script is a global lexical binding every later script sees, and it
// keeps the forwarders from recursing through the global binding these
// declarations held before the extraction.
const __pureProfitCell = { pureProfitTd, profitWithMarginTd };

// Node: the same bridge the other split-out modules use — bare require() pulls
// the app globals the builders read from the siblings that own them.
if (typeof module !== "undefined" && module.exports) {
  try {
    const calc = require("./calculations.js");
    Object.assign(globalThis, { getProfitClass: calc.getProfitClass, formatSilver: calc.formatSilver });
  } catch (e) { /* bare load without the sibling: the harness supplies them */ }
  if (typeof selfFoundSmallHtml !== "function") {
    try { Object.assign(globalThis, require("./self-found-profit.js")); } catch (e) { /* harness supplies it */ }
  }
  if (typeof tx !== "function") {
    try { const i18n = require("./i18n.js"); if (typeof i18n.tx === "function") globalThis.tx = i18n.tx; } catch (e) { /* harness supplies it */ }
  }
  module.exports = { pureProfitTd, profitWithMarginTd };
}
