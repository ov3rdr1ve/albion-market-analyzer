/**
 * Faction Spending — "Profit / 10k Focus (FP inputs)".
 *
 * Values an FP-bought BABY by what a full focus bar earns when it is bred &
 * saddled as a FREE input (you paid Faction Points, not silver) instead of
 * being sold. The mounts table already computes `fpAdjustedProfit` (cycle
 * profit with every FP-priced input — the baby plus any hearts in the saddler
 * recipe — added back) and `focusCost` (nurture focus per cycle); that is
 * scaled by the cycles a 10,000-focus bar buys (calculateProfitPer10kFocus).
 *
 * Only babies get a value. Hearts, crests, chests and Favor rows render an em
 * dash: a heart is an ingredient, not a focus play, so a "free heart per
 * refine" figure credited the heart with a whole refine's profit (a reported case,
 * 2026-10-04: "treeheart should NOT have profit/10k focus").
 */

/**
 * Breeding play for a baby acquired with FP (or Favor). Reads the breed data the
 * Faction Spending table already lifted off the mounts table.
 * @returns {{per10k:number, profitPerCycle:number, focusCost:number,
 *            cycles:number}|null}
 */
function getBabyFpFocusValue(breedData) {
  if (!breedData) return null;
  const focusCost = breedData.nurtureFocusCost || 0;
  // Focus-ON cycle profit (js/render-mounts.js) — a 10k-focus figure prices
  // focus-on play, so it must not follow the "Use Focus" checkbox. Falls back
  // to the checkbox figure for callers passing synthetic breed data.
  const profitPerCycle = (typeof breedData.fpAdjustedProfitFocusOn === "number"
    && breedData.fpAdjustedProfitFocusOn !== 0)
    ? breedData.fpAdjustedProfitFocusOn
    : (breedData.fpAdjustedProfit || 0);
  if (focusCost <= 0 || profitPerCycle === 0) return null;
  const per10k = (typeof calculateProfitPer10kFocus === "function")
    ? calculateProfitPer10kFocus(profitPerCycle, focusCost)
    : 0;
  return { per10k, profitPerCycle, focusCost, cycles: (typeof focusBarCrafts === "function" ? focusBarCrafts(focusCost) : Math.floor(10000 / focusCost)) };
}

/**
 * Best FP placement in a breeding chain — the FP counterpart of Best Focus.
 *
 * A breeding cycle can take FP in more than one place: the baby itself
 * (Faction NPC), any FP-priced saddler material (the hearts in a T8 boar's
 * saddle), or all of them. Each placement is scored the way S/FP (Bred) scores
 * the whole set: the cycle's profit with that placement's inputs costing 0
 * silver (`cycleProfit` = all-bought cycle profit + what those inputs cost on
 * the market, setup fee in) divided by the FP the placement costs.
 *
 * The first version scored only the silver an input saves and left the
 * breeding margin out, so a baby whose BUY price sits under its bred value
 * lost to the hearts (10.25/FP) on a row whose bred S/FP was 19.33 (a reported case,
 * 2026-10-05). Crediting the cycle to the FP spent is what S/FP (Bred) does,
 * and it makes the two cells agree: the all-FP placement IS that column.
 *
 * Ranked on silver per FP (FP is a budget spent across the whole table);
 * exact ties go to the cheaper placement. Placements with no market price for
 * their inputs (silverSaved ≤ 0) or a non-positive cycle are skipped.
 *
 * @param {Array<{input:string,itemId:?string,count:number,fpCost:number,silverSaved:number,cycleProfit:number}>} plays
 * @returns {object|null} the winning play with `silverPerFp` added
 */
function pickBestFpPlay(plays) {
  if (!Array.isArray(plays)) return null;
  let best = null;
  plays.forEach((p) => {
    if (!p || !(p.fpCost > 0) || !(p.silverSaved > 0) || !(p.cycleProfit > 0)) return;
    const scored = { ...p, silverPerFp: p.cycleProfit / p.fpCost };
    if (!best) { best = scored; return; }
    const better = scored.silverPerFp > best.silverPerFp + 1e-9;
    const tieCheaper = Math.abs(scored.silverPerFp - best.silverPerFp) <= 1e-9
      && scored.fpCost < best.fpCost;
    if (better || tieCheaper) best = scored;
  });
  return best;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getBabyFpFocusValue, pickBestFpPlay };
}
