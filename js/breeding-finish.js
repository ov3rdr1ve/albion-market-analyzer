// Breeding row helpers: best finish for a grown animal, and own-baby sell-vs-raise.
// Pure functions, no DOM. Browser: plain function declarations land on globalThis.
// Node: module.exports (tests/breeding-best-finish.test.cjs, breeding-baby-sell-vs-raise.test.cjs).

// grownId -> EVERY non-battlemount recipe that consumes it, in declaration order.
// Battle mounts are tame->saddled chains, not breeding finishes; recipes without a
// /^T\d_FARM_/ input are skipped. Mirrors the old first-wins SADDLER_BY_GROWN scan,
// minus the "first wins" cut: the caller ranks the candidates with pickBestFinish.
function buildGrownFinishRecipes(recipes) {
  const map = {};
  for (const m of recipes) {
    if (m.craftType === "battlemount") continue;
    const grownMat = m.materials.find((x) => /^T\d_FARM_/.test(x.matId));
    if (!grownMat) continue;
    (map[grownMat.matId] || (map[grownMat.matId] = [])).push(m);
  }
  return map;
}

// candidates: [{ recipeId, sellNet, matCost, priced }] in declaration order.
// Highest sellNet - matCost wins; a priced candidate always beats an unpriced one
// (an unpriced finish ranks last, never voids the row). Ties keep the earlier
// candidate. Returns the winning candidate, or null for an empty list.
function pickBestFinish(candidates) {
  let best = null, bestNet = -Infinity;
  for (const cand of candidates) {
    if (!cand.priced) continue;
    const net = cand.sellNet - cand.matCost;
    if (best === null || net > bestNet) { best = cand; bestNet = net; }
  }
  return best || (candidates.length ? candidates[0] : null);
}

// Net of raising an already-owned baby one cycle: the row's profit assumed buying
// the baby, so owning it adds that purchase (plus its setup fee) back.
function raiseNetFromRow(profit, babyCost, setupFee) {
  return profit + babyCost * (1 + (setupFee || 0));
}

// Sell the owned baby now vs raise it. `tax` is passed by the caller (PREMIUM_TAX is
// a live getter, never a const). An instant sale pays no setup fee; a sell order does.
// Tie -> "raise". No sell price -> winner "raise", sellNet 0, sellUnpriced true.
function babySellVsRaise({ babySellPrice, raiseNet, instant, tax, setupFee }) {
  if (!(babySellPrice > 0)) {
    return { sellNet: 0, raiseNet, winner: "raise", delta: 0, sellUnpriced: true };
  }
  const sellNet = babySellPrice * (1 - tax - (instant ? 0 : (setupFee || 0)));
  return {
    sellNet,
    raiseNet,
    winner: sellNet > raiseNet ? "sell" : "raise",
    delta: Math.abs(sellNet - raiseNet),
    sellUnpriced: false,
  };
}

// One built row per finishing recipe (a row carries recipe, sellPot.price,
// brecilienFee, saddlerMatCost, hasMissingSaddlerMats) -> the best-paying row.
// Net = sale after tax and sell travel, minus finish mats incl. setup fee.
function pickFinishRow(rows, tax, setupFee) {
  if (rows.length < 2) return rows[0] || null;
  const cands = rows.map((r) => ({
    recipeId: r.recipe ? r.recipe.id : null,
    sellNet: (r.sellPot.price || 0) * (1 - tax) - (r.brecilienFee || 0),
    matCost: (r.saddlerMatCost || 0) * (1 + (setupFee || 0)),
    priced: (r.sellPot.price || 0) > 0 && !r.hasMissingSaddlerMats,
    row: r,
  }));
  return pickBestFinish(cands).row;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildGrownFinishRecipes, pickBestFinish, raiseNetFromRow, babySellVsRaise, pickFinishRow };
}
