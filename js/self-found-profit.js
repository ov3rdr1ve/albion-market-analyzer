/**
 * The shared "self-gathered" pure-profit twin (plan.md step 2).
 *
 * Every profit table that subtracts market-bought materials gains a second,
 * dimmed number: the same profit with the GATHERABLE inputs priced at zero and
 * every non-material silver term (station fee, recipe silver, travel legs,
 * artifacts, taxes) kept. Convention copied from the mounts breeding row's
 * self-found annotation (js/render-mounts-breeding-row.js, commit ea54329) and
 * the refining "Profit Gathered" logic (js/refining-route.js).
 *
 *   selfFoundProfit(sellPrice, keptSilverCosts)
 *       sellPrice × (1 − PREMIUM_TAX) − keptSilverCosts, or null when either
 *       input is not a finite number (a renderer omits the line instead of
 *       printing NaN; a negative result stays negative — a loss is a loss).
 *
 *   selfFoundSmallHtml(value, tipTx)
 *       the dimmed <small> line, byte-for-byte the breeding row's annotation;
 *       "" when value is not finite. tipTx is the ALREADY-TRANSLATED tooltip
 *       text: the caller renders its slug through tx() and substitutes its
 *       {placeholders} first, exactly like the breeding row does.
 *
 * Loading (same dual mode as the other split-out modules):
 *   browser   plain globals — classic scripts share one top-level scope, so
 *             the two functions are visible to every later <script>;
 *   Node      bare require() pulls js/calculations.js for the PREMIUM_TAX
 *             getter and formatSilver; the requiring harness supplies tx().
 *             The exports accessor below MERGES the helpers into any later
 *             `module.exports = { … }` assignment instead of being clobbered
 *             by it — the repo's test harnesses concatenate this file's source
 *             ahead of their own trailing export, so a plain
 *             `module.exports = { … }` here would be overwritten and the
 *             helpers lost to `mod.exports`.
 */

/**
 * Pure: the twin profit — revenue taxed like the primary number, materials at
 * zero, every kept silver cost subtracted as given.
 * @param {number} sellPrice the row's sell value (before tax)
 * @param {number} keptSilverCosts sum of the NON-material silver terms
 * @returns {number|null} null when either input is not a finite number
 */
function selfFoundProfit(sellPrice, keptSilverCosts) {
  // Strict finite-number check: Number(null) is 0 and isFinite(null) is true,
  // but a null/undefined basis means "no data", not "free" — the caller must
  // omit the line rather than print a made-up number.
  if (typeof sellPrice !== "number" || !isFinite(sellPrice)) return null;
  if (typeof keptSilverCosts !== "number" || !isFinite(keptSilverCosts)) return null;
  // PREMIUM_TAX is the SAME live getter the primary numbers read
  // (js/calculations.js): sales tax + the sell leg's setup fee, re-priced by
  // the Premium Account checkbox and the Pricing Model radios. The twin must
  // stay comparable to the primary, so it rides the identical rate.
  return sellPrice * (1 - PREMIUM_TAX) - keptSilverCosts;
}

/**
 * The dimmed second line of a Pure Profit cell — same shape as the breeding
 * row's self-found annotation: block-level, #9ca3af, 0.7rem, own tooltip.
 * @param {number} value the twin profit (negatives render as losses)
 * @param {string} [tipTx] tooltip text, already translated and substituted
 * @returns {string} the <small> line, or "" when value is not finite
 */
function selfFoundSmallHtml(value, tipTx) {
  if (typeof value !== "number" || !isFinite(value)) return "";
  const title = tipTx ? ` title="${tipTx}"` : "";
  return `<small style="color:#9ca3af;display:block;font-size:0.7rem"${title}>${tx("self-gathered", "r_selffound")} ${formatSilver(value)}</small>`;
}

/**
 * The dimmed "gathered" line of a Profit / 10k Focus cell: the same focus bar
 * with the row's self-gathered twin per play (the gatherable inputs at zero)
 * multiplied by the plays the bar buys. Same look as the self-found line.
 * @param {number} per10k the gathered bar profit
 * @param {number} perPlay the gathered profit of one play, for the tooltip
 * @returns {string} the <small> line, or "" when per10k is not finite
 */
function gatheredPer10kSmallHtml(per10k, perPlay) {
  if (typeof per10k !== "number" || !isFinite(per10k)) return "";
  const tip = tx("Same bar with the gatherable mats self-gathered (cost 0); fees, travel and other inputs still paid: {profit} profit each", "r_p10k_gathered_tip")
    .replace("{profit}", formatSilver(typeof perPlay === "number" && isFinite(perPlay) ? perPlay : 0));
  return `<small style="color:#9ca3af;display:block;font-size:0.7rem" title="${tip}">${tx("gathered", "r_p10k_gathered")} ${formatSilver(per10k)}</small>`;
}

// Node: pull the app globals the helpers read from the module that owns them.
// The require() side effect alone installs the PREMIUM_TAX live getter on
// globalThis; formatSilver comes off the same module's exports.
if (typeof module !== "undefined" && module.exports && typeof PREMIUM_TAX === "undefined") {
  try {
    const calc = require("./calculations.js");
    if (typeof formatSilver === "undefined" && typeof calc.formatSilver === "function") {
      Object.assign(globalThis, { formatSilver: calc.formatSilver });
    }
  } catch (e) { /* bare load without the sibling: the harness supplies them */ }
}

// Node exports, merge-shaped (see the header): later `module.exports = { … }`
// assignments keep these helpers instead of replacing them.
if (typeof module !== "undefined" && module) {
  const SELF_FOUND_EXPORTS = { selfFoundProfit, selfFoundSmallHtml, gatheredPer10kSmallHtml };
  let current = Object.assign({}, module.exports, SELF_FOUND_EXPORTS);
  Object.defineProperty(module, "exports", {
    configurable: true,
    get() { return current; },
    set(next) { current = Object.assign({}, SELF_FOUND_EXPORTS, next); },
  });
}
