// Consumables "alternative routes" panel — the ingredients this row buys that
// it could make instead.
//
// The craft row prices every ingredient at market (js/render-consumables.js),
// so the Ingredients cell answers one question cleanly: what does this potion
// cost to build if I buy its parts. Several of those parts have a chain recipe
// — a pasture for the milk and the eggs, a mill for the flour, a butcher for
// the meat — and running it yourself is often cheaper. That is a different
// decision with different capital behind it, so it lives here, one block per
// ingredient, opened from the ▸ toggle in the Ingredients cell.
//
// Each block quotes the chain's per-unit cost, what it saves this craft, the
// profit that would result, and then the full breakdown tree — reusing
// renderChainBreakdown (js/render-chain-breakdown.js), so the leaves keep their
// editable price spans and their buy cities.
//
// Structure follows the Craft Planner's "best path" panel
// (js/render-craft-planner-paths.js) and the Top-10 boards' detail row
// (js/joined-summary-detail.js): open state lives in a JS Set and never in the
// DOM — every render wipes tbody.innerHTML — and the panel <tr> carries NO
// data-row-key, because sorting anchors, the table filters and the Craft List
// row cloner all key on that attribute.

// Rows whose alternative-routes panel is open, keyed by rowKey (js/sorting.js
// getRowKey). Independent of expandedCraftItems, which means "show my .1–.4
// enchant child rows" — both can be open on the same row.
const consumableOpenAltRows = new Set();

// Column count of consumable-table, for the panel row's colspan: add-button,
// consumable, route, ingredients, cost, sell price, margin, pure profit,
// profit/10k focus, mats to buy, silver/focus, best focus.
const CONS_ALT_COL_COUNT = 12;

function _consAltTx(en, key) {
  return (typeof tx === "function") ? tx(en, key) : en;
}

function _consAltName(matId) {
  return (typeof getItemDisplayName === "function" && getItemDisplayName(matId))
    || (typeof ITEM_NAMES_MAP !== "undefined" && ITEM_NAMES_MAP[matId])
    || matId;
}

/**
 * How many units of `matId` one output unit of the consumable actually eats,
 * after the craft's resource return. Same arithmetic the row's cost and the
 * Ingredients cell use, so the saving quoted here is on the row's own basis:
 * per single output unit, matching Pure Profit.
 */
function consumableAltConsumedCount(recipeEntry, rrr, recipeOutput) {
  const perUnitCount = recipeEntry.count / (recipeOutput || 1);
  return recipeEntry.noReturn ? perUnitCount : perUnitCount * (1 - (rrr || 0));
}

/**
 * The per-ingredient alternatives for a row, each with the silver it saves and
 * the profit it would leave. Pure data — the renderer below and the tests both
 * read it, and it never touches the row's own cost.
 */
function consumableAltRoutes(row) {
  const alts = row?.matAltChains || [];
  if (!alts.length) return [];
  const recipe = row.recipe || [];
  const recipeOutput = (row.item && typeof getRecipeOutput === "function")
    ? getRecipeOutput(row.item.id) : 1;
  const setupFee = (typeof SETUP_FEE === "number") ? SETUP_FEE : 0;
  const baseProfit = row.marginInfo?.profit || 0;
  return alts.map((alt) => {
    const entry = recipe.find((m) => m.matId === alt.matId) || { count: 0 };
    const consumedCount = consumableAltConsumedCount(entry, row.rrr, recipeOutput);
    const savings = (alt.marketPerUnit - alt.chainPerUnit) * consumedCount * (1 + setupFee);
    // The self-gathered twin: with this ingredient gathered/farmed itself its
    // WHOLE market cost — price × consumed × setup fee — comes back on top of
    // the row's profit. Self-gathering beats both the market AND the chain, so
    // chainPerUnit plays no part (unlike savings above).
    const selfFoundProfit = baseProfit + alt.marketPerUnit * consumedCount * (1 + setupFee);
    return {
      ...alt,
      consumedCount,
      savings,
      baseProfit,
      altProfit: baseProfit + savings,
      selfFoundProfit,
    };
  }).sort((a, b) => b.savings - a.savings);
}

function _consAltBlock(alt) {
  const name = _consAltName(alt.matId);
  const head = `<div class="cp-paths-root">`
    + `${_consAltTx("make {item} yourself", "r_cons_alt_make").replace("{item}", name)} `
    + `<small style="color:#9ca3af">@ ${formatSilver(alt.chainPerUnit)} ${_consAltTx("ea", "r_ea")}</small> `
    + `<small style="color:#9ca3af">(${_consAltTx("vs", "r_cons_alt_vs")} ${formatSilver(alt.marketPerUnit)} ${_consAltTx("ea", "r_ea")}`
    + `${alt.marketCity ? ` ${_consAltTx("from", "r_from_lower")} ${alt.marketCity}` : ""})</small>`
    + `</div>`;
  // The saving is per output unit, the same basis as the row's Pure Profit, so
  // the two figures can be read side by side without rescaling either.
  const tip = _consAltTx(
    "Silver this craft keeps per unit by chain-crafting the ingredient instead of buying it. The row above is priced at the market buy, so this is profit the row does not yet count.",
    "r_tip_cons_alt_saves",
  );
  const savingsLine = `<div class="cp-paths-mat">`
    + `<span class="profit-low" title="${tip}">`
    + `${_consAltTx("saves", "r_cons_alt_saves")} ${formatSilver(alt.savings)}</span> `
    + `<small style="color:#9ca3af">→ ${_consAltTx("profit", "r_cons_alt_profit")} `
    + `<span class="${alt.altProfit > 0 ? "profit-low" : "profit-negative"}">${formatSilver(alt.altProfit)}</span> `
    + `(${_consAltTx("vs", "r_cons_alt_vs")} ${formatSilver(alt.baseProfit)})</small>`
    + `</div>`;
  const tree = (typeof renderChainBreakdown === "function")
    ? renderChainBreakdown(alt.chain, alt.consumedCount)
    : "";
  return `${head}${savingsLine}${tree}`;
}

/**
 * The panel <tr>, or "" when this row has nothing to offer or is collapsed.
 * Appended to the craft row's own template string so it can never be sorted or
 * filtered away from its parent.
 */
function consumableAltRoutesRow(row, rowKey, colSpan) {
  if (!rowKey || !consumableOpenAltRows.has(rowKey)) return "";
  const alts = consumableAltRoutes(row);
  if (!alts.length) return "";
  const span = colSpan || CONS_ALT_COL_COUNT;
  const intro = `<div class="cp-paths-root" style="color:#9ca3af;font-weight:400">`
    + `${_consAltTx("Ingredients this row buys that you could make instead:", "r_cons_alt_intro")}</div>`;
  const blocks = alts.map((a) => `<div style="margin-top:6px">${_consAltBlock(a)}</div>`).join("");
  return `
      <tr class="cp-paths-row">
        <td colspan="${span}"><div class="cp-paths-wrap"><div class="cp-paths-block">${intro}${blocks}</div></div></td>
      </tr>`;
}

// Node test harness export (inert in the browser, which uses globals).
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    consumableOpenAltRows,
    consumableAltRoutes,
    consumableAltRoutesRow,
    consumableAltConsumedCount,
    CONS_ALT_COL_COUNT,
  };
}
