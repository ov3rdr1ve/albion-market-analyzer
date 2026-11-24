// Crafting Planner — the "Reroll EV" column: the expected silver UPLIFT of
// walking the row's Normal-quality item up the quality ladder at a repair
// station — optimally, i.e. rerolling while it pays and stopping the moment it
// does not — instead of selling it at Normal, at the row's sell city.
//
// Pure computation: every cross-module helper (REROLL_MATRIX, getGearItemValue,
// applyGlobalDiscount, getQualitySellPrice, lastQualityMarketData, tx,
// formatSilver) is resolved at CALL time, never at load time, so script order
// in index.html cannot break this file and the tests can stub each one.
//
// The walk is the REROLL_MATRIX absorbing chain (js/data-rerolling.js): a
// reroll never lowers quality, and each CURRENT quality is billed its own
// item-value × modifier. Because qualities only move up, the optimal-stopping
// value is one descending pass of Bellman maxima:
//
//   V(top) = sell(top)
//   V(q)   = max( sell(q), ( Σ_{q' > q} P(q→q')·V(q') − cost(q) ) / (1 − P(q→q)) )
//
// — the spec's Σ_{q' ≥ q} form solved for V(q): the stay mass re-enters the
// same choice, which is exactly "keep rerolling while it pays" (the same
// escape-division solveRerollWalk uses for costs). uplift = V(1) − sell(1) is
// therefore ≥ 0 by construction (the walk can always stop and sell) and ≤
// max reachable sell − sell(1); 0 means rerolling never pays.

function _rreTx(en, slug) {
  return (typeof tx === "function") ? tx(en, slug) : en;
}

// Qualities a walk from Q1 can land on: positive matrix mass, transitively.
// The solve needs sell prices only for these — a city missing the price of a
// quality the walk cannot reach still prices the reroll fine.
function _rreReachable(matrix) {
  const reach = new Set([1]);
  let grew = true;
  while (grew) {
    grew = false;
    reach.forEach((q) => {
      const row = matrix[q] || {};
      Object.keys(row).forEach((k) => {
        if (row[k] > 0 && !reach.has(Number(k))) { reach.add(Number(k)); grew = true; }
      });
    });
  }
  return reach;
}

// One reroll attempt billed at `q`: item value × that quality's modifier,
// then the global discount.
function _rreCost(itemId, q) {
  const mods = (typeof REROLL_COST_MODIFIER !== "undefined" && REROLL_COST_MODIFIER) || {};
  const value = (typeof getGearItemValue === "function") ? getGearItemValue(itemId) : 0;
  const gross = value * (mods[q] || 0);
  return (typeof applyGlobalDiscount === "function") ? applyGlobalDiscount(gross) : gross;
}

/**
 * Expected silver uplift of optimally quality-rerolling `itemId` before
 * selling it at `sellCity`, versus selling it at Normal. A number (≥ 0) or
 * null when the reroll cannot be priced: the item is not base T4-T8
 * equipment (getEquipmentSlot + tier gate — artifact materials, mounts and
 * consumables have no quality), or any quality price the walk can REACH from
 * Q1 reads 0 (missing) at that city. With the real matrix the walk can land
 * on every quality 1..5, so one missing quality price → null.
 */
function computeRerollEvUplift(itemId, sellCity) {
  if (typeof getEquipmentSlot !== "function" || !getEquipmentSlot(itemId)) return null;
  const tier = Number((/^T(\d+)/.exec(String(itemId)) || [])[1]) || 0;
  if (tier < 4 || tier > 8) return null;
  if (typeof getQualitySellPrice !== "function") return null;
  const matrix = (typeof REROLL_MATRIX !== "undefined" && REROLL_MATRIX) || {};
  const data = (typeof lastQualityMarketData !== "undefined") ? lastQualityMarketData : null;
  const reach = _rreReachable(matrix);
  const sell = {};
  for (const q of reach) {
    sell[q] = getQualitySellPrice(data, itemId, q, sellCity);
    if (!(sell[q] > 0)) return null; // a price the walk can reach is missing
  }
  const order = [...reach].sort((a, b) => b - a);
  const V = {};
  order.forEach((q, i) => {
    if (i === 0 || !matrix[q]) { V[q] = sell[q]; return; } // top, or no reroll table
    const row = matrix[q];
    let up = 0;
    Object.keys(row).forEach((k) => {
      if (Number(k) > q) up += (row[k] || 0) * V[Number(k)];
    });
    const escape = 1 - (row[q] || 0);
    const reroll = escape > 0 ? (up - _rreCost(itemId, q)) / escape : -Infinity;
    V[q] = Math.max(sell[q], reroll);
  });
  return V[1] - sell[1];
}

/**
 * The planner's Reroll EV cell: a green +silver figure when rerolling pays,
 * a dim dash when it does not (uplift 0) or cannot be priced (null).
 */
function rerollEvCell(itemId, sellCity) {
  const tip = _rreTx("Expected extra silver per item from optimally quality-rerolling the crafted item instead of selling it at Normal, at this row's sell city. Fills only after a full-market Scan or Scan Rerolling (per-quality prices).", "r_cp_reroll_ev_tip");
  const uplift = computeRerollEvUplift(itemId, sellCity);
  if (uplift !== null && uplift > 0) {
    const fmt = (typeof formatSilver === "function")
      ? formatSilver(uplift)
      : String(Math.round(uplift));
    return `<td class="silver-val profit-high" title="${tip}">+${fmt}</td>`;
  }
  return `<td style="color:#6b7280;font-style:italic" title="${tip}">—</td>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { computeRerollEvUplift, rerollEvCell };
}
